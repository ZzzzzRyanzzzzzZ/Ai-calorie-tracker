/**
 * Text normalisation for food and exercise names.
 *
 * The hard part of matching Indian food is not spelling mistakes, it is that
 * there is no single correct spelling. "Dal", "daal" and "dhal" are the same
 * word; so are "chana", "channa" and "chhana"; so are "roti" and "rotti".
 * Rather than enumerate every variant as an alias, we fold both the query and
 * the candidate through the same lossy transliteration and compare the folds.
 * Any rule applied to both sides is safe even when it is linguistically crude.
 */

const DIACRITICS = /[\u0300-\u036f]/g;

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/.'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Consonants after which an 'h' is a transliteration artefact, not a sound. */
const ASPIRATED = /([bdgjkptv])h/g;

/**
 * Reduce a word to a spelling-insensitive skeleton. Lossy on purpose: applied
 * to both sides of a comparison it turns spelling variance into an exact match.
 */
export function phoneticFold(word: string): string {
  let w = normalize(word).replace(/[^a-z0-9]/g, '');
  if (!w) return '';
  w = w.replace(/ph/g, 'f');
  w = w.replace(ASPIRATED, '$1');
  w = w.replace(/ck/g, 'k');
  w = w.replace(/(.)\1+/g, '$1'); // channa -> chana, daal -> dal
  w = w.replace(/z/g, 'j'); // pizza/pija is fine: both sides fold alike
  w = w.replace(/y$/g, 'i'); // curry -> curri, chai stays chai
  return w;
}

/** Words that carry no identifying information in a food phrase. */
export const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'of', 'some', 'my', 'more', 'little', 'bit', 'piece', 'pieces',
  'homemade', 'home', 'made', 'fresh', 'hot', 'cold', 'leftover', 'plain-ish',
  'about', 'approx', 'around', 'roughly', 'ate', 'eat', 'had', 'having', 'i', 'today',
  'for', 'breakfast', 'lunch', 'dinner', 'snack', 'this', 'morning', 'evening',
  'night', 'was', 'were', 'is', 'and', 'also', 'then', 'just', 'only',
]);

/**
 * Preparation words that genuinely change the food. These are never dropped,
 * and a candidate that mentions one gets a bonus when the query does too.
 */
export const PREP_WORDS = new Set([
  'fried', 'deep', 'shallow', 'grilled', 'roasted', 'tandoori', 'boiled', 'raw',
  'steamed', 'baked', 'butter', 'ghee', 'masala', 'stuffed', 'dry', 'gravy',
  'sweet', 'salted', 'toasted', 'skimmed', 'toned', 'whole', 'brown', 'white',
  'red', 'green', 'black', 'double', 'egg', 'chicken', 'mutton', 'paneer', 'veg',
  'vegetable', 'fish', 'prawn', 'diet', 'zero', 'sugar', 'free', 'grain', 'wheat',
]);

const IRREGULAR_PLURALS: Record<string, string> = {
  leaves: 'leaf',
  loaves: 'loaf',
  halves: 'half',
  potatoes: 'potato',
  tomatoes: 'tomato',
  mangoes: 'mango',
  rotis: 'roti',
  chapatis: 'chapati',
  idlis: 'idli',
  dosas: 'dosa',
  samosas: 'samosa',
  parathas: 'paratha',
  katoris: 'katori',
};

/** Strip a plural 's' without mangling words that legitimately end in one. */
export function singular(word: string): string {
  const w = word.toLowerCase();
  const irregular = IRREGULAR_PLURALS[w];
  if (irregular) return irregular;
  if (w.length <= 3) return w;
  if (/(ss|us|is|as)$/.test(w)) return w;
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(ch|sh|x|z|s)es$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Split into meaningful, singularised tokens with filler words removed. */
export function tokenize(input: string): string[] {
  return normalize(input)
    .split(/[\s/]+/)
    .map((t) => t.replace(/^[-'.]+|[-'.]+$/g, ''))
    .filter(Boolean)
    .map(singular)
    .filter((t) => !FILLER_WORDS.has(t));
}

/** Tokens folded for spelling-insensitive comparison. */
export function foldTokens(input: string): string[] {
  return tokenize(input).map(phoneticFold).filter(Boolean);
}

/** Character bigrams of a string, used for Dice similarity. */
export function bigrams(input: string): string[] {
  const s = input.replace(/\s+/g, '');
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
  return out;
}

/** Sørensen-Dice coefficient over character bigrams. 0-1. */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of B) {
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      hits += 1;
      counts.set(g, n - 1);
    }
  }
  return (2 * hits) / (A.length + B.length);
}

/** Levenshtein distance, abandoned early once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (row[j - 1] as number) + 1,
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length] as number;
}

/** Two tokens are "the same word" if they fold alike or are one typo apart. */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const fa = phoneticFold(a);
  const fb = phoneticFold(b);
  if (fa === fb) return true;
  // Below five letters a single edit is more likely to be a different word
  // than a typo: rice and ride, milk and silk, corn and cork.
  const len = Math.min(fa.length, fb.length);
  if (len < 5) return false;
  const allowed = len >= 7 ? 2 : 1;
  return editDistance(fa, fb, allowed) <= allowed;
}
