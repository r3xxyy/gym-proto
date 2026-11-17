/** One RPE nudge and what the lifter did with it. */
export type NudgeOutcome = {
  at: number;
  exercise: string;
  loggedRpe: number;
  suggestedRpe: number;
  outcome: 'accepted' | 'dismissed';
};

const MIN_ACCEPTED = 4;

/**
 * How far the lifter's own RPE sits from the coach's, in RPE points, from nudges they accepted:
 * negative means they rate sets harder than the numbers support. Dismissals say nothing about the
 * direction. Null until there are enough accepted nudges, clamped to ±1 and rounded to half steps.
 */
export function rpeBias(nudges: NudgeOutcome[]): { bias: number; samples: number } | null {
  const accepted = nudges.filter(n => n.outcome === 'accepted');
  if (accepted.length < MIN_ACCEPTED) return null;
  const mean = accepted.reduce((t, n) => t + (n.suggestedRpe - n.loggedRpe), 0) / accepted.length;
  const bias = Math.max(-1, Math.min(1, Math.round(mean * 2) / 2));
  return { bias, samples: accepted.length };
}
