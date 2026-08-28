import { MOVEMENTS, type Movement, type Pattern, SPLITS, type SessionTemplate } from '../data/workouts.ts';
import { getExercise } from '../data/exercises.ts';
import type { ActivityEntry, DayLog, Emphasis, Equipment, Goal, Profile, TrainingLevel } from './types.ts';

/**
 * The coach: what to actually do today.
 *
 * Tracking calories tells you what happened. This decides what happens next.
 * It picks a weekly split from how many days someone will train, fills each
 * session with the best movement available for each pattern given their
 * equipment, sets reps and sets from the goal, and then looks at what has
 * actually been logged to catch the two mistakes everyone makes: skipping the
 * thing they dislike, and never taking a rest day.
 */

export interface PrescribedSet {
  movement: Movement;
  sets: number;
  /** "8-12", or "30-45 s" for a held position. */
  reps: string;
  restSeconds: number;
  note: string;
  /**
   * Rate of perceived exertion to finish each set on, 1-10, where 10 is a set
   * you could not have added a rep to. Telling someone "4 x 5" says nothing
   * about effort; "4 x 5 @ RPE 8" is the part that actually drives the result.
   */
  rpe: number;
  /** Percentage of a one-rep max the rep range roughly corresponds to. */
  intensityPct: number;
  /** Set when this movement is here because of the chosen emphasis. */
  emphasisWork?: boolean;
}

export interface SessionPlan {
  name: string;
  focus: string;
  blocks: PrescribedSet[];
  estimatedMinutes: number;
}

export interface CardioPlan {
  weeklyMinutes: number;
  sessions: number;
  minutesPerSession: number;
  intensity: string;
  note: string;
}

export type InsightLevel = 'good' | 'warn' | 'tip';

export interface Insight {
  level: InsightLevel;
  text: string;
}

export interface CoachPlan {
  splitName: string;
  /** The full week, in order. */
  week: SessionPlan[];
  /** What to do today: a session, or rest. */
  today: SessionPlan | null;
  todayIsRest: boolean;
  todayReason: string;
  cardio: CardioPlan;
  insights: Insight[];
}

/** Held positions are prescribed in seconds, everything else in reps. */
const TIMED = new Set(['plank', 'side-plank', 'dead-bug', 'hollow-hold', 'l-sit']);

const LEVEL_NUMBER: Record<TrainingLevel, 1 | 2 | 3> = { beginner: 1, intermediate: 2, advanced: 3 };

/**
 * Pick the best movement for a pattern, given the equipment and how strong the
 * person is.
 *
 * Difficulty is a tie-breaker, not a filter on its own: a loaded barbell squat
 * beats a pistol squat for an advanced lifter who owns a barbell, because load
 * is easier to progress than leverage. But with nothing but a floor, the harder
 * variant is the only way to keep a strong person near failure in a sane number
 * of reps, so it wins there.
 */
