import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import { COACH_PATH } from '@/lib/storage';
import { type NudgeOutcome } from '@/lib/rpe-bias';

export { rpeBias } from '@/lib/rpe-bias';
export type { NudgeOutcome } from '@/lib/rpe-bias';

const MAX_ENTRIES = 300;

export const useCoachLog = create<{ nudges: NudgeOutcome[] }>(() => ({ nudges: [] }));

export async function loadCoachLog(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(COACH_PATH);
    if (!info.exists) return;
    const saved = JSON.parse(await FileSystem.readAsStringAsync(COACH_PATH));
    if (Array.isArray(saved?.nudges)) useCoachLog.setState({ nudges: saved.nudges.slice(-MAX_ENTRIES) });
  } catch { /* an unreadable log just starts empty */ }
}

export function recordNudge(n: NudgeOutcome): void {
  const nudges = [...useCoachLog.getState().nudges, n].slice(-MAX_ENTRIES);
  useCoachLog.setState({ nudges });
  FileSystem.writeAsStringAsync(COACH_PATH, JSON.stringify({ nudges })).catch(() => {});
}
