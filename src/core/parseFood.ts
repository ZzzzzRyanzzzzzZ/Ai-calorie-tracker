import { getFood } from '../data/foods.ts';
import { MATCH_THRESHOLD, matchFood } from './match.ts';
import { GENERIC_HOUSEHOLD_ML, type Amount, parseAmount } from './units.ts';
import { type Food, type MealSlot, type Nutrients, ZERO, roundNutrients, scaleNutrients } from './types.ts';

/**
 * Turning a sentence into food rows.
 *
 * "2 rotis, a katori of dal and half a bowl of rice" becomes three entries
 * with weights in grams. Nothing here is a language model: it is an amount
 * parser, a portion table and a fuzzy name matcher, which between them cover
 * the way people actually write down what they ate.
 */

export interface ParsedFoodItem {
  /** The fragment of the input this row came from. */
  text: string;
  foodId: string | null;
  foodName: string;
  grams: number;
  /** "2 roti", "1 katori" - how the amount was expressed. */
  amountLabel: string;
  nutrients: Nutrients;
  confidence: number;
  /** Other foods that nearly matched, best first. */
  alternatives: { id: string; name: string; score: number }[];
  /** Plain-English notes about every assumption made. */
  notes: string[];
  unresolved: boolean;
}

export interface ParsedFoodLine {
  items: ParsedFoodItem[];
  meal: MealSlot | null;
  total: Nutrients;
  /** Combo names that were expanded into several dishes, e.g. "rajma chawal". */
  expandedCombos: string[];
}

const SPLIT_PATTERN = /\s*(?:,|\band\b|\bwith\b|\bplus\b|\+|&|;|\r?\n)\s*/gi;

/** Phrases that are one dish even though they contain a splitting word. */
const PROTECTED = [
  'curd rice', 'salt and pepper', 'sweet and sour', 'fish and chips',
];

/**
 * Meals that are named as one thing but eaten as several.
 *
 * Nobody writes "one katori of rajma and one katori of rice" - they write
 * "rajma chawal". Each combo expands into the plate it actually describes,
 * with the portions a normal serving comes in, and the expansion is reported
 * so it can be seen and corrected.
 */
export const COMBOS: [pattern: string, expansion: string][] = [
  ['veg thali', '3 roti, 1 katori dal, 1 katori mixed vegetable curry, 1 katori rice, 1 katori curd, 1 papad, 1 tsp pickle'],
  ['chicken thali', '3 roti, 1 katori chicken curry, 1 katori dal, 1 katori rice, 1 katori salad'],
  ['thali', '3 roti, 1 katori dal, 1 katori mixed vegetable curry, 1 katori rice, 1 katori curd, 1 papad'],
  ['chole bhature', '1 katori chole, 2 bhatura'],
  ['chana bhatura', '1 katori chole, 2 bhatura'],
  ['rajma chawal', '1 katori rajma, 1 katori rice'],
  ['rajma rice', '1 katori rajma, 1 katori rice'],
  ['chole chawal', '1 katori chole, 1 katori rice'],
  ['dal chawal', '1 katori dal, 1 katori rice'],
  ['daal chawal', '1 katori dal, 1 katori rice'],
  ['dal rice', '1 katori dal, 1 katori rice'],
  ['sambar rice', '1 katori sambar, 1 katori rice'],
  ['dal roti', '1 katori dal, 2 roti'],
  ['roti sabzi', '2 roti, 1 katori mixed vegetable curry'],
  ['pav bhaji', '1 katori bhaji, 2 pav'],
  ['idli sambar', '3 idli, 1 katori sambar'],
  ['idli chutney', '3 idli, 2 tbsp coconut chutney'],
  ['dosa sambar', '1 dosa, 1 katori sambar'],
  ['dosa chutney', '1 dosa, 2 tbsp coconut chutney'],
  ['paratha curd', '1 paratha, 1 katori curd'],
  ['bread omelette', '1 omelette, 2 slice bread'],
  ['chai biscuit', '1 glass chai, 2 biscuit'],
];

/**
 * Replace combo names with the dishes they stand for.
 * Longer names are tried first so "chole bhature" wins over "chole".
 */
