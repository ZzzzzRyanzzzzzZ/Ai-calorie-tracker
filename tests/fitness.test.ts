import { describe, expect, it } from 'vitest';
import {
  kcalPerMinute,
  parseActivity,
  parseActivityLine,
  parseDistance,
  parseDuration,
  parseSets,
} from '../src/core/parseExercise.ts';
import { getExercise, metForSpeed } from '../src/data/exercises.ts';
import { balanceFor, bmrKatch, bmrMifflin, macroTargets, planFor, weeksToGoal } from '../src/core/energy.ts';
import { estimateMaintenance, linearRegression, smoothWeights } from '../src/core/adaptive.ts';
import { analyseTraining, buildSession, chooseMovement, coach } from '../src/core/coach.ts';
import { DEFAULT_PROFILE } from '../src/core/store.ts';
import type { ActivityEntry, DayLog, Profile } from '../src/core/types.ts';

describe('reading a training log', () => {
  it('reads durations however they are written', () => {
    expect(parseDuration('45 min')).toBe(45);
    expect(parseDuration('45min')).toBe(45);
    expect(parseDuration('1 hr')).toBe(60);
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('1.5 hours')).toBe(90);
    expect(parseDuration('half an hour')).toBe(30);
    expect(parseDuration('ran a lot')).toBeNull();
  });

  it('reads distances however they are written', () => {
    expect(parseDistance('5 km')).toBe(5);
    expect(parseDistance('5k')).toBe(5);
    expect(parseDistance('3 miles')).toBeCloseTo(4.83, 1);
    expect(parseDistance('10000 steps')).toBeCloseTo(7.62, 1);
    expect(parseDistance('45 min')).toBeNull();
  });

  it('reads sets and reps', () => {
    expect(parseSets('bench 3x8')?.sets).toHaveLength(3);
    expect(parseSets('3 sets of 10 squats')?.sets[0]?.reps).toBe(10);
    expect(parseSets('bench press 4x5 @ 60kg')?.weightKg).toBe(60);
    expect(parseSets('bench press 4x5 @ 135 lbs')?.weightKg).toBeCloseTo(61.2, 1);
  });

  it('costs a run by its actual pace, not a flat number', () => {
    const fast = parseActivity('ran 5k in 20 min', 70);
    const slow = parseActivity('ran 5k in 40 min', 70);
    expect(fast.met).toBeGreaterThan(slow.met);
    expect(fast.kcalNet).toBeGreaterThan(slow.kcalNet);
    // The slower run takes twice as long, so it still burns more in total.
    expect(slow.minutes).toBe(40);
  });

  it('subtracts resting metabolism from the burn it credits', () => {
    const activity = parseActivity('45 min cycling', 70);
    expect(activity.kcalGross).toBeGreaterThan(activity.kcalNet);
    const met = activity.met;
    expect(activity.kcalNet).toBeCloseTo(kcalPerMinute(met - 1, 70) * 45, 0);
  });

  it('turns a distance into a duration when no time is given', () => {
    const activity = parseActivity('ran 10k', 70);
    expect(activity.minutes).toBeGreaterThan(30);
    expect(activity.notes.join(' ')).toMatch(/typical/);
  });

  it('handles a strength session', () => {
    const activity = parseActivity('squats 5x5 at 80kg', 75);
    expect(activity.exerciseId).toBe('bodyweight');
    expect(activity.sets).toHaveLength(5);
    expect(activity.volumeKg).toBe(2000);
  });

  it('reads several activities from one line', () => {
    const line = parseActivityLine('ran 5k in 27 min and 30 min of weights', 70);
    expect(line.activities).toHaveLength(2);
    expect(line.activities[0]?.exerciseId).toBe('running');
    expect(line.activities[1]?.exerciseId).toBe('weights');
    expect(line.totalMinutes).toBe(57);
  });

  it('says so instead of guessing at an unknown activity', () => {
    const activity = parseActivity('30 min of zzzqqxx', 70);
    expect(activity.unresolved).toBe(true);
    expect(activity.kcalNet).toBe(0);
  });

  it('interpolates METs between speed bands', () => {
    const running = getExercise('running');
    expect(running).toBeDefined();
    const slow = metForSpeed(running!, 8);
    const fast = metForSpeed(running!, 13);
    expect(slow).toBeLessThan(fast);
    expect(metForSpeed(running!, 9)).toBeGreaterThan(slow);
  });
});

