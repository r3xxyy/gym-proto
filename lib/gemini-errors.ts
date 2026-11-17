/** What a 429 from Gemini means: an allowance that is used up, or just a burst of traffic, and how long to wait. */
export function classify429(body: any): { kind: 'quota' | 'busy'; retryMs: number } {
  const err = body?.error ?? {};
  const text = `${err.status ?? ''} ${err.message ?? ''}`.toLowerCase();
  const info = Array.isArray(err.details) ? err.details.find((d: any) => typeof d?.retryDelay === 'string') : undefined;
  const secs = info ? parseFloat(info.retryDelay) : NaN;
  const retryMs = Number.isFinite(secs) ? Math.min(24 * 3600, Math.max(5, secs)) * 1000 : 60 * 1000;
  const quota = /resource_exhausted|quota|exceeded your current/.test(text);
  return { kind: quota ? 'quota' : 'busy', retryMs };
}
