import type { HistoryEntry } from '../types';
import { parseDateLocal } from './format';

// Returns the most recent history entry for a given workoutName.
// If gym is provided: tries same-gym first; falls back to global with crossGym=true.
// crossGym=true means the returned entry is from a different venue — suppress color signal.
export function getMostRecentSession(
  workoutName: string,
  history: HistoryEntry[],
  gym?: string,
): { entry: HistoryEntry | null; crossGym: boolean } {
  const matching = history.filter(h => h.workoutName === workoutName);
  if (matching.length === 0) return { entry: null, crossGym: false };
  const best = (arr: HistoryEntry[]) =>
    arr.reduce((a, b) => parseDateLocal(b.date) > parseDateLocal(a.date) ? b : a);
  if (gym) {
    const sameGym = matching.filter(h => h.gym === gym);
    if (sameGym.length > 0) return { entry: best(sameGym), crossGym: false };
    return { entry: best(matching), crossGym: true };
  }
  return { entry: best(matching), crossGym: false };
}

// Returns the most recent history entry from a gym OTHER than the one specified.
export function getMostRecentSessionOtherGym(
  workoutName: string,
  history: HistoryEntry[],
  excludeGym: string,
): HistoryEntry | null {
  const matching = history.filter(h => h.workoutName === workoutName && h.gym && h.gym !== excludeGym);
  if (matching.length === 0) return null;
  return matching.reduce((a, b) => parseDateLocal(b.date) > parseDateLocal(a.date) ? b : a);
}

export function getPrevSets(exName: string, workoutName: string, history: HistoryEntry[], gym?: string): { weight: string; reps: string }[] {
  const isFree = FREE_WEIGHT_EXERCISES.has(exName);
  const { entry: prev } = getMostRecentSession(workoutName, history, isFree ? undefined : gym);
  if (!prev) return [];
  const prevEx = prev.exercises.find(e => e.name === exName);
  return prevEx?.sets.map(s => ({ weight: s.weight, reps: s.reps })) ?? [];
}

export type PrevRef = { sets: { weight: string; reps: string }[]; gym?: string; date: string; crossGym: boolean };

export function getPrevSessionInfo(
  exName: string,
  workoutName: string,
  history: HistoryEntry[],
  activeGym?: string,
): { primary: PrevRef | null; secondary: PrevRef | null } {
  const isFree = FREE_WEIGHT_EXERCISES.has(exName);

  // Primary: same-venue (or global for free weights)
  const { entry: p, crossGym: pCross } = getMostRecentSession(workoutName, history, isFree ? undefined : activeGym);
  const pEx = p?.exercises.find(e => e.name === exName);
  const primary: PrevRef | null = pEx?.sets.some(s => s.weight)
    ? { sets: pEx.sets.map(s => ({ weight: s.weight, reps: s.reps })), gym: p?.gym, date: p!.date, crossGym: isFree ? false : pCross }
    : null;

  // Secondary: last at a DIFFERENT venue — only for machine/cable at a known venue
  let secondary: PrevRef | null = null;
  if (!isFree && activeGym && !pCross) {
    const s = getMostRecentSessionOtherGym(workoutName, history, activeGym);
    const sEx = s?.exercises.find(e => e.name === exName);
    if (sEx?.sets.some(sv => sv.weight)) {
      secondary = { sets: sEx.sets.map(sv => ({ weight: sv.weight, reps: sv.reps })), gym: s?.gym, date: s!.date, crossGym: true };
    }
  }

  return { primary, secondary };
}


// Exercises where weight is venue-agnostic (dumbbells — same everywhere)
export const FREE_WEIGHT_EXERCISES = new Set([
  'Flat DB Bench',
  'Incline DB Bench',
  'Hammer Curl',
  'Incline Supinated Curl',
  'Seated DB Lateral Raise',
  'CS Rear Delt Row',
]);


// Last-session comparison — used for target colour on home screen and active card.
export function getLastSessionColor(exName: string, workoutName: string, targetStr: string, history: HistoryEntry[], activeGym?: string): { weightGreen: boolean; repsGreen: boolean } {
  const isFree = FREE_WEIGHT_EXERCISES.has(exName);
  const { entry: prev, crossGym } = getMostRecentSession(workoutName, history, isFree ? undefined : activeGym);
  // Suppress color signal on cross-venue comparisons for machine exercises
  if (!prev || crossGym) return { weightGreen: false, repsGreen: false };
  const prevEx = prev.exercises.find(e => e.name === exName);
  if (!prevEx) return { weightGreen: false, repsGreen: false };
  const prevMax = Math.max(...prevEx.sets.map(s => parseFloat(s.weight) || 0));
  if (!prevMax) return { weightGreen: false, repsGreen: false };
  const wMatch = targetStr.match(/(\d+\.?\d*)\s*kg/);
  const targetW = wMatch ? parseFloat(wMatch[1]) : 0;
  return { weightGreen: targetW > 0 && targetW > prevMax, repsGreen: false };
}

