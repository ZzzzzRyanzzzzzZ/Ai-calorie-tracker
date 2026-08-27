import { coach, progressionAdvice } from '../core/coach.ts';
import { defaultRateFor, planFor } from '../core/energy.ts';
import { matchFood } from '../core/match.ts';
import { parseActivityLine } from '../core/parseExercise.ts';
import { parseFoodLine } from '../core/parseFood.ts';
import { DEFAULT_PROFILE } from '../core/store.ts';
import type { ActivityLevel, Equipment, Goal, Profile, Sex } from '../core/types.ts';
import { FOODS } from '../data/foods.ts';

/** Colours, unless the output is being piped somewhere. */
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold: (s: string) => (tty ? `\u001b[1m${s}\u001b[0m` : s),
  dim: (s: string) => (tty ? `\u001b[2m${s}\u001b[0m` : s),
  accent: (s: string) => (tty ? `\u001b[38;5;208m${s}\u001b[0m` : s),
  red: (s: string) => (tty ? `\u001b[31m${s}\u001b[0m` : s),
  green: (s: string) => (tty ? `\u001b[32m${s}\u001b[0m` : s),
};

interface Options {
  food: string[];
  train: string[];
  coach: boolean;
  list: string | null;
  why: boolean;
  json: boolean;
  help: boolean;
  profile: Profile;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    food: [],
    train: [],
    coach: false,
    list: null,
    why: false,
    json: false,
    help: argv.length === 0,
    profile: { ...DEFAULT_PROFILE, equipment: [...DEFAULT_PROFILE.equipment] },
  };

  let rateGiven = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const next = (): string => (argv[++i] ?? '');
    switch (arg) {
      case '-h': case '--help': options.help = true; break;
      case '--train': case '-t': options.train.push(next()); break;
      case '--coach': case '-c': options.coach = true; break;
      case '--list': case '-l': options.list = next(); break;
      case '--why': case '-w': options.why = true; break;
      case '--json': options.json = true; break;
      case '--weight': options.profile.weightKg = Number(next()); break;
      case '--height': options.profile.heightCm = Number(next()); break;
      case '--age': options.profile.age = Number(next()); break;
      case '--sex': options.profile.sex = next() as Sex; break;
      case '--goal': {
        options.profile.goal = next() as Goal;
        if (!rateGiven) options.profile.rateKgPerWeek = defaultRateFor(options.profile.goal);
        break;
      }
      case '--rate': {
        options.profile.rateKgPerWeek = Number(next());
        rateGiven = true;
        break;
      }
      case '--activity': options.profile.activity = next() as ActivityLevel; break;
      case '--days': options.profile.trainingDays = Number(next()); break;
      case '--equipment': options.profile.equipment = next().split(',') as Equipment[]; break;
      default:
        if (arg.startsWith('-')) {
          process.stderr.write(`Unknown option ${arg}\n`);
          process.exit(2);
        }
        options.food.push(arg);
    }
  }
  return options;
}

const HELP = `${c.bold('AI Calorie Tracker')} — Indian-first food and fitness logging, offline.

${c.bold('Usage')}
  track "2 rotis, a katori of dal and half a bowl of rice"
  track --train "ran 5k in 27 min" --weight 72
  track --coach --goal gain --days 4 --equipment dumbbells,pullup-bar
  track --list paneer

${c.bold('Options')}
  -t, --train <text>     Log training instead of food (repeatable)
  -c, --coach            Print today's session, cardio dose and the week
  -l, --list <term>      Search the food table
  -w, --why              Show every assumption the parser made
      --json             Machine-readable output
      --weight <kg>      Body weight, used for burn and targets (default ${DEFAULT_PROFILE.weightKg})
      --height <cm>      Height (default ${DEFAULT_PROFILE.heightCm})
      --age <years>      Age (default ${DEFAULT_PROFILE.age})
      --sex <m|f>        male or female (default ${DEFAULT_PROFILE.sex})
      --goal <g>         lose, maintain or gain (default ${DEFAULT_PROFILE.goal})
      --rate <kg/week>   Rate of change, negative to lose (default by goal)
      --activity <a>     sedentary, light, moderate, active, very-active
      --days <n>         Training days a week (default ${DEFAULT_PROFILE.trainingDays})
      --equipment <list> none,dumbbells,barbell,machines,bands,pullup-bar

${c.dim(`${FOODS.length} foods in the table. Nothing is sent anywhere.`)}
`;

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

