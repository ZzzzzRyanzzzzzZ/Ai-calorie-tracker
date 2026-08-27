/** Energy and macronutrients. Grams unless stated otherwise. */
export interface Nutrients {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

/**
 * One food in the database. Composition is always stored per 100 g of the food
 * *as eaten* — a curry is stored cooked, not as its dry ingredients — because
 * that is the only weight a person can reasonably estimate.
 */
export interface Food {
  id: string;
  name: string;
  /** Alternate spellings, regional names and common transliterations. */
  aliases: string[];
  per100g: Nutrients;
  /** Grams in one of the item, when the food is naturally counted ("2 rotis"). */
  each?: number;
  /** Grams for named household measures, e.g. { katori: 150, plate: 300 }. */
  portions?: Record<string, number>;
  /** Grams per millilitre, for foods logged by volume. */
  density?: number;
  tags: string[];
}

export type Sex = 'male' | 'female';
export type UnitSystem = 'metric' | 'imperial';

export type ActivityLevel =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very-active';

export type Goal = 'lose' | 'maintain' | 'gain';

export type DietPreference = 'vegetarian' | 'eggetarian' | 'non-vegetarian' | 'vegan';

export interface Profile {
  name: string;
  sex: Sex;
  /** Years. */
  age: number;
  /** Centimetres. */
  heightCm: number;
  /** Kilograms — the most recent logged weight, or the starting weight. */
  weightKg: number;
  /** Percent, optional; enables the Katch-McArdle estimate. */
  bodyFatPct?: number;
  activity: ActivityLevel;
  goal: Goal;
  /** Desired rate of change in kg per week. Positive = gain, negative = loss. */
  rateKgPerWeek: number;
  diet: DietPreference;
  units: UnitSystem;
  /** Days per week the person is willing to train. */
  trainingDays: number;
  /** Equipment on hand, used by the coach. */
  equipment: Equipment[];
}

export type Equipment = 'none' | 'dumbbells' | 'barbell' | 'machines' | 'bands' | 'pullup-bar';

/** A single resolved food entry in a day's log. */
export interface FoodEntry {
  id: string;
  /** Exactly what the person typed for this item. */
  text: string;
  foodId: string;
  foodName: string;
  grams: number;
  /** How the amount was expressed, e.g. "2 roti" or "1 katori". */
  amountLabel: string;
  nutrients: Nutrients;
  /** 0-1. How sure the matcher is that this is the right food. */
  confidence: number;
  meal: MealSlot;
  at: string;
}

export type MealSlot = 'breakfast' | 'lunch' | 'snack' | 'dinner';

/** A single logged activity. */
export interface ActivityEntry {
  id: string;
  text: string;
  exerciseId: string;
  exerciseName: string;
  minutes: number;
  /** Kilometres, when the activity was logged with a distance. */
  km?: number;
  met: number;
  /** Total energy cost including the resting metabolism it replaces. */
  kcalGross: number;
  /** Energy above resting — the honest number to add to a daily budget. */
  kcalNet: number;
  sets?: StrengthSet[];
  at: string;
}

export interface StrengthSet {
  reps: number;
  weightKg: number;
}

/** Everything logged on one calendar day. */
export interface DayLog {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  foods: FoodEntry[];
  activities: ActivityEntry[];
  /** Morning weight in kg, if taken. */
  weightKg?: number;
  note?: string;
}

export const ZERO: Nutrients = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
    fiber: a.fiber + b.fiber,
  };
}

export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  return {
    kcal: n.kcal * factor,
    protein: n.protein * factor,
    carbs: n.carbs * factor,
    fat: n.fat * factor,
    fiber: n.fiber * factor,
  };
}

export function sumNutrients(list: Nutrients[]): Nutrients {
  return list.reduce(addNutrients, ZERO);
}

export function roundNutrients(n: Nutrients): Nutrients {
  return {
    kcal: Math.round(n.kcal),
    protein: Math.round(n.protein * 10) / 10,
    carbs: Math.round(n.carbs * 10) / 10,
    fat: Math.round(n.fat * 10) / 10,
    fiber: Math.round(n.fiber * 10) / 10,
  };
}
