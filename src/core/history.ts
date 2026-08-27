import type { DayLog, FoodEntry, MealSlot, Nutrients } from './types.ts';
import type { StoreState } from './store.ts';

/**
 * Logging by memory instead of by typing.
 *
 * Most people eat the same twenty meals. After a fortnight of logging, the
 * fastest way to record dinner is not a sentence or a photo, it is a button
 * that says "the dal and rice you have had forty times". This ranks a person's
 * own history so the interface can offer exactly that.
 */

export interface ItemSuggestion {
  /** Identity of the portion: same food, same weight. */
  key: string;
  foodId: string;
  foodName: string;
  grams: number;
  amountLabel: string;
  nutrients: Nutrients;
  /** How many times this exact portion has been logged. */
  count: number;
  lastUsed: string;
  /** The meal it usually belongs to. */
  meal: MealSlot;
  score: number;
}

const DAY_MS = 86_400_000;

function daysAgo(date: string, today: string): number {
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS));
}

/**
 * Rank past portions by how often and how recently they were eaten.
 *
 * Frequency alone surfaces what someone used to eat; recency alone surfaces
 * yesterday's one-off. The score multiplies count by a half-life decay so that
 * a habit outranks an experiment, but a dropped habit fades.
 */
export function suggestItems(
  state: StoreState,
  today: string,
  options: { meal?: MealSlot; limit?: number; halfLifeDays?: number } = {},
): ItemSuggestion[] {
  const { meal, limit = 8, halfLifeDays = 21 } = options;
  const grouped = new Map<string, ItemSuggestion>();

  for (const day of Object.values(state.days)) {
    if (day.date > today) continue;
    for (const entry of day.foods) {
      if (!entry.foodId) continue;
      // Round the weight so 148 g and 150 g of dal are the same habit.
      const bucket = Math.round(entry.grams / 10) * 10;
      const key = `${entry.foodId}:${bucket}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
        if (day.date > existing.lastUsed) {
          existing.lastUsed = day.date;
          existing.meal = entry.meal;
        }
      } else {
        grouped.set(key, {
          key,
          foodId: entry.foodId,
          foodName: entry.foodName,
          grams: entry.grams,
          amountLabel: entry.amountLabel,
          nutrients: entry.nutrients,
          count: 1,
          lastUsed: day.date,
          meal: entry.meal,
          score: 0,
        });
      }
    }
  }

  const suggestions = [...grouped.values()];
  for (const suggestion of suggestions) {
    const decay = 0.5 ** (daysAgo(suggestion.lastUsed, today) / halfLifeDays);
    // A portion eaten at this meal before is worth more when that meal is open.
    const mealBonus = meal && suggestion.meal === meal ? 1.6 : 1;
    suggestion.score = Math.round(suggestion.count * decay * mealBonus * 1000) / 1000;
  }

  return suggestions
    .filter((suggestion) => (meal ? suggestion.score > 0.05 : true))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The most recent day before `today` that has anything logged for this meal. */
export function lastMealOf(state: StoreState, today: string, meal: MealSlot): { date: string; items: FoodEntry[] } | null {
  const candidates = Object.values(state.days)
    .filter((day) => day.date < today && day.foods.some((food) => food.meal === meal))
    .sort((a, b) => b.date.localeCompare(a.date));
  const day = candidates[0];
  if (!day) return null;
  return { date: day.date, items: day.foods.filter((food) => food.meal === meal) };
}

/**
 * Name a logged portion without saying the food twice.
 *
 * A counted food's amount label already contains its name - "2 roti" - so
 * appending the full name gives "2 roti roti (chapati, whole wheat)". A
 * measured one does not: "1 katori" needs "dal tadka" after it.
 */
export function describeEntry(entry: { amountLabel: string; foodName: string }): string {
  const lastWord = entry.amountLabel.trim().split(/\s+/).pop()?.toLowerCase() ?? '';
  const core = (entry.foodName.split(/[,(]/)[0] ?? entry.foodName).trim().toLowerCase();
  if (lastWord && (core === lastWord || core.endsWith(` ${lastWord}`) || core.startsWith(`${lastWord} `))) {
    return entry.amountLabel;
  }
  return `${entry.amountLabel} ${core}`;
}

/** Total energy of a set of entries. */
export function kcalOf(entries: { nutrients: Nutrients }[]): number {
  return Math.round(entries.reduce((sum, entry) => sum + entry.nutrients.kcal, 0));
}

/** A short human summary of a day, for the assistant and for the log view. */
export function describeDay(day: DayLog): string {
  if (day.foods.length === 0 && day.activities.length === 0) return 'nothing logged';
  const foods = day.foods.map(describeEntry).join(', ');
  const training = day.activities.map((a) => `${a.minutes} min ${a.exerciseName.toLowerCase()}`).join(', ');
  const parts: string[] = [];
  if (foods) parts.push(`ate ${foods} (${kcalOf(day.foods)} kcal)`);
  if (training) parts.push(`trained ${training}`);
  if (day.weightKg !== undefined) parts.push(`weighed ${day.weightKg} kg`);
  return parts.join('; ');
}
