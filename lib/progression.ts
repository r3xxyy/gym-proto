import type { Exercise, HistoryEntry } from '../types';
import { SPLIT } from '../constants/programs';
import { parseDateLocal } from './format';
import { countedSets } from './progress';

type Planned = Omit<Exercise, 'sets'>;

const SMALL_WEIGHT_KG = 20;

/** Rep range from a target like "40 kg × 6–8 × 3" or "40 kg × 8 × 3"; null if it has no reps part. */
export function parseRepRange(target: string): { lo: number; hi: number } | null {
  const m = target.match(/kg\s*[×xX]\s*(\d+)(?:\s*[–-]\s*(\d+))?\s*[×xX]/);
  if (!m) return null;
  const lo = parseInt(m[1], 10);
  const hi = m[2] ? parseInt(m[2], 10) : lo;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

/** Smallest sensible jump: 2.5 kg, or 1 kg for light isolation work. */
function increment(weight: number, type: Exercise['type']): number {
  return type === 'Iso' && weight < SMALL_WEIGHT_KG ? 1 : 2.5;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Next target by double progression. Take the heaviest weight used last time: if every set at that
 * weight reached the top of the rep range without grinding (RPE 8 or lower, or not logged), add
 * weight and drop back to the bottom of the range. Otherwise keep the weight and aim for one more
 * rep. Returns the planned target unchanged when nothing usable was logged.
 */
export function nextTarget(planned: Planned, last: Exercise | undefined): string {
  if (!last) return planned.target;
  const sets = countedSets(last).filter(s => parseFloat(s.weight) > 0);
  if (sets.length === 0) return planned.target;

  const topWeight = Math.max(...sets.map(s => parseFloat(s.weight)));
  const atTop = sets.filter(s => parseFloat(s.weight) === topWeight);
  const range = parseRepRange(planned.target) ?? { lo: parseInt(atTop[0].reps) || 0, hi: parseInt(atTop[0].reps) || 0 };
  const allReachedTop = range.hi > 0 && atTop.every(s => (parseInt(s.reps) || 0) >= range.hi);
  const notGrinding = atTop.every(s => !s.rpe || parseFloat(s.rpe) <= 8);

  let weight = topWeight;
  let reps: number;
  if (allReachedTop && notGrinding) {
    weight = topWeight + increment(topWeight, planned.type);
    reps = range.lo;
  } else {
    const best = Math.max(...atTop.map(s => parseInt(s.reps) || 0));
    reps = range.hi > 0 ? Math.min(range.hi, best + 1) : best;
  }

  // Keep the planned number of sets; a skipped set last time shouldn't shrink next week's plan.
  const plannedSets = planned.target.match(/kg\s*[×xX]\s*[\d–-]+\s*[×xX]\s*(\d+)/)?.[1];
  const count = plannedSets ? parseInt(plannedSets, 10) : sets.length;
  const dropset = planned.target.match(/\s\+\s*dropset.*$/i)?.[0] ?? '';
  return `${fmt(weight)} kg × ${reps} × ${count}${dropset}`;
}

/** Targets for each weekday: the planned exercises with weights stepped on from the last session. */
export function deriveTargets(
  base: Record<number, Planned[]>,
  history: HistoryEntry[],
): Record<number, Planned[]> {
  const result: Record<number, Planned[]> = {};
  for (const day of [1, 2, 3, 4, 5] as const) {
    const lastEntry = history
      .filter(h => h.workoutName === SPLIT[day] && !h.isRestDay)
      .sort((a, b) => parseDateLocal(b.date) - parseDateLocal(a.date))[0];
    result[day] = (base[day] ?? []).map(ex => {
      const last = lastEntry?.exercises.find(e => e.name === ex.name);
      return last ? { ...ex, target: nextTarget(ex, last) } : ex;
    });
  }
  return result;
}
