import { callGemini } from '@/lib/gemini';
import { estimate1RM } from '@/lib/progress';
import { restRange } from '@/lib/rest';
import type { Exercise } from '@/types';

export type PrevSet = { weight: string; reps: string; rpe?: string };

export type RpeContext = {
  exercise: Exercise;
  /** Index of the set that was just rated. */
  si: number;
  /** Same exercise, last session at this venue. */
  prevSets?: PrevSet[];
  /** Best estimated 1RM before today; undefined if the exercise has never been logged. */
  bestE1RM?: number;
};

export type RpeNudge = { suggestedRpe: string; reason: string };

const num = (v: string | undefined) => parseFloat(v ?? '');
const e1 = (s: { weight: string; reps: string }) => estimate1RM(num(s.weight) || 0, parseInt(s.reps) || 0);

/**
 * Cheap local suspicion that a logged RPE doesn't fit its context. Returns what looks off, or null
 * to leave the set alone (the common case, so the network is rarely hit). New exercises only get the
 * checks that don't need history.
 */
export function rpeGate({ exercise, si, prevSets, bestE1RM }: RpeContext): string | null {
  const set = exercise.sets[si];
  const rpe = num(set?.rpe);
  const weight = num(set?.weight);
  if (!set || !set.done || isNaN(rpe) || !(weight > 0) || !(parseInt(set.reps) > 0)) return null;

  const [floor, , ceil] = restRange(exercise);
  const rest = set.restBefore;
  const mine = e1(set);
  const earlier = exercise.sets.slice(0, si).filter(s => s.done && num(s.weight) > 0);

  const prev = (prevSets ?? []).filter(s => num(s.weight) > 0);
  if (prev.length) {
    const prevBestE1 = Math.max(...prev.map(e1));
    const prevBestW = Math.max(...prev.map(s => num(s.weight)));
    // Logged near-max on something no heavier than last time, after a full rest.
    if (rpe >= 9 && weight <= prevBestW && mine <= prevBestE1 && (rest === undefined || rest >= ceil)) {
      return 'rated near max but the load is no higher than last session, after a full rest';
    }
    // Logged easy on a load heavier than one last session was RPE 9+.
    const hardW = Math.max(0, ...prev.filter(s => num(s.rpe) >= 9).map(s => num(s.weight)));
    if (rpe <= 7 && hardW > 0 && weight > hardW) {
      return `rated easy but heavier than the ${hardW} kg that was RPE 9+ last session`;
    }
  }
  if (rpe <= 7 && bestE1RM !== undefined && mine > bestE1RM) {
    return 'rated easy on a new estimated-1RM best';
  }

  // Short rest should make a working set harder, not easier.
  const topW = Math.max(weight, ...earlier.map(s => num(s.weight)));
  if (rpe <= 7 && si >= 1 && rest !== undefined && rest < floor * 0.6 && weight >= topW * 0.85) {
    return `rated easy after only ${rest}s rest at a working weight`;
  }

  // Fatigue accumulates: an equal-or-bigger set rated easier than an earlier one that was near max.
  if (si >= 2 && rpe <= 7 && earlier.some(s => num(s.rpe) >= 9 && e1(s) <= mine)) {
    return 'rated easy though an earlier set at no greater load was near max';
  }
  return null;
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    suggestedRpe: { type: 'STRING', enum: ['6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10'] },
    reason: { type: 'STRING' },
    confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
  },
  required: ['suggestedRpe', 'reason', 'confidence'],
};

const RPE_SCALE = '6 = 4 reps in reserve (very comfortable), 7 = 3 RIR (could do more), 8 = 2 RIR (challenging, controlled), 9 = 1 RIR (one more possible), 10 = 0 RIR (absolute max)';

function describe(s: { weight: string; reps: string; rpe?: string; restBefore?: number }) {
  return `${s.weight}kg x ${s.reps}${s.rpe ? ` @RPE ${s.rpe}` : ''}${s.restBefore !== undefined ? ` (rest before: ${s.restBefore}s)` : ''}`;
}

export function rpePrompt(ctx: RpeContext, suspicion: string): string {
  const { exercise, si, prevSets, bestE1RM } = ctx;
  const [floor, mid, ceil] = restRange(exercise);
  const set = exercise.sets[si];
  return [
    'You are sanity-checking a lifter\'s self-rated RPE during a workout. Be sceptical but fair; only disagree when the data clearly points the other way.',
    `RPE scale: ${RPE_SCALE}.`,
    `Exercise: ${exercise.name} (${exercise.type}, ${exercise.muscles}). Typical rest for this lift: ${floor}-${ceil}s, mid ${mid}s.`,
    `Set just logged (set ${si + 1}): ${describe(set)}.`,
    exercise.sets.slice(0, si).length ? `Earlier sets today: ${exercise.sets.slice(0, si).filter(s => s.done).map(describe).join('; ')}.` : 'This is the first set of the exercise today.',
    prevSets?.length ? `Last session: ${prevSets.map(describe).join('; ')}.` : 'No history for this exercise.',
    bestE1RM !== undefined ? `Best estimated 1RM before today: ${bestE1RM}kg.` : '',
    `A rule flagged this: ${suspicion}.`,
    'Reply as JSON: "suggestedRpe" (your best RPE for the set just logged, in half steps, keep their value if it looks right), "reason" (at most 12 words, an observation or question, no lecturing), "confidence" (low, medium or high).',
  ].filter(Boolean).join('\n');
}

/** Asks Gemini whether the logged RPE looks right. Null when the gate passes, the call fails, or it agrees. */
export async function checkRpe(ctx: RpeContext): Promise<RpeNudge | null> {
  const suspicion = rpeGate(ctx);
  if (!suspicion) return null;
  const logged = num(ctx.exercise.sets[ctx.si].rpe);
  const out = await callGemini<{ suggestedRpe?: string; reason?: string; confidence?: string }>(rpePrompt(ctx, suspicion), SCHEMA);
  const suggested = num(out?.suggestedRpe);
  if (!out || isNaN(suggested) || out.confidence === 'low' || Math.abs(suggested - logged) < 0.5) return null;
  const reason = (out.reason ?? '').trim().split(/\s+/).slice(0, 12).join(' ');
  return { suggestedRpe: String(suggested), reason };
}
