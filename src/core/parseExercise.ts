import { EXERCISES, type Exercise, getExercise, metForSpeed } from '../data/exercises.ts';
import { rank } from './match.ts';
import type { StrengthSet } from './types.ts';

/**
 * Turning "ran 5k in 27 min" or "bench press 3x8 at 60kg" into energy.
 *
 * Burn is `MET x 3.5 x kg / 200` kcal per minute. Two numbers come out of it:
 * gross, which is everything the body spent during the session, and net, which
 * subtracts the resting metabolism that would have been spent anyway. Net is
 * the honest number to credit against a daily calorie budget — gross double
 * counts the hour of basal metabolism already inside a TDEE estimate.
 */

export interface ParsedActivity {
  text: string;
  exerciseId: string | null;
  exerciseName: string;
  minutes: number;
  km?: number;
  /** Pace in km/h, when both distance and duration were given. */
  speedKmh?: number;
  met: number;
  kcalGross: number;
  kcalNet: number;
  sets?: StrengthSet[];
  /** Total weight moved, in kg, for a strength entry. */
  volumeKg?: number;
  confidence: number;
  notes: string[];
  unresolved: boolean;
}

const STEP_LENGTH_M = 0.762;

let candidates: { item: Exercise; names: string[] }[] | null = null;

function exerciseCandidates(): { item: Exercise; names: string[] }[] {
  if (!candidates) {
    candidates = EXERCISES.map((item) => ({ item, names: [item.name, ...item.aliases] }));
  }
  return candidates;
}

/** Read every duration mentioned, in minutes. */
export function parseDuration(text: string): number | null {
  const t = text.toLowerCase();
  let minutes = 0;
  let found = false;

  const hourMin = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(\d+)\s*(?:m|min|mins|minute|minutes)?\b/.exec(t);
  if (hourMin) {
    return Number(hourMin[1]) * 60 + Number(hourMin[2]);
  }

  const hours = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/.exec(t);
  if (hours) {
    minutes += Number(hours[1]) * 60;
    found = true;
  }
  const mins = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/.exec(t);
  if (mins) {
    minutes += Number(mins[1]);
    found = true;
  }
  if (/\bhalf an hour\b/.test(t)) return 30;
  if (/\ban hour\b/.test(t)) return 60;

  return found ? minutes : null;
}

