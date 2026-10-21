import type { Exercise, HistoryEntry } from '../types';
import { PROGRAM_EPOCH, SPLIT, WEEK_DAYS, WORKOUT_TO_DAY } from '../constants/programs';
import { formatTime, parseHistoryDate } from './format';
import { getMostRecentSession } from './history-lookup';
import { estimateNetKcal, sessionVolume } from './session-stats';

export function formatSessionForCoach(
  workoutName: string,
  date: string,
  duration: number,
  restTime: number,
  exs: Exercise[],
  bodyweight?: string,
  history?: HistoryEntry[],
  gym?: string,
  epoch = PROGRAM_EPOCH,
): string {
  const totalVolume = sessionVolume(exs);

  const lines: string[] = [`WORKOUT: ${workoutName}`, `DATE: ${date}`];
  if (gym) lines.push(`VENUE: ${gym}`);
  lines.push(
    `SESSION: ${formatTime(duration + restTime)}  |  ACTIVE: ${formatTime(duration)}  |  REST: ${formatTime(restTime)}`,
    `TOTAL VOLUME: ${totalVolume.toLocaleString()} kg`,
  );

  if (bodyweight && duration) {
    const bw = parseFloat(bodyweight);
    if (!isNaN(bw)) {
      const kcal = estimateNetKcal(bw, duration, restTime);
      lines.push(`BODYWEIGHT: ${bodyweight} kg  |  EST. NET KCAL: ${kcal} kcal`);
    }
  }

  lines.push('');

  // Previous session for this workout (exclude current session by date)
  const prevSession = history
    ? getMostRecentSession(workoutName, history.filter(h => h.date !== date)).entry
    : null;
  const prevWkNum = prevSession
    ? Math.max(1, Math.floor((parseHistoryDate(prevSession.date) - epoch) / (7 * 24 * 60 * 60 * 1000)) + 1)
    : null;

  exs.forEach(ex => {
    const timeStr = ex.startedAt && ex.endedAt
      ? `  [${formatTime(Math.round((ex.endedAt - ex.startedAt) / 1000))}]`
      : '';
    lines.push(`${ex.name} [${ex.muscles}] — ${ex.type}${timeStr}`);
    lines.push(`Target: ${ex.target}`);

    // vs last session signal
    const prevEx = prevSession?.exercises.find(e => e.name === ex.name);
    const prevMax = prevEx ? Math.max(...prevEx.sets.map(s => parseFloat(s.weight) || 0)) : 0;
    const curMax = Math.max(...ex.sets.map(s => parseFloat(s.weight) || 0));
    if (prevMax && curMax && prevWkNum) {
      const delta = Math.round((curMax - prevMax) * 10) / 10;
      if (delta > 0)       lines.push(`↑ INCREASE  +${delta} kg vs Wk ${prevWkNum} (${prevMax} → ${curMax})`);
      else if (delta < 0)  lines.push(`↓ DECREASE  ${delta} kg vs Wk ${prevWkNum} (${prevMax} → ${curMax})`);
      else                 lines.push(`→ HOLD  same weight as Wk ${prevWkNum} (${curMax} kg)`);
    }

    ex.sets.forEach((s, i) => {
      let row = `  Set ${i + 1}: ${s.weight}kg × ${s.reps}`;
      if (s.rpe) row += ` @ RPE ${s.rpe}`;
      if (s.drops.length > 0) {
        row += `  →  ${s.drops.map(d => `${d.weight}kg × ${d.reps}`).join(' → ')}`;
      }
      lines.push(row);
    });
    if (ex.notes?.trim()) {
      lines.push(`  Note: ${ex.notes.trim()}`);
    }
    lines.push('');
  });

  lines.push(`---`);
  lines.push(`Analyse this session:`);
  lines.push(`1. Performance notes — what was strong, what dropped`);
  lines.push(`2. Targets for my next ${workoutName} session`);
  lines.push(`3. Any recovery or programming flags`);

  return lines.join('\n');
}

