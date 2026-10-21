import { useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import {
  Alert,
  AppState,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActRow } from '@/components/act-row';
import { AnimatedPosterName } from '@/components/animated-poster-name';
import { BadgeUnlockOverlay } from '@/components/badge-unlock-overlay';
import { DraggableCard, NUMPAD_DONE_ID, NUMPAD_ID, runNumpadNext } from '@/components/exercise-card';
import { HistoryScreen } from '@/components/history-screen';
import { SummaryScreen } from '@/components/summary-screen';

import { ChromeChains } from '@/components/chrome-chains';
import { Ink, Legible } from '@/constants/theme';
import { formatSessionForCoach, formatUpcomingSessionForCoach, formatWeekForCoach } from '@/lib/coach-text';
import { formatTime, nowMs, parseHistoryDate, shortDate, shortGym } from '@/lib/format';
import { FREE_WEIGHT_EXERCISES, getLastSessionColor, getMostRecentSession, getPrevSessionInfo } from '@/lib/history-lookup';
import type { PrevRef } from '@/lib/history-lookup';
import { getRestDuration } from '@/lib/rest';
import { RESTORED_SESSIONS } from '@/lib/seed-history';
import { ACTIVE_SESSION_PATH, BADGES_PATH, BW_PATH, EPOCH_PATH, GYM_PATH, GYMS_PATH, HISTORY_PATH, PENDING_PATH, WEEK_PLAN_PATH } from '@/lib/storage';
import type { Drop, Exercise, HistoryEntry, UnlockedBadge } from '../../types';
import { checkNewBadges } from '../../constants/badges';
import type { BadgeDefinition } from '../../constants/badges';
import { PROGRAM_EPOCH, getCurrentProgramWeek, getCurrentWeekBounds, SWAP_POOL, getWeekExercises, SPLIT, SPLIT_LABEL, WORKOUT_TO_DAY, WEEK_DAYS, DAY_TEXT_STYLES } from '../../constants/programs';

// Show banners + play sound even when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});


function getTodayWorkout() {
  return SPLIT[new Date().getDay()];
}

// Pre-fill sets from venue-appropriate history. Falls back to target structure (empty weight) if no history.
function initSetsFromHistory(
  exName: string,
  workoutName: string,
  history: HistoryEntry[],
  activeGym: string,
  target: string,
): Array<{ weight: string; reps: string; rpe: string; drops: Drop[] }> {
  const isFree = FREE_WEIGHT_EXERCISES.has(exName);
  const { entry: prev } = getMostRecentSession(workoutName, history, isFree ? undefined : activeGym || undefined);
  const prevEx = prev?.exercises.find(e => e.name === exName);
  if (prevEx?.sets.some(s => s.weight)) {
    return prevEx.sets.map(s => ({ weight: s.weight, reps: s.reps, rpe: '', drops: s.drops.map(d => ({ weight: d.weight, reps: d.reps })) }));
  }
  // No history — use target for set/rep structure but leave weight blank
  const withWeight = target.match(/^(\d+\.?\d*)\s*kg\s*[×xX]\s*([\d–\-]+)\s*[×xX]\s*(\d+)/i);
  if (withWeight) {
    const count = parseInt(withWeight[3], 10);
    return Array.from({ length: Math.max(1, count) }, () => ({ weight: '', reps: withWeight[2], rpe: '', drops: [] }));
  }
  const noWeight = target.match(/[×xX]\s*([\d–\-]+)\s*[×xX]\s*(\d+)/i);
  if (noWeight) {
    const count = parseInt(noWeight[2], 10);
    return Array.from({ length: Math.max(1, count) }, () => ({ weight: '', reps: noWeight[1], rpe: '', drops: [] }));
  }
  return [{ weight: '', reps: '', rpe: '', drops: [] }];
}

function getSwapOptions(exerciseId: string, current: Omit<Exercise, 'sets'>[]): Omit<Exercise, 'sets'>[] {
  return SWAP_POOL.filter(s => s.id !== exerciseId && !current.some(e => e.id === s.id && e.id !== exerciseId));
}


// ─── Main Screen ──────────────────────────────────────────────────────────────

// ─── Gym migration ────────────────────────────────────────────────────────────
function applyGymTags(history: HistoryEntry[]): { updated: HistoryEntry[]; changed: boolean } {
  const SPIRE_TS     = new Set([12, 16, 17, 18, 19, 24].map(d => new Date(2026, 5, d).getTime()));
  const WARSAW_TS    = new Set([15, 22, 23].map(d => new Date(2026, 5, d).getTime()));
  const STRATFORD_TS = new Set([25, 26].map(d => new Date(2026, 5, d).getTime()));
  const VALLEY_CUTOFF = new Date(2026, 5, 9).getTime(); // everything before 9 Jun 2026

  let changed = false;
  const updated = history.map(entry => {
    if (entry.gym) return entry; // already tagged
    const ts = parseHistoryDate(entry.date);
    if (ts <= 0) return entry;
    let gym: string | undefined;
    if (STRATFORD_TS.has(ts))    gym = 'AF Stratford';
    else if (SPIRE_TS.has(ts))   gym = 'Zdrofit (Spire)';
    else if (WARSAW_TS.has(ts))  gym = 'Zdrofit (Warsaw Hub)';
    else if (ts < VALLEY_CUTOFF) gym = 'AF Valley Point';
    if (gym) { changed = true; return { ...entry, gym }; }
    return entry;
  });
  return { updated, changed };
}

// ─── Derive targets from history when no coach plan exists for current week ───
function deriveTargetsFromHistory(
  base: Record<number, Omit<Exercise, 'sets'>[]>,
  history: HistoryEntry[]
): Record<number, Omit<Exercise, 'sets'>[]> {
  const result: Record<number, Omit<Exercise, 'sets'>[]> = {};
  for (const day of [1, 2, 3, 4, 5] as const) {
    const workoutName = SPLIT[day];
    const lastEntry = [...history]
      .filter(h => h.workoutName === workoutName)
      .sort((a, b) => parseHistoryDate(b.date) - parseHistoryDate(a.date))[0];
    result[day] = (base[day] ?? []).map(ex => {
      if (!lastEntry) return ex;
      const lastEx = lastEntry.exercises.find(e => e.name === ex.name);
      if (!lastEx) return ex;
      const logged = lastEx.sets.filter(s => parseFloat(s.weight) > 0);
      if (logged.length === 0) return ex;
      const maxSet = logged.reduce((best, s) =>
        (parseFloat(s.weight) || 0) > (parseFloat(best.weight) || 0) ? s : best
      );
      return { ...ex, target: `${maxSet.weight} kg × ${maxSet.reps} × ${logged.length}` };
    });
  }
  return result;
}

export default function HomeScreen() {
  const [screen, setScreen] = useState<'home' | 'active' | 'summary' | 'history'>('home');
  const prevScreenRef = useRef<'home' | 'active'>('home');
  const [seconds, setSeconds] = useState(0);
  const [totalSessionSecs, setTotalSessionSecs] = useState(0); // cumulative from start, never pauses
  const [paused, setPaused] = useState(false);
  const [, setRestSeconds] = useState(0);       // total rest (for history)
  const [currentRestSecs, setCurrentRestSecs] = useState(0); // per-set rest display
  const [finalSeconds, setFinalSeconds] = useState(0);
  const [finalRest, setFinalRest] = useState(0);
  const [currentRestDuration, setCurrentRestDuration] = useState(0); // 0 = manual rest (no auto-resume)
  const [bodyweight, setBodyweight] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [programEpoch, setProgramEpoch] = useState(PROGRAM_EPOCH);
  const currentWeek = getCurrentProgramWeek(programEpoch);
  const [weekPlan, setWeekPlan] = useState<Record<number, Omit<Exercise, 'sets'>[]>>(() => {
    const exs = getWeekExercises(currentWeek);
    return { 1: [...exs[1]], 2: [...exs[2]], 3: [...exs[3]], 4: [...exs[4]], 5: [...exs[5]] };
  });
  const [expandedDay, setExpandedDay] = useState<number | null>(() => {
    const d = new Date().getDay();
    return d >= 1 && d <= 5 ? d : 1;
  });
  const [swapContext, setSwapContext] = useState<{ day: number; exerciseId: string | null } | null>(null);
  const [activeSwapId, setActiveSwapId] = useState<string | null>(null); // '__add__' = add mode
  const [swapQuery, setSwapQuery] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeGym, setActiveGym] = useState<string>('');
  const [savedGyms, setSavedGyms] = useState<string[]>([]);
  const [pendingEntry, setPendingEntry] = useState<HistoryEntry | null>(null);
  const [unlockedBadges, setUnlockedBadges] = useState<UnlockedBadge[]>([]);
  const [newBadgeQueue, setNewBadgeQueue] = useState<BadgeDefinition[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [weekPlanLoaded, setWeekPlanLoaded] = useState(false);
  const { start: cwStart, end: cwEnd } = getCurrentWeekBounds(programEpoch);
  const thisWeekHistory = history.filter(h => {
    const ts = parseHistoryDate(h.date);
    return ts >= cwStart && ts < cwEnd;
  });
  const completedDays = [...new Set(thisWeekHistory.map(h => WORKOUT_TO_DAY[h.workoutName]).filter(Boolean))];

  const workoutInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const restInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const totalInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAppActiveRef = useRef(true); // tracks foreground/background reliably via AppState events
  const autoResumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hapticTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifId60 = useRef<string | null>(null);
  const notifId30 = useRef<string | null>(null);
  const notifId10 = useRef<string | null>(null);
  const sessionStartRef = useRef<number>(0);
  const activeStartRef = useRef<number>(0);   // timestamp when current active period began
  const activeAccRef = useRef<number>(0);     // accumulated active seconds before current period
  const restStartRef = useRef<number>(0);     // timestamp when current rest period began
  const restAccRef = useRef<number>(0);       // accumulated rest seconds before current period
  const todayWorkout = getTodayWorkout();
  const knownGyms = [...new Set([...savedGyms, activeGym, ...history.map(h => h.gym)].filter((g): g is string => !!g))];
  function saveGymList(list: string[]) {
    setSavedGyms(list);
    FileSystem.writeAsStringAsync(GYMS_PATH, JSON.stringify(list)).catch(() => {});
  }
  function selectGym(gym: string) {
    setActiveGym(gym);
    FileSystem.writeAsStringAsync(GYM_PATH, JSON.stringify(gym));
    if (!savedGyms.includes(gym)) saveGymList([...savedGyms, gym]);
  }

  function renameGym(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    setHistory(prev => {
      const next = prev.map(e => e.gym === oldName ? { ...e, gym: trimmed } : e);
      FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(next));
      return next;
    });
    saveGymList([...new Set(savedGyms.map(g => g === oldName ? trimmed : g).concat(trimmed))]);
    if (activeGym === oldName) {
      setActiveGym(trimmed);
      FileSystem.writeAsStringAsync(GYM_PATH, JSON.stringify(trimmed));
    }
  }

  // Pulsing Continue button when in overtime
  const continuePulse = useSharedValue(1);
  const continueAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: continuePulse.value }],
  }));
  const isOvertime = paused && currentRestDuration > 0 && currentRestSecs >= currentRestDuration;
  useEffect(() => {
    if (!weekPlanLoaded) return;
    FileSystem.writeAsStringAsync(WEEK_PLAN_PATH, JSON.stringify({ week: currentWeek, plan: weekPlan })).catch(() => {});
  }, [weekPlan, weekPlanLoaded]);

  useEffect(() => {
    if (isOvertime) {
      continuePulse.set(withRepeat(
        withSequence(withTiming(1.04, { duration: 500 }), withTiming(1, { duration: 500 })),
        -1,
        false
      ));
    } else {
      continuePulse.set(withTiming(1, { duration: 150 }));
    }
  }, [isOvertime]);

  function logRestDay(day: number) {
    const entry: HistoryEntry = {
      id: nowMs().toString(),
      date: new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
      workoutName: SPLIT[day],
      duration: 0,
      restTime: 0,
      exercises: [],
      isRestDay: true,
    };
    const updated = [entry, ...history];
    setHistory(updated);
    FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(updated));
  }

  function undoRestDay(day: number) {
    const ids = new Set(
      thisWeekHistory.filter(h => h.isRestDay && WORKOUT_TO_DAY[h.workoutName] === day).map(h => h.id)
    );
    const updated = history.filter(h => !ids.has(h.id));
    setHistory(updated);
    FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(updated));
  }

  function startWorkout() {
    if (selectedDay === null) return;
    const plan = weekPlan[selectedDay] ?? [];
    setSeconds(0);
    setTotalSessionSecs(0);
    setRestSeconds(0);
    setPaused(false);
    activeAccRef.current = 0;
    activeStartRef.current = Date.now();
    sessionStartRef.current = Date.now();
    restAccRef.current = 0;
    const wName = SPLIT[selectedDay];
    setExercises(plan.map(e => ({ ...e, sets: initSetsFromHistory(e.name, wName, history, activeGym, e.target) })));
    setScreen('active');
    workoutInterval.current = setInterval(() => {
      setSeconds(activeAccRef.current + Math.round((Date.now() - activeStartRef.current) / 1000));
    }, 1000);
    totalInterval.current = setInterval(() => {
      setTotalSessionSecs(Math.round((Date.now() - sessionStartRef.current) / 1000));
    }, 1000);
  }

  function cancelRestNotifications() {
    if (notifId60.current) { Notifications.cancelScheduledNotificationAsync(notifId60.current); notifId60.current = null; }
    if (notifId30.current) { Notifications.cancelScheduledNotificationAsync(notifId30.current); notifId30.current = null; }
    if (notifId10.current) { Notifications.cancelScheduledNotificationAsync(notifId10.current); notifId10.current = null; }
  }

  function resumeFromRest() {
    if (autoResumeTimer.current) clearTimeout(autoResumeTimer.current);
    if (hapticTimer.current) clearTimeout(hapticTimer.current);
    cancelRestNotifications();
    restAccRef.current += Math.round((Date.now() - restStartRef.current) / 1000);
    if (restInterval.current) clearInterval(restInterval.current);
    setCurrentRestSecs(0);
    setCurrentRestDuration(0);
    activeStartRef.current = Date.now();
    workoutInterval.current = setInterval(() => {
      setSeconds(activeAccRef.current + Math.round((Date.now() - activeStartRef.current) / 1000));
    }, 1000);
    setPaused(false);
  }

  function toggleRest() {
    if (!paused) {
      // Manual rest — no auto-resume, no countdown
      if (autoResumeTimer.current) clearTimeout(autoResumeTimer.current);
      if (hapticTimer.current) clearTimeout(hapticTimer.current);
      activeAccRef.current += Math.round((Date.now() - activeStartRef.current) / 1000);
      if (workoutInterval.current) clearInterval(workoutInterval.current);
      setCurrentRestSecs(0);
      setCurrentRestDuration(0);
      restStartRef.current = Date.now();
      restInterval.current = setInterval(() => {
        const cur = Math.round((Date.now() - restStartRef.current) / 1000);
        setCurrentRestSecs(cur);
        setRestSeconds(restAccRef.current + cur);
      }, 1000);
      setPaused(true);
    } else {
      resumeFromRest();
    }
  }

  function scheduleRestNotifications(remaining: number) {
    cancelRestNotifications();
    if (remaining > 60) {
      Notifications.scheduleNotificationAsync({
        content: { title: 'REST TIMER', body: "Aight, last reel 📲  Back on deck in 60.", sound: true },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: remaining - 60 },
      }).then(id => { notifId60.current = id; });
    }
    if (remaining > 30) {
      Notifications.scheduleNotificationAsync({
        content: { title: 'REST TIMER', body: "Lock back in 🔒  30 seconds.", sound: true },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: remaining - 30 },
      }).then(id => { notifId30.current = id; });
    }
    if (remaining > 10) {
      Notifications.scheduleNotificationAsync({
        content: { title: 'REST TIMER', body: "Let's hit it 💪  10 seconds.", sound: true },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: remaining - 10 },
      }).then(id => { notifId10.current = id; });
    }
  }

  function startFreshRest(restDuration: number) {
    // Called on each ✓ — accumulates current rest, resets from 0
    if (hapticTimer.current) clearTimeout(hapticTimer.current);
    cancelRestNotifications();

    if (paused) {
      restAccRef.current += Math.round((Date.now() - restStartRef.current) / 1000);
      if (restInterval.current) clearInterval(restInterval.current);
    } else {
      activeAccRef.current += Math.round((Date.now() - activeStartRef.current) / 1000);
      if (workoutInterval.current) clearInterval(workoutInterval.current);
      setPaused(true);
    }

    setCurrentRestSecs(0);
    setCurrentRestDuration(restDuration);
    restStartRef.current = Date.now();
    restInterval.current = setInterval(() => {
      const cur = Math.round((Date.now() - restStartRef.current) / 1000);
      setCurrentRestSecs(cur);
      setRestSeconds(restAccRef.current + cur);
    }, 1000);

    // Haptic buzz 5s before end
    if (restDuration > 5) {
      hapticTimer.current = setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }, (restDuration - 5) * 1000);
    }

    // OS-level notifications — fire in background
    scheduleRestNotifications(restDuration);
    // Auto-resume if app is foregrounded when timer expires; stay in rest if backgrounded
    autoResumeTimer.current = setTimeout(() => {
      if (isAppActiveRef.current) {
        resumeFromRest();
      }
    }, restDuration * 1000);
  }

  /** Moves the end of the current rest, keeping the time already rested. */
  function retargetRest(newDuration: number) {
    if (!paused || currentRestDuration === 0 || newDuration === currentRestDuration) return;
    if (hapticTimer.current) clearTimeout(hapticTimer.current);
    if (autoResumeTimer.current) clearTimeout(autoResumeTimer.current);
    cancelRestNotifications();
    const elapsed = Math.round((Date.now() - restStartRef.current) / 1000);
    const remaining = newDuration - elapsed;
    setCurrentRestDuration(newDuration);
    if (remaining > 5) {
      hapticTimer.current = setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }, (remaining - 5) * 1000);
    }
    if (remaining > 0) {
      scheduleRestNotifications(remaining);
      autoResumeTimer.current = setTimeout(() => {
        if (isAppActiveRef.current) resumeFromRest();
      }, remaining * 1000);
    }
  }

  function extendRest(extraSecs: number) {
    retargetRest(currentRestDuration + extraSecs);
  }

  function reorderExercise(from: number, to: number) {
    setExercises(prev => {
      const arr = [...prev];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return arr;
    });
  }

  function endWorkout() {
    // Compute final times from refs to avoid stale state
    const finalActive = paused
      ? activeAccRef.current
      : activeAccRef.current + Math.round((Date.now() - activeStartRef.current) / 1000);
    const finalRest_ = paused
      ? restAccRef.current + Math.round((Date.now() - restStartRef.current) / 1000)
      : restAccRef.current;

    if (workoutInterval.current) clearInterval(workoutInterval.current);
    if (restInterval.current) clearInterval(restInterval.current);
    if (totalInterval.current) clearInterval(totalInterval.current);
    if (autoResumeTimer.current) clearTimeout(autoResumeTimer.current);
    if (hapticTimer.current) clearTimeout(hapticTimer.current);
    cancelRestNotifications();
    // Freeze each set's ticked state so sets that were never finished don't count towards volume.
    const finished = exercises.map(ex => ({ ...ex, sets: ex.sets.map(set => ({ ...set, done: set.done === true })) }));
    setExercises(finished);
    const entry: HistoryEntry = {
      id: pendingEntry?.id ?? Date.now().toString(),
      date: pendingEntry?.date ?? new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
      workoutName: selectedDay !== null ? SPLIT[selectedDay] : todayWorkout,
      duration: finalActive,
      restTime: finalRest_,
      exercises: finished,
      gym: activeGym || undefined,
    };
    setPendingEntry(entry);
    FileSystem.writeAsStringAsync(PENDING_PATH, JSON.stringify(entry));
    FileSystem.deleteAsync(ACTIVE_SESSION_PATH, { idempotent: true });
    setFinalSeconds(finalActive);
    setFinalRest(finalRest_);
    setScreen('summary');
  }

  function continueWorkout() {
    FileSystem.deleteAsync(PENDING_PATH, { idempotent: true });
    // Restore accumulators from frozen values so timer picks up seamlessly
    activeAccRef.current = finalSeconds;
    activeStartRef.current = Date.now();
    restAccRef.current = finalRest;
    setPaused(false);
    setCurrentRestSecs(0);
    setCurrentRestDuration(0);
    workoutInterval.current = setInterval(() => {
      setSeconds(activeAccRef.current + Math.round((Date.now() - activeStartRef.current) / 1000));
    }, 1000);
    totalInterval.current = setInterval(() => {
      setTotalSessionSecs(Math.round((Date.now() - sessionStartRef.current) / 1000));
    }, 1000);
    setScreen('active');
  }

  function resetClock() {
    Alert.alert('Reset clock?', 'Resets session time to 0. Set data is kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset', style: 'destructive', onPress: () => {
          if (autoResumeTimer.current) clearTimeout(autoResumeTimer.current);
          if (hapticTimer.current) clearTimeout(hapticTimer.current);
          if (restInterval.current) clearInterval(restInterval.current);
          if (workoutInterval.current) clearInterval(workoutInterval.current);
          if (totalInterval.current) clearInterval(totalInterval.current);
          cancelRestNotifications();
          const now = Date.now();
          sessionStartRef.current = now;
          activeStartRef.current = now;
          activeAccRef.current = 0;
          restAccRef.current = 0;
          setSeconds(0);
          setTotalSessionSecs(0);
          setRestSeconds(0);
          setCurrentRestSecs(0);
          setCurrentRestDuration(0);
          setPaused(false);
          workoutInterval.current = setInterval(() => {
            setSeconds(Math.round((Date.now() - activeStartRef.current) / 1000));
          }, 1000);
          totalInterval.current = setInterval(() => {
            setTotalSessionSecs(Math.round((Date.now() - sessionStartRef.current) / 1000));
          }, 1000);
        },
      },
    ]);
  }

  function navigateHome() {
    FileSystem.deleteAsync(ACTIVE_SESSION_PATH, { idempotent: true });
    setSeconds(0);
    setTotalSessionSecs(0);
    setRestSeconds(0);
    setCurrentRestSecs(0);
    setCurrentRestDuration(0);
    setPaused(false);
    activeAccRef.current = 0;
    restAccRef.current = 0;
    if (totalInterval.current) clearInterval(totalInterval.current);
    if (autoResumeTimer.current) clearTimeout(autoResumeTimer.current);
    if (hapticTimer.current) clearTimeout(hapticTimer.current);
    cancelRestNotifications();
    setSelectedDay(null);
    setScreen('home');
  }

  function reset() {
    FileSystem.deleteAsync(PENDING_PATH, { idempotent: true });
    FileSystem.deleteAsync(ACTIVE_SESSION_PATH, { idempotent: true });
    let updatedHistory = history;
    if (pendingEntry) {
      updatedHistory = [pendingEntry, ...history];
      setHistory(updatedHistory);
      FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(updatedHistory));
      setPendingEntry(null);
    }
    const newly = checkNewBadges(updatedHistory, unlockedBadges);
    if (newly.length > 0) {
      const now = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      const updated = [...unlockedBadges, ...newly.map(b => ({ id: b.id, unlockedAt: now }))];
      setUnlockedBadges(updated);
      FileSystem.writeAsStringAsync(BADGES_PATH, JSON.stringify(updated));
      setNewBadgeQueue(newly); // overlay handles navigation
    } else {
      navigateHome();
    }
  }

  useEffect(() => {
    return () => {
      if (workoutInterval.current) clearInterval(workoutInterval.current);
      if (restInterval.current) clearInterval(restInterval.current);
      if (totalInterval.current) clearInterval(totalInterval.current);
      if (autoResumeTimer.current) clearTimeout(autoResumeTimer.current);
      if (hapticTimer.current) clearTimeout(hapticTimer.current);
      cancelRestNotifications();
    };
  }, []);

  // ── AppState: sync rest timer if iOS suspended JS while backgrounded ──
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextAppState) => {
      isAppActiveRef.current = (nextAppState === 'active');
      if (nextAppState !== 'active') return;
      if (screen === 'active' && paused && currentRestDuration > 0) {
        // Sync elapsed time — restInterval may have been paused by iOS
        const elapsed = Math.round((Date.now() - restStartRef.current) / 1000);
        setCurrentRestSecs(elapsed);
        setRestSeconds(restAccRef.current + elapsed);
        // If rest expired while backgrounded, auto-resume now
        if (elapsed >= currentRestDuration) {
          if (autoResumeTimer.current) clearTimeout(autoResumeTimer.current);
          resumeFromRest();
        } else {
          // Reschedule auto-resume using wall-clock remaining time —
          // the original setTimeout was suspended by iOS and is now stale
          if (autoResumeTimer.current) clearTimeout(autoResumeTimer.current);
          const remaining = currentRestDuration - elapsed;
          autoResumeTimer.current = setTimeout(() => {
            if (isAppActiveRef.current) resumeFromRest();
          }, remaining * 1000);
        }
      }
    });
    return () => sub.remove();
  }, [screen, paused, currentRestDuration]);

  // ── Active session persistence: survive Expo Go reloads mid-session ──
  useEffect(() => {
    if (screen !== 'active') return;
    FileSystem.writeAsStringAsync(ACTIVE_SESSION_PATH, JSON.stringify({
      exercises,
      sessionStartEpoch: sessionStartRef.current,
      activeAcc: paused ? activeAccRef.current : activeAccRef.current + Math.round((Date.now() - activeStartRef.current) / 1000),
      restAcc: restAccRef.current,
      bodyweight,
      paused,
      selectedDay,
    })).catch(() => {});
  }, [exercises, screen]);

  useEffect(() => {
    Notifications.requestPermissionsAsync();
  }, []);

  useEffect(() => {
    (async () => {
      // Load program epoch first — drives week number for all subsequent logic
      let effectEpoch = PROGRAM_EPOCH;
      const epochInfo = await FileSystem.getInfoAsync(EPOCH_PATH);
      if (epochInfo.exists) {
        const raw = await FileSystem.readAsStringAsync(EPOCH_PATH);
        const saved = JSON.parse(raw);
        if (typeof saved === 'number' && saved > 0) {
          effectEpoch = saved;
          setProgramEpoch(saved);
        }
      }
      const effectWeek = Math.max(1, Math.floor((Date.now() - effectEpoch) / (7 * 24 * 60 * 60 * 1000)) + 1);

      const info = await FileSystem.getInfoAsync(HISTORY_PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(HISTORY_PATH);
        const loaded = JSON.parse(raw);
        const cleaned = loaded.filter((e: HistoryEntry) => !e.id.startsWith('seed-'));
        const existingIds = new Set(cleaned.map((e: HistoryEntry) => e.id));
        const missing = RESTORED_SESSIONS.filter(r => !existingIds.has(r.id));
        const final = missing.length > 0 ? [...cleaned, ...missing] : cleaned;
        if (final.length !== loaded.length) {
          await FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(final));
        }
        // Retroactively tag sessions with gym based on known date ranges
        const { updated: migratedHistory, changed: gymChanged } = applyGymTags(final);
        if (gymChanged) {
          await FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(migratedHistory));
        }

        // One-time patch: fix Leg A / Fri, 26 Jun 2026 sets from notes (targets were logged instead of actuals)
        const legAPatchDate = 'Fri, 26 Jun 2026';
        const legAPatchFixes: Record<string, { weight: string; reps: string; rpe?: string }[]> = {
          'Hack Squat':           [{ weight: '70', reps: '8', rpe: '8' }, { weight: '80', reps: '8', rpe: '8' }, { weight: '80', reps: '8', rpe: '8' }],
          'Hip Thrust':           [{ weight: '120', reps: '8', rpe: '8' }, { weight: '120', reps: '8', rpe: '8' }, { weight: '120', reps: '8', rpe: '8' }],
          'Cable Pull-Through':   [{ weight: '68', reps: '8', rpe: '8' }, { weight: '68', reps: '8', rpe: '8' }, { weight: '68', reps: '8', rpe: '8' }],
          'Seated Leg Curl':      [{ weight: '75', reps: '8', rpe: '8' }, { weight: '75', reps: '8', rpe: '8' }, { weight: '75', reps: '8', rpe: '8' }],
          'Hack Squat Calf Raise':[{ weight: '40', reps: '16', rpe: '8' }, { weight: '40', reps: '16', rpe: '8' }, { weight: '40', reps: '16', rpe: '8' }],
          'Total Ab Machine':     [{ weight: '68', reps: '12', rpe: '8' }, { weight: '68', reps: '12', rpe: '8' }, { weight: '68', reps: '12', rpe: '8' }],
        };
        const legAIdx = migratedHistory.findIndex(h => h.workoutName === 'Leg A' && h.date === legAPatchDate);
        let patchedHistory = migratedHistory;
        if (legAIdx !== -1) {
          const entry = migratedHistory[legAIdx];
          const needsPatch = entry.exercises.some(ex => {
            const fix = legAPatchFixes[ex.name];
            return fix && ex.sets?.[0]?.weight !== fix[0].weight;
          });
          if (needsPatch) {
            const patchedExercises = entry.exercises.map(ex => {
              const fix = legAPatchFixes[ex.name];
              if (!fix || !ex.sets) return ex;
              const patchedSets = ex.sets.map((s, i) => fix[i] ? { ...s, weight: fix[i].weight, reps: fix[i].reps, rpe: fix[i].rpe ?? s.rpe } : s);
              return { ...ex, sets: patchedSets };
            });
            patchedHistory = [...migratedHistory];
            patchedHistory[legAIdx] = { ...entry, exercises: patchedExercises };
            await FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(patchedHistory));
          }
        }

        setHistory(patchedHistory);
      } else {
        setHistory([]);
        await FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify([]));
      }
      const bwInfo = await FileSystem.getInfoAsync(BW_PATH);
      if (bwInfo.exists) {
        const raw = await FileSystem.readAsStringAsync(BW_PATH);
        setBodyweight(JSON.parse(raw));
      }
      let loadedBadges: UnlockedBadge[] = [];
      const badgesInfo = await FileSystem.getInfoAsync(BADGES_PATH);
      if (badgesInfo.exists) {
        const raw = await FileSystem.readAsStringAsync(BADGES_PATH);
        loadedBadges = JSON.parse(raw);
      }
      // Retroactive check: scan full history for any badges not yet recorded
      const finalHistory = await FileSystem.getInfoAsync(HISTORY_PATH).then(async (i) => {
        if (!i.exists) return [];
        const raw = await FileSystem.readAsStringAsync(HISTORY_PATH);
        return JSON.parse(raw).filter((e: HistoryEntry) => !e.id.startsWith('seed-')) as HistoryEntry[];
      });
      const retroBadges = checkNewBadges(finalHistory, loadedBadges);
      if (retroBadges.length > 0) {
        const now = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        loadedBadges = [...loadedBadges, ...retroBadges.map(b => ({ id: b.id, unlockedAt: now }))];
        await FileSystem.writeAsStringAsync(BADGES_PATH, JSON.stringify(loadedBadges));
      }
      setUnlockedBadges(loadedBadges);
      // Load active gym preference
      const gymsInfo = await FileSystem.getInfoAsync(GYMS_PATH);
      if (gymsInfo.exists) {
        const list = JSON.parse(await FileSystem.readAsStringAsync(GYMS_PATH));
        if (Array.isArray(list)) setSavedGyms(list.filter((g): g is string => typeof g === 'string' && !!g));
      }
      const gymInfo = await FileSystem.getInfoAsync(GYM_PATH);
      if (gymInfo.exists) {
        const raw = await FileSystem.readAsStringAsync(GYM_PATH);
        const saved = JSON.parse(raw);
        if (saved) setActiveGym(saved);
      }
      // Load persisted weekPlan for current week; derive from history if none exists
      const wpInfo = await FileSystem.getInfoAsync(WEEK_PLAN_PATH);
      if (wpInfo.exists) {
        const raw = await FileSystem.readAsStringAsync(WEEK_PLAN_PATH);
        const saved = JSON.parse(raw);
        if (saved.week === effectWeek) {
          const p = saved.plan;
          setWeekPlan({ 1: [...(p[1]??[])], 2: [...(p[2]??[])], 3: [...(p[3]??[])], 4: [...(p[4]??[])], 5: [...(p[5]??[])] });
        } else {
          setWeekPlan(deriveTargetsFromHistory(getWeekExercises(effectWeek), finalHistory));
        }
      } else {
        setWeekPlan(deriveTargetsFromHistory(getWeekExercises(effectWeek), finalHistory));
      }
      setWeekPlanLoaded(true);
      // Restore unsaved session if app was killed on the summary screen
      const pendingInfo = await FileSystem.getInfoAsync(PENDING_PATH);
      if (pendingInfo.exists) {
        const raw = await FileSystem.readAsStringAsync(PENDING_PATH);
        const saved = JSON.parse(raw) as HistoryEntry;
        setPendingEntry(saved);
        setFinalSeconds(saved.duration);
        setFinalRest(saved.restTime);
        setExercises(saved.exercises);
        setScreen('summary');
      } else {
        // Restore active session if app was killed mid-session (e.g. Expo Go logout)
        const activeInfo = await FileSystem.getInfoAsync(ACTIVE_SESSION_PATH);
        if (activeInfo.exists) {
          const raw = await FileSystem.readAsStringAsync(ACTIVE_SESSION_PATH);
          const saved = JSON.parse(raw);
          await FileSystem.deleteAsync(ACTIVE_SESSION_PATH, { idempotent: true });
          sessionStartRef.current = saved.sessionStartEpoch;
          activeAccRef.current = saved.activeAcc;
          restAccRef.current = saved.restAcc;
          activeStartRef.current = Date.now();
          setExercises(saved.exercises);
          if (saved.bodyweight) setBodyweight(saved.bodyweight);
          if (saved.selectedDay != null) setSelectedDay(saved.selectedDay);
          setSeconds(saved.activeAcc);
          setTotalSessionSecs(Math.round((Date.now() - saved.sessionStartEpoch) / 1000));
          setRestSeconds(saved.restAcc);
          setPaused(false);
          workoutInterval.current = setInterval(() => {
            setSeconds(activeAccRef.current + Math.round((Date.now() - activeStartRef.current) / 1000));
          }, 1000);
          totalInterval.current = setInterval(() => {
            setTotalSessionSecs(Math.round((Date.now() - sessionStartRef.current) / 1000));
          }, 1000);
          setScreen('active');
        }
      }
    })();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <View style={styles.root}>
      {Platform.OS === 'ios' && (
        <>
          <InputAccessoryView nativeID={NUMPAD_ID}>
            <View style={styles.numpadBar}>
              <TouchableOpacity onPress={runNumpadNext} hitSlop={8}>
                <Text style={styles.numpadBtn}>Next</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => Keyboard.dismiss()} hitSlop={8}>
                <Text style={[styles.numpadBtn, { fontWeight: '800' }]}>Done</Text>
              </TouchableOpacity>
            </View>
          </InputAccessoryView>
          <InputAccessoryView nativeID={NUMPAD_DONE_ID}>
            <View style={[styles.numpadBar, { justifyContent: 'flex-end' }]}>
              <TouchableOpacity onPress={() => Keyboard.dismiss()} hitSlop={8}>
                <Text style={[styles.numpadBtn, { fontWeight: '800' }]}>Done</Text>
              </TouchableOpacity>
            </View>
          </InputAccessoryView>
        </>
      )}
      {/* ── Home ── */}
      {screen === 'home' && (
        <View style={{ flex: 1, backgroundColor: Ink.bg }}>
          {/* ── Chrome chains — fill the screen behind the type ── */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <ChromeChains />
          </View>
          {/* Dims the chrome behind the type: a flat veil plus a ramp that deepens towards the lineup. */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(9,9,14,0.08)' }]} />
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '75%' }}>
            {Array.from({ length: 15 }, (_, i) => (
              <View key={i} style={{ flex: 1, backgroundColor: `rgba(9,9,14,${(0.03 * i).toFixed(3)})` }} />
            ))}
          </View>
          {selectedDay === null && (
            <View pointerEvents="none" style={poster.sideTag}>
              <Text style={poster.sideTagText}>WK {currentWeek} / {new Date().getFullYear()}</Text>
            </View>
          )}

          {/* ── Poster Header ── */}
          <View style={poster.header}>
            <TouchableOpacity style={poster.histBtn} onPress={() => { prevScreenRef.current = 'home'; setScreen('history'); }} accessibilityRole="button">
              <Text style={poster.histBtnText}>History</Text>
            </TouchableOpacity>

          </View>

          {/* ── Venue Picker — always visible ── */}
          <View style={[poster.venueRow, { paddingHorizontal: 24 }]}>
            <Text style={poster.venueLabel}>Venue</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {knownGyms.map(gym => (
                  <TouchableOpacity
                    key={gym}
                    style={[poster.venueChip, activeGym === gym && poster.venueChipActive]}
                    onPress={() => selectGym(gym)}
                    onLongPress={() => Alert.prompt('Rename Gym', `Rename "${gym}" to:`, (val) => { if (val) renameGym(gym, val); }, 'plain-text', gym)}
                  >
                    <Text style={[poster.venueChipText, activeGym === gym && poster.venueChipTextActive]}>
                      {shortGym(gym)}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={poster.venueChip}
                  onPress={() => Alert.prompt('New Venue', 'Enter gym name', (val) => {
                    if (val?.trim()) selectGym(val.trim());
                  })}
                >
                  <Text style={poster.venueChipText}>+ New</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>

          {/* ── Lineup ── */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={selectedDay === null ? { flexGrow: 1, justifyContent: 'flex-end', paddingBottom: 24 } : { flexGrow: 1, paddingBottom: 32 }}>
            {(() => {


              // ── No session selected: full lineup, tap to select ──
              if (selectedDay === null) {
                return (
                  <>
                    <View style={poster.supportSection}>
                      <Text style={poster.dateLine}>{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.')}</Text>
                      <Text style={poster.title}>Week {currentWeek}</Text>
                      {WEEK_DAYS.map((day, i) => {
                        const done = completedDays.includes(day);
                        const isRest = !!(done && thisWeekHistory.find(h => WORKOUT_TO_DAY[h.workoutName] === day && h.isRestDay));
                        return (
                          <ActRow
                            key={day}
                            day={day}
                            done={done}
                            isRest={isRest}
                            last={i === WEEK_DAYS.length - 1}
                            onSelect={() => setSelectedDay(day)}
                            onRest={() => logRestDay(day)}
                            onUndoRest={() => undoRestDay(day)}
                          />
                        );
                      })}
                    </View>
                    {completedDays.length === WEEK_DAYS.length && (
                      <TouchableOpacity style={[poster.coachBtn, { marginHorizontal: 24 }]} onPress={() => {
                        Share.share({ message: formatWeekForCoach(thisWeekHistory) });
                      }}>
                        <Text style={poster.coachBtnText}>Coach This Week →</Text>
                      </TouchableOpacity>
                    )}
                  </>
                );
              }

              // ── Session selected: headliner + supporting acts ──
              const headlineDay = selectedDay;
              const supportDays = WEEK_DAYS.filter(d => d !== headlineDay);
              const headlineDone = completedDays.includes(headlineDay);
              const headlineExpanded = expandedDay === headlineDay;
              const headlineEntry = history.find(h => WORKOUT_TO_DAY[h.workoutName] === headlineDay);
              const headlineExercises: (Omit<Exercise, 'sets'> & { sets?: Exercise['sets'] })[] =
                headlineDone && headlineEntry ? headlineEntry.exercises : weekPlan[headlineDay] ?? [];

              return (
                <>
                  {/* ── Headliner ── */}
                  <TouchableOpacity
                    style={poster.headlinerSlot}
                    onPress={() => setExpandedDay(headlineExpanded ? null : headlineDay)}
                    activeOpacity={0.7}
                  >
                    <Text style={poster.headlinerLabel}>Tonight</Text>
                    <View style={poster.headlinerBox}>
                      <AnimatedPosterName
                        day={headlineDay}
                        isActive={!headlineDone}
                        style={[poster.artistName, DAY_TEXT_STYLES[headlineDay], { color: headlineDone ? Ink.textFaint : Ink.text }]}
                      />
                    </View>
                    <Text style={poster.headlinerSub}>{SPLIT_LABEL[headlineDay]}</Text>
                  </TouchableOpacity>

                  {/* ── Setlist ── */}
                  {headlineExpanded && (
                    <View style={poster.cardList}>
                      {headlineExercises.map((ex, i) => {
                        const { weightGreen, repsGreen } = !headlineDone
                          ? getLastSessionColor(ex.name, SPLIT[headlineDay], ex.target, history, activeGym)
                          : { weightGreen: false, repsGreen: false };
                        return (
                          <TouchableOpacity
                            key={ex.id}
                            style={poster.lineupRow}
                            onPress={() => !headlineDone && setSwapContext({ day: headlineDay, exerciseId: ex.id })}
                            activeOpacity={headlineDone ? 1 : 0.5}
                          >
                            <Text style={poster.lineupIdx}>{String(i + 1).padStart(2, '0')}</Text>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={poster.lineupName} numberOfLines={2}>{ex.name}</Text>
                              <Text style={poster.lineupMuscle}>{ex.muscles.split(',')[0].trim()}</Text>
                              {!headlineDone && (() => {
                                const { primary: pi, secondary: si } = getPrevSessionInfo(ex.name, SPLIT[headlineDay], history, activeGym);
                                if (!pi) return null;
                                const fmtRef = (r: PrevRef) => {
                                  const label = r.crossGym && r.gym ? `↗ ${shortGym(r.gym)} · ${shortDate(r.date)}` : shortDate(r.date);
                                  return `${label}  ${r.sets.filter(s => s.weight).map(s => `${s.weight}×${s.reps}`).join(' · ')}`;
                                };
                                return (
                                  <>
                                    <Text style={poster.lineupPrevRef}>{fmtRef(pi)}</Text>
                                    {si && <Text style={poster.lineupPrevRef}>{fmtRef(si)}</Text>}
                                  </>
                                );
                              })()}
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              {headlineDone && ex.sets ? (
                                <Text style={poster.lineupSets}>
                                  {ex.sets.filter(s => s.weight && s.reps).map(s => `${s.weight}×${s.reps}`).join('  ')}
                                </Text>
                              ) : (
                                <>
                                  {(() => {
                                    const parts = ex.target.split(/\s*\+\s*dropset/i);
                                    const main = parts[0].trim();
                                    const drop = parts[1]?.trim() ?? null;
                                    const targetColor = weightGreen ? '#34C759' : repsGreen ? '#FF3B30' : undefined;
                                    return (
                                      <>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                          <TextInput
                                            value={main}
                                            onChangeText={text => setWeekPlan(prev => ({
                                              ...prev,
                                              [headlineDay]: (prev[headlineDay] ?? []).map(e =>
                                                e.id === ex.id ? { ...e, target: drop ? `${text} + dropset ${drop}` : text } : e
                                              ),
                                            }))}
                                            style={[poster.lineupWeight, targetColor ? { color: targetColor } : undefined, { minWidth: 80, textAlign: 'right' }]}
                                            returnKeyType="done"
                                            blurOnSubmit
                                          />
                                          <TouchableOpacity
                                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }}
                                            onPress={() => setWeekPlan(prev => ({
                                              ...prev,
                                              [headlineDay]: (prev[headlineDay] ?? []).filter(e => e.id !== ex.id),
                                            }))}
                                          >
                                            <Text style={poster.lineupRemove}>✕</Text>
                                          </TouchableOpacity>
                                        </View>
                                        {drop ? <Text style={poster.lineupDropset}>{drop}</Text> : null}
                                      </>
                                    );
                                  })()}
                                </>
                              )}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                      {!headlineDone && (
                        <TouchableOpacity style={poster.addExBtn} onPress={() => setSwapContext({ day: headlineDay, exerciseId: null })}>
                          <Text style={poster.addExBtnText}>+ ADD EXERCISE</Text>
                        </TouchableOpacity>
                      )}
                      {headlineDone && headlineEntry && (
                        <TouchableOpacity style={poster.coachBtn} onPress={() => Share.share({ message: formatSessionForCoach(SPLIT[headlineDay], headlineEntry.date, headlineEntry.duration, headlineEntry.restTime, headlineEntry.exercises, undefined, history, headlineEntry.gym, programEpoch) })}>
                          <Text style={poster.coachBtnText}>Coach This →</Text>
                        </TouchableOpacity>
                      )}
                      {!headlineDone && (
                        <TouchableOpacity style={poster.coachBtn} onPress={() => Share.share({ message: formatUpcomingSessionForCoach(headlineDay, weekPlan, history) })}>
                          <Text style={poster.coachBtnText}>Coach This →</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  {/* ── Supporting Acts ── */}
                  <View style={poster.supportSection}>
                    <View style={poster.supportDivider} />
                    {supportDays.map((day, i) => {
                        const done = completedDays.includes(day);
                        const isRest = !!(done && thisWeekHistory.find(h => WORKOUT_TO_DAY[h.workoutName] === day && h.isRestDay));
                        return (
                          <ActRow
                            key={day}
                            day={day}
                            done={done}
                            isRest={isRest}
                            last={i === supportDays.length - 1}
                            onSelect={() => setSelectedDay(day)}
                            onRest={() => logRestDay(day)}
                            onUndoRest={() => undoRestDay(day)}
                          />
                        );
                      })}
                  </View>
                  {completedDays.length === WEEK_DAYS.length && (
                    <TouchableOpacity style={[poster.coachBtn, { marginHorizontal: 24 }]} onPress={() => {
                      Share.share({ message: formatWeekForCoach(thisWeekHistory) });
                    }}>
                      <Text style={poster.coachBtnText}>Coach This Week →</Text>
                    </TouchableOpacity>
                  )}
                </>
              );
            })()}
          </ScrollView>

          {/* ── Swap Modal ── */}
          {swapContext !== null && (
            <TouchableOpacity style={swap.overlay} activeOpacity={1} onPress={() => { setSwapContext(null); setSwapQuery(''); }}>
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <TouchableOpacity activeOpacity={1} onPress={() => {}}>
                <View style={poster.swapSheet}>
                  <Text style={poster.swapTitle}>{swapContext.exerciseId === null ? 'ADD EXERCISE' : 'SWAP EXERCISE'}</Text>
                  <TextInput
                    style={poster.swapSearch}
                    value={swapQuery}
                    onChangeText={setSwapQuery}
                    placeholder="Search or type custom name…"
                    placeholderTextColor="#444"
                    autoCorrect={false}
                  />
                  <ScrollView style={{ maxHeight: 280 }}>
                    {swapQuery.trim() !== '' && !getSwapOptions(swapContext.exerciseId ?? '', weekPlan[swapContext.day] ?? []).some(o => o.name.toLowerCase() === swapQuery.trim().toLowerCase()) && (
                      <TouchableOpacity
                        style={poster.swapOption}
                        onPress={() => {
                          const customEx: Omit<Exercise, 'sets'> = { id: `custom_${Date.now()}`, name: swapQuery.trim(), muscles: '', type: 'Iso', target: '', cue: '' };
                          setWeekPlan(prev => ({
                            ...prev,
                            [swapContext.day]: swapContext.exerciseId === null
                              ? [...(prev[swapContext.day] ?? []), customEx]
                              : (prev[swapContext.day] ?? []).map(e => e.id === swapContext.exerciseId ? customEx : e),
                          }));
                          setSwapContext(null);
                          setSwapQuery('');
                        }}
                      >
                        <Text style={poster.swapOptName}>&quot;{swapQuery.trim()}&quot;</Text>
                        <Text style={poster.swapOptMuscles}>custom — tap to use</Text>
                      </TouchableOpacity>
                    )}
                    {getSwapOptions(swapContext.exerciseId ?? '', weekPlan[swapContext.day] ?? [])
                      .filter(o => swapQuery.trim() === '' || o.name.toLowerCase().includes(swapQuery.trim().toLowerCase()) || o.muscles.toLowerCase().includes(swapQuery.trim().toLowerCase()))
                      .map(opt => (
                        <TouchableOpacity
                          key={opt.id}
                          style={poster.swapOption}
                          onPress={() => {
                            setWeekPlan(prev => ({
                              ...prev,
                              [swapContext.day]: swapContext.exerciseId === null
                                ? [...(prev[swapContext.day] ?? []), opt]
                                : (prev[swapContext.day] ?? []).map(e => e.id === swapContext.exerciseId ? opt : e),
                            }));
                            setSwapContext(null);
                            setSwapQuery('');
                          }}
                        >
                          <Text style={poster.swapOptName}>{opt.name}</Text>
                          <Text style={poster.swapOptMuscles}>{opt.muscles}</Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                  <TouchableOpacity style={poster.swapClose} onPress={() => { setSwapContext(null); setSwapQuery(''); }}>
                    <Text style={poster.swapCloseText}>CLOSE</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
              </KeyboardAvoidingView>
            </TouchableOpacity>
          )}

          {/* ── Footer — START WORKOUT only ── */}
          {selectedDay !== null && !completedDays.includes(selectedDay) && (
            <View style={poster.footer}>
              <TouchableOpacity style={poster.startBtn} onPress={startWorkout} accessibilityRole="button">
                <Text style={poster.startBtnText}>Start workout</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* ── Active ── */}
      {screen === 'active' && (
        <View style={{ flex: 1, backgroundColor: Ink.bg }}>
          <View style={styles.timerBar}>
            <View style={styles.timerTop}>
              <TouchableOpacity onLongPress={resetClock} delayLongPress={600} activeOpacity={1} style={{ flex: 1 }}>
                <Text style={styles.timerBarTitle} numberOfLines={1}>{SPLIT_LABEL[WORKOUT_TO_DAY[todayWorkout]] ?? todayWorkout}</Text>
                <Text style={styles.timerBarTime}>{formatTime(totalSessionSecs)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={poster.histBtn} onPress={() => { prevScreenRef.current = 'active'; setScreen('history'); }}>
                <Text style={poster.histBtnText}>History</Text>
              </TouchableOpacity>
            </View>
            {paused ? (
              <View style={styles.restPanel}>
                <Text style={[styles.restBig, isOvertime && { color: '#FF9500' }]}>
                  {currentRestDuration > 0
                    ? isOvertime
                      ? `+${formatTime(currentRestSecs - currentRestDuration)}`
                      : formatTime(currentRestDuration - currentRestSecs)
                    : formatTime(currentRestSecs)}
                </Text>
                <Text style={styles.restCaption}>
                  {currentRestDuration > 0 ? (isOvertime ? 'over your rest' : 'rest left') : 'resting'}
                </Text>
                <View style={styles.restActions}>
                  {currentRestDuration > 0 && (
                    <>
                      <TouchableOpacity style={styles.extendRestBtn} onPress={() => extendRest(30)}>
                        <Text style={styles.extendRestBtnText}>+30s</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.extendRestBtn} onPress={() => extendRest(60)}>
                        <Text style={styles.extendRestBtnText}>+60s</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  <Animated.View style={[continueAnimStyle, { flex: 1.4 }]}>
                    <TouchableOpacity style={styles.continueBtn} onPress={toggleRest}>
                      <Text style={styles.continueBtnText}>Continue</Text>
                    </TouchableOpacity>
                  </Animated.View>
                </View>
              </View>
            ) : (
              <View style={styles.activeRow}>
                <Text style={styles.activeText}>Active {formatTime(seconds)}</Text>
                <TouchableOpacity style={styles.restBtn} onPress={toggleRest}>
                  <Text style={styles.restBtnText}>Rest</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {/* ── Venue row — reactive: changing gym updates all prev refs inline ── */}
          <View style={[poster.venueRow, { paddingHorizontal: 16 }]}>
            <Text style={poster.venueLabel}>Venue</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {knownGyms.map(gym => (
                  <TouchableOpacity
                    key={gym}
                    style={[poster.venueChip, activeGym === gym && poster.venueChipActive]}
                    onPress={() => selectGym(gym)}
                    onLongPress={() => Alert.prompt('Rename Gym', `Rename "${gym}" to:`, (val) => { if (val) renameGym(gym, val); }, 'plain-text', gym)}
                  >
                    <Text style={[poster.venueChipText, activeGym === gym && poster.venueChipTextActive]}>
                      {shortGym(gym)}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={poster.venueChip}
                  onPress={() => Alert.prompt('New Venue', 'Enter gym name', (val) => {
                    if (val?.trim()) selectGym(val.trim());
                  })}
                >
                  <Text style={poster.venueChipText}>+ New</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {exercises.map((ex, idx) => {
              const { primary: pi, secondary: si } = getPrevSessionInfo(ex.name, todayWorkout, history, activeGym);
              const mkLabel = (r: PrevRef) => r.crossGym && r.gym ? `↗ ${shortGym(r.gym)} · ${shortDate(r.date)}` : shortDate(r.date);
              return (
              <DraggableCard
                key={ex.id}
                exercise={ex}
                index={idx}
                total={exercises.length}
                onChange={updated =>
                  setExercises(prev => prev.map(e => (e.id === updated.id ? updated : e)))
                }
                onSwap={() => setActiveSwapId(ex.id)}
                onRemove={() => setExercises(prev => prev.filter(e => e.id !== ex.id))}
                onReorder={reorderExercise}
                onConfirmSet={(ex) => {
                  startFreshRest(getRestDuration(ex));
                }}
                onRateSet={(ex) => retargetRest(getRestDuration(ex))}
                prevSets={pi?.sets}
                prevLabel={pi ? mkLabel(pi) : undefined}
                prevSets2={si?.sets}
                prevLabel2={si ? mkLabel(si) : undefined}
              />
              );
            })}
            <TouchableOpacity style={styles.addExBtn} onPress={() => setActiveSwapId('__add__')}>
              <Text style={styles.addExBtnText}>+ Add exercise</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.endBtn} onPress={endWorkout}>
              <Text style={styles.endBtnText}>Finish workout</Text>
            </TouchableOpacity>
          </ScrollView>
          </KeyboardAvoidingView>

          {/* ── Active Swap / Add Modal ── */}
          {activeSwapId !== null && (
            <TouchableOpacity
              style={swap.overlay}
              activeOpacity={1}
              onPress={() => { setActiveSwapId(null); setSwapQuery(''); }}
            >
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <TouchableOpacity activeOpacity={1} onPress={() => {}}>
                <View style={poster.swapSheet}>
                  <Text style={poster.swapTitle}>{activeSwapId === '__add__' ? 'ADD EXERCISE' : 'SWAP EXERCISE'}</Text>
                  <TextInput
                    style={poster.swapSearch}
                    value={swapQuery}
                    onChangeText={setSwapQuery}
                    placeholder="Search or type custom name…"
                    placeholderTextColor="#444"
                    autoCorrect={false}
                  />
                  <ScrollView style={{ maxHeight: 280 }}>
                    {swapQuery.trim() !== '' && !getSwapOptions(activeSwapId === '__add__' ? '' : activeSwapId, exercises).some(o => o.name.toLowerCase() === swapQuery.trim().toLowerCase()) && (
                      <TouchableOpacity
                        style={poster.swapOption}
                        onPress={() => {
                          const customEx: Exercise = { id: `custom_${Date.now()}`, name: swapQuery.trim(), muscles: '', type: 'Iso', target: '', cue: '', sets: [{ weight: '', reps: '', rpe: '', drops: [] }] };
                          if (activeSwapId === '__add__') {
                            setExercises(prev => [...prev, customEx]);
                          } else {
                            setExercises(prev => prev.map(e => e.id === activeSwapId ? { ...customEx, sets: e.sets, startedAt: e.startedAt, endedAt: e.endedAt } : e));
                          }
                          setActiveSwapId(null);
                          setSwapQuery('');
                        }}
                      >
                        <Text style={poster.swapOptName}>&quot;{swapQuery.trim()}&quot;</Text>
                        <Text style={poster.swapOptMuscles}>custom — tap to use</Text>
                      </TouchableOpacity>
                    )}
                    {getSwapOptions(activeSwapId === '__add__' ? '' : activeSwapId, exercises)
                      .filter(o => swapQuery.trim() === '' || o.name.toLowerCase().includes(swapQuery.trim().toLowerCase()) || o.muscles.toLowerCase().includes(swapQuery.trim().toLowerCase()))
                      .map(opt => (
                        <TouchableOpacity
                          key={opt.id}
                          style={poster.swapOption}
                          onPress={() => {
                            if (activeSwapId === '__add__') {
                              setExercises(prev => [...prev, { ...opt, sets: [{ weight: '', reps: '', rpe: '', drops: [] }] }]);
                            } else {
                              setExercises(prev => prev.map(e => e.id === activeSwapId ? { ...opt, sets: e.sets, startedAt: e.startedAt, endedAt: e.endedAt } : e));
                            }
                            setActiveSwapId(null);
                            setSwapQuery('');
                          }}
                        >
                          <Text style={poster.swapOptName}>{opt.name}</Text>
                          <Text style={poster.swapOptMuscles}>{opt.muscles}</Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                  <TouchableOpacity
                    style={poster.swapClose}
                    onPress={() => { setActiveSwapId(null); setSwapQuery(''); }}
                  >
                    <Text style={poster.swapCloseText}>CLOSE</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
              </KeyboardAvoidingView>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Summary ── */}
      {screen === 'summary' && (
        <SummaryScreen
          exercises={exercises}
          finalSeconds={finalSeconds}
          finalRest={finalRest}
          bodyweight={bodyweight}
          onBodyweightChange={v => {
            setBodyweight(v);
            FileSystem.writeAsStringAsync(BW_PATH, JSON.stringify(v));
          }}
          onDone={reset}
          onCoach={() => {
            const date = pendingEntry?.date ?? new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
            Share.share({ message: formatSessionForCoach(pendingEntry?.workoutName ?? todayWorkout, date, finalSeconds, finalRest, exercises, bodyweight, history, activeGym || undefined, programEpoch) });
          }}
          onContinue={continueWorkout}
        />
      )}

      {/* ── History ── */}
      {screen === 'history' && (
        <HistoryScreen
          history={history}
          onBack={() => setScreen(prevScreenRef.current)}
          onDelete={(id) => setHistory(prev => {
            const updated = prev.filter(e => e.id !== id);
            FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(updated));
            return updated;
          })}
          onMerge={(merged, removeId) => setHistory(prev => {
            const updated = prev.map(e => e.id === merged.id ? merged : e).filter(e => e.id !== removeId);
            FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(updated));
            return updated;
          })}
          onEditEntry={(updated) => setHistory(prev => {
            const next = prev.map(e => e.id === updated.id ? updated : e);
            FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(next));
            return next;
          })}
          programEpoch={programEpoch}
        />
      )}
      {/* ── Badge Unlock Overlay ── */}
      {newBadgeQueue.length > 0 && (
        <BadgeUnlockOverlay
          badge={newBadgeQueue[0]}
          onDismiss={() => {
            const remaining = newBadgeQueue.slice(1);
            setNewBadgeQueue(remaining);
            if (remaining.length === 0) navigateHome();
          }}
        />
      )}
    </View>
    </GestureHandlerRootView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Ink.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
  title: { fontSize: 32, fontWeight: 'bold' },
  workoutName: { fontSize: 18, color: Ink.textFaint, marginBottom: 8 },
  button: { backgroundColor: '#000', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 8 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  timerBar: {
    backgroundColor: Ink.bg,
    paddingTop: 60,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Ink.line,
    gap: 12,
  },
  timerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timerBarTitle: { fontFamily: 'Unbounded_500Medium', fontSize: 13, color: Ink.textDim },
  timerBarTime: { fontFamily: 'Unbounded_700Bold', fontSize: 28, color: Ink.text, marginTop: 2, fontVariant: ['tabular-nums'] },
  activeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activeText: { fontSize: 14, color: Ink.textFaint, fontVariant: ['tabular-nums'] },
  restBtn: { borderWidth: 1, borderColor: Ink.text, paddingVertical: 10, paddingHorizontal: 28, borderRadius: 999, alignItems: 'center' },
  restBtnText: { fontSize: 14, fontWeight: '600', color: Ink.text },
  restPanel: { alignItems: 'center', backgroundColor: Ink.raised, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 14 },
  restBig: { fontFamily: 'Unbounded_700Bold', fontSize: 52, color: Ink.text, fontVariant: ['tabular-nums'] },
  restCaption: { fontSize: 13, color: Ink.textFaint, marginTop: 2 },
  restActions: { flexDirection: 'row', gap: 8, marginTop: 14, alignSelf: 'stretch' },
  extendRestBtn: { flex: 1, borderWidth: 1, borderColor: Ink.line, paddingVertical: 12, borderRadius: 999, alignItems: 'center' },
  extendRestBtnText: { fontSize: 14, fontWeight: '500', color: Ink.textDim },
  continueBtn: { backgroundColor: Ink.text, paddingVertical: 13, borderRadius: 999, alignItems: 'center' },
  continueBtnText: { fontSize: 14, fontWeight: '700', color: Ink.bg },
  numpadBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: Ink.raised, borderTopWidth: 1, borderTopColor: Ink.line },
  numpadBtn: { fontSize: 17, fontWeight: '600', color: Ink.text },
  endBtn: { backgroundColor: Ink.text, paddingVertical: 16, borderRadius: 999, alignSelf: 'stretch', alignItems: 'center', marginTop: 8 },
  endBtnText: { fontSize: 15, fontWeight: '700', color: Ink.bg, textAlign: 'center' },
  addExBtn: { borderWidth: 1, borderColor: Ink.line, paddingVertical: 14, borderRadius: 999, alignSelf: 'stretch', alignItems: 'center', marginBottom: 8 },
  addExBtnText: { fontSize: 14, color: Ink.textDim },
  list: { padding: 16, paddingBottom: 32 },
  homeHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  homeFooter: { padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee' },
  historyBtn: { paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: Ink.line, borderRadius: 4 },
  historyBtnText: { fontSize: 13, color: Ink.textFaint },
  historyHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: Ink.bg, borderBottomWidth: 1, borderBottomColor: Ink.line, flexDirection: 'row', alignItems: 'center', gap: 16 },
  historyBack: { fontSize: 16, color: Ink.textFaint },
  historyTitle: { fontFamily: 'Unbounded_700Bold', fontSize: 20, color: Ink.text },
});

const poster = StyleSheet.create({
  header: { paddingTop: 64, paddingHorizontal: 24, paddingBottom: 8, flexDirection: 'row', alignItems: 'flex-start' },
  brand: { fontSize: 10, fontWeight: '800', letterSpacing: 7, color: '#fff' },
  phase: { fontFamily: 'Unbounded_700Bold', fontSize: 22, color: Ink.text, textAlign: 'right' },
  dateLine: { fontFamily: 'Unbounded_500Medium', fontSize: 13, color: Ink.text, marginTop: 20, ...Legible },
  title: { fontFamily: 'Unbounded_700Bold', fontSize: 44, color: Ink.text, textTransform: 'uppercase', marginTop: 2, marginBottom: 16, ...Legible },
  sideTag: { position: 'absolute', left: 0, bottom: 150, width: 16, height: 150, alignItems: 'center', justifyContent: 'center' },
  sideTagText: { width: 150, textAlign: 'center', fontFamily: 'Unbounded_500Medium', fontSize: 11, color: Ink.text, transform: [{ rotate: '-90deg' }], ...Legible },
  histBtn: { minHeight: 36, paddingHorizontal: 22, justifyContent: 'center', borderWidth: 1, borderColor: Ink.text, borderRadius: 18, backgroundColor: 'rgba(9,9,14,0.7)' },
  histBtnText: { fontSize: 14, fontWeight: '600', color: Ink.text, ...Legible },
  slot: { paddingVertical: 20, paddingHorizontal: 24, alignItems: 'center' },
  artistName: { textAlign: 'center' },
  todayTag: { fontSize: 12, marginTop: 8, color: Ink.textFaint },
  cardList: { paddingHorizontal: 20, paddingBottom: 4, paddingTop: 4 },
  lineupRow: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Ink.textFaint, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  lineupDropset: { fontSize: 12, color: Ink.textDim, fontVariant: ['tabular-nums'], marginTop: 3, textAlign: 'right', ...Legible },
  lineupIdx: { fontSize: 12, color: Ink.textDim, fontVariant: ['tabular-nums'], width: 24, ...Legible },
  lineupName: { fontSize: 16, fontWeight: '700', color: Ink.text, letterSpacing: 0.3, ...Legible },
  lineupMuscle: { fontSize: 13, color: Ink.textDim, marginTop: 4, textTransform: 'capitalize', ...Legible },
  lineupWeight: { fontSize: 15, fontWeight: '600', color: Ink.textDim, fontVariant: ['tabular-nums'], ...Legible },
  lineupSets: { fontSize: 13, color: Ink.textDim, fontVariant: ['tabular-nums'], ...Legible },
  lineupRemove: { fontSize: 12, color: Ink.textFaint, marginTop: 6 },
  lineupPrevRef: { fontSize: 12, color: Ink.textDim, marginTop: 4, fontVariant: ['tabular-nums'], ...Legible },
  darkCard: { backgroundColor: Ink.raised, borderRadius: 10, padding: 14, marginBottom: 8, borderLeftWidth: 3 },
  cardName: { fontSize: 15, fontWeight: '600', color: Ink.text, flex: 1 },
  cardBadge: { fontSize: 12, color: Ink.textFaint },
  cardMuscles: { fontSize: 12, color: Ink.textFaint, marginTop: 4 },
  cardTarget: { fontSize: 13, color: Ink.textDim, marginTop: 6 },
  cardCue: { fontSize: 12, color: Ink.textFaint, fontStyle: 'italic', marginTop: 4 },
  cardSets: { fontSize: 13, color: Ink.textDim, marginTop: 6 },
  coachBtn: { marginTop: 4, marginBottom: 12, minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: Ink.line, borderRadius: 12, alignItems: 'center' },
  coachBtnText: { fontSize: 15, color: Ink.text, fontWeight: '600' },
  weekCoachBtn: { margin: 16, minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: Ink.textDim, borderRadius: 12, alignItems: 'center' },
  weekCoachBtnText: { fontSize: 15, color: Ink.text, fontWeight: '700' },
  swapSheet: { backgroundColor: Ink.raised, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderTopWidth: 1, borderColor: Ink.line },
  swapTitle: { fontSize: 18, fontWeight: '700', color: Ink.text, marginBottom: 12 },
  swapSearch: { backgroundColor: Ink.bg, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, fontSize: 16, color: Ink.text, marginBottom: 12 },
  swapOption: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Ink.line },
  swapOptName: { fontSize: 16, fontWeight: '500', color: Ink.text },
  swapOptMuscles: { fontSize: 12, color: Ink.textFaint, marginTop: 2, textTransform: 'capitalize' },
  swapEmpty: { fontSize: 14, color: Ink.textFaint, paddingVertical: 16 },
  swapClose: { marginTop: 16, minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: Ink.line, borderRadius: 12, alignItems: 'center' },
  swapCloseText: { fontSize: 15, fontWeight: '600', color: Ink.textDim },
  footer: { padding: 16, paddingBottom: 32 },
  venueRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, marginBottom: 6 },
  venueLabel: { fontSize: 13, color: Ink.textDim, ...Legible },
  venueChip: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderColor: Ink.textFaint, borderRadius: 18, backgroundColor: 'rgba(9,9,14,0.7)' },
  venueChipActive: { backgroundColor: Ink.text, borderColor: Ink.text },
  venueChipText: { fontSize: 13, fontWeight: '600', color: Ink.text },
  venueChipTextActive: { color: Ink.bg },
  startBtn: { minHeight: 56, justifyContent: 'center', alignItems: 'center', borderRadius: 14, backgroundColor: Ink.text },
  startBtnText: { color: Ink.bg, fontSize: 17, fontWeight: '800' },
  cardRemove: { position: 'absolute', top: 8, right: 8, padding: 6 },
  cardRemoveText: { fontSize: 13, color: Ink.textFaint },
  addExBtn: { marginTop: 4, marginBottom: 12, minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: Ink.line, borderRadius: 12, alignItems: 'center' },
  addExBtnText: { fontSize: 15, color: Ink.textDim, fontWeight: '600' },
  // Headliner slot
  headlinerSlot: { paddingVertical: 32, paddingHorizontal: 24, alignItems: 'center' },
  headlinerLabel: { fontSize: 13, color: Ink.textDim, marginBottom: 16, ...Legible },
  headlinerBox: { alignItems: 'center', marginBottom: 12 },
  headlinerSub: { fontSize: 14, color: Ink.textDim, marginTop: 8, ...Legible },
  // Supporting acts
  supportSection: { paddingHorizontal: 24, paddingBottom: 24 },
  supportDivider: { height: 1, backgroundColor: Ink.textFaint, marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: Ink.textFaint, marginTop: 20, marginBottom: 12 },
  supportRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 14 },
  supportDay: { fontSize: 8, color: Ink.textFaint, width: 28 },
  supportName: { fontSize: 11, fontWeight: '700', color: Ink.textDim, flex: 1 },
  supportDone: { fontSize: 10, color: Ink.textFaint },
});

const swap = StyleSheet.create({
  btn: { marginTop: 10, alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 14, borderWidth: 1, borderColor: '#ddd', borderRadius: 6 },
  btnText: { fontSize: 12, color: Ink.textDim },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 24, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '600' },
  sheetSub: { fontSize: 14, color: Ink.textDim, lineHeight: 20 },
  closeBtn: { marginTop: 8, paddingVertical: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, alignItems: 'center' },
  closeBtnText: { fontSize: 15, color: Ink.textFaint },
  option: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  optionName: { fontSize: 15, fontWeight: '500', color: Ink.textFaint },
  optionMuscles: { fontSize: 12, color: Ink.textDim, marginTop: 2 },
});

