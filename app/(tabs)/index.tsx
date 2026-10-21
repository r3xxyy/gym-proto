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
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Swipeable, GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActRow } from '@/components/act-row';
import { ChromeChains } from '@/components/chrome-chains';
import { Ink, Legible } from '@/constants/theme';
import { estimateNetKcal, sessionVolume } from '@/lib/session-stats';
import type { Drop, Exercise, HistoryEntry, UnlockedBadge } from '../../types';
import { ALL_BADGES, checkNewBadges } from '../../constants/badges';
import type { BadgeDefinition } from '../../constants/badges';
import { PROGRAM_EPOCH, getCurrentProgramWeek, getCurrentWeekBounds, PUSH_EXERCISES, LEG_A_EXERCISES, PULL_EXERCISES, SHOULDER_EXERCISES, LEG_B_EXERCISES, SWAP_POOL, W1_DAY_EXERCISES, W2_DAY_EXERCISES, W3_DAY_EXERCISES, W4_DAY_EXERCISES, getWeekExercises, SPLIT, SPLIT_LABEL, WORKOUT_ORDER, WEEK_DAYS, POSTER_NAMES, DAY_TEXT_STYLES, BOXED_DAYS } from '../../constants/programs';

// Wall-clock read for event handlers; kept out of component bodies so the compiler sees them as impure-free.
const nowMs = () => Date.now();

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


// ─── Rest duration by movement tier ───────────────────────────────────────────
// Three-point lookup: [floor, mid, ceil] driven by RPE band
//   RPE ≤7 → floor  |  RPE 8 → mid  |  RPE 9+ → ceil  |  blank → mid
//
// Tier            floor   mid     ceil
// Leg compound    3:30    4:00    4:30   (hack squat, leg press, BSS, hip thrust, RDL)
// Push compound   3:00    3:45    4:00   (chest pressing)
// Pull compound   2:30    3:00    3:30   (rows, pulldowns, pull-ups)
// Shoulder press  2:30    3:15    3:30   (Anterior Delt compound)
// Arm iso         1:45    2:15    2:30   (curls + tris)
// Standard iso    75s     90s     2:00   (pec deck, leg curl, pull-through, calves, delts…)
// Core            75s     90s     2:00   (cable crunch, ab work)

const LEG_COMPOUND_MUSCLES = new Set(['quads', 'glutes', 'glute maximus', 'hamstrings']);
const PUSH_MUSCLES         = new Set(['mid chest', 'upper chest', 'lower chest', 'chest']);
const ARM_MUSCLES          = new Set(['biceps', 'biceps long head', 'biceps short head', 'brachialis', 'triceps']);
const CORE_MUSCLES         = new Set(['abs', 'obliques']);

// [floor, mid, ceil] in seconds
const REST_TIERS = {
  leg:      [210, 240, 270] as const,
  push:     [180, 225, 240] as const,
  pull:     [150, 180, 210] as const,
  shoulder: [150, 195, 210] as const,
  arm:      [105, 135, 150] as const,
  iso:      [ 75,  90, 120] as const,
  core:     [ 75,  90, 120] as const,
};

function getRestDuration(exercise: Exercise): number {
  const lastSet = exercise.sets[exercise.sets.length - 1];
  const rpe = parseFloat(lastSet?.rpe ?? '');

  // band: 0 = floor (RPE ≤7), 1 = mid (RPE 8 / unlogged), 2 = ceil (RPE 9+)
  let band: 0 | 1 | 2 = 1;
  if (!isNaN(rpe)) {
    if (rpe <= 7) band = 0;
    else if (rpe <= 8) band = 1;
    else band = 2;
  }

  const name    = exercise.name.toLowerCase();
  const primary = exercise.muscles.split(',')[0].trim().toLowerCase();

  let tier: keyof typeof REST_TIERS;

  if (CORE_MUSCLES.has(primary)) {
    tier = 'core';
  } else if (exercise.type === 'Iso') {
    tier = ARM_MUSCLES.has(primary) ? 'arm' : 'iso';
  } else {
    // Compounds
    if (primary === 'anterior delt')                                                  tier = 'shoulder';
    else if (LEG_COMPOUND_MUSCLES.has(primary) && !name.includes('pull-through'))    tier = 'leg';
    else if (PUSH_MUSCLES.has(primary))                                               tier = 'push';
    else                                                                              tier = 'pull';
  }

  return REST_TIERS[tier][band];
}

// Parse "Tue, 14 Apr 2026" → timestamp. Strips weekday prefix before calling Date.parse.
// Parses a target string like "40 kg × 8 × 3" into pre-filled sets.
// Handles: "40 kg × 8 × 3", "40 kg × 6–8 × 3", "× 8 × 3", fallback = 1 empty set.
function parseTargetForSets(target: string): Array<{ weight: string; reps: string; rpe: string; drops: Drop[] }> {
  // Weight + reps + set count: "40 kg × 8 × 3" or "40 kg × 6–8 × 3"
  const withWeight = target.match(/^(\d+\.?\d*)\s*kg\s*[×xX]\s*([\d–\-]+)\s*[×xX]\s*(\d+)/i);
  if (withWeight) {
    const weight = withWeight[1];
    const reps   = withWeight[2];
    const count  = parseInt(withWeight[3], 10);
    return Array.from({ length: Math.max(1, count) }, () => ({ weight, reps, rpe: '', drops: [] }));
  }
  // Reps + set count only: "× 8 × 3"
  const noWeight = target.match(/[×xX]\s*([\d–\-]+)\s*[×xX]\s*(\d+)/i);
  if (noWeight) {
    const reps  = noWeight[1];
    const count = parseInt(noWeight[2], 10);
    return Array.from({ length: Math.max(1, count) }, () => ({ weight: '', reps, rpe: '', drops: [] }));
  }
  return [{ weight: '', reps: '', rpe: '', drops: [] }];
}

