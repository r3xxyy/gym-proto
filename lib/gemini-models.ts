// Used when discovery fails. Names get retired, so discovery is the normal path.
export const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
const SKIP = /image|tts|live|audio|omni|embedding|robotics|computer|thinking|exp/i;

/** Ordered candidates: the newest plain text flash models this key can use, then the fallbacks. */
export function pickModels(listing: { name?: string; supportedGenerationMethods?: string[] }[]): string[] {
  const version = (n: string) => {
    const m = n.match(/gemini-(\d+)(?:\.(\d+))?/);
    return m ? parseInt(m[1], 10) * 100 + parseInt(m[2] ?? '0', 10) : 0;
  };
  const found = listing
    .filter(m => m.name && /flash/i.test(m.name) && !SKIP.test(m.name) && m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name!.replace(/^models\//, ''))
    // Plain "flash" before "flash-lite", newest version first; the -latest alias is already newest.
    .sort((a, b) => Number(/lite/.test(a)) - Number(/lite/.test(b)) || version(b) - version(a));
  return [...new Set([...found.slice(0, 3), ...FALLBACK_MODELS])];
}

