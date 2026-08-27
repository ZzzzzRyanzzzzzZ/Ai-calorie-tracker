/** Parsing of the amount at the front of a food phrase: "2 rotis", "1/2 katori". */

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12,
  half: 0.5, quarter: 0.25, couple: 2, few: 3, several: 3,
};

const VULGAR_FRACTIONS: Record<string, number> = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅙': 1 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

export type UnitKind = 'mass' | 'volume' | 'household' | 'count';

export interface UnitDef {
  /** Canonical name used in labels and in a food's `portions` table. */
  name: string;
  kind: UnitKind;
  /** Grams (mass) or millilitres (volume) in one unit. */
  size?: number;
}

const UNITS: Record<string, UnitDef> = {
  g: { name: 'g', kind: 'mass', size: 1 },
  gm: { name: 'g', kind: 'mass', size: 1 },
  gms: { name: 'g', kind: 'mass', size: 1 },
  gram: { name: 'g', kind: 'mass', size: 1 },
  grams: { name: 'g', kind: 'mass', size: 1 },
  kg: { name: 'kg', kind: 'mass', size: 1000 },
  kilo: { name: 'kg', kind: 'mass', size: 1000 },
  kilos: { name: 'kg', kind: 'mass', size: 1000 },
  kilogram: { name: 'kg', kind: 'mass', size: 1000 },
  oz: { name: 'oz', kind: 'mass', size: 28.35 },
  ounce: { name: 'oz', kind: 'mass', size: 28.35 },
  ounces: { name: 'oz', kind: 'mass', size: 28.35 },
  lb: { name: 'lb', kind: 'mass', size: 453.6 },
  lbs: { name: 'lb', kind: 'mass', size: 453.6 },
  pound: { name: 'lb', kind: 'mass', size: 453.6 },
  pounds: { name: 'lb', kind: 'mass', size: 453.6 },

  ml: { name: 'ml', kind: 'volume', size: 1 },
  l: { name: 'l', kind: 'volume', size: 1000 },
  litre: { name: 'l', kind: 'volume', size: 1000 },
  litres: { name: 'l', kind: 'volume', size: 1000 },
  liter: { name: 'l', kind: 'volume', size: 1000 },
  cup: { name: 'cup', kind: 'volume', size: 240 },
  cups: { name: 'cup', kind: 'volume', size: 240 },
  tbsp: { name: 'tbsp', kind: 'volume', size: 15 },
  tablespoon: { name: 'tbsp', kind: 'volume', size: 15 },
  tablespoons: { name: 'tbsp', kind: 'volume', size: 15 },
  tsp: { name: 'tsp', kind: 'volume', size: 5 },
  teaspoon: { name: 'tsp', kind: 'volume', size: 5 },
  teaspoons: { name: 'tsp', kind: 'volume', size: 5 },

  katori: { name: 'katori', kind: 'household' },
  katoris: { name: 'katori', kind: 'household' },
  bowl: { name: 'bowl', kind: 'household' },
  bowls: { name: 'bowl', kind: 'household' },
  plate: { name: 'plate', kind: 'household' },
  plates: { name: 'plate', kind: 'household' },
  glass: { name: 'glass', kind: 'household' },
  glasses: { name: 'glass', kind: 'household' },
  mug: { name: 'mug', kind: 'household' },
  slice: { name: 'slice', kind: 'household' },
  slices: { name: 'slice', kind: 'household' },
  scoop: { name: 'scoop', kind: 'household' },
  scoops: { name: 'scoop', kind: 'household' },
  handful: { name: 'handful', kind: 'household' },
  handfuls: { name: 'handful', kind: 'household' },
  packet: { name: 'packet', kind: 'household' },
  pack: { name: 'packet', kind: 'household' },
  bottle: { name: 'bottle', kind: 'household' },
  can: { name: 'can', kind: 'household' },
  tin: { name: 'can', kind: 'household' },
  peg: { name: 'peg', kind: 'household' },
  pegs: { name: 'peg', kind: 'household' },
  pint: { name: 'pint', kind: 'household' },
  pints: { name: 'pint', kind: 'household' },
  serving: { name: 'serving', kind: 'household' },
  servings: { name: 'serving', kind: 'household' },
  portion: { name: 'serving', kind: 'household' },
  helping: { name: 'serving', kind: 'household' },
  spoon: { name: 'tbsp', kind: 'volume', size: 15 },
  spoons: { name: 'tbsp', kind: 'volume', size: 15 },
};

