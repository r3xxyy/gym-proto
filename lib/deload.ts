import type { HistoryEntry } from '../types';
import { parseDateLocal } from './format';
import { exerciseSeries } from './progress';
import { sessionVolume } from './session-stats';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Total volume per program week, index 0 = oldest of the last `count` weeks, ending at `currentWeek`. */
function weeklyVolumes(history: HistoryEntry[], epoch: number, currentWeek: number, count: number): number[] {
  const out: number[] = [];
  for (let w = currentWeek - count + 1; w <= currentWeek; w++) {
    const start = epoch + (w - 1) * WEEK_MS;
    out.push(
      history
        .filter(e => !e.isRestDay && parseDateLocal(e.date) >= start && parseDateLocal(e.date) < start + WEEK_MS)
        .reduce((t, e) => t + sessionVolume(e.exercises), 0),
    );
  }
  return out;
}

/**
 * A gentle nudge to ease off, or null. Fires when training has run five weeks in a row with no
 * lighter week (a lighter week is under 75% of the average of the three before it), or when
 * estimated one-rep maxes have slipped on at least three of the exercises trained most recently.
 */
export function deloadHint(history: HistoryEntry[], epoch: number, currentWeek: number): string | null {
  // Only completed weeks count; the current one is still in progress.
  const done = currentWeek - 1;
  if (done >= 5) {
    const vols = weeklyVolumes(history, epoch, done, 8);
    const last5 = vols.slice(-5);
    const trainedEveryWeek = last5.every(v => v > 0);
    let sawLighterWeek = false;
    for (let i = vols.length - 5; i < vols.length; i++) {
      const before = vols.slice(Math.max(0, i - 3), i).filter(v => v > 0);
      if (before.length >= 2) {
        const avg = before.reduce((a, b) => a + b, 0) / before.length;
        if (vols[i] < avg * 0.75) sawLighterWeek = true;
      }
    }
    if (trainedEveryWeek && !sawLighterWeek) return 'Five weeks of steady training with no lighter week. Consider an easier week.';
  }

  const names = new Set<string>();
  const newestFirst = [...history].sort((a, b) => parseDateLocal(b.date) - parseDateLocal(a.date));
  for (const e of newestFirst) {
    if (e.isRestDay) continue;
    for (const ex of e.exercises) names.add(ex.name);
  }
  let slipped = 0, checked = 0;
  for (const name of names) {
    const series = exerciseSeries(history, name);
    if (series.length < 3) continue;
    checked++;
    if (checked > 6) break;
    const latest = series[series.length - 1].e1rm;
    const prev = series.slice(-3, -1);
    const prevAvg = prev.reduce((t, p) => t + p.e1rm, 0) / prev.length;
    if (latest < prevAvg * 0.97) slipped++;
  }
  if (checked >= 4 && slipped >= 3) return 'Your estimated strength has dipped on several lifts. A lighter week may help.';
  return null;
}
