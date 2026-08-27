import type { ActivityLevel, Goal, Nutrients, Profile } from './types.ts';

/**
 * Energy budgeting: what the body spends, and what to eat against it.
 *
 * Every formula here is a population average applied to one person, so it is
 * a starting point, not a measurement. The adaptive estimator in adaptive.ts
 * replaces it as soon as there is enough logged weight and intake to do better.
 */

/** Energy in one kilogram of body mass change. */
export const KCAL_PER_KG = 7700;

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  'very-active': 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Desk job, little walking',
  light: 'Light activity or 1-3 sessions a week',
  moderate: 'Moderate activity or 3-5 sessions a week',
  active: 'On your feet, or 6-7 sessions a week',
  'very-active': 'Physical job, or training twice a day',
};

/**
 * A sensible rate of change for a goal, in kg per week.
 *
 * Kept here rather than in each interface so that picking a goal cannot leave
 * a contradictory rate behind it — a bulk with a negative rate would quietly
 * prescribe a deficit.
 */
export function defaultRateFor(goal: Goal): number {
  if (goal === 'lose') return -0.5;
  if (goal === 'gain') return 0.25;
  return 0;
}

/** Mifflin-St Jeor. The default resting estimate. */
export function bmrMifflin(sex: 'male' | 'female', weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

/** Katch-McArdle. More accurate when body fat percentage is actually known. */
export function bmrKatch(weightKg: number, bodyFatPct: number): number {
  const leanMass = weightKg * (1 - bodyFatPct / 100);
  return 370 + 21.6 * leanMass;
}

export interface EnergyPlan {
  bmr: number;
  /** Maintenance calories from the activity multiplier. */
  tdee: number;
  /** The daily target after applying the goal. */
  target: number;
  /** Daily surplus or deficit against maintenance. Negative means a deficit. */
  adjustment: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  /** Which resting formula was used. */
  method: 'mifflin' | 'katch';
  warnings: string[];
}

/** The lowest intake worth recommending, below which a plan stops being safe. */
function floorFor(sex: 'male' | 'female', bmr: number): number {
  return Math.max(sex === 'male' ? 1500 : 1200, Math.round(bmr * 0.9));
}

/**
 * Macro split.
 *
 * Protein is set per kilogram of body weight rather than as a percentage of
 * calories, because the requirement tracks body mass, not appetite. A cut gets
 * more of it, since protein is what protects muscle when energy is short. Fat
 * is held at a fraction of intake with a floor for hormonal health, and carbs
 * take whatever is left — which in an Indian diet is most of the plate.
 */
export function macroTargets(goal: Goal, weightKg: number, target: number): Pick<Nutrients, 'protein' | 'carbs' | 'fat' | 'fiber'> {
  const proteinPerKg = goal === 'lose' ? 2 : goal === 'gain' ? 1.8 : 1.6;
  const protein = Math.round(weightKg * proteinPerKg);

  const fatFraction = goal === 'lose' ? 0.25 : 0.28;
  const fatFloor = Math.round(weightKg * 0.7);
  const fat = Math.max(fatFloor, Math.round((target * fatFraction) / 9));

  const remaining = target - protein * 4 - fat * 9;
  const carbs = Math.max(0, Math.round(remaining / 4));

  // 14 g of fibre per 1000 kcal, the usual public-health target.
  const fiber = Math.round((target / 1000) * 14);

  return { protein, carbs, fat, fiber };
}

/** Build a full daily plan from a profile. */
export function planFor(profile: Profile, maintenanceOverride?: number): EnergyPlan {
  const warnings: string[] = [];
  const useKatch = profile.bodyFatPct !== undefined && profile.bodyFatPct > 0;
  const bmr = useKatch
    ? bmrKatch(profile.weightKg, profile.bodyFatPct as number)
    : bmrMifflin(profile.sex, profile.weightKg, profile.heightCm, profile.age);

  const tdee = maintenanceOverride ?? bmr * ACTIVITY_FACTORS[profile.activity];

  // A rate pointing the other way to the goal is a mis-set profile, not an
  // instruction to eat the opposite of what was asked for.
  const stated = profile.rateKgPerWeek;
  const wrongWay = (profile.goal === 'lose' && stated > 0) || (profile.goal === 'gain' && stated < 0);
  const rate = profile.goal === 'maintain' || wrongWay ? defaultRateFor(profile.goal) : stated;
  if (wrongWay) {
    warnings.push(`Your goal is to ${profile.goal} but the rate was set the other way, so ${defaultRateFor(profile.goal)} kg a week was used instead.`);
  }
  let adjustment = (rate * KCAL_PER_KG) / 7;

  // A deficit steeper than about 1% of body weight a week costs muscle.
  const maxLossPerWeek = profile.weightKg * 0.01;
  if (rate < 0 && Math.abs(rate) > maxLossPerWeek) {
    warnings.push(
      `Losing ${Math.abs(rate).toFixed(2)} kg a week is faster than 1% of your body weight. Aim for ${maxLossPerWeek.toFixed(2)} kg or less to keep muscle.`,
    );
  }
  if (rate > 0.5) {
    warnings.push('Gaining faster than 0.5 kg a week mostly adds fat. Slower is better.');
  }

  let target = Math.round(tdee + adjustment);
  const floor = floorFor(profile.sex, bmr);
  if (target < floor) {
    warnings.push(`Target raised to ${floor} kcal: eating below that is not a good idea without supervision.`);
    target = floor;
    adjustment = target - tdee;
  }

  const macros = macroTargets(profile.goal, profile.weightKg, target);

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    target,
    adjustment: Math.round(adjustment),
    method: useKatch ? 'katch' : 'mifflin',
    warnings,
    ...macros,
  };
}

/** What is left of a day's budget after food and training. */
export interface DayBalance {
  target: number;
  eaten: number;
  burned: number;
  remaining: number;
  /** Projected weekly weight change if every day looked like this one. */
  projectedKgPerWeek: number;
}

export function balanceFor(plan: EnergyPlan, eaten: number, burnedNet: number): DayBalance {
  const remaining = plan.target + burnedNet - eaten;
  const surplus = eaten - burnedNet - plan.tdee;
  return {
    target: plan.target,
    eaten: Math.round(eaten),
    burned: Math.round(burnedNet),
    remaining: Math.round(remaining),
    projectedKgPerWeek: Math.round(((surplus * 7) / KCAL_PER_KG) * 100) / 100,
  };
}

/** How long a goal will take at the planned rate. */
export function weeksToGoal(currentKg: number, goalKg: number, rateKgPerWeek: number): number | null {
  if (rateKgPerWeek === 0) return null;
  const delta = goalKg - currentKg;
  if (Math.sign(delta) !== Math.sign(rateKgPerWeek)) return null;
  return Math.abs(delta / rateKgPerWeek);
}
