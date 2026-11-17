import { create } from 'zustand';
import { classify429 } from './gemini-errors';
import { FALLBACK_MODELS, pickModels } from './gemini-models';

/** Why a Gemini call produced nothing, in terms the lifter can act on. */
export type GeminiFailure = 'no-key' | 'offline' | 'timeout' | 'busy' | 'quota' | 'retired' | 'rejected' | 'bad-reply';

export const FAILURE_TEXT: Record<GeminiFailure, string> = {
  'no-key': 'this build has no Gemini key',
  offline: 'no connection',
  timeout: 'Gemini took too long',
  busy: 'Gemini is busy, try again in a minute',
  quota: "Gemini's free allowance is used up for now; it refills over time",
  retired: 'no Gemini model answered',
  rejected: 'Gemini rejected the key; paste a new one in Diagnostics',
  'bad-reply': 'Gemini sent something unreadable',
};

type Last = { at: number; ok: boolean; model?: string; failure?: GeminiFailure; http?: number } | null;

/** What the last call did, so the diagnostics screen and error messages can say why. */
export const useGeminiStatus = create<{ last: Last; models: string[]; blockedUntil: number }>(() => ({ last: null, models: [], blockedUntil: 0 }));
const record = (last: NonNullable<Last>) => useGeminiStatus.setState({ last });

export const lastFailureText = () => {
  const l = useGeminiStatus.getState().last;
  return l && !l.ok && l.failure ? FAILURE_TEXT[l.failure] : null;
};

// A key pasted on the phone beats the one baked into the build, so a dead key never needs a republish.
let keyOverride = '';
const currentKey = () => keyOverride || process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
export const hasGeminiKey = () => !!currentKey();
export const usingOverrideKey = () => !!keyOverride;

// After every model says the allowance is gone or the key is refused, further calls fail at once instead of
// waiting on the network, so every feature drops straight to its built-in fallback.
let blocked: { until: number; failure: GeminiFailure } | null = null;

