// ─── Badge Definitions & Check Logic ─────────────────────────────────────────

import type { HistoryEntry, UnlockedBadge } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BadgeDefinition =
  | { family: 'streak';   id: string; name: string; flavour: string; icon: string; days: number }
  | { family: 'session';  id: string; name: string; flavour: string; icon: string; workoutName: string; count: number }
  | { family: 'overload'; id: string; name: string; flavour: string; icon: string;
      genuinePRs?: number;
      minWeight?: number;
      minSessions?: number;
      minSessionVol?: number;
      minWeeklyVol?: number;
    }
  | { family: 'holiday';  id: string; name: string; flavour: string; icon: string; dates: Array<{ month: number; day: number; year?: number }> };

// ─── Badge List ───────────────────────────────────────────────────────────────

export const ALL_BADGES: BadgeDefinition[] = [

  // ── Streak ──────────────────────────────────────────────────────────────────
  { family: 'streak', id: 'streak_3',  icon: '🔥', name: 'On A Roll',            flavour: 'Three sessions in a row. The streak begins.',                                 days: 3  },
  { family: 'streak', id: 'streak_7',  icon: '🎟️', name: 'Week Residency',        flavour: 'Seven consecutive sessions. The venue is yours.',                            days: 7  },
  { family: 'streak', id: 'streak_14', icon: '🎫', name: 'Extended Run',           flavour: 'Two weeks straight. This is no longer casual.',                              days: 14 },
  { family: 'streak', id: 'streak_28', icon: '🏟️', name: 'Month-Long Tour',       flavour: 'A full month without missing a show.',                                       days: 28 },
  { family: 'streak', id: 'streak_60', icon: '⭐', name: 'Sold Out Run',           flavour: 'Sixty sessions straight. The show always goes on.',                          days: 60 },

  // ── Session — Terra Firma (Leg A) ────────────────────────────────────────────
  { family: 'session', id: 'terra_5',  icon: '🪨', name: 'Terra Firma: Opener',   flavour: 'Five times you planted your feet. The ground knows your name.',              workoutName: 'Leg A', count: 5  },
  { family: 'session', id: 'terra_10', icon: '🪨', name: 'Terra Firma: Regular',  flavour: 'Ten sessions in. You own this floor.',                                       workoutName: 'Leg A', count: 10 },
  { family: 'session', id: 'terra_25', icon: '🪨', name: 'Terra Firma: Veteran',  flavour: 'Twenty-five sessions. This is your stage.',                                  workoutName: 'Leg A', count: 25 },

  // ── Session — Override (Push Day) ────────────────────────────────────────────
  { family: 'session', id: 'override_5',  icon: '⚡', name: 'Override: Initiated',  flavour: 'Five push days. The signal is getting through.',                            workoutName: 'Push Day', count: 5  },
  { family: 'session', id: 'override_10', icon: '⚡', name: 'Override: Established', flavour: 'Ten sessions. The override is taking hold.',                               workoutName: 'Push Day', count: 10 },
  { family: 'session', id: 'override_25', icon: '⚡', name: 'Override: Complete',   flavour: 'Twenty-five push days. Nothing holds you back.',                            workoutName: 'Push Day', count: 25 },

  // ── Session — Undertow (Pull Day) ────────────────────────────────────────────
  { family: 'session', id: 'undertow_5',  icon: '🌊', name: 'Undertow: Felt',      flavour: 'Five pull days. The current is pulling you forward.',                       workoutName: 'Pull Day', count: 5  },
  { family: 'session', id: 'undertow_10', icon: '🌊', name: 'Undertow: Strong',    flavour: 'Ten sessions in the deep end.',                                              workoutName: 'Pull Day', count: 10 },
  { family: 'session', id: 'undertow_25', icon: '🌊', name: 'Undertow: Master',    flavour: 'Twenty-five pull days. You navigate by instinct.',                          workoutName: 'Pull Day', count: 25 },

  // ── Session — Boulder Shoulder ────────────────────────────────────────────────
  { family: 'session', id: 'boulder_5',  icon: '🪬', name: 'Boulder: Season',      flavour: 'Five shoulder days. The caps are coming in.',                               workoutName: 'Boulder Shoulder', count: 5  },
  { family: 'session', id: 'boulder_10', icon: '🪬', name: 'Boulder: Status',      flavour: 'Ten sessions. You earned the name.',                                        workoutName: 'Boulder Shoulder', count: 10 },
  { family: 'session', id: 'boulder_25', icon: '🪬', name: 'Boulder: Certified',   flavour: "Twenty-five shoulder days. They're boulders now.",                          workoutName: 'Boulder Shoulder', count: 25 },

  // ── Session — Aftermath (Leg B) ───────────────────────────────────────────────
  { family: 'session', id: 'aftermath_5',  icon: '💥', name: 'Aftermath: Survivor', flavour: 'Five sessions of Aftermath. You always came back.',                        workoutName: 'Leg B', count: 5  },
  { family: 'session', id: 'aftermath_10', icon: '💥', name: 'Aftermath: Regular',  flavour: 'Ten sessions. The aftermath is just the warm-up now.',                     workoutName: 'Leg B', count: 10 },
  { family: 'session', id: 'aftermath_25', icon: '💥', name: 'Aftermath: Veteran',  flavour: 'Twenty-five sessions. The damage is the point.',                           workoutName: 'Leg B', count: 25 },

  // ── Overload — Weight thresholds ─────────────────────────────────────────────
  { family: 'overload', id: 'weight_60',  icon: '🔵', name: 'Plate Club',         flavour: 'A plate on each side. First milestone of the iron game.',                     minWeight: 60  },
  { family: 'overload', id: 'weight_80',  icon: '🟦', name: 'Heavy Iron',          flavour: 'Eighty kilos on any lift. Now you\'re in real territory.',                    minWeight: 80  },
  { family: 'overload', id: 'weight_100', icon: '💯', name: 'Century Club',        flavour: 'Three digits on any lift. Welcome to the club.',                              minWeight: 100 },
  { family: 'overload', id: 'weight_120', icon: '⬛', name: 'Two Plates',          flavour: 'A hundred and twenty kilos. Not many people get here.',                       minWeight: 120 },
  { family: 'overload', id: 'weight_140', icon: '🖤', name: 'Serious Weight',      flavour: 'A hundred and forty. The bar bends.',                                         minWeight: 140 },

  // ── Overload — Genuine PR count ───────────────────────────────────────────────
  { family: 'overload', id: 'pr_first',  icon: '🩸', name: 'Breaking Records',    flavour: 'First time you beat your own weight on any lift. The grind is working.',      genuinePRs: 1  },
  { family: 'overload', id: 'pr_5',      icon: '📈', name: 'Five & Counting',     flavour: 'Genuine improvements on five different lifts. Progressive overload is real.', genuinePRs: 5  },
  { family: 'overload', id: 'pr_10',     icon: '🏆', name: 'Relentless',           flavour: 'Ten lifts where you came back heavier. That\'s the whole game.',             genuinePRs: 10 },
  { family: 'overload', id: 'pr_15',     icon: '🔑', name: 'PR Machine',           flavour: 'Fifteen lifts with a genuine improvement on the books. The log speaks.',     genuinePRs: 15 },
  { family: 'overload', id: 'pr_20',     icon: '👑', name: 'Untouchable',          flavour: 'Twenty lifts where you came back stronger. Pure progressive overload.',       genuinePRs: 20 },

  // ── Overload — Session volume ─────────────────────────────────────────────────
  { family: 'overload', id: 'svol_1k',   icon: '📦', name: 'One Tonne Session',   flavour: 'A thousand kilos in a single session. That\'s a session.',                   minSessionVol: 1000  },
  { family: 'overload', id: 'svol_2k',   icon: '🪨', name: 'Two Tonne Session',   flavour: 'Two thousand kilos. The bar didn\'t rest, neither did you.',                  minSessionVol: 2000  },
  { family: 'overload', id: 'svol_5k',   icon: '🏗️', name: 'Five Tonne Session',  flavour: 'Five thousand kilos in one session. Industrial output.',                      minSessionVol: 5000  },

  // ── Overload — Weekly volume ──────────────────────────────────────────────────
  { family: 'overload', id: 'wvol_5k',   icon: '🚛', name: 'Five Tonne Week',     flavour: 'Five thousand kilos across a single week. Consistent and heavy.',             minWeeklyVol: 5000   },
  { family: 'overload', id: 'wvol_10k',  icon: '⚙️', name: 'Ten Tonne Week',      flavour: 'Ten thousand kilos in a week. That\'s an industrial workload.',               minWeeklyVol: 10000  },
  { family: 'overload', id: 'wvol_20k',  icon: '🔩', name: 'Twenty Tonne Week',   flavour: 'Twenty thousand kilos. Unfair.',                                              minWeeklyVol: 20000  },

  // ── Overload — Total sessions ─────────────────────────────────────────────────
  { family: 'overload', id: 'sess_10',   icon: '🎯', name: 'Ten Deep',            flavour: 'Ten sessions in the log. The habit is forming.',                              minSessions: 10  },
  { family: 'overload', id: 'sess_25',   icon: '🗓️', name: 'Quarter Century',     flavour: 'Twenty-five sessions. One hundred sets of showing up.',                      minSessions: 25  },
  { family: 'overload', id: 'sess_50',   icon: '🔋', name: 'Fifty',               flavour: 'Fifty sessions. You don\'t quit.',                                            minSessions: 50  },
  { family: 'overload', id: 'sess_100',  icon: '🏛️', name: 'Centurion',           flavour: 'One hundred sessions. This is your training ground.',                         minSessions: 100 },

  // ── Holiday ───────────────────────────────────────────────────────────────────
  { family: 'holiday', id: 'hol_new_year',     icon: '🎆', name: 'First Rep of the Year',        flavour: 'While everyone else was sleeping it off, you were already training.',       dates: [{ month: 1, day: 1  }] },
  { family: 'holiday', id: 'hol_lunar_ny',     icon: '🧧', name: 'Cai Shen Ye',                  flavour: 'The God of Wealth is watching. Train like it counts.',                     dates: [{ year: 2025, month: 1, day: 29 }, { year: 2026, month: 2, day: 17 }, { year: 2027, month: 2, day: 6 }, { year: 2028, month: 1, day: 26 }] },
  { family: 'holiday', id: 'hol_nowruz',       icon: '🌸', name: 'Nowruz Nasty',                 flavour: 'Persian New Year. New year, new PRs.',                                     dates: [{ month: 3, day: 20 }] },
  { family: 'holiday', id: 'hol_holi',         icon: '🎨', name: 'Colour-Coded Cuts',            flavour: 'Festival of colours. Your gains are the most vibrant thing here.',         dates: [{ year: 2025, month: 3, day: 14 }, { year: 2026, month: 3, day: 4 }, { year: 2027, month: 3, day: 24 }] },
  { family: 'holiday', id: 'hol_womens_day',   icon: '✊', name: 'Iron Lady',                    flavour: "International Women's Day. Iron doesn't discriminate.",                    dates: [{ month: 3, day: 8  }] },
  { family: 'holiday', id: 'hol_pi_day',       icon: '🥧', name: '3.14159... Plates',            flavour: 'Pi Day. Irrational commitment. Calculated gains.',                         dates: [{ month: 3, day: 14 }] },
  { family: 'holiday', id: 'hol_patrick',      icon: '☘️', name: 'Green Gains',                  flavour: "St Patrick's Day. The only thing getting crushed is your PRs.",           dates: [{ month: 3, day: 17 }] },
  { family: 'holiday', id: 'hol_eid',          icon: '🌙', name: 'Post-Ramadan Arc',             flavour: 'Eid al-Fitr. The fast is over. The grind never was.',                      dates: [{ year: 2025, month: 3, day: 30 }, { year: 2026, month: 3, day: 20 }, { year: 2027, month: 3, day: 9 }] },
  { family: 'holiday', id: 'hol_easter',       icon: '🐰', name: "Easter Bunny's Creatine",      flavour: "He hid eggs. You hid the gains. Nobody's skipping today.",                 dates: [{ year: 2025, month: 4, day: 20 }, { year: 2026, month: 4, day: 5 }, { year: 2027, month: 3, day: 28 }, { year: 2028, month: 4, day: 16 }] },
  { family: 'holiday', id: 'hol_april_fools',  icon: '🃏', name: 'Skipped Leg Day',              flavour: "April Fools'. You didn't skip. The joke's on everyone else.",              dates: [{ month: 4, day: 1  }] },
  { family: 'holiday', id: 'hol_earth_day',    icon: '🌍', name: 'Earth Day Pump',               flavour: "Protect the planet. Pump the iron. They're not mutually exclusive.",      dates: [{ month: 4, day: 22 }] },
  { family: 'holiday', id: 'hol_anzac',        icon: '🌺', name: 'Lest We Never Skip',           flavour: "ANZAC Day. They didn't stop. Neither did you.",                           dates: [{ month: 4, day: 25 }] },
  { family: 'holiday', id: 'hol_may_day',      icon: '✊', name: 'Labour of Gainz',              flavour: "International Workers' Day. You put in the work.",                        dates: [{ month: 5, day: 1  }] },
  { family: 'holiday', id: 'hol_star_wars',    icon: '⚔️', name: 'May The Gains Be With You',   flavour: "May 4th. Do. Or do not. There is no rest day.",                           dates: [{ month: 5, day: 4  }] },
  { family: 'holiday', id: 'hol_vesak',        icon: '🕯️', name: 'Vesak Strength',               flavour: "Buddha's Birthday. Still mind, still lifting.",                           dates: [{ year: 2025, month: 5, day: 12 }, { year: 2026, month: 5, day: 31 }, { year: 2027, month: 5, day: 21 }] },
  { family: 'holiday', id: 'hol_solstice_s',   icon: '☀️', name: 'Longest Day, Biggest Pump',   flavour: 'Summer Solstice. Most hours of daylight. Fewest excuses.',                 dates: [{ month: 6, day: 21 }] },
  { family: 'holiday', id: 'hol_independence', icon: '🦅', name: 'Star-Spangled Pump',           flavour: 'Fourth of July. Land of the free, home of the gains.',                    dates: [{ month: 7, day: 4  }] },
  { family: 'holiday', id: 'hol_bastille',     icon: '🥖', name: 'Bastille Boulders',            flavour: 'Bastille Day. Liberté, Égalité, Hypertrophie.',                            dates: [{ month: 7, day: 14 }] },
  { family: 'holiday', id: 'hol_youth_day',    icon: '⚡', name: 'Baby Gainz',                   flavour: 'International Youth Day. You were never this young again.',                dates: [{ month: 8, day: 12 }] },
  { family: 'holiday', id: 'hol_coffee_day',   icon: '☕', name: 'Pre-Workout Day',              flavour: 'International Coffee Day. The original pre-workout.',                      dates: [{ month: 10, day: 1  }] },
  { family: 'holiday', id: 'hol_mental_health',icon: '🧠', name: 'Iron Mind',                    flavour: 'World Mental Health Day. The gym is part of the prescription.',            dates: [{ month: 10, day: 10 }] },
  { family: 'holiday', id: 'hol_diwali',       icon: '🪔', name: 'Festival of Gainz',            flavour: 'Diwali. The festival of lights. The gains are the brightest.',             dates: [{ year: 2025, month: 10, day: 20 }, { year: 2026, month: 11, day: 8 }, { year: 2027, month: 10, day: 29 }] },
  { family: 'holiday', id: 'hol_halloween',    icon: '💀', name: 'Ghost Protocol',               flavour: "Halloween. You can't haunt the gym if you're not there.",                 dates: [{ month: 10, day: 31 }] },
  { family: 'holiday', id: 'hol_fawkes',       icon: '🎇', name: 'Remember, Remember to Train', flavour: 'November 5th. The powder plot: protein + progressive overload.',           dates: [{ month: 11, day: 5  }] },
  { family: 'holiday', id: 'hol_armistice',    icon: '🕊️', name: 'At the 11th Hour',             flavour: 'Remembrance Day. They gave everything. Give your set.',                   dates: [{ month: 11, day: 11 }] },
  { family: 'holiday', id: 'hol_thanksgiving', icon: '🦃', name: 'Turkey Day',                   flavour: 'Thanksgiving. You worked for this meal.',                                  dates: [{ year: 2025, month: 11, day: 27 }, { year: 2026, month: 11, day: 26 }, { year: 2027, month: 11, day: 25 }] },
  { family: 'holiday', id: 'hol_solstice_w',   icon: '🌑', name: 'Shortest Day, Still Showed Up', flavour: 'Winter Solstice. Least light. Most character.',                          dates: [{ month: 12, day: 21 }] },
  { family: 'holiday', id: 'hol_christmas',    icon: '🎅', name: "Santa's Sick Pull Day",        flavour: 'Christmas Day. He delivers to everyone else. You delivered for yourself.', dates: [{ month: 12, day: 25 }] },
  { family: 'holiday', id: 'hol_nye',          icon: '🥂', name: 'Last Rep of the Year',         flavour: "New Year's Eve. End the year how you started it — working.",              dates: [{ month: 12, day: 31 }] },
];

