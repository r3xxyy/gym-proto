export const MAX_NOTES = 25;
const MAX_NOTE_LEN = 160;
const MAX_PER_REPLY = 3;

/**
 * Lasting facts the lifter explained, as the coach reported them. Trimmed, kept short, de-duplicated against
 * what is already remembered (case-insensitive) and capped per reply, so a chatty model can't flood the list.
 */
export function cleanRemember(raw: unknown, existing: string[] = []): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(existing.map(t => t.trim().toLowerCase()));
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const t = item.trim().replace(/\s+/g, ' ').slice(0, MAX_NOTE_LEN);
    if (t.length < 4 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= MAX_PER_REPLY) break;
  }
  return out;
}

/** Newest first, at most MAX_NOTES. */
export const capNotes = <T>(notes: T[]): T[] => notes.slice(0, MAX_NOTES);
