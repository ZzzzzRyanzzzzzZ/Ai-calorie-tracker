import { estimateMaintenance } from '../core/adaptive.ts';
import { coach, progressionAdvice } from '../core/coach.ts';
import { ACTIVITY_LABELS, balanceFor, defaultRateFor, planFor } from '../core/energy.ts';
import { mealForHour, parseFoodLine, recalculate } from '../core/parseFood.ts';
import { parseActivityLine, recalculateActivity } from '../core/parseExercise.ts';
import {
  dailyRecords,
  dayOf,
  exportCsv,
  exportJson,
  importJson,
  load,
  newId,
  save,
  today as todayIso,
  totalsFor,
  burnedNet,
  emptyState,
  type StoreState,
} from '../core/store.ts';
import type {
  ActivityEntry,
  ActivityLevel,
  DayLog,
  Equipment,
  FoodEntry,
  Goal,
  MealSlot,
  Profile,
} from '../core/types.ts';
import { FOODS } from '../data/foods.ts';
import { getApiKey } from '../ai/gemini.ts';
import type { ToolContext } from '../ai/tools.ts';
import { kcalOf, lastMealOf, suggestItems } from '../core/history.ts';
import { type ChatState, chatTab, emptyChat } from './chat.ts';
import { intakeChart, weightChart } from './charts.ts';
import { append, clear, debounce, el, formatDate, formatNumber, shiftDate } from './dom.ts';

type Tab = 'today' | 'chat' | 'coach' | 'trends' | 'profile';

/** A tab is a list of cards, some of which may not apply today. */
type Section = HTMLElement | null;

const MEAL_ORDER: MealSlot[] = ['breakfast', 'lunch', 'snack', 'dinner'];
const MEAL_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snack: 'Snacks',
  dinner: 'Dinner',
};

const FOOD_EXAMPLES = [
  '2 rotis, a katori of dal and half a bowl of rice',
  '3 idli with sambar and coconut chutney',
  'chicken biryani plate and a glass of chaas',
  'veg thali',
  '2 eggs, 2 slices brown bread with butter',
];

const TRAINING_EXAMPLES = [
  'ran 5k in 27 min',
  '45 min gym, bench press 4x8 at 50kg',
  '10000 steps',
  '30 min cycling and 20 min yoga',
];

interface UiState {
  tab: Tab;
  date: string;
  foodDraft: string;
  trainingDraft: string;
  editingFood: string | null;
  editingActivity: string | null;
  message: string | null;
  chat: ChatState;
}

let state: StoreState = load();
const ui: UiState = {
  tab: 'today',
  date: todayIso(),
  foodDraft: '',
  trainingDraft: '',
  editingFood: null,
  editingActivity: null,
  message: null,
  chat: emptyChat(),
};

function persist(): void {
  if (!save(state)) {
    ui.message = 'This browser will not let the app save. The log will disappear when you close the tab.';
  }
}

function currentDay(): DayLog {
  return dayOf(state, ui.date);
}

/** What the assistant's tools operate on. Read fresh each turn. */
function toolContext(): ToolContext {
  return { state, today: todayIso(), hour: new Date().getHours() };
}

function plan() {
  const records = dailyRecords(state);
  const formula = planFor(state.profile);
  const estimate = estimateMaintenance(records, formula.tdee, 42, formula.bmr);
  // Once the log can measure maintenance, the target is rebuilt around it -
  // unless the measurement came out below resting, which means under-logging.
  const usable = estimate.confidence !== 'none' && !estimate.underReported;
  const measured = usable ? estimate.maintenance ?? undefined : undefined;
  return { plan: measured ? planFor(state.profile, measured) : formula, estimate, formula };
}

/* ------------------------------------------------------------------ today */