// ─── Check Logic ──────────────────────────────────────────────────────────────

const MONTH_IDX: Record<string, number> = {
  Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11,
};

function parseDateLocal(dateStr: string): number {
  const m = dateStr.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!m) return NaN;
  const month = MONTH_IDX[m[2]];
  if (month === undefined) return NaN;
  return new Date(parseInt(m[3]), month, parseInt(m[1])).getTime();
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function getTrainedDateKeys(history: HistoryEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of history) {
    const ms = parseDateLocal(entry.date);
    if (!isNaN(ms)) keys.add(toDateKey(new Date(ms)));
  }
  return keys;
}

// Returns working-day streak (Mon–Fri only). Weekends are skipped — Fri→Mon counts as consecutive.
function computeStreak(history: HistoryEntry[]): number {
  const trainedDates = getTrainedDateKeys(history);
  if (trainedDates.size === 0) return 0;

  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date();

  // Only weekday dates where a session was logged, sorted descending
  const weekdays = [...trainedDates]
    .map(k => { const [y, mo, d] = k.split('-').map(Number); return new Date(y, mo - 1, d); })
    .filter(d => d.getDay() >= 1 && d.getDay() <= 5)
    .sort((a, b) => b.getTime() - a.getTime());

  if (weekdays.length === 0) return 0;

  // Check streak is still alive: no missed weekday between most recent session and today (today itself is OK to skip)
  const check = new Date(weekdays[0].getTime() + dayMs);
  while (toDateKey(check) !== toDateKey(today)) {
    if (check.getDay() >= 1 && check.getDay() <= 5 && !trainedDates.has(toDateKey(check))) return 0;
    check.setTime(check.getTime() + dayMs);
  }

  // Count consecutive working days backward — gap is OK only if no weekday lies between the two dates
  let streak = 1;
  for (let i = 1; i < weekdays.length; i++) {
    const newer = weekdays[i - 1];
    const older = weekdays[i];
    // Check for any weekday between older and newer
    let missed = false;
    const cursor = new Date(older.getTime() + dayMs);
    while (cursor < newer) {
      if (cursor.getDay() >= 1 && cursor.getDay() <= 5) { missed = true; break; }
      cursor.setTime(cursor.getTime() + dayMs);
    }
    if (!missed) streak++;
    else break;
  }
  return streak;
}

