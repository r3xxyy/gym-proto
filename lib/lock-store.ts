import { create } from 'zustand';

/** A set row being chained shut. Rects are in window points, so the overlay can sit anywhere. */
export type LockRect = { x: number; y: number; w: number; h: number };
export type Lock = { id: number; rect: LockRect; startedAt: number; killedAt?: number };

// Timeline of one lock, in ms from the tap.
export const CLAMP_MS = 200;   // carabiner closes, haptic fires
export const SHIMMER_END_MS = 700;
export const LOCK_MS = 900;    // chain has faded out
export const KILL_MS = 100;    // quick fade when the list scrolls

const MAX_LOCKS = 4;
let nextId = 1;

type LockState = { locks: Lock[] };

export const useLockStore = create<LockState>(() => ({ locks: [] }));

export const fireLock = (rect: LockRect) =>
  useLockStore.setState(s => ({
    locks: [...s.locks, { id: nextId++, rect, startedAt: Date.now() }].slice(-MAX_LOCKS),
  }));

/** Scrolling moves rows out from under the chains, so wind them down fast. */
export const fadeAllLocks = () => {
  const { locks } = useLockStore.getState();
  if (!locks.length) return;
  const now = Date.now();
  useLockStore.setState({ locks: locks.map(l => (l.killedAt ? l : { ...l, killedAt: now })) });
};

export const clearLocks = () => {
  if (useLockStore.getState().locks.length) useLockStore.setState({ locks: [] });
};
