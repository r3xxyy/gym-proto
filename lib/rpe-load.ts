import type { HistoryEntry } from '../types';
import { parseRepRange, increment } from './progression';
import { loggedSets, previousSessions } from './prev-sessions';
import { estimate1RM } from './progress';

const num = (v: string | undefined) => parseFloat(v ?? '');
const TARGET_RPE = 8;

/**
 * Estimated one-rep max that counts the reps left in the tank: a set of 8 at RPE 7 had 3 in reserve,
 * so it is treated like a set of 11. `bias` shifts the logged RPE by the lifter's own tendency.
 * Zero when the set has no RPE, since without one the set says nothing about effort.
 */
export function e1RMAtRpe(weight: number, reps: number, rpe: number, bias = 0): number {
  if (!(weight > 0) || !(reps > 0) || isNaN(rpe)) return 0;
  const rir = Math.max(0, 10 - Math.min(10, rpe + bias));
  return estimate1RM(weight, reps + rir);
}

const roundLoad = (w: number, type: 'Compound' | 'Iso') => {
  const step = increment(w, type);
  return Math.round(w / step) * step;
};

/** The load that should land at RPE 8 for `reps`, from an RPE-aware 1RM. */
export function loadAtRpe8(e1rm: number, reps: number, type: 'Compound' | 'Iso'): number {
  if (!(e1rm > 0) || !(reps > 0)) return 0;
  const eff = Math.min(12, reps + (10 - TARGET_RPE));
  return roundLoad(e1rm / (1 + eff / 30), type);
}

export type Rpe8Guide = { kg: number; reps: number; basedOn: string };

/**
 * Where RPE 8 sits for an exercise, from its recent like-for-like sessions (same gym, any gym for free
 * weights). Uses the median RPE-aware 1RM of the sets that carry an RPE, so one odd set doesn't move it.
 * Null when there are no such sets or the only history is from another gym.
 */
export function rpe8Guide(
  ex: { name: string; type: 'Compound' | 'Iso'; target: string },
  workout: string,
  history: HistoryEntry[],
  gym: string | undefined,
  bias = 0,
): Rpe8Guide | null {
  const { basis, rows } = previousSessions(ex.name, workout, history, gym);
  if (basis === 'none' || basis === 'different gym (not like-for-like)') return null;
  const e1s = rows.slice(0, 2).flatMap(r => loggedSets(r.ex)
    .map(s => e1RMAtRpe(num(s.weight), num(s.reps), num(s.rpe), bias)).filter(v => v > 0));
  if (!e1s.length) return null;
  const sorted = [...e1s].sort((a, b) => a - b);
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const reps = parseRepRange(ex.target)?.hi ?? 0;
  if (!reps) return null;
  const kg = loadAtRpe8(mid, reps, ex.type);
  return kg > 0 ? { kg, reps, basedOn: `${e1s.length} set${e1s.length > 1 ? 's' : ''} with RPE, last ${Math.min(2, rows.length)} session${rows.length > 1 ? 's' : ''}` } : null;
}
