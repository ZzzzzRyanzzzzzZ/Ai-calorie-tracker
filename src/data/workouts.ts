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
  /** True for multi-joint lifts, which get lower reps and more rest. */
  compound: boolean;
  muscles: string[];
  cue: string;
}

export const MOVEMENTS: Movement[] = [
  // squat
  { id: 'back-squat', name: 'Back squat', pattern: 'squat', equipment: ['barbell'], preference: 10, compound: true, muscles: ['quads', 'glutes'], cue: 'Brace before you unrack, sit between your hips, knees track over the toes.' },
  { id: 'goblet-squat', name: 'Goblet squat', pattern: 'squat', equipment: ['dumbbells'], preference: 8, compound: true, muscles: ['quads', 'glutes'], cue: 'Hold the bell at your chest, elbows inside your knees at the bottom.' },
  { id: 'leg-press', name: 'Leg press', pattern: 'squat', equipment: ['machines'], preference: 7, compound: true, muscles: ['quads', 'glutes'], cue: 'Do not let your lower back round off the pad at the bottom.' },
  { id: 'bw-squat', name: 'Bodyweight squat', pattern: 'squat', equipment: ['none', 'bands'], preference: 4, compound: true, muscles: ['quads', 'glutes'], cue: 'Slow on the way down, three seconds, to make it count without load.' },

  // hinge
  { id: 'deadlift', name: 'Deadlift', pattern: 'hinge', equipment: ['barbell'], preference: 10, compound: true, muscles: ['hamstrings', 'glutes', 'back'], cue: 'Push the floor away, keep the bar against your legs the whole way.' },
  { id: 'rdl', name: 'Romanian deadlift', pattern: 'hinge', equipment: ['barbell', 'dumbbells'], preference: 9, compound: true, muscles: ['hamstrings', 'glutes'], cue: 'Push your hips back, soft knees, stop when your hamstrings run out.' },
  { id: 'hip-thrust', name: 'Hip thrust', pattern: 'hinge', equipment: ['barbell', 'dumbbells'], preference: 7, compound: true, muscles: ['glutes'], cue: 'Ribs down, chin tucked, squeeze hard for a second at the top.' },
  { id: 'glute-bridge', name: 'Glute bridge', pattern: 'hinge', equipment: ['none', 'bands'], preference: 4, compound: false, muscles: ['glutes'], cue: 'Drive through your heels, do not arch your lower back to get higher.' },
  { id: 'single-leg-rdl', name: 'Single-leg RDL', pattern: 'hinge', equipment: ['none', 'dumbbells'], preference: 5, compound: false, muscles: ['hamstrings', 'glutes'], cue: 'Hips square to the floor, reach the free leg straight back.' },

  // lunge
  { id: 'walking-lunge', name: 'Walking lunge', pattern: 'lunge', equipment: ['none', 'dumbbells'], preference: 7, compound: true, muscles: ['quads', 'glutes'], cue: 'Long step, back knee to just above the floor, torso upright.' },
  { id: 'split-squat', name: 'Bulgarian split squat', pattern: 'lunge', equipment: ['none', 'dumbbells'], preference: 8, compound: true, muscles: ['quads', 'glutes'], cue: 'Back foot elevated, weight through the front heel. It is meant to be hard.' },
  { id: 'step-up', name: 'Step-up', pattern: 'lunge', equipment: ['none', 'dumbbells'], preference: 6, compound: true, muscles: ['quads', 'glutes'], cue: 'Do not push off the bottom foot, make the top leg do all of it.' },

  // horizontal push
  { id: 'bench-press', name: 'Bench press', pattern: 'horizontal-push', equipment: ['barbell'], preference: 10, compound: true, muscles: ['chest', 'triceps'], cue: 'Shoulder blades pinned back, bar to the lower chest, elbows about 45 degrees.' },
  { id: 'db-bench', name: 'Dumbbell bench press', pattern: 'horizontal-push', equipment: ['dumbbells'], preference: 9, compound: true, muscles: ['chest', 'triceps'], cue: 'Lower until your upper arms are level with your torso, no deeper.' },
  { id: 'chest-press', name: 'Chest press machine', pattern: 'horizontal-push', equipment: ['machines'], preference: 7, compound: true, muscles: ['chest', 'triceps'], cue: 'Set the seat so the handles line up with the middle of your chest.' },
  { id: 'pushup', name: 'Push-up', pattern: 'horizontal-push', equipment: ['none', 'bands'], preference: 6, compound: true, muscles: ['chest', 'triceps'], cue: 'Body in one line, elbows back not flared. Elevate your hands if you cannot.' },
  { id: 'dip', name: 'Dip', pattern: 'horizontal-push', equipment: ['pullup-bar'], preference: 8, compound: true, muscles: ['chest', 'triceps'], cue: 'Lean forward slightly for chest, stop when your shoulders reach your elbows.' },

  // vertical push
  { id: 'ohp', name: 'Overhead press', pattern: 'vertical-push', equipment: ['barbell'], preference: 10, compound: true, muscles: ['shoulders', 'triceps'], cue: 'Squeeze your glutes so your lower back does not do the pressing.' },
  { id: 'db-press', name: 'Dumbbell shoulder press', pattern: 'vertical-push', equipment: ['dumbbells'], preference: 9, compound: true, muscles: ['shoulders', 'triceps'], cue: 'Press slightly in front of your ears, not behind your head.' },
  { id: 'machine-press', name: 'Shoulder press machine', pattern: 'vertical-push', equipment: ['machines'], preference: 7, compound: true, muscles: ['shoulders'], cue: 'Full range: all the way down before you press again.' },
  { id: 'pike-pushup', name: 'Pike push-up', pattern: 'vertical-push', equipment: ['none'], preference: 5, compound: true, muscles: ['shoulders', 'triceps'], cue: 'Hips high, crown of the head to the floor between your hands.' },
  { id: 'lateral-raise', name: 'Lateral raise', pattern: 'vertical-push', equipment: ['dumbbells', 'bands'], preference: 4, compound: false, muscles: ['shoulders'], cue: 'Light weight, lead with the elbows, stop at shoulder height.' },

  // horizontal pull
  { id: 'barbell-row', name: 'Barbell row', pattern: 'horizontal-pull', equipment: ['barbell'], preference: 10, compound: true, muscles: ['back', 'biceps'], cue: 'Torso around 45 degrees, pull to the belly button, no jerking.' },
  { id: 'db-row', name: 'Dumbbell row', pattern: 'horizontal-pull', equipment: ['dumbbells'], preference: 9, compound: true, muscles: ['back', 'biceps'], cue: 'Pull the elbow past your ribs, let the shoulder blade travel.' },
  { id: 'cable-row', name: 'Seated cable row', pattern: 'horizontal-pull', equipment: ['machines'], preference: 8, compound: true, muscles: ['back', 'biceps'], cue: 'Chest tall, do not rock backwards to move the stack.' },
  { id: 'inverted-row', name: 'Inverted row', pattern: 'horizontal-pull', equipment: ['pullup-bar'], preference: 7, compound: true, muscles: ['back', 'biceps'], cue: 'Body straight, chest to the bar. Walk your feet in to make it easier.' },
  { id: 'band-row', name: 'Band row', pattern: 'horizontal-pull', equipment: ['bands', 'none'], preference: 4, compound: true, muscles: ['back', 'biceps'], cue: 'Anchor at chest height, squeeze for a second at the end of every rep.' },

  // vertical pull
  { id: 'pullup', name: 'Pull-up', pattern: 'vertical-pull', equipment: ['pullup-bar'], preference: 10, compound: true, muscles: ['back', 'biceps'], cue: 'Start from a dead hang. Use a band or your feet if you need help.' },
  { id: 'lat-pulldown', name: 'Lat pulldown', pattern: 'vertical-pull', equipment: ['machines'], preference: 8, compound: true, muscles: ['back', 'biceps'], cue: 'Pull to your collarbone, control the way back up.' },
  { id: 'band-pulldown', name: 'Band pulldown', pattern: 'vertical-pull', equipment: ['bands'], preference: 5, compound: true, muscles: ['back', 'biceps'], cue: 'Anchor overhead, drive the elbows down towards your pockets.' },
  { id: 'db-pullover', name: 'Dumbbell pullover', pattern: 'vertical-pull', equipment: ['dumbbells'], preference: 4, compound: false, muscles: ['back', 'chest'], cue: 'Slow stretch overhead, keep the ribs from flaring.' },

  // core
  { id: 'plank', name: 'Plank', pattern: 'core', equipment: ['none'], preference: 6, compound: false, muscles: ['core'], cue: 'Squeeze glutes and abs together. Thirty hard seconds beats two soft minutes.' },
  { id: 'hanging-knee-raise', name: 'Hanging knee raise', pattern: 'core', equipment: ['pullup-bar'], preference: 8, compound: false, muscles: ['core'], cue: 'Curl the pelvis up, no swinging.' },
  { id: 'dead-bug', name: 'Dead bug', pattern: 'core', equipment: ['none'], preference: 5, compound: false, muscles: ['core'], cue: 'Lower back stays flat on the floor the entire set.' },
  { id: 'cable-crunch', name: 'Cable crunch', pattern: 'core', equipment: ['machines'], preference: 7, compound: false, muscles: ['core'], cue: 'Round the spine down, hips stay where they are.' },
  { id: 'side-plank', name: 'Side plank', pattern: 'core', equipment: ['none'], preference: 4, compound: false, muscles: ['core'], cue: 'Stack the hips, push the floor away with the bottom shoulder.' },

  // arms
  { id: 'db-curl', name: 'Dumbbell curl', pattern: 'arms', equipment: ['dumbbells'], preference: 8, compound: false, muscles: ['biceps'], cue: 'Elbows stay at your sides, no swinging from the hips.' },
  { id: 'barbell-curl', name: 'Barbell curl', pattern: 'arms', equipment: ['barbell'], preference: 7, compound: false, muscles: ['biceps'], cue: 'Control the lowering, that is where the growth is.' },
  { id: 'pushdown', name: 'Triceps pushdown', pattern: 'arms', equipment: ['machines'], preference: 7, compound: false, muscles: ['triceps'], cue: 'Upper arms locked in place, extend fully at the bottom.' },
  { id: 'skullcrusher', name: 'Skullcrusher', pattern: 'arms', equipment: ['barbell', 'dumbbells'], preference: 6, compound: false, muscles: ['triceps'], cue: 'Lower behind the forehead, elbows pointing at the ceiling.' },
  { id: 'diamond-pushup', name: 'Diamond push-up', pattern: 'arms', equipment: ['none'], preference: 4, compound: false, muscles: ['triceps'], cue: 'Hands under the chest, elbows brushing your ribs.' },
  { id: 'band-curl', name: 'Band curl', pattern: 'arms', equipment: ['bands'], preference: 3, compound: false, muscles: ['biceps'], cue: 'Stand on the band, pause at the top where the tension peaks.' },

  // calves
  { id: 'calf-raise', name: 'Calf raise', pattern: 'calf', equipment: ['none', 'dumbbells', 'machines'], preference: 5, compound: false, muscles: ['calves'], cue: 'Full stretch at the bottom, pause at the top, no bouncing.' },
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
