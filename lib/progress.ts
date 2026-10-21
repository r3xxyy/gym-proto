import type { Exercise, HistoryEntry } from '../types';
import { sessionVolume } from './session-stats';

const MONTH_IDX: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** Parses "Tue, 14 Apr 2026" as LOCAL midnight, avoiding UTC skew on negative offsets. NaN if it can't. */
export function parseDateLocal(dateStr: string): number {
  // en-GB can abbreviate September as "Sept", so only the first three letters count.
  const m = dateStr.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/);
  if (!m) return NaN;
  const month = MONTH_IDX[m[2].slice(0, 1).toUpperCase() + m[2].slice(1, 3).toLowerCase()];
  if (month === undefined) return NaN;
  return new Date(parseInt(m[3]), month, parseInt(m[1])).getTime();
}

/** Sets that count towards stats: filled in, and not explicitly left unticked. */
export function countedSets(ex: Pick<Exercise, 'sets'>) {
  return ex.sets.filter(s => s.done !== false && (s.weight || s.reps));
}

/** Epley estimated one-rep max, reps capped at 12 (beyond that the estimate drifts), to the nearest 0.5 kg. */
export function estimate1RM(weight: number, reps: number): number {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return Math.round(weight * (1 + Math.min(reps, 12) / 30) * 2) / 2;
}

export type SeriesPoint = {
  date: string;
  ts: number;
  e1rm: number;
  topWeight: number;
  topReps: number;
  volume: number;
};

/** One point per session for an exercise, oldest first. */
export function exerciseSeries(history: HistoryEntry[], name: string): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const entry of history) {
    if (entry.isRestDay) continue;
    const ts = parseDateLocal(entry.date);
    if (isNaN(ts)) continue;
    for (const ex of entry.exercises) {
      if (ex.name !== name) continue;
      const sets = countedSets(ex);
      let e1rm = 0, topWeight = 0, topReps = 0;
      for (const s of sets) {
        const w = parseFloat(s.weight) || 0;
        const r = parseInt(s.reps) || 0;
        const est = estimate1RM(w, r);
        if (est > e1rm) { e1rm = est; topWeight = w; topReps = r; }
      }
      if (e1rm > 0) points.push({ date: entry.date, ts, e1rm, topWeight, topReps, volume: sessionVolume([{ sets }]) });
    }
  }
  return points.sort((a, b) => a.ts - b.ts);
}

export type PersonalRecord = { name: string; e1rm: number; weight: number; reps: number; date: string; ts: number };

/** Best estimated one-rep max per exercise, most recently set first. */
export function personalRecords(history: HistoryEntry[]): PersonalRecord[] {
  const best: Record<string, PersonalRecord> = {};
  for (const entry of history) {
    if (entry.isRestDay) continue;
    const ts = parseDateLocal(entry.date);
    for (const ex of entry.exercises) {
      for (const s of countedSets(ex)) {
        const w = parseFloat(s.weight) || 0;
        const r = parseInt(s.reps) || 0;
        const est = estimate1RM(w, r);
        if (est > 0 && (!best[ex.name] || est > best[ex.name].e1rm)) {
          best[ex.name] = { name: ex.name, e1rm: est, weight: w, reps: r, date: entry.date, ts };
        }
      }
    }
  }
  return Object.values(best).sort((a, b) => b.ts - a.ts);
}
