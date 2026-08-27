/**
 * Activity energy costs, in METs (multiples of resting metabolism).
 *
 * Values follow the 2011 Compendium of Physical Activities. For anything done
 * at a pace, a single MET is a lie — jogging at 6 km/h and running at 14 km/h
 * are not the same activity — so those entries carry a speed band table and the
 * MET is chosen from the pace actually logged.
 */

export type ExerciseKind = 'cardio' | 'strength' | 'sport' | 'daily' | 'flexibility';

export interface Exercise {
  id: string;
  name: string;
  aliases: string[];
  /** MET at a typical effort, used when no pace is known. */
  met: number;
  kind: ExerciseKind;
  /** [speed in km/h, MET] pairs, ascending. Only for paced activities. */
  speedBands?: [number, number][];
  /** Typical speed in km/h, used to turn a distance into a duration. */
  typicalSpeed?: number;
  /** Minutes assumed when a session is logged without one. */
  defaultMinutes: number;
  /** Muscles or systems trained, used by the coach for balance checks. */
  trains: string[];
}

export const EXERCISES: Exercise[] = [
  {
    id: 'running',
    name: 'Running',
    aliases: ['run', 'jog', 'jogging', 'ran', 'treadmill run', 'sprint', 'sprints'],
    met: 9.8,
    kind: 'cardio',
    speedBands: [[6.4, 6], [8, 8.3], [9.7, 9.8], [11.3, 11], [12.1, 11.8], [13, 12.8], [14.5, 14.5], [16, 16], [17.5, 19]],
    typicalSpeed: 9.7,
    defaultMinutes: 30,
    trains: ['legs', 'cardio'],
  },
  {
    id: 'walking',
    name: 'Walking',
    aliases: ['walk', 'walked', 'brisk walk', 'stroll', 'steps'],
    met: 3.5,
    kind: 'cardio',
    speedBands: [[3.2, 2.8], [4, 3], [4.8, 3.5], [5.6, 4.3], [6.4, 5], [7.2, 7]],
    typicalSpeed: 5,
    defaultMinutes: 30,
    trains: ['legs', 'cardio'],
  },
  {
    id: 'cycling',
    name: 'Cycling',
    aliases: ['cycle', 'cycled', 'bike', 'biking', 'bicycle', 'spinning', 'spin class'],
    met: 6.8,
    kind: 'cardio',
    speedBands: [[12, 4], [16, 6.8], [19, 8], [22, 10], [25, 12], [30, 15.8]],
    typicalSpeed: 18,
    defaultMinutes: 40,
    trains: ['legs', 'cardio'],
  },
  {
    id: 'swimming',
    name: 'Swimming',
    aliases: ['swim', 'swam', 'laps', 'freestyle'],
    met: 8.3,
    kind: 'cardio',
    typicalSpeed: 3,
    defaultMinutes: 30,
    trains: ['full-body', 'cardio'],
  },
  {
    id: 'weights',
    name: 'Weight training',
    aliases: ['gym', 'lifting', 'weight training', 'weights', 'resistance training', 'strength training', 'workout'],
    met: 5,
    kind: 'strength',
    defaultMinutes: 45,
    trains: ['full-body', 'strength'],
  },
  {
    id: 'bodyweight',
    name: 'Bodyweight circuit',
    aliases: ['calisthenics', 'push ups', 'pushups', 'pull ups', 'pullups', 'squats', 'burpees', 'plank', 'home workout'],
    met: 5.5,
    kind: 'strength',
    defaultMinutes: 25,
    trains: ['full-body', 'strength'],
  },
  {
    id: 'hiit',
    name: 'HIIT / circuit training',
    aliases: ['hiit', 'circuit', 'crossfit', 'tabata', 'interval training', 'bootcamp'],
    met: 8,
    kind: 'cardio',
    defaultMinutes: 20,
    trains: ['full-body', 'cardio'],
  },
  {
    id: 'yoga',
    name: 'Yoga',
    aliases: ['hatha yoga', 'asana', 'stretching', 'surya namaskar', 'suryanamaskar'],
    met: 3,
    kind: 'flexibility',
    defaultMinutes: 30,
    trains: ['mobility'],
  },
  {
    id: 'power-yoga',
    name: 'Power yoga',
    aliases: ['vinyasa', 'ashtanga', 'hot yoga'],
    met: 4.5,
    kind: 'flexibility',
    defaultMinutes: 45,
    trains: ['mobility', 'strength'],
  },
  {
    id: 'skipping',
    name: 'Skipping (jump rope)',
    aliases: ['jump rope', 'jumping rope', 'rope skipping'],
    met: 11.8,
    kind: 'cardio',
    defaultMinutes: 15,
    trains: ['legs', 'cardio'],
  },
  {
    id: 'rowing',
    name: 'Rowing machine',
    aliases: ['rower', 'row', 'ergo', 'erg'],
    met: 7,
    kind: 'cardio',
    typicalSpeed: 12,
    defaultMinutes: 25,
    trains: ['full-body', 'cardio'],
  },
  {
    id: 'elliptical',
    name: 'Elliptical / cross trainer',
    aliases: ['cross trainer', 'crosstrainer'],
    met: 5,
    kind: 'cardio',
    defaultMinutes: 30,
    trains: ['legs', 'cardio'],
  },
  {
    id: 'stairs',
    name: 'Stair climbing',
    aliases: ['stairs', 'stair master', 'climbing stairs'],
    met: 8.8,
    kind: 'cardio',
    defaultMinutes: 15,
    trains: ['legs', 'cardio'],
  },
  {
    id: 'boxing',
    name: 'Boxing / kickboxing',
    aliases: ['box', 'kickboxing', 'punching bag', 'mma'],
    met: 7.8,
    kind: 'sport',
    defaultMinutes: 45,
    trains: ['full-body', 'cardio'],
  },
  {
    id: 'cricket',
    name: 'Cricket',
    aliases: ['gully cricket'],
    met: 4.8,
    kind: 'sport',
    defaultMinutes: 60,
    trains: ['cardio'],
  },
  {
    id: 'football',
    name: 'Football (soccer)',
    aliases: ['soccer'],
    met: 7,
    kind: 'sport',
    defaultMinutes: 60,
    trains: ['legs', 'cardio'],
  },
  {
    id: 'basketball',
    name: 'Basketball',
    aliases: ['hoops'],
    met: 6.5,
    kind: 'sport',
    defaultMinutes: 60,
    trains: ['legs', 'cardio'],
  },
  {
    id: 'badminton',
    name: 'Badminton',
    aliases: ['shuttle'],
    met: 5.5,
    kind: 'sport',
    defaultMinutes: 45,
    trains: ['cardio'],
  },
  {
    id: 'tennis',
    name: 'Tennis',
    aliases: ['lawn tennis'],
    met: 7.3,
    kind: 'sport',
    defaultMinutes: 60,
    trains: ['cardio'],
  },
  {
    id: 'table-tennis',
    name: 'Table tennis',
    aliases: ['ping pong', 'tt'],
    met: 4,
    kind: 'sport',
    defaultMinutes: 45,
    trains: ['cardio'],
  },
  {
    id: 'kabaddi',
    name: 'Kabaddi',
    aliases: [],
    met: 7,
    kind: 'sport',
    defaultMinutes: 45,
    trains: ['full-body', 'cardio'],
  },
  {
    id: 'volleyball',
    name: 'Volleyball',
    aliases: [],
    met: 4,
    kind: 'sport',
    defaultMinutes: 45,
    trains: ['cardio'],
  },
  {
    id: 'squash',
    name: 'Squash',
    aliases: [],
    met: 7.3,
    kind: 'sport',
    defaultMinutes: 45,
    trains: ['cardio'],
  },
  {
    id: 'dancing',
    name: 'Dancing',
    aliases: ['dance', 'zumba', 'bhangra', 'garba'],
    met: 5.5,
    kind: 'cardio',
    defaultMinutes: 45,
    trains: ['cardio'],
  },
  {
    id: 'hiking',
    name: 'Hiking / trekking',
    aliases: ['trek', 'trekking', 'hike'],
    met: 6,
    kind: 'cardio',
    typicalSpeed: 4,
    defaultMinutes: 90,
    trains: ['legs', 'cardio'],
  },
  {
    id: 'housework',
    name: 'Housework',
    aliases: ['cleaning', 'chores', 'mopping', 'sweeping'],
    met: 3.3,
    kind: 'daily',
    defaultMinutes: 30,
    trains: [],
  },
  {
    id: 'gardening',
    name: 'Gardening',
    aliases: ['garden'],
    met: 3.8,
    kind: 'daily',
    defaultMinutes: 30,
    trains: [],
  },
];

export const EXERCISE_BY_ID: Map<string, Exercise> = new Map(EXERCISES.map((e) => [e.id, e]));

export function getExercise(id: string): Exercise | undefined {
  return EXERCISE_BY_ID.get(id);
}

/** Pick the MET that matches a pace, interpolating between bands. */
export function metForSpeed(exercise: Exercise, kmh: number): number {
  const bands = exercise.speedBands;
  if (!bands || bands.length === 0) return exercise.met;
  const first = bands[0] as [number, number];
  if (kmh <= first[0]) return first[1];
  for (let i = 1; i < bands.length; i += 1) {
    const [speed, met] = bands[i] as [number, number];
    const [prevSpeed, prevMet] = bands[i - 1] as [number, number];
    if (kmh <= speed) {
      const t = (kmh - prevSpeed) / (speed - prevSpeed);
      return prevMet + t * (met - prevMet);
    }
  }
  return (bands[bands.length - 1] as [number, number])[1];
}
