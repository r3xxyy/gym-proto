/** Assumed lifting time of a set with no measured start: about 4 s a rep plus setup. */
export const estimateSetSecs = (reps: number) => Math.round(Math.max(1, reps) * 4 + 10);

/**
 * Timing for a set that was just ticked at `now`, or null for the session's first set.
 * `setSecs` is only set when a rest ended between the previous tick and this one and the gap since then
 * is plausible for a set; `restSecs` is the tick-to-tick gap minus the set itself (measured, else estimated).
 */
export function computeTick(now: number, prevTickAt: number | null, restEndedAt: number | null, reps: number): { restSecs: number; setSecs?: number } | null {
  if (prevTickAt === null) return null;
  const gap = Math.max(0, Math.round((now - prevTickAt) / 1000));
  const measured = restEndedAt !== null && restEndedAt > prevTickAt ? Math.round((now - restEndedAt) / 1000) : undefined;
  const setSecs = measured !== undefined && measured >= 3 && measured <= 300 ? measured : undefined;
  return { restSecs: Math.max(0, gap - (setSecs ?? estimateSetSecs(reps))), ...(setSecs !== undefined ? { setSecs } : {}) };
}