function summaryCard(): HTMLElement {
  const { plan: active, estimate } = plan();
  const day = currentDay();
  const totals = totalsFor(day);
  const burned = burnedNet(day);
  const balance = balanceFor(active, totals.kcal, burned);

  const budget = active.target + burned;
  const eatenPct = budget > 0 ? Math.min(100, (totals.kcal / budget) * 100) : 0;
  const overPct = budget > 0 && totals.kcal > budget ? Math.min(100, ((totals.kcal - budget) / budget) * 100) : 0;

  const macroBar = (key: 'protein' | 'carbs' | 'fat' | 'fiber', label: string, target: number): HTMLElement => {
    const value = totals[key];
    const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
    return el('div', { class: `macro ${key}` },
      el('div', { class: 'name' }, el('span', {}, label), el('b', {}, `${Math.round(value)} / ${target} g`)),
      el('div', { class: 'bar' }, el('span', { style: `width:${pct}%` })));
  };

  return el('section', { class: 'card' },
    el('div', { class: 'headline' },
      el('div', { class: `big-number${balance.remaining < 0 ? ' over' : ''}` }, formatNumber(Math.abs(balance.remaining))),
      el('div', { class: 'big-label' }, balance.remaining < 0 ? 'kcal over budget' : 'kcal left today')),
    el('div', { class: 'meter' },
      el('span', { class: 'eaten', style: `width:${eatenPct - overPct}%` }),
      el('span', { class: 'over-fill', style: `width:${overPct}%` })),
    el('div', { class: 'sub-figures' },
      el('span', {}, 'Eaten ', el('b', {}, formatNumber(totals.kcal))),
      el('span', {}, 'Target ', el('b', {}, formatNumber(active.target))),
      burned > 0 ? el('span', {}, 'Training ', el('b', {}, `+${formatNumber(burned)}`)) : null,
      // Before anything is logged the projection is arithmetic on an empty
      // day, which says nothing about the week ahead.
      totals.kcal > 0
        ? el('span', {}, 'At this rate ', el('b', {}, `${balance.projectedKgPerWeek > 0 ? '+' : ''}${balance.projectedKgPerWeek} kg/week`))
        : null),
    el('div', { class: 'macros' },
      macroBar('protein', 'Protein', active.protein),
      macroBar('carbs', 'Carbs', active.carbs),
      macroBar('fat', 'Fat', active.fat),
      macroBar('fiber', 'Fibre', active.fiber)),
    estimate.underReported
      ? el('p', { class: 'note warn' }, 'Your logged intake adds up to less than your resting metabolism, so some food is going unrecorded. See Trends.')
      : estimate.confidence !== 'none'
        ? el('p', { class: 'note' }, `Target built on your measured maintenance of ${estimate.maintenance} kcal, not the textbook formula.`)
        : null);
}

function previewRow(item: ReturnType<typeof parseFoodLine>['items'][number]): HTMLElement {
  const confidence = Math.round(item.confidence * 100);
  return el('div', { class: `parsed${item.unresolved ? ' unresolved' : ''}` },
    el('span', { class: 'amount' }, item.amountLabel || '?'),
    el('span', { class: 'name' }, item.unresolved ? `not recognised: ${item.foodName}` : item.foodName),
    !item.unresolved
      ? el('span', { class: `confidence${item.confidence < 0.7 ? ' low' : ''}` }, `${confidence}%`)
      : null,
    el('span', { class: 'kcal' }, item.unresolved ? '—' : `${item.nutrients.kcal} kcal`),
    el('div', { class: 'why' },
      el('ul', {}, item.notes.map((note) => el('li', {}, note))),
      item.alternatives.length > 0
        ? el('div', {}, `Or did you mean: ${item.alternatives.map((a) => a.name).join(', ')}?`)
        : null));
}

