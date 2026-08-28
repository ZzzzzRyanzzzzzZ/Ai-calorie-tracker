import type { Equipment } from '../core/types.ts';

/**
 * A library of movements, indexed by the pattern they train.
 *
 * Programmes here are built pattern-first rather than exercise-first: a session
 * asks for a squat, a hinge, a horizontal push and so on, and the best movement
 * available for that pattern is filled in from whatever equipment the person
 * actually has. That is why the same plan works in a gym and in a bedroom.
 */

export type Pattern =
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'horizontal-push'
  | 'vertical-push'
  | 'horizontal-pull'
  | 'vertical-pull'
  | 'core'
  | 'arms'
  | 'calf';

export const PATTERN_LABELS: Record<Pattern, string> = {
  squat: 'Squat',
  hinge: 'Hinge',
  lunge: 'Single-leg',
  'horizontal-push': 'Horizontal push',
  'vertical-push': 'Vertical push',
  'horizontal-pull': 'Horizontal pull',
  'vertical-pull': 'Vertical pull',
  core: 'Core',
  arms: 'Arms',
  calf: 'Calves',
};

export interface Movement {
  id: string;
  name: string;
  pattern: Pattern;
  /** Any one of these is enough to do the movement. */
  equipment: Equipment[];
  /** Higher is better when the equipment allows it. */
  preference: number;
  /**
   * How much strength the movement assumes: 1 anyone, 2 some training behind
   * you, 3 advanced. A pistol squat and a bodyweight squat train the same
   * pattern, but handing the second to someone strong wastes their session.
   */
  level: 1 | 2 | 3;
  /** True for multi-joint lifts, which get lower reps and more rest. */
  compound: boolean;
  muscles: string[];
  cue: string;
}

