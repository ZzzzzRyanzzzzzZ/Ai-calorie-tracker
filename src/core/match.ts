import { FOODS } from '../data/foods.ts';
import type { Food } from './types.ts';
import {
  PREP_WORDS,
  diceSimilarity,
  foldTokens,
  phoneticFold,
  tokenize,
  tokensMatch,
} from './text.ts';

/**
 * Fuzzy lookup of a food (or any other named thing) from a free-text phrase.
 *
 * The matcher is deliberately explainable: every result carries the string it
 * matched on and a sentence describing why, so the interface can show its
 * working instead of asking people to trust a number.
 */

export interface Candidate<T> {
  item: T;
  /** Strings that identify this item: its name first, then its aliases. */
  names: string[];
}

export interface MatchResult<T> {
  item: T;
  /** 0-1 confidence. Above 0.9 is effectively certain. */
  score: number;
  /** Which of the item's names produced the score. */
  matchedOn: string;
  why: string;
}

/** The part of a name before any comma or bracket: "Rice, cooked (white)" -> "Rice". */
export function coreName(name: string): string {
  const cut = name.split(/[,(]/)[0] ?? name;
  return cut.trim();
}

function foldPhrase(input: string): string {
  return foldTokens(input).join('');
}

/**
 * How well one query token is covered by the candidate's tokens.
 * 1 for the same word, 0.6 for a clear prefix (dal / dalia), else 0.
 */
function tokenCoverage(queryToken: string, candidateTokens: string[]): number {
  let best = 0;
  for (const ct of candidateTokens) {
    if (tokensMatch(queryToken, ct)) return 1;
    if (queryToken.length >= 4 && ct.startsWith(queryToken)) best = Math.max(best, 0.6);
    else if (ct.length >= 4 && queryToken.startsWith(ct)) best = Math.max(best, 0.5);
  }
  return best;
}

interface ScoreDetail {
  score: number;
  reason: string;
}

function scoreName(queryTokens: string[], queryFold: string, name: string, isPrimary: boolean): ScoreDetail {
  const nameTokens = foldTokens(name);
  if (nameTokens.length === 0) return { score: 0, reason: '' };

  const nameFold = nameTokens.join('');
  const coreFold = foldPhrase(coreName(name));

  if (queryFold === coreFold) {
    return {
      score: isPrimary ? 1 : 0.985,
      reason: isPrimary ? 'exact name match' : 'exact match on a known alias',
    };
  }
  if (queryFold === nameFold) {
    return { score: isPrimary ? 0.985 : 0.97, reason: 'exact match on the full name' };
  }

  let covered = 0;
  for (const qt of queryTokens) covered += tokenCoverage(qt, nameTokens);
  const recall = covered / queryTokens.length;

  let backCovered = 0;
  for (const nt of nameTokens) backCovered += tokenCoverage(nt, queryTokens);
  const precision = backCovered / nameTokens.length;

  const f1 = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
  const dice = diceSimilarity(queryFold, nameFold);
  let score = 0.66 * f1 + 0.34 * dice;

  // Every word the person typed is present: this is the food, just described
  // less specifically than the database names it.
  if (recall > 0.999) {
    score = Math.max(score, 0.72 + 0.16 * precision);
  }

  // Preparation words that appear on both sides are real evidence.
  const namePrep = new Set(tokenize(name).filter((t) => PREP_WORDS.has(t)).map(phoneticFold));
  let prepBonus = 0;
  for (const qt of queryTokens) if (namePrep.has(qt)) prepBonus += 0.03;
  score += Math.min(prepBonus, 0.09);

  // Prefer the shorter of two otherwise equal names.
  score += 0.01 / nameTokens.length;

  const reason = recall > 0.999
    ? `every word you typed appears in "${name}"`
    : `${Math.round(recall * 100)}% of your words matched "${name}"`;
  return { score: Math.min(score, 0.95), reason };
}

/** Rank candidates against a phrase. Results are sorted best first. */
export function rank<T>(phrase: string, candidates: Candidate<T>[], limit = 5): MatchResult<T>[] {
  const queryTokens = foldTokens(phrase);
  if (queryTokens.length === 0) return [];
  const queryFold = queryTokens.join('');

  const results: MatchResult<T>[] = [];
  for (const candidate of candidates) {
    let best: MatchResult<T> | null = null;
    candidate.names.forEach((name, index) => {
      const { score, reason } = scoreName(queryTokens, queryFold, name, index === 0);
      if (score > 0 && (best === null || score > best.score)) {
        best = { item: candidate.item, score, matchedOn: name, why: reason };
      }
    });
    if (best !== null) results.push(best);
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

let vocabulary: Set<string> | null = null;

/** Every folded word that appears anywhere in the food table. */
export function foodVocabulary(): Set<string> {
  if (vocabulary) return vocabulary;
  const set = new Set<string>();
  for (const food of FOODS) {
    for (const name of [food.name, ...food.aliases]) {
      for (const token of foldTokens(name)) {
        // A one or two letter fragment identifies nothing. Letting "ka" into
        // the vocabulary made "bhutte ka kees" look like a known dish because
        // one connective in the middle of it happened to appear in a name.
        if (token.length > 2) set.add(token);
      }
    }
  }
  vocabulary = set;
  return set;
}

let foodCandidates: Candidate<Food>[] | null = null;

function candidates(): Candidate<Food>[] {
  if (!foodCandidates) {
    foodCandidates = FOODS.map((food) => ({ item: food, names: [food.name, ...food.aliases] }));
  }
  return foodCandidates;
}

export interface FoodMatch extends MatchResult<Food> {
  /** Words in the phrase that no food in the table has ever heard of. */
  ignoredWords: string[];
  /**
   * True when not one word in the phrase was a known food word, so this result
   * came from fuzzy spelling alone and is a suggestion rather than an answer.
   */
  guessed: boolean;
}

/**
 * How close a pure-spelling guess must be before it is treated as a real match.
 *
 * A word the table has never seen is usually a food that is genuinely missing,
 * not a typo. Edit distance is happy to call "tindori" a misspelling of
 * "tandoori" - one vowel apart, and a completely different dish - so a match
 * found this way has to be near-exact before it is asserted. Anything less is
 * demoted to a suggestion, and the person is asked instead of being told.
 */
const GUESS_THRESHOLD = 0.9;

/**
 * Match a food phrase. Words that appear nowhere in the food table are dropped
 * before scoring, so "some of amma's dal" scores as well as "dal" does.
 */
export function matchFood(phrase: string, limit = 5): FoodMatch[] {
  const vocab = foodVocabulary();
  const raw = tokenize(phrase);
  const kept: string[] = [];
  const ignored: string[] = [];
  for (const token of raw) {
    if (vocab.has(phoneticFold(token))) kept.push(token);
    else ignored.push(token);
  }

  // If nothing is recognisable, still try the original phrase: the fuzzy
  // scorer may find a near-miss spelling the vocabulary check rejected.
  const guessed = kept.length === 0;
  const query = guessed ? phrase : kept.join(' ');
  const results = rank(query, candidates(), limit);

  // A guess that is not near-certain is demoted below the acceptance
  // threshold, so it is offered as "did you mean" rather than logged silently.
  const confident = (results[0]?.score ?? 0) >= GUESS_THRESHOLD;
  const penalty = guessed && !confident ? 0.5 : 1;

  return results.map((result) => ({
    ...result,
    score: result.score * penalty,
    ignoredWords: ignored,
    guessed,
  }));
}

/** Below this, we say we did not recognise the food rather than guess. */
export const MATCH_THRESHOLD = 0.5;