const _MONTH_IDX: Record<string, number> = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
};
function parseHistoryDate(dateStr: string): number {
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

// Returns the most recent history entry for a given workoutName.
// If gym is provided: tries same-gym first; falls back to global with crossGym=true.
// crossGym=true means the returned entry is from a different venue — suppress color signal.
function getMostRecentSession(
  workoutName: string,
  history: HistoryEntry[],
  gym?: string,
): { entry: HistoryEntry | null; crossGym: boolean } {
  const matching = history.filter(h => h.workoutName === workoutName);
  if (matching.length === 0) return { entry: null, crossGym: false };
  const best = (arr: HistoryEntry[]) =>
    arr.reduce((a, b) => parseHistoryDate(b.date) > parseHistoryDate(a.date) ? b : a);
  if (gym) {
    const sameGym = matching.filter(h => h.gym === gym);
    if (sameGym.length > 0) return { entry: best(sameGym), crossGym: false };
    return { entry: best(matching), crossGym: true };
  }
  return { entry: best(matching), crossGym: false };
}

// Returns the most recent history entry from a gym OTHER than the one specified.
function getMostRecentSessionOtherGym(
  workoutName: string,
  history: HistoryEntry[],
  excludeGym: string,
): HistoryEntry | null {
  const matching = history.filter(h => h.workoutName === workoutName && h.gym && h.gym !== excludeGym);
  if (matching.length === 0) return null;
  return matching.reduce((a, b) => parseHistoryDate(b.date) > parseHistoryDate(a.date) ? b : a);
}

function getPrevSets(exName: string, workoutName: string, history: HistoryEntry[], gym?: string): { weight: string; reps: string }[] {
  const isFree = FREE_WEIGHT_EXERCISES.has(exName);
  const { entry: prev } = getMostRecentSession(workoutName, history, isFree ? undefined : gym);
  if (!prev) return [];
  const prevEx = prev.exercises.find(e => e.name === exName);
  return prevEx?.sets.map(s => ({ weight: s.weight, reps: s.reps })) ?? [];
}

type PrevRef = { sets: { weight: string; reps: string }[]; gym?: string; date: string; crossGym: boolean };

function getPrevSessionInfo(
  exName: string,
  workoutName: string,
  history: HistoryEntry[],
  activeGym?: string,
): { primary: PrevRef | null; secondary: PrevRef | null } {
  const isFree = FREE_WEIGHT_EXERCISES.has(exName);

  // Primary: same-venue (or global for free weights)
  const { entry: p, crossGym: pCross } = getMostRecentSession(workoutName, history, isFree ? undefined : activeGym);
  const pEx = p?.exercises.find(e => e.name === exName);
  const primary: PrevRef | null = pEx?.sets.some(s => s.weight)
    ? { sets: pEx.sets.map(s => ({ weight: s.weight, reps: s.reps })), gym: p?.gym, date: p!.date, crossGym: isFree ? false : pCross }
    : null;

  // Secondary: last at a DIFFERENT venue — only for machine/cable at a known venue
  let secondary: PrevRef | null = null;
  if (!isFree && activeGym && !pCross) {
    const s = getMostRecentSessionOtherGym(workoutName, history, activeGym);
    const sEx = s?.exercises.find(e => e.name === exName);
    if (sEx?.sets.some(sv => sv.weight)) {
      secondary = { sets: sEx.sets.map(sv => ({ weight: sv.weight, reps: sv.reps })), gym: s?.gym, date: s!.date, crossGym: true };
    }
  }

  return { primary, secondary };
}

const WORKOUT_EXERCISES = W2_DAY_EXERCISES; // kept for initExercises()


function getTodayWorkout() {
  return SPLIT[new Date().getDay()];
}

function formatTime(totalSeconds: number) {
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// "Thu, 25 Jun 2026" → "25 Jun"
function shortDate(dateStr: string): string {
  const cleaned = dateStr.replace(/^[A-Za-z]+,\s*/, '').trim();
  const parts = cleaned.split(/\s+/);
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : dateStr;
}

// "Zdrofit (Spire)" → "Spire" | "AF Stratford" → "Stratford"
function shortGym(gym: string): string {
  const m = gym.match(/\(([^)]+)\)/);
  if (m) return m[1];
  const parts = gym.split(' ');
  return parts[parts.length - 1];
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

function initExercises(): Exercise[] {
  const day = new Date().getDay();
  const list = WORKOUT_EXERCISES[day] ?? [];
  return list.map(e => ({ ...e, sets: parseTargetForSets(e.target) }));
}

// ─── History Exercise Card ────────────────────────────────────────────────────

function HistoryExerciseCard({
  exercise,
  editable,
  onChange,
}: {
  exercise: Exercise;
  editable?: boolean;
  onChange?: (updated: Exercise) => void;
}) {
  // Sets that were left unticked in a live session aren't part of what happened.
  const displaySets = editable ? exercise.sets : exercise.sets.filter(s => s.done !== false && (s.weight || s.reps));
  if (!editable && displaySets.length === 0) return null;

  function updateSet(si: number, field: 'weight' | 'reps', value: string) {
    const sets = exercise.sets.map((s, i) => i === si ? { ...s, [field]: value } : s);
    onChange?.({ ...exercise, sets });
  }

  return (
    <View style={hCard.container}>
      <Text style={hCard.name}>{exercise.name}</Text>
      <Text style={hCard.muscles}>{exercise.muscles.split(',')[0].trim()}</Text>
      {displaySets.map((s, i) => (
        <View key={i} style={hCard.setBlock}>
          <View style={hCard.setRow}>
            <Text style={hCard.setNum}>{i + 1}</Text>
            {editable ? (
              <>
                <TextInput
                  style={hCard.editInput}
                  value={s.weight}
                  onChangeText={v => updateSet(i, 'weight', v)}
                  keyboardType="decimal-pad"
                  placeholder="kg"
                  placeholderTextColor={Ink.textFaint}
                  inputAccessoryViewID={NUMPAD_DONE_ID}
                />
                <Text style={hCard.sep}>×</Text>
                <TextInput
                  style={hCard.editInput}
                  value={s.reps}
                  onChangeText={v => updateSet(i, 'reps', v)}
                  keyboardType="number-pad"
                  placeholder="reps"
                  placeholderTextColor={Ink.textFaint}
                  inputAccessoryViewID={NUMPAD_DONE_ID}
                />
              </>
            ) : (
              <Text style={hCard.setValue}>{s.weight || '—'} kg × {s.reps || '—'}</Text>
            )}
            {!!s.rpe && <Text style={hCard.rpe}>RPE {s.rpe}</Text>}
          </View>
          {s.drops.map((d, j) => (
            <View key={j} style={hCard.setRow}>
              <Text style={hCard.setNum}>↳</Text>
              <Text style={hCard.setValue}>{d.weight || '—'} kg × {d.reps || '—'}</Text>
            </View>
          ))}
        </View>
      ))}
      {editable && (
        <TextInput
          style={aCard.notes}
          value={exercise.notes ?? ''}
          onChangeText={text => onChange?.({ ...exercise, notes: text })}
          placeholder="Note"
          placeholderTextColor={Ink.textFaint}
          multiline
        />
      )}
      {!editable && exercise.notes?.trim() ? (
        <Text style={hCard.note}>{exercise.notes.trim()}</Text>
      ) : null}
    </View>
  );
}

// ─── Exercise Card ────────────────────────────────────────────────────────────

const RPE_GUIDE = [
  { rpe: '6', rir: '4 RIR', label: 'Very comfortable' },
  { rpe: '7', rir: '3 RIR', label: 'Could do more' },
  { rpe: '8', rir: '2 RIR', label: 'Challenging, controlled' },
  { rpe: '9', rir: '1 RIR', label: 'One more possible' },
  { rpe: '10', rir: '0 RIR', label: 'Absolute max' },
];

const PLATE_SIZES = [20, 15, 10, 5, 2.5, 1.25];

// The number pads on iOS have no Return key, so every numeric field shares a Next / Done bar.
const NUMPAD_ID = 'numpad-bar';
const NUMPAD_DONE_ID = 'numpad-done';
let numpadNext: (() => void) | null = null;

function setDelta(currentWeight: string, prevWeight: string | undefined): 1 | -1 | 0 {
  const cur = parseFloat(currentWeight);
  const prev = parseFloat(prevWeight ?? '');
  if (!cur || !prev || cur === prev) return 0;
  return cur > prev ? 1 : -1;
}

function ExerciseCard({
  exercise,
  onChange,
  onSwap,
  onRemove,
  onConfirmSet,
  onRateSet,
  prevSets,
  prevLabel,
  prevSets2,
  prevLabel2,
}: {
  exercise: Exercise;
  onChange: (updated: Exercise) => void;
  onSwap?: () => void;
  onRemove?: () => void;
  /** Called with the exercise up to and including the set that was just ticked. */
  onConfirmSet?: (exercise: Exercise) => void;
  /** Called with the exercise up to and including a set that was just given an RPE. */
  onRateSet?: (exercise: Exercise) => void;
  prevSets?: { weight: string; reps: string }[];
  prevLabel?: string;
  prevSets2?: { weight: string; reps: string }[];
  prevLabel2?: string;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showPlates, setShowPlates] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [rateOpen, setRateOpen] = useState<number | null>(null);
  const [undo, setUndo] = useState<{ index: number; set: Exercise['sets'][number] } | null>(null);
  const [barWeight, setBarWeight] = useState('20');
  const [tareWeight, setTareWeight] = useState('0');
  const [showRpeGuide, setShowRpeGuide] = useState(false);
  // null = follow progress (collapses once every set is ticked); boolean = the user chose
  const [open, setOpen] = useState<boolean | null>(null);
  const swipeRefs = useRef<(any | null)[]>([]);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const allDone = exercise.sets.length > 0 && exercise.sets.every(s => s.done);
  const collapsed = open === null ? allDone : !open;
  const doneSummary = exercise.sets.filter(s => s.weight && s.reps).map(s => `${s.weight}×${s.reps}`).join('  ');

  // Props for each numeric field: registers it so Next can hop to the following one.
  let slot = 0;
  const field = () => {
    const i = slot++;
    return {
      ref: (r: TextInput | null) => { fieldRefs.current[i] = r; },
      onFocus: () => {
        numpadNext = () => {
          const next = fieldRefs.current[i + 1];
          if (next) next.focus(); else Keyboard.dismiss();
        };
      },
      inputAccessoryViewID: NUMPAD_ID,
      selectTextOnFocus: true,
    };
  };

  function calcPlates(totalStr: string): string {
    const total = parseFloat(totalStr) || 0;
    const bar = parseFloat(barWeight) || 0;
    const tare = parseFloat(tareWeight) || 0;
    let load = (total - bar - tare) / 2;
    if (load <= 0) return 'no plates';
    const used: string[] = [];
    for (const s of PLATE_SIZES) {
      while (load >= s - 0.001) { used.push(`${s}`); load = Math.round((load - s) * 1000) / 1000; }
    }
    return used.length ? used.join(' + ') + ' | per side' : 'no plates';
  }

  function updateSet(si: number, field: 'weight' | 'reps', value: string) {
    const sets = exercise.sets.map((s, i) => i === si ? { ...s, [field]: value } : s);
    const startedAt = field === 'weight' && !exercise.startedAt ? nowMs() : exercise.startedAt;
    onChange({ ...exercise, sets, startedAt });
  }

  function updateDrop(si: number, di: number, field: 'weight' | 'reps', value: string) {
    const sets = exercise.sets.map((s, i) =>
      i === si
        ? { ...s, drops: s.drops.map((d, j) => j === di ? { ...d, [field]: value } : d) }
        : s
    );
    onChange({ ...exercise, sets });
  }

  function addSet() {
    const last = exercise.sets[exercise.sets.length - 1];
    const newDrops = last.drops.map(d => ({ weight: d.weight, reps: d.reps }));
    onChange({ ...exercise, sets: [...exercise.sets, { weight: last.weight, reps: last.reps, rpe: '', drops: newDrops, done: false }] });
  }

  function deleteSet(si: number) {
    if (exercise.sets.length === 1) return;
    const removed = exercise.sets[si];
    onChange({ ...exercise, sets: exercise.sets.filter((_, i) => i !== si) });
    setRateOpen(null);
    setUndo({ index: si, set: removed });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 5000);
  }

  function undoDelete() {
    if (!undo) return;
    const sets = [...exercise.sets];
    sets.splice(Math.min(undo.index, sets.length), 0, undo.set);
    onChange({ ...exercise, sets });
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }

  function addDrop(si: number) {
    const sets = exercise.sets.map((s, i) =>
      i === si ? { ...s, drops: [...s.drops, { weight: '', reps: '' }] } : s
    );
    onChange({ ...exercise, sets });
  }

  function removeDrop(si: number, di: number) {
    const sets = exercise.sets.map((s, i) =>
      i === si ? { ...s, drops: s.drops.filter((_, j) => j !== di) } : s
    );
    onChange({ ...exercise, sets });
  }

  function toggleDone(si: number) {
    if (exercise.sets[si].done) {
      // tick again to take it back
      onChange({ ...exercise, sets: exercise.sets.map((s, i) => i === si ? { ...s, done: false } : s) });
      setRateOpen(null);
      return;
    }
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const sets = exercise.sets.map((s, i) => i === si ? { ...s, done: true } : s);
    onChange({ ...exercise, sets, endedAt: nowMs() });
    setRateOpen(si);
    onConfirmSet?.({ ...exercise, sets: sets.slice(0, si + 1) });
  }

  function rate(si: number, value: string) {
    const sets = exercise.sets.map((s, i) => i === si ? { ...s, rpe: s.rpe === value ? '' : value } : s);
    onChange({ ...exercise, sets });
    setRateOpen(null);
    onRateSet?.({ ...exercise, sets: sets.slice(0, si + 1) });
  }

  if (collapsed) {
    return (
      <TouchableOpacity style={aCard.collapsed} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <Text style={aCard.collapsedName} numberOfLines={1}>{exercise.name}</Text>
          {doneSummary ? <Text style={aCard.collapsedSets} numberOfLines={1}>{doneSummary}</Text> : null}
        </View>
        <Text style={aCard.collapsedTick}>✓</Text>
      </TouchableOpacity>
    );
  }

  const targetMatch = exercise.target.match(/^(\d+\.?\d*)\s*kg/);
  const prevMax = prevSets ? Math.max(...prevSets.map(s => parseFloat(s.weight) || 0)) : 0;
  const targetW = targetMatch ? parseFloat(targetMatch[1]) : 0;
  const targetDir = prevMax && targetW ? (targetW > prevMax ? '▲ ' : targetW < prevMax ? '▼ ' : '') : '';

  return (
    <View style={aCard.container}>
      <View style={aCard.header}>
        <TouchableOpacity style={{ flex: 1 }} onPress={() => setOpen(false)} activeOpacity={0.7}>
          <Text style={aCard.name}>{exercise.name}</Text>
          <Text style={aCard.muscles}>{exercise.muscles.split(',')[0].trim()}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowMenu(m => !m)} hitSlop={10} style={aCard.menuBtn}>
          <Text style={[aCard.menuBtnText, showMenu && { color: Ink.text }]}>•••</Text>
        </TouchableOpacity>
      </View>

      {showMenu && (
        <View style={aCard.menuRow}>
          {onSwap && (
            <TouchableOpacity style={aCard.menuPill} onPress={() => { setShowMenu(false); onSwap(); }}>
              <Text style={aCard.menuPillText}>Swap</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={aCard.menuPill} onPress={() => setShowPlates(p => !p)}>
            <Text style={aCard.menuPillText}>Plates</Text>
          </TouchableOpacity>
          <TouchableOpacity style={aCard.menuPill} onPress={() => setShowNotes(n => !n)}>
            <Text style={aCard.menuPillText}>Note</Text>
          </TouchableOpacity>
          {onRemove && (
            <TouchableOpacity style={aCard.menuPill} onPress={onRemove}>
              <Text style={aCard.menuPillText}>Remove</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Text style={aCard.target}>{targetDir}{exercise.target}</Text>
      {prevLabel && prevSets && prevSets.some(s => s.weight) && (
        <Text style={aCard.prevRef}>
          {prevLabel}{'  '}{prevSets.filter(s => s.weight).map(s => `${s.weight}×${s.reps}`).join(' · ')}
        </Text>
      )}
      {prevLabel2 && prevSets2 && prevSets2.some(s => s.weight) && (
        <Text style={aCard.prevRef}>
          {prevLabel2}{'  '}{prevSets2.filter(s => s.weight).map(s => `${s.weight}×${s.reps}`).join(' · ')}
        </Text>
      )}

      {showPlates && (() => {
        const displayWeight = exercise.sets.find(s => s.weight)?.weight
          ?? exercise.target.match(/^(\d+\.?\d*)/)?.[1] ?? '';
        return (
          <View style={aCard.plateCalc}>
            <View style={aCard.plateRow}>
              <Text style={aCard.plateLabel}>bar</Text>
              <TextInput
                style={aCard.plateInput}
                value={barWeight}
                onChangeText={setBarWeight}
                keyboardType="decimal-pad"
                inputAccessoryViewID={NUMPAD_ID}
                placeholder="20"
                placeholderTextColor={Ink.textFaint}
              />
              <Text style={aCard.plateLabel}>tare</Text>
              <TextInput
                style={aCard.plateInput}
                value={tareWeight}
                onChangeText={setTareWeight}
                keyboardType="decimal-pad"
                inputAccessoryViewID={NUMPAD_ID}
                placeholder="0"
                placeholderTextColor={Ink.textFaint}
              />
            </View>
            <Text style={aCard.plateResult}>
              {displayWeight ? calcPlates(displayWeight) : 'enter a weight above'}
            </Text>
          </View>
        );
      })()}

      {exercise.sets.map((set, si) => {
        const isDone = !!set.done;
        const delta = setDelta(set.weight, prevSets?.[si]?.weight);
        // A set is the top set plus any drops; the tick sits on its last line.
        const lines = [
          { weight: set.weight, reps: set.reps, setW: (v: string) => updateSet(si, 'weight', v), setR: (v: string) => updateSet(si, 'reps', v) },
          ...set.drops.map((d, di) => ({
            weight: d.weight, reps: d.reps,
            setW: (v: string) => updateDrop(si, di, 'weight', v), setR: (v: string) => updateDrop(si, di, 'reps', v),
          })),
        ];
        return (
          <Swipeable
            key={si}
            ref={r => { swipeRefs.current[si] = r; }}
            enabled={exercise.sets.length > 1}
            friction={1.6}
            rightThreshold={90}
            overshootRight={false}
            renderRightActions={() => (
              <View style={aCard.swipeDelete}><Text style={aCard.swipeDeleteText}>Delete</Text></View>
            )}
            onSwipeableOpen={() => { swipeRefs.current[si]?.close(); deleteSet(si); }}
          >
            <View style={aCard.setBlock}>
              {lines.map((ln, li) => {
                const last = li === lines.length - 1;
                return (
                  <View key={li} style={[aCard.setRow, li > 0 && { marginTop: 8 }]}>
                    <View style={aCard.setNumWrap}>
                      {li === 0 ? (
                        <Text style={[aCard.setNum, isDone && aCard.setNumConfirmed]}>
                          {si + 1}{delta === 1 ? '▲' : delta === -1 ? '▼' : ''}
                        </Text>
                      ) : (
                        <Text style={aCard.dropArrow}>↳</Text>
                      )}
                    </View>
                    <TextInput
                      style={[aCard.input, isDone && aCard.inputDone]}
                      value={ln.weight}
                      onChangeText={ln.setW}
                      keyboardType="decimal-pad"
                      placeholder="kg"
                      placeholderTextColor={Ink.textFaint}
                      {...field()}
                    />
                    <Text style={aCard.sep}>×</Text>
                    <TextInput
                      style={[aCard.input, isDone && aCard.inputDone]}
                      value={ln.reps}
                      onChangeText={ln.setR}
                      keyboardType="number-pad"
                      placeholder="reps"
                      placeholderTextColor={Ink.textFaint}
                      {...field()}
                    />
                    {last ? (
                      <TouchableOpacity
                        onPress={() => toggleDone(si)}
                        style={[aCard.confirmBtn, isDone && aCard.confirmBtnDone]}
                        accessibilityLabel={isDone ? `Set ${si + 1} done, tap to undo` : `Finish set ${si + 1}`}
                      >
                        <Text style={[aCard.confirmBtnText, isDone && aCard.confirmBtnTextDone]}>✓</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={{ width: 48 }} />
                    )}
                  </View>
                );
              })}

              {!isDone && (
                <View style={aCard.dropLinks}>
                  <TouchableOpacity onPress={() => addDrop(si)} hitSlop={8}>
                    <Text style={aCard.moreLink}>+ Drop</Text>
                  </TouchableOpacity>
                  {set.drops.length > 0 && (
                    <TouchableOpacity onPress={() => removeDrop(si, set.drops.length - 1)} hitSlop={8}>
                      <Text style={aCard.moreLink}>− Drop</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {isDone && rateOpen === si ? (
                <View style={aCard.rateRow}>
                  <Text style={aCard.moreLabel}>Effort</Text>
                  {RPE_GUIDE.map(r => (
                    <TouchableOpacity key={r.rpe} style={aCard.rateChip} onPress={() => rate(si, r.rpe)} accessibilityLabel={`RPE ${r.rpe}, ${r.label}`}>
                      <Text style={aCard.rateChipText}>{r.rpe}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity onPress={() => setShowRpeGuide(p => !p)} hitSlop={8}>
                    <Text style={[aCard.moreLink, showRpeGuide && { color: Ink.text }]}>?</Text>
                  </TouchableOpacity>
                </View>
              ) : isDone && set.rpe ? (
                <TouchableOpacity style={aCard.rateTag} onPress={() => setRateOpen(si)} hitSlop={8}>
                  <Text style={aCard.moreLink}>RPE {set.rpe}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </Swipeable>
        );
      })}

      {undo && (
        <View style={aCard.undoBar}>
          <Text style={aCard.undoText}>Set deleted</Text>
          <TouchableOpacity onPress={undoDelete} hitSlop={8}>
            <Text style={aCard.undoBtn}>Undo</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={aCard.addSet} onPress={addSet}>
        <Text style={aCard.addSetText}>+ Add set</Text>
      </TouchableOpacity>

      {showRpeGuide && (
        <View style={aCard.rpeGuide}>
          {RPE_GUIDE.map(r => (
            <View key={r.rpe} style={aCard.rpeGuideRow}>
              <Text style={aCard.rpeGuideNum}>RPE {r.rpe}</Text>
              <Text style={aCard.rpeGuideRir}>{r.rir}</Text>
              <Text style={aCard.rpeGuideDesc}>{r.label}</Text>
            </View>
          ))}
        </View>
      )}

      {(showNotes || !!exercise.notes) && (
        <TextInput
          style={aCard.notes}
          value={exercise.notes ?? ''}
          onChangeText={text => onChange({ ...exercise, notes: text })}
          placeholder="Note"
          placeholderTextColor={Ink.textFaint}
          multiline
        />
      )}
    </View>
  );
}

// ─── Draggable Exercise Card ──────────────────────────────────────────────────

function DraggableCard({
  exercise,
  index,
  total,
  onChange,
  onSwap,
  onRemove,
  onReorder,
  onConfirmSet,
  onRateSet,
  prevSets,
  prevLabel,
  prevSets2,
  prevLabel2,
}: {
  exercise: Exercise;
  index: number;
  total: number;
  onChange: (updated: Exercise) => void;
  onSwap: () => void;
  onRemove: () => void;
  onReorder: (from: number, to: number) => void;
  onConfirmSet?: (exercise: Exercise) => void;
  onRateSet?: (exercise: Exercise) => void;
  prevSets?: { weight: string; reps: string }[];
  prevLabel?: string;
  prevSets2?: { weight: string; reps: string }[];
  prevLabel2?: string;
}) {
  const translateY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const cardHeight = useSharedValue(220);

  const gesture = Gesture.Pan()
    .activateAfterLongPress(500)
    .onStart(() => {
      dragging.value = true;
    })
    .onUpdate(e => {
      translateY.value = e.translationY;
    })
    .onEnd(() => {
      const moved = Math.round(translateY.value / cardHeight.value);
      const newIndex = Math.max(0, Math.min(total - 1, index + moved));
      if (newIndex !== index) {
        runOnJS(onReorder)(index, newIndex);
      }
      translateY.value = withSpring(0);
      dragging.value = false;
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    zIndex: dragging.value ? 10 : 1,
    opacity: dragging.value ? 0.92 : 1,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={animStyle}
        onLayout={e => { cardHeight.value = e.nativeEvent.layout.height; }}
      >
        <ExerciseCard exercise={exercise} onChange={onChange} onSwap={onSwap} onRemove={onRemove} onConfirmSet={onConfirmSet} onRateSet={onRateSet} prevSets={prevSets} prevLabel={prevLabel} prevSets2={prevSets2} prevLabel2={prevLabel2} />
      </Animated.View>
    </GestureDetector>
  );
}

// ─── History Screen ───────────────────────────────────────────────────────────


function mergeEntries(a: HistoryEntry, b: HistoryEntry): HistoryEntry {
  // Merge b into a — combine sets for matching exercises, append new ones
  const exMap: Record<string, Exercise> = {};
  for (const ex of a.exercises) exMap[ex.name] = { ...ex, sets: [...ex.sets] };
  for (const ex of b.exercises) {
    if (exMap[ex.name]) {
      exMap[ex.name].sets = [...exMap[ex.name].sets, ...ex.sets];
    } else {
      exMap[ex.name] = { ...ex };
    }
  }
  return {
    id: a.id,
    date: a.date,
    workoutName: a.workoutName,
    duration: a.duration + b.duration,
    restTime: a.restTime + b.restTime,
    exercises: Object.values(exMap),
  };
}

function HistoryScreen({ history, onBack, onDelete, onMerge, onEditEntry, programEpoch = PROGRAM_EPOCH }: {
  history: HistoryEntry[];
  onBack: () => void;
  onDelete: (id: string) => void;
  onMerge: (merged: HistoryEntry, removeId: string) => void;
  onEditEntry: (updated: HistoryEntry) => void;
  programEpoch?: number;
}) {
  const [filter, setFilter] = useState<string>('All');
  const [openDates, setOpenDates] = useState<Record<string, boolean>>({});
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ id: string; exercises: Exercise[] } | null>(null);
  const swipeRefs = useRef<Record<string, any>>({});

  function toggleDate(key: string) {
    setOpenDates(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds([]);
  }

  function enterEditMode(entry: HistoryEntry) {
    setEditingId(entry.id);
    setEditDraft({ id: entry.id, exercises: entry.exercises.map(ex => ({ ...ex, sets: ex.sets.map(s => ({ ...s })) })) });
    setOpenDates(prev => ({ ...prev, [entry.id]: true })); // force the entry open
  }

  function updateEditDraftExercise(updated: Exercise) {
    setEditDraft(prev => {
      if (!prev) return prev;
      return { ...prev, exercises: prev.exercises.map(ex => ex.id === updated.id ? updated : ex) };
    });
  }

  function saveEdit(entry: HistoryEntry) {
    if (!editDraft) return;
    onEditEntry({ ...entry, exercises: editDraft.exercises });
    setEditingId(null);
    setEditDraft(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  function shareSelected() {
    const selected = history.filter(e => selectedIds.includes(e.id));
    if (selected.length === 0) return;
    const text = selected
      .map(e => formatSessionForCoach(e.workoutName, e.date, e.duration, e.restTime, e.exercises, undefined, history, e.gym, programEpoch))
      .join('\n\n══════════════════════\n\n');
    Share.share({ message: text });
  }

  function confirmDelete(entry: HistoryEntry) {
    const label = `${SPLIT_LABEL[WORKOUT_TO_DAY[entry.workoutName]] ?? entry.workoutName}, ${entry.date}`;
    Alert.alert('Delete this session?', `${label}. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel', onPress: () => swipeRefs.current[entry.id]?.close() },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(entry.id) },
    ]);
  }

  // Newest first, then grouped into program weeks.
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const sorted = [...history].sort((a, b) => {
    const d = parseHistoryDate(b.date) - parseHistoryDate(a.date);
    return d !== 0 ? d : b.id.localeCompare(a.id);
  });
  const visible = filter === 'All' ? sorted : sorted.filter(e => e.workoutName === filter && !e.isRestDay);
  const weeks: { num: number; entries: HistoryEntry[] }[] = [];
  for (const entry of visible) {
    const num = Math.floor((parseHistoryDate(entry.date) - programEpoch) / weekMs) + 1;
    const last = weeks[weeks.length - 1];
    if (last && last.num === num) last.entries.push(entry);
    else weeks.push({ num, entries: [entry] });
  }

  const dayLabel = (date: string) => {
    const ts = parseHistoryDate(date);
    return ts ? new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '') : date;
  };

  return (
    <View style={{ flex: 1, backgroundColor: Ink.bg }}>
      <View style={hist2.header}>
        <TouchableOpacity onPress={selectMode ? exitSelectMode : onBack} hitSlop={10}>
          <Text style={hist2.back}>{selectMode ? 'Cancel' : '← Back'}</Text>
        </TouchableOpacity>
        <Text style={hist2.title} numberOfLines={1}>
          {selectMode && selectedIds.length > 0 ? `${selectedIds.length} selected` : 'History'}
        </Text>
        <View style={{ flex: 1 }} />
        {selectMode && selectedIds.length > 0 ? (
          <TouchableOpacity style={hist2.pill} onPress={shareSelected}>
            <Text style={hist2.pillText}>Share</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={hist2.pill} onPress={() => { setSelectMode(v => !v); setSelectedIds([]); }}>
            <Text style={hist2.pillText}>{selectMode ? 'Done' : 'Select'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {history.length === 0 ? (
        <View style={styles.center}>
          <Text style={hist2.emptyTitle}>No workouts yet</Text>
          <Text style={hist2.emptyText}>Finish a session and it shows up here.</Text>
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={hist2.chipScroll} contentContainerStyle={hist2.chipRow}>
            {['All', ...WORKOUT_ORDER].map(name => {
              const on = filter === name;
              const day = WORKOUT_TO_DAY[name];
              return (
                <TouchableOpacity key={name} style={[hist2.chip, on && hist2.chipOn]} onPress={() => setFilter(name)}>
                  <Text style={[hist2.chipText, on && hist2.chipTextOn]}>{name === 'All' ? 'All' : SPLIT_LABEL[day] ?? name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {weeks.length === 0 && <Text style={hist2.emptyText}>No sessions for this workout yet.</Text>}
            {weeks.map(week => {
              const trained = week.entries.filter(e => !e.isRestDay);
              const volume = trained.reduce((t, e) => t + sessionVolume(e.exercises), 0);
              return (
                <View key={week.num} style={hist2.week}>
                  <View style={hist2.weekHead}>
                    <Text style={hist2.weekTitle}>{week.num >= 1 ? `Week ${week.num}` : 'Earlier'}</Text>
                    <Text style={hist2.weekMeta}>
                      {trained.length} session{trained.length === 1 ? '' : 's'}{volume > 0 ? `  ·  ${volume.toLocaleString()} kg` : ''}
                    </Text>
                  </View>

                  {week.entries.map(entry => {
                    const isEditing = editingId === entry.id;
                    const label = SPLIT_LABEL[WORKOUT_TO_DAY[entry.workoutName]] ?? entry.workoutName;
                    const sibling = !entry.isRestDay
                      ? week.entries.find(e => e.id !== entry.id && e.date === entry.date && e.workoutName === entry.workoutName)
                      : undefined;
                    return (
                      <Swipeable
                        key={entry.id}
                        ref={r => { swipeRefs.current[entry.id] = r; }}
                        overshootRight={false}
                        renderRightActions={selectMode ? undefined : () => (
                          <TouchableOpacity style={hist2.deleteBtn} onPress={() => confirmDelete(entry)}>
                            <Text style={hist2.deleteText}>Delete</Text>
                          </TouchableOpacity>
                        )}
                      >
                        <View style={hist2.session}>
                          <TouchableOpacity
                            style={hist2.sessionRow}
                            disabled={!!entry.isRestDay && !selectMode}
                            onPress={() => isEditing ? undefined : selectMode ? toggleSelect(entry.id) : toggleDate(entry.id)}
                            activeOpacity={isEditing ? 1 : 0.7}
                          >
                            {selectMode && !isEditing && (
                              <View style={[hist2.selectCircle, selectedIds.includes(entry.id) && hist2.selectCircleOn]}>
                                {selectedIds.includes(entry.id) && <Text style={hist2.selectTick}>✓</Text>}
                              </View>
                            )}
                            <View style={{ flex: 1 }}>
                              <Text style={hist2.sessionDate}>{dayLabel(entry.date)}</Text>
                              <Text style={hist2.sessionName}>
                                {entry.isRestDay ? 'Rest day' : label}{entry.gym ? `  ·  ${shortGym(entry.gym)}` : ''}
                              </Text>
                            </View>
                            {isEditing ? (
                              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                                <TouchableOpacity style={hist2.pill} onPress={() => saveEdit(entry)}>
                                  <Text style={hist2.pillText}>Save</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={hist2.pillQuiet} onPress={cancelEdit}>
                                  <Text style={hist2.pillQuietText}>Cancel</Text>
                                </TouchableOpacity>
                              </View>
                            ) : !entry.isRestDay ? (
                              <>
                                <View style={{ alignItems: 'flex-end' }}>
                                  <Text style={hist2.sessionTime}>{formatTime(entry.duration + entry.restTime)}</Text>
                                  <Text style={hist2.sessionVol}>{sessionVolume(entry.exercises).toLocaleString()} kg</Text>
                                </View>
                                {!selectMode && (
                                  <TouchableOpacity onPress={() => enterEditMode(entry)} hitSlop={10} style={hist2.editBtn} accessibilityLabel="Edit session">
                                    <Text style={hist2.editText}>Edit</Text>
                                  </TouchableOpacity>
                                )}
                              </>
                            ) : null}
                          </TouchableOpacity>

                          {openDates[entry.id] && !entry.isRestDay && (
                            <View style={hist2.cardList}>
                              {(isEditing && editDraft ? editDraft.exercises : entry.exercises).map(ex => (
                                <HistoryExerciseCard
                                  key={ex.id}
                                  exercise={ex}
                                  editable={isEditing}
                                  onChange={isEditing ? updateEditDraftExercise : undefined}
                                />
                              ))}
                              {sibling && (() => {
                                const older = entry.id < sibling.id ? entry : sibling;
                                const newer = entry.id < sibling.id ? sibling : entry;
                                return (
                                  <TouchableOpacity style={hist2.mergeBtn} onPress={() => onMerge(mergeEntries(older, newer), newer.id)}>
                                    <Text style={hist2.mergeText}>Merge with the other session that day</Text>
                                  </TouchableOpacity>
                                );
                              })()}
                            </View>
                          )}
                        </View>
                      </Swipeable>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>
        </>
      )}
    </View>
  );
}

function getSwapOptions(exerciseId: string, current: Omit<Exercise, 'sets'>[]): Omit<Exercise, 'sets'>[] {
  return SWAP_POOL.filter(s => s.id !== exerciseId && !current.some(e => e.id === s.id && e.id !== exerciseId));
}


function formatSessionForCoach(
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

function formatWeekForCoach(weekEntries: HistoryEntry[]): string {
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

function formatUpcomingSessionForCoach(
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

// ─── Main Screen ──────────────────────────────────────────────────────────────

const WORKOUT_TO_DAY: Record<string, number> = Object.fromEntries(
  Object.entries(SPLIT).map(([d, n]) => [n, Number(d)])
);

const HISTORY_PATH      = FileSystem.documentDirectory + 'history.json';
const BADGES_PATH       = FileSystem.documentDirectory + 'badges.json';
const BW_PATH           = FileSystem.documentDirectory + 'bodyweight.json';
const WEEK_PLAN_PATH    = FileSystem.documentDirectory + 'weekPlan.json';
const PENDING_PATH       = FileSystem.documentDirectory + 'pendingSession.json';
const ACTIVE_SESSION_PATH = FileSystem.documentDirectory + 'activeSession.json';
const GYM_PATH           = FileSystem.documentDirectory + 'gym.json';
const GYMS_PATH          = FileSystem.documentDirectory + 'gyms.json';
const EPOCH_PATH         = FileSystem.documentDirectory + 'epoch.json';

// Exercises where weight is venue-agnostic (dumbbells — same everywhere)
const FREE_WEIGHT_EXERCISES = new Set([
  'Flat DB Bench',
  'Incline DB Bench',
  'Hammer Curl',
  'Incline Supinated Curl',
  'Seated DB Lateral Raise',
  'CS Rear Delt Row',
]);

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

// Last-session comparison — used for target colour on home screen and active card.
function getLastSessionColor(exName: string, workoutName: string, targetStr: string, history: HistoryEntry[], activeGym?: string): { weightGreen: boolean; repsGreen: boolean } {
  const isFree = FREE_WEIGHT_EXERCISES.has(exName);
  const { entry: prev, crossGym } = getMostRecentSession(workoutName, history, isFree ? undefined : activeGym);
  // Suppress color signal on cross-venue comparisons for machine exercises
  if (!prev || crossGym) return { weightGreen: false, repsGreen: false };
  const prevEx = prev.exercises.find(e => e.name === exName);
  if (!prevEx) return { weightGreen: false, repsGreen: false };
  const prevMax = Math.max(...prevEx.sets.map(s => parseFloat(s.weight) || 0));
  if (!prevMax) return { weightGreen: false, repsGreen: false };
  const wMatch = targetStr.match(/(\d+\.?\d*)\s*kg/);
  const targetW = wMatch ? parseFloat(wMatch[1]) : 0;
  return { weightGreen: targetW > 0 && targetW > prevMax, repsGreen: false };
}

const SEED_HISTORY: HistoryEntry[] = [
  {
    id: 'seed-2',
    date: 'Tue, 14 Apr 2026',
    workoutName: 'Push Day',
    duration: 6600,
    restTime: 0,
    exercises: [
      { id: '1', name: 'Flat DB Bench Press', muscles: 'Mid Chest, Triceps', type: 'Compound', target: '40–42.5 kg × 6–8 × 3', cue: 'Scap retracted • full ROM • controlled eccentric', sets: [{ weight: '40', reps: '6', drops: [] }, { weight: '40', reps: '6', drops: [] }, { weight: '40', reps: '4', drops: [] }] },
      { id: '2', name: 'Seated Hammer Curl (DB)', muscles: 'Brachialis, Biceps', type: 'Iso', target: '20–22.5 kg × 4–6', cue: 'Neutral grip • no torso swing • peak contraction', sets: [{ weight: '20', reps: '5', drops: [{ weight: '17.5', reps: '4' }] }, { weight: '20', reps: '5', drops: [{ weight: '17.5', reps: '4' }] }] },
      { id: '3', name: 'Incline DB Bench Press', muscles: 'Upper Chest, Triceps', type: 'Compound', target: '40–42.5 kg × 4–6 × 3', cue: 'Deep stretch • eye-line press • strict tempo', sets: [{ weight: '37.5', reps: '6', drops: [] }, { weight: '37.5', reps: '6', drops: [] }, { weight: '37.5', reps: '6', drops: [] }] },
      { id: '4', name: 'Incline Supinated DB Curl', muscles: 'Biceps Long Head', type: 'Iso', target: '20–22.5 kg × 5', cue: 'Elbows pinned • full stretch • 3s eccentric', sets: [{ weight: '20', reps: '5', drops: [{ weight: '17.5', reps: '4' }] }, { weight: '20', reps: '5', drops: [{ weight: '17.5', reps: '4' }] }] },
      { id: '5', name: 'Decline Chest Press (Machine)', muscles: 'Lower Chest, Triceps', type: 'Compound', target: '55–57.5 kg × 6 × 3', cue: 'Downward press path • lower pec drive • no lockout bounce', sets: [{ weight: '45', reps: '6', drops: [] }, { weight: '45', reps: '6', drops: [] }, { weight: '45', reps: '6', drops: [] }] },
      { id: '6', name: 'Preacher Curl (Machine/DB)', muscles: 'Biceps Short Head', type: 'Iso', target: '50–55 kg × 6', cue: 'Fixed elbow • squeeze peak • slow negative', sets: [{ weight: '45', reps: '6', drops: [] }, { weight: '45', reps: '6', drops: [] }, { weight: '45', reps: '6', drops: [] }] },
      { id: '7', name: 'Pec Deck Fly', muscles: 'Chest', type: 'Iso', target: '80–85 kg × 10–12 + dropset × 2', cue: 'Full contraction • 1s hold • controlled stretch', sets: [{ weight: '79', reps: '7', drops: [] }, { weight: '79', reps: '7', drops: [] }] },
    ],
  },
  {
    id: 'seed-1',
    date: 'Mon, 13 Apr 2026',
    workoutName: 'Leg A',
    duration: 5400,
    restTime: 600,
    exercises: [
      { id: 'la1', name: 'Hack Squat / Pendulum', muscles: 'Quads, Glutes', type: 'Compound', target: '80 kg × 6–8 × 3', cue: '', sets: [{ weight: '80', reps: '8', drops: [] }, { weight: '80', reps: '8', drops: [] }, { weight: '80', reps: '8', drops: [] }] },
      { id: 'la2', name: 'Dumbbell Romanian Deadlift', muscles: 'Hamstrings, Glutes', type: 'Compound', target: '40 kg each × 8 × 3', cue: '', sets: [{ weight: '40', reps: '8', drops: [] }, { weight: '40', reps: '8', drops: [] }, { weight: '40', reps: '8', drops: [] }] },
      { id: 'la3', name: 'Cable Pull-Through', muscles: 'Glutes, Hamstrings', type: 'Compound', target: '50 kg × 10–12 × 2–3', cue: '', sets: [{ weight: '50', reps: '10', drops: [] }, { weight: '50', reps: '10', drops: [] }, { weight: '50', reps: '10', drops: [] }] },
      { id: 'la4', name: 'Hip Thrust (Machine/Barbell)', muscles: 'Glute Maximus', type: 'Compound', target: '80 kg × 8–10 × 3', cue: '', sets: [{ weight: '80', reps: '10', drops: [] }, { weight: '80', reps: '10', drops: [] }, { weight: '80', reps: '10', drops: [] }] },
      { id: 'la5', name: 'Seated Leg Curl', muscles: 'Hamstrings', type: 'Iso', target: '130–140 kg × 10–12', cue: '', sets: [{ weight: '50', reps: '10', drops: [] }, { weight: '50', reps: '10', drops: [] }, { weight: '50', reps: '10', drops: [] }] },
      { id: 'la6', name: 'Seated Calf Raise', muscles: 'Gastrocnemius', type: 'Iso', target: '15 kg × 10–12', cue: '', sets: [{ weight: '15', reps: '10', drops: [] }, { weight: '15', reps: '10', drops: [] }, { weight: '15', reps: '10', drops: [] }] },
      { id: 'la7', name: 'Cable Crunch', muscles: 'Abs', type: 'Iso', target: '65–75 kg × 12–15', cue: '', sets: [{ weight: '73', reps: '10', drops: [] }, { weight: '73', reps: '10', drops: [] }, { weight: '73', reps: '10', drops: [] }] },
    ],
  },
];

const RESTORED_SESSIONS: HistoryEntry[] = [
  {
    id: 'restored-leg-a-13apr26',
    date: 'Mon, 13 Apr 2026',
    workoutName: 'Leg A',
    duration: 5400,
    restTime: 600,
    exercises: [
      { id: 'la1', name: 'Hack Squat / Pendulum', muscles: 'Quads, Glutes', type: 'Compound', target: '80 kg × 6–8 × 3', cue: '', sets: [{ weight: '80', reps: '8', rpe: '', drops: [] }, { weight: '80', reps: '8', rpe: '', drops: [] }, { weight: '80', reps: '8', rpe: '', drops: [] }] },
      { id: 'la2', name: 'Dumbbell Romanian Deadlift', muscles: 'Hamstrings, Glutes', type: 'Compound', target: '40 kg each × 8 × 3', cue: '', sets: [{ weight: '40', reps: '8', rpe: '', drops: [] }, { weight: '40', reps: '8', rpe: '', drops: [] }, { weight: '40', reps: '8', rpe: '', drops: [] }] },
      { id: 'la3', name: 'Cable Pull-Through', muscles: 'Glutes, Hamstrings', type: 'Compound', target: '50 kg × 10–12 × 2–3', cue: '', sets: [{ weight: '50', reps: '10', rpe: '', drops: [] }, { weight: '50', reps: '10', rpe: '', drops: [] }, { weight: '50', reps: '10', rpe: '', drops: [] }] },
      { id: 'la4', name: 'Hip Thrust (Machine/Barbell)', muscles: 'Glute Maximus', type: 'Compound', target: '80 kg × 8–10 × 3', cue: '', sets: [{ weight: '80', reps: '10', rpe: '', drops: [] }, { weight: '80', reps: '10', rpe: '', drops: [] }, { weight: '80', reps: '10', rpe: '', drops: [] }] },
      { id: 'la5', name: 'Seated Leg Curl', muscles: 'Hamstrings', type: 'Iso', target: '130–140 kg × 10–12', cue: '', sets: [{ weight: '50', reps: '10', rpe: '', drops: [] }, { weight: '50', reps: '10', rpe: '', drops: [] }, { weight: '50', reps: '10', rpe: '', drops: [] }] },
      { id: 'la6', name: 'Seated Calf Raise', muscles: 'Gastrocnemius', type: 'Iso', target: '15 kg × 10–12', cue: '', sets: [{ weight: '15', reps: '10', rpe: '', drops: [] }, { weight: '15', reps: '10', rpe: '', drops: [] }, { weight: '15', reps: '10', rpe: '', drops: [] }] },
      { id: 'la7', name: 'Cable Crunch', muscles: 'Abs', type: 'Iso', target: '65–75 kg × 12–15', cue: '', sets: [{ weight: '73', reps: '10', rpe: '', drops: [] }, { weight: '73', reps: '10', rpe: '', drops: [] }, { weight: '73', reps: '10', rpe: '', drops: [] }] },
    ],
  },
  {
    id: 'restored-leg-a-18may26',
    date: 'Mon, 18 May 2026',
    workoutName: 'Leg A',
    duration: 1661,
    restTime: 5066,
    exercises: [
      { id: 'la18-1', name: 'Hack Squat', muscles: 'Quads, Glutes', type: 'Compound', target: '105 kg × 10 × 3', cue: '', sets: [{ weight: '105', reps: '10', rpe: '8.5', drops: [] }, { weight: '105', reps: '10', rpe: '8', drops: [] }, { weight: '105', reps: '10', rpe: '8', drops: [] }] },
      { id: 'la18-2', name: 'Hip Thrust (Machine)', muscles: 'Glute Maximus', type: 'Compound', target: '110 kg × 10 × 3', cue: '', sets: [{ weight: '110', reps: '10', rpe: '8', drops: [] }, { weight: '110', reps: '10', rpe: '8', drops: [] }, { weight: '110', reps: '10', rpe: '', drops: [] }] },
      { id: 'la18-3', name: 'Seated Leg Curl', muscles: 'Hamstrings', type: 'Iso', target: '79 kg × 10 × 3', cue: '', sets: [{ weight: '79', reps: '10', rpe: '8.5', drops: [] }, { weight: '79', reps: '10', rpe: '8.5', drops: [] }, { weight: '79', reps: '10', rpe: '8.5', drops: [] }] },
      { id: 'la18-4', name: 'Cable Pull-Through', muscles: 'Glutes, Hamstrings', type: 'Compound', target: '66 kg × 10 × 3', cue: '', sets: [{ weight: '66', reps: '10', rpe: '8', drops: [] }, { weight: '66', reps: '12', rpe: '8', drops: [] }, { weight: '66', reps: '12', rpe: '8', drops: [] }] },
      { id: 'la18-5', name: 'Cable Crunch', muscles: 'Abs', type: 'Iso', target: '82 kg × 12 × 3', cue: '', sets: [{ weight: '82', reps: '12', rpe: '8', drops: [] }, { weight: '82', reps: '12', rpe: '8', drops: [] }, { weight: '82', reps: '12', rpe: '8', drops: [] }] },
      { id: 'la18-6', name: 'Preacher Curl (Machine)', muscles: 'Biceps Short Head', type: 'Iso', target: '43 kg × 8 × 3 + dropset', cue: '', sets: [{ weight: '43', reps: '8', rpe: '7.5', drops: [{ weight: '34', reps: '4' }] }, { weight: '43', reps: '8', rpe: '8', drops: [{ weight: '34', reps: '4' }] }, { weight: '43', reps: '8', rpe: '8.5', drops: [{ weight: '34', reps: '4' }] }] },
      { id: 'la18-7', name: 'Machine Triceps Extension', muscles: 'Triceps', type: 'Iso', target: '45 kg × 8 × 3 + dropset', cue: '', sets: [{ weight: '45', reps: '8', rpe: '8', drops: [{ weight: '36', reps: '5' }] }, { weight: '45', reps: '8', rpe: '8', drops: [{ weight: '36', reps: '5' }] }, { weight: '45', reps: '8', rpe: '8', drops: [{ weight: '36', reps: '5' }] }] },
      { id: 'la18-8', name: 'Seated Calf Raise', muscles: 'Gastrocnemius', type: 'Iso', target: '25 kg × 12 × 3 + dropset', cue: '', notes: 'squeeze top, 3s eccentric', sets: [{ weight: '25', reps: '12', rpe: '8', drops: [{ weight: '20', reps: '8' }] }, { weight: '25', reps: '12', rpe: '8', drops: [] }, { weight: '25', reps: '12', rpe: '8', drops: [] }] },
    ],
  },
  {
    id: 'restored-push-14apr26',
    date: 'Tue, 14 Apr 2026',
    workoutName: 'Push Day',
    duration: 6600,
    restTime: 0,
    exercises: [
      { id: 'p1', name: 'Flat DB Bench Press', muscles: 'Mid Chest, Triceps', type: 'Compound', target: '40–42.5 kg × 6–8 × 3', cue: 'Scap retracted • full ROM • controlled eccentric', sets: [{ weight: '40', reps: '6', rpe: '', drops: [] }, { weight: '40', reps: '6', rpe: '', drops: [] }, { weight: '40', reps: '4', rpe: '', drops: [] }] },
      { id: 'p2', name: 'Incline DB Bench Press', muscles: 'Upper Chest, Triceps', type: 'Compound', target: '40–42.5 kg × 4–6 × 3', cue: 'Deep stretch • eye-line press • strict tempo', sets: [{ weight: '37.5', reps: '6', rpe: '', drops: [] }, { weight: '37.5', reps: '6', rpe: '', drops: [] }, { weight: '37.5', reps: '6', rpe: '', drops: [] }] },
      { id: 'p3', name: 'Decline Chest Press (Machine)', muscles: 'Lower Chest, Triceps', type: 'Compound', target: '55–57.5 kg × 6 × 3', cue: 'Downward press path • lower pec drive • no lockout bounce', sets: [{ weight: '45', reps: '6', rpe: '', drops: [] }, { weight: '45', reps: '6', rpe: '', drops: [] }, { weight: '45', reps: '6', rpe: '', drops: [] }] },
      { id: 'p4', name: 'Pec Deck Fly', muscles: 'Chest', type: 'Iso', target: '80–85 kg × 10–12 + dropset × 2', cue: 'Full contraction • 1s hold • controlled stretch', sets: [{ weight: '79', reps: '7', rpe: '', drops: [] }, { weight: '79', reps: '7', rpe: '', drops: [] }] },
      { id: 'p5', name: 'Seated Hammer Curl (DB)', muscles: 'Brachialis, Biceps', type: 'Iso', target: '20–22.5 kg × 4–6', cue: 'Neutral grip • no torso swing • peak contraction', sets: [{ weight: '20', reps: '5', rpe: '', drops: [{ weight: '17.5', reps: '4' }] }, { weight: '20', reps: '5', rpe: '', drops: [{ weight: '17.5', reps: '4' }] }] },
      { id: 'p6', name: 'Preacher Curl (Machine/DB)', muscles: 'Biceps Short Head', type: 'Iso', target: '50–55 kg × 6', cue: 'Fixed elbow • squeeze peak • slow negative', sets: [{ weight: '45', reps: '6', rpe: '', drops: [] }, { weight: '45', reps: '6', rpe: '', drops: [] }, { weight: '45', reps: '6', rpe: '', drops: [] }] },
    ],
  },
  {
    id: 'restored-leg-b-22may26',
    date: 'Fri, 22 May 2026',
    workoutName: 'Leg B',
    duration: 1582,
    restTime: 3720,
    exercises: [
      { id: 'lb1', name: 'Leg Press', muscles: 'Quads, Glutes', type: 'Compound', target: '150 kg × 10 × 3', cue: '', sets: [{ weight: '150', reps: '10', rpe: '8', drops: [] }, { weight: '150', reps: '10', rpe: '8', drops: [] }, { weight: '150', reps: '10', rpe: '8', drops: [] }] },
      { id: 'lb2', name: 'Bulgarian Split Squat (Smith)', muscles: 'Quads, Glutes', type: 'Compound', target: '75.9 kg × 8 × 3', cue: '', sets: [{ weight: '75.9', reps: '8', rpe: '8', drops: [] }, { weight: '75.9', reps: '8', rpe: '8', drops: [] }, { weight: '75.9', reps: '8', rpe: '8', drops: [] }] },
      { id: 'lb3', name: 'Lying Leg Curl', muscles: 'Hamstrings', type: 'Iso', target: '75 kg × 10 × 3', cue: '', sets: [{ weight: '45', reps: '9', rpe: '8.5', drops: [] }, { weight: '45', reps: '7', rpe: '8.5', drops: [] }, { weight: '45', reps: '7', rpe: '8.5', drops: [] }] },
      { id: 'lb5', name: 'Leg Extension', muscles: 'Quads', type: 'Iso', target: '95 kg × 10 × 3', cue: '', sets: [{ weight: '95', reps: '10', rpe: '8', drops: [] }, { weight: '95', reps: '10', rpe: '8', drops: [] }, { weight: '95', reps: '10', rpe: '8', drops: [] }] },
      { id: 'lb6', name: 'Standing Calf Raise', muscles: 'Calves', type: 'Iso', target: '25 kg × 12 × 3', cue: '', notes: '3s eccentric', sets: [{ weight: '25', reps: '12', rpe: '8', drops: [{ weight: '20', reps: '8' }] }, { weight: '25', reps: '12', rpe: '8', drops: [{ weight: '20', reps: '8' }] }, { weight: '25', reps: '12', rpe: '8', drops: [{ weight: '20', reps: '8' }] }] },
      { id: 'lb22-cc', name: "Captain's Chair Leg Raises", muscles: 'Abs', type: 'Iso', target: '2 kg × 20 × 3', cue: '', sets: [{ weight: '2', reps: '20', rpe: '8', drops: [] }, { weight: '2', reps: '20', rpe: '8', drops: [] }, { weight: '2', reps: '20', rpe: '8', drops: [] }] },
    ],
  },
];

// ─── Animated Poster Name ─────────────────────────────────────────────────────

function AnimatedPosterName({ day, isActive, style }: { day: number; isActive: boolean; style: object }) {
  const val = useSharedValue(1);
  const on = useSharedValue(isActive ? 1 : 0);

  useEffect(() => { on.value = isActive ? 1 : 0; }, [isActive]);

  useEffect(() => {
    if (day === 1) {
      // TERRA FIRMA — seismic thud: slam up, recoil, settle
      val.value = withRepeat(withSequence(
        withTiming(1, { duration: 900 }),
        withTiming(1.14, { duration: 110 }),
        withTiming(0.94, { duration: 80 }),
        withTiming(1, { duration: 180 }),
        withTiming(1, { duration: 700 })
      ), -1, false);
    } else if (day === 2) {
      // OVERRIDE — violent machine-gun shake then pause
      val.value = withRepeat(withSequence(
        withTiming(1,  { duration: 40 }), withTiming(-1, { duration: 40 }),
        withTiming(1,  { duration: 40 }), withTiming(-1, { duration: 40 }),
        withTiming(1,  { duration: 40 }), withTiming(-1, { duration: 40 }),
        withTiming(0,  { duration: 40 }),
        withTiming(0,  { duration: 1100 })
      ), -1, false);
    } else if (day === 3) {
      // UNDERTOW — slow rise + fade, like being pulled under
      val.value = withRepeat(withSequence(
        withTiming(1, { duration: 2000 }), withTiming(0, { duration: 2000 })
      ), -1, false);
    } else if (day === 4) {
      // BOULDER SHOULDER — high-voltage strobe burst
      val.value = withRepeat(withSequence(
        withTiming(1, { duration: 30 }), withTiming(0, { duration: 30 }),
        withTiming(1, { duration: 30 }), withTiming(0, { duration: 30 }),
        withTiming(1, { duration: 30 }), withTiming(0, { duration: 30 }),
        withTiming(0, { duration: 700 })
      ), -1, false);
    } else if (day === 5) {
      // AFTERMATH — nearly vanishes, drags itself back
      val.value = withRepeat(withSequence(
        withTiming(1, { duration: 2200 }), withTiming(0.05, { duration: 2800 })
      ), -1, false);
    }
  }, []);

  const animStyle = useAnimatedStyle(() => {
    if (on.value === 0) return {};
    if (day === 1) return { transform: [{ scale: val.value }] };
    if (day === 2) return { transform: [{ translateX: val.value * 18 }] };
    if (day === 3) return { transform: [{ translateY: val.value * -22 }], opacity: 0.3 + val.value * 0.7 };
    if (day === 4) return { opacity: val.value };
    if (day === 5) return { opacity: val.value };
    return {};
  });

  return <Animated.Text style={[style, animStyle]}>{POSTER_NAMES[day]}</Animated.Text>;
}

// ─── Badge Unlock Overlay ─────────────────────────────────────────────────────

function BadgeUnlockOverlay({ badge, onDismiss }: { badge: BadgeDefinition; onDismiss: () => void }) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 250 });
    scale.value = withSpring(1, { damping: 14, stiffness: 130 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  }, []);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <TouchableOpacity style={badgeOverlay.backdrop} activeOpacity={1} onPress={onDismiss}>
      <Animated.View style={[badgeOverlay.card, cardStyle]}>
        <Text style={badgeOverlay.label}>BADGE UNLOCKED</Text>
        <Text style={badgeOverlay.icon}>{badge.icon}</Text>
        <Text style={badgeOverlay.name}>{badge.name}</Text>
        <Text style={badgeOverlay.flavour}>{badge.flavour}</Text>
        <Text style={badgeOverlay.hint}>tap to continue</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const [screen, setScreen] = useState<'home' | 'active' | 'summary' | 'history'>('home');
  const prevScreenRef = useRef<'home' | 'active'>('home');
  const [seconds, setSeconds] = useState(0);
  const [totalSessionSecs, setTotalSessionSecs] = useState(0); // cumulative from start, never pauses
  const [paused, setPaused] = useState(false);
  const [restSeconds, setRestSeconds] = useState(0);       // total rest (for history)
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
              <TouchableOpacity onPress={() => numpadNext?.()} hitSlop={8}>
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
        <View style={{ flex: 1, backgroundColor: Ink.bg }}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>Workout done</Text>
          </View>
          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <View style={sum2.hero}>
              <Text style={sum2.heroLabel}>Total volume</Text>
              <Text style={sum2.heroValue}>{sessionVolume(exercises).toLocaleString()}<Text style={sum2.heroUnit}> kg</Text></Text>
            </View>

            <View style={sum2.grid}>
              <View style={sum2.cell}>
                <Text style={sum2.cellLabel}>Session</Text>
                <Text style={sum2.cellValue}>{formatTime(finalSeconds + finalRest)}</Text>
              </View>
              <View style={sum2.cell}>
                <Text style={sum2.cellLabel}>Lifting</Text>
                <Text style={sum2.cellValue}>{formatTime(finalSeconds)}</Text>
              </View>
              <View style={sum2.cell}>
                <Text style={sum2.cellLabel}>Resting</Text>
                <Text style={sum2.cellValue}>{formatTime(finalRest)}</Text>
              </View>
              <View style={sum2.cell}>
                <Text style={sum2.cellLabel}>Est. net kcal</Text>
                <Text style={sum2.cellValue}>
                  {!!bodyweight && !!finalSeconds ? estimateNetKcal(parseFloat(bodyweight), finalSeconds, finalRest) : '—'}
                </Text>
              </View>
            </View>

            <Text style={sum2.fieldLabel}>Bodyweight (kg), used for the kcal estimate</Text>
            <TextInput
              style={sum2.field}
              value={bodyweight}
              onChangeText={v => {
                setBodyweight(v);
                FileSystem.writeAsStringAsync(BW_PATH, JSON.stringify(v));
              }}
              keyboardType="decimal-pad"
              inputAccessoryViewID={NUMPAD_DONE_ID}
              placeholder="e.g. 80"
              placeholderTextColor={Ink.textFaint}
            />

            {exercises.some(ex => ex.startedAt && ex.endedAt) && (
              <>
                <Text style={[sum2.fieldLabel, { marginTop: 24 }]}>Time per exercise</Text>
                {exercises
                  .filter(ex => ex.startedAt && ex.endedAt)
                  .map(ex => (
                    <View key={ex.id} style={summ.exRow}>
                      <Text style={summ.exName}>{ex.name}</Text>
                      <Text style={summ.exTime}>
                        {formatTime(Math.round(((ex.endedAt ?? 0) - (ex.startedAt ?? 0)) / 1000))}
                      </Text>
                    </View>
                  ))}
              </>
            )}

            <TouchableOpacity style={sum2.primary} onPress={reset}>
              <Text style={sum2.primaryText}>Done</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={sum2.secondary}
              onPress={() => {
                const date = pendingEntry?.date ?? new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
                Share.share({ message: formatSessionForCoach(pendingEntry?.workoutName ?? todayWorkout, date, finalSeconds, finalRest, exercises, bodyweight, history, activeGym || undefined, programEpoch) });
              }}
            >
              <Text style={sum2.secondaryText}>Coach this session</Text>
            </TouchableOpacity>
            <TouchableOpacity style={sum2.secondary} onPress={continueWorkout}>
              <Text style={sum2.secondaryText}>Keep going</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
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

const hist2 = StyleSheet.create({
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 14 },
  back: { fontSize: 16, color: Ink.textDim },
  title: { fontFamily: 'Unbounded_700Bold', fontSize: 20, color: Ink.text },
  pill: { minHeight: 36, paddingHorizontal: 18, justifyContent: 'center', borderWidth: 1, borderColor: Ink.text, borderRadius: 18 },
  pillText: { fontSize: 14, fontWeight: '600', color: Ink.text },
  pillQuiet: { minHeight: 36, paddingHorizontal: 12, justifyContent: 'center' },
  pillQuietText: { fontSize: 14, color: Ink.textDim },
  emptyTitle: { fontFamily: 'Unbounded_700Bold', fontSize: 20, color: Ink.text, textAlign: 'center' },
  emptyText: { fontSize: 15, color: Ink.textDim, textAlign: 'center', marginTop: 8 },
  chipScroll: { flexGrow: 0, flexShrink: 0, height: 54 },
  chipRow: { paddingHorizontal: 16, paddingVertical: 9, gap: 8, alignItems: 'center' },
  chip: { minHeight: 36, paddingHorizontal: 16, justifyContent: 'center', borderWidth: 1, borderColor: Ink.line, borderRadius: 18 },
  chipOn: { backgroundColor: Ink.text, borderColor: Ink.text },
  chipText: { fontSize: 14, fontWeight: '600', color: Ink.textDim },
  chipTextOn: { color: Ink.bg },
  week: { marginTop: 20 },
  weekHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, paddingHorizontal: 4 },
  weekTitle: { fontFamily: 'Unbounded_700Bold', fontSize: 17, color: Ink.text },
  weekMeta: { fontSize: 13, color: Ink.textDim, fontVariant: ['tabular-nums'] },
  session: { backgroundColor: Ink.raised, borderRadius: 14, marginBottom: 8, overflow: 'hidden' },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 64 },
  sessionDate: { fontSize: 13, color: Ink.textDim },
  sessionName: { fontFamily: 'Unbounded_500Medium', fontSize: 15, color: Ink.text, marginTop: 3 },
  sessionTime: { fontSize: 14, color: Ink.text, fontVariant: ['tabular-nums'] },
  sessionVol: { fontSize: 13, color: Ink.textFaint, marginTop: 2, fontVariant: ['tabular-nums'] },
  editBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  editText: { fontSize: 14, color: Ink.textDim },
  deleteBtn: { backgroundColor: Ink.line, justifyContent: 'center', alignItems: 'center', width: 88, borderRadius: 14, marginBottom: 8, marginLeft: 8 },
  deleteText: { color: Ink.text, fontWeight: '700', fontSize: 14 },
  selectCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: Ink.textFaint, alignItems: 'center', justifyContent: 'center' },
  selectCircleOn: { backgroundColor: Ink.text, borderColor: Ink.text },
  selectTick: { color: Ink.bg, fontSize: 13, fontWeight: '800' },
  cardList: { backgroundColor: Ink.bg, padding: 10, gap: 8 },
  mergeBtn: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: Ink.line, borderRadius: 22, alignItems: 'center' },
  mergeText: { fontSize: 14, color: Ink.textDim },
});

const hCard = StyleSheet.create({
  container: { backgroundColor: Ink.raised, borderRadius: 12, padding: 14 },
  name: { fontFamily: 'Unbounded_500Medium', fontSize: 14, color: Ink.text },
  muscles: { fontSize: 13, color: Ink.textFaint, marginTop: 2, marginBottom: 8 },
  setBlock: { marginTop: 2 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  setNum: { width: 20, fontSize: 13, color: Ink.textFaint, fontVariant: ['tabular-nums'] },
  setValue: { fontSize: 15, color: Ink.text, fontVariant: ['tabular-nums'] },
  rpe: { fontSize: 13, color: Ink.textFaint },
  sep: { fontSize: 14, color: Ink.textFaint },
  editInput: { minWidth: 64, height: 40, borderWidth: 1, borderColor: Ink.line, borderRadius: 10, textAlign: 'center', fontSize: 15, color: Ink.text, fontVariant: ['tabular-nums'] },
  note: { fontSize: 14, color: Ink.textDim, marginTop: 8 },
});

const sum2 = StyleSheet.create({
  hero: { marginBottom: 20 },
  heroLabel: { fontSize: 14, color: Ink.textDim },
  heroValue: { fontFamily: 'Unbounded_700Bold', fontSize: 48, color: Ink.text, marginTop: 4, fontVariant: ['tabular-nums'] },
  heroUnit: { fontFamily: 'Unbounded_500Medium', fontSize: 18, color: Ink.textDim },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  cell: { width: '48%', flexGrow: 1, backgroundColor: Ink.raised, borderRadius: 14, padding: 16 },
  cellLabel: { fontSize: 13, color: Ink.textDim },
  cellValue: { fontFamily: 'Unbounded_700Bold', fontSize: 20, color: Ink.text, marginTop: 6, fontVariant: ['tabular-nums'] },
  fieldLabel: { fontSize: 14, color: Ink.textDim, marginBottom: 8 },
  field: { height: 52, backgroundColor: Ink.raised, borderWidth: 1, borderColor: Ink.line, borderRadius: 14, fontFamily: 'Unbounded_500Medium', fontSize: 18, textAlign: 'center', color: Ink.text },
  primary: { marginTop: 28, minHeight: 56, borderRadius: 28, backgroundColor: Ink.text, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, fontWeight: '800', color: Ink.bg },
  secondary: { marginTop: 10, minHeight: 52, borderRadius: 26, borderWidth: 1, borderColor: Ink.line, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '600', color: Ink.text },
});

const summ = StyleSheet.create({
  exRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Ink.line },
  exName: { fontSize: 14, color: Ink.textDim, flex: 1 },
  exTime: { fontSize: 14, color: Ink.textDim, fontVariant: ['tabular-nums'] },
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

// Active session card — dark concert poster treatment
const aCard = StyleSheet.create({
  container: { backgroundColor: Ink.raised, borderRadius: 14, padding: 16, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  name: { fontFamily: 'Unbounded_700Bold', fontSize: 16, lineHeight: 22, color: Ink.text },
  muscles: { fontSize: 13, color: Ink.textFaint, marginTop: 2 },
  menuBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  menuBtnText: { fontSize: 14, color: Ink.textFaint, letterSpacing: 1 },
  menuRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  menuPill: { borderWidth: 1, borderColor: Ink.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  menuPillText: { fontSize: 13, color: Ink.text },
  target: { fontSize: 14, color: Ink.textDim, marginTop: 12, fontVariant: ['tabular-nums'] },
  prevRef: { fontSize: 13, color: Ink.textFaint, marginTop: 4, fontVariant: ['tabular-nums'] },
  setBlock: { marginTop: 12 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setNumWrap: { width: 40, height: 48, justifyContent: 'center' },
  setNum: { fontFamily: 'Unbounded_500Medium', fontSize: 14, color: Ink.textFaint, fontVariant: ['tabular-nums'] },
  setNumConfirmed: { color: Ink.text },
  input: {
    flex: 1,
    height: 48,
    backgroundColor: Ink.bg,
    borderWidth: 1,
    borderColor: Ink.line,
    borderRadius: 12,
    fontFamily: 'Unbounded_500Medium',
    fontSize: 18,
    textAlign: 'center',
    color: Ink.text,
    fontVariant: ['tabular-nums'],
  },
  inputDone: { color: Ink.textFaint, borderColor: 'transparent', backgroundColor: 'transparent' },
  smallInput: { flex: 0, width: 64, height: 36, fontSize: 14, borderRadius: 10 },
  sep: { fontSize: 15, color: Ink.textFaint },
  confirmBtn: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: Ink.line, alignItems: 'center', justifyContent: 'center' },
  confirmBtnDone: { backgroundColor: Ink.text, borderColor: Ink.text },
  confirmBtnText: { fontSize: 18, color: Ink.textFaint, fontWeight: '700' },
  confirmBtnTextDone: { color: Ink.bg },
  moreLabel: { fontSize: 13, color: Ink.textDim },
  moreLink: { fontSize: 13, color: Ink.textDim },
  dropLinks: { flexDirection: 'row', gap: 20, marginTop: 8, paddingLeft: 48 },
  dropArrow: { fontSize: 16, color: Ink.textFaint },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingLeft: 48 },
  rateChip: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: Ink.line, alignItems: 'center', justifyContent: 'center' },
  rateChipText: { fontSize: 14, fontWeight: '600', color: Ink.text },
  rateTag: { marginTop: 6, paddingLeft: 48 },
  swipeDelete: { width: 110, backgroundColor: Ink.line, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  swipeDeleteText: { fontSize: 14, fontWeight: '700', color: Ink.text },
  undoBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: Ink.bg, borderRadius: 10 },
  undoText: { fontSize: 14, color: Ink.textDim },
  undoBtn: { fontSize: 14, fontWeight: '700', color: Ink.text },
  addSet: { marginTop: 14, paddingVertical: 8 },
  addSetText: { fontSize: 14, color: Ink.textDim },
  notes: { fontSize: 14, color: Ink.textDim, marginTop: 10, borderBottomWidth: 1, borderBottomColor: Ink.line, paddingVertical: 6 },
  collapsed: { flexDirection: 'row', alignItems: 'center', backgroundColor: Ink.raised, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 12, gap: 12 },
  collapsedName: { fontFamily: 'Unbounded_500Medium', fontSize: 14, color: Ink.textDim },
  collapsedSets: { fontSize: 13, color: Ink.textFaint, marginTop: 3, fontVariant: ['tabular-nums'] },
  collapsedTick: { fontSize: 18, color: Ink.text },
  // Plate calculator
  plateCalc: { backgroundColor: Ink.bg, borderRadius: 12, padding: 12, marginTop: 12 },
  plateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  plateLabel: { fontSize: 13, color: Ink.textFaint },
  plateInput: { width: 56, height: 36, backgroundColor: Ink.raised, borderWidth: 1, borderColor: Ink.line, borderRadius: 10, fontSize: 14, textAlign: 'center', color: Ink.text },
  plateResult: { fontSize: 14, color: Ink.textDim, fontVariant: ['tabular-nums'] },
  // RPE guide
  rpeGuide: { marginTop: 10, backgroundColor: Ink.bg, borderRadius: 12, padding: 12 },
  rpeGuideRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 8 },
  rpeGuideNum: { width: 52, fontSize: 12, color: Ink.textDim, fontWeight: '700' },
  rpeGuideRir: { width: 44, fontSize: 12, color: Ink.textDim, fontVariant: ['tabular-nums'] },
  rpeGuideDesc: { fontSize: 12, color: Ink.textFaint, flex: 1 },
});

const badgeOverlay = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  card: {
    backgroundColor: Ink.raised,
    borderWidth: 1,
    borderColor: Ink.line,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    maxWidth: 300,
  },
  label: { fontSize: 9, color: Ink.textFaint, },
  icon:  { fontSize: 72, lineHeight: 90 },
  name:  { fontSize: 20, fontWeight: '700', color: '#fff', textAlign: 'center' },
  flavour: { fontSize: 13, color: Ink.textDim, textAlign: 'center', lineHeight: 20, fontStyle: 'italic' },
  hint:  { fontSize: 10, color: Ink.textFaint, marginTop: 8 },
});

