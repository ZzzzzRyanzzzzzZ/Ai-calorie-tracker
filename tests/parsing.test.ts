import { describe, expect, it } from 'vitest';
import { diceSimilarity, phoneticFold, singular, tokenize, tokensMatch } from '../src/core/text.ts';
import { parseAmount } from '../src/core/units.ts';
import { expandCombos, parseFoodItem, parseFoodLine, splitItems } from '../src/core/parseFood.ts';
import { matchFood } from '../src/core/match.ts';

describe('phonetic folding', () => {
  it('collapses the transliterations of the same word', () => {
    expect(phoneticFold('dal')).toBe(phoneticFold('daal'));
    expect(phoneticFold('dal')).toBe(phoneticFold('dhal'));
    expect(phoneticFold('chana')).toBe(phoneticFold('channa'));
    expect(phoneticFold('roti')).toBe(phoneticFold('rotti'));
    expect(phoneticFold('paratha')).toBe(phoneticFold('parantha').replace('n', ''));
    expect(phoneticFold('bhindi')).toBe(phoneticFold('bindi'));
  });

  it('keeps genuinely different words apart', () => {
    expect(phoneticFold('dal')).not.toBe(phoneticFold('dahi'));
    expect(phoneticFold('rice')).not.toBe(phoneticFold('roti'));
    expect(phoneticFold('paneer')).not.toBe(phoneticFold('peanut'));
  });

  it('matches tokens one typo apart', () => {
    expect(tokensMatch('paneer', 'panner')).toBe(true);
    expect(tokensMatch('biryani', 'biriyani')).toBe(true);
    expect(tokensMatch('rice', 'ride')).toBe(false);
  });
});

describe('tokenizing', () => {
  it('singularises without mangling', () => {
    expect(singular('rotis')).toBe('roti');
    expect(singular('samosas')).toBe('samosa');
    expect(singular('glasses')).toBe('glass');
    expect(singular('rice')).toBe('rice');
    expect(singular('hummus')).toBe('hummus');
  });

  it('drops filler words', () => {
    expect(tokenize('some of the dal')).toEqual(['dal']);
    expect(tokenize('I had 2 rotis for lunch')).toEqual(['2', 'roti']);
  });

  it('scores string similarity', () => {
    expect(diceSimilarity('paneer', 'paneer')).toBe(1);
    expect(diceSimilarity('paneer', 'paner')).toBeGreaterThan(0.7);
    expect(diceSimilarity('paneer', 'biryani')).toBeLessThan(0.3);
  });
});

describe('amount parsing', () => {
  it('reads plain counts', () => {
    expect(parseAmount('2 rotis')).toMatchObject({ count: 2, unit: null, rest: 'rotis' });
    expect(parseAmount('an apple')).toMatchObject({ count: 1, rest: 'apple' });
  });

  it('reads fractions in every form people write them', () => {
    expect(parseAmount('1/2 katori dal').count).toBe(0.5);
    expect(parseAmount('half a katori dal').count).toBe(0.5);
    expect(parseAmount('1 1/2 cups rice').count).toBe(1.5);
    expect(parseAmount('1.5 cups rice').count).toBe(1.5);
  });

  it('reads units, glued or spaced', () => {
    expect(parseAmount('200g paneer')).toMatchObject({ count: 200, unit: 'g', rest: 'paneer' });
    expect(parseAmount('200 g paneer')).toMatchObject({ count: 200, unit: 'g', rest: 'paneer' });
    expect(parseAmount('1 katori of dal')).toMatchObject({ count: 1, unit: 'katori', rest: 'dal' });
  });

  it('reads size adjectives', () => {
    expect(parseAmount('1 large paratha').sizeFactor).toBeGreaterThan(1);
    expect(parseAmount('a small bowl of rice').sizeFactor).toBeLessThan(1);
  });

  it('finds an amount that is not at the front', () => {
    expect(parseAmount('aaj maine 2 chapati khai').count).toBe(2);
    expect(parseAmount('gulab jamun 2').count).toBe(2);
  });

  it('leaves a number that is part of the dish name alone', () => {
    expect(parseAmount('chicken 65').count).toBe(1);
  });

  it('reads a measure that trails the food', () => {
    expect(parseAmount('chicken biryani plate')).toMatchObject({ unit: 'plate' });
  });
});

