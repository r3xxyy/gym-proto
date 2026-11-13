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

/** An exercise that has just been finished: its card floats to centre, gets chained, then slams back. */
export type Stage = { id: string; name: string; summary: string; from: LockRect };

type LockState = {
  locks: Lock[];
  stage: Stage | null;
  /** Set for one render so the named card can open itself; the card clears it. */
  openRequestId: string | null;
};

export const useLockStore = create<LockState>(() => ({ locks: [], stage: null, openRequestId: null }));

export const startStage = (stage: Stage) => {
  if (!useLockStore.getState().stage) useLockStore.setState({ stage });
};
export const endStage = () => {
  if (useLockStore.getState().stage) useLockStore.setState({ stage: null });
};
export const requestOpen = (id: string) => useLockStore.setState({ openRequestId: id });
export const consumeOpenRequest = () => useLockStore.setState({ openRequestId: null });

// Cards register their root view so the screen can measure any of them (e.g. to scroll one into view).
const cards = new Map<string, { current: any }>();
export const registerCard = (id: string, ref: { current: any }) => { cards.set(id, ref); };
export const unregisterCard = (id: string) => { cards.delete(id); };
export const getCard = (id: string) => cards.get(id)?.current ?? null;

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