// Counts lifts where a later session beat a previous session's weight — genuine progressive overload.
function computeGenuinePRLifts(history: HistoryEntry[]): number {
  const sorted = [...history].sort((a, b) => parseDateLocal(a.date) - parseDateLocal(b.date));
  const prevBest: Record<string, number> = {};
  const improved = new Set<string>();
  for (const entry of sorted) {
    for (const ex of entry.exercises) {
      const sessionMax = Math.max(0, ...ex.sets.map(s => parseFloat(s.weight) || 0));
      if (sessionMax <= 0) continue;
      if (prevBest[ex.name] !== undefined && sessionMax > prevBest[ex.name]) {
        improved.add(ex.name);
      }
      prevBest[ex.name] = Math.max(prevBest[ex.name] ?? 0, sessionMax);
    }
  }
  return improved.size;
}

function getMaxWeightEver(history: HistoryEntry[]): number {
  let max = 0;
  for (const entry of history) {
    for (const ex of entry.exercises) {
      for (const s of ex.sets) {
        const w = parseFloat(s.weight);
        if (!isNaN(w) && w > max) max = w;
      }
    }
  }
  return max;
}

function sessionVolume(entry: HistoryEntry): number {
  return entry.exercises.reduce((total, ex) =>
    total + ex.sets.reduce((s, set) => {
      const w = parseFloat(set.weight) || 0;
      const r = parseInt(set.reps) || 0;
      const drops = set.drops.reduce((dv, d) =>
        dv + (parseFloat(d.weight) || 0) * (parseInt(d.reps) || 0), 0);
      return s + w * r + drops;
    }, 0), 0);
}

