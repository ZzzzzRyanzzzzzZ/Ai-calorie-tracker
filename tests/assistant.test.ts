import { describe, expect, it } from 'vitest';
import { TOOL_DECLARATIONS, type ToolContext, resolveDate, runTool, toolNames } from '../src/ai/tools.ts';
import { type ChatMessage, looksLikeKey, systemInstruction, toContents } from '../src/ai/gemini.ts';
import { describeDay, describeEntry, lastMealOf, suggestItems } from '../src/core/history.ts';
import { dayOf, emptyState, newId, totalsFor } from '../src/core/store.ts';
import { fitWithin } from '../src/ui/image.ts';
import type { FoodEntry, MealSlot } from '../src/core/types.ts';

function context(): ToolContext {
  return { state: emptyState(), today: '2026-03-15', hour: 13 };
}

function foodEntry(foodId: string, foodName: string, kcal: number, meal: MealSlot, grams = 150): FoodEntry {
  return {
    id: newId(),
    text: foodName,
    foodId,
    foodName,
    grams,
    amountLabel: '1 katori',
    nutrients: { kcal, protein: 8, carbs: 20, fat: 5, fiber: 3 },
    confidence: 1,
    meal,
    at: '2026-03-01T12:00:00Z',
  };
}

describe('dates the assistant can be given', () => {
  it('understands the words people use', () => {
    expect(resolveDate('today', '2026-03-15')).toBe('2026-03-15');
    expect(resolveDate('yesterday', '2026-03-15')).toBe('2026-03-14');
    expect(resolveDate('2026-01-02', '2026-03-15')).toBe('2026-01-02');
    expect(resolveDate(undefined, '2026-03-15')).toBe('2026-03-15');
  });

  it('falls back to today rather than inventing a date', () => {
    expect(resolveDate('last tuesday-ish', '2026-03-15')).toBe('2026-03-15');
    expect(resolveDate('not a date', '2026-03-15')).toBe('2026-03-15');
  });
});

