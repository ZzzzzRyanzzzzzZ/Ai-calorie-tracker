import { estimateMaintenance } from '../core/adaptive.ts';
import { coach } from '../core/coach.ts';
import { balanceFor, planFor } from '../core/energy.ts';
import { describeDay, describeEntry, kcalOf, suggestItems } from '../core/history.ts';
import { matchFood } from '../core/match.ts';
import { mealForHour, parseFoodLine } from '../core/parseFood.ts';
import { parseActivityLine } from '../core/parseExercise.ts';
import { burnedNet, dailyRecords, dayOf, newId, totalsFor, type StoreState } from '../core/store.ts';
import type { ActivityEntry, Equipment, FoodEntry, MealSlot, Profile } from '../core/types.ts';

/**
 * What the assistant is allowed to do, and how it does it.
 *
 * The important rule here: **the model never supplies a number**. It reads the
 * sentence and decides which tool to call, and the tool then runs the same
 * local parser and the same food table the rest of the app uses. So "I had two
 * rotis and dal" is costed by the database, not guessed by a language model.
 * The model is the interface; the arithmetic stays offline and deterministic.
 *
 * Every tool is a pure function of the store plus its arguments, which is what
 * makes them testable without a network or a browser.
 */

export interface ToolContext {
  state: StoreState;
  today: string;
  /** Hour of day, used to guess which meal an entry belongs to. */
  hour: number;
}

export interface ToolResult {
  ok: boolean;
  /** A sentence the model can read back to the person. */
  summary: string;
  data?: Record<string, unknown>;
  /** True when the tool changed the log and the app should re-render and save. */
  mutated: boolean;
}

type Args = Record<string, unknown>;

