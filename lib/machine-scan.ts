import type { HistoryEntry } from '../types';
import { callGeminiResult } from '@/lib/gemini';
import type { GeminiFailure, GeminiImage } from '@/lib/gemini';
import { candidatesFor, firstSet, validateScan } from '@/lib/machine-plan';
import type { Candidate, FirstSet, ScanResult } from '@/lib/machine-plan';
import { MUSCLE_PROMPT } from '@/lib/muscles';

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    readable: { type: 'BOOLEAN' },
    name: { type: 'STRING' },
    brand: { type: 'STRING' },
    muscles: { type: 'STRING' },
    type: { type: 'STRING', enum: ['Compound', 'Iso'] },
    loading: { type: 'STRING', enum: ['plate-loaded', 'pin-stack', 'cable', 'dumbbell', 'barbell', 'bodyweight', 'other'] },
    unit: { type: 'STRING', enum: ['kg', 'lb', 'unknown'] },
    loggedAs: { type: 'STRING', enum: ['per hand', 'per side', 'total'] },
    maxStack: { type: 'NUMBER', nullable: true },
    plateText: { type: 'STRING' },
    confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
    analog: {
      type: 'OBJECT',
      nullable: true,
      properties: { exercise: { type: 'STRING' }, ratio: { type: 'NUMBER' }, why: { type: 'STRING' } },
      required: ['exercise', 'ratio', 'why'],
    },
  },
  required: ['readable', 'name', 'brand', 'muscles', 'type', 'loading', 'unit', 'loggedAs', 'plateText', 'confidence'],
};

export const scanPrompt = (typedName: string, candidates: Candidate[]) => [
  'You are helping a lifter add a gym machine to their workout tracker.',
  typedName ? `They typed this name for it: "${typedName}". Trust it over a blurry photo.` : '',
  'Read the machine from the photo(s) and any name plate or sticker. Reply as JSON.',
  '"readable": false if you cannot tell what machine it is. "name": the standard exercise name in Title Case, brand kept if printed (e.g. "Hammer Strength Chest Press"). "muscles": comma-separated, primary first. ' + MUSCLE_PROMPT + ' "type": Compound or Iso.',
  '"loggedAs": the number the lifter writes down for a set: "per hand" for dumbbells, "per side" for plate-loaded machines where each side is loaded separately (iso-lateral), otherwise "total" (stack setting or total bar and plate load).',
  '"loading": how it is loaded. "unit" and "maxStack": the unit printed on the plates or stack and the heaviest setting you can see (null if none). "plateText": the printed text you read, verbatim, or empty. "confidence": how sure you are of the identification.',
  candidates.length
    ? `CANDIDATES are exercises this lifter has really done, each with an estimated 1RM in kg:\n${JSON.stringify(candidates.map(c => ({ name: c.name, muscles: c.muscles, type: c.type, e1rm: c.e1rm })))}\nDumbbell candidates are logged per hand; machine candidates as the lifter logged them. Choose the ONE candidate most mechanically similar to this machine (exact name) for "analog". "ratio" = the estimated 1RM on the new machine, in the number the lifter would log there (see loggedAs), divided by the candidate's 1RM. Be honest about differences: free weight to machine, per-side plate loading, lever or pulley ratios, a different range of motion. Lean low rather than high. Use null for analog if nothing is similar.`
    : 'The lifter has no history to compare with, so use null for "analog".',
].filter(Boolean).join('\n');

export type ScanOutcome =
  | { ok: true; scan: ScanResult; candidates: Candidate[]; suggestion: FirstSet | null }
  | { ok: false; failure: GeminiFailure | 'unreadable' };

/** Identifies a machine from photo(s) and/or a typed name, and proposes a first-set weight from related exercises. */
export async function readMachine(a: { images: GeminiImage[]; typedName: string; history: HistoryEntry[]; gym?: string; bias?: number }): Promise<ScanOutcome> {
  const candidates = candidatesFor(a.history, a.gym, a.bias ?? 0);
  const r = await callGeminiResult<unknown>(scanPrompt(a.typedName.trim(), candidates), SCHEMA, { images: a.images, timeoutMs: 20000, temperature: 0.2 });
  if (!r.ok) return { ok: false, failure: r.failure };
  const scan = validateScan(r.data, candidates);
  if (!scan || !scan.readable) return { ok: false, failure: 'unreadable' };
  return { ok: true, scan, candidates, suggestion: firstSet(scan, candidates) };
}
