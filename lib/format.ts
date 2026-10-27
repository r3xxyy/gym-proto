/** Wall-clock read for event handlers; lives outside components so the React Compiler doesn't flag it as an impure render call. */
export const nowMs = () => Date.now();

const MONTH_IDX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parses "Mon, 8 Jun 2026" / "8 Jun 2026" as LOCAL midnight (matches PROGRAM_EPOCH; avoids UTC skew). Returns 0 if it can't. */
export function parseDateLocal(dateStr: string): number {
  // en-GB can abbreviate September as "Sept", so only the first three letters of the month count.
  const m = dateStr.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/);
  if (!m) return 0;
  const month = MONTH_IDX[m[2].slice(0, 3).toLowerCase()];
  if (month === undefined) return 0;
  return new Date(parseInt(m[3], 10), month, parseInt(m[1], 10)).getTime();
}

export function formatTime(totalSeconds: number) {
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// "Thu, 25 Jun 2026" → "25 Jun"
export function shortDate(dateStr: string): string {
  const cleaned = dateStr.replace(/^[A-Za-z]+,\s*/, '').trim();
  const parts = cleaned.split(/\s+/);
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : dateStr;
}

// "Zdrofit (Spire)" → "Spire" | "AF Stratford" → "Stratford"
export function shortGym(gym: string): string {
  const m = gym.match(/\(([^)]+)\)/);
  if (m) return m[1];
  const parts = gym.split(' ');
  return parts[parts.length - 1];
}

