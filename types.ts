// ─── Shared types ─────────────────────────────────────────────────────────────

export type Drop = { weight: string; reps: string };

export type WorkoutSet = {
  weight: string;
  reps: string;
  rpe?: string;
  drops: Drop[];
  /** Ticked off during the session. Older history entries don't have it and count as done. */
  done?: boolean;
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

export type HistoryEntry = {
  id: string;
  date: string;
  workoutName: string;
  duration: number;
  restTime: number;
  exercises: Exercise[];
  isRestDay?: boolean;
  gym?: string;
};

export type UnlockedBadge = {
  id: string;
  unlockedAt: string; // date string, e.g. "Mon, 27 Apr 2026"
};
