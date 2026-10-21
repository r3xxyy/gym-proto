import { useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import {
  Alert,
  AppState,
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
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Swipeable, GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import type { Drop, Exercise, HistoryEntry, UnlockedBadge } from '../../types';
import { ALL_BADGES, checkNewBadges } from '../../constants/badges';
import type { BadgeDefinition } from '../../constants/badges';
import { PROGRAM_EPOCH, getCurrentProgramWeek, getCurrentWeekBounds, PUSH_EXERCISES, LEG_A_EXERCISES, PULL_EXERCISES, SHOULDER_EXERCISES, LEG_B_EXERCISES, SWAP_POOL, W1_DAY_EXERCISES, W2_DAY_EXERCISES, W3_DAY_EXERCISES, W4_DAY_EXERCISES, getWeekExercises, SPLIT, WORKOUT_ORDER, WEEK_DAYS, POSTER_NAMES, POSTER_COLORS, DAY_TEXT_STYLES, BOXED_DAYS } from '../../constants/programs';

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

// ─── Progressive overload color ───────────────────────────────────────────────

function getProgressColor(exName: string, targetStr: string, history: HistoryEntry[]): string | undefined {
  const match = targetStr.match(/^(\d+\.?\d*)\s*kg/);
  if (!match) return undefined;
  const targetWeight = parseFloat(match[1]);

  let prevWeight: number | null = null;
  for (const entry of history) {
    for (const ex of entry.exercises) {
      if (ex.name === exName) {
        for (const s of ex.sets) {
          const w = parseFloat(s.weight);
          if (!isNaN(w) && w > 0) {
            prevWeight = prevWeight === null ? w : Math.max(prevWeight, w);
          }
        }
      }
    }
  }

  if (prevWeight === null) return undefined;
  if (targetWeight > prevWeight) return '#34C759';
  if (targetWeight < prevWeight) return '#FF3B30';
  return undefined; // same — default colour
}

function getSetProgressColor(currentWeight: string, prevWeight: string | undefined): string | undefined {
  const cur = parseFloat(currentWeight);
  const prev = parseFloat(prevWeight ?? '');
  if (!cur || !prev) return undefined;
  if (cur > prev) return '#34C759';
  if (cur < prev) return '#FF3B30';
  return undefined; // same
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

// ─── Muscle Diagram ──────────────────────────────────────────────────────────

type MuscleGroup =
  | 'chest_upper' | 'chest_mid' | 'chest_lower'
  | 'biceps_long' | 'biceps_short' | 'triceps' | 'deltoid' | 'abs'
  | 'quads' | 'hamstrings' | 'glutes' | 'rear_delt' | 'lats' | 'calves';

const MUSCLE_MAP: Record<string, MuscleGroup[]> = {
  'mid chest':        ['chest_mid'],
  'upper chest':      ['chest_upper'],
  'lower chest':      ['chest_lower'],
  'chest':            ['chest_upper', 'chest_mid', 'chest_lower'],
  'triceps':          ['triceps'],
  'biceps':           ['biceps_long', 'biceps_short'],
  'biceps long head': ['biceps_long'],
  'biceps short head':['biceps_short'],
  'brachialis':       ['biceps_long'],
  'deltoid':          ['deltoid'],
  'shoulders':        ['deltoid'],
  'quads':            ['quads'],
  'hamstrings':       ['hamstrings'],
  'glutes':           ['glutes'],
  'glute maximus':    ['glutes'],
  'lats':             ['lats'],
  'rear delt':        ['rear_delt'],
  'gastrocnemius':    ['calves'],
  'calves':           ['calves'],
  'upper back':       ['lats'],
  'mid back':         ['lats'],
  'lateral delt':     ['deltoid'],
  'anterior delt':    ['deltoid'],
};

function parseMuscles(str: string): MuscleGroup[] {
  const parts = str.split(',').map(s => s.trim().toLowerCase());
  const result = new Set<MuscleGroup>();
  parts.forEach(p => (MUSCLE_MAP[p] ?? []).forEach(m => result.add(m)));
  return [...result];
}

const HIT = '#FF6B6B';
const OFF = '#EBEBEB';
const STR = '#C8C8C8';

function FrontView({ c, sw }: { c: (g: MuscleGroup) => string; sw: string }) {
  return (
    <Svg width="80" height="140" viewBox="0 0 80 140">
      <Circle cx="40" cy="9" r="8" fill={OFF} stroke={STR} strokeWidth="0.8" />
      <Path d="M36,17 L44,17 L43,23 L37,23 Z" fill={OFF} stroke={STR} strokeWidth={sw} />
      <Ellipse cx="21" cy="30" rx="8" ry="7" fill={c('deltoid')} stroke={STR} strokeWidth={sw} />
      <Ellipse cx="59" cy="30" rx="8" ry="7" fill={c('deltoid')} stroke={STR} strokeWidth={sw} />
      <Path d="M29,23 L51,23 L50,35 L30,35 Z" fill={c('chest_upper')} stroke="#999" strokeWidth="1.2" />
      <Path d="M30,35 L50,35 L49,46 L31,46 Z" fill={c('chest_mid')} stroke="#999" strokeWidth="1.2" />
      <Path d="M31,46 L49,46 L48,55 L32,55 Z" fill={c('chest_lower')} stroke="#999" strokeWidth="1.2" />
      <Path d="M32,55 L48,55 L47,78 L33,78 Z" fill={c('abs')} stroke={STR} strokeWidth={sw} />
      <Path d="M10,26 L16,26 L14,66 L8,66 Z" fill={c('triceps')} stroke={STR} strokeWidth={sw} />
      <Path d="M15,26 L21,26 L19,66 L13,66 Z" fill={c('biceps_long')} stroke={STR} strokeWidth={sw} />
      <Path d="M20,26 L27,26 L25,66 L18,66 Z" fill={c('biceps_short')} stroke={STR} strokeWidth={sw} />
      <Path d="M53,26 L60,26 L62,66 L55,66 Z" fill={c('biceps_short')} stroke={STR} strokeWidth={sw} />
      <Path d="M59,26 L65,26 L67,66 L61,66 Z" fill={c('biceps_long')} stroke={STR} strokeWidth={sw} />
      <Path d="M64,26 L70,26 L72,66 L66,66 Z" fill={c('triceps')} stroke={STR} strokeWidth={sw} />
      <Path d="M14,66 L24,66 L22,92 L12,92 Z" fill={OFF} stroke={STR} strokeWidth={sw} />
      <Path d="M56,66 L66,66 L68,92 L58,92 Z" fill={OFF} stroke={STR} strokeWidth={sw} />
      <Path d="M33,78 L46,78 L45,118 L32,118 Z" fill={c('quads')} stroke={STR} strokeWidth={sw} />
      <Path d="M34,78 L47,78 L48,118 L35,118 Z" fill={c('quads')} stroke={STR} strokeWidth={sw} />
      <Path d="M32,118 L45,118 L43,135 L30,135 Z" fill={c('calves')} stroke={STR} strokeWidth={sw} />
      <Path d="M35,118 L48,118 L50,135 L37,135 Z" fill={c('calves')} stroke={STR} strokeWidth={sw} />
    </Svg>
  );
}

function BackView({ c, sw }: { c: (g: MuscleGroup) => string; sw: string }) {
  return (
    <Svg width="80" height="140" viewBox="0 0 80 140">
      <Circle cx="40" cy="9" r="8" fill={OFF} stroke={STR} strokeWidth="0.8" />
      <Path d="M36,17 L44,17 L43,23 L37,23 Z" fill={OFF} stroke={STR} strokeWidth={sw} />
      {/* Rear delts */}
      <Ellipse cx="21" cy="30" rx="8" ry="7" fill={c('rear_delt')} stroke={STR} strokeWidth={sw} />
      <Ellipse cx="59" cy="30" rx="8" ry="7" fill={c('rear_delt')} stroke={STR} strokeWidth={sw} />
      {/* Traps */}
      <Path d="M29,23 L51,23 L50,38 L30,38 Z" fill={OFF} stroke={STR} strokeWidth={sw} />
      {/* Lats */}
      <Path d="M30,38 L50,38 L52,65 L28,65 Z" fill={c('lats')} stroke={STR} strokeWidth={sw} />
      {/* Lower back */}
      <Path d="M32,65 L48,65 L47,78 L33,78 Z" fill={OFF} stroke={STR} strokeWidth={sw} />
      {/* Left triceps (visible from back) */}
      <Path d="M10,26 L20,26 L18,66 L8,66 Z" fill={c('triceps')} stroke={STR} strokeWidth={sw} />
      {/* Right triceps */}
      <Path d="M60,26 L70,26 L72,66 L62,66 Z" fill={c('triceps')} stroke={STR} strokeWidth={sw} />
      {/* Left forearm */}
      <Path d="M8,66 L18,66 L16,92 L6,92 Z" fill={OFF} stroke={STR} strokeWidth={sw} />
      {/* Right forearm */}
      <Path d="M62,66 L72,66 L74,92 L64,92 Z" fill={OFF} stroke={STR} strokeWidth={sw} />
      {/* Glutes */}
      <Path d="M33,78 L47,78 L48,100 L32,100 Z" fill={c('glutes')} stroke="#999" strokeWidth="1.2" />
      {/* Left hamstring */}
      <Path d="M33,100 L46,100 L45,118 L32,118 Z" fill={c('hamstrings')} stroke="#999" strokeWidth="1.2" />
      {/* Right hamstring */}
      <Path d="M34,100 L47,100 L48,118 L35,118 Z" fill={c('hamstrings')} stroke="#999" strokeWidth="1.2" />
      {/* Calves (gastrocnemius - back of lower leg) */}
      <Path d="M32,118 L45,118 L43,135 L30,135 Z" fill={c('calves')} stroke={STR} strokeWidth={sw} />
      <Path d="M35,118 L48,118 L50,135 L37,135 Z" fill={c('calves')} stroke={STR} strokeWidth={sw} />
    </Svg>
  );
}

function BodyDiagram({ muscles }: { muscles: string }) {
  const [showBack, setShowBack] = useState(false);
  const active = parseMuscles(muscles);
  const c = (g: MuscleGroup) => active.includes(g) ? HIT : OFF;
  const sw = '0.8';

  return (
    <View style={{ alignItems: 'center' }}>
      {showBack
        ? <BackView c={c} sw={sw} />
        : <FrontView c={c} sw={sw} />
      }
      <TouchableOpacity onPress={() => setShowBack(v => !v)} style={diag.toggle}>
        <Text style={diag.toggleText}>{showBack ? 'Front' : 'Back'}</Text>
      </TouchableOpacity>
    </View>
  );
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
  const displaySets = editable ? exercise.sets : exercise.sets.filter(s => s.weight || s.reps);
  if (!editable && displaySets.length === 0) return null;

  function updateSet(si: number, field: 'weight' | 'reps', value: string) {
    const sets = exercise.sets.map((s, i) => i === si ? { ...s, [field]: value } : s);
    onChange?.({ ...exercise, sets });
  }

  return (
    <View style={card.container}>
      <View style={card.header}>
        <Text style={card.name}>{exercise.name}</Text>
        <Text style={card.badge}>{exercise.type}</Text>
      </View>
      <Text style={card.muscles}>{exercise.muscles}</Text>
      <Text style={card.target}>Target: {exercise.target}</Text>
      {displaySets.map((s, i) => (
        <View key={i} style={card.setRow}>
          <Text style={card.setNum}>{i + 1}</Text>
          {editable ? (
            <TextInput
              style={histCard.editInput}
              value={s.weight}
              onChangeText={v => updateSet(i, 'weight', v)}
              keyboardType="decimal-pad"
              placeholder="kg"
              placeholderTextColor="#333"
            />
          ) : (
            <Text style={histCard.setValue}>{s.weight || '—'} kg</Text>
          )}
          <Text style={card.sep}>×</Text>
          {editable ? (
            <TextInput
              style={histCard.editInput}
              value={s.reps}
              onChangeText={v => updateSet(i, 'reps', v)}
              keyboardType="number-pad"
              placeholder="reps"
              placeholderTextColor="#333"
            />
          ) : (
            <Text style={histCard.setValue}>{s.reps || '—'} reps</Text>
          )}
          {s.drops.map((d, j) => (
            <View key={j} style={card.dropGroup}>
              <Text style={card.arrow}>→</Text>
              <Text style={histCard.setValue}>{d.weight || '—'} kg</Text>
              <Text style={card.sep}>×</Text>
              <Text style={histCard.setValue}>{d.reps || '—'} reps</Text>
            </View>
          ))}
        </View>
      ))}
      {editable && (
        <TextInput
          style={aCard.notes}
          value={exercise.notes ?? ''}
          onChangeText={text => onChange?.({ ...exercise, notes: text })}
          placeholder="Notes…"
          placeholderTextColor="#222"
          multiline
        />
      )}
      {!editable && exercise.notes?.trim() ? (
        <Text style={histCard.noteText}>{exercise.notes.trim()}</Text>
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

function ExerciseCard({
  exercise,
  onChange,
  onSwap,
  onConfirmSet,
  prevSets,
  prevLabel,
  prevSets2,
  prevLabel2,
}: {
  exercise: Exercise;
  onChange: (updated: Exercise) => void;
  onSwap?: () => void;
  onConfirmSet?: (exercise: Exercise) => void;
  prevSets?: { weight: string; reps: string }[];
  prevLabel?: string;
  prevSets2?: { weight: string; reps: string }[];
  prevLabel2?: string;
}) {
  const [confirmedSets, setConfirmedSets] = useState<Set<number>>(new Set());
  const [showPlates, setShowPlates] = useState(false);
  const [barWeight, setBarWeight] = useState('20');
  const [tareWeight, setTareWeight] = useState('0');
  const [showRpeGuide, setShowRpeGuide] = useState(false);

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
    const now = Date.now();
    const startedAt = field === 'weight' && !exercise.startedAt ? now : exercise.startedAt;
    onChange({ ...exercise, sets, startedAt });
  }

  function updateRpe(si: number, value: string) {
    const sets = exercise.sets.map((s, i) => i === si ? { ...s, rpe: value } : s);
    onChange({ ...exercise, sets });
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
    onChange({ ...exercise, sets: [...exercise.sets, { weight: last.weight, reps: last.reps, rpe: '', drops: newDrops }] });
  }

  function removeSet(si: number) {
    if (exercise.sets.length === 1) return;
    onChange({ ...exercise, sets: exercise.sets.filter((_, i) => i !== si) });
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

  return (
    <View style={aCard.container}>
      <View style={aCard.header}>
        {onSwap ? (
          <TouchableOpacity onPress={onSwap} style={{ flex: 1 }}>
            <Text style={aCard.name}>{exercise.name}</Text>
            <Text style={aCard.swapHint}>tap to swap</Text>
          </TouchableOpacity>
        ) : (
          <Text style={aCard.name}>{exercise.name}</Text>
        )}
        <Text style={aCard.badge}>{exercise.type}</Text>
        <TouchableOpacity onPress={() => setShowPlates(p => !p)}>
          <Text style={[aCard.badge, showPlates && { color: '#aaa' }]}>⊞ PLATES</Text>
        </TouchableOpacity>
      </View>
      <Text style={aCard.muscles}>{exercise.muscles.split(',')[0].trim()}</Text>
      {(() => {
        const prevMax = prevSets ? Math.max(...prevSets.map(s => parseFloat(s.weight) || 0)) : 0;
        const targetMatch = exercise.target.match(/^(\d+\.?\d*)\s*kg/);
        const targetW = targetMatch ? parseFloat(targetMatch[1]) : 0;
        const targetColor = prevMax && targetW ? (targetW > prevMax ? '#34C759' : targetW < prevMax ? '#FF3B30' : undefined) : undefined;
        return (
          <>
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
            <Text style={[aCard.target, targetColor ? { color: targetColor } : undefined]}>↑ {exercise.target}</Text>
          </>
        );
      })()}

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
                placeholder="20"
                placeholderTextColor="#333"
              />
              <Text style={aCard.plateLabel}>tare</Text>
              <TextInput
                style={aCard.plateInput}
                value={tareWeight}
                onChangeText={setTareWeight}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="#333"
              />
            </View>
            <Text style={aCard.plateResult}>
              {displayWeight ? calcPlates(displayWeight) : 'enter a weight above'}
            </Text>
          </View>
        );
      })()}

      {exercise.sets.map((set, si) => {
        const isDone = confirmedSets.has(si);
        const progressColor = getSetProgressColor(set.weight, prevSets?.[si]?.weight);
        return (
          <View key={si} style={aCard.setRow}>
            <Text style={[aCard.setNum, isDone ? aCard.setNumConfirmed : progressColor ? { color: progressColor } : null]}>
              {String(si + 1).padStart(2, '0')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
              <View style={aCard.setInner}>
                {/* Main set */}
                <TextInput
                  style={aCard.input}
                  value={set.weight}
                  onChangeText={v => updateSet(si, 'weight', v)}
                  keyboardType="decimal-pad"
                  placeholder="kg"
                  placeholderTextColor="#333"
                />
                <Text style={aCard.sep}>×</Text>
                <TextInput
                  style={aCard.input}
                  value={set.reps}
                  onChangeText={v => updateSet(si, 'reps', v)}
                  keyboardType="number-pad"
                  placeholder="reps"
                  placeholderTextColor="#333"
                />
                {/* Drop sets */}
                {set.drops.map((drop, di) => (
                  <View key={di} style={aCard.dropGroup}>
                    <Text style={aCard.arrow}>→</Text>
                    <TextInput
                      style={aCard.input}
                      value={drop.weight}
                      onChangeText={v => updateDrop(si, di, 'weight', v)}
                      keyboardType="decimal-pad"
                      placeholder="kg"
                      placeholderTextColor="#333"
                    />
                    <Text style={aCard.sep}>×</Text>
                    <TextInput
                      style={aCard.input}
                      value={drop.reps}
                      onChangeText={v => updateDrop(si, di, 'reps', v)}
                      keyboardType="number-pad"
                      placeholder="reps"
                      placeholderTextColor="#333"
                    />
                    <TouchableOpacity onPress={() => removeDrop(si, di)}>
                      <Text style={aCard.dropRemove}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                {/* + Drop */}
                <TouchableOpacity style={aCard.dropBtn} onPress={() => addDrop(si)}>
                  <Text style={aCard.dropBtnText}>+ Drop</Text>
                </TouchableOpacity>
                {/* RPE */}
                <Text style={aCard.sep}>@</Text>
                <TextInput
                  style={[aCard.input, aCard.rpeInput]}
                  value={set.rpe}
                  onChangeText={v => updateRpe(si, v)}
                  keyboardType="decimal-pad"
                  placeholder="RPE"
                  placeholderTextColor="#333"
                />
                {si === 0 && (
                  <TouchableOpacity onPress={() => setShowRpeGuide(p => !p)} style={aCard.rpeGuideBtn}>
                    <Text style={[aCard.rpeGuideBtnText, showRpeGuide && { color: '#aaa' }]}>?</Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
            {/* Confirm set */}
            <TouchableOpacity
              onPress={() => {
                setConfirmedSets(prev => new Set([...prev, si]));
                onChange({ ...exercise, endedAt: Date.now() });
                onConfirmSet?.(exercise);
              }}
              style={[aCard.confirmBtn, isDone && aCard.confirmBtnDone]}
            >
              <Text style={[aCard.confirmBtnText, isDone && aCard.confirmBtnTextDone]}>✓</Text>
            </TouchableOpacity>
            {/* Remove set */}
            <TouchableOpacity onPress={() => removeSet(si)} style={aCard.removeBtn}>
              <Text style={aCard.removeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        );
      })}

      <TouchableOpacity style={aCard.addSet} onPress={addSet}>
        <Text style={aCard.addSetText}>+ Set</Text>
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

      <TextInput
        style={aCard.notes}
        value={exercise.notes ?? ''}
        onChangeText={text => onChange({ ...exercise, notes: text })}
        placeholder="Notes…"
        placeholderTextColor="#222"
        multiline
      />

      <Text style={aCard.cue}>{exercise.cue}</Text>
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
        <View style={drag.handle}>
          <Text style={drag.handleDots}>⠿ ⠿ ⠿</Text>
          <Text style={drag.handleLabel}>hold to drag</Text>
          <TouchableOpacity onPress={onRemove} style={drag.removeBtn}>
            <Text style={drag.removeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
        <ExerciseCard exercise={exercise} onChange={onChange} onSwap={onSwap} onConfirmSet={onConfirmSet} prevSets={prevSets} prevLabel={prevLabel} prevSets2={prevSets2} prevLabel2={prevLabel2} />
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [openDates, setOpenDates] = useState<Record<string, boolean>>({});
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ id: string; exercises: Exercise[] } | null>(null);

  function toggleGroup(name: string) {
    setOpenGroups(prev => ({ ...prev, [name]: !prev[name] }));
  }

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
    // Force the entry open
    setOpenDates(prev => ({ ...prev, [`${entry.workoutName}-${entry.id}`]: true }));
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

  // Group history by workout name
  const grouped: Record<string, HistoryEntry[]> = {};
  for (const entry of history) {
    if (!grouped[entry.workoutName]) grouped[entry.workoutName] = [];
    grouped[entry.workoutName].push(entry);
  }

  const categories = [
    ...WORKOUT_ORDER.filter(name => grouped[name]),
    ...Object.keys(grouped).filter(name => !WORKOUT_ORDER.includes(name)),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: '#080810' }}>
      <View style={styles.historyHeader}>
        <TouchableOpacity onPress={selectMode ? exitSelectMode : onBack}>
          <Text style={styles.historyBack}>{selectMode ? 'Cancel' : '← Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.historyTitle}>
          {selectMode && selectedIds.length > 0 ? `${selectedIds.length} selected` : 'History'}
        </Text>
        <View style={{ flex: 1 }} />
        {selectMode && selectedIds.length > 0 ? (
          <TouchableOpacity onPress={shareSelected}>
            <Text style={{ fontSize: 13, color: '#007AFF', fontWeight: '600' }}>Share</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => { setSelectMode(v => !v); setSelectedIds([]); }}>
            <Text style={{ fontSize: 13, color: '#007AFF' }}>{selectMode ? 'Done' : 'Select'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {history.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: '#999' }}>No workouts logged yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          {categories.map(name => (
            <View key={name} style={coll.group}>
              {/* Group header */}
              <TouchableOpacity style={coll.groupHeader} onPress={() => toggleGroup(name)}>
                <Text style={coll.groupName}>{name}</Text>
                <Text style={coll.chevron}>{openGroups[name] ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {openGroups[name] && grouped[name].map(entry => {
                const dateKey = `${name}-${entry.id}`;
                return (
                  <Swipeable
                    key={entry.id}
                    renderRightActions={selectMode ? undefined : () => (
                      <TouchableOpacity style={coll.deleteBtn} onPress={() => onDelete(entry.id)}>
                        <Text style={coll.deleteBtnText}>Delete</Text>
                      </TouchableOpacity>
                    )}
                  >
                    {/* Date row */}
                    {(() => {
                      const isEditing = editingId === entry.id;
                      return (
                        <TouchableOpacity
                          style={[coll.dateRow, selectMode && selectedIds.includes(entry.id) && coll.dateRowSelected]}
                          onPress={() => isEditing ? undefined : selectMode ? toggleSelect(entry.id) : toggleDate(dateKey)}
                          activeOpacity={isEditing ? 1 : 0.7}
                        >
                          {selectMode && !isEditing && (
                            <View style={[coll.selectCircle, selectedIds.includes(entry.id) && coll.selectCircleFilled]}>
                              {selectedIds.includes(entry.id) && <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>✓</Text>}
                            </View>
                          )}
                          <View style={{ flex: 1 }}>
                            <Text style={coll.dateText}>{entry.date}</Text>
                            {entry.gym && <Text style={coll.dateGym}>{shortGym(entry.gym)}</Text>}
                          </View>
                          {isEditing ? (
                            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                              <TouchableOpacity onPress={() => saveEdit(entry)}>
                                <Text style={{ fontSize: 11, letterSpacing: 2, color: '#34C759' }}>SAVE</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={cancelEdit}>
                                <Text style={{ fontSize: 11, letterSpacing: 2, color: '#FF3B30' }}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <>
                              <Text style={coll.dateMeta}>{formatTime(entry.duration + entry.restTime)}</Text>
                              {!selectMode && (
                                <TouchableOpacity
                                  onPress={() => enterEditMode(entry)}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  style={{ paddingHorizontal: 6 }}
                                >
                                  <Text style={{ color: '#333', fontSize: 14 }}>✎</Text>
                                </TouchableOpacity>
                              )}
                              {!selectMode && <Text style={coll.chevronSm}>{openDates[dateKey] ? '▲' : '▼'}</Text>}
                            </>
                          )}
                        </TouchableOpacity>
                      );
                    })()}

                    {/* Exercise cards */}
                    {openDates[dateKey] && (
                      <View style={coll.cardList}>
                        {(editingId === entry.id && editDraft ? editDraft.exercises : entry.exercises).map(ex => (
                          <HistoryExerciseCard
                            key={ex.id}
                            exercise={ex}
                            editable={editingId === entry.id}
                            onChange={editingId === entry.id ? updateEditDraftExercise : undefined}
                          />
                        ))}
                        {/* Merge button — shown when another same-day same-workout entry exists */}
                        {(() => {
                          const sibling = grouped[name].find(
                            e => e.id !== entry.id && e.date === entry.date
                          );
                          if (!sibling) return null;
                          const older = entry.id < sibling.id ? entry : sibling;
                          const newer = entry.id < sibling.id ? sibling : entry;
                          return (
                            <TouchableOpacity
                              style={[coll.mergeBtn]}
                              onPress={() => onMerge(mergeEntries(older, newer), newer.id)}
                            >
                              <Text style={coll.mergeBtnText}>Merge sessions →</Text>
                            </TouchableOpacity>
                          );
                        })()}
                      </View>
                    )}
                  </Swipeable>
                );
              })}
            </View>
          ))}
        </ScrollView>
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
  const totalVolume = exs.reduce((total, ex) =>
    total + ex.sets.reduce((s, set) => {
      const w = parseFloat(set.weight) || 0;
      const r = parseInt(set.reps) || 0;
      const dropVol = set.drops.reduce((dv, d) =>
        dv + (parseFloat(d.weight) || 0) * (parseInt(d.reps) || 0), 0);
      return s + w * r + dropVol;
    }, 0), 0);

  const lines: string[] = [`WORKOUT: ${workoutName}`, `DATE: ${date}`];
  if (gym) lines.push(`VENUE: ${gym}`);
  lines.push(
    `SESSION: ${formatTime(duration + restTime)}  |  ACTIVE: ${formatTime(duration)}  |  REST: ${formatTime(restTime)}`,
    `TOTAL VOLUME: ${totalVolume.toLocaleString()} kg`,
  );

  if (bodyweight && duration) {
    const bw = parseFloat(bodyweight);
    if (!isNaN(bw)) {
      const kcal = Math.round(5 * bw * (duration / 3600));
      lines.push(`BODYWEIGHT: ${bodyweight} kg  |  EST. KCAL: ${kcal} kcal`);
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
  const totalVolume = trainEntries.reduce((total, entry) =>
    total + entry.exercises.reduce((ev, ex) =>
      ev + ex.sets.reduce((s, set) => {
        const w = parseFloat(set.weight) || 0;
        const r = parseInt(set.reps) || 0;
        const dropVol = set.drops.reduce((dv, d) =>
          dv + (parseFloat(d.weight) || 0) * (parseInt(d.reps) || 0), 0);
        return s + w * r + dropVol;
      }, 0), 0), 0);

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

// ─── Target green-highlight helper ────────────────────────────────────────────
function getTargetChanges(exName: string, workoutDay: number, newTarget: string, history: HistoryEntry[]): { weightGreen: boolean; repsGreen: boolean } {
  // Build PR map — same logic as Progress screen, so colours match what PRs show
  const prMap: Record<string, number> = {};
  for (const entry of history) {
    for (const ex of entry.exercises) {
      for (const s of ex.sets) {
        const w = parseFloat(s.weight);
        if (!isNaN(w) && w > 0 && (!prMap[ex.name] || w > prMap[ex.name])) {
          prMap[ex.name] = w;
        }
      }
    }
  }

  // Look up PR with exact match first, then prefix fallback for name variations
  const searchName = exName.toLowerCase().trim();
  let prWeight = 0;
  for (const [name, weight] of Object.entries(prMap)) {
    const hn = name.toLowerCase().trim();
    if (hn === searchName || hn.startsWith(searchName) || searchName.startsWith(hn)) {
      if (weight > prWeight) prWeight = weight;
    }
  }

  if (!prWeight) return { weightGreen: false, repsGreen: false };

  const wMatch = newTarget.match(/(\d+\.?\d*)\s*kg/);
  const newW = wMatch ? parseFloat(wMatch[1]) : 0;
  return {
    weightGreen: newW > 0 && newW > prWeight,
    repsGreen: false,
  };
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

function HighlightedTarget({ target, weightGreen, repsGreen, style }: { target: string; weightGreen: boolean; repsGreen: boolean; style?: object }) {
  const wMatch = target.match(/^([\s\S]*?)(\d+\.?\d*)(\s*kg\s*×\s*)(\d+)([\s\S]*)$/);
  if (!wMatch) return <Text style={style}>{target}</Text>;
  const [, pre, weight, mid, reps, rest] = wMatch;
  const GREEN = '#34C759';
  return (
    <Text style={style}>
      {pre}
      <Text style={weightGreen ? { color: GREEN } : {}}>{weight}</Text>
      {mid}
      <Text style={repsGreen ? { color: GREEN } : {}}>{reps}</Text>
      {rest}
    </Text>
  );
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
  const knownGyms = [...new Set([activeGym, ...history.map(h => h.gym)].filter((g): g is string => !!g))];
  function selectGym(gym: string) {
    setActiveGym(gym);
    FileSystem.writeAsStringAsync(GYM_PATH, JSON.stringify(gym));
  }

  function renameGym(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    setHistory(prev => {
      const next = prev.map(e => e.gym === oldName ? { ...e, gym: trimmed } : e);
      FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(next));
      return next;
    });
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
      continuePulse.value = withRepeat(
        withSequence(withTiming(1.04, { duration: 500 }), withTiming(1, { duration: 500 })),
        -1,
        false
      );
    } else {
      continuePulse.value = withTiming(1, { duration: 150 });
    }
  }, [isOvertime]);

  function logRestDay(day: number) {
    const entry: HistoryEntry = {
      id: Date.now().toString(),
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

  function extendRest(extraSecs: number) {
    if (hapticTimer.current) clearTimeout(hapticTimer.current);
    cancelRestNotifications();
    const elapsed = Math.round((Date.now() - restStartRef.current) / 1000);
    setCurrentRestDuration(prev => {
      const newDuration = prev + extraSecs;
      const remaining = newDuration - elapsed;
      if (remaining > 5) {
        hapticTimer.current = setTimeout(() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }, (remaining - 5) * 1000);
      }
      scheduleRestNotifications(remaining);
      return newDuration;
    });
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
    const entry: HistoryEntry = {
      id: pendingEntry?.id ?? Date.now().toString(),
      date: pendingEntry?.date ?? new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
      workoutName: selectedDay !== null ? SPLIT[selectedDay] : todayWorkout,
      duration: finalActive,
      restTime: finalRest_,
      exercises: exercises,
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
      {/* ── Home ── */}
      {screen === 'home' && (
        <View style={{ flex: 1, backgroundColor: '#080810' }}>

          {/* ── Poster Header ── */}
          <View style={poster.header}>
            <View>
              <Text style={poster.brand}>GYM PROTO</Text>
              <Text style={poster.phase}>WEEK {currentWeek}  LINE UP</Text>
            </View>
            <TouchableOpacity style={poster.histBtn} onPress={() => { prevScreenRef.current = 'home'; setScreen('history'); }}>
              <Text style={poster.histBtnText}>HISTORY</Text>
            </TouchableOpacity>
          </View>

          {/* ── Venue Picker — always visible ── */}
          <View style={[poster.venueRow, { paddingHorizontal: 24 }]}>
            <Text style={poster.venueLabel}>VENUE</Text>
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
                  <Text style={poster.venueChipText}>+ NEW</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>

          {/* ── Lineup ── */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }}>
            {(() => {


              // ── No session selected: full lineup, tap to select ──
              if (selectedDay === null) {
                return (
                  <>
                    <View style={poster.supportSection}>
                      <Text style={[poster.headlinerLabel, { textAlign: 'center', marginBottom: 24, marginTop: 20 }]}>— THIS WEEK —</Text>
                      {WEEK_DAYS.map((day, i) => {
                        const done = completedDays.includes(day);
                        const isRest = done && thisWeekHistory.find(h => WORKOUT_TO_DAY[h.workoutName] === day && h.isRestDay);
                        return (
                          <View key={day} style={[poster.supportRow, i < WEEK_DAYS.length - 1 && { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' }]}>
                            <TouchableOpacity style={{ flex: 1 }} onPress={() => !done && setSelectedDay(day)} disabled={done} activeOpacity={0.6}>
                              <Text style={[poster.supportName, done && { opacity: 0.2 }]}>{POSTER_NAMES[day]}</Text>
                            </TouchableOpacity>
                            {done && !isRest && <Text style={poster.supportDone}>✓</Text>}
                            {done && isRest && <Text style={poster.supportDone}>REST</Text>}
                            {!done && (
                              <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => logRestDay(day)}>
                                <Text style={{ fontSize: 8, letterSpacing: 2, color: '#333', textTransform: 'uppercase' }}>REST</Text>
                              </TouchableOpacity>
                            )}
                          </View>
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
                    <Text style={poster.headlinerLabel}>— TONIGHT —</Text>
                    <View style={poster.headlinerBox}>
                      <AnimatedPosterName
                        day={headlineDay}
                        isActive={!headlineDone}
                        style={[poster.artistName, DAY_TEXT_STYLES[headlineDay], { color: headlineDone ? 'rgba(255,255,255,0.2)' : '#fff' }]}
                      />
                    </View>
                    <Text style={poster.headlinerSub}>{SPLIT[headlineDay].toUpperCase()}</Text>
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
                              <Text style={poster.lineupName} numberOfLines={2}>{ex.name.toUpperCase()}</Text>
                              <Text style={poster.lineupMuscle}>{ex.muscles.split(',')[0].trim().toUpperCase()}</Text>
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
                      const isRest = done && thisWeekHistory.find(h => WORKOUT_TO_DAY[h.workoutName] === day && h.isRestDay);
                      return (
                        <View key={day} style={[poster.supportRow, i < supportDays.length - 1 && { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' }]}>
                          <TouchableOpacity style={{ flex: 1 }} onPress={() => !done && setSelectedDay(day)} disabled={done} activeOpacity={0.6}>
                            <Text style={[poster.supportName, done && { opacity: 0.2 }]}>{POSTER_NAMES[day]}</Text>
                          </TouchableOpacity>
                          {done && !isRest && <Text style={poster.supportDone}>✓</Text>}
                          {done && isRest && <Text style={poster.supportDone}>REST</Text>}
                          {!done && (
                            <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => logRestDay(day)}>
                              <Text style={{ fontSize: 8, letterSpacing: 2, color: '#333', textTransform: 'uppercase' }}>REST</Text>
                            </TouchableOpacity>
                          )}
                        </View>
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
                        <Text style={poster.swapOptName}>"{swapQuery.trim()}"</Text>
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
              <TouchableOpacity style={poster.startBtn} onPress={startWorkout}>
                <Text style={poster.startBtnText}>START WORKOUT</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* ── Active ── */}
      {screen === 'active' && (
        <View style={{ flex: 1, backgroundColor: '#080810' }}>
          <View style={styles.timerBar}>
            <TouchableOpacity onLongPress={resetClock} delayLongPress={600} activeOpacity={1}>
              <Text style={styles.timerBarTime}>{formatTime(totalSessionSecs)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={poster.histBtn} onPress={() => { prevScreenRef.current = 'active'; setScreen('history'); }}>
              <Text style={poster.histBtnText}>HISTORY</Text>
            </TouchableOpacity>
            {paused ? (
              <Text style={[styles.timerBarRest, currentRestDuration > 0 && currentRestSecs >= currentRestDuration && { color: '#FF9500' }]}>
                {currentRestDuration > 0
                  ? currentRestSecs >= currentRestDuration
                    ? `+${Math.floor((currentRestSecs - currentRestDuration) / 60)}:${String((currentRestSecs - currentRestDuration) % 60).padStart(2, '0')}`
                    : `Rest — ${formatTime(currentRestDuration - currentRestSecs)} left`
                  : `Rest ${formatTime(currentRestSecs)}`}
              </Text>
            ) : (
              <Text style={styles.timerBarRest}>Active {formatTime(seconds)}</Text>
            )}
            <Animated.View style={[continueAnimStyle, { alignSelf: 'stretch' }]}>
              <TouchableOpacity style={[styles.restBtn, isOvertime && { backgroundColor: '#FF3B30', borderColor: '#FF3B30' }]} onPress={toggleRest}>
                <Text style={[styles.restBtnText, isOvertime && { color: '#fff' }]}>{paused ? 'Continue' : 'Rest'}</Text>
              </TouchableOpacity>
            </Animated.View>
            {paused && currentRestDuration > 0 && (
              <View style={styles.extendRestRow}>
                <TouchableOpacity style={styles.extendRestBtn} onPress={() => extendRest(30)}>
                  <Text style={styles.extendRestBtnText}>+30s</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.extendRestBtn} onPress={() => extendRest(60)}>
                  <Text style={styles.extendRestBtnText}>+60s</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.timerBarTitle}>{todayWorkout}</Text>
          </View>
          {/* ── Venue row — reactive: changing gym updates all prev refs inline ── */}
          <View style={[poster.venueRow, { paddingHorizontal: 16 }]}>
            <Text style={poster.venueLabel}>VENUE</Text>
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
                  <Text style={poster.venueChipText}>+ NEW</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
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
                prevSets={pi?.sets}
                prevLabel={pi ? mkLabel(pi) : undefined}
                prevSets2={si?.sets}
                prevLabel2={si ? mkLabel(si) : undefined}
              />
              );
            })}
            <TouchableOpacity style={styles.addExBtn} onPress={() => setActiveSwapId('__add__')}>
              <Text style={styles.addExBtnText}>+ Add Exercise</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.endBtn} onPress={endWorkout}>
              <Text style={styles.endBtnText}>End Workout</Text>
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
                        <Text style={poster.swapOptName}>"{swapQuery.trim()}"</Text>
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
        <View style={{ flex: 1, backgroundColor: '#080810' }}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>Summary</Text>
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.summaryLabel}>Session Duration</Text>
            <Text style={styles.summaryValue}>{formatTime(finalSeconds + finalRest)}</Text>
            <Text style={styles.summaryLabel}>Workout Time</Text>
            <Text style={styles.summaryValue}>{formatTime(finalSeconds)}</Text>
            <Text style={styles.summaryLabel}>Total Rest</Text>
            <Text style={styles.summaryValue}>{formatTime(finalRest)}</Text>

            <Text style={styles.summaryLabel}>Total Volume</Text>
            <Text style={styles.summaryValue}>
              {exercises.reduce((total, ex) =>
                total + ex.sets.reduce((s, set) => {
                  const w = parseFloat(set.weight) || 0;
                  const r = parseInt(set.reps) || 0;
                  const dropVol = set.drops.reduce((dv, d) =>
                    dv + (parseFloat(d.weight) || 0) * (parseInt(d.reps) || 0), 0);
                  return s + w * r + dropVol;
                }, 0), 0).toLocaleString()} kg
            </Text>

            <Text style={styles.summaryLabel}>Bodyweight (kg)</Text>
            <TextInput
              style={[styles.button, { backgroundColor: '#0e0e1c', borderWidth: 1, borderColor: '#1e1e30', color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 0 }]}
              value={bodyweight}
              onChangeText={v => {
                setBodyweight(v);
                FileSystem.writeAsStringAsync(BW_PATH, JSON.stringify(v));
              }}
              keyboardType="decimal-pad"
              placeholder="e.g. 80"
              placeholderTextColor="#ccc"
            />
            {!!bodyweight && !!finalSeconds && (
              <>
                <Text style={styles.summaryLabel}>Est. Kcal Burned</Text>
                <Text style={styles.summaryValue}>
                  {Math.round(5 * parseFloat(bodyweight) * (finalSeconds / 3600))} kcal
                </Text>
              </>
            )}

            <Text style={[styles.summaryLabel, { marginTop: 16 }]}>Exercise Times</Text>
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

            <TouchableOpacity
              style={[styles.button, { marginTop: 24, backgroundColor: '#080810' }]}
              onPress={() => {
                const date = pendingEntry?.date ?? new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
                Share.share({ message: formatSessionForCoach(pendingEntry?.workoutName ?? todayWorkout, date, finalSeconds, finalRest, exercises, bodyweight, history, activeGym || undefined, programEpoch) });
              }}
            >
              <Text style={styles.buttonText}>Coach This →</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, { marginTop: 12, backgroundColor: '#0e0e1c', borderWidth: 1, borderColor: '#1e1e30' }]} onPress={continueWorkout}>
              <Text style={[styles.buttonText, { color: '#aaa' }]}>+ Continue Session</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, { marginTop: 8, backgroundColor: '#080810' }]} onPress={reset}>
              <Text style={[styles.buttonText, { color: '#444' }]}>Done</Text>
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
  root: { flex: 1, backgroundColor: '#080810' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
  title: { fontSize: 32, fontWeight: 'bold' },
  workoutName: { fontSize: 18, color: '#666', marginBottom: 8 },
  button: { backgroundColor: '#000', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 8 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  timerBar: {
    backgroundColor: '#080810',
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#111',
    gap: 6,
  },
  timerBarTitle: { fontSize: 11, color: '#333', textTransform: 'uppercase', letterSpacing: 4, marginTop: 4, fontWeight: '700' },
  timerBarTime: { fontSize: 42, fontWeight: '200', letterSpacing: 3, color: '#fff' },
  timerBarRest: { fontSize: 13, color: '#555' },
  restBtn: { borderWidth: 1, borderColor: '#2a2a40', paddingVertical: 12, borderRadius: 4, marginTop: 4, alignSelf: 'stretch', alignItems: 'center' },
  restBtnText: { fontSize: 14, fontWeight: '600', color: '#ccc' },
  extendRestRow: { flexDirection: 'row', gap: 8, marginTop: 6, alignSelf: 'stretch' },
  extendRestBtn: { flex: 1, borderWidth: 1, borderColor: '#1e1e30', paddingVertical: 8, borderRadius: 4, alignItems: 'center' },
  extendRestBtnText: { fontSize: 13, fontWeight: '500', color: '#555' },
  endBtn: { borderWidth: 1, borderColor: '#151520', paddingVertical: 12, borderRadius: 4, alignSelf: 'stretch', alignItems: 'center', marginTop: 8 },
  endBtnText: { fontSize: 13, color: '#2a2a40', textAlign: 'center', letterSpacing: 2 },
  addExBtn: { borderWidth: 1, borderColor: '#1e1e30', paddingVertical: 12, borderRadius: 4, alignSelf: 'stretch', alignItems: 'center', marginBottom: 8 },
  addExBtnText: { fontSize: 13, color: '#444', letterSpacing: 1 },
  list: { padding: 16, paddingBottom: 32 },
  summaryLabel: { fontSize: 11, color: '#444', textTransform: 'uppercase', letterSpacing: 2 },
  summaryValue: { fontSize: 36, fontWeight: '200', letterSpacing: 3, marginBottom: 8, color: '#fff' },
  homeHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  homeFooter: { padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee' },
  historyBtn: { paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: '#2a2a40', borderRadius: 4 },
  historyBtnText: { fontSize: 13, color: '#555' },
  historyHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: '#080810', borderBottomWidth: 1, borderBottomColor: '#111', flexDirection: 'row', alignItems: 'center', gap: 16 },
  historyBack: { fontSize: 16, color: '#555' },
  historyTitle: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: 1 },
});

const hist = StyleSheet.create({
  sessionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, marginTop: 8 },
  workoutName: { fontSize: 16, fontWeight: '600' },
  date: { fontSize: 12, color: '#999' },
  meta: { fontSize: 12, color: '#aaa', marginBottom: 10 },
});

const coll = StyleSheet.create({
  group: { backgroundColor: '#0e0e1c', borderRadius: 4, marginBottom: 10, overflow: 'hidden' },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  groupName: { fontSize: 13, fontWeight: '700', color: '#ccc', textTransform: 'uppercase', letterSpacing: 2 },
  chevron: { fontSize: 12, color: '#333' },
  dateRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#131328' },
  dateText: { fontSize: 13, color: '#888' },
  dateGym: { fontSize: 8, letterSpacing: 2, color: '#333', textTransform: 'uppercase', marginTop: 2 },
  dateMeta: { fontSize: 11, color: '#333', marginRight: 8 },
  chevronSm: { fontSize: 10, color: '#2a2a40' },
  cardList: { backgroundColor: '#080810', padding: 12, gap: 0 },
  deleteBtn: { backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center', width: 80 },
  deleteBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  dateRowSelected: { backgroundColor: '#0a1828' },
  selectCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#2a2a40', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  selectCircleFilled: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  mergeBtn: { marginTop: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#2a2a40', borderRadius: 4, alignItems: 'center' },
  mergeBtnText: { fontSize: 12, color: '#666', letterSpacing: 2, textTransform: 'uppercase' },
});

const histCard = StyleSheet.create({
  setValue: { fontSize: 14, color: '#888', minWidth: 56, textAlign: 'center', fontVariant: ['tabular-nums'] },
  editInput: { fontSize: 14, color: '#fff', minWidth: 48, textAlign: 'center', fontVariant: ['tabular-nums'], borderBottomWidth: 1, borderBottomColor: '#2a2a40', paddingVertical: 2 },
  noteText: { fontSize: 12, color: '#444', marginTop: 6, lineHeight: 16 },
});

const summ = StyleSheet.create({
  exRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#111' },
  exName: { fontSize: 13, color: '#666', flex: 1 },
  exTime: { fontSize: 13, color: '#555', fontVariant: ['tabular-nums'] },
});

const poster = StyleSheet.create({
  header: { paddingTop: 64, paddingHorizontal: 24, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottomWidth: 1, borderBottomColor: '#111' },
  brand: { fontSize: 10, fontWeight: '800', letterSpacing: 7, color: '#fff' },
  phase: { fontSize: 16, fontWeight: '700', letterSpacing: 5, color: '#fff', marginTop: 6 },
  histBtn: { paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#222' },
  histBtnText: { fontSize: 9, letterSpacing: 3, color: '#444' },
  slot: { paddingVertical: 20, paddingHorizontal: 24, alignItems: 'center' },
  artistName: { textAlign: 'center', textTransform: 'uppercase' },
  todayTag: { fontSize: 9, letterSpacing: 5, marginTop: 8, color: 'rgba(255,255,255,0.3)' },
  cardList: { paddingHorizontal: 20, paddingBottom: 4, paddingTop: 4 },
  lineupRow: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)', flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  lineupDropset: { fontSize: 11, color: '#555', fontVariant: ['tabular-nums'], marginTop: 3, textAlign: 'right' },
  lineupIdx: { fontSize: 10, color: '#555', fontVariant: ['tabular-nums'], letterSpacing: 1, width: 22 },
  lineupName: { fontSize: 15, fontWeight: '700', color: '#e8e8e8', letterSpacing: 1.5 },
  lineupMuscle: { fontSize: 9, color: '#555', letterSpacing: 3, marginTop: 4 },
  lineupWeight: { fontSize: 13, fontWeight: '600', color: '#888', letterSpacing: 0.5, fontVariant: ['tabular-nums'] },
  lineupSets: { fontSize: 12, color: '#999', fontVariant: ['tabular-nums'] },
  lineupRemove: { fontSize: 10, color: '#333', marginTop: 6 },
  lineupPrevRef: { fontSize: 10, color: '#ccc', marginTop: 4, fontVariant: ['tabular-nums'], letterSpacing: 0.3 },
  darkCard: { backgroundColor: '#0c0c18', borderRadius: 6, padding: 14, marginBottom: 8, borderLeftWidth: 2 },
  cardName: { fontSize: 13, fontWeight: '600', color: '#ccc', flex: 1 },
  cardBadge: { fontSize: 9, letterSpacing: 2, color: '#333', textTransform: 'uppercase' },
  cardMuscles: { fontSize: 11, color: '#333', marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },
  cardTarget: { fontSize: 12, color: '#555', marginTop: 6 },
  cardCue: { fontSize: 11, color: '#2a2a40', fontStyle: 'italic', marginTop: 4 },
  cardSets: { fontSize: 12, color: '#666', marginTop: 6 },
  coachBtn: { marginTop: 4, marginBottom: 12, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center' },
  coachBtnText: { fontSize: 11, letterSpacing: 5, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  weekCoachBtn: { margin: 16, paddingVertical: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center' },
  weekCoachBtnText: { fontSize: 11, letterSpacing: 5, color: '#fff', fontWeight: '700' },
  swapSheet: { backgroundColor: '#0f0f1a', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 24, borderTopWidth: 1, borderColor: '#1e1e30' },
  swapTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 5, color: '#444', marginBottom: 12 },
  swapSearch: { backgroundColor: '#16162a', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, fontSize: 14, color: '#ccc', marginBottom: 12 },
  swapOption: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#111' },
  swapOptName: { fontSize: 15, fontWeight: '500', color: '#ccc' },
  swapOptMuscles: { fontSize: 11, color: '#333', marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },
  swapEmpty: { fontSize: 13, color: '#333', paddingVertical: 16 },
  swapClose: { marginTop: 16, paddingVertical: 14, borderWidth: 1, borderColor: '#1e1e30', alignItems: 'center' },
  swapCloseText: { fontSize: 10, letterSpacing: 4, color: '#333' },
  footer: { padding: 16, paddingBottom: 32, backgroundColor: '#080810', borderTopWidth: 1, borderTopColor: '#0f0f18' },
  venueRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  venueLabel: { fontSize: 8, letterSpacing: 4, color: '#333', textTransform: 'uppercase' },
  venueChip: { paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#1a1a2e' },
  venueChipActive: { borderColor: '#fff' },
  venueChipText: { fontSize: 9, letterSpacing: 2, color: '#333' },
  venueChipTextActive: { color: '#fff' },
  startBtn: { paddingVertical: 18, alignItems: 'center', borderWidth: 1, borderColor: '#222' },
  startBtnText: { color: '#fff', fontSize: 11, letterSpacing: 7, fontWeight: '600' },
  cardRemove: { position: 'absolute', top: 8, right: 8, padding: 6 },
  cardRemoveText: { fontSize: 11, color: '#333' },
  addExBtn: { marginTop: 4, marginBottom: 12, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center' },
  addExBtnText: { fontSize: 10, letterSpacing: 5, color: 'rgba(255,255,255,0.35)', fontWeight: '600' },
  // Headliner slot
  headlinerSlot: { paddingVertical: 32, paddingHorizontal: 24, alignItems: 'center' },
  headlinerLabel: { fontSize: 9, letterSpacing: 6, color: 'rgba(255,255,255,0.25)', marginBottom: 16, textTransform: 'uppercase' },
  headlinerBox: { alignItems: 'center', marginBottom: 12 },
  headlinerSub: { fontSize: 9, letterSpacing: 5, color: 'rgba(255,255,255,0.2)', marginTop: 8, textTransform: 'uppercase' },
  // Supporting acts
  supportSection: { paddingHorizontal: 24, paddingBottom: 24 },
  supportDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 20 },
  supportRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 14 },
  supportDay: { fontSize: 8, letterSpacing: 3, color: '#555', width: 28, textTransform: 'uppercase' },
  supportName: { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: '#777', textTransform: 'uppercase', flex: 1 },
  supportDone: { fontSize: 10, color: '#333' },
});

const week = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 8 },
  rowDone: { backgroundColor: '#f5f5f5' },
  rowToday: { borderLeftWidth: 3, borderLeftColor: '#333' },
  dayName: { fontSize: 16, fontWeight: '600', color: '#222' },
  dayNameDone: { color: '#bbb' },
  chevron: { fontSize: 11, color: '#aaa' },
  cardList: { paddingHorizontal: 4, paddingBottom: 4 },
});

const swap = StyleSheet.create({
  btn: { marginTop: 10, alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 14, borderWidth: 1, borderColor: '#ddd', borderRadius: 6 },
  btnText: { fontSize: 12, color: '#888' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 24, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '600' },
  sheetSub: { fontSize: 14, color: '#999', lineHeight: 20 },
  closeBtn: { marginTop: 8, paddingVertical: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, alignItems: 'center' },
  closeBtnText: { fontSize: 15, color: '#666' },
  option: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  optionName: { fontSize: 15, fontWeight: '500', color: '#222' },
  optionMuscles: { fontSize: 12, color: '#999', marginTop: 2 },
});

const card = StyleSheet.create({
  container: { backgroundColor: '#0e0e1c', borderRadius: 4, padding: 14, marginBottom: 8, borderLeftWidth: 2, borderLeftColor: '#1a1a2e' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  name: { fontSize: 13, fontWeight: '700', flex: 1, color: '#ccc', textTransform: 'uppercase', letterSpacing: 1 },
  badge: { fontSize: 9, color: '#333', letterSpacing: 2, textTransform: 'uppercase' },
  muscles: { fontSize: 10, color: '#333', marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },
  target: { fontSize: 11, color: '#444', marginBottom: 8, marginTop: 4 },
  setRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  setNum: { width: 24, fontSize: 11, color: '#333', fontWeight: '700', textAlign: 'center', marginRight: 4, fontVariant: ['tabular-nums'] },
  setInner: { flexDirection: 'row', alignItems: 'center' },
  input: { width: 56, fontSize: 14, textAlign: 'center', color: '#fff' },
  sep: { fontSize: 13, color: '#333', marginHorizontal: 4 },
  rpeInput: { width: 44 },
  dropGroup: { flexDirection: 'row', alignItems: 'center' },
  arrow: { fontSize: 13, color: '#333', marginHorizontal: 6 },
  dropRemove: { fontSize: 11, color: '#2a2a40', marginLeft: 4 },
  dropBtn: { marginLeft: 10, justifyContent: 'center' },
  dropBtnText: { fontSize: 11, color: '#5a2a2a' },
  removeBtn: { width: 28, alignItems: 'center', marginLeft: 4 },
  removeBtnText: { color: '#2a2a40', fontSize: 14 },
  confirmBtn: { width: 28, height: 28, borderRadius: 2, borderWidth: 1.5, borderColor: '#2a2a40', alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  confirmBtnDone: { backgroundColor: '#34C759', borderColor: '#34C759' },
  confirmBtnText: { fontSize: 13, color: '#2a2a40', fontWeight: '700' },
  confirmBtnTextDone: { color: '#fff' },
  addSet: { marginTop: 4 },
  addSetText: { fontSize: 11, color: '#2a2a40', letterSpacing: 1 },
  notes: { fontSize: 13, color: '#444', marginTop: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a2e', paddingVertical: 4 },
  cue: { fontSize: 11, color: '#1e1e30', marginTop: 4 },
  exTime: { fontSize: 11, color: '#333', marginTop: 4 },
  swapHint: { fontSize: 9, color: '#2a4a7a', letterSpacing: 1, marginTop: 2 },
});

// Active session card — dark concert poster treatment
const aCard = StyleSheet.create({
  container: { backgroundColor: '#0e0e1c', borderRadius: 4, borderLeftWidth: 2, borderLeftColor: '#1a1a2e', padding: 16, marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  name: { fontSize: 14, fontWeight: '800', flex: 1, color: '#e8e8e8', textTransform: 'uppercase', letterSpacing: 1.5 },
  badge: { fontSize: 9, color: '#333', letterSpacing: 2, textTransform: 'uppercase' },
  muscles: { fontSize: 10, color: '#333', marginTop: 2, textTransform: 'uppercase', letterSpacing: 1.5 },
  target: { fontSize: 12, color: '#555', marginBottom: 10, marginTop: 6 },
  setRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  setNum: { width: 28, fontSize: 11, color: '#333', fontWeight: '700', letterSpacing: 1, textAlign: 'center', marginRight: 4, fontVariant: ['tabular-nums'] },
  setNumConfirmed: { color: '#34C759' },
  setInner: { flexDirection: 'row', alignItems: 'center' },
  input: {
    width: 56,
    backgroundColor: '#131328',
    borderWidth: 1,
    borderColor: '#1e1e30',
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    color: '#fff',
  },
  sep: { fontSize: 13, color: '#333', marginHorizontal: 4 },
  rpeInput: { width: 44 },
  dropGroup: { flexDirection: 'row', alignItems: 'center' },
  arrow: { fontSize: 13, color: '#333', marginHorizontal: 6 },
  dropRemove: { fontSize: 11, color: '#2a2a40', marginLeft: 4 },
  dropBtn: { marginLeft: 10, justifyContent: 'center' },
  dropBtnText: { fontSize: 11, color: '#5a2a2a', letterSpacing: 0.5 },
  removeBtn: { width: 28, alignItems: 'center', marginLeft: 4 },
  removeBtnText: { color: '#2a2a40', fontSize: 14 },
  confirmBtn: { width: 28, height: 28, borderRadius: 2, borderWidth: 1.5, borderColor: '#2a2a40', alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  confirmBtnDone: { backgroundColor: '#34C759', borderColor: '#34C759' },
  confirmBtnText: { fontSize: 13, color: '#2a2a40', fontWeight: '700' },
  confirmBtnTextDone: { color: '#fff' },
  addSet: { marginTop: 4 },
  addSetText: { fontSize: 11, color: '#2a2a40', letterSpacing: 2, textTransform: 'uppercase' },
  notes: { fontSize: 13, color: '#555', marginTop: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a2e', paddingVertical: 6 },
  cue: { fontSize: 11, color: '#555', marginTop: 6 },
  prevRef: { fontSize: 10, color: '#ccc', marginTop: 3, letterSpacing: 0.3, fontVariant: ['tabular-nums'] },
  exTime: { fontSize: 11, color: '#333', marginTop: 6 },
  swapHint: { fontSize: 9, color: '#2a4a7a', letterSpacing: 1, marginTop: 2, textTransform: 'uppercase' },
  // Plate calculator
  plateCalc: { backgroundColor: '#0a0a18', borderRadius: 3, padding: 10, marginBottom: 10 },
  plateRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 6 },
  plateLabel: { fontSize: 10, color: '#444', letterSpacing: 1, textTransform: 'uppercase' as const, width: 28 },
  plateInput: { width: 44, backgroundColor: '#131328', borderWidth: 1, borderColor: '#1e1e30', borderRadius: 3, paddingVertical: 4, paddingHorizontal: 4, fontSize: 12, fontWeight: '600' as const, textAlign: 'center' as const, color: '#aaa' },
  plateResult: { fontSize: 12, color: '#888', letterSpacing: 0.3, fontVariant: ['tabular-nums' as const] },
  // RPE guide
  rpeGuideBtn: { marginLeft: 6, width: 18, alignItems: 'center' as const, justifyContent: 'center' as const },
  rpeGuideBtnText: { fontSize: 11, color: '#2a2a40' },
  rpeGuide: { marginTop: 6, backgroundColor: '#0a0a18', borderRadius: 3, padding: 10 },
  rpeGuideRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 3, gap: 8 },
  rpeGuideNum: { width: 44, fontSize: 10, color: '#666', fontWeight: '700' as const, letterSpacing: 0.5 },
  rpeGuideRir: { width: 40, fontSize: 10, color: '#888', fontVariant: ['tabular-nums' as const] },
  rpeGuideDesc: { fontSize: 10, color: '#555', flex: 1 },
});

const drag = StyleSheet.create({
  handle: { backgroundColor: '#0e0e1c', borderTopLeftRadius: 4, borderTopRightRadius: 4, paddingVertical: 8, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1a1a2e', flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: -4 },
  handleDots: { fontSize: 13, color: '#333', letterSpacing: 2 },
  handleLabel: { fontSize: 9, color: '#333', letterSpacing: 2, textTransform: 'uppercase' },
  removeBtn: { position: 'absolute', right: 12, padding: 4 },
  removeBtnText: { fontSize: 13, color: '#2a2a40' },
});

const diag = StyleSheet.create({
  toggle: {
    marginTop: 4,
    paddingVertical: 3,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
  },
  toggleText: { fontSize: 11, color: '#888' },
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
    backgroundColor: '#0e0e1c',
    borderWidth: 1,
    borderColor: '#2a2a40',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    maxWidth: 300,
  },
  label: { fontSize: 9, color: '#555', letterSpacing: 4, textTransform: 'uppercase' },
  icon:  { fontSize: 72, lineHeight: 90 },
  name:  { fontSize: 20, fontWeight: '700', color: '#fff', letterSpacing: 1, textAlign: 'center' },
  flavour: { fontSize: 13, color: '#777', textAlign: 'center', lineHeight: 20, fontStyle: 'italic' },
  hint:  { fontSize: 10, color: '#333', letterSpacing: 2, textTransform: 'uppercase', marginTop: 8 },
});

