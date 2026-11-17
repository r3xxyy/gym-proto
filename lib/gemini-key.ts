import * as FileSystem from 'expo-file-system/legacy';
import { setKeyOverride } from '@/lib/gemini';
import { GEMINI_KEY_PATH } from '@/lib/storage';

/** Load a key pasted on this phone, if any, so it survives restarts. */
export async function loadKeyOverride(): Promise<void> {
  try {
    if (!(await FileSystem.getInfoAsync(GEMINI_KEY_PATH)).exists) return;
    const saved = JSON.parse(await FileSystem.readAsStringAsync(GEMINI_KEY_PATH));
    if (typeof saved?.key === 'string' && saved.key.trim()) setKeyOverride(saved.key);
  } catch { /* unreadable: use the key from the build */ }
}

/** Save a key pasted on this phone; an empty string goes back to the key in the build. */
export async function saveKeyOverride(key: string): Promise<void> {
  const k = key.trim();
  setKeyOverride(k);
  if (k) await FileSystem.writeAsStringAsync(GEMINI_KEY_PATH, JSON.stringify({ key: k })).catch(() => {});
  else await FileSystem.deleteAsync(GEMINI_KEY_PATH, { idempotent: true }).catch(() => {});
}