function str(args: Args, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function num(args: Args, key: string): number | undefined {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/** Accept "today", "yesterday" or an ISO date, and refuse anything else. */
export function resolveDate(input: string | undefined, today: string): string {
  if (!input) return today;
  const value = input.trim().toLowerCase();
  if (value === 'today') return today;
  const dayMs = 86_400_000;
  if (value === 'yesterday') {
    return new Date(Date.parse(`${today}T00:00:00Z`) - dayMs).toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return today;
}

const MEALS: MealSlot[] = ['breakfast', 'lunch', 'snack', 'dinner'];

function resolveMeal(input: string | undefined, hour: number): MealSlot {
  const value = (input ?? '').trim().toLowerCase() as MealSlot;
  return MEALS.includes(value) ? value : mealForHour(hour);
}

/* ------------------------------------------------------------------ tools */

function logFood(args: Args, ctx: ToolContext): ToolResult {
  const description = str(args, 'description');
  if (!description) {
    return { ok: false, mutated: false, summary: 'No food was described, so nothing was logged.' };
  }
  const date = resolveDate(str(args, 'date'), ctx.today);
  const parsed = parseFoodLine(description);
  const meal = resolveMeal(str(args, 'meal') ?? parsed.meal ?? undefined, ctx.hour);
  const day = dayOf(ctx.state, date);

  const added: FoodEntry[] = [];
  for (const item of parsed.items) {
    if (item.unresolved || !item.foodId) continue;
    const entry: FoodEntry = {
      id: newId(),
      text: item.text,
      foodId: item.foodId,
      foodName: item.foodName,
      grams: item.grams,
      amountLabel: item.amountLabel,
      nutrients: item.nutrients,
      confidence: item.confidence,
      meal,
      at: new Date().toISOString(),
    };
    day.foods.push(entry);
    added.push(entry);
  }

  const missed = parsed.items.filter((item) => item.unresolved).map((item) => item.text);
  if (added.length === 0) {
    return {
      ok: false,
      mutated: false,
      summary: `Nothing in "${description}" matched the food table${missed.length ? `: ${missed.join(', ')}` : ''}.`,
      data: { unrecognised: missed },
    };
  }

  const kcal = kcalOf(added);
  return {
    ok: true,
    mutated: true,
    summary: `Logged to ${meal} on ${date}: ${added.map((e) => `${describeEntry(e)} (${e.nutrients.kcal} kcal)`).join(', ')}. `
      + `That is ${kcal} kcal.${missed.length ? ` Could not identify: ${missed.join(', ')}.` : ''}`,
    data: {
      kcal,
      items: added.map((e) => ({ food: e.foodName, grams: e.grams, kcal: e.nutrients.kcal })),
      unrecognised: missed,
    },
  };
}

function logTraining(args: Args, ctx: ToolContext): ToolResult {
  const description = str(args, 'description');
  if (!description) {
    return { ok: false, mutated: false, summary: 'No activity was described, so nothing was logged.' };
  }
  const date = resolveDate(str(args, 'date'), ctx.today);
  const day = dayOf(ctx.state, date);
  const weight = day.weightKg ?? ctx.state.profile.weightKg;
  const parsed = parseActivityLine(description, weight);

  const added: ActivityEntry[] = [];
  for (const activity of parsed.activities) {
    if (activity.unresolved || !activity.exerciseId) continue;
    const entry: ActivityEntry = {
      id: newId(),
      text: activity.text,
      exerciseId: activity.exerciseId,
      exerciseName: activity.exerciseName,
      minutes: activity.minutes,
      met: activity.met,
      kcalGross: activity.kcalGross,
      kcalNet: activity.kcalNet,
      at: new Date().toISOString(),
      ...(activity.km !== undefined ? { km: activity.km } : {}),
      ...(activity.sets ? { sets: activity.sets } : {}),
    };
    day.activities.push(entry);
    added.push(entry);
  }

  if (added.length === 0) {
    return { ok: false, mutated: false, summary: `No activity in "${description}" matched the exercise table.` };
  }

  const kcal = added.reduce((sum, entry) => sum + entry.kcalNet, 0);
  return {
    ok: true,
    mutated: true,
    summary: `Logged on ${date}: ${added.map((e) => `${e.minutes} min ${e.exerciseName.toLowerCase()}`).join(', ')}, `
      + `about ${kcal} kcal above resting.`,
    data: { kcalNet: kcal, minutes: added.reduce((s, e) => s + e.minutes, 0) },
  };
}

function setWeight(args: Args, ctx: ToolContext): ToolResult {
  const kg = num(args, 'kg');
  if (kg === undefined || kg <= 20 || kg > 400) {
    return { ok: false, mutated: false, summary: 'That is not a believable body weight in kilograms.' };
  }
  const date = resolveDate(str(args, 'date'), ctx.today);
  const rounded = Math.round(kg * 10) / 10;
  dayOf(ctx.state, date).weightKg = rounded;
  if (date === ctx.today) ctx.state.profile.weightKg = rounded;
  return { ok: true, mutated: true, summary: `Recorded ${rounded} kg for ${date}.`, data: { weightKg: rounded } };
}

const EQUIPMENT: Equipment[] = ['none', 'dumbbells', 'barbell', 'machines', 'bands', 'pullup-bar'];

function updateProfile(args: Args, ctx: ToolContext): ToolResult {
  const profile = ctx.state.profile;
  const changes: string[] = [];

  const goal = str(args, 'goal');
  if (goal === 'lose' || goal === 'maintain' || goal === 'gain') {
    profile.goal = goal;
    changes.push(`goal is now to ${goal}`);
  }
  const rate = num(args, 'rate_kg_per_week');
  if (rate !== undefined && Math.abs(rate) <= 2) {
    profile.rateKgPerWeek = rate;
    changes.push(`rate is now ${rate} kg a week`);
  }
  const days = num(args, 'training_days');
  if (days !== undefined && days >= 0 && days <= 7) {
    profile.trainingDays = Math.round(days);
    changes.push(`training ${Math.round(days)} days a week`);
  }
  const level = str(args, 'level');
  if (level && ['beginner', 'intermediate', 'advanced'].includes(level)) {
    profile.level = level as Profile['level'];
    changes.push(`training level is now ${level}`);
  }
  const emphasis = str(args, 'emphasis');
  if (emphasis && ['balanced', 'abs', 'arms', 'chest', 'back', 'shoulders', 'legs', 'glutes'].includes(emphasis)) {
    profile.emphasis = emphasis as Profile['emphasis'];
    changes.push(`the programme now emphasises ${emphasis}`);
  }
  const volume = num(args, 'volume_bias');
  if (volume !== undefined && volume >= -1 && volume <= 2) {
    profile.volumeBias = Math.round(volume);
    changes.push(`volume bias is now ${Math.round(volume)}`);
  }
  const activity = str(args, 'activity');
  if (activity && ['sedentary', 'light', 'moderate', 'active', 'very-active'].includes(activity)) {
    profile.activity = activity as Profile['activity'];
    changes.push(`daily activity is now ${activity}`);
  }
  const diet = str(args, 'diet');
  if (diet && ['vegetarian', 'eggetarian', 'non-vegetarian', 'vegan'].includes(diet)) {
    profile.diet = diet as Profile['diet'];
    changes.push(`diet is now ${diet}`);
  }
  const equipmentRaw = args['equipment'];
  if (Array.isArray(equipmentRaw)) {
    const cleaned = equipmentRaw.filter((e): e is Equipment => EQUIPMENT.includes(e as Equipment));
    if (cleaned.length > 0) {
      profile.equipment = cleaned;
      changes.push(`equipment is now ${cleaned.join(', ')}`);
    }
  }
  for (const [key, field] of [['age', 'age'], ['height_cm', 'heightCm'], ['weight_kg', 'weightKg']] as const) {
    const value = num(args, key);
    if (value !== undefined && value > 0) {
      (profile as unknown as Record<string, number>)[field] = value;
      changes.push(`${key.replace(/_/g, ' ')} is now ${value}`);
    }
  }

  if (changes.length === 0) {
    return { ok: false, mutated: false, summary: 'Nothing in that was a profile setting I can change.' };
  }
  return { ok: true, mutated: true, summary: `Updated: ${changes.join('; ')}.`, data: { profile } };
}

function getDay(args: Args, ctx: ToolContext): ToolResult {
  const date = resolveDate(str(args, 'date'), ctx.today);
  const day = dayOf(ctx.state, date);
  const { active } = currentPlan(ctx);
  const totals = totalsFor(day);
  const burned = burnedNet(day);
  const balance = balanceFor(active, totals.kcal, burned);

  return {
    ok: true,
    mutated: false,
    summary: `On ${date} you ${describeDay(day)}. That is ${totals.kcal} kcal against a target of ${active.target}, `
      + `so ${balance.remaining >= 0 ? `${balance.remaining} kcal left` : `${Math.abs(balance.remaining)} kcal over`}.`,
    data: {
      date,
      eaten: totals.kcal,
      target: active.target,
      remaining: balance.remaining,
      protein: totals.protein,
      proteinTarget: active.protein,
      carbs: totals.carbs,
      fat: totals.fat,
      fiber: totals.fiber,
      trainingKcalNet: burned,
      weightKg: day.weightKg ?? null,
    },
  };
}

function currentPlan(ctx: ToolContext) {
  const formula = planFor(ctx.state.profile);
  const estimate = estimateMaintenance(dailyRecords(ctx.state), formula.tdee, 42, formula.bmr);
  const usable = estimate.confidence !== 'none' && !estimate.underReported;
  const active = usable ? planFor(ctx.state.profile, estimate.maintenance ?? formula.tdee) : formula;
  return { active, estimate, formula };
}

function getPlan(_args: Args, ctx: ToolContext): ToolResult {
  const { active, estimate } = currentPlan(ctx);
  return {
    ok: true,
    mutated: false,
    summary: `Resting ${active.bmr} kcal, maintenance ${active.tdee} kcal, daily target ${active.target} kcal `
      + `with ${active.protein} g protein. ${estimate.explanation.join(' ')}`,
    data: {
      bmr: active.bmr,
      maintenance: active.tdee,
      target: active.target,
      protein: active.protein,
      carbs: active.carbs,
      fat: active.fat,
      fiber: active.fiber,
      measuredMaintenance: estimate.measured,
      confidence: estimate.confidence,
      trendKgPerWeek: estimate.trendKgPerWeek,
      underReported: estimate.underReported,
      warnings: active.warnings,
    },
  };
}

function getWorkout(args: Args, ctx: ToolContext): ToolResult {
  const date = resolveDate(str(args, 'date'), ctx.today);
  const plan = coach(ctx.state.profile, Object.values(ctx.state.days), date);
  if (plan.todayIsRest || !plan.today) {
    return {
      ok: true,
      mutated: false,
      summary: `${date} is a rest day. ${plan.todayReason}`,
      data: { rest: true, reason: plan.todayReason, insights: plan.insights.map((i) => i.text) },
    };
  }
  const blocks = plan.today.blocks.map((b) => `${b.movement.name} ${b.sets} x ${b.reps}`);
  return {
    ok: true,
    mutated: false,
    summary: `${plan.today.name} (${plan.today.focus}), about ${plan.today.estimatedMinutes} minutes: ${blocks.join('; ')}.`,
    data: {
      rest: false,
      name: plan.today.name,
      minutes: plan.today.estimatedMinutes,
      blocks: plan.today.blocks.map((b) => ({
        movement: b.movement.name, sets: b.sets, reps: b.reps, rest: b.restSeconds, cue: b.note,
      })),
      cardio: plan.cardio,
      insights: plan.insights.map((i) => `${i.level}: ${i.text}`),
    },
  };
}

function searchFood(args: Args, _ctx: ToolContext): ToolResult {
  const query = str(args, 'query');
  if (!query) return { ok: false, mutated: false, summary: 'No search term was given.' };
  const matches = matchFood(query, 6).filter((m) => m.score > 0.35);
  if (matches.length === 0) {
    return { ok: false, mutated: false, summary: `Nothing in the food table looks like "${query}".` };
  }
  return {
    ok: true,
    mutated: false,
    summary: `Closest matches for "${query}": ${matches.map((m) => `${m.item.name} (${m.item.per100g.kcal} kcal per 100 g)`).join(', ')}.`,
    data: {
      matches: matches.map((m) => ({
        id: m.item.id, name: m.item.name, per100g: m.item.per100g, each: m.item.each ?? null,
      })),
    },
  };
}

function removeLastFood(_args: Args, ctx: ToolContext): ToolResult {
  const day = dayOf(ctx.state, ctx.today);
  const removed = day.foods.pop();
  if (!removed) return { ok: false, mutated: false, summary: 'There is nothing logged today to remove.' };
  return { ok: true, mutated: true, summary: `Removed ${describeEntry(removed)} from today.` };
}

function suggestUsual(args: Args, ctx: ToolContext): ToolResult {
  const meal = str(args, 'meal') as MealSlot | undefined;
  const suggestions = suggestItems(ctx.state, ctx.today, { ...(meal ? { meal } : {}), limit: 8 });
  if (suggestions.length === 0) {
    return { ok: false, mutated: false, summary: 'There is not enough history yet to know what they usually eat.' };
  }
  return {
    ok: true,
    mutated: false,
    summary: `Usual portions: ${suggestions.map((s) => `${describeEntry(s)} (logged ${s.count} times)`).join(', ')}.`,
    data: { suggestions: suggestions.map((s) => ({ food: s.foodName, amount: s.amountLabel, count: s.count, kcal: s.nutrients.kcal })) },
  };
}

const HANDLERS: Record<string, (args: Args, ctx: ToolContext) => ToolResult> = {
  log_food: logFood,
  log_training: logTraining,
  set_weight: setWeight,
  update_profile: updateProfile,
  get_day: getDay,
  get_plan: getPlan,
  get_workout: getWorkout,
  search_food: searchFood,
  remove_last_food: removeLastFood,
  suggest_usual: suggestUsual,
};

export function runTool(name: string, args: Args, ctx: ToolContext): ToolResult {
  const handler = HANDLERS[name];
  if (!handler) return { ok: false, mutated: false, summary: `There is no tool called ${name}.` };
  try {
    return handler(args ?? {}, ctx);
  } catch (error) {
    return { ok: false, mutated: false, summary: `That failed: ${(error as Error).message}` };
  }
}

export function toolNames(): string[] {
  return Object.keys(HANDLERS);
}

/* ------------------------------------------- declarations sent to the model */

const DATE_ARG = {
  type: 'STRING',
  description: 'Which day, as "today", "yesterday" or YYYY-MM-DD. Defaults to today.',
};

export const TOOL_DECLARATIONS = [
  {
    name: 'log_food',
    description:
      'Record something the person ate. Pass their own words verbatim, including amounts and units, '
      + 'for example "2 rotis, a katori of dal and half a bowl of rice". The app looks the nutrition up '
      + 'in its own database, so never estimate calories yourself and never convert to grams first.',
    parameters: {
      type: 'OBJECT',
      properties: {
        description: { type: 'STRING', description: 'What they ate, in their own words, with amounts.' },
        meal: { type: 'STRING', description: 'breakfast, lunch, snack or dinner. Defaults to the time of day.' },
        date: DATE_ARG,
      },
      required: ['description'],
    },
  },
  {
    name: 'log_training',
    description:
      'Record exercise. Pass their words verbatim, for example "ran 5k in 27 min" or '
      + '"45 min gym, squats 5x5 at 60kg". The app works out METs and calories itself.',
    parameters: {
      type: 'OBJECT',
      properties: {
        description: { type: 'STRING', description: 'What they did, in their own words, with duration or distance.' },
        date: DATE_ARG,
      },
      required: ['description'],
    },
  },
  {
    name: 'set_weight',
    description: 'Record a body weight in kilograms for a day.',
    parameters: {
      type: 'OBJECT',
      properties: { kg: { type: 'NUMBER', description: 'Body weight in kilograms.' }, date: DATE_ARG },
      required: ['kg'],
    },
  },
  {
    name: 'update_profile',
    description:
      'Change the settings a plan is built from. Only pass the fields being changed. '
      + 'Confirm with the person before changing a goal or a rate.',
    parameters: {
      type: 'OBJECT',
      properties: {
        goal: { type: 'STRING', description: 'lose, maintain or gain.' },
        rate_kg_per_week: { type: 'NUMBER', description: 'Target rate of change; negative to lose.' },
        training_days: { type: 'NUMBER', description: 'Days a week they will train, 0 to 7.' },
        level: {
          type: 'STRING',
          description: 'How experienced a lifter they are: beginner, intermediate or advanced. '
            + 'Set this when they say the programme is too easy or too hard for them.',
        },
        emphasis: {
          type: 'STRING',
          description: 'A body part to give extra work to: balanced, abs, arms, chest, back, shoulders, legs or glutes. '
            + 'Set it when they say they want to focus on something, e.g. "I want abs".',
        },
        volume_bias: {
          type: 'NUMBER',
          description: 'Extra working sets per exercise, -1 to 2. Use -1 when they are short of time.',
        },
        activity: { type: 'STRING', description: 'sedentary, light, moderate, active or very-active.' },
        diet: { type: 'STRING', description: 'vegetarian, eggetarian, non-vegetarian or vegan.' },
        equipment: {
          type: 'ARRAY',
          description: 'Equipment available: none, dumbbells, barbell, machines, bands, pullup-bar.',
          items: { type: 'STRING' },
        },
        age: { type: 'NUMBER', description: 'Age in years.' },
        height_cm: { type: 'NUMBER', description: 'Height in centimetres.' },
        weight_kg: { type: 'NUMBER', description: 'Current body weight in kilograms.' },
      },
    },
  },
  {
    name: 'get_day',
    description: 'Read what has been logged on a day: calories eaten, macros, training and how much budget is left.',
    parameters: { type: 'OBJECT', properties: { date: DATE_ARG } },
  },
  {
    name: 'get_plan',
    description:
      'Read their calorie target, macro targets and maintenance estimate, including whether maintenance '
      + 'has been measured from their own log yet.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_workout',
    description: 'Read the training session prescribed for a day, or find out that it is a rest day.',
    parameters: { type: 'OBJECT', properties: { date: DATE_ARG } },
  },
  {
    name: 'search_food',
    description:
      'Look a food up in the database without logging it, to check what it is called or what it contains.',
    parameters: {
      type: 'OBJECT',
      properties: { query: { type: 'STRING', description: 'The food to look for.' } },
      required: ['query'],
    },
  },
  {
    name: 'remove_last_food',
    description: 'Undo the most recent food logged today, for when something was recorded by mistake.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'suggest_usual',
    description: 'List the portions this person logs most often, to offer them as quick options.',
    parameters: {
      type: 'OBJECT',
      properties: { meal: { type: 'STRING', description: 'breakfast, lunch, snack or dinner.' } },
    },
  },
];
