import { callGemini } from '@/lib/gemini';
import { restRange } from '@/lib/rest';
import { num, rpeGate } from '@/lib/rpe-gate';
import type { RpeContext } from '@/lib/rpe-gate';

export type RpeNudge = { suggestedRpe: string; reason: string };
export { rpeGate };

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