/** Household measures that are the same size whatever is in them. */
export const GENERIC_HOUSEHOLD_ML: Record<string, number> = {
  katori: 150,
  bowl: 300,
  plate: 350,
  glass: 240,
  mug: 300,
  serving: 200,
  handful: 30,
  scoop: 30,
  packet: 45,
  bottle: 500,
  can: 330,
  slice: 30,
  peg: 30,
  pint: 500,
};

const SIZE_WORDS: Record<string, number> = {
  tiny: 0.6, small: 0.75, little: 0.75, medium: 1, regular: 1, normal: 1,
  standard: 1, big: 1.35, large: 1.35, heaped: 1.35, full: 1.15, huge: 1.6,
  giant: 1.6, jumbo: 1.6,
};

export interface Amount {
  /** How many units. Always positive. */
  count: number;
  /** Canonical unit name, or null when the phrase was a bare count. */
  unit: string | null;
  kind: UnitKind;
  /** Multiplier from a size adjective, e.g. "large" -> 1.35. */
  sizeFactor: number;
  /** Millilitres or grams per unit, when the unit has a fixed size. */
  unitSize?: number;
  /** True when nothing numeric was written and we assumed one serving. */
  assumed: boolean;
  /** The rest of the phrase, with the amount removed. */
  rest: string;
  /** Human-readable rendering of what was understood. */
  label: string;
}

/** Parse "1 1/2", "½", "two", "2.5" from the front of a token list. */
function readCount(tokens: string[]): { value: number; consumed: number } | null {
  const first = tokens[0];
  if (first === undefined) return null;

  const vulgar = VULGAR_FRACTIONS[first];
  if (vulgar !== undefined) return { value: vulgar, consumed: 1 };

  const fractionMatch = /^(\d+)\/(\d+)$/.exec(first);
  if (fractionMatch) {
    const num = Number(fractionMatch[1]);
    const den = Number(fractionMatch[2]);
    if (den !== 0) return { value: num / den, consumed: 1 };
  }

  if (/^\d+(\.\d+)?$/.test(first)) {
    const whole = Number(first);
    const second = tokens[1];
    if (second !== undefined) {
      const mixedVulgar = VULGAR_FRACTIONS[second];
      if (mixedVulgar !== undefined) return { value: whole + mixedVulgar, consumed: 2 };
      const mixed = /^(\d+)\/(\d+)$/.exec(second);
      if (mixed) {
        const den = Number(mixed[2]);
        if (den !== 0) return { value: whole + Number(mixed[1]) / den, consumed: 2 };
      }
    }
    return { value: whole, consumed: 1 };
  }

  // "1kg", "200g", "500ml" written without a space.
  const glued = /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(first);
  if (glued && UNITS[glued[2] as string]) return { value: Number(glued[1]), consumed: 0.5 };

  const word = NUMBER_WORDS[first];
  if (word !== undefined) {
    if (first === 'half' || first === 'quarter') {
      // "half a katori" — swallow the article that usually follows.
      const consumed = tokens[1] === 'a' || tokens[1] === 'an' ? 2 : 1;
      return { value: word, consumed };
    }
    return { value: word, consumed: 1 };
  }
  return null;
}

/** Look up a unit token, tolerating a trailing period ("tbsp."). */
export function lookupUnit(token: string): UnitDef | null {
  return UNITS[token.replace(/\.$/, '')] ?? null;
}

export function isUnitWord(token: string): boolean {
  return lookupUnit(token) !== null;
}

