import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import { capNotes, cleanRemember } from '@/lib/coach-notes';
import { COACH_PROFILE_PATH } from '@/lib/storage';

export type CoachNote = { text: string; at: number };

/** What the coach has been told about how and why the lifter trains. Shown and editable in Diagnostics. */
export const useCoachProfile = create<{ notes: CoachNote[] }>(() => ({ notes: [] }));

export const profileNotes = () => useCoachProfile.getState().notes.map(n => n.text);

async function save() {
  await FileSystem.writeAsStringAsync(COACH_PROFILE_PATH, JSON.stringify({ notes: useCoachProfile.getState().notes })).catch(() => {});
}

export async function loadCoachProfile(): Promise<void> {
  try {
    if (!(await FileSystem.getInfoAsync(COACH_PROFILE_PATH)).exists) return;
    const saved = JSON.parse(await FileSystem.readAsStringAsync(COACH_PROFILE_PATH));
    if (Array.isArray(saved?.notes)) useCoachProfile.setState({ notes: capNotes(saved.notes.filter((n: any) => typeof n?.text === 'string')) });
  } catch { /* unreadable: start empty */ }
}

/** Adds notes the lifter explained; returns the ones that were actually new. */
export function addCoachNotes(raw: unknown): string[] {
  const fresh = cleanRemember(raw, profileNotes());
  if (!fresh.length) return [];
  const now = Date.now();
  useCoachProfile.setState({ notes: capNotes([...fresh.map(text => ({ text, at: now })), ...useCoachProfile.getState().notes]) });
  save();
  return fresh;
}

export function removeCoachNote(text: string): void {
  useCoachProfile.setState({ notes: useCoachProfile.getState().notes.filter(n => n.text !== text) });
  save();
}
