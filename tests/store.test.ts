import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE,
  dailyRecords,
  dayOf,
  emptyState,
  exportCsv,
  exportJson,
  importJson,
  migrate,
  today,
  totalsFor,
} from '../src/core/store.ts';
import type { StoreState } from '../src/core/store.ts';
import type { DayLog, FoodEntry } from '../src/core/types.ts';

function entry(name: string, kcal: number): FoodEntry {
  return {
    id: name,
    text: name,
    foodId: 'roti',
    foodName: name,
    grams: 100,
    amountLabel: '1 serving',
    nutrients: { kcal, protein: 5, carbs: 20, fat: 2, fiber: 1 },
    confidence: 1,
    meal: 'lunch',
    at: '2026-01-01T12:00:00Z',
  };
}

describe('the log', () => {
  it('starts empty with a sane profile', () => {
    const state = emptyState();
    expect(state.days).toEqual({});
    expect(state.profile.weightKg).toBeGreaterThan(0);
    expect(state.profile.equipment.length).toBeGreaterThan(0);
  });

  it('creates a day on first use', () => {
    const state = emptyState();
    const day = dayOf(state, '2026-01-01');
    expect(day.foods).toEqual([]);
    expect(state.days['2026-01-01']).toBe(day);
  });

  it('adds up a day', () => {
    const day: DayLog = { date: '2026-01-01', foods: [entry('a', 300), entry('b', 200)], activities: [] };
    expect(totalsFor(day).kcal).toBe(500);
    expect(totalsFor(day).protein).toBe(10);
  });

  it('formats today in the local timezone, not UTC', () => {
    expect(today(new Date('2026-03-15T10:00:00'))).toBe('2026-03-15');
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('survives a corrupt or half-written file', () => {
    expect(migrate(null).days).toEqual({});
    expect(migrate('nonsense').profile).toEqual(DEFAULT_PROFILE);
    expect(migrate({ days: { 'not-a-date': {} } }).days).toEqual({});
    const partial = migrate({ profile: { weightKg: 90 }, days: { '2026-01-01': { foods: null } } });
    expect(partial.profile.weightKg).toBe(90);
    expect(partial.profile.age).toBe(DEFAULT_PROFILE.age);
    expect(partial.days['2026-01-01']?.foods).toEqual([]);
  });

  it('round-trips through export and import', () => {
    const state = emptyState();
    state.profile.weightKg = 82;
    dayOf(state, '2026-01-01').foods.push(entry('dal', 180));
    const restored = importJson(exportJson(state));
    expect(restored.error).toBeNull();
    expect(restored.state?.profile.weightKg).toBe(82);
    expect(restored.state?.days['2026-01-01']?.foods).toHaveLength(1);
  });

  it('rejects a file that is not an export', () => {
    expect(importJson('{{{').error).not.toBeNull();
    expect(importJson('[1,2,3]').error).not.toBeNull();
  });

  it('writes a CSV a spreadsheet can open', () => {
    const state = emptyState() as StoreState;
    dayOf(state, '2026-01-01').foods.push(entry('dal, tadka', 180));
    const csv = exportCsv(state);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('date,meal,item');
    expect(lines[1]).toContain('"dal, tadka"');
  });

  it('produces the series the maintenance estimator needs', () => {
    const state = emptyState();
    dayOf(state, '2026-01-02').foods.push(entry('dal', 500));
    (state.days['2026-01-02'] as DayLog).weightKg = 80;
    dayOf(state, '2026-01-01').weightKg = 81;
    const records = dailyRecords(state);
    expect(records.map((r) => r.date)).toEqual(['2026-01-01', '2026-01-02']);
    expect(records[1]?.intakeKcal).toBe(500);
    expect(records[0]?.intakeKcal).toBeUndefined();
  });
});
