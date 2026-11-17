/** The muscle names the rest of the app understands (rest periods, weekly volume, the swap pool). Lowercase. */
export const MUSCLES = [
  'upper chest', 'mid chest', 'lower chest', 'lats', 'mid back', 'upper back', 'rear delt', 'lateral delt', 'anterior delt',
  'biceps', 'biceps long head', 'biceps short head', 'brachialis', 'triceps', 'abs', 'obliques', 'quads', 'hamstrings', 'glutes', 'calves',
];

// What a model tends to say instead, mapped to the app's own names.
const ALIASES: Record<string, string> = {
  chest: 'mid chest', pecs: 'mid chest', pectorals: 'mid chest', 'pectoralis major': 'mid chest', 'pectoralis minor': 'mid chest',
  'clavicular pectoralis': 'upper chest', 'sternal pectoralis': 'mid chest', 'upper pectoralis': 'upper chest', 'lower pectoralis': 'lower chest',
  'anterior deltoid': 'anterior delt', 'front delt': 'anterior delt', 'front delts': 'anterior delt', shoulders: 'anterior delt', deltoids: 'lateral delt',
  'lateral deltoid': 'lateral delt', 'side delt': 'lateral delt', 'side delts': 'lateral delt', 'middle deltoid': 'lateral delt',
  'posterior deltoid': 'rear delt', 'rear deltoid': 'rear delt', 'rear delts': 'rear delt',
  latissimus: 'lats', 'latissimus dorsi': 'lats', back: 'lats', rhomboids: 'mid back', 'middle back': 'mid back', 'mid-back': 'mid back',
  trapezius: 'upper back', traps: 'upper back', 'upper traps': 'upper back', 'lower traps': 'mid back',
  tricep: 'triceps', 'triceps brachii': 'triceps', bicep: 'biceps', 'biceps brachii': 'biceps',
  quadriceps: 'quads', quad: 'quads', hamstring: 'hamstrings', 'biceps femoris': 'hamstrings',
  glute: 'glutes', 'gluteus maximus': 'glutes', 'glute maximus': 'glutes', 'gluteus medius': 'glutes',
  calf: 'calves', gastrocnemius: 'calves', soleus: 'calves', abdominals: 'abs', 'rectus abdominis': 'abs', core: 'abs', 'obliques ': 'obliques',
};

/** Comma-separated muscles in the app's own vocabulary, primary first. Unknown names are dropped unless nothing is known. */
export function normalizeMuscles(raw: string): string {
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const t = part.trim().toLowerCase();
    const name = MUSCLES.includes(t) ? t : ALIASES[t];
    if (name && !out.includes(name)) out.push(name);
  }
  return out.length ? out.join(', ') : raw.trim().toLowerCase();
}

/** Prompt wording that keeps a model to the app's vocabulary. */
export const MUSCLE_PROMPT = `Use only these muscle names, primary first: ${MUSCLES.join(', ')}.`;