export function chooseMovement(
  pattern: Pattern,
  equipment: Equipment[],
  exclude: Set<string> = new Set(),
  level: TrainingLevel = 'beginner',
): Movement | null {
  const have = new Set<Equipment>(equipment.length > 0 ? equipment : ['none']);
  have.add('none');
  const ceiling = LEVEL_NUMBER[level];

  const options = MOVEMENTS
    .filter((m) => m.pattern === pattern && !exclude.has(m.id))
    .filter((m) => m.equipment.some((e) => have.has(e)))
    .filter((m) => m.level <= ceiling);

  // Harder variants are worth up to two points of preference, and only to
  // someone who has earned them.
  const score = (m: Movement): number => m.preference + (ceiling >= 2 ? m.level - 1 : 0);
  return options.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/**
 * Sets, reps, rest and effort for one movement.
 *
 * The rep range comes from the goal, but the *intensity* comes from experience.
 * A beginner grows on three sets of eight taken a couple of reps shy of
 * failure, and gets hurt chasing heavy singles. Someone with years behind them
 * has to work far closer to their limit, on fewer reps and more sets, to make
 * anything happen at all - which is why handing them "3 x 8-10 bodyweight
 * squats" is not a small mistake, it is a wasted year.
 */
const NEXT_BAND: Record<string, string> = {
  '4-6': '6-8',
  '5-6': '6-8',
  '6-8': '8-10',
  '8-10': '10-12',
  '10-12': '12-15',
};

/**
 * Turn a heavy top-set scheme into the secondary work that follows it.
 *
 * Only the first big lift of a session should be taken near a limit. Four
 * compounds at five sets of five with three minutes' rest is a two-hour
 * session that nobody recovers from; every real programme runs one heavy lift
 * and then backs off. This drops a set, moves up a rep band and shortens the
 * rest, which is the difference between a session and an ordeal.
 */
function asSecondary(set: PrescribedSet): PrescribedSet {
  return {
    ...set,
    sets: Math.max(3, set.sets - 1),
    reps: NEXT_BAND[set.reps] ?? set.reps,
    restSeconds: Math.round((set.restSeconds * 0.7) / 15) * 15,
    rpe: Math.max(7, set.rpe - 0.5),
    intensityPct: Math.max(55, set.intensityPct - 8),
  };
}

function prescribe(movement: Movement, profile: Profile, emphasisWork = false): PrescribedSet {
  const { goal, level } = profile;
  const bias = Math.max(-1, Math.min(2, Math.round(profile.volumeBias ?? 0)));

  if (TIMED.has(movement.id)) {
    const seconds = level === 'advanced' ? '45-60 s' : level === 'intermediate' ? '40-50 s' : '30-45 s';
    return {
      movement,
      sets: 3 + bias,
      reps: seconds,
      restSeconds: 45,
      note: movement.cue,
      rpe: 8,
      intensityPct: 0,
      ...(emphasisWork ? { emphasisWork } : {}),
    };
  }

  // [sets, reps, rest seconds, RPE, rough % of one-rep max]
  type Scheme = [number, string, number, number, number];

  const compound: Record<TrainingLevel, Record<Goal, Scheme>> = {
    beginner: {
      gain: [3, '8-10', 120, 7, 72],
      lose: [3, '8-10', 90, 7.5, 70],
      maintain: [3, '8-10', 105, 7, 70],
    },
    intermediate: {
      gain: [4, '6-8', 150, 8, 78],
      lose: [4, '6-8', 120, 8, 76],
      maintain: [4, '6-8', 135, 7.5, 75],
    },
    advanced: {
      gain: [5, '4-6', 210, 8.5, 85],
      lose: [4, '5-6', 180, 8.5, 82],
      maintain: [5, '5-6', 180, 8, 82],
    },
  };

  const accessory: Record<TrainingLevel, Record<Goal, Scheme>> = {
    beginner: {
      gain: [3, '10-12', 75, 8, 60],
      lose: [3, '12-15', 60, 8, 55],
      maintain: [3, '10-12', 75, 8, 58],
    },
    intermediate: {
      gain: [3, '8-12', 90, 8.5, 65],
      lose: [3, '12-15', 60, 8.5, 58],
      maintain: [3, '10-12', 75, 8, 62],
    },
    advanced: {
      gain: [4, '8-12', 90, 9, 68],
      lose: [4, '10-15', 60, 9, 60],
      maintain: [4, '8-12', 75, 8.5, 65],
    },
  };

  const table = movement.compound ? compound : accessory;
  const [sets, reps, rest, rpe, pct] = table[level][goal];

  // Core work is rarely loaded, so a percentage of a one-rep max would be a
  // number with nothing behind it.
  const loadable = movement.pattern !== 'core';

  return {
    movement,
    sets: Math.max(2, sets + bias),
    reps,
    restSeconds: rest,
    note: movement.cue,
    rpe,
    intensityPct: loadable ? pct : 0,
    ...(emphasisWork ? { emphasisWork } : {}),
  };
}

/** Extra patterns added to every session when a body part is emphasised. */
const EMPHASIS_PATTERNS: Record<Emphasis, Pattern[]> = {
  balanced: [],
  abs: ['core', 'core'],
  arms: ['arms', 'arms'],
  chest: ['horizontal-push'],
  back: ['horizontal-pull', 'vertical-pull'],
  shoulders: ['vertical-push'],
  legs: ['squat', 'lunge'],
  glutes: ['hinge', 'hinge'],
};

/**
 * What to train instead when the equipment cannot support a pattern.
 * Without a bar there is no vertical pull, but the back still needs training,
 * so the session falls back to the nearest thing that is possible.
 */
const SUBSTITUTES: Partial<Record<Pattern, Pattern[]>> = {
  'vertical-pull': ['horizontal-pull'],
  'horizontal-pull': ['vertical-pull'],
  'vertical-push': ['horizontal-push'],
  'horizontal-push': ['vertical-push'],
  squat: ['lunge'],
  hinge: ['lunge', 'squat'],
  lunge: ['squat'],
};

/** Turn a template into a session someone can walk into a gym and do. */
export function buildSession(template: SessionTemplate, profile: Profile): SessionPlan {
  const used = new Set<string>();
  const blocks: PrescribedSet[] = [];

  let heavyDone = false;
  const fill = (pattern: Pattern, emphasisWork: boolean): void => {
    let movement = chooseMovement(pattern, profile.equipment, used, profile.level);
    if (!movement) {
      for (const fallback of SUBSTITUTES[pattern] ?? []) {
        movement = chooseMovement(fallback, profile.equipment, used, profile.level);
        if (movement) break;
      }
    }
    if (!movement) return;
    used.add(movement.id);

    const set = prescribe(movement, profile, emphasisWork);
    // The first compound of the session is the one taken heavy.
    if (movement.compound && !emphasisWork && !heavyDone) {
      heavyDone = true;
      blocks.push(set);
    } else {
      blocks.push(movement.compound ? asSecondary(set) : set);
    }
  };

  for (const pattern of template.patterns) fill(pattern, false);
  // Emphasis work goes last: the main lifts should not be done tired.
  for (const pattern of EMPHASIS_PATTERNS[profile.emphasis ?? 'balanced']) fill(pattern, true);
  const estimatedMinutes = Math.round(
    blocks.reduce((sum, block) => sum + block.sets * (block.restSeconds + 45) / 60, 0) + 8,
  );
  return { name: template.name, focus: template.focus, blocks, estimatedMinutes };
}

/** Cardio dose, from the goal. */
export function cardioFor(goal: Goal, trainingDays: number): CardioPlan {
  if (goal === 'lose') {
    return {
      weeklyMinutes: 200,
      sessions: 4,
      minutesPerSession: 50,
      intensity: 'Conversational pace, or brisk walking',
      note: 'Steady low-intensity work burns fat without eating into recovery from lifting. '
        + 'A 45 minute walk after dinner counts, and is easier to keep up than intervals.',
    };
  }
  if (goal === 'gain') {
    return {
      weeklyMinutes: 90,
      sessions: 3,
      minutesPerSession: 30,
      intensity: 'Easy, keep it short',
      note: 'Enough to stay fit without burning through the surplus you are trying to eat.',
    };
  }
  return {
    weeklyMinutes: 150,
    sessions: trainingDays >= 5 ? 3 : 4,
    minutesPerSession: 40,
    intensity: 'Moderate',
    note: '150 minutes a week is the standard health target, and it is worth hitting whatever the scale is doing.',
  };
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function isStrength(activity: ActivityEntry): boolean {
  const exercise = getExercise(activity.exerciseId);
  return exercise?.kind === 'strength';
}

function isCardio(activity: ActivityEntry): boolean {
  const exercise = getExercise(activity.exerciseId);
  return exercise?.kind === 'cardio' || exercise?.kind === 'sport';
}

/** Read the last two weeks of training and say what is missing. */
export function analyseTraining(logs: DayLog[], today: string, profile: Profile): Insight[] {
  const insights: Insight[] = [];
  const recent = logs
    .filter((log) => {
      const gap = daysBetween(log.date, today);
      return gap >= 0 && gap < 14;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const lastWeek = recent.filter((log) => daysBetween(log.date, today) < 7);
  const strengthDays = lastWeek.filter((log) => log.activities.some(isStrength)).length;
  const cardioMinutes = lastWeek
    .flatMap((log) => log.activities.filter(isCardio))
    .reduce((sum, activity) => sum + activity.minutes, 0);

  if (strengthDays === 0) {
    insights.push({
      level: 'warn',
      text: 'No strength work logged in the last seven days. On a deficit that is the difference between losing fat and losing muscle.',
    });
  } else if (strengthDays >= profile.trainingDays) {
    insights.push({ level: 'good', text: `${strengthDays} strength sessions this week — you hit your target of ${profile.trainingDays}.` });
  } else {
    insights.push({
      level: 'tip',
      text: `${strengthDays} of ${profile.trainingDays} strength sessions done this week. ${profile.trainingDays - strengthDays} to go.`,
    });
  }

  const cardio = cardioFor(profile.goal, profile.trainingDays);
  if (cardioMinutes < cardio.weeklyMinutes * 0.5) {
    insights.push({
      level: 'tip',
      text: `${cardioMinutes} minutes of cardio this week against a target of ${cardio.weeklyMinutes}. `
        + `That is ${Math.ceil((cardio.weeklyMinutes - cardioMinutes) / cardio.minutesPerSession)} more sessions of ${cardio.minutesPerSession} minutes.`,
    });
  } else if (cardioMinutes >= cardio.weeklyMinutes) {
    insights.push({ level: 'good', text: `${cardioMinutes} minutes of cardio this week, target met.` });
  }

  // Seven days in a row without a day off is where injuries and burnout start.
  let streak = 0;
  for (let i = 0; i < 10; i += 1) {
    const date = new Date(Date.parse(`${today}T00:00:00Z`) - i * DAY_MS).toISOString().slice(0, 10);
    const log = recent.find((entry) => entry.date === date);
    if (log && log.activities.length > 0) streak += 1;
    else break;
  }
  if (streak >= 7) {
    insights.push({ level: 'warn', text: `${streak} days trained in a row. Take a rest day — adaptation happens between sessions, not during them.` });
  }

  // Patterns nobody enjoys are the ones that quietly disappear.
  const legWords = /squat|deadlift|lunge|leg|hinge|rdl|hip thrust/i;
  const trainedLegs = recent.some((log) => log.activities.some((a) => legWords.test(a.text) || a.exerciseId === 'running' || a.exerciseId === 'cycling'));
  if (recent.length >= 5 && !trainedLegs) {
    insights.push({ level: 'warn', text: 'Nothing that looks like leg work in two weeks. Legs are half your muscle mass and most of your calorie burn.' });
  }

  if (profile.emphasis === 'abs') {
    insights.push({
      level: 'tip',
      text: 'Direct ab work is in every session now, and it will build the muscle. Whether it shows is a body-fat '
        + 'question, not a training one - that is what the calorie target on the Today tab is doing.',
    });
  }

  const weighIns = recent.filter((log) => typeof log.weightKg === 'number').length;
  if (weighIns < 3) {
    insights.push({
      level: 'tip',
      text: 'Weigh yourself most mornings. It is the one number that turns this from a guess into a measurement.',
    });
  }

  return insights;
}

/**
 * Build the whole plan: the week, today's session, cardio, and what the log says.
 *
 * Which session comes up today is decided by how many have been done this week,
 * so a missed day shifts the rotation instead of losing a session.
 */
export function coach(profile: Profile, logs: DayLog[], today: string): CoachPlan {
  const days = Math.min(6, Math.max(2, profile.trainingDays));
  const split = SPLITS[days] ?? (SPLITS[3] as { name: string; sessions: SessionTemplate[] });
  const week = split.sessions.map((template) => buildSession(template, profile));

  const weekStart = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * DAY_MS).toISOString().slice(0, 10);
  const strengthThisWeek = logs.filter(
    (log) => log.date >= weekStart && log.date <= today && log.activities.some(isStrength),
  );
  const doneToday = logs.find((log) => log.date === today)?.activities.some(isStrength) ?? false;
  const completed = strengthThisWeek.length;

  const insights = analyseTraining(logs, today, profile);

  if (doneToday) {
    return {
      splitName: split.name,
      week,
      today: null,
      todayIsRest: true,
      todayReason: 'You already trained today. Eat, sleep, and let it work.',
      cardio: cardioFor(profile.goal, profile.trainingDays),
      insights,
    };
  }

  if (completed >= days) {
    return {
      splitName: split.name,
      week,
      today: null,
      todayIsRest: true,
      todayReason: `You have done all ${days} sessions this week. Today is a rest day — walk, stretch, and come back fresh.`,
      cardio: cardioFor(profile.goal, profile.trainingDays),
      insights,
    };
  }

  const index = completed % week.length;
  return {
    splitName: split.name,
    week,
    today: week[index] as SessionPlan,
    todayIsRest: false,
    todayReason: `Session ${completed + 1} of ${days} this week.`,
    cardio: cardioFor(profile.goal, profile.trainingDays),
    insights,
  };
}

/**
 * How to add load, which is the only thing that makes a programme work.
 *
 * Double progression: work up the rep range at a fixed weight, and when the
 * top of the range is reached on every set at the target effort, add load and
 * start again at the bottom. The increment shrinks as someone gets stronger,
 * because an advanced lifter adding 5 kg a week to a squat would be adding
 * 260 kg a year, and nobody does that.
 */
export function progressionAdvice(block: PrescribedSet, level: TrainingLevel = 'beginner'): string {
  const top = Number(block.reps.split('-')[1] ?? block.reps);
  if (Number.isNaN(top)) {
    return `Hold each set to RPE ${block.rpe} - a couple of seconds short of shaking. Add time once the last set stops being hard.`;
  }
  const step = level === 'advanced' ? '1-2.5 kg' : level === 'intermediate' ? '2.5 kg' : '2.5-5 kg';
  return `Take every set to about RPE ${block.rpe}: stop with ${Math.round(10 - block.rpe)} rep${10 - block.rpe === 1 ? '' : 's'} left in the tank. `
    + `When you hit ${top} reps on all ${block.sets} sets at that effort, add ${step} next session and start again at the bottom of the range.`;
}

/** A sentence describing how hard the session is meant to be. */
export function intensityNote(level: TrainingLevel, goal: Goal): string {
  if (level === 'advanced') {
    return goal === 'gain'
      ? 'Heavy, low-rep work near 85% of your max. Long rests; the sets are supposed to be slow and unpleasant.'
      : 'Heavy enough to hold onto strength while the deficit does the fat loss. Do not chase a pump instead of load.';
  }
  if (level === 'intermediate') {
    return 'Six to eight hard reps, two shy of failure. This is the range where most people who already train make progress.';
  }
  return 'Leave two or three reps in reserve on every set. Technique first: the load will come faster than you expect.';
}