export function expandCombos(input: string): { text: string; expanded: string[] } {
  const expanded: string[] = [];
  let text = input;
  const ordered = [...COMBOS].sort((a, b) => b[0].length - a[0].length);
  for (const [name, expansion] of ordered) {
    const pattern = new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'gi');
    if (pattern.test(text)) {
      text = text.replace(pattern, expansion);
      expanded.push(name);
    }
  }
  return { text, expanded };
}

const MEAL_WORDS: [RegExp, MealSlot][] = [
  [/\bbreakfast\b|\bnashta\b|\bmorning\b/i, 'breakfast'],
  [/\blunch\b|\bafternoon\b/i, 'lunch'],
  [/\bdinner\b|\bsupper\b|\bnight\b/i, 'dinner'],
  [/\bsnack\b|\bevening\b|\btea time\b/i, 'snack'],
];

/** Read "had X for lunch" and similar. */
export function detectMeal(text: string): MealSlot | null {
  for (const [pattern, slot] of MEAL_WORDS) if (pattern.test(text)) return slot;
  return null;
}

/** The meal a log entry belongs to when nothing says otherwise. */
export function mealForHour(hour: number): MealSlot {
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 19) return 'snack';
  return 'dinner';
}

/** Break a sentence into one fragment per food, keeping known dishes whole. */
export function splitItems(input: string): string[] {
  let working = input.trim();
  const stash: string[] = [];
  for (const phrase of PROTECTED) {
    const pattern = new RegExp(phrase.replace(/\s+/g, '\\s+'), 'gi');
    working = working.replace(pattern, (hit) => {
      stash.push(hit);
      return ` @@${stash.length - 1}@@ `;
    });
  }
  return working
    .split(SPLIT_PATTERN)
    .map((part) => part.replace(/@@(\d+)@@/g, (_, i: string) => stash[Number(i)] ?? '').trim())
    .filter((part) => part.length > 0 && !/^(of|a|an|the)$/i.test(part));
}

/** One serving of a food, when the person did not say how much. */
export interface DefaultServing {
  grams: number;
  /** The measure that serving is expressed in, for the row's label. */
  unit: string;
  note: string;
}

/** Grams assumed for one serving when the phrase gives no better guidance. */
export function defaultServing(food: Food): DefaultServing {
  if (food.each !== undefined) {
    const unit = coreLabel(food);
    return { grams: food.each, unit, note: `1 ${unit} is about ${food.each} g` };
  }
  if (food.tags.includes('drink')) {
    const glass = food.portions?.glass ?? food.portions?.cup;
    if (glass !== undefined) {
      const unit = food.portions?.glass !== undefined ? 'glass' : 'cup';
      return { grams: glass, unit, note: `one ${unit} is about ${glass} g` };
    }
    const grams = Math.round(240 * (food.density ?? 1));
    return { grams, unit: 'glass', note: `assumed a 240 ml glass (${grams} g)` };
  }
  if (
    food.tags.includes('fat')
    || food.tags.includes('sweetener')
    || food.tags.includes('condiment')
    || food.tags.includes('spread')
  ) {
    const grams = food.portions?.tsp ?? 8;
    return { grams, unit: 'tsp', note: `assumed one teaspoon (${grams} g)` };
  }
  if (food.tags.includes('nuts') || food.tags.includes('seeds')) {
    const grams = food.portions?.handful ?? 25;
    return { grams, unit: 'handful', note: `assumed a handful (${grams} g)` };
  }
  const serving = food.portions?.serving;
  if (serving !== undefined) {
    return { grams: serving, unit: 'serving', note: `one serving is about ${serving} g` };
  }
  const katori = food.portions?.katori;
  if (katori !== undefined) {
    return { grams: katori, unit: 'katori', note: `assumed one katori (${katori} g)` };
  }
  return { grams: 150, unit: 'serving', note: 'assumed a 150 g serving' };
}

