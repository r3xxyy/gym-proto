import type { Exercise, HistoryEntry, SessionBrief } from '../types';
import { deloadHint } from './deload';
import { formatTime, parseDateLocal } from './format';
import { parseRepRange } from './progression';
import { loggedSets, previousSessions, topWeight } from './prev-sessions';
import type { Basis } from './prev-sessions';
import { restRange } from './rest';
import { e1RMAtRpe, rpe8Guide } from './rpe-load';
import type { Rpe8Guide } from './rpe-load';
import { sessionVolume } from './session-stats';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export type BriefExercise = {
  name: string;
  muscles: string;
  type: Exercise['type'];
  position: string;
  target: string;
  sets: string[];
  restTargetSec: [number, number];
  basis: Basis;
  previous: { date: string; gym?: string; sets: string[] }[];
  /** Consecutive recent sessions (today included) with the same top weight on a like-for-like basis. */
  sessionsAtSameTopWeight: number;
  ruleCall: 'up' | 'hold' | 'hold or reduce' | 'no load rule';
  ruleWhy: string;
  /** Load estimated to land at RPE 8 for the top of the rep range, from like-for-like sessions; absent without them. */
  rpe8Load?: Rpe8Guide;
  /** Best RPE-aware 1RM today, for context. */
  e1rmToday?: number;
  notes?: string;
};

export type BriefInput = {
  session: {
    workout: string;
    date: string;
    gym?: string;
    programWeek: number;
    liftingTime: string;
    restTime: string;
    volumeKg: number;
    bodyweightKg?: number;
    feel?: string;
  };
  /** The lifter's own RPE tendency from accepted nudges: negative means they rate sets harder than the numbers support. */
  rpeCalibration?: { adjustmentPoints: number; samples: number };
  exercises: BriefExercise[];
  thisWeek: { sessions: { workout: string; date: string; gym?: string }[]; hardSetsByMuscle: Record<string, { thisWeek: number; lastWeek: number }> };
  deloadHint?: string;
  lastBriefForThisWorkout?: { date: string; targets: string[]; flags: string[] };
};

const num = (v: string | undefined) => parseFloat(v ?? '');
const fmtSet = (s: Exercise['sets'][number]) => {
  const drops = s.drops.filter(d => d.weight || d.reps).map(d => `${d.weight}x${d.reps}`).join('/');
  return `${s.weight}kg x ${s.reps}${s.rpe ? ` @RPE${s.rpe}` : ''}${s.restBefore !== undefined ? ` rest ${s.restBefore}s` : ''}${s.setSecs !== undefined ? ` set ${s.setSecs}s` : ''}${drops ? ` +drops ${drops}` : ''}`;
};

/** The coach's progression rule for one exercise, computed here so the model only has to judge exceptions. */
function progressionRule(ex: Exercise): Pick<BriefExercise, 'ruleCall' | 'ruleWhy'> {
  const name = ex.name.toLowerCase();
  if (name.includes('calf')) return { ruleCall: 'no load rule', ruleWhy: 'calf work: progress by reps, tempo and TUT, not load' };
  if (name.includes('curl') && ex.sets.some(s => s.drops.length)) return { ruleCall: 'no load rule', ruleWhy: 'curl strength-then-dropset structure: do not comment on load' };
  const sets = loggedSets(ex);
  if (!sets.length) return { ruleCall: 'no load rule', ruleWhy: 'nothing logged' };

  const top = topWeight(ex);
  const atTop = sets.filter(s => num(s.weight) === top);
  const range = parseRepRange(ex.target);
  const plannedSets = parseInt(ex.target.match(/kg\s*[×xX]\s*[\d–-]+\s*[×xX]\s*(\d+)/)?.[1] ?? '', 10) || atTop.length;
  const missed = atTop.length < plannedSets || (range ? atTop.some(s => num(s.reps) < range.lo) : false);
  const rpes = atTop.map(s => num(s.rpe)).filter(n => !isNaN(n));
  const maxRpe = rpes.length ? Math.max(...rpes) : null;

  if (missed) return { ruleCall: 'hold or reduce', ruleWhy: `not all ${plannedSets} sets reached ${range ? range.lo : 'the'} reps at ${top}kg` };
  if (maxRpe === null) return { ruleCall: 'hold', ruleWhy: 'sets completed but no RPE logged' };
  if (maxRpe > 8) return { ruleCall: 'hold or reduce', ruleWhy: `sets completed at top RPE ${maxRpe}` };
  if (maxRpe <= 7) return { ruleCall: 'up', ruleWhy: `all sets completed, top RPE ${maxRpe}` };
  return { ruleCall: 'hold', ruleWhy: 'all sets completed, top RPE 8' };
}

function hardSetsByMuscle(entries: Pick<Exercise, 'sets' | 'muscles'>[][]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const exs of entries) for (const ex of exs) {
    const muscle = ex.muscles.split(',')[0].trim().toLowerCase();
    if (!muscle) continue;
    out[muscle] = (out[muscle] ?? 0) + loggedSets(ex).length;
  }
  return out;
}