describe('energy budgeting', () => {
  it('matches the published Mifflin-St Jeor worked example', () => {
    // 70 kg, 175 cm, 25 y male: 10(70) + 6.25(175) - 5(25) + 5 = 1673.75
    expect(bmrMifflin('male', 70, 175, 25)).toBeCloseTo(1673.75, 2);
    expect(bmrMifflin('female', 60, 165, 30)).toBeCloseTo(1320.25, 2);
  });

  it('uses Katch-McArdle when body fat is known', () => {
    expect(bmrKatch(80, 20)).toBeCloseTo(370 + 21.6 * 64, 2);
    const plan = planFor({ ...DEFAULT_PROFILE, weightKg: 80, bodyFatPct: 20 });
    expect(plan.method).toBe('katch');
  });

  it('turns a goal rate into a daily adjustment', () => {
    const plan = planFor({ ...DEFAULT_PROFILE, weightKg: 80, goal: 'lose', rateKgPerWeek: -0.5 });
    expect(plan.adjustment).toBeCloseTo(-550, -1);
    expect(plan.target).toBeLessThan(plan.tdee);
  });

  it('refuses to recommend a dangerous deficit', () => {
    const plan = planFor({ ...DEFAULT_PROFILE, weightKg: 55, goal: 'lose', rateKgPerWeek: -1.5 });
    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.target).toBeGreaterThanOrEqual(1200);
  });

  it('sets protein by body weight and fills the rest with carbs', () => {
    const macros = macroTargets('lose', 70, 2000);
    expect(macros.protein).toBe(140);
    expect(macros.protein * 4 + macros.carbs * 4 + macros.fat * 9).toBeCloseTo(2000, -1);
  });

  it('credits training back to the day budget', () => {
    const plan = planFor({ ...DEFAULT_PROFILE, weightKg: 70 });
    const rested = balanceFor(plan, 1800, 0);
    const trained = balanceFor(plan, 1800, 400);
    expect(trained.remaining).toBe(rested.remaining + 400);
  });

  it('projects the weekly change from one day', () => {
    const plan = planFor({ ...DEFAULT_PROFILE, weightKg: 70, goal: 'maintain', rateKgPerWeek: 0 });
    const balance = balanceFor(plan, plan.tdee + 1100, 0);
    expect(balance.projectedKgPerWeek).toBeCloseTo(1, 0);
  });

  it('says how long a goal will take', () => {
    expect(weeksToGoal(80, 75, -0.5)).toBe(10);
    expect(weeksToGoal(80, 85, -0.5)).toBeNull();
  });
});

/** A log of daily weights and intake for someone in a steady deficit. */
function syntheticLog(days: number, startKg: number, kgPerDay: number, intake: number) {
  const records = [];
  const start = Date.parse('2026-01-01T00:00:00Z');
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    // Scale weight wobbles by up to a kilo from water alone.
    const noise = Math.sin(i * 1.7) * 0.5 + Math.cos(i * 0.9) * 0.3;
    records.push({ date, weightKg: startKg + kgPerDay * i + noise, intakeKcal: intake });
  }
  return records;
}