function foodEntryCard(): HTMLElement {
  const parsed = ui.foodDraft.trim() ? parseFoodLine(ui.foodDraft) : null;

  const textarea = el('textarea', {
    placeholder: 'What did you eat? Plain English is fine: "2 rotis, a katori of dal and half a bowl of rice"',
    'aria-label': 'Food eaten',
    value: ui.foodDraft,
    oninput: debounce((event: Event) => {
      ui.foodDraft = (event.target as HTMLTextAreaElement).value;
      render();
    }, 220),
  });

  const commit = (): void => {
    if (!parsed) return;
    const day = currentDay();
    const meal = parsed.meal ?? mealForHour(new Date().getHours());
    for (const item of parsed.items) {
      if (item.unresolved || !item.foodId) continue;
      const entry: FoodEntry = {
        id: newId(),
        text: item.text,
        foodId: item.foodId,
        foodName: item.foodName,
        grams: item.grams,
        amountLabel: item.amountLabel,
        nutrients: item.nutrients,
        confidence: item.confidence,
        meal,
        at: new Date().toISOString(),
      };
      day.foods.push(entry);
    }
    ui.foodDraft = '';
    persist();
    render();
  };

  const resolvable = parsed?.items.filter((item) => !item.unresolved).length ?? 0;

  return el('section', { class: 'card' },
    el('h2', {}, 'Log food'),
    el('div', { class: 'entry' },
      textarea,
      el('div', { class: 'row spread' },
        el('div', { class: 'examples' },
          'Try: ',
          FOOD_EXAMPLES.slice(0, 3).map((example) => el('button', {
            class: 'link',
            onclick: () => { ui.foodDraft = example; render(); },
          }, example))),
        el('div', { class: 'row' },
          el('button', {
            class: 'ghost',
            onclick: () => { ui.tab = 'chat'; render(); },
          }, getApiKey() ? '📷 Photo' : '📷 Photo (needs a key)'),
          el('button', { class: 'primary', disabled: resolvable === 0, onclick: commit },
            resolvable > 1 ? `Add ${resolvable} items` : 'Add'))),
      parsed
        ? el('div', { class: 'preview' },
          parsed.expandedCombos.length > 0
            ? el('p', { class: 'note' }, `Read "${parsed.expandedCombos.join('", "')}" as a full plate and split it into its parts.`)
            : null,
          parsed.items.map(previewRow),
          el('div', { class: 'row spread', style: 'margin-top:8px' },
            el('b', {}, `${parsed.total.kcal} kcal`),
            el('span', { class: 'macros-inline' },
              `P ${parsed.total.protein} · C ${parsed.total.carbs} · F ${parsed.total.fat}`)))
        : el('div', { class: 'preview empty' }, 'Everything is worked out as you type, on this device. Nothing is sent anywhere.')));
}

function foodEditor(entry: FoodEntry): HTMLElement {
  const gramsInput = el('input', { type: 'number', min: '1', step: '5', value: String(entry.grams), 'aria-label': 'Grams' });
  const select = el('select', { 'aria-label': 'Food' },
    FOODS.map((food) => el('option', { value: food.id, selected: food.id === entry.foodId }, food.name)));

  const apply = (): void => {
    const grams = Math.max(1, Number(gramsInput.value) || entry.grams);
    const foodId = select.value;
    const food = FOODS.find((f) => f.id === foodId);
    entry.grams = grams;
    entry.foodId = foodId;
    entry.foodName = food?.name ?? entry.foodName;
    entry.amountLabel = `${grams} g`;
    entry.nutrients = recalculate(foodId, grams);
    entry.confidence = 1;
    ui.editingFood = null;
    persist();
    render();
  };

  return el('div', { class: 'row', style: 'padding:8px 0 12px; gap:8px' },
    select,
    el('div', { style: 'width:110px' }, gramsInput),
    el('button', { class: 'primary', onclick: apply }, 'Save'),
    el('button', { class: 'ghost', onclick: () => { ui.editingFood = null; render(); } }, 'Cancel'));
}

function loggedFoods(): HTMLElement {
  const day = currentDay();
  if (day.foods.length === 0) {
    return el('section', { class: 'card' },
      el('h2', {}, 'Eaten'),
      el('p', { class: 'empty-state' }, 'Nothing logged for this day yet.'));
  }

  const groups = MEAL_ORDER
    .map((meal) => ({ meal, items: day.foods.filter((food) => food.meal === meal) }))
    .filter((group) => group.items.length > 0);

  return el('section', { class: 'card' },
    el('h2', {}, 'Eaten'),
    groups.map((group) => el('div', { class: 'meal-group' },
      el('h3', {}, `${MEAL_LABELS[group.meal]} · ${formatNumber(group.items.reduce((sum, i) => sum + i.nutrients.kcal, 0))} kcal`),
      group.items.map((entry) => (ui.editingFood === entry.id
        ? foodEditor(entry)
        : el('div', { class: 'logged' },
          el('div', {},
            el('div', { class: 'name' }, entry.foodName),
            el('div', { class: 'amount' }, `${entry.amountLabel} · ${entry.grams} g`)),
          el('span', { class: 'macros-inline' },
            `P ${entry.nutrients.protein} · C ${entry.nutrients.carbs} · F ${entry.nutrients.fat}`),
          el('span', { class: 'kcal' }, `${entry.nutrients.kcal}`),
          el('button', { class: 'ghost', onclick: () => { ui.editingFood = entry.id; render(); } }, 'Edit'),
          el('button', {
            class: 'remove',
            'aria-label': `Remove ${entry.foodName}`,
            onclick: () => {
              day.foods = day.foods.filter((food) => food.id !== entry.id);
              persist();
              render();
            },
          }, '×')))))));
}

