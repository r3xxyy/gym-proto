// Tried in order. Model names get retired and busy ones answer 503, so a miss moves on to the next.
const MODELS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
const TIMEOUT_MS = 8000;

/**
 * One JSON-mode Gemini call. Resolves to the parsed reply, or null on any failure (no key, offline,
 * timeout, HTTP error, unparseable reply), so callers always have a fallback path.
 */
export async function callGemini<T>(
  prompt: string,
  schema: object,
  { temperature = 0.2, timeoutMs = TIMEOUT_MS, system }: { temperature?: number; timeoutMs?: number; system?: string } = {},
): Promise<T | null> {
  const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!key) return null;

  for (const model of MODELS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
        }),
      });
      // Retired (404), busy (503) or rate-limited (429): try the next model. Anything else won't change.
      if (res.status === 404 || res.status === 503 || res.status === 429) continue;
      if (!res.ok) return null;
      const body = await res.json();
      return JSON.parse(body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '') as T;
    } catch {
      // Timeout or network error: the next model may answer.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