describe('adaptive maintenance', () => {
  it('smooths the water weight out of a trend', () => {
    const points = smoothWeights(syntheticLog(30, 80, -0.05, 2000));
    const rawSwing = Math.max(...points.map((p) => p.weightKg)) - Math.min(...points.map((p) => p.weightKg));
    const trendSwing = Math.max(...points.map((p) => p.trendKg)) - Math.min(...points.map((p) => p.trendKg));
    expect(trendSwing).toBeLessThan(rawSwing);
    expect(points).toHaveLength(30);
  });

  it('fits a line', () => {
    const fit = linearRegression([0, 1, 2, 3, 4], [10, 12, 14, 16, 18]);
    expect(fit?.slope).toBeCloseTo(2, 6);
    expect(fit?.intercept).toBeCloseTo(10, 6);
  });

  it('recovers the true maintenance from logged data', () => {
    // Eating 2000 kcal while losing 0.05 kg a day means maintenance is
    // 2000 + 0.05 x 7700 = 2385 kcal.
    const estimate = estimateMaintenance(syntheticLog(42, 80, -0.05, 2000), 2600);
    expect(estimate.measured).toBeGreaterThan(2250);
    expect(estimate.measured).toBeLessThan(2500);
    expect(estimate.confidence).toBe('high');
    expect(estimate.trendKgPerWeek).toBeCloseTo(-0.35, 1);
  });

  it('leans on the formula until there is enough data', () => {
    const short = estimateMaintenance(syntheticLog(6, 80, -0.05, 2000), 2600);
    expect(short.confidence).toBe('none');
    expect(short.maintenance).toBe(2600);
    expect(short.explanation.join(' ')).toMatch(/two weeks/);
  });

  it('shifts weight from the formula to the data as the log grows', () => {
    const fortnight = estimateMaintenance(syntheticLog(14, 80, -0.05, 2000), 2600);
    const sixWeeks = estimateMaintenance(syntheticLog(42, 80, -0.05, 2000), 2600);
    expect(sixWeeks.dataWeight).toBeGreaterThan(fortnight.dataWeight);
    expect(sixWeeks.dataWeight).toBe(1);
  });

  it('reports an honest interval, not a single number', () => {
    const estimate = estimateMaintenance(syntheticLog(42, 80, -0.05, 2000), 2600);
    expect(estimate.low).toBeLessThan(estimate.measured as number);
    expect(estimate.high).toBeGreaterThan(estimate.measured as number);
  });

  it('refuses a measurement that comes out below resting metabolism', () => {
    // Someone logging 900 kcal a day while barely losing weight is not a
    // metabolic marvel, they are forgetting the oil, the sugar in the chai and
    // whatever they ate standing up.
    const estimate = estimateMaintenance(syntheticLog(42, 80, -0.01, 900), 2600, 42, 1700);
    expect(estimate.underReported).toBe(true);
    expect(estimate.dataWeight).toBe(0);
    expect(estimate.maintenance).toBe(2600);
    expect(estimate.measured).toBeLessThan(1700);
    expect(estimate.explanation.join(' ')).toMatch(/unlogged/);
  });

  it('accepts a plausible measurement when a BMR floor is supplied', () => {
    const estimate = estimateMaintenance(syntheticLog(42, 80, -0.05, 2000), 2600, 42, 1700);
    expect(estimate.underReported).toBe(false);
    expect(estimate.dataWeight).toBe(1);
  });

  it('detects a maintenance eater', () => {
    const estimate = estimateMaintenance(syntheticLog(42, 75, 0, 2200), 2600);
    expect(estimate.trendKgPerWeek).toBeCloseTo(0, 1);
    expect(estimate.measured).toBeGreaterThan(2100);
    expect(estimate.measured).toBeLessThan(2300);
  });
});

function activity(id: string, minutes: number, text: string): ActivityEntry {
  return {
    id: `a-${Math.random()}`,
    text,
    exerciseId: id,
    exerciseName: id,
    minutes,
    met: 5,
    kcalGross: 200,
    kcalNet: 160,
    at: '2026-01-01T10:00:00Z',
  };
}

function dayWith(date: string, activities: ActivityEntry[], weightKg?: number): DayLog {
  return { date, foods: [], activities, ...(weightKg !== undefined ? { weightKg } : {}) };
}

