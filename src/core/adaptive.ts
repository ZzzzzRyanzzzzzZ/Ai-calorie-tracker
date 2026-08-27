import { KCAL_PER_KG } from './energy.ts';

/**
 * Measuring maintenance calories instead of predicting them.
 *
 * Mifflin-St Jeor times an activity multiplier is a guess with a standard
 * error of a few hundred calories, and the multiplier is the worst part of it:
 * "moderately active" means different things to different people. But anyone
 * logging weight and intake for a few weeks is running the experiment that
 * settles it. Energy balance says:
 *
 *     maintenance = mean intake - (rate of weight change x 7700 kcal/kg)
 *
 * The difficulty is that scale weight swings by a kilo or more from water,
 * salt and gut contents, which swamps the real signal over short windows. So
 * the weight series is smoothed with an exponentially weighted moving average
 * first, and the slope is taken by least squares over the smoothed trend, with
 * a confidence interval from the residuals. Until there is enough data to beat
 * the formula, the two are blended in proportion to how much data there is.
 */

export interface DailyRecord {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Morning weight in kg, if taken that day. */
  weightKg?: number;
  /** Calories eaten that day. Undefined means the day was not logged. */
  intakeKcal?: number;
}

export interface TrendPoint {
  date: string;
  dayIndex: number;
  weightKg: number;
  /** The smoothed trend weight. */
  trendKg: number;
}

export type Confidence = 'none' | 'low' | 'medium' | 'high';

export interface AdaptiveEstimate {
  /** Best estimate of maintenance calories, blended with the formula. */
  maintenance: number | null;
  /** The estimate from logged data alone, before blending. */
  measured: number | null;
  /** Range around the measured estimate. */
  low: number | null;
  high: number | null;
  /** Smoothed rate of weight change. */
  trendKgPerWeek: number | null;
  daysOfData: number;
  weighInCount: number;
  intakeDayCount: number;
  confidence: Confidence;
  /** How much of the final number comes from the logged data, 0-1. */
  dataWeight: number;
  /**
   * True when the measurement came out below resting metabolism, which is not
   * something a human body does — it means food is going unlogged.
   */
  underReported: boolean;
  trend: TrendPoint[];
  explanation: string[];
}

const DAY_MS = 86_400_000;

