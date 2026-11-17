import type { Exercise, HistoryEntry } from '../types';
import { parseDateLocal } from './format';
import { FREE_WEIGHT_EXERCISES } from './history-lookup';
import { countedSets } from './progress';

const MAX_PREVIOUS = 3;

/** How previous sessions relate to today's gym, so nothing is compared across venues silently. */
export type Basis = 'same gym' | 'different gym (not like-for-like)' | 'free weight (any gym)' | 'gym not recorded' | 'none';

const num = (v: string | undefined) => parseFloat(v ?? '');

/** Sets that were really done: a weight and reps, and not left unticked. */
export const loggedSets = (ex: Pick<Exercise, 'sets'>) => countedSets(ex).filter(s => num(s.weight) > 0 && num(s.reps) > 0);
export const topWeight = (ex: Pick<Exercise, 'sets'>) => Math.max(0, ...loggedSets(ex).map(s => num(s.weight)));

/** Past sessions of this exercise on the same footing as today: same workout, same gym (any gym for free weights). */
export function previousSessions(exName: string, workout: string, history: HistoryEntry[], gym: string | undefined) {
  const free = FREE_WEIGHT_EXERCISES.has(exName);
  const withEx = history
    .filter(h => !h.isRestDay && h.workoutName === workout)
    .map(h => ({ h, ex: h.exercises.find(e => e.name === exName) }))
    .filter((r): r is { h: HistoryEntry; ex: Exercise } => !!r.ex && loggedSets(r.ex).length > 0)
    .sort((a, b) => parseDateLocal(b.h.date) - parseDateLocal(a.h.date));

  let basis: Basis;
  let rows = withEx;
  if (free) {
    basis = 'free weight (any gym)';
  } else if (!gym) {
    basis = withEx.length ? 'gym not recorded' : 'none';
  } else {
    const same = withEx.filter(r => r.h.gym === gym);
    if (same.length) { rows = same; basis = 'same gym'; }
    else if (withEx.length) { rows = withEx.slice(0, 1); basis = 'different gym (not like-for-like)'; }
    else basis = 'none';
  }
  return { basis, rows: rows.slice(0, MAX_PREVIOUS) };
}

