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