export const MOVEMENTS: Movement[] = [
  // squat
  { id: 'back-squat', name: 'Back squat', pattern: 'squat', equipment: ['barbell'], preference: 10, compound: true, muscles: ['quads', 'glutes'], cue: 'Brace before you unrack, sit between your hips, knees track over the toes.' , level: 1 },
  { id: 'goblet-squat', name: 'Goblet squat', pattern: 'squat', equipment: ['dumbbells'], preference: 8, compound: true, muscles: ['quads', 'glutes'], cue: 'Hold the bell at your chest, elbows inside your knees at the bottom.' , level: 1 },
  { id: 'leg-press', name: 'Leg press', pattern: 'squat', equipment: ['machines'], preference: 7, compound: true, muscles: ['quads', 'glutes'], cue: 'Do not let your lower back round off the pad at the bottom.' , level: 1 },
  { id: 'bw-squat', name: 'Bodyweight squat', pattern: 'squat', equipment: ['none', 'bands'], preference: 4, compound: true, muscles: ['quads', 'glutes'], cue: 'Slow on the way down, three seconds, to make it count without load.' , level: 1 },

  // hinge
  { id: 'deadlift', name: 'Deadlift', pattern: 'hinge', equipment: ['barbell'], preference: 10, compound: true, muscles: ['hamstrings', 'glutes', 'back'], cue: 'Push the floor away, keep the bar against your legs the whole way.' , level: 2 },
  { id: 'rdl', name: 'Romanian deadlift', pattern: 'hinge', equipment: ['barbell', 'dumbbells'], preference: 9, compound: true, muscles: ['hamstrings', 'glutes'], cue: 'Push your hips back, soft knees, stop when your hamstrings run out.' , level: 1 },
  { id: 'hip-thrust', name: 'Hip thrust', pattern: 'hinge', equipment: ['barbell', 'dumbbells'], preference: 7, compound: true, muscles: ['glutes'], cue: 'Ribs down, chin tucked, squeeze hard for a second at the top.' , level: 1 },
  { id: 'glute-bridge', name: 'Glute bridge', pattern: 'hinge', equipment: ['none', 'bands'], preference: 4, compound: false, muscles: ['glutes'], cue: 'Drive through your heels, do not arch your lower back to get higher.' , level: 1 },
  { id: 'single-leg-rdl', name: 'Single-leg RDL', pattern: 'hinge', equipment: ['none', 'dumbbells'], preference: 5, compound: false, muscles: ['hamstrings', 'glutes'], cue: 'Hips square to the floor, reach the free leg straight back.' , level: 2 },

  // lunge
  { id: 'walking-lunge', name: 'Walking lunge', pattern: 'lunge', equipment: ['none', 'dumbbells'], preference: 7, compound: true, muscles: ['quads', 'glutes'], cue: 'Long step, back knee to just above the floor, torso upright.' , level: 1 },
  { id: 'split-squat', name: 'Bulgarian split squat', pattern: 'lunge', equipment: ['none', 'dumbbells'], preference: 8, compound: true, muscles: ['quads', 'glutes'], cue: 'Back foot elevated, weight through the front heel. It is meant to be hard.' , level: 2 },
  { id: 'barbell-split-squat', name: 'Barbell split squat', pattern: 'lunge', equipment: ['barbell'], preference: 9, compound: true, muscles: ['quads', 'glutes'], cue: 'Bar on the back, long stance. Loadable far past what dumbbells allow.', level: 2 },
  { id: 'step-up', name: 'Step-up', pattern: 'lunge', equipment: ['none', 'dumbbells'], preference: 6, compound: true, muscles: ['quads', 'glutes'], cue: 'Do not push off the bottom foot, make the top leg do all of it.' , level: 1 },

  // horizontal push
  { id: 'bench-press', name: 'Bench press', pattern: 'horizontal-push', equipment: ['barbell'], preference: 11, compound: true, muscles: ['chest', 'triceps'], cue: 'Shoulder blades pinned back, bar to the lower chest, elbows about 45 degrees.' , level: 1 },
  { id: 'db-bench', name: 'Dumbbell bench press', pattern: 'horizontal-push', equipment: ['dumbbells'], preference: 9, compound: true, muscles: ['chest', 'triceps'], cue: 'Lower until your upper arms are level with your torso, no deeper.' , level: 1 },
  { id: 'chest-press', name: 'Chest press machine', pattern: 'horizontal-push', equipment: ['machines'], preference: 7, compound: true, muscles: ['chest', 'triceps'], cue: 'Set the seat so the handles line up with the middle of your chest.' , level: 1 },
  { id: 'pushup', name: 'Push-up', pattern: 'horizontal-push', equipment: ['none', 'bands'], preference: 6, compound: true, muscles: ['chest', 'triceps'], cue: 'Body in one line, elbows back not flared. Elevate your hands if you cannot.' , level: 1 },
  { id: 'dip', name: 'Dip', pattern: 'horizontal-push', equipment: ['pullup-bar'], preference: 8, compound: true, muscles: ['chest', 'triceps'], cue: 'Lean forward slightly for chest, stop when your shoulders reach your elbows.' , level: 2 },

  // vertical push
  { id: 'ohp', name: 'Overhead press', pattern: 'vertical-push', equipment: ['barbell'], preference: 10, compound: true, muscles: ['shoulders', 'triceps'], cue: 'Squeeze your glutes so your lower back does not do the pressing.' , level: 1 },
  { id: 'db-press', name: 'Dumbbell shoulder press', pattern: 'vertical-push', equipment: ['dumbbells'], preference: 9, compound: true, muscles: ['shoulders', 'triceps'], cue: 'Press slightly in front of your ears, not behind your head.' , level: 1 },
  { id: 'machine-press', name: 'Shoulder press machine', pattern: 'vertical-push', equipment: ['machines'], preference: 7, compound: true, muscles: ['shoulders'], cue: 'Full range: all the way down before you press again.' , level: 1 },
  { id: 'pike-pushup', name: 'Pike push-up', pattern: 'vertical-push', equipment: ['none'], preference: 5, compound: true, muscles: ['shoulders', 'triceps'], cue: 'Hips high, crown of the head to the floor between your hands.' , level: 2 },
  { id: 'lateral-raise', name: 'Lateral raise', pattern: 'vertical-push', equipment: ['dumbbells', 'bands'], preference: 4, compound: false, muscles: ['shoulders'], cue: 'Light weight, lead with the elbows, stop at shoulder height.' , level: 1 },

  // horizontal pull
  { id: 'barbell-row', name: 'Barbell row', pattern: 'horizontal-pull', equipment: ['barbell'], preference: 10, compound: true, muscles: ['back', 'biceps'], cue: 'Torso around 45 degrees, pull to the belly button, no jerking.' , level: 1 },
  { id: 'db-row', name: 'Dumbbell row', pattern: 'horizontal-pull', equipment: ['dumbbells'], preference: 9, compound: true, muscles: ['back', 'biceps'], cue: 'Pull the elbow past your ribs, let the shoulder blade travel.' , level: 1 },
  { id: 'cable-row', name: 'Seated cable row', pattern: 'horizontal-pull', equipment: ['machines'], preference: 8, compound: true, muscles: ['back', 'biceps'], cue: 'Chest tall, do not rock backwards to move the stack.' , level: 1 },
  { id: 'inverted-row', name: 'Inverted row', pattern: 'horizontal-pull', equipment: ['pullup-bar'], preference: 7, compound: true, muscles: ['back', 'biceps'], cue: 'Body straight, chest to the bar. Walk your feet in to make it easier.' , level: 2 },
  { id: 'band-row', name: 'Band row', pattern: 'horizontal-pull', equipment: ['bands', 'none'], preference: 4, compound: true, muscles: ['back', 'biceps'], cue: 'Anchor at chest height, squeeze for a second at the end of every rep.' , level: 1 },

  // vertical pull
  { id: 'pullup', name: 'Pull-up', pattern: 'vertical-pull', equipment: ['pullup-bar'], preference: 10, compound: true, muscles: ['back', 'biceps'], cue: 'Start from a dead hang. Use a band or your feet if you need help.' , level: 2 },
  { id: 'lat-pulldown', name: 'Lat pulldown', pattern: 'vertical-pull', equipment: ['machines'], preference: 8, compound: true, muscles: ['back', 'biceps'], cue: 'Pull to your collarbone, control the way back up.' , level: 1 },
  { id: 'band-pulldown', name: 'Band pulldown', pattern: 'vertical-pull', equipment: ['bands'], preference: 5, compound: true, muscles: ['back', 'biceps'], cue: 'Anchor overhead, drive the elbows down towards your pockets.' , level: 1 },
  { id: 'db-pullover', name: 'Dumbbell pullover', pattern: 'vertical-pull', equipment: ['dumbbells'], preference: 4, compound: false, muscles: ['back', 'chest'], cue: 'Slow stretch overhead, keep the ribs from flaring.' , level: 1 },

  // core
  { id: 'plank', name: 'Plank', pattern: 'core', equipment: ['none'], preference: 6, compound: false, muscles: ['core'], cue: 'Squeeze glutes and abs together. Thirty hard seconds beats two soft minutes.' , level: 1 },
  { id: 'hanging-knee-raise', name: 'Hanging knee raise', pattern: 'core', equipment: ['pullup-bar'], preference: 8, compound: false, muscles: ['core'], cue: 'Curl the pelvis up, no swinging.' , level: 2 },
  { id: 'dead-bug', name: 'Dead bug', pattern: 'core', equipment: ['none'], preference: 5, compound: false, muscles: ['core'], cue: 'Lower back stays flat on the floor the entire set.' , level: 1 },
  { id: 'cable-crunch', name: 'Cable crunch', pattern: 'core', equipment: ['machines'], preference: 7, compound: false, muscles: ['core'], cue: 'Round the spine down, hips stay where they are.' , level: 1 },
  { id: 'side-plank', name: 'Side plank', pattern: 'core', equipment: ['none'], preference: 4, compound: false, muscles: ['core'], cue: 'Stack the hips, push the floor away with the bottom shoulder.' , level: 1 },

  // arms
  { id: 'db-curl', name: 'Dumbbell curl', pattern: 'arms', equipment: ['dumbbells'], preference: 8, compound: false, muscles: ['biceps'], cue: 'Elbows stay at your sides, no swinging from the hips.' , level: 1 },
  { id: 'barbell-curl', name: 'Barbell curl', pattern: 'arms', equipment: ['barbell'], preference: 7, compound: false, muscles: ['biceps'], cue: 'Control the lowering, that is where the growth is.' , level: 1 },
  { id: 'pushdown', name: 'Triceps pushdown', pattern: 'arms', equipment: ['machines'], preference: 7, compound: false, muscles: ['triceps'], cue: 'Upper arms locked in place, extend fully at the bottom.' , level: 1 },
  { id: 'skullcrusher', name: 'Skullcrusher', pattern: 'arms', equipment: ['barbell', 'dumbbells'], preference: 6, compound: false, muscles: ['triceps'], cue: 'Lower behind the forehead, elbows pointing at the ceiling.' , level: 1 },
  { id: 'diamond-pushup', name: 'Diamond push-up', pattern: 'arms', equipment: ['none'], preference: 4, compound: false, muscles: ['triceps'], cue: 'Hands under the chest, elbows brushing your ribs.' , level: 1 },
  { id: 'band-curl', name: 'Band curl', pattern: 'arms', equipment: ['bands'], preference: 3, compound: false, muscles: ['biceps'], cue: 'Stand on the band, pause at the top where the tension peaks.' , level: 1 },

  // ---------------------------------------------- harder variants, by level
  { id: 'front-squat', name: 'Front squat', pattern: 'squat', equipment: ['barbell'], preference: 9, compound: true, muscles: ['quads', 'glutes'], cue: 'Elbows high, bar resting on the shoulders not the hands.', level: 2 },
  { id: 'pistol-squat', name: 'Pistol squat', pattern: 'squat', equipment: ['none'], preference: 6, compound: true, muscles: ['quads', 'glutes'], cue: 'Hold a doorframe if you need to. Control the bottom, do not drop into it.', level: 3 },
  { id: 'nordic-curl', name: 'Nordic curl', pattern: 'hinge', equipment: ['none'], preference: 6, compound: false, muscles: ['hamstrings'], cue: 'Anchor your heels, lower as slowly as you can, catch with your hands.', level: 3 },
  { id: 'good-morning', name: 'Good morning', pattern: 'hinge', equipment: ['barbell'], preference: 6, compound: true, muscles: ['hamstrings', 'back'], cue: 'Light. Hinge, do not squat it, and keep the bar over mid-foot.', level: 2 },
  { id: 'decline-pushup', name: 'Feet-elevated push-up', pattern: 'horizontal-push', equipment: ['none'], preference: 7, compound: true, muscles: ['chest', 'triceps'], cue: 'Feet on a chair. Same line from head to heel.', level: 2 },
  { id: 'archer-pushup', name: 'Archer push-up', pattern: 'horizontal-push', equipment: ['none'], preference: 8, compound: true, muscles: ['chest', 'triceps'], cue: 'Wide hands, bend into one arm and keep the other straight. Alternate.', level: 3 },
  { id: 'weighted-dip', name: 'Weighted dip', pattern: 'horizontal-push', equipment: ['pullup-bar'], preference: 9, compound: true, muscles: ['chest', 'triceps'], cue: 'Add load once twelve clean bodyweight dips are easy.', level: 3 },
  { id: 'handstand-pushup', name: 'Wall handstand push-up', pattern: 'vertical-push', equipment: ['none'], preference: 8, compound: true, muscles: ['shoulders', 'triceps'], cue: 'Back to the wall, head to the floor under control. Stack a book to shorten the range.', level: 3 },
  { id: 'arnold-press', name: 'Arnold press', pattern: 'vertical-push', equipment: ['dumbbells'], preference: 7, compound: true, muscles: ['shoulders'], cue: 'Rotate the palms out as you press, back in on the way down.', level: 2 },
  { id: 'pendlay-row', name: 'Pendlay row', pattern: 'horizontal-pull', equipment: ['barbell'], preference: 9, compound: true, muscles: ['back'], cue: 'Bar starts on the floor every rep, torso stays parallel.', level: 2 },
  { id: 'chin-up', name: 'Chin-up', pattern: 'vertical-pull', equipment: ['pullup-bar'], preference: 9, compound: true, muscles: ['back', 'biceps'], cue: 'Palms towards you. Chest to the bar, not chin over it.', level: 2 },
  { id: 'weighted-pullup', name: 'Weighted pull-up', pattern: 'vertical-pull', equipment: ['pullup-bar'], preference: 11, compound: true, muscles: ['back', 'biceps'], cue: 'Belt or a dumbbell between the feet. Add load once ten clean reps are easy.', level: 3 },
  { id: 'archer-pullup', name: 'Archer pull-up', pattern: 'vertical-pull', equipment: ['pullup-bar'], preference: 9, compound: true, muscles: ['back', 'biceps'], cue: 'Pull to one hand, the other arm stays straight along the bar.', level: 3 },

  // ------------------------------------------------------ core, progressive
  { id: 'reverse-crunch', name: 'Reverse crunch', pattern: 'core', equipment: ['none'], preference: 6, compound: false, muscles: ['core'], cue: 'Lift the hips off the floor with the abs, not by swinging the legs.', level: 1 },
  { id: 'bicycle-crunch', name: 'Bicycle crunch', pattern: 'core', equipment: ['none'], preference: 5, compound: false, muscles: ['core', 'obliques'], cue: 'Slow. Shoulder to opposite knee, and pause when they meet.', level: 1 },
  { id: 'hollow-hold', name: 'Hollow hold', pattern: 'core', equipment: ['none'], preference: 7, compound: false, muscles: ['core'], cue: 'Lower back pressed into the floor. Lower the arms and legs until it is hard.', level: 2 },
  { id: 'ab-wheel', name: 'Ab wheel rollout', pattern: 'core', equipment: ['none', 'machines'], preference: 9, compound: false, muscles: ['core'], cue: 'From the knees. Do not let the lower back arch as you roll out.', level: 3 },
  { id: 'hanging-leg-raise', name: 'Hanging leg raise', pattern: 'core', equipment: ['pullup-bar'], preference: 10, compound: false, muscles: ['core'], cue: 'Straight legs to the bar, no swing. This is the hardest one here.', level: 3 },
  { id: 'l-sit', name: 'L-sit', pattern: 'core', equipment: ['none', 'pullup-bar'], preference: 8, compound: false, muscles: ['core'], cue: 'Push the floor down, legs straight out. Tuck them to make it easier.', level: 3 },
  { id: 'weighted-crunch', name: 'Weighted crunch', pattern: 'core', equipment: ['dumbbells', 'machines'], preference: 8, compound: false, muscles: ['core'], cue: 'Hold the weight at your chest. Abs respond to load like any other muscle.', level: 2 },
  { id: 'pallof-press', name: 'Pallof press', pattern: 'core', equipment: ['bands', 'machines'], preference: 7, compound: false, muscles: ['core', 'obliques'], cue: 'Resist the rotation. The work is in not turning.', level: 2 },

  // ------------------------------------------------------------ extra arms
  { id: 'hammer-curl', name: 'Hammer curl', pattern: 'arms', equipment: ['dumbbells'], preference: 7, compound: false, muscles: ['biceps', 'forearms'], cue: 'Thumbs up throughout. Hits the part of the arm that adds width.', level: 1 },
  { id: 'close-grip-bench', name: 'Close-grip bench press', pattern: 'arms', equipment: ['barbell'], preference: 8, compound: true, muscles: ['triceps', 'chest'], cue: 'Hands shoulder-width, elbows tucked. The heaviest triceps builder there is.', level: 2 },
  { id: 'overhead-extension', name: 'Overhead triceps extension', pattern: 'arms', equipment: ['dumbbells'], preference: 6, compound: false, muscles: ['triceps'], cue: 'Elbows pointing forward, stretch fully at the bottom.', level: 1 },

  // calves
  { id: 'calf-raise', name: 'Calf raise', pattern: 'calf', equipment: ['none', 'dumbbells', 'machines'], preference: 5, compound: false, muscles: ['calves'], cue: 'Full stretch at the bottom, pause at the top, no bouncing.' , level: 1 },
];