describe('logging through the assistant', () => {
  it('prices food from the database, not from the model', () => {
    const ctx = context();
    const result = runTool('log_food', { description: '2 rotis and a katori of dal' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.mutated).toBe(true);

    const day = dayOf(ctx.state, '2026-03-15');
    expect(day.foods).toHaveLength(2);
    expect(day.foods.map((f) => f.foodId)).toEqual(['roti', 'dal-tadka']);
    // Exactly what the typed interface would have produced.
    expect(totalsFor(day).kcal).toBe(392);
  });

  it('puts the entry in the meal it was told, or the one the clock implies', () => {
    const ctx = context();
    runTool('log_food', { description: '3 idli', meal: 'breakfast' }, ctx);
    runTool('log_food', { description: '2 roti' }, ctx);
    const foods = dayOf(ctx.state, '2026-03-15').foods;
    expect(foods[0]?.meal).toBe('breakfast');
    expect(foods[1]?.meal).toBe('lunch'); // hour 13
  });

  it('logs to another day when asked', () => {
    const ctx = context();
    runTool('log_food', { description: '1 dosa', date: 'yesterday' }, ctx);
    expect(dayOf(ctx.state, '2026-03-14').foods).toHaveLength(1);
    expect(dayOf(ctx.state, '2026-03-15').foods).toHaveLength(0);
  });

  it('reports what it could not identify instead of guessing', () => {
    const ctx = context();
    const result = runTool('log_food', { description: '1 plate of zzzqqxx' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.mutated).toBe(false);
    expect(dayOf(ctx.state, '2026-03-15').foods).toHaveLength(0);
  });

  it('logs training with the local MET arithmetic', () => {
    const ctx = context();
    const result = runTool('log_training', { description: 'ran 5k in 25 min' }, ctx);
    expect(result.ok).toBe(true);
    const activities = dayOf(ctx.state, '2026-03-15').activities;
    expect(activities[0]?.exerciseId).toBe('running');
    expect(activities[0]?.minutes).toBe(25);
    expect(activities[0]?.kcalNet).toBeGreaterThan(150);
  });

  it('records a weight and refuses a silly one', () => {
    const ctx = context();
    expect(runTool('set_weight', { kg: 74.25 }, ctx).ok).toBe(true);
    expect(dayOf(ctx.state, '2026-03-15').weightKg).toBe(74.3);
    expect(ctx.state.profile.weightKg).toBe(74.3);

    const silly = runTool('set_weight', { kg: 4 }, ctx);
    expect(silly.ok).toBe(false);
    expect(dayOf(ctx.state, '2026-03-15').weightKg).toBe(74.3);
  });

  it('undoes the last thing logged', () => {
    const ctx = context();
    runTool('log_food', { description: '2 roti' }, ctx);
    runTool('log_food', { description: '1 katori dal' }, ctx);
    const result = runTool('remove_last_food', {}, ctx);
    expect(result.ok).toBe(true);
    expect(dayOf(ctx.state, '2026-03-15').foods).toHaveLength(1);
  });

  it('changes only the profile fields it was given', () => {
    const ctx = context();
    const before = ctx.state.profile.age;
    const result = runTool('update_profile', { goal: 'gain', training_days: 5, equipment: ['barbell', 'nonsense'] }, ctx);
    expect(result.ok).toBe(true);
    expect(ctx.state.profile.goal).toBe('gain');
    expect(ctx.state.profile.trainingDays).toBe(5);
    expect(ctx.state.profile.equipment).toEqual(['barbell']);
    expect(ctx.state.profile.age).toBe(before);
  });

  it('rejects profile values that are out of range', () => {
    const ctx = context();
    const result = runTool('update_profile', { training_days: 40, rate_kg_per_week: -9 }, ctx);
    expect(result.ok).toBe(false);
    expect(ctx.state.profile.trainingDays).not.toBe(40);
  });
});

describe('reading through the assistant', () => {
  it('summarises a day against the target', () => {
    const ctx = context();
    runTool('log_food', { description: '2 roti, 1 katori dal' }, ctx);
    const result = runTool('get_day', {}, ctx);
    expect(result.ok).toBe(true);
    expect(result.mutated).toBe(false);
    expect(result.data?.['eaten']).toBe(392);
    expect(result.data?.['target']).toBeGreaterThan(1000);
  });

  it('reports the plan and whether maintenance is measured yet', () => {
    const result = runTool('get_plan', {}, context());
    expect(result.data?.['confidence']).toBe('none');
    expect(result.data?.['bmr']).toBeGreaterThan(1000);
  });

  it('reads out the prescribed session', () => {
    const result = runTool('get_workout', {}, context());
    expect(result.ok).toBe(true);
    expect(result.summary.length).toBeGreaterThan(20);
  });

  it('looks a food up without logging it', () => {
    const ctx = context();
    const result = runTool('search_food', { query: 'paneer' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.mutated).toBe(false);
    expect(dayOf(ctx.state, '2026-03-15').foods).toHaveLength(0);
  });

  it('says so when a tool does not exist', () => {
    const result = runTool('delete_everything', {}, context());
    expect(result.ok).toBe(false);
    expect(result.mutated).toBe(false);
  });
});

describe('the tool contract sent to the model', () => {
  it('declares exactly the tools that exist', () => {
    const declared = TOOL_DECLARATIONS.map((tool) => tool.name).sort();
    expect(declared).toEqual(toolNames().sort());
  });

  it('gives every tool a description and a parameter object', () => {
    for (const tool of TOOL_DECLARATIONS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
      expect(tool.parameters.type, tool.name).toBe('OBJECT');
    }
  });

  it('tells the model not to invent numbers', () => {
    const instruction = systemInstruction(context());
    expect(instruction).toMatch(/never estimate nutrition/i);
    expect(instruction).toMatch(/own words/i);
  });
});

describe('the wire format', () => {
  it('turns history into contents, image first', () => {
    const history: ChatMessage[] = [
      { role: 'user', text: 'what is this', at: '', attachment: { mimeType: 'image/jpeg', data: 'AAAA' } },
      { role: 'model', text: 'a plate of rice', at: '' },
    ];
    const contents = toContents(history);
    expect(contents).toHaveLength(2);
    expect(contents[0]?.parts[0]?.inlineData?.mimeType).toBe('image/jpeg');
    expect(contents[0]?.parts[1]?.text).toBe('what is this');
    expect(contents[1]?.role).toBe('model');
  });

  it('never sends an empty parts array', () => {
    const contents = toContents([{ role: 'user', text: '', at: '' }]);
    expect(contents[0]?.parts.length).toBeGreaterThan(0);
  });

  it('recognises the shape of a Gemini key without checking it', () => {
    expect(looksLikeKey('AIzaSyB1234567890abcdefghijklmnopqrstuv')).toBe(true);
    expect(looksLikeKey('  AIzaSyB1234567890abcdefghijklmnopqrstuv  ')).toBe(true);
    expect(looksLikeKey('sk-not-a-google-key')).toBe(false);
    expect(looksLikeKey('AIza')).toBe(false);
  });
});

describe('logging from your own history', () => {
  it('ranks a habit above a one-off', () => {
    const state = emptyState();
    for (const date of ['2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13']) {
      dayOf(state, date).foods.push(foodEntry('dal-tadka', 'Dal tadka', 180, 'lunch'));
    }
    dayOf(state, '2026-03-14').foods.push(foodEntry('pizza', 'Pizza', 500, 'lunch'));

    const suggestions = suggestItems(state, '2026-03-15', { meal: 'lunch' });
    expect(suggestions[0]?.foodId).toBe('dal-tadka');
    expect(suggestions[0]?.count).toBe(4);
  });

  it('lets a stale habit fade', () => {
    const state = emptyState();
    for (const date of ['2025-11-01', '2025-11-02', '2025-11-03']) {
      dayOf(state, date).foods.push(foodEntry('dal-tadka', 'Dal tadka', 180, 'lunch'));
    }
    dayOf(state, '2026-03-14').foods.push(foodEntry('rice', 'Rice', 200, 'lunch'));
    const suggestions = suggestItems(state, '2026-03-15', { meal: 'lunch' });
    expect(suggestions[0]?.foodId).toBe('rice');
  });

  it('groups portions that are the same habit at a different weight', () => {
    const state = emptyState();
    dayOf(state, '2026-03-13').foods.push(foodEntry('rice', 'Rice', 195, 'dinner', 148));
    dayOf(state, '2026-03-14').foods.push(foodEntry('rice', 'Rice', 195, 'dinner', 152));
    const suggestions = suggestItems(state, '2026-03-15', { meal: 'dinner' });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.count).toBe(2);
  });

  it('finds the last time a meal was eaten', () => {
    const state = emptyState();
    dayOf(state, '2026-03-12').foods.push(foodEntry('dal-tadka', 'Dal tadka', 180, 'dinner'));
    dayOf(state, '2026-03-14').foods.push(foodEntry('rice', 'Rice', 195, 'dinner'));
    const previous = lastMealOf(state, '2026-03-15', 'dinner');
    expect(previous?.date).toBe('2026-03-14');
    expect(previous?.items).toHaveLength(1);
    expect(lastMealOf(state, '2026-03-15', 'breakfast')).toBeNull();
  });

  it('does not say the food twice', () => {
    // "2 roti" already names the food; "1 katori" does not.
    expect(describeEntry({ amountLabel: '2 roti', foodName: 'Roti (chapati, whole wheat)' })).toBe('2 roti');
    expect(describeEntry({ amountLabel: '1 katori', foodName: 'Dal tadka' })).toBe('1 katori dal tadka');
    expect(describeEntry({ amountLabel: '3 idli', foodName: 'Idli' })).toBe('3 idli');
    expect(describeEntry({ amountLabel: '200 g', foodName: 'Chicken breast, cooked' })).toBe('200 g chicken breast');
  });

  it('describes a day in a sentence', () => {
    const state = emptyState();
    const day = dayOf(state, '2026-03-14');
    day.foods.push(foodEntry('dal-tadka', 'Dal tadka', 180, 'lunch'));
    day.weightKg = 74;
    expect(describeDay(day)).toMatch(/ate 1 katori dal tadka/);
    expect(describeDay(day)).toMatch(/74 kg/);
    expect(describeDay(dayOf(state, '2026-03-01'))).toBe('nothing logged');
  });
});

describe('preparing a photo', () => {
  it('caps the longest edge and keeps the aspect ratio', () => {
    expect(fitWithin(4032, 3024, 1024)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(3024, 4032, 1024)).toEqual({ width: 768, height: 1024 });
  });

  it('never scales a small photo up', () => {
    expect(fitWithin(640, 480, 1024)).toEqual({ width: 640, height: 480 });
  });
});