function trainingCard(): HTMLElement {
  const day = currentDay();
  const weight = day.weightKg ?? state.profile.weightKg;
  const parsed = ui.trainingDraft.trim() ? parseActivityLine(ui.trainingDraft, weight) : null;

  const commit = (): void => {
    if (!parsed) return;
    for (const activity of parsed.activities) {
      if (activity.unresolved || !activity.exerciseId) continue;
      const entry: ActivityEntry = {
        id: newId(),
        text: activity.text,
        exerciseId: activity.exerciseId,
        exerciseName: activity.exerciseName,
        minutes: activity.minutes,
        met: activity.met,
        kcalGross: activity.kcalGross,
        kcalNet: activity.kcalNet,
        at: new Date().toISOString(),
        ...(activity.km !== undefined ? { km: activity.km } : {}),
        ...(activity.sets ? { sets: activity.sets } : {}),
      };
      day.activities.push(entry);
    }
    ui.trainingDraft = '';
    persist();
    render();
  };

  const resolvable = parsed?.activities.filter((a) => !a.unresolved).length ?? 0;

  return el('section', { class: 'card' },
    el('h2', {}, 'Log training'),
    el('div', { class: 'entry' },
      el('textarea', {
        placeholder: 'What did you do? "ran 5k in 27 min", "45 min gym, squats 5x5 at 60kg"',
        'aria-label': 'Training done',
        value: ui.trainingDraft,
        oninput: debounce((event: Event) => {
          ui.trainingDraft = (event.target as HTMLTextAreaElement).value;
          render();
        }, 220),
      }),
      el('div', { class: 'row spread' },
        el('div', { class: 'examples' },
          'Try: ',
          TRAINING_EXAMPLES.slice(0, 2).map((example) => el('button', {
            class: 'link',
            onclick: () => { ui.trainingDraft = example; render(); },
          }, example))),
        el('button', { class: 'primary', disabled: resolvable === 0, onclick: commit }, 'Add')),
      parsed
        ? el('div', { class: 'preview' }, parsed.activities.map((activity) => el('div', { class: `parsed${activity.unresolved ? ' unresolved' : ''}` },
          el('span', { class: 'amount' }, `${activity.minutes} min`),
          el('span', { class: 'name' }, activity.unresolved ? `not recognised: ${activity.exerciseName}` : activity.exerciseName),
          el('span', { class: 'kcal' }, activity.unresolved ? '—' : `${activity.kcalNet} kcal`),
          el('div', { class: 'why' }, el('ul', {}, activity.notes.map((note) => el('li', {}, note)))))))
        : null),
    day.activities.length > 0
      ? el('div', { style: 'margin-top:14px' }, day.activities.map((entry) => (ui.editingActivity === entry.id
        ? activityEditor(entry, weight)
        : el('div', { class: 'logged' },
          el('div', {},
            el('div', { class: 'name' }, entry.exerciseName),
            el('div', { class: 'amount' },
              `${entry.minutes} min${entry.km ? ` · ${entry.km} km` : ''} · ${entry.met} METs`)),
          el('span', { class: 'kcal' }, `${entry.kcalNet}`),
          el('button', { class: 'ghost', onclick: () => { ui.editingActivity = entry.id; render(); } }, 'Edit'),
          el('button', {
            class: 'remove',
            'aria-label': `Remove ${entry.exerciseName}`,
            onclick: () => {
              day.activities = day.activities.filter((a) => a.id !== entry.id);
              persist();
              render();
            },
          }, '×')))))
      : null);
}

function activityEditor(entry: ActivityEntry, weightKg: number): HTMLElement {
  const minutes = el('input', { type: 'number', min: '1', value: String(entry.minutes), 'aria-label': 'Minutes' });
  const apply = (): void => {
    const value = Math.max(1, Number(minutes.value) || entry.minutes);
    const recomputed = recalculateActivity(entry.exerciseId, value, entry.met, weightKg);
    entry.minutes = value;
    entry.kcalGross = recomputed.kcalGross;
    entry.kcalNet = recomputed.kcalNet;
    ui.editingActivity = null;
    persist();
    render();
  };
  return el('div', { class: 'row', style: 'padding:8px 0; gap:8px' },
    el('span', { class: 'grow' }, entry.exerciseName),
    el('div', { style: 'width:110px' }, minutes),
    el('button', { class: 'primary', onclick: apply }, 'Save'),
    el('button', { class: 'ghost', onclick: () => { ui.editingActivity = null; render(); } }, 'Cancel'));
}

