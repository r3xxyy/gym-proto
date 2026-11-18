// ─── Shared types ─────────────────────────────────────────────────────────────

export type Drop = { weight: string; reps: string };

export type WorkoutSet = {
  weight: string;
  reps: string;
  rpe?: string;
  drops: Drop[];
  /** Ticked off during the session. Older history entries don't have it and count as done. */
  done?: boolean;
  /** When it was ticked (ms); the seconds of rest before it; and, only when the rest timer marked the start, how long the set itself took. Absent on a session's first set and on older entries. */
  doneAt?: number;
  restBefore?: number;
  setSecs?: number;
};

export type Exercise = {
  id: string;
  name: string;
  muscles: string;
  type: 'Compound' | 'Iso';
  target: string;
  cue: string;
  sets: WorkoutSet[];
  notes?: string;
  startedAt?: number;
  endedAt?: number;
};

/** The in-app coach's read of a finished session; kept on the history entry so the next brief can refer back to it. */
export type SessionBrief = {
  generatedAt: number;
  /** One or two friendly sentences on what the lifter seemed to be going for. */
  read?: string;
  performance: { strong: string[]; flagged: string[] };
  targets: { exercise: string; weightKg: number | null; sets: number; reps: string; rpeCap: number | null; note: string }[];
  flags: { flag: string; reason: string; recommendation: string }[];
};

/** A coach read that is not tied to one finished session: a week review or an upcoming-session plan. */
export type CoachNote = { generatedAt: number; sections: { heading: string; lines: string[] }[] };

export type ChatMessage = { role: 'athlete' | 'coach'; text: string; /** Lasting facts the coach saved from this reply. */ noted?: string[] };

export type HistoryEntry = {
  id: string;
  date: string;
  workoutName: string;
  duration: number;
  restTime: number;
  exercises: Exercise[];
  isRestDay?: boolean;
  gym?: string;
  brief?: SessionBrief;
  /** How the session felt, 1 (rough) to 5 (great), tapped on the summary screen. */
  feel?: number;
  /** Follow-up questions about the brief and the coach's answers. */
  chat?: ChatMessage[];
  /** Why the lifter trained the way they did today, in their own words. */
  athleteNote?: string;
};

export type UnlockedBadge = {
  id: string;
  unlockedAt: string; // date string, e.g. "Mon, 27 Apr 2026"
};
