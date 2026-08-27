import { MOVEMENTS, type Movement, type Pattern, SPLITS, type SessionTemplate } from '../data/workouts.ts';
import { getExercise } from '../data/exercises.ts';
import type { ActivityEntry, DayLog, Equipment, Goal, Profile } from './types.ts';

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
const TIMED = new Set(['plank', 'side-plank', 'dead-bug']);

/** Pick the best movement for a pattern given the equipment on hand. */
export function chooseMovement(pattern: Pattern, equipment: Equipment[], exclude: Set<string> = new Set()): Movement | null {
  const have = new Set<Equipment>(equipment.length > 0 ? equipment : ['none']);
  have.add('none');
  const options = MOVEMENTS
    .filter((m) => m.pattern === pattern && !exclude.has(m.id))
    .filter((m) => m.equipment.some((e) => have.has(e)))
    .sort((a, b) => b.preference - a.preference);
  return options[0] ?? null;
}

/** Sets, reps and rest for one movement, given the goal. */
function prescribe(movement: Movement, goal: Goal): PrescribedSet {
  if (TIMED.has(movement.id)) {
    return { movement, sets: 3, reps: '30-45 s', restSeconds: 45, note: movement.cue };
  }
  if (goal === 'gain') {
    return movement.compound
      ? { movement, sets: 4, reps: '5-8', restSeconds: 150, note: movement.cue }
      : { movement, sets: 3, reps: '8-12', restSeconds: 90, note: movement.cue };
  }
  if (goal === 'lose') {
    return movement.compound
      ? { movement, sets: 3, reps: '8-10', restSeconds: 90, note: movement.cue }
      : { movement, sets: 3, reps: '12-15', restSeconds: 60, note: movement.cue };
  }
  return movement.compound
    ? { movement, sets: 3, reps: '6-10', restSeconds: 120, note: movement.cue }
    : { movement, sets: 3, reps: '10-12', restSeconds: 75, note: movement.cue };
}

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
  for (const pattern of template.patterns) {
    let movement = chooseMovement(pattern, profile.equipment, used);
    if (!movement) {
      for (const fallback of SUBSTITUTES[pattern] ?? []) {
        movement = chooseMovement(fallback, profile.equipment, used);
        if (movement) break;
      }
    }
    if (!movement) continue;
    used.add(movement.id);
    blocks.push(prescribe(movement, profile.goal));
  }
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
 * Progression rule: hit the top of the rep range on every set and the weight
 * goes up next time. Simple, and it is the only thing that reliably works.
 */
export function progressionAdvice(reps: string, goal: Goal): string {
  const top = Number(reps.split('-')[1] ?? reps);
  if (Number.isNaN(top)) return 'Add a few seconds to each hold once the last set stops being hard.';
  const step = goal === 'gain' ? '2.5-5 kg' : '2.5 kg';
  return `When you hit ${top} reps on every set with good form, add ${step} next session and start again at the bottom of the range.`;
}
