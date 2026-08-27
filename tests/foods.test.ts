import { describe, expect, it } from 'vitest';
import { FOODS } from '../src/data/foods.ts';
import { EXERCISES } from '../src/data/exercises.ts';

describe('food table integrity', () => {
  it('has unique ids', () => {
    const ids = FOODS.map((food) => food.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no duplicate names or aliases across foods', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const food of FOODS) {
      for (const name of [food.name, ...food.aliases]) {
        const key = name.toLowerCase();
        const owner = seen.get(key);
        if (owner && owner !== food.id) clashes.push(`"${name}" is claimed by both ${owner} and ${food.id}`);
        seen.set(key, food.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('has plausible energy values', () => {
    for (const food of FOODS) {
      const { kcal, protein, carbs, fat, fiber } = food.per100g;
      expect(kcal, food.id).toBeGreaterThanOrEqual(0);
      expect(kcal, food.id).toBeLessThanOrEqual(900);
      for (const [label, value] of Object.entries({ protein, carbs, fat, fiber })) {
        expect(value, `${food.id} ${label}`).toBeGreaterThanOrEqual(0);
        expect(value, `${food.id} ${label}`).toBeLessThanOrEqual(100);
      }
      expect(protein + carbs + fat, food.id).toBeLessThanOrEqual(101);
    }
  });

  /**
   * Atwater factors: 4 kcal per gram of protein and available carbohydrate,
   * 9 per gram of fat, and about 2 for fibre, which is only partly fermented
   * to something the body can use. Any row that disagrees with its own macros
   * by more than a quarter has a typo in it. Alcohol is excluded because its
   * 7 kcal per gram is not in the macro columns at all.
   */
  it('agrees with its own macros', () => {
    const offenders: string[] = [];
    for (const food of FOODS) {
      if (food.tags.includes('alcohol')) continue;
      const { kcal, protein, carbs, fat, fiber } = food.per100g;
      const available = Math.max(0, carbs - fiber);
      const atwater = protein * 4 + available * 4 + fiber * 2 + fat * 9;
      if (kcal < 25 && atwater < 40) continue;
      const drift = Math.abs(atwater - kcal) / Math.max(kcal, 1);
      if (drift > 0.25) {
        offenders.push(`${food.id}: table says ${kcal} kcal, macros say ${Math.round(atwater)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every countable food a sensible unit weight', () => {
    for (const food of FOODS) {
      if (food.each === undefined) continue;
      expect(food.each, food.id).toBeGreaterThan(0);
      expect(food.each, food.id).toBeLessThan(1000);
    }
  });

  it('covers Indian food properly', () => {
    const indian = FOODS.filter((food) => food.tags.includes('indian'));
    expect(indian.length).toBeGreaterThan(100);
  });
});

describe('exercise table integrity', () => {
  it('has unique ids and sane METs', () => {
    const ids = EXERCISES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const exercise of EXERCISES) {
      expect(exercise.met, exercise.id).toBeGreaterThan(1);
      expect(exercise.met, exercise.id).toBeLessThan(20);
      expect(exercise.defaultMinutes, exercise.id).toBeGreaterThan(0);
    }
  });

  it('keeps speed bands ascending', () => {
    for (const exercise of EXERCISES) {
      if (!exercise.speedBands) continue;
      for (let i = 1; i < exercise.speedBands.length; i += 1) {
        const previous = exercise.speedBands[i - 1] as [number, number];
        const current = exercise.speedBands[i] as [number, number];
        expect(current[0], exercise.id).toBeGreaterThan(previous[0]);
        expect(current[1], exercise.id).toBeGreaterThanOrEqual(previous[1]);
      }
    }
  });
});
