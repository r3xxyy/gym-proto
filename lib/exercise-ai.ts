import { callGemini } from '@/lib/gemini';
import { MUSCLE_PROMPT, normalizeMuscles } from '@/lib/muscles';
import type { Exercise } from '@/types';

type Resolved = Omit<Exercise, 'sets'>;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    muscles: { type: 'STRING' },
    type: { type: 'STRING', enum: ['Compound', 'Iso'] },
    machine: { type: 'STRING' },
  },
  required: ['name', 'muscles', 'type'],
};

const PROMPT = (typed: string) =>
  `A lifter typed "${typed}" into a gym workout tracker. Work out which exercise they mean. ` +
  'Reply as JSON. "name": the standard exercise name in Title Case, with the equipment kept in it ' +
  '(e.g. "Seated Cable Row", "Hammer Strength Chest Press"). "muscles": comma-separated, primary first. ' + MUSCLE_PROMPT + ' "type": Compound or Iso. "machine": the machine or ' +
  'equipment used, or an empty string for free weights and bodyweight. If it is unclear, keep their wording.';

const plain = (name: string): Resolved => ({
  id: `custom_${Date.now()}`, name, muscles: '', type: 'Iso', target: '', cue: '',
});

/**
 * Turns whatever the lifter typed into a proper exercise: canonical name, muscles, and the machine.
 * Never throws: with no key, no network or a bad reply it returns the typed name as a plain custom exercise.
 */
export async function resolveExercise(typed: string): Promise<Resolved> {
  const out = await callGemini<{ name?: unknown; muscles?: unknown; type?: unknown; machine?: unknown }>(PROMPT(typed), SCHEMA);
  const name = typeof out?.name === 'string' ? out.name.trim() : '';
  if (!out || !name) return plain(typed);
  return {
    ...plain(name),
    muscles: typeof out.muscles === 'string' ? normalizeMuscles(out.muscles) : '',
    type: out.type === 'Compound' ? 'Compound' : 'Iso',
    cue: typeof out.machine === 'string' && out.machine.trim() ? `Machine: ${out.machine.trim()}` : '',
  };
}
