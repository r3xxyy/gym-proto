import { create } from 'zustand';

/**
 * Per-second display values for the active workout. Kept out of HomeScreen state so the
 * clock ticking re-renders only the small components that subscribe to it, not the whole screen.
 */
type TimerState = {
  seconds: number;          // active (non-rest) seconds
  totalSessionSecs: number; // cumulative from start, never pauses
  currentRestSecs: number;  // per-set rest display
};

export const useTimerStore = create<TimerState>(() => ({ seconds: 0, totalSessionSecs: 0, currentRestSecs: 0 }));

export const setSeconds = (seconds: number) => useTimerStore.setState({ seconds });
export const setTotalSessionSecs = (totalSessionSecs: number) => useTimerStore.setState({ totalSessionSecs });
export const setCurrentRestSecs = (currentRestSecs: number) => useTimerStore.setState({ currentRestSecs });

// Last time any set was ticked this session, and the last time a rest ended (timer ran out or was resumed).
let lastTickAt: number | null = null;
let restEndedAt: number | null = null;

/** Assumed lifting time of a set with no measured start: about 4 s a rep plus setup. */
export const estimateSetSecs = (reps: number) => Math.round(Math.max(1, reps) * 4 + 10);

/**
 * Marks a tick at `now` and returns the timing for that set, or null for the session's first set.
 * `setSecs` is only set when a rest ended between the previous tick and this one and the gap since then
 * is plausible for a set; `restSecs` is the tick-to-tick gap minus the set itself (measured, else estimated).
 */
export function markTick(now: number, reps: number): { restSecs: number; setSecs?: number } | null {
  const prev = lastTickAt;
  const ended = restEndedAt;
  lastTickAt = now;
  if (prev === null) return null;
  const gap = Math.max(0, Math.round((now - prev) / 1000));
  const measured = ended !== null && ended > prev ? Math.round((now - ended) / 1000) : undefined;
  const setSecs = measured !== undefined && measured >= 3 && measured <= 300 ? measured : undefined;
  return { restSecs: Math.max(0, gap - (setSecs ?? estimateSetSecs(reps))), ...(setSecs !== undefined ? { setSecs } : {}) };
}

/** The rest timer ended or was resumed: the next set starts about now. */
export const markRestEnd = (now: number) => { restEndedAt = now; };

/** New or ended session: forget the last tick. A restored session seeds it from its newest `doneAt`. */
export const resetTicks = (seed?: number) => { lastTickAt = seed && seed > 0 ? seed : null; restEndedAt = null; };
