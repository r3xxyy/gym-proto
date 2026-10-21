/** Wall-clock read for event handlers; lives outside components so the React Compiler doesn't flag it as an impure render call. */
export const nowMs = () => Date.now();

const _MONTH_IDX: Record<string, number> = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
};
export function parseHistoryDate(dateStr: string): number {
  // Input: "Mon, 8 Jun 2026" or "8 Jun 2026"
  const cleaned = dateStr.replace(/^[A-Za-z]+,\s*/, '').trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length === 3) {
    const day   = parseInt(parts[0], 10);
    const month = _MONTH_IDX[parts[1].toLowerCase().slice(0, 3)];
    const year  = parseInt(parts[2], 10);
    if (!isNaN(day) && month !== undefined && !isNaN(year)) {
      return new Date(year, month, day).getTime(); // local midnight — matches PROGRAM_EPOCH construction
    }
  }
  return 0;
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