/** The short name of a food, for counting: "Rice, cooked (white)" -> "rice". */
function coreLabel(food: Food): string {
  return (food.name.split(/[,(]/)[0] ?? food.name).trim().toLowerCase();
}

export interface ResolvedAmount {
  grams: number;
  /** The measure the row should be labelled with. */
  unit: string | null;
  notes: string[];
}

/** Convert a parsed amount into grams of a specific food. */
export function resolveGrams(food: Food, amount: Amount): ResolvedAmount {
  const notes: string[] = [];
  const size = amount.sizeFactor;

  if (amount.kind === 'mass' && amount.unitSize !== undefined) {
    return { grams: amount.count * amount.unitSize * size, unit: amount.unit, notes };
  }

  if ((amount.kind === 'volume' || amount.kind === 'household') && amount.unit) {
    const tableWeight = food.portions?.[amount.unit];
    if (tableWeight !== undefined) {
      notes.push(`1 ${amount.unit} of ${coreLabel(food)} is about ${tableWeight} g`);
      return { grams: amount.count * tableWeight * size, unit: amount.unit, notes };
    }
    const ml = amount.unitSize ?? GENERIC_HOUSEHOLD_ML[amount.unit];
    if (ml !== undefined) {
      const density = food.density ?? 0.9;
      const total = amount.count * ml * size;
      notes.push(`${Math.round(total)} ml at ${density} g/ml is about ${Math.round(total * density)} g`);
      return { grams: total * density, unit: amount.unit, notes };
    }
  }

  // A bare count: "2 rotis", "an apple".
  if (food.each !== undefined) {
    notes.push(`1 ${coreLabel(food)} is about ${food.each} g`);
    return { grams: amount.count * food.each * size, unit: coreLabel(food), notes };
  }

  const fallback = defaultServing(food);
  notes.push(fallback.note);
  return { grams: amount.count * fallback.grams * size, unit: fallback.unit, notes };
}

/** Parse one fragment, e.g. "2 large rotis". */
export function parseFoodItem(fragment: string): ParsedFoodItem {
  const amount = parseAmount(fragment);
  const phrase = amount.rest.trim() || fragment.trim();
  const matches = matchFood(phrase);
  const best = matches[0];

  if (!best || best.score < MATCH_THRESHOLD) {
    return {
      text: fragment.trim(),
      foodId: null,
      foodName: phrase,
      grams: 0,
      amountLabel: amount.label,
      nutrients: { ...ZERO },
      confidence: best?.score ?? 0,
      alternatives: matches.slice(0, 4).map((m) => ({ id: m.item.id, name: m.item.name, score: m.score })),
      notes: [`No food in the table looks like "${phrase}". Pick one from the list or enter the calories by hand.`],
      unresolved: true,
    };
  }

  const food = best.item;
  const { grams, unit, notes } = resolveGrams(food, amount);
  const nutrients = roundNutrients(scaleNutrients(food.per100g, grams / 100));

  const allNotes = [`matched "${phrase}" to ${food.name} (${best.why})`, ...notes];
  if (amount.assumed) allNotes.push('no amount was given, so one serving was assumed');
  if (best.ignoredWords.length > 0) allNotes.push(`ignored: ${best.ignoredWords.join(', ')}`);

  // The label always names a measure: "2 roti", "1 katori", "250 ml".
  const amountLabel = amount.unit ? amount.label : `${amount.label} ${unit ?? ''}`.trim();

  return {
    text: fragment.trim(),
    foodId: food.id,
    foodName: food.name,
    grams: Math.round(grams),
    amountLabel,
    nutrients,
    confidence: best.score,
    alternatives: matches.slice(1, 4).map((m) => ({ id: m.item.id, name: m.item.name, score: m.score })),
    notes: allNotes,
    unresolved: false,
  };
}

/** Parse a whole line: several foods, and possibly a meal name. */
export function parseFoodLine(input: string): ParsedFoodLine {
  const meal = detectMeal(input);
  const { text, expanded } = expandCombos(input);
  const items = splitItems(text).map(parseFoodItem);
  const total = roundNutrients(
    items.reduce(
      (acc, item) => ({
        kcal: acc.kcal + item.nutrients.kcal,
        protein: acc.protein + item.nutrients.protein,
        carbs: acc.carbs + item.nutrients.carbs,
        fat: acc.fat + item.nutrients.fat,
        fiber: acc.fiber + item.nutrients.fiber,
      }),
      { ...ZERO },
    ),
  );
  return { items, meal, total, expandedCombos: expanded };
}

/** Recompute a row after someone corrects the food or the weight by hand. */
export function recalculate(foodId: string, grams: number): Nutrients {
  const food = getFood(foodId);
  if (!food) return { ...ZERO };
  return roundNutrients(scaleNutrients(food.per100g, grams / 100));
}