export function setKeyOverride(key: string) {
  keyOverride = key.trim();
  blocked = null;
  discovered = null;
  cooling.clear();
  useGeminiStatus.setState({ blockedUntil: 0, models: [] });
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 8000;
/** If a model has not answered after this long, the next one is started alongside it. */
const HEDGE_MS = 3500;

let discovered: Promise<string[]> | null = null;
// Models that just answered busy or missing go to the back of the queue for a while, so one slow call
// teaches the next ones to skip them.
const cooling = new Map<string, number>();
const isCooling = (m: string) => (cooling.get(m) ?? 0) > Date.now();

function models(key: string): Promise<string[]> {
  if (!discovered) {
    discovered = (async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(`${BASE}/models?pageSize=100`, { headers: { 'x-goog-api-key': key }, signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(String(res.status));
        const list = pickModels((await res.json())?.models ?? []);
        useGeminiStatus.setState({ models: list });
        return list;
      } catch {
        discovered = null; // try discovery again next call
        useGeminiStatus.setState({ models: FALLBACK_MODELS });
        return FALLBACK_MODELS;
      }
    })();
  }
  return discovered;
}

export type GeminiImage = { mime: string; data: string };
export type GeminiOptions = { temperature?: number; timeoutMs?: number; system?: string; images?: GeminiImage[] };
export type GeminiResult<T> = { ok: true; data: T; model: string } | { ok: false; failure: GeminiFailure; http?: number };

/**
 * Set once a model has answered. Slower requests are not cancelled (browsers report a cancelled request as an
 * uncaught error); they finish or time out on their own and their answers are ignored.
 */
type Stop = { aborted: boolean };
const newStop = (): Stop => ({ aborted: false });
const cancelAll = (stop: Stop) => { stop.aborted = true; };

type Attempt =
  | { ok: true; data: unknown; model: string }
  | { ok: false; failure: GeminiFailure; http?: number; retryMs?: number };

/** One request to one model. Never throws; a failure says whether another model is worth trying. */
async function tryModel(model: string, key: string, body: string, timeoutMs: number, stop: Stop): Promise<Attempt> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Marked handled up front: browsers report a cancelled request's rejection as "uncaught" even when it is caught below.
    const request = fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body,
    });
    request.catch(() => {});
    const res = await request;
    if (res.status === 404) { cooling.set(model, Date.now() + 60 * 60 * 1000); return { ok: false, failure: 'retired', http: 404 }; }
    if (res.status === 429) {
      const reading = res.json();
      reading.catch(() => {});
      const c = classify429(await reading.catch(() => null));
      cooling.set(model, Date.now() + c.retryMs);
      return { ok: false, failure: c.kind, http: 429, retryMs: c.retryMs };
    }
    if (res.status === 503) { cooling.set(model, Date.now() + 60 * 1000); return { ok: false, failure: 'busy', http: 503 }; }
    if (!res.ok) return { ok: false, failure: 'rejected', http: res.status };
    try {
      const reading = res.json();
      reading.catch(() => {});
      const json = await reading;
      return { ok: true, data: JSON.parse(json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''), model };
    } catch {
      return { ok: false, failure: 'bad-reply', http: res.status };
    }
  } catch (e: any) {
    if (stop.aborted) return { ok: false, failure: 'timeout' }; // a faster model already won; nobody reads this
    if (e?.name === 'AbortError') { cooling.set(model, Date.now() + 5 * 60 * 1000); return { ok: false, failure: 'timeout' }; }
    return { ok: false, failure: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

// Which failure to report when every model failed: the most actionable first.
const SEVERITY: GeminiFailure[] = ['rejected', 'quota', 'busy', 'timeout', 'offline', 'bad-reply', 'retired', 'no-key'];

/**
 * One JSON-mode Gemini call (images optional) that says why it failed. Models are tried in order, but the
 * next one starts after HEDGE_MS if the current one is still silent, and the first good answer wins, so a
 * model that hangs costs seconds, not a whole timeout.
 */
export async function callGeminiResult<T>(prompt: string, schema: object, opts: GeminiOptions = {}): Promise<GeminiResult<T>> {
  const { temperature = 0.2, timeoutMs = TIMEOUT_MS, system, images = [] } = opts;
  const key = currentKey();
  const fail = (failure: GeminiFailure, http?: number): GeminiResult<T> => { record({ at: Date.now(), ok: false, failure, http }); return { ok: false, failure, http }; };
  if (!key) return fail('no-key');
  if (blocked && blocked.until > Date.now()) return fail(blocked.failure);

  const body = JSON.stringify({
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: [{ parts: [...images.map(i => ({ inlineData: { mimeType: i.mime, data: i.data } })), { text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
  });
  const order = [...(await models(key))].sort((a, b) => Number(isCooling(a)) - Number(isCooling(b)));
  const stop = newStop();
  const failures: Extract<Attempt, { ok: false }>[] = [];
  const pending = new Set<Promise<{ r: Attempt; self: Promise<unknown> }>>();
  let next = 0;
  const launch = () => {
    const p: Promise<{ r: Attempt; self: Promise<unknown> }> = tryModel(order[next++], key, body, timeoutMs, stop)
      .catch((): Attempt => ({ ok: false, failure: 'offline' }))
      .then(r => ({ r, self: p }));
    pending.add(p);
  };

  launch();
  while (pending.size) {
    let hedge: ReturnType<typeof setTimeout> | undefined;
    const waits: Promise<{ r: Attempt; self: Promise<unknown> } | 'hedge'>[] = [...pending];
    if (next < order.length) waits.push(new Promise<'hedge'>(res => { hedge = setTimeout(() => res('hedge'), HEDGE_MS); }));
    const winner = await Promise.race(waits);
    clearTimeout(hedge);
    if (winner === 'hedge') { launch(); continue; }
    pending.delete(winner.self as never);
    if (winner.r.ok) {
      cancelAll(stop);
      cooling.delete(winner.r.model);
      blocked = null;
      useGeminiStatus.setState({ blockedUntil: 0 });
      record({ at: Date.now(), ok: true, model: winner.r.model });
      return { ok: true, data: winner.r.data as T, model: winner.r.model };
    }
    failures.push(winner.r);
    if (next < order.length) launch(); // this model is out; the next one steps in at once
  }
  const worst = failures.sort((a, b) => SEVERITY.indexOf(a.failure) - SEVERITY.indexOf(b.failure))[0];
  // Every model out of allowance, or the key refused: stop trying for a while.
  if (failures.length && failures.every(f => f.failure === 'quota')) {
    const wait = Math.min(...failures.map(f => f.retryMs ?? 60000), 30 * 60 * 1000);
    blocked = { until: Date.now() + Math.max(wait, 60000), failure: 'quota' };
  } else if (worst?.failure === 'rejected' && failures.every(f => f.failure === 'rejected' || f.failure === 'retired')) {
    blocked = { until: Date.now() + 10 * 60 * 1000, failure: 'rejected' };
  }
  if (blocked) useGeminiStatus.setState({ blockedUntil: blocked.until });
  return fail(worst?.failure ?? 'retired', worst?.http);
}

/** Same call, for features that only need the data and fall back on null. The reason is kept in `useGeminiStatus`. */
export async function callGemini<T>(prompt: string, schema: object, opts: GeminiOptions = {}): Promise<T | null> {
  const r = await callGeminiResult<T>(prompt, schema, opts);
  return r.ok ? r.data : null;
}