export function buildBriefInput(args: {
  workout: string;
  date: string;
  gym?: string;
  exercises: Exercise[];
  /** Saved sessions only: today's is not in it. */
  history: HistoryEntry[];
  epoch: number;
  programWeek: number;
  liftingSecs: number;
  restSecs: number;
  bodyweight?: string;
  feel?: number;
  /** RPE points to add to logged RPEs, from the coach log. */
  rpeBias?: { bias: number; samples: number } | null;
}): BriefInput {
  const { workout, gym, exercises, epoch, programWeek } = args;
  const bias = args.rpeBias?.bias ?? 0;
  const history = args.history.filter(h => !(h.date === args.date && h.workoutName === workout));
  const ordered = exercises.filter(ex => loggedSets(ex).length > 0);

  const out: BriefExercise[] = ordered.map((ex, i) => {
    const { basis, rows } = previousSessions(ex.name, workout, history, gym);
    const top = topWeight(ex);
    // Run of sessions, newest first, that all used today's top weight.
    let same = 1;
    if (basis !== 'none' && basis !== 'different gym (not like-for-like)') {
      for (const r of rows) { if (topWeight(r.ex) === top) same++; else break; }
    }
    return {
      name: ex.name,
      muscles: ex.muscles,
      type: ex.type,
      position: `${i + 1} of ${ordered.length}`,
      target: ex.target,
      sets: loggedSets(ex).map(fmtSet),
      restTargetSec: [restRange(ex)[0], restRange(ex)[2]],
      basis,
      previous: rows.map(r => ({ date: r.h.date, gym: r.h.gym, sets: loggedSets(r.ex).map(fmtSet) })),
      sessionsAtSameTopWeight: same,
      ...progressionRule(ex),
      ...(() => { const g = rpe8Guide(ex, workout, history, gym, bias); return g ? { rpe8Load: g } : {}; })(),
      ...(() => { const e = Math.max(0, ...loggedSets(ex).map(x => e1RMAtRpe(num(x.weight), num(x.reps), num(x.rpe), bias))); return e > 0 ? { e1rmToday: e } : {}; })(),
      ...(ex.notes?.trim() ? { notes: ex.notes.trim() } : {}),
    };
  });

  // This and last program week, today's session included in the current one.
  const weekOf = (d: string) => Math.floor((parseDateLocal(d) - epoch) / WEEK_MS) + 1;
  const real = history.filter(h => !h.isRestDay);
  const thisWeekSaved = real.filter(h => weekOf(h.date) === programWeek);
  const lastWeekSaved = real.filter(h => weekOf(h.date) === programWeek - 1);
  const now = hardSetsByMuscle([...thisWeekSaved.map(h => h.exercises), ordered]);
  const before = hardSetsByMuscle(lastWeekSaved.map(h => h.exercises));
  const muscles: BriefInput['thisWeek']['hardSetsByMuscle'] = {};
  for (const m of new Set([...Object.keys(now), ...Object.keys(before)])) muscles[m] = { thisWeek: now[m] ?? 0, lastWeek: before[m] ?? 0 };

  const prevBrief = real
    .filter(h => h.workoutName === workout && h.brief)
    .sort((a, b) => parseDateLocal(b.date) - parseDateLocal(a.date))[0];
  const bodyweightKg = num(args.bodyweight);

  return {
    session: {
      workout,
      date: args.date,
      ...(gym ? { gym } : {}),
      programWeek,
      liftingTime: formatTime(args.liftingSecs),
      restTime: formatTime(args.restSecs),
      volumeKg: sessionVolume(exercises),
      ...(bodyweightKg > 0 ? { bodyweightKg } : {}),
      ...(args.feel ? { feel: `${args.feel} of 5 (1 rough, 5 great)` } : {}),
    },
    ...(args.rpeBias ? { rpeCalibration: { adjustmentPoints: args.rpeBias.bias, samples: args.rpeBias.samples } } : {}),
    exercises: out,
    thisWeek: {
      sessions: [...thisWeekSaved.map(h => ({ workout: h.workoutName, date: h.date, gym: h.gym })), { workout, date: args.date, gym }],
      hardSetsByMuscle: muscles,
    },
    ...(deloadHint(history, epoch, programWeek) ? { deloadHint: deloadHint(history, epoch, programWeek) ?? undefined } : {}),
    ...(prevBrief?.brief ? { lastBriefForThisWorkout: {
      date: prevBrief.date,
      targets: prevBrief.brief.targets.map(t => `${t.exercise}: ${t.weightKg ?? '-'}kg x ${t.sets} x ${t.reps}`),
      flags: prevBrief.brief.flags.map(f => f.flag),
    } } : {}),
  };
}

/** Narrows an unknown model reply to a SessionBrief, dropping anything malformed. Null if nothing usable. */
export function parseBrief(raw: unknown): SessionBrief | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as any;
  const strs = (a: unknown, max: number) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, max) : []);
  const targets = (Array.isArray(r.targets) ? r.targets : [])
    .filter((t: any) => t && typeof t.exercise === 'string' && Number.isFinite(Number(t.sets)))
    .map((t: any) => ({
      exercise: String(t.exercise),
      weightKg: Number.isFinite(Number(t.weightKg)) && t.weightKg !== null ? Number(t.weightKg) : null,
      sets: Math.round(Number(t.sets)),
      reps: String(t.reps ?? ''),
      rpeCap: Number.isFinite(Number(t.rpeCap)) && t.rpeCap !== null ? Number(t.rpeCap) : null,
      note: typeof t.note === 'string' ? t.note.trim() : '',
    }));
  const flags = (Array.isArray(r.flags) ? r.flags : [])
    .filter((f: any) => f && typeof f.flag === 'string' && f.flag.trim())
    .map((f: any) => ({ flag: String(f.flag).trim(), reason: String(f.reason ?? '').trim(), recommendation: String(f.recommendation ?? '').trim() }))
    .slice(0, 3);
  const strong = strs(r.performance?.strong, 4), flagged = strs(r.performance?.flagged, 4);
  if (!strong.length && !flagged.length && !targets.length && !flags.length) return null;
  return { generatedAt: Date.now(), performance: { strong, flagged }, targets, flags };
}