export function formatWeekForCoach(weekEntries: HistoryEntry[]): string {
  const trainEntries = weekEntries.filter(e => !e.isRestDay);
  const totalVolume = trainEntries.reduce((total, entry) => total + sessionVolume(entry.exercises), 0);

  const totalActive = trainEntries.reduce((t, e) => t + e.duration, 0);
  const totalRest = trainEntries.reduce((t, e) => t + e.restTime, 0);
  const restDayCount = weekEntries.filter(e => e.isRestDay).length;

  const lines: string[] = [
    `WEEK REVIEW`,
    `SESSIONS: ${trainEntries.length}${restDayCount > 0 ? ` (+ ${restDayCount} rest day${restDayCount > 1 ? 's' : ''})` : ''}  |  TOTAL VOLUME: ${totalVolume.toLocaleString()} kg`,
    `ACTIVE: ${formatTime(totalActive)}  |  REST: ${formatTime(totalRest)}`,
    ``,
  ];

  weekEntries.forEach(entry => {
    if (entry.isRestDay) {
      lines.push(`── ${entry.workoutName} — REST DAY`);
      lines.push('');
      return;
    }
    const vol = entry.exercises.reduce((ev, ex) =>
      ev + ex.sets.reduce((s, set) => {
        const w = parseFloat(set.weight) || 0;
        const r = parseInt(set.reps) || 0;
        const dropVol = set.drops.reduce((dv, d) =>
          dv + (parseFloat(d.weight) || 0) * (parseInt(d.reps) || 0), 0);
        return s + w * r + dropVol;
      }, 0), 0);
    lines.push(`── ${entry.workoutName} (${entry.date})  |  Vol: ${vol.toLocaleString()} kg  |  Active: ${formatTime(entry.duration)}`);
    entry.exercises.forEach(ex => {
      lines.push(`  ${ex.name} [${ex.muscles}]`);
      lines.push(`    Target: ${ex.target}`);
      const rpeVals = ex.sets.map(s => parseFloat(s.rpe ?? '')).filter(n => !isNaN(n));
      const avgRpe = rpeVals.length > 0 ? (rpeVals.reduce((a, b) => a + b, 0) / rpeVals.length).toFixed(1) : null;
      const setStrs = ex.sets.map(s => {
        let str = `${s.weight}kg×${s.reps}`;
        if (s.drops?.length > 0) str += ` → ${s.drops.map(d => `${d.weight}kg×${d.reps}`).join(' → ')}`;
        return str;
      }).join('  ');
      lines.push(`    Logged: ${setStrs}${avgRpe ? `  [avg RPE ${avgRpe}]` : ''}`);
      if (ex.notes?.trim()) lines.push(`    Note: ${ex.notes.trim()}`);
    });
    lines.push('');
  });

  lines.push(`---`);
  lines.push(`📎 Attach any cardio summaries (screenshots from Apple Watch, NRC, Runkeeper etc.) to give full context on this week's training load.`);
  lines.push(``);
  lines.push(`Based on this full week of training:`);
  lines.push(`1. What are the key performance trends across all sessions?`);
  lines.push(`2. Which muscles were over/under stimulated relative to targets?`);
  lines.push(`3. What adjustments should I make for next week (volume, intensity, exercise selection)?`);
  lines.push(`4. Any recovery or programming flags going into next week?`);

  return lines.join('\n');
}

export function formatUpcomingSessionForCoach(
  day: number,
  weekPlan: Record<number, Omit<Exercise, 'sets'>[]>,
  history: HistoryEntry[]
): string {
  const workoutName = SPLIT[day];
  const lines: string[] = [];

  // ── This week so far ──
  const completedThisWeek = WEEK_DAYS
    .filter(d => d < day)
    .map(d => history.find(h => WORKOUT_TO_DAY[h.workoutName] === d))
    .filter(Boolean) as HistoryEntry[];

  if (completedThisWeek.length > 0) {
    lines.push(`THIS WEEK SO FAR:`);
    completedThisWeek.forEach(entry => {
      lines.push(`\n✓ ${entry.workoutName} — ${entry.date} (active: ${formatTime(entry.duration)}, rest: ${formatTime(entry.restTime)})`);
      entry.exercises.forEach(ex => {
        const sets = ex.sets.map(s => {
          let row = `${s.weight}kg×${s.reps}`;
          if (s.drops.length > 0) row += ` → ${s.drops.map(d => `${d.weight}kg×${d.reps}`).join(' → ')}`;
          return row;
        }).join(',  ');
        lines.push(`  ${ex.name}: ${sets}`);
      });
    });
  } else {
    lines.push(`THIS WEEK SO FAR: No sessions logged yet.`);
  }

  // ── Last week's same session ──
  const lastWeekEntry = [...history]
    .filter(h => h.workoutName === workoutName)
    .sort((a, b) => parseHistoryDate(b.date) - parseHistoryDate(a.date))
    .slice(1, 2)[0]; // skip most recent, take previous (date-sorted)

  if (lastWeekEntry) {
    lines.push(`\n\nLAST WEEK — ${workoutName} (${lastWeekEntry.date}):`);
    lastWeekEntry.exercises.forEach(ex => {
      const sets = ex.sets.map(s => {
        let row = `${s.weight}kg×${s.reps}`;
        if (s.drops.length > 0) row += ` → ${s.drops.map(d => `${d.weight}kg×${d.reps}`).join(' → ')}`;
        return row;
      }).join(',  ');
      lines.push(`  ${ex.name}: ${sets}`);
    });
  } else {
    lines.push(`\n\nLAST WEEK — ${workoutName}: No prior data.`);
  }

  // ── Upcoming session plan ──
  lines.push(`\n\nUPCOMING SESSION: ${workoutName}`);
  (weekPlan[day] ?? []).forEach(ex => {
    lines.push(`  ${ex.name} [${ex.muscles}] — ${ex.type}`);
    lines.push(`    Target: ${ex.target}`);
    lines.push(`    Cue: ${ex.cue}`);
  });

  // ── Prompt ──
  lines.push(`\n---`);
  lines.push(`Based on this week's fatigue and last week's performance, should I adjust anything for today's ${workoutName}?`);
  lines.push(`1. Any exercise swaps worth considering?`);
  lines.push(`2. Should I adjust any targets (weight, reps, sets)?`);
  lines.push(`3. Any pacing or recovery flags going into this session?`);

  return lines.join('\n');
}