function dayIndex(date: string, origin: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${origin}T00:00:00Z`)) / DAY_MS);
}

/**
 * Exponentially weighted moving average of scale weight.
 *
 * The smoothing factor is applied per elapsed day, not per reading, so a gap
 * in weigh-ins moves the trend the right amount rather than under-reacting.
 */
export function smoothWeights(records: DailyRecord[], alpha = 0.25): TrendPoint[] {
  const weighed = records
    .filter((r): r is DailyRecord & { weightKg: number } => typeof r.weightKg === 'number' && r.weightKg > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weighed.length === 0) return [];

  const origin = (weighed[0] as { date: string }).date;
  const points: TrendPoint[] = [];
  let trend = (weighed[0] as { weightKg: number }).weightKg;
  let previousIndex = 0;

  for (const record of weighed) {
    const index = dayIndex(record.date, origin);
    const gap = Math.max(1, index - previousIndex);
    // One day of smoothing per day elapsed.
    const effectiveAlpha = 1 - (1 - alpha) ** gap;
    trend += effectiveAlpha * (record.weightKg - trend);
    points.push({
      date: record.date,
      dayIndex: index,
      weightKg: record.weightKg,
      trendKg: Math.round(trend * 1000) / 1000,
    });
    previousIndex = index;
  }
  return points;
}

interface Regression {
  slope: number;
  intercept: number;
  /** Standard error of the slope. */
  slopeError: number;
}

/** Ordinary least squares of y on x. */
export function linearRegression(xs: number[], ys: number[]): Regression | null {
  const n = xs.length;
  if (n < 3) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] as number) - meanX;
    sxx += dx * dx;
    sxy += dx * ((ys[i] as number) - meanY);
  }
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let residualSquares = 0;
  for (let i = 0; i < n; i += 1) {
    const predicted = intercept + slope * (xs[i] as number);
    const residual = (ys[i] as number) - predicted;
    residualSquares += residual * residual;
  }
  const variance = residualSquares / Math.max(1, n - 2);
  return { slope, intercept, slopeError: Math.sqrt(variance / sxx) };
}

function confidenceFor(days: number, weighIns: number, intakeDays: number): Confidence {
  if (days < 10 || weighIns < 5 || intakeDays < 5) return 'none';
  if (days >= 28 && weighIns >= 18 && intakeDays >= 20) return 'high';
  if (days >= 18 && weighIns >= 10 && intakeDays >= 12) return 'medium';
  return 'low';
}

/**
 * Estimate maintenance calories from logged weight and intake.
 *
 * `formulaTdee` is the Mifflin-St Jeor estimate to fall back on and blend with.
 * Only the most recent `windowDays` are used, so the estimate follows the
 * metabolic adaptation that happens during a long diet.
 */
export function estimateMaintenance(
  records: DailyRecord[],
  formulaTdee: number,
  windowDays = 42,
  bmr?: number,
): AdaptiveEstimate {
  const explanation: string[] = [];
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-windowDays);

  const trend = smoothWeights(recent);
  const intakeDays = recent.filter((r) => typeof r.intakeKcal === 'number' && (r.intakeKcal as number) > 0);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const days = first && last ? dayIndex(last.date, first.date) + 1 : 0;

  const empty: AdaptiveEstimate = {
    maintenance: null,
    measured: null,
    low: null,
    high: null,
    trendKgPerWeek: null,
    daysOfData: days,
    weighInCount: trend.length,
    intakeDayCount: intakeDays.length,
    confidence: 'none',
    dataWeight: 0,
    underReported: false,
    trend,
    explanation,
  };

  const confidence = confidenceFor(days, trend.length, intakeDays.length);
  if (confidence === 'none') {
    explanation.push(
      `Not enough logged yet: ${days} days, ${trend.length} weigh-ins, ${intakeDays.length} days of food. `
      + 'About two weeks of daily weights and food gets a real estimate.',
    );
    return { ...empty, maintenance: Math.round(formulaTdee) };
  }

  const regression = linearRegression(trend.map((p) => p.dayIndex), trend.map((p) => p.trendKg));
  if (!regression) return { ...empty, maintenance: Math.round(formulaTdee) };

  const kgPerDay = regression.slope;
  const meanIntake = intakeDays.reduce((sum, r) => sum + (r.intakeKcal as number), 0) / intakeDays.length;
  const measured = meanIntake - kgPerDay * KCAL_PER_KG;

  // The slope's standard error carries straight through to calories.
  const marginKcal = regression.slopeError * KCAL_PER_KG * 1.96;

  // Nobody maintains weight on less than their resting metabolism. When the
  // arithmetic says otherwise, the intake column is wrong - under-reporting of
  // food is the single most common error in self-logged diet data - so the
  // measurement is reported but not used to set a target.
  const restingFloor = bmr ?? formulaTdee * 0.6;
  const underReported = measured < restingFloor;

  // Trust the data more the more of it there is; 28 days of full logging is
  // where the measurement clearly beats the formula.
  const coverage = Math.min(1, (intakeDays.length / Math.max(days, 1)) * (trend.length / Math.max(days, 1)));
  const dataWeight = underReported ? 0 : Math.min(1, (days / 28) * Math.max(0.4, coverage));
  const maintenance = dataWeight * measured + (1 - dataWeight) * formulaTdee;

  const kgPerWeek = kgPerDay * 7;
  const direction = kgPerWeek > 0.02 ? 'gaining' : kgPerWeek < -0.02 ? 'losing' : 'holding steady';

  explanation.push(
    `Over ${days} days you averaged ${Math.round(meanIntake)} kcal a day and the smoothed trend has you `
    + `${direction}${direction === 'holding steady' ? '' : ` ${Math.abs(kgPerWeek).toFixed(2)} kg a week`}.`,
  );
  explanation.push(
    `That puts real maintenance near ${Math.round(measured)} kcal, give or take ${Math.round(marginKcal)}, `
    + `against ${Math.round(formulaTdee)} from the formula.`,
  );
  if (underReported) {
    explanation.push(
      `That is below your resting metabolism of about ${Math.round(restingFloor)} kcal, which a body cannot do. `
      + 'Almost always this means food is going unlogged - cooking oil, ghee, tea sugar, a bite of something at work. '
      + `The formula estimate of ${Math.round(formulaTdee)} kcal is being used instead until the log adds up.`,
    );
  } else if (dataWeight < 1) {
    explanation.push(
      `The two are blended ${Math.round(dataWeight * 100)}% measured to ${Math.round((1 - dataWeight) * 100)}% formula; `
      + 'the measured half takes over as more days are logged.',
    );
  }

  return {
    maintenance: Math.round(maintenance),
    measured: Math.round(measured),
    low: Math.round(measured - marginKcal),
    high: Math.round(measured + marginKcal),
    trendKgPerWeek: Math.round(kgPerWeek * 100) / 100,
    daysOfData: days,
    weighInCount: trend.length,
    intakeDayCount: intakeDays.length,
    confidence,
    dataWeight: Math.round(dataWeight * 100) / 100,
    underReported,
    trend,
    explanation,
  };
}