function weightCard(): HTMLElement {
  const day = currentDay();
  const input = el('input', {
    type: 'number',
    step: '0.1',
    min: '20',
    placeholder: String(state.profile.weightKg),
    value: day.weightKg !== undefined ? String(day.weightKg) : '',
    'aria-label': 'Morning weight in kilograms',
  });
  const save1 = (): void => {
    const value = Number(input.value);
    if (Number.isFinite(value) && value > 0) {
      day.weightKg = Math.round(value * 10) / 10;
      state.profile.weightKg = day.weightKg;
    } else {
      delete day.weightKg;
    }
    persist();
    render();
  };
  return el('section', { class: 'card' },
    el('h2', {}, 'Morning weight'),
    el('div', { class: 'row' },
      el('div', { style: 'width:140px' }, input),
      el('span', { class: 'grow' }, 'kg'),
      el('button', { class: 'primary', onclick: save1 }, 'Save')),
    el('p', { class: 'note' }, 'Weigh yourself after the toilet, before eating. Day to day it is mostly water; the trend line is the part that means something.'));
}

/**
 * One-tap logging from your own history.
 *
 * After a fortnight this is the fastest input in the app, and it needs no
 * network, no key and no typing: most people eat the same twenty meals, so the
 * portions they log most often are almost always the ones they want next.
 */
function quickLogCard(): HTMLElement | null {
  const iso = todayIso();
  const meal = mealForHour(new Date().getHours());
  const suggestions = suggestItems(state, iso, { meal, limit: 6 });
  const previous = lastMealOf(state, ui.date, meal);
  if (suggestions.length === 0 && !previous) return null;

  const addEntries = (entries: { foodId: string; foodName: string; grams: number; amountLabel: string; nutrients: FoodEntry['nutrients']; confidence?: number }[]): void => {
    const day = currentDay();
    for (const entry of entries) {
      day.foods.push({
        id: newId(),
        text: entry.foodName,
        foodId: entry.foodId,
        foodName: entry.foodName,
        grams: entry.grams,
        amountLabel: entry.amountLabel,
        nutrients: entry.nutrients,
        confidence: entry.confidence ?? 1,
        meal,
        at: new Date().toISOString(),
      });
    }
    persist();
    render();
  };

  return el('section', { class: 'card' },
    el('h2', {}, `Usual ${MEAL_LABELS[meal].toLowerCase()}`),
    el('div', { class: 'chips' },
      suggestions.map((suggestion) => el('button', {
        class: 'chip',
        onclick: () => addEntries([suggestion]),
      },
      el('b', {}, suggestion.foodName),
      el('span', {}, ` ${suggestion.amountLabel} · ${suggestion.nutrients.kcal} kcal`)))),
    previous
      ? el('div', { style: 'margin-top:10px' },
        el('button', {
          class: 'ghost',
          onclick: () => addEntries(previous.items),
        }, `Repeat ${MEAL_LABELS[meal].toLowerCase()} from ${previous.date} (${kcalOf(previous.items)} kcal, ${previous.items.length} items)`))
      : null);
}

function dateNav(): HTMLElement {
  const iso = todayIso();
  return el('div', { class: 'row spread', style: 'margin-bottom:16px' },
    el('button', { class: 'ghost', onclick: () => { ui.date = shiftDate(ui.date, -1); render(); } }, '← Previous'),
    el('b', {}, formatDate(ui.date, iso)),
    el('button', {
      class: 'ghost',
      disabled: ui.date >= iso,
      onclick: () => { ui.date = shiftDate(ui.date, 1); render(); },
    }, 'Next →'));
}

function todayTab(): Section[] {
  return [dateNav(), summaryCard(), quickLogCard(), foodEntryCard(), loggedFoods(), trainingCard(), weightCard()];
}

/* ------------------------------------------------------------------ coach */

