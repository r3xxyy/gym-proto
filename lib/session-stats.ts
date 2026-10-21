import type { Exercise } from '../types';

/**
 * Live sessions only count sets that were ticked. History entries saved before ticks were
 * stored have no `done` flag, so there a set counts unless it was explicitly left unticked.
 */
export function sessionVolume(exercises: Pick<Exercise, 'sets'>[], live = false): number {
  let total = 0;
  for (const ex of exercises) {
    for (const set of ex.sets) {
      if (live ? set.done !== true : set.done === false) continue;
      total += (parseFloat(set.weight) || 0) * (parseInt(set.reps) || 0);
      for (const d of set.drops) total += (parseFloat(d.weight) || 0) * (parseInt(d.reps) || 0);
    }
  }
  return Math.round(total);
}

// Lifting is roughly 6 METs while a set is being done and 2 METs while recovering between sets.
// Resting energy (1 MET) is subtracted, so this is what the workout adds on top of an ordinary hour.
const NET_MET_ACTIVE = 6 - 1;
const NET_MET_REST = 2 - 1;

/** Estimated net kcal for a session, from bodyweight in kg and active/rest seconds. */
export function estimateNetKcal(bodyweightKg: number, activeSecs: number, restSecs: number): number {
  if (!(bodyweightKg > 0)) return 0;
  return Math.round(bodyweightKg * (NET_MET_ACTIVE * (activeSecs / 3600) + NET_MET_REST * (restSecs / 3600)));
}
