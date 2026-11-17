import type { Exercise } from '../types';
import { estimate1RM } from './progress';
import { restRange } from './rest';

export type PrevSet = { weight: string; reps: string; rpe?: string };

export type RpeContext = {
  exercise: Exercise;
  /** Index of the set that was just rated. */
  si: number;
  /** Same exercise, last session at this venue. */
  prevSets?: PrevSet[];
  /** Best estimated 1RM before today; undefined if the exercise has never been logged. */
  bestE1RM?: number;
};

export const num = (v: string | undefined) => parseFloat(v ?? '');
const e1 = (s: { weight: string; reps: string }) => estimate1RM(num(s.weight) || 0, parseInt(s.reps) || 0);

/**
 * Cheap local suspicion that a logged RPE doesn't fit its context. Returns what looks off, or null
 * to leave the set alone (the common case, so the network is rarely hit). New exercises only get the
 * checks that don't need history.
 */
export function rpeGate({ exercise, si, prevSets, bestE1RM }: RpeContext): string | null {
  const set = exercise.sets[si];
  const rpe = num(set?.rpe);
  const weight = num(set?.weight);
  if (!set || !set.done || isNaN(rpe) || !(weight > 0) || !(parseInt(set.reps) > 0)) return null;

  const [floor, , ceil] = restRange(exercise);
  const rest = set.restBefore;
  const mine = e1(set);
  const earlier = exercise.sets.slice(0, si).filter(s => s.done && num(s.weight) > 0);

  const prev = (prevSets ?? []).filter(s => num(s.weight) > 0);
  if (prev.length) {
    const prevBestE1 = Math.max(...prev.map(e1));
    const prevBestW = Math.max(...prev.map(s => num(s.weight)));
    // Logged near-max on something no heavier than last time, after a full rest.
    if (rpe >= 9 && weight <= prevBestW && mine <= prevBestE1 && (rest === undefined || rest >= ceil)) {
      return 'rated near max but the load is no higher than last session, after a full rest';
    }
    // Logged easy on a load heavier than one last session was RPE 9+.
    const hardW = Math.max(0, ...prev.filter(s => num(s.rpe) >= 9).map(s => num(s.weight)));
    if (rpe <= 7 && hardW > 0 && weight > hardW) {
      return `rated easy but heavier than the ${hardW} kg that was RPE 9+ last session`;
    }
  }
  if (rpe <= 7 && bestE1RM !== undefined && mine > bestE1RM) {
    return 'rated easy on a new estimated-1RM best';
  }

  // Short rest should make a working set harder, not easier.
  const topW = Math.max(weight, ...earlier.map(s => num(s.weight)));
  if (rpe <= 7 && si >= 1 && rest !== undefined && rest < floor * 0.6 && weight >= topW * 0.85) {
    return `rated easy after only ${rest}s rest at a working weight`;
  }

  // Fatigue accumulates: an equal-or-bigger set rated easier than an earlier one that was near max.
  if (si >= 2 && rpe <= 7 && earlier.some(s => num(s.rpe) >= 9 && e1(s) <= mine)) {
    return 'rated easy though an earlier set at no greater load was near max';
  }
  return null;
}

