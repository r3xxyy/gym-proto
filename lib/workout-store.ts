import { create } from 'zustand';
import { computeTick } from './tick-timing';

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

/** Marks a tick at `now` and returns that set's timing, or null for the session's first set. */
export function markTick(now: number, reps: number): { restSecs: number; setSecs?: number } | null {
  const timing = computeTick(now, lastTickAt, restEndedAt, reps);
  lastTickAt = now;
  return timing;
}

/** The rest timer ended or was resumed: the next set starts about now. */
export const markRestEnd = (now: number) => { restEndedAt = now; };

/** New or ended session: forget the last tick. A restored session seeds it from its newest `doneAt`. */
export const resetTicks = (seed?: number) => { lastTickAt = seed && seed > 0 ? seed : null; restEndedAt = null; };
