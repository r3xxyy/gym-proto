import type { Exercise } from '../types';

// ─── Rest duration by movement tier ───────────────────────────────────────────
// Three-point lookup: [floor, mid, ceil] driven by RPE band
//   RPE ≤7 → floor  |  RPE 8 → mid  |  RPE 9+ → ceil  |  blank → mid
//
// Tier            floor   mid     ceil
// Leg compound    3:30    4:00    4:30   (hack squat, leg press, BSS, hip thrust, RDL)
// Push compound   3:00    3:45    4:00   (chest pressing)
// Pull compound   2:30    3:00    3:30   (rows, pulldowns, pull-ups)
// Shoulder press  2:30    3:15    3:30   (Anterior Delt compound)
// Arm iso         1:45    2:15    2:30   (curls + tris)
// Standard iso    75s     90s     2:00   (pec deck, leg curl, pull-through, calves, delts…)
// Core            75s     90s     2:00   (cable crunch, ab work)

const LEG_COMPOUND_MUSCLES = new Set(['quads', 'glutes', 'glute maximus', 'hamstrings']);
const PUSH_MUSCLES         = new Set(['mid chest', 'upper chest', 'lower chest', 'chest']);
const ARM_MUSCLES          = new Set(['biceps', 'biceps long head', 'biceps short head', 'brachialis', 'triceps']);
const CORE_MUSCLES         = new Set(['abs', 'obliques']);

// [floor, mid, ceil] in seconds
const REST_TIERS = {
  leg:      [210, 240, 270] as const,
  push:     [180, 225, 240] as const,
  pull:     [150, 180, 210] as const,
  shoulder: [150, 195, 210] as const,
  arm:      [105, 135, 150] as const,
  iso:      [ 75,  90, 120] as const,
  core:     [ 75,  90, 120] as const,
};

export function getRestDuration(exercise: Exercise): number {
  const lastSet = exercise.sets[exercise.sets.length - 1];
  const rpe = parseFloat(lastSet?.rpe ?? '');

  // band: 0 = floor (RPE ≤7), 1 = mid (RPE 8 / unlogged), 2 = ceil (RPE 9+)
  let band: 0 | 1 | 2 = 1;
  if (!isNaN(rpe)) {
    if (rpe <= 7) band = 0;
    else if (rpe <= 8) band = 1;
    else band = 2;
  }

  const name    = exercise.name.toLowerCase();
  const primary = exercise.muscles.split(',')[0].trim().toLowerCase();

  let tier: keyof typeof REST_TIERS;

  if (CORE_MUSCLES.has(primary)) {
    tier = 'core';
  } else if (exercise.type === 'Iso') {
    tier = ARM_MUSCLES.has(primary) ? 'arm' : 'iso';
  } else {
    // Compounds
    if (primary === 'anterior delt')                                                  tier = 'shoulder';
    else if (LEG_COMPOUND_MUSCLES.has(primary) && !name.includes('pull-through'))    tier = 'leg';
    else if (PUSH_MUSCLES.has(primary))                                               tier = 'push';
    else                                                                              tier = 'pull';
  }

  return REST_TIERS[tier][band];
}