/** A training week: which patterns each session covers. */
export interface SessionTemplate {
  name: string;
  focus: string;
  patterns: Pattern[];
}

export const SPLITS: Record<number, { name: string; sessions: SessionTemplate[] }> = {
  2: {
    name: 'Two-day full body',
    sessions: [
      { name: 'Full body A', focus: 'Squat, push, pull', patterns: ['squat', 'horizontal-push', 'horizontal-pull', 'core'] },
      { name: 'Full body B', focus: 'Hinge, press, pull-up', patterns: ['hinge', 'vertical-push', 'vertical-pull', 'core'] },
    ],
  },
  3: {
    name: 'Three-day full body',
    sessions: [
      { name: 'Full body A', focus: 'Squat and horizontal work', patterns: ['squat', 'horizontal-push', 'horizontal-pull', 'core'] },
      { name: 'Full body B', focus: 'Hinge and vertical work', patterns: ['hinge', 'vertical-push', 'vertical-pull', 'core'] },
      { name: 'Full body C', focus: 'Single-leg and arms', patterns: ['lunge', 'horizontal-push', 'vertical-pull', 'arms', 'core'] },
    ],
  },
  4: {
    name: 'Upper / lower, twice each',
    sessions: [
      { name: 'Upper A', focus: 'Push-led upper body', patterns: ['horizontal-push', 'horizontal-pull', 'vertical-push', 'arms'] },
      { name: 'Lower A', focus: 'Squat-led legs', patterns: ['squat', 'hinge', 'lunge', 'calf', 'core'] },
      { name: 'Upper B', focus: 'Pull-led upper body', patterns: ['vertical-pull', 'vertical-push', 'horizontal-pull', 'arms'] },
      { name: 'Lower B', focus: 'Hinge-led legs', patterns: ['hinge', 'lunge', 'squat', 'calf', 'core'] },
    ],
  },
  5: {
    name: 'Push / pull / legs plus upper / lower',
    sessions: [
      { name: 'Push', focus: 'Chest, shoulders, triceps', patterns: ['horizontal-push', 'vertical-push', 'arms'] },
      { name: 'Pull', focus: 'Back and biceps', patterns: ['vertical-pull', 'horizontal-pull', 'arms'] },
      { name: 'Legs', focus: 'Quads, hamstrings, glutes', patterns: ['squat', 'hinge', 'lunge', 'calf'] },
      { name: 'Upper', focus: 'Whole upper body', patterns: ['horizontal-push', 'vertical-pull', 'vertical-push', 'core'] },
      { name: 'Lower', focus: 'Whole lower body', patterns: ['hinge', 'squat', 'lunge', 'core'] },
    ],
  },
  6: {
    name: 'Push / pull / legs, twice through',
    sessions: [
      { name: 'Push A', focus: 'Chest-led press day', patterns: ['horizontal-push', 'vertical-push', 'arms'] },
      { name: 'Pull A', focus: 'Vertical-led back day', patterns: ['vertical-pull', 'horizontal-pull', 'arms'] },
      { name: 'Legs A', focus: 'Squat-led legs', patterns: ['squat', 'lunge', 'calf', 'core'] },
      { name: 'Push B', focus: 'Shoulder-led press day', patterns: ['vertical-push', 'horizontal-push', 'arms'] },
      { name: 'Pull B', focus: 'Horizontal-led back day', patterns: ['horizontal-pull', 'vertical-pull', 'arms'] },
      { name: 'Legs B', focus: 'Hinge-led legs', patterns: ['hinge', 'lunge', 'calf', 'core'] },
    ],
  },
};
