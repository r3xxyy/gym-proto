import type { HistoryEntry } from '../types';
import { parseDateLocal } from './format';
import { FREE_WEIGHT_EXERCISES } from './history-lookup';
import { increment } from './progression';
import { normalizeMuscles } from './muscles';
import { loggedSets } from './prev-sessions';
import { e1RMAtRpe, loadAtRpe8 } from './rpe-load';

const KG_PER_LB = 0.45359237;
const MAX_CANDIDATES = 40;
/** A first guess on an unfamiliar machine should land under RPE 8, so back off from the estimate. */
const FIRST_SET_FACTOR = 0.85;
const RATIO_MIN = 0.3;
const RATIO_MAX = 1.3;

export type Candidate = { name: string; muscles: string; type: 'Compound' | 'Iso'; gym?: string; e1rm: number; basedOn: string };

const num = (v: string | undefined) => parseFloat(v ?? '');

/**
 * Exercises the lifter has really done that a new machine could be compared with: same gym (any gym for
 * free weights), newest first, each with its best RPE-aware estimated 1RM over its last two sessions.
 * A set with no RPE counts as RPE 8, which is how the lifter says they tune their sessions.
 */
export function candidatesFor(history: HistoryEntry[], gym: string | undefined, bias = 0): Candidate[] {
  const byName = new Map<string, { entry: HistoryEntry; ex: HistoryEntry['exercises'][number] }[]>();
  const sorted = [...history].filter(h => !h.isRestDay).sort((a, b) => parseDateLocal(b.date) - parseDateLocal(a.date));
  for (const h of sorted) {
    for (const ex of h.exercises) {
      if (!loggedSets(ex).length) continue;
      const free = FREE_WEIGHT_EXERCISES.has(ex.name);
      if (!free && gym && h.gym !== gym) continue;
      const list = byName.get(ex.name) ?? [];
      if (list.length < 2) { list.push({ entry: h, ex }); byName.set(ex.name, list); }
    }
  }
  const out: Candidate[] = [];
  for (const [name, rows] of byName) {
    const best = Math.max(0, ...rows.flatMap(r => loggedSets(r.ex).map(s => {
      const rpe = num(s.rpe);
      return isNaN(rpe) ? e1RMAtRpe(num(s.weight), num(s.reps), 8, bias) : e1RMAtRpe(num(s.weight), num(s.reps), rpe, bias);
    })));
    if (best <= 0) continue;
    const first = rows[0];
    const top = loggedSets(first.ex).reduce((a, s) => (num(s.weight) > num(a.weight) ? s : a));
    out.push({
      name, muscles: first.ex.muscles, type: first.ex.type, gym: first.entry.gym, e1rm: Math.round(best * 2) / 2,
      basedOn: `${top.weight}kg x ${top.reps}${top.rpe ? ` @RPE ${top.rpe}` : ''} on ${first.entry.date}`,
    });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

export type ScanResult = {
  readable: boolean;
  name: string;
  brand: string;
  muscles: string;
  type: 'Compound' | 'Iso';
  loading: 'plate-loaded' | 'pin-stack' | 'cable' | 'dumbbell' | 'barbell' | 'bodyweight' | 'other';
  unit: 'kg' | 'lb' | 'unknown';
  /** What number the lifter logs on this machine, so a suggested weight is never ambiguous. */
  loggedAs: 'per hand' | 'per side' | 'total';
  /** Heaviest setting printed on the machine, converted to kg; null when none was visible. */
  maxStackKg: number | null;
  plateText: string;
  confidence: 'low' | 'medium' | 'high';
  analog: { exercise: string; ratio: number; why: string } | null;
};

const LOADINGS = ['plate-loaded', 'pin-stack', 'cable', 'dumbbell', 'barbell', 'bodyweight', 'other'];

/** Narrows whatever the model said to a ScanResult. The analog must be a real candidate and its ratio is clamped. */
export function validateScan(raw: any, candidates: Candidate[]): ScanResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const unit = raw.unit === 'kg' || raw.unit === 'lb' ? raw.unit : 'unknown';
  const stack = Number(raw.maxStack);
  const maxStackKg = Number.isFinite(stack) && stack > 0 ? Math.round(unit === 'lb' ? stack * KG_PER_LB : stack) : null;
  const found = typeof raw.analog?.exercise === 'string' ? candidates.find(c => c.name === raw.analog.exercise) : undefined;
  const ratio = Number(raw.analog?.ratio);
  return {
    readable: raw.readable !== false && !!name,
    name,
    brand: typeof raw.brand === 'string' ? raw.brand.trim() : '',
    muscles: typeof raw.muscles === 'string' ? normalizeMuscles(raw.muscles) : '',
    type: raw.type === 'Compound' ? 'Compound' : 'Iso',
    loading: LOADINGS.includes(raw.loading) ? raw.loading : 'other',
    unit,
    loggedAs: raw.loggedAs === 'per hand' || raw.loggedAs === 'per side' ? raw.loggedAs : 'total',
    maxStackKg,
    plateText: typeof raw.plateText === 'string' ? raw.plateText.trim() : '',
    confidence: raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low',
    analog: found && Number.isFinite(ratio)
      ? { exercise: found.name, ratio: Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio)), why: typeof raw.analog.why === 'string' ? raw.analog.why.trim() : '' }
      : null,
  };
}

export type FirstSet = { kg: number; low: number; high: number; reps: number; basedOn: string; ratio: number; analog: string };

/**
 * The weight to start on a machine the lifter has not used: the related exercise's estimated 1RM scaled by
 * the model's ratio, converted to the load that should feel like RPE 8 for `reps`, then backed off because the
 * first set is a guess. Clamped to the machine's top setting. Null with no related exercise to go from.
 */
export function firstSet(scan: ScanResult, candidates: Candidate[], reps = 10): FirstSet | null {
  const analog = scan.analog && candidates.find(c => c.name === scan.analog!.exercise);
  if (!scan.analog || !analog) return null;
  const rpe8 = loadAtRpe8(analog.e1rm * scan.analog.ratio, reps, scan.type);
  if (!(rpe8 > 0)) return null;
  const step = increment(rpe8, scan.type);
  const snap = (w: number) => Math.max(step, Math.round(w / step) * step);
  const cap = scan.maxStackKg ?? Infinity;
  const kg = Math.min(cap, snap(rpe8 * FIRST_SET_FACTOR));
  return {
    kg,
    low: Math.min(cap, snap(kg * 0.85)),
    high: Math.min(cap, snap(kg * 1.15)),
    reps,
    ratio: scan.analog.ratio,
    analog: analog.name,
    basedOn: analog.basedOn,
  };
}

/** The plan target string the rest of the app reads, e.g. "60 kg × 8–10 × 3". */
export const targetFor = (kg: number) => `${Math.round(kg * 100) / 100} kg × 8–10 × 3`;