function coachTab(): Section[] {
  const logs = Object.values(state.days);
  const result = coach(state.profile, logs, todayIso());
  const cards: HTMLElement[] = [];

  cards.push(el('section', { class: 'card' },
    el('h2', {}, 'Today'),
    result.todayIsRest || !result.today
      ? el('div', {},
        el('h3', {}, 'Rest day'),
        el('p', { class: 'note' }, result.todayReason))
      : el('div', {},
        el('div', { class: 'row spread' },
          el('h3', {}, result.today.name),
          el('span', { class: 'badge' }, `about ${result.today.estimatedMinutes} min`)),
        el('p', { class: 'note' }, `${result.today.focus}. ${result.todayReason}`),
        el('div', { style: 'margin-top:10px' }, result.today.blocks.map((block) => el('div', { class: 'session-block' },
          el('span', { class: 'move' }, block.movement.name),
          el('span', { class: 'dose' }, `${block.sets} x ${block.reps}`),
          el('span', { class: 'cue' }, block.note),
          el('span', { class: 'rest' }, `Rest ${block.restSeconds}s between sets`)))),
        el('p', { class: 'note' },
          progressionAdvice(result.today.blocks[0]?.reps ?? '8-10', state.profile.goal)))));

  cards.push(el('section', { class: 'card' },
    el('h2', {}, 'Cardio'),
    el('div', { class: 'row spread' },
      el('h3', {}, `${result.cardio.weeklyMinutes} min a week`),
      el('span', { class: 'badge' }, `${result.cardio.sessions} x ${result.cardio.minutesPerSession} min`)),
    el('p', { class: 'note' }, `${result.cardio.intensity}. ${result.cardio.note}`)));

  if (result.insights.length > 0) {
    cards.push(el('section', { class: 'card' },
      el('h2', {}, 'What your log says'),
      result.insights.map((insight) => el('div', { class: `insight ${insight.level}` },
        el('span', { class: 'dot' }),
        el('span', {}, insight.text)))));
  }

  cards.push(el('section', { class: 'card' },
    el('h2', {}, `Your week · ${result.splitName}`),
    el('div', { class: 'week-list' }, result.week.map((session) => el('div', {
      class: `week-day${result.today?.name === session.name ? ' is-today' : ''}`,
    },
    el('b', {}, session.name),
    el('span', {}, session.blocks.map((block) => block.movement.name).join(', ')))))));

  return cards;
}

/* ----------------------------------------------------------------- trends */

function trendsTab(): Section[] {
  const { plan: active, estimate } = plan();
  const records = dailyRecords(state);
  const cards: HTMLElement[] = [];

  cards.push(el('section', { class: 'card' },
    el('h2', {}, 'Weight trend'),
    weightChart(estimate.trend),
    el('div', { class: 'legend' },
      el('span', {}, el('i', { style: 'background:var(--text-faint)' }), 'Scale weight'),
      el('span', {}, el('i', { style: 'background:var(--accent)' }), 'Smoothed trend'),
      estimate.trendKgPerWeek !== null
        ? el('span', {}, `${estimate.trendKgPerWeek > 0 ? '+' : ''}${estimate.trendKgPerWeek} kg per week`)
        : null)));

  cards.push(el('section', { class: 'card' },
    el('h2', {}, 'Measured maintenance'),
    el('div', { class: 'estimate-figure' },
      el('span', { class: 'value' }, estimate.measured ? formatNumber(estimate.measured) : formatNumber(active.tdee)),
      el('span', { class: 'range' }, estimate.low && estimate.high ? `kcal, likely ${estimate.low}–${estimate.high}` : 'kcal, from the formula'),
      el('span', { class: 'badge' }, estimate.underReported ? 'not usable' : `${estimate.confidence} confidence`)),
    estimate.explanation.map((line) => el('p', { class: 'note' }, line))));

  const recent = records.slice(-21).filter((record) => record.intakeKcal !== undefined);
  cards.push(el('section', { class: 'card' },
    el('h2', {}, 'Calories, last three weeks'),
    intakeChart(recent.map((record) => ({ date: record.date, kcal: record.intakeKcal as number })), active.target),
    recent.length > 0
      ? el('p', { class: 'note' },
        `Average ${formatNumber(Math.round(recent.reduce((sum, r) => sum + (r.intakeKcal as number), 0) / recent.length))} kcal `
        + `over ${recent.length} logged days.`)
      : null));

  return cards;
}

/* ---------------------------------------------------------------- profile */

function field(label: string, control: HTMLElement): HTMLElement {
  return el('div', { class: 'field' }, el('label', {}, label), control);
}