/** Read a distance, in kilometres. */
export function parseDistance(text: string): number | null {
  const t = text.toLowerCase();

  const steps = /(\d[\d,]*)\s*steps\b/.exec(t);
  if (steps) {
    const count = Number((steps[1] as string).replace(/,/g, ''));
    return (count * STEP_LENGTH_M) / 1000;
  }
  const miles = /(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b/.exec(t);
  if (miles) return Number(miles[1]) * 1.609344;
  const metres = /(\d+(?:\.\d+)?)\s*(?:m|meters|metres)\b(?!in)/.exec(t);
  const km = /(\d+(?:\.\d+)?)\s*(?:k|km|kms|kilometre|kilometres|kilometer|kilometers)\b/.exec(t);
  if (km) return Number(km[1]);
  if (metres && Number(metres[1]) >= 100) return Number(metres[1]) / 1000;
  return null;
}

/** Read "3x8", "3 sets of 10", "4x12 @ 60kg". */
export function parseSets(text: string): { sets: StrengthSet[]; weightKg: number } | null {
  const t = text.toLowerCase();
  const weightMatch = /(?:@|at\s+|with\s+)?(\d+(?:\.\d+)?)\s*(kg|kgs|lb|lbs|pounds)\b/.exec(t);
  const weightKg = weightMatch
    ? Number(weightMatch[1]) * (/lb|pound/.test(weightMatch[2] as string) ? 0.45359237 : 1)
    : 0;

  const cross = /(\d+)\s*(?:x|\*)\s*(\d+)/.exec(t);
  if (cross) {
    const count = Number(cross[1]);
    const reps = Number(cross[2]);
    return { sets: Array.from({ length: count }, () => ({ reps, weightKg })), weightKg };
  }

  const written = /(\d+)\s*sets?\s*(?:of|x)?\s*(\d+)/.exec(t);
  if (written) {
    const count = Number(written[1]);
    const reps = Number(written[2]);
    return { sets: Array.from({ length: count }, () => ({ reps, weightKg })), weightKg };
  }
  return null;
}

/** kcal per minute at a given MET for a given body weight. */
export function kcalPerMinute(met: number, weightKg: number): number {
  return (met * 3.5 * weightKg) / 200;
}

/** Split a line into one fragment per activity. */
export function splitActivities(input: string): string[] {
  return input
    .split(/\s*(?:,|;|\r?\n|\band then\b|\band\b|\+)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * The name of the activity, with the numbers taken out so that "45" or "5k"
 * cannot be mistaken for part of the exercise name.
 */
function nameOnly(fragment: string): string {
  return fragment
    .toLowerCase()
    .replace(/\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes|k|km|kms|mi|mile|miles|kg|kgs|lb|lbs|steps|sets?|reps?)\b/g, ' ')
    .replace(/\d+\s*(?:x|\*)\s*\d+/g, ' ')
    .replace(/[@]/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\bfor\b|\bin\b|\bat\b|\bof\b|\bdid\b|\bdone\b|\btoday\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse one activity fragment against a body weight. */
export function parseActivity(fragment: string, weightKg: number): ParsedActivity {
  const notes: string[] = [];
  const phrase = nameOnly(fragment);
  const matches = rank(phrase || fragment, exerciseCandidates(), 3);
  const best = matches[0];

  if (!best || best.score < 0.5) {
    return {
      text: fragment.trim(),
      exerciseId: null,
      exerciseName: phrase || fragment.trim(),
      minutes: 0,
      met: 0,
      kcalGross: 0,
      kcalNet: 0,
      confidence: best?.score ?? 0,
      notes: [`No activity in the table looks like "${phrase || fragment.trim()}".`],
      unresolved: true,
    };
  }

  const exercise = best.item;
  const duration = parseDuration(fragment);
  const distance = parseDistance(fragment);
  const strength = exercise.kind === 'strength' ? parseSets(fragment) : null;

  let minutes = duration ?? 0;
  let met = exercise.met;
  let speedKmh: number | undefined;

  if (duration !== null && distance !== null && duration > 0) {
    speedKmh = distance / (duration / 60);
    met = metForSpeed(exercise, speedKmh);
    notes.push(`${distance.toFixed(2)} km in ${minutes} min is ${speedKmh.toFixed(1)} km/h, which is ${met.toFixed(1)} METs`);
  } else if (distance !== null && exercise.typicalSpeed) {
    minutes = (distance / exercise.typicalSpeed) * 60;
    met = metForSpeed(exercise, exercise.typicalSpeed);
    notes.push(`no time given, so ${distance.toFixed(2)} km was costed at a typical ${exercise.typicalSpeed} km/h (${minutes.toFixed(0)} min)`);
  } else if (duration === null) {
    if (strength) {
      // Roughly three minutes per set, including the rest between them.
      minutes = strength.sets.length * 3;
      notes.push(`no time given, so ${strength.sets.length} sets were costed at 3 min each`);
    } else {
      minutes = exercise.defaultMinutes;
      notes.push(`no time given, so a typical ${exercise.defaultMinutes} min session was assumed`);
    }
  }

  if (strength && strength.weightKg > 0) {
    // Heavy work costs more than a light warm-up circuit.
    met = strength.weightKg >= weightKg * 0.75 ? 6 : 5;
  }

  const perMinute = kcalPerMinute(met, weightKg);
  const kcalGross = perMinute * minutes;
  const kcalNet = kcalPerMinute(Math.max(met - 1, 0), weightKg) * minutes;

  const volumeKg = strength
    ? strength.sets.reduce((sum, set) => sum + set.reps * set.weightKg, 0)
    : undefined;
  if (volumeKg !== undefined && volumeKg > 0) {
    notes.push(`${strength?.sets.length} sets moved ${Math.round(volumeKg)} kg in total`);
  }

  const result: ParsedActivity = {
    text: fragment.trim(),
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    minutes: Math.round(minutes),
    met: Math.round(met * 10) / 10,
    kcalGross: Math.round(kcalGross),
    kcalNet: Math.round(kcalNet),
    confidence: best.score,
    notes,
    unresolved: false,
  };
  if (distance !== null) result.km = Math.round(distance * 100) / 100;
  if (speedKmh !== undefined) result.speedKmh = Math.round(speedKmh * 10) / 10;
  if (strength) {
    result.sets = strength.sets;
    if (volumeKg !== undefined) result.volumeKg = Math.round(volumeKg);
  }
  return result;
}

export interface ParsedActivityLine {
  activities: ParsedActivity[];
  totalMinutes: number;
  totalKcalNet: number;
  totalKcalGross: number;
}

/** Parse a whole line of training. */
export function parseActivityLine(input: string, weightKg: number): ParsedActivityLine {
  const activities = splitActivities(input).map((fragment) => parseActivity(fragment, weightKg));
  return {
    activities,
    totalMinutes: activities.reduce((sum, a) => sum + a.minutes, 0),
    totalKcalNet: activities.reduce((sum, a) => sum + a.kcalNet, 0),
    totalKcalGross: activities.reduce((sum, a) => sum + a.kcalGross, 0),
  };
}

/** Recompute an activity after the duration is corrected by hand. */
export function recalculateActivity(exerciseId: string, minutes: number, met: number, weightKg: number): {
  kcalGross: number;
  kcalNet: number;
} {
  const exercise = getExercise(exerciseId);
  const useMet = met > 0 ? met : exercise?.met ?? 1;
  return {
    kcalGross: Math.round(kcalPerMinute(useMet, weightKg) * minutes),
    kcalNet: Math.round(kcalPerMinute(Math.max(useMet - 1, 0), weightKg) * minutes),
  };
}
