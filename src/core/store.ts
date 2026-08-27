import type { DailyRecord } from './adaptive.ts';
import {
  type ActivityEntry,
  type DayLog,
  type FoodEntry,
  type Profile,
  type Nutrients,
  ZERO,
  addNutrients,
} from './types.ts';

/**
 * Persistence.
 *
 * Everything lives in this browser's localStorage and nowhere else. There is
 * no account, no server and no network call anywhere in this app, which is why
 * a food diary — one of the more personal things a person keeps — can be used
 * without deciding whether to trust anyone with it. The cost is that clearing
 * site data deletes the log, so export is a first-class feature, not a
 * settings-page afterthought.
 */

export const STORAGE_KEY = 'ai-calorie-tracker/v1';
export const SCHEMA_VERSION = 1;

export interface StoreState {
  version: number;
  profile: Profile;
  /** Keyed by ISO date. */
  days: Record<string, DayLog>;
}

export const DEFAULT_PROFILE: Profile = {
  name: '',
  sex: 'male',
  age: 25,
  heightCm: 172,
  weightKg: 70,
  activity: 'light',
  goal: 'lose',
  rateKgPerWeek: -0.5,
  diet: 'vegetarian',
  units: 'metric',
  trainingDays: 3,
  equipment: ['none'],
};

export function today(now: Date = new Date()): string {
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function emptyDay(date: string): DayLog {
  return { date, foods: [], activities: [] };
}

export function emptyState(): StoreState {
  return { version: SCHEMA_VERSION, profile: { ...DEFAULT_PROFILE }, days: {} };
}

/** Accept anything shaped roughly right, fill in the rest. */
export function migrate(raw: unknown): StoreState {
  const state = emptyState();
  if (typeof raw !== 'object' || raw === null) return state;
  const candidate = raw as Partial<StoreState>;

  if (candidate.profile && typeof candidate.profile === 'object') {
    state.profile = { ...DEFAULT_PROFILE, ...candidate.profile };
    if (!Array.isArray(state.profile.equipment) || state.profile.equipment.length === 0) {
      state.profile.equipment = ['none'];
    }
  }
  if (candidate.days && typeof candidate.days === 'object') {
    for (const [date, day] of Object.entries(candidate.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof day !== 'object' || day === null) continue;
      const partial = day as Partial<DayLog>;
      state.days[date] = {
        date,
        foods: Array.isArray(partial.foods) ? (partial.foods as FoodEntry[]) : [],
        activities: Array.isArray(partial.activities) ? (partial.activities as ActivityEntry[]) : [],
        ...(typeof partial.weightKg === 'number' ? { weightKg: partial.weightKg } : {}),
        ...(typeof partial.note === 'string' ? { note: partial.note } : {}),
      };
    }
  }
  return state;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Private windows and blocked-cookie settings throw on access.
    return null;
  }
}

export function load(): StoreState {
  const store = storage();
  if (!store) return emptyState();
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return migrate(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

export function save(state: StoreState): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Get a day, creating it in the state if it is not there yet. */
export function dayOf(state: StoreState, date: string): DayLog {
  const existing = state.days[date];
  if (existing) return existing;
  const created = emptyDay(date);
  state.days[date] = created;
  return created;
}

export function totalsFor(day: DayLog): Nutrients {
  return day.foods.reduce((acc, entry) => addNutrients(acc, entry.nutrients), { ...ZERO });
}

export function burnedNet(day: DayLog): number {
  return day.activities.reduce((sum, entry) => sum + entry.kcalNet, 0);
}

export function trainingMinutes(day: DayLog): number {
  return day.activities.reduce((sum, entry) => sum + entry.minutes, 0);
}

/** The series the adaptive estimator needs. */
export function dailyRecords(state: StoreState): DailyRecord[] {
  return Object.values(state.days)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      const eaten = totalsFor(day).kcal;
      return {
        date: day.date,
        ...(typeof day.weightKg === 'number' ? { weightKg: day.weightKg } : {}),
        ...(eaten > 0 ? { intakeKcal: eaten } : {}),
      };
    });
}

/** A short, sortable id that does not need a library. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function exportJson(state: StoreState): string {
  return JSON.stringify(state, null, 2);
}

export interface ImportResult {
  state: StoreState | null;
  error: string | null;
}

export function importJson(text: string): ImportResult {
  try {
    const parsed = JSON.parse(text);
    const state = migrate(parsed);
    if (Object.keys(state.days).length === 0 && !parsed?.profile) {
      return { state: null, error: 'That file has no log or profile in it.' };
    }
    return { state, error: null };
  } catch {
    return { state: null, error: 'That does not look like a valid export file.' };
  }
}

/** Export the log as a spreadsheet-friendly table. */
export function exportCsv(state: StoreState): string {
  const rows: string[] = ['date,meal,item,amount,grams,kcal,protein_g,carbs_g,fat_g,fiber_g'];
  const escape = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  for (const day of Object.values(state.days).sort((a, b) => a.date.localeCompare(b.date))) {
    for (const food of day.foods) {
      rows.push([
        day.date,
        food.meal,
        escape(food.foodName),
        escape(food.amountLabel),
        String(food.grams),
        String(food.nutrients.kcal),
        String(food.nutrients.protein),
        String(food.nutrients.carbs),
        String(food.nutrients.fat),
        String(food.nutrients.fiber),
      ].join(','));
    }
  }
  return rows.join('\n');
}