describe('the coach', () => {
  const profile: Profile = { ...DEFAULT_PROFILE, trainingDays: 3, equipment: ['dumbbells'], goal: 'lose' };

  it('picks the best movement the equipment allows', () => {
    expect(chooseMovement('squat', ['barbell'])?.id).toBe('back-squat');
    expect(chooseMovement('squat', ['dumbbells'])?.id).toBe('goblet-squat');
    expect(chooseMovement('squat', ['none'])?.id).toBe('bw-squat');
    expect(chooseMovement('vertical-pull', ['none'])).toBeNull();
  });

  it('never prescribes the same movement twice in a session', () => {
    const session = buildSession(
      { name: 'test', focus: 'test', patterns: ['squat', 'squat', 'hinge'] },
      profile,
    );
    const ids = session.blocks.map((b) => b.movement.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('substitutes a pattern the equipment cannot support', () => {
    // There is no vertical pull without a bar, but the back still needs work,
    // so the session must fall back rather than silently drop the block.
    const session = buildSession(
      { name: 'test', focus: 'test', patterns: ['squat', 'vertical-pull', 'core'] },
      { ...profile, equipment: ['none'] },
    );
    expect(session.blocks).toHaveLength(3);
    expect(session.blocks.map((b) => b.movement.pattern)).toContain('horizontal-pull');
  });

  it('gives every bodyweight session something for the back', () => {
    const plan = coach({ ...profile, equipment: ['none'], trainingDays: 3 }, [], '2026-01-07');
    for (const session of plan.week) {
      const pulls = session.blocks.filter((b) => b.movement.pattern.endsWith('pull'));
      expect(pulls.length, session.name).toBeGreaterThan(0);
    }
  });

  it('builds a week that matches the days someone will train', () => {
    expect(coach({ ...profile, trainingDays: 3 }, [], '2026-01-07').week).toHaveLength(3);
    expect(coach({ ...profile, trainingDays: 5 }, [], '2026-01-07').week).toHaveLength(5);
    expect(coach({ ...profile, trainingDays: 1 }, [], '2026-01-07').week).toHaveLength(2);
  });

  it('sets more reps for a cut and heavier sets for a bulk', () => {
    const cutting = coach({ ...profile, goal: 'lose' }, [], '2026-01-07').today;
    const bulking = coach({ ...profile, goal: 'gain' }, [], '2026-01-07').today;
    expect(cutting?.blocks[0]?.reps).toBe('8-10');
    expect(bulking?.blocks[0]?.reps).toBe('5-8');
    expect(bulking?.blocks[0]?.sets).toBe(4);
  });

  it('advances through the split as sessions get logged', () => {
    const logs = [dayWith('2026-01-05', [activity('weights', 45, 'gym')])];
    const plan = coach(profile, logs, '2026-01-07');
    expect(plan.today?.name).toBe('Full body B');
    expect(plan.todayReason).toMatch(/Session 2 of 3/);
  });

  it('calls a rest day once the week is done', () => {
    const logs = ['2026-01-04', '2026-01-05', '2026-01-06'].map((date) => dayWith(date, [activity('weights', 45, 'gym')]));
    const plan = coach(profile, logs, '2026-01-07');
    expect(plan.todayIsRest).toBe(true);
    expect(plan.today).toBeNull();
  });

  it('does not prescribe a second session on a day already trained', () => {
    const logs = [dayWith('2026-01-07', [activity('weights', 45, 'gym')])];
    expect(coach(profile, logs, '2026-01-07').todayIsRest).toBe(true);
  });

  it('notices when strength work has been skipped', () => {
    const insights = analyseTraining([dayWith('2026-01-06', [activity('running', 30, 'run')])], '2026-01-07', profile);
    expect(insights.some((i) => i.level === 'warn' && /strength/i.test(i.text))).toBe(true);
  });

  it('notices a week without a rest day', () => {
    const logs = Array.from({ length: 8 }, (_, i) => {
      const date = new Date(Date.parse('2026-01-07T00:00:00Z') - i * 86_400_000).toISOString().slice(0, 10);
      return dayWith(date, [activity('weights', 45, 'gym')]);
    });
    const insights = analyseTraining(logs, '2026-01-07', profile);
    expect(insights.some((i) => /rest day/i.test(i.text))).toBe(true);
  });

  it('prescribes more cardio for fat loss than for a bulk', () => {
    const cutting = coach({ ...profile, goal: 'lose' }, [], '2026-01-07').cardio;
    const bulking = coach({ ...profile, goal: 'gain' }, [], '2026-01-07').cardio;
    expect(cutting.weeklyMinutes).toBeGreaterThan(bulking.weeklyMinutes);
  });
});