function showFood(options: Options): void {
  const line = options.food.join(' ');
  const result = parseFoodLine(line);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.expandedCombos.length > 0) {
    process.stdout.write(c.dim(`Read "${result.expandedCombos.join('", "')}" as a full plate.\n`));
  }

  for (const item of result.items) {
    if (item.unresolved) {
      process.stdout.write(`${c.red('  ?')} ${item.text}\n`);
      for (const note of item.notes) process.stdout.write(c.dim(`      ${note}\n`));
      if (item.alternatives.length > 0) {
        process.stdout.write(c.dim(`      closest: ${item.alternatives.map((a) => a.name).join(', ')}\n`));
      }
      continue;
    }
    const confidence = item.confidence >= 0.9 ? c.green('  ✓') : c.accent('  ~');
    process.stdout.write(
      `${confidence} ${pad(item.amountLabel, 14)} ${pad(item.foodName, 32)} `
      + `${padStart(String(item.grams) + 'g', 7)} ${padStart(String(item.nutrients.kcal), 5)} kcal\n`,
    );
    if (options.why) for (const note of item.notes) process.stdout.write(c.dim(`      ${note}\n`));
  }

  const total = result.total;
  process.stdout.write(
    `\n  ${c.bold(`${total.kcal} kcal`)}   `
    + c.dim(`protein ${total.protein} g · carbs ${total.carbs} g · fat ${total.fat} g · fibre ${total.fiber} g\n`),
  );

  const plan = planFor(options.profile);
  const share = Math.round((total.kcal / plan.target) * 100);
  process.stdout.write(c.dim(`  ${share}% of a ${plan.target} kcal day for you.\n`));
}

function showTraining(options: Options): void {
  const result = parseActivityLine(options.train.join(', '), options.profile.weightKg);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  for (const activity of result.activities) {
    if (activity.unresolved) {
      process.stdout.write(`${c.red('  ?')} ${activity.text}\n`);
      continue;
    }
    process.stdout.write(
      `${c.green('  ✓')} ${pad(activity.exerciseName, 26)} ${padStart(`${activity.minutes} min`, 9)} `
      + `${padStart(`${activity.met} METs`, 10)} ${padStart(`${activity.kcalNet} kcal`, 10)}\n`,
    );
    for (const note of activity.notes) process.stdout.write(c.dim(`      ${note}\n`));
  }
  process.stdout.write(
    `\n  ${c.bold(`${result.totalKcalNet} kcal`)} above resting, over ${result.totalMinutes} minutes.\n`
    + c.dim(`  (${result.totalKcalGross} kcal gross, but the resting part is already in your daily budget.)\n`),
  );
}

function showCoach(options: Options): void {
  const plan = coach(options.profile, [], new Date().toISOString().slice(0, 10));
  if (options.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  const energy = planFor(options.profile);
  process.stdout.write(
    `${c.bold('Your numbers')}\n`
    + `  Resting ${energy.bmr} kcal · maintenance ${energy.tdee} kcal · ${c.accent(`target ${energy.target} kcal`)}\n`
    + c.dim(`  protein ${energy.protein} g · carbs ${energy.carbs} g · fat ${energy.fat} g · fibre ${energy.fiber} g\n\n`),
  );
  for (const warning of energy.warnings) process.stdout.write(`  ${c.red(warning)}\n`);

  if (plan.today) {
    process.stdout.write(`${c.bold(`Today: ${plan.today.name}`)} ${c.dim(`(${plan.today.estimatedMinutes} min)`)}\n`);
    for (const block of plan.today.blocks) {
      process.stdout.write(`  ${pad(block.movement.name, 28)} ${c.accent(`${block.sets} x ${block.reps}`)}  ${c.dim(`rest ${block.restSeconds}s`)}\n`);
      process.stdout.write(c.dim(`      ${block.note}\n`));
    }
    process.stdout.write(c.dim(`\n  ${progressionAdvice(plan.today.blocks[0]?.reps ?? '8-10', options.profile.goal)}\n`));
  } else {
    process.stdout.write(`${c.bold('Today: rest')}\n  ${plan.todayReason}\n`);
  }

  process.stdout.write(
    `\n${c.bold('Cardio')}\n  ${plan.cardio.weeklyMinutes} min a week, `
    + `${plan.cardio.sessions} x ${plan.cardio.minutesPerSession} min. ${c.dim(plan.cardio.intensity)}\n`,
  );

  process.stdout.write(`\n${c.bold(`Your week — ${plan.splitName}`)}\n`);
  for (const session of plan.week) {
    process.stdout.write(`  ${pad(session.name, 14)} ${c.dim(session.blocks.map((b) => b.movement.name).join(', '))}\n`);
  }
}

function showList(term: string, json: boolean): void {
  const matches = matchFood(term, 12).filter((match) => match.score > 0.35);
  if (json) {
    process.stdout.write(`${JSON.stringify(matches.map((m) => ({ id: m.item.id, name: m.item.name, score: m.score, per100g: m.item.per100g })), null, 2)}\n`);
    return;
  }
  if (matches.length === 0) {
    process.stdout.write(`Nothing in the table looks like "${term}".\n`);
    return;
  }
  process.stdout.write(c.dim(`${pad('food', 34)} ${padStart('kcal', 6)} ${padStart('P', 6)} ${padStart('C', 6)} ${padStart('F', 6)}  per 100 g\n`));
  for (const match of matches) {
    const n = match.item.per100g;
    process.stdout.write(
      `${pad(match.item.name, 34)} ${padStart(String(n.kcal), 6)} ${padStart(String(n.protein), 6)} `
      + `${padStart(String(n.carbs), 6)} ${padStart(String(n.fat), 6)}  ${c.dim(`${Math.round(match.score * 100)}%`)}\n`,
    );
  }
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  process.stdout.write(HELP);
} else if (options.list !== null) {
  showList(options.list, options.json);
} else if (options.coach) {
  showCoach(options);
} else if (options.train.length > 0) {
  showTraining(options);
} else {
  showFood(options);
}