function getMaxSessionVolume(history: HistoryEntry[]): number {
  return Math.max(0, ...history.map(sessionVolume));
}

function getMaxWeeklyVolume(history: HistoryEntry[]): number {
  const weekVols: Record<string, number> = {};
  for (const entry of history) {
    const ms = parseDateLocal(entry.date);
    if (isNaN(ms)) continue;
    const d = new Date(ms);
    const dow = d.getDay() === 0 ? 7 : d.getDay();
    const monday = toDateKey(new Date(ms - (dow - 1) * 24 * 60 * 60 * 1000));
    weekVols[monday] = (weekVols[monday] || 0) + sessionVolume(entry);
  }
  return Math.max(0, ...Object.values(weekVols));
}

function isBadgeEarned(badge: BadgeDefinition, history: HistoryEntry[]): boolean {
  const today = new Date();

  switch (badge.family) {
    case 'streak':
      return computeStreak(history) >= badge.days;

    case 'session':
      return history.filter(e => e.workoutName === badge.workoutName).length >= badge.count;

    case 'overload': {
      if (badge.genuinePRs    !== undefined && computeGenuinePRLifts(history)  < badge.genuinePRs)    return false;
      if (badge.minWeight     !== undefined && getMaxWeightEver(history)        < badge.minWeight)     return false;
      if (badge.minSessions   !== undefined && history.length                   < badge.minSessions)   return false;
      if (badge.minSessionVol !== undefined && getMaxSessionVolume(history)     < badge.minSessionVol) return false;
      if (badge.minWeeklyVol  !== undefined && getMaxWeeklyVolume(history)      < badge.minWeeklyVol)  return false;
      return true;
    }

    case 'holiday': {
      const trainedDates = getTrainedDateKeys(history);
      if (!trainedDates.has(toDateKey(today))) return false;
      return badge.dates.some(d => {
        if (d.year !== undefined && d.year !== today.getFullYear()) return false;
        return d.month === today.getMonth() + 1 && d.day === today.getDate();
      });
    }
  }
}

export function checkNewBadges(
  history: HistoryEntry[],
  currentUnlocked: UnlockedBadge[],
): BadgeDefinition[] {
  const unlockedIds = new Set(currentUnlocked.map(b => b.id));
  return ALL_BADGES.filter(b => !unlockedIds.has(b.id) && isBadgeEarned(b, history));
}
