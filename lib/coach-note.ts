import type { Exercise, HistoryEntry, CoachNote } from '../types';
import { SPLIT } from '../constants/programs';
import { BASE_SYSTEM } from '@/lib/brief';
import { buildBriefInput, fmtSet } from '@/lib/brief-data';
import { deloadHint } from '@/lib/deload';
import { callGemini } from '@/lib/gemini';
import { loggedSets, previousSessions } from '@/lib/prev-sessions';
import { restRange } from '@/lib/rest';
import { rpe8Guide } from '@/lib/rpe-load';

const TIMEOUT_MS = 25000;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { heading: { type: 'STRING' }, lines: { type: 'ARRAY', items: { type: 'STRING' } } },
        required: ['heading', 'lines'],
      },
    },
  },
  required: ['sections'],
};

const RPE8 = 'Some exercises carry "rpe8Load", the weight estimated to land at RPE 8 for the top of the rep range from like-for-like sessions. Anchor targets to it, never more than one increment above the last top weight.';

const WEEK_SYSTEM = (next: number) => `${BASE_SYSTEM}# Output (weekly review)
Reply as JSON { "sections": [{ "heading": string, "lines": string[] }] } with exactly these three sections, every line short and numbers-first:
1. "PERFORMANCE SUMMARY": up to 5 lines on what progressed, stalled or flagged across the week. Judge each lift only against its own basis.
2. "PROGRAMME ADJUSTMENTS": at least one line, each written as "CHANGE: ... | REASON: ... | FROM: next session or next week". You propose, the athlete approves. Cite the mechanism for any substitution or structural change. Weigh hard sets per muscle against the priority order.
3. "WEEK ${next} FOCUS": one line, one clear priority.
${RPE8}`;

const UPCOMING_SYSTEM = `${BASE_SYSTEM}# Output (upcoming session)
Reply as JSON { "sections": [{ "heading": string, "lines": string[] }] } with exactly these three sections, every line short and numbers-first:
1. "TARGETS": one line per exercise: "Name: weight kg × reps × sets, RPE cap". Weight follows the progression logic and rpe8Load; use the target in DATA when there is no history to judge from.
2. "FLAGS": at least one line, each written as "FLAG: ... | REASON: ... | RECOMMENDATION: ...". Include rest, session position and anything stale for three or more sessions.
3. "FOCUS": one line, the single thing that matters most this session.
${RPE8}`;

type Plan = Omit<Exercise, 'sets'>;

export type NoteContext = object;

/** Everything the coach may see for a week review: each finished session built like a session brief, judged against what came before it. */
export function weekContext(a: { entries: HistoryEntry[]; history: HistoryEntry[]; epoch: number; programWeek: number; rpeBias?: { bias: number; samples: number } | null }): NoteContext {
  const sessions = a.entries
    .filter(e => !e.isRestDay && e.exercises.some(ex => loggedSets(ex).length))
    .sort((x, y) => (x.date < y.date ? -1 : 1))
    .map(e => buildBriefInput({
      workout: e.workoutName, date: e.date, gym: e.gym, exercises: e.exercises, history: a.history,
      epoch: a.epoch, programWeek: a.programWeek, liftingSecs: e.duration, restSecs: e.restTime, feel: e.feel, rpeBias: a.rpeBias,
    }));
  const last = sessions[sessions.length - 1];
  return {
    programWeek: a.programWeek,
    sessions: sessions.map(s => ({ session: s.session, exercises: s.exercises })),
    ...(last ? { hardSetsByMuscle: last.thisWeek.hardSetsByMuscle } : {}),
    ...(last?.deloadHint ? { deloadHint: last.deloadHint } : {}),
    ...(last?.rpeCalibration ? { rpeCalibration: last.rpeCalibration } : {}),
  };
}

/** What the coach may see before a planned session: the plan, how each lift went last time on the same footing, and the RPE 8 load. */
export function upcomingContext(a: { day: number; plan: Plan[]; history: HistoryEntry[]; gym?: string; epoch: number; programWeek: number; rpeBias?: { bias: number; samples: number } | null }): NoteContext {
  const workout = SPLIT[a.day];
  const exercises = a.plan.map(ex => {
    const { basis, rows } = previousSessions(ex.name, workout, a.history, a.gym);
    const guide = rpe8Guide(ex, workout, a.history, a.gym, a.rpeBias?.bias ?? 0);
    return {
      name: ex.name, muscles: ex.muscles, type: ex.type, target: ex.target,
      restTargetSec: [restRange({ ...ex, sets: [] })[0], restRange({ ...ex, sets: [] })[2]],
      basis,
      previous: rows.slice(0, 2).map(r => ({ date: r.h.date, gym: r.h.gym, sets: loggedSets(r.ex).map(fmtSet) })),
      ...(guide ? { rpe8Load: guide } : {}),
    };
  });
  const lastBrief = a.history.filter(h => h.workoutName === workout && h.brief).sort((x, y) => (x.date < y.date ? 1 : -1))[0];
  const hint = deloadHint(a.history, a.epoch, a.programWeek);
  return {
    workout, ...(a.gym ? { gym: a.gym } : {}), programWeek: a.programWeek, exercises,
    ...(hint ? { deloadHint: hint } : {}),
    ...(lastBrief?.brief ? { lastBrief: { date: lastBrief.date, targets: lastBrief.brief.targets, flags: lastBrief.brief.flags.map(f => f.flag) } } : {}),
  };
}

function parseNote(raw: unknown): CoachNote | null {
  const sections = ((raw as any)?.sections ?? [])
    .filter((s: any) => s && typeof s.heading === 'string' && Array.isArray(s.lines))
    .map((s: any) => ({ heading: s.heading.trim(), lines: s.lines.filter((l: unknown) => typeof l === 'string' && l.trim()).map((l: string) => l.trim()).slice(0, 8) }))
    .filter((s: any) => s.heading && s.lines.length);
  return sections.length ? { generatedAt: Date.now(), sections } : null;
}

export async function generateWeekReview(ctx: NoteContext, programWeek: number): Promise<CoachNote | null> {
  if (!((ctx as any).sessions?.length)) return null;
  return parseNote(await callGemini<unknown>(`DATA\n${JSON.stringify(ctx)}`, SCHEMA, { temperature: 0.3, timeoutMs: TIMEOUT_MS, system: WEEK_SYSTEM(programWeek + 1) }));
}

export async function generateUpcoming(ctx: NoteContext): Promise<CoachNote | null> {
  if (!((ctx as any).exercises?.length)) return null;
  return parseNote(await callGemini<unknown>(`DATA\n${JSON.stringify(ctx)}`, SCHEMA, { temperature: 0.3, timeoutMs: TIMEOUT_MS, system: UPCOMING_SYSTEM }));
}