describe('splitting a log line', () => {
  it('splits on the usual separators', () => {
    expect(splitItems('2 rotis, dal and rice')).toEqual(['2 rotis', 'dal', 'rice']);
    expect(splitItems('toast with butter')).toEqual(['toast', 'butter']);
  });

  it('keeps protected dish names whole', () => {
    expect(splitItems('curd rice')).toEqual(['curd rice']);
  });

  it('expands combo meals into their parts', () => {
    const { text, expanded } = expandCombos('rajma chawal');
    expect(expanded).toContain('rajma chawal');
    expect(text).toContain('rajma');
    expect(text).toContain('rice');
  });

  it('prefers the longer combo name', () => {
    const { expanded } = expandCombos('chole bhature');
    expect(expanded).toEqual(['chole bhature']);
  });
});

describe('matching foods', () => {
  it('finds the obvious ones exactly', () => {
    expect(matchFood('roti')[0]?.item.id).toBe('roti');
    expect(matchFood('paneer butter masala')[0]?.item.id).toBe('paneer-butter-masala');
    expect(matchFood('chicken biryani')[0]?.item.id).toBe('chicken-biryani');
  });

  it('prefers the generic entry over a more specific one', () => {
    expect(matchFood('rice')[0]?.item.id).toBe('rice');
    expect(matchFood('bread')[0]?.item.id).toBe('bread-white');
    expect(matchFood('milk')[0]?.item.id).toBe('milk-full');
  });

  it('survives spelling', () => {
    expect(matchFood('palak paner')[0]?.item.id).toBe('palak-paneer');
    expect(matchFood('daal')[0]?.item.id).toBe('dal-tadka');
    expect(matchFood('biriyani')[0]?.item.id).toBe('chicken-biryani');
  });

  it('ignores words no food has ever heard of', () => {
    const [best] = matchFood('amma ka dal');
    expect(best?.item.id).toBe('dal-tadka');
    expect(best?.ignoredWords).toContain('amma');
  });

  it('refuses to guess at nonsense', () => {
    const [best] = matchFood('qwertyuiop');
    expect(best === undefined || best.score < 0.5).toBe(true);
  });
});

describe('parsing a whole meal', () => {
  it('handles a normal Indian plate', () => {
    const result = parseFoodLine('2 rotis, a katori of dal and half a bowl of rice');
    expect(result.items).toHaveLength(3);
    expect(result.items.map((i) => i.foodId)).toEqual(['roti', 'dal-tadka', 'rice']);
    expect(result.items[0]?.grams).toBe(80);
    expect(result.total.kcal).toBeGreaterThan(400);
    expect(result.total.kcal).toBeLessThan(700);
  });

  it('expands a thali into its parts', () => {
    const result = parseFoodLine('veg thali');
    expect(result.expandedCombos).toContain('veg thali');
    expect(result.items.length).toBeGreaterThan(5);
    expect(result.total.kcal).toBeGreaterThan(600);
  });

  it('uses the right weight for a counted item', () => {
    const item = parseFoodItem('3 idli');
    expect(item.foodId).toBe('idli');
    expect(item.grams).toBe(135);
    expect(item.amountLabel).toBe('3 idli');
  });

  it('scales with the size adjective', () => {
    const small = parseFoodItem('1 small paratha');
    const large = parseFoodItem('1 large paratha');
    expect(large.grams).toBeGreaterThan(small.grams);
    expect(large.nutrients.kcal).toBeGreaterThan(small.nutrients.kcal);
  });

  it('takes a weight literally when one is given', () => {
    const item = parseFoodItem('200g chicken breast');
    expect(item.grams).toBe(200);
    expect(item.nutrients.protein).toBeCloseTo(62, 0);
  });

  it('reports what it could not understand instead of inventing calories', () => {
    const item = parseFoodItem('1 plate of zzzxqq');
    expect(item.unresolved).toBe(true);
    expect(item.nutrients.kcal).toBe(0);
  });

  it('explains every assumption it made', () => {
    const item = parseFoodItem('dal');
    expect(item.notes.join(' ')).toMatch(/matched/);
    expect(item.notes.join(' ')).toMatch(/serving|katori/);
  });

  it('reads the meal out of the sentence', () => {
    expect(parseFoodLine('2 idli for breakfast').meal).toBe('breakfast');
    expect(parseFoodLine('chicken curry for dinner').meal).toBe('dinner');
  });
});