function profileTab(): Section[] {
  const profile = state.profile;
  const update = <K extends keyof Profile>(key: K, value: Profile[K]): void => {
    profile[key] = value;
    persist();
    render();
  };

  const numberField = (label: string, key: 'age' | 'heightCm' | 'weightKg' | 'trainingDays', step = '1'): HTMLElement =>
    field(label, el('input', {
      type: 'number',
      step,
      value: String(profile[key]),
      onchange: (event: Event) => update(key, Number((event.target as HTMLInputElement).value) as Profile[typeof key]),
    }));

  const equipmentOptions: [Equipment, string][] = [
    ['none', 'Bodyweight only'],
    ['dumbbells', 'Dumbbells'],
    ['barbell', 'Barbell'],
    ['machines', 'Gym machines'],
    ['bands', 'Resistance bands'],
    ['pullup-bar', 'Pull-up bar'],
  ];

  const { plan: active, estimate } = plan();

  return [
    el('section', { class: 'card' },
      el('h2', {}, 'About you'),
      el('div', { class: 'fields' },
        numberField('Age', 'age'),
        field('Sex', el('select', {
          onchange: (event: Event) => update('sex', (event.target as HTMLSelectElement).value as Profile['sex']),
        },
        el('option', { value: 'male', selected: profile.sex === 'male' }, 'Male'),
        el('option', { value: 'female', selected: profile.sex === 'female' }, 'Female'))),
        numberField('Height (cm)', 'heightCm'),
        numberField('Weight (kg)', 'weightKg', '0.1'),
        field('Body fat % (optional)', el('input', {
          type: 'number',
          step: '0.5',
          placeholder: 'unknown',
          value: profile.bodyFatPct !== undefined ? String(profile.bodyFatPct) : '',
          onchange: (event: Event) => {
            const value = Number((event.target as HTMLInputElement).value);
            update('bodyFatPct', Number.isFinite(value) && value > 0 ? value : (undefined as unknown as number));
          },
        })),
        field('Daily activity', el('select', {
          onchange: (event: Event) => update('activity', (event.target as HTMLSelectElement).value as ActivityLevel),
        }, (Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((level) => el('option', {
          value: level,
          selected: profile.activity === level,
        }, ACTIVITY_LABELS[level]))))),
    ),

    el('section', { class: 'card' },
      el('h2', {}, 'Your goal'),
      el('div', { class: 'fields' },
        field('Aim', el('select', {
          onchange: (event: Event) => {
            const goal = (event.target as HTMLSelectElement).value as Goal;
            profile.goal = goal;
            profile.rateKgPerWeek = defaultRateFor(goal);
            persist();
            render();
          },
        },
        el('option', { value: 'lose', selected: profile.goal === 'lose' }, 'Lose fat'),
        el('option', { value: 'maintain', selected: profile.goal === 'maintain' }, 'Stay where I am'),
        el('option', { value: 'gain', selected: profile.goal === 'gain' }, 'Build muscle'))),
        profile.goal !== 'maintain'
          ? field('Rate (kg per week)', el('input', {
            type: 'number',
            step: '0.05',
            value: String(profile.rateKgPerWeek),
            onchange: (event: Event) => update('rateKgPerWeek', Number((event.target as HTMLInputElement).value)),
          }))
          : null,
        numberField('Training days a week', 'trainingDays'),
        field('Diet', el('select', {
          onchange: (event: Event) => update('diet', (event.target as HTMLSelectElement).value as Profile['diet']),
        },
        el('option', { value: 'vegetarian', selected: profile.diet === 'vegetarian' }, 'Vegetarian'),
        el('option', { value: 'eggetarian', selected: profile.diet === 'eggetarian' }, 'Eggetarian'),
        el('option', { value: 'non-vegetarian', selected: profile.diet === 'non-vegetarian' }, 'Non-vegetarian'),
        el('option', { value: 'vegan', selected: profile.diet === 'vegan' }, 'Vegan')))),
      el('h2', { style: 'margin-top:20px' }, 'Equipment you can use'),
      el('div', { class: 'checks' }, equipmentOptions.map(([value, label]) => el('label', {
        class: `check${profile.equipment.includes(value) ? ' on' : ''}`,
      },
      el('input', {
        type: 'checkbox',
        checked: profile.equipment.includes(value),
        onchange: () => {
          const has = profile.equipment.includes(value);
          const next = has ? profile.equipment.filter((e) => e !== value) : [...profile.equipment, value];
          update('equipment', next.length > 0 ? next : ['none']);
        },
      }),
      label)))),

    el('section', { class: 'card' },
      el('h2', {}, 'Your numbers'),
      el('div', { class: 'plan-grid' },
        el('div', { class: 'plan-figure' }, el('div', { class: 'k' }, 'Resting (BMR)'), el('div', { class: 'v' }, formatNumber(active.bmr))),
        el('div', { class: 'plan-figure' }, el('div', { class: 'k' }, 'Maintenance'), el('div', { class: 'v' }, formatNumber(active.tdee))),
        el('div', { class: 'plan-figure' }, el('div', { class: 'k' }, 'Daily target'), el('div', { class: 'v' }, formatNumber(active.target))),
        el('div', { class: 'plan-figure' }, el('div', { class: 'k' }, 'Protein'), el('div', { class: 'v' }, `${active.protein} g`))),
      el('p', { class: 'note' },
        `Resting energy from ${active.method === 'katch' ? 'Katch-McArdle, using your body fat percentage' : 'Mifflin-St Jeor'}. `
        + `${estimate.confidence === 'none' ? 'Keep logging and this gets replaced by a measurement.' : `Maintenance is measured from ${estimate.daysOfData} days of your own log.`}`),
      active.warnings.map((warning) => el('p', { class: 'note warn' }, warning))),

    el('section', { class: 'card' },
      el('h2', {}, 'Your data'),
      el('p', { class: 'note' }, 'Everything is stored in this browser only. There is no account and no server, so a backup is worth taking.'),
      el('div', { class: 'row', style: 'margin-top:12px' },
        el('button', { class: 'ghost', onclick: () => download(`calorie-log-${todayIso()}.json`, exportJson(state), 'application/json') }, 'Export JSON'),
        el('button', { class: 'ghost', onclick: () => download(`calorie-log-${todayIso()}.csv`, exportCsv(state), 'text/csv') }, 'Export CSV'),
        el('label', { class: 'check' },
          'Import',
          el('input', {
            type: 'file',
            accept: 'application/json,.json',
            style: 'display:none',
            onchange: (event: Event) => {
              const file = (event.target as HTMLInputElement).files?.[0];
              if (!file) return;
              void file.text().then((text) => {
                const result = importJson(text);
                if (result.state) {
                  state = result.state;
                  persist();
                  ui.message = 'Log imported.';
                } else {
                  ui.message = result.error;
                }
                render();
              });
            },
          })),
        el('button', {
          class: 'ghost',
          onclick: () => {
            // eslint-disable-next-line no-alert
            if (confirm('Delete the whole log and start again? This cannot be undone.')) {
              state = emptyState();
              persist();
              render();
            }
          },
        }, 'Delete everything'))),
  ];
}

function download(filename: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ shell */

const TABS: [Tab, string][] = [
  ['today', 'Today'],
  ['chat', 'Assistant'],
  ['coach', 'Coach'],
  ['trends', 'Trends'],
  ['profile', 'You'],
];

function render(): void {
  const root = document.getElementById('app');
  if (!root) return;
  clear(root);

  const nav = el('nav', { class: 'tabs', role: 'tablist' },
    TABS.map(([tab, label]) => el('button', {
      role: 'tab',
      'aria-selected': String(ui.tab === tab),
      onclick: () => { ui.tab = tab; render(); },
    }, label)));

  const body = ui.tab === 'today' ? todayTab()
    : ui.tab === 'chat'
      ? chatTab(ui.chat, toolContext, render, () => { persist(); })
      : ui.tab === 'coach' ? coachTab()
        : ui.tab === 'trends' ? trendsTab()
          : profileTab();

  append(root, [
    el('header', { class: 'top' },
      el('div', {},
        el('h1', {}, 'AI ', el('span', { class: 'mark' }, 'Calorie'), ' Tracker'),
        el('p', { class: 'tagline' }, 'Eat in your own words. Train on a plan. Nothing leaves this device.')),
      el('span', { class: 'badge' }, `${FOODS.length} foods`)),
    nav,
    ui.message ? el('div', { class: 'card' }, el('p', { class: 'note' }, ui.message)) : null,
    body,
    el('footer', { class: 'foot' },
      'Offline by design. Composition values are approximations from public food tables, good to about 10%. ',
      'Not medical advice.'),
  ]);
  ui.message = null;
}

render();