function formatCount(n: number): string {
  if (Math.abs(n - 0.5) < 1e-9) return '½';
  if (Math.abs(n - 0.25) < 1e-9) return '¼';
  if (Math.abs(n - 0.75) < 1e-9) return '¾';
  if (Math.abs(n - 1.5) < 1e-9) return '1½';
  return String(Math.round(n * 100) / 100);
}

/**
 * Pull the leading amount off a food phrase.
 * "2 large rotis" -> { count: 2, unit: null, sizeFactor: 1.35, rest: "rotis" }
 */
export function parseAmount(phrase: string): Amount {
  const cleaned = phrase
    .toLowerCase()
    .replace(/([½⅓⅔¼¾⅕⅙⅛⅜⅝⅞])/g, ' $1 ')
    .replace(/(\d)\s*-\s*(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  let tokens = cleaned.split(' ').filter(Boolean);

  let count = 1;
  let assumed = true;

  let read = readCount(tokens);
  if (!read) {
    // The amount is not at the front: "aaj 2 chapati khaye", "gulab jamun 2".
    // Only small counts, or numbers followed by a unit, qualify — so a number
    // that is part of a dish name ("chicken 65") is left where it is.
    for (let i = 1; i < tokens.length; i += 1) {
      const found = readCount(tokens.slice(i));
      if (!found || found.consumed === 0.5) continue;
      const after = i + found.consumed;
      const next = tokens[after];
      const followedByUnit = next !== undefined && isUnitWord(next);
      if (found.value > 20 && !followedByUnit) continue;
      const end = followedByUnit ? after + 1 : after;
      tokens = [...tokens.slice(i, end), ...tokens.slice(0, i), ...tokens.slice(end)];
      read = found;
      break;
    }
  }
  if (read) {
    count = read.value;
    assumed = false;
    if (read.consumed === 0.5) {
      // Split "200g" into its number and unit halves.
      const glued = /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(tokens[0] as string);
      tokens = [glued?.[2] as string, ...tokens.slice(1)];
    } else {
      tokens = tokens.slice(read.consumed);
    }
  }

  let sizeFactor = 1;
  while (tokens.length > 0 && SIZE_WORDS[tokens[0] as string] !== undefined) {
    sizeFactor *= SIZE_WORDS[tokens[0] as string] as number;
    tokens = tokens.slice(1);
  }

  let unit: string | null = null;
  let kind: UnitKind = 'count';
  let unitSize: number | undefined;

  const unitDef = tokens.length > 0 ? lookupUnit(tokens[0] as string) : null;
  if (unitDef) {
    unit = unitDef.name;
    kind = unitDef.kind;
    unitSize = unitDef.size;
    tokens = tokens.slice(1);
    if (tokens[0] === 'of') tokens = tokens.slice(1);
  }

  // A size word can also sit after the unit: "1 cup large".
  while (tokens.length > 0 && SIZE_WORDS[tokens[0] as string] !== undefined) {
    sizeFactor *= SIZE_WORDS[tokens[0] as string] as number;
    tokens = tokens.slice(1);
  }

  // The measure often trails the food instead: "chicken biryani plate",
  // "dal katori", "coke bottle".
  if (unit === null && tokens.length > 1) {
    const last = lookupUnit(tokens[tokens.length - 1] as string);
    if (last) {
      unit = last.name;
      kind = last.kind;
      unitSize = last.size;
      tokens = tokens.slice(0, -1);
    }
  }

  const rest = tokens.join(' ').trim();
  const sizeLabel = sizeFactor === 1 ? '' : `${Object.keys(SIZE_WORDS).find((k) => SIZE_WORDS[k] === sizeFactor) ?? ''} `;
  const label = unit
    ? `${formatCount(count)} ${sizeLabel}${unit}`.trim()
    : `${formatCount(count)} ${sizeLabel}`.trim();

  return { count, unit, kind, sizeFactor, unitSize, assumed, rest, label };
}

export function kgToLb(kg: number): number {
  return kg / 0.45359237;
}

export function lbToKg(lb: number): number {
  return lb * 0.45359237;
}

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  return { feet, inches: Math.round(totalInches - feet * 12) };
}
