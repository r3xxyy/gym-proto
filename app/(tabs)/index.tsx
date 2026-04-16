import { useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import {
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

// ─── Types ───────────────────────────────────────────────────────────────────

type Drop = { weight: string; reps: string };
type Set = { weight: string; reps: string; rpe: string; drops: Drop[] };

type Exercise = {
  id: string;
  name: string;
  muscles: string;
  type: 'Compound' | 'Iso';
  target: string;
  cue: string;
  sets: Set[];
  startedAt?: number;
  endedAt?: number;
};

// ─── Data ────────────────────────────────────────────────────────────────────

const PUSH_EXERCISES: Omit<Exercise, 'sets'>[] = [
  {
    id: '1',
    name: 'Flat DB Bench Press',
    muscles: 'Mid Chest, Triceps',
    type: 'Compound',
    target: '40–42.5 kg × 6–8 × 3',
    cue: 'Scap retracted • full ROM • controlled eccentric',
  },
  {
    id: '2',
    name: 'Seated Hammer Curl (DB)',
    muscles: 'Brachialis, Biceps',
    type: 'Iso',
    target: '20–22.5 kg × 4–6',
    cue: 'Neutral grip • no torso swing • peak contraction',
  },
  {
    id: '3',
    name: 'Incline DB Bench Press',
    muscles: 'Upper Chest, Triceps',
    type: 'Compound',
    target: '40–42.5 kg × 4–6 × 3',
    cue: 'Deep stretch • eye-line press • strict tempo',
  },
  {
    id: '4',
    name: 'Incline Supinated DB Curl',
    muscles: 'Biceps Long Head',
    type: 'Iso',
    target: '20–22.5 kg × 5',
    cue: 'Elbows pinned • full stretch • 3s eccentric',
  },
  {
    id: '5',
    name: 'Decline Chest Press (Machine)',
    muscles: 'Lower Chest, Triceps',
    type: 'Compound',
    target: '55–57.5 kg × 6 × 3',
    cue: 'Downward press path • lower pec drive • no lockout bounce',
  },
  {
    id: '6',
    name: 'Preacher Curl (Machine/DB)',
    muscles: 'Biceps Short Head',
    type: 'Iso',
    target: '50–55 kg × 6',
    cue: 'Fixed elbow • squeeze peak • slow negative',
  },
  {
    id: '7',
    name: 'Pec Deck Fly',
    muscles: 'Chest',
    type: 'Iso',
    target: '80–85 kg × 10–12 + dropset × 2',
    cue: 'Full contraction • 1s hold • controlled stretch',
  },
];

const LEG_A_EXERCISES: Omit<Exercise, 'sets'>[] = [
  {
    id: 'la1',
    name: 'Hack Squat / Pendulum',
    muscles: 'Quads, Glutes',
    type: 'Compound',
    target: '80 kg × 6–8 × 3',
    cue: 'Knees forward • full depth • no bounce • constant tension',
  },
  {
    id: 'la2',
    name: 'Dumbbell Romanian Deadlift',
    muscles: 'Hamstrings, Glutes',
    type: 'Compound',
    target: '40 kg each × 8 × 3',
    cue: 'Hips back • deep hamstring stretch • neutral spine • slow eccentric',
  },
  {
    id: 'la3',
    name: 'Cable Pull-Through',
    muscles: 'Glutes, Hamstrings',
    type: 'Compound',
    target: '50 kg × 10–12 × 2–3',
    cue: 'Hinge clean • glutes finish • no lower back drive • pause at lockout',
  },
  {
    id: 'la4',
    name: 'Hip Thrust (Machine/Barbell)',
    muscles: 'Glute Maximus',
    type: 'Compound',
    target: '80 kg × 8–10 × 3',
    cue: 'Full lockout • 1–2s squeeze • ribs down • no hyperextension',
  },
  {
    id: 'la5',
    name: 'Seated Leg Curl',
    muscles: 'Hamstrings',
    type: 'Iso',
    target: '130–140 kg × 10–12 + dropset × 2',
    cue: 'Full stretch • hard squeeze • 3s eccentric • hips pinned',
  },
  {
    id: 'la6',
    name: 'Seated Calf Raise',
    muscles: 'Gastrocnemius',
    type: 'Iso',
    target: '15 kg × 10–12 + dropset × 2',
    cue: 'Deep stretch • pause top • slow controlled descent',
  },
  {
    id: 'la7',
    name: 'Cable Crunch',
    muscles: 'Abs',
    type: 'Iso',
    target: '65–75 kg × 12–15 × 2–3',
    cue: 'Ribs to pelvis • full spinal flexion • controlled return',
  },
];

const PULL_EXERCISES: Omit<Exercise, 'sets'>[] = [
  { id: 'pu1', name: 'Weighted Pull-Ups / Assisted Pull-Ups', muscles: 'Lats, Upper Back, Biceps', type: 'Compound', target: 'BW × 6–8 × 3', cue: 'Dead hang • chest up • controlled eccentric' },
  { id: 'pu2', name: 'Chest-Supported Row', muscles: 'Mid Back, Lats', type: 'Compound', target: '70–75 kg × 8 × 3', cue: 'Elbows drive back • scap retract • no torso lift' },
  { id: 'pu3', name: 'Lat Pulldown', muscles: 'Lats', type: 'Compound', target: '70–80 kg × 8 × 3', cue: 'Elbows tucked • stretch at top • no swing' },
  { id: 'pu4', name: 'Seated Cable Row', muscles: 'Mid Back', type: 'Compound', target: '70–75 kg × 10 × 3', cue: 'Elbow to hip • forward stretch • constant tension' },
  { id: 'pu5', name: 'Rope Triceps Pushdown', muscles: 'Triceps', type: 'Iso', target: '45–55 kg × 8 + dropset × 2', cue: 'Elbows pinned • hard lockout • slow return' },
  { id: 'pu6', name: 'Supinated Single-Arm Pushdown', muscles: 'Triceps', type: 'Iso', target: '18–22 kg × 6–8 + dropset × 2', cue: 'Wrist stacked • full stretch • no shoulder shift' },
  { id: 'pu7', name: 'Cable Crunch', muscles: 'Abs', type: 'Iso', target: '60–70 kg × 12–15 × 2–3', cue: 'Ribs down • spinal flexion • controlled return' },
];

const SHOULDER_EXERCISES: Omit<Exercise, 'sets'>[] = [
  { id: 'sh1', name: 'Shoulder Press (Machine/Plate)', muscles: 'Anterior Delt, Triceps', type: 'Compound', target: '50–55 kg × 6–8 × 3', cue: 'Vertical path • ribs down • no leg drive' },
  { id: 'sh2', name: 'Chest-Supported Rear Delt Row', muscles: 'Rear Delt', type: 'Iso', target: '30–35 kg × 10 × 3', cue: 'Wide arc • rear delt lead • no traps' },
  { id: 'sh3', name: 'Seated DB Lateral Raise', muscles: 'Lateral Delt', type: 'Iso', target: '17.5–20 kg × 8–10 + dropset × 2', cue: 'Pinky up • pause top • slow descent' },
  { id: 'sh4', name: 'Cable Rear Delt Pull (Bow & Arrow)', muscles: 'Rear Delt', type: 'Iso', target: '30–40 kg × 8', cue: 'Eye-line finish • torso fixed • stretch controlled' },
  { id: 'sh5', name: 'Shoulder Raise Machine', muscles: 'Lateral Delt', type: 'Iso', target: 'kg × 8–10 + dropset × 2', cue: 'Constant tension • no hip shift' },
  { id: 'sh6', name: 'Tricep Machine Extension', muscles: 'Triceps', type: 'Iso', target: 'kg × 10–12 + dropset × 2', cue: 'Deep stretch • full lockout' },
];

const LEG_B_EXERCISES: Omit<Exercise, 'sets'>[] = [
  { id: 'lb1', name: 'Leg Press', muscles: 'Quads, Glutes', type: 'Compound', target: '110–130 kg × 10 × 3', cue: 'Full depth • knees forward • no lockout snap' },
  { id: 'lb2', name: 'Bulgarian Split Squat (DB)', muscles: 'Quads, Glutes', type: 'Compound', target: 'kg × 8–10 × 3', cue: 'Upright torso • knee forward • balance controlled' },
  { id: 'lb3', name: 'Lying / Seated Leg Curl', muscles: 'Hamstrings', type: 'Iso', target: 'kg × 10–12 + dropset × 2', cue: 'Full stretch • squeeze peak • slow eccentric' },
  { id: 'lb4', name: 'Hip Thrust', muscles: 'Glutes', type: 'Compound', target: 'kg × 8–10 × 3', cue: 'Full lockout • pause top • no lumbar extension' },
  { id: 'lb5', name: 'Leg Extension', muscles: 'Quads', type: 'Iso', target: 'kg × 10–12 + dropset × 2', cue: 'Hard lockout • slow negative' },
  { id: 'lb6', name: 'Seated Calf Raise', muscles: 'Calves', type: 'Iso', target: 'kg × 12–15 + dropset × 2', cue: 'Deep stretch • pause top' },
  { id: 'lb7', name: 'Cable Crunch', muscles: 'Abs', type: 'Iso', target: '60–70 kg × 12–15 × 2–3', cue: 'Ribs down • full flexion • controlled return' },
];

const SWAP_POOL: Omit<Exercise, 'sets'>[] = [
  // Chest
  { id: 'sp_c1',  name: 'Flat DB Bench Press',                     muscles: 'Mid Chest, Triceps',              type: 'Compound', target: '', cue: 'Scap retracted • full ROM • controlled eccentric' },
  { id: 'sp_c2',  name: 'Incline DB Bench Press',                   muscles: 'Upper Chest, Triceps',            type: 'Compound', target: '', cue: 'Deep stretch • eye-line press • strict tempo' },
  { id: 'sp_c3',  name: 'Decline Chest Press (Machine)',            muscles: 'Lower Chest, Triceps',            type: 'Compound', target: '', cue: 'Downward press path • lower pec drive • no lockout bounce' },
  { id: 'sp_c4',  name: 'Plate-Loaded Flat Chest Press',            muscles: 'Mid Chest, Triceps',              type: 'Compound', target: '', cue: 'Scap retracted • full ROM • constant tension' },
  { id: 'sp_c5',  name: 'Plate-Loaded Incline Chest Press',         muscles: 'Upper Chest, Triceps',            type: 'Compound', target: '', cue: 'Deep stretch • upper pec drive • controlled eccentric' },
  { id: 'sp_c6',  name: 'Pec Deck Fly',                             muscles: 'Mid Chest, Triceps',              type: 'Iso',      target: '', cue: 'Full contraction • 1s hold • controlled stretch' },
  { id: 'sp_c7',  name: 'Cable Fly (Converging / Downward)',        muscles: 'Lower Chest, Mid Chest',          type: 'Iso',      target: '', cue: 'Arms arc down • squeeze at bottom • constant tension' },
  // Back — Vertical Pull
  { id: 'sp_bv1', name: 'Weighted Pull-Ups',                        muscles: 'Lats, Upper Back, Biceps',        type: 'Compound', target: '', cue: 'Dead hang • chest up • controlled eccentric' },
  { id: 'sp_bv2', name: 'Bodyweight Pull-Ups',                      muscles: 'Lats, Upper Back, Biceps',        type: 'Compound', target: '', cue: 'Dead hang • chest up • controlled eccentric' },
  { id: 'sp_bv3', name: 'Lat Pulldown (Standard)',                  muscles: 'Lats, Biceps',                    type: 'Compound', target: '', cue: 'Elbows tucked • stretch at top • no swing' },
  { id: 'sp_bv4', name: 'Diverging Lat Pulldown (Neutral Grip)',    muscles: 'Lats, Biceps',                    type: 'Compound', target: '', cue: 'Neutral grip • elbows wide • full lat stretch' },
  { id: 'sp_bv5', name: 'Horizontal Bar Lat Pulldown (Alt Grip)',   muscles: 'Lats, Biceps',                    type: 'Compound', target: '', cue: 'Alt grip • elbows tucked • full lat stretch' },
  { id: 'sp_bv6', name: 'Assorted Plate-Loaded Lat Machines',       muscles: 'Lats, Biceps',                    type: 'Compound', target: '', cue: 'Elbows tucked • stretch at top • constant tension' },
  // Back — Horizontal Pull
  { id: 'sp_bh1', name: 'Chest-Supported T-Bar Row',                muscles: 'Mid Back, Lats, Rear Delt',       type: 'Compound', target: '', cue: 'Elbows drive back • scap retract • no torso lift' },
  { id: 'sp_bh2', name: 'Chest-Supported DB Row',                   muscles: 'Mid Back, Lats',                  type: 'Compound', target: '', cue: 'Elbows drive back • scap retract • no torso lift' },
  { id: 'sp_bh3', name: 'Single-Arm DB Row',                        muscles: 'Mid Back, Lats',                  type: 'Compound', target: '', cue: 'Elbow to hip • full stretch • no rotation' },
  { id: 'sp_bh4', name: 'Seated Cable Row (Double Handle)',          muscles: 'Mid Back, Lats',                  type: 'Compound', target: '', cue: 'Elbow to hip • forward stretch • constant tension' },
  { id: 'sp_bh5', name: 'Seated Cable Row (Single-Arm)',            muscles: 'Mid Back, Lats',                  type: 'Compound', target: '', cue: 'Elbow to hip • forward stretch • constant tension' },
  { id: 'sp_bh6', name: 'Plate-Loaded Low Row Machine',             muscles: 'Mid Back, Lats',                  type: 'Compound', target: '', cue: 'Elbow to hip • scap retract • constant tension' },
  { id: 'sp_bh7', name: 'Bent-Over Barbell Row',                    muscles: 'Mid Back, Lats, Upper Back',      type: 'Compound', target: '', cue: 'Hinge position • elbows drive back • no torso swing' },
  // Shoulders — Press
  { id: 'sp_sp1', name: 'Plate-Loaded Shoulder Press',              muscles: 'Anterior Delt, Triceps',          type: 'Compound', target: '', cue: 'Vertical path • ribs down • no leg drive' },
  { id: 'sp_sp2', name: 'Shoulder Press Machine',                   muscles: 'Anterior Delt, Triceps',          type: 'Compound', target: '', cue: 'Vertical path • ribs down • no leg drive' },
  // Shoulders — Lateral / Rear
  { id: 'sp_sl1', name: 'Seated DB Lateral Raise',                  muscles: 'Lateral Delt',                    type: 'Iso',      target: '', cue: 'Pinky up • pause top • slow descent' },
  { id: 'sp_sl2', name: 'Standing Shoulder Raise Machine',          muscles: 'Lateral Delt',                    type: 'Iso',      target: '', cue: 'Constant tension • no hip shift' },
  { id: 'sp_sl3', name: 'Chest-Supported Rear Delt DB Row',         muscles: 'Rear Delt',                       type: 'Iso',      target: '', cue: 'Wide arc • rear delt lead • no traps' },
  { id: 'sp_sl4', name: 'Cable "Bow & Arrow" Rear Delt Pull',       muscles: 'Rear Delt',                       type: 'Iso',      target: '', cue: 'Eye-line finish • torso fixed • stretch controlled' },
  // Biceps
  { id: 'sp_bi1', name: 'Seated Hammer Curl (DB)',                  muscles: 'Brachialis, Biceps',              type: 'Iso',      target: '', cue: 'Neutral grip • no torso swing • peak contraction' },
  { id: 'sp_bi2', name: 'Incline Supinated DB Curl',                muscles: 'Biceps Long Head',                type: 'Iso',      target: '', cue: 'Elbows pinned • full stretch • 3s eccentric' },
  { id: 'sp_bi3', name: 'Preacher Curl (Machine)',                  muscles: 'Biceps Short Head',               type: 'Iso',      target: '', cue: 'Fixed elbow • squeeze peak • slow negative' },
  { id: 'sp_bi4', name: 'Cable Preacher Curl',                      muscles: 'Biceps Short Head',               type: 'Iso',      target: '', cue: 'Fixed elbow • squeeze peak • constant tension' },
  { id: 'sp_bi5', name: 'Cable Bar Curl',                           muscles: 'Biceps',                          type: 'Iso',      target: '', cue: 'Elbows pinned • full stretch • controlled eccentric' },
  // Triceps
  { id: 'sp_tr1', name: 'Double Rope Pushdown',                     muscles: 'Triceps',                         type: 'Iso',      target: '', cue: 'Elbows pinned • hard lockout • slow return' },
  { id: 'sp_tr2', name: 'Bar Pushdown',                             muscles: 'Triceps',                         type: 'Iso',      target: '', cue: 'Elbows pinned • hard lockout • slow return' },
  { id: 'sp_tr3', name: 'Supinated Single-Arm Pushdown',            muscles: 'Triceps',                         type: 'Iso',      target: '', cue: 'Wrist stacked • full stretch • no shoulder shift' },
  { id: 'sp_tr4', name: 'Triceps Cable Cross (Low Arc)',            muscles: 'Triceps',                         type: 'Iso',      target: '', cue: 'Low arc path • full lockout • constant tension' },
  { id: 'sp_tr5', name: 'Overhead Cable Extension',                 muscles: 'Triceps',                         type: 'Iso',      target: '', cue: 'Full stretch overhead • hard lockout • elbows in' },
  { id: 'sp_tr6', name: 'Machine Triceps Extension',                muscles: 'Triceps',                         type: 'Iso',      target: '', cue: 'Deep stretch • full lockout' },
  // Legs — Quads / Glutes
  { id: 'sp_lq1', name: 'Leg Press (Machine)',                      muscles: 'Quads, Glutes',                   type: 'Compound', target: '', cue: 'Full depth • knees forward • no lockout snap' },
  { id: 'sp_lq2', name: 'Hack Squat / Pendulum',                    muscles: 'Quads, Glutes',                   type: 'Compound', target: '', cue: 'Knees forward • full depth • constant tension' },
  { id: 'sp_lq3', name: 'Heel-Elevated Goblet Squat',               muscles: 'Quads, Glutes',                   type: 'Compound', target: '', cue: 'Heels elevated • upright torso • full depth' },
  { id: 'sp_lq4', name: 'Bulgarian Split Squat',                    muscles: 'Quads, Glutes',                   type: 'Compound', target: '', cue: 'Upright torso • knee forward • balance controlled' },
  { id: 'sp_lq5', name: 'Leg Extension (Machine)',                  muscles: 'Quads',                           type: 'Iso',      target: '', cue: 'Hard lockout • slow negative' },
  { id: 'sp_lq6', name: 'Hip Thrust (Machine)',                     muscles: 'Glutes',                          type: 'Compound', target: '', cue: 'Full lockout • pause top • no lumbar extension' },
  // Hamstrings / Posterior Chain
  { id: 'sp_lh1', name: 'Dumbbell Romanian Deadlift (RDL)',         muscles: 'Hamstrings, Glutes',              type: 'Compound', target: '', cue: 'Hips back • deep hamstring stretch • neutral spine • slow eccentric' },
  { id: 'sp_lh2', name: 'Seated Leg Curl',                          muscles: 'Hamstrings',                      type: 'Iso',      target: '', cue: 'Full stretch • hard squeeze • 3s eccentric • hips pinned' },
  { id: 'sp_lh3', name: 'Cable Pull-Through',                       muscles: 'Glutes, Hamstrings',              type: 'Compound', target: '', cue: 'Hinge clean • glutes finish • no lower back drive' },
  // Calves
  { id: 'sp_ca1', name: 'Seated Calf Raise',                        muscles: 'Calves',                          type: 'Iso',      target: '', cue: 'Deep stretch • pause top • slow controlled descent' },
  { id: 'sp_ca2', name: 'Standing Calf Raise',                      muscles: 'Calves',                          type: 'Iso',      target: '', cue: 'Deep stretch • pause top • slow controlled descent' },
  // Core
  { id: 'sp_co1', name: 'Cable Crunch',                             muscles: 'Abs',                             type: 'Iso',      target: '', cue: 'Ribs down • spinal flexion • controlled return' },
  { id: 'sp_co2', name: 'Ab Roller',                                muscles: 'Abs',                             type: 'Iso',      target: '', cue: 'Core braced • hips low • controlled return' },
  { id: 'sp_co3', name: 'Kettlebell Rotations',                     muscles: 'Abs',                             type: 'Iso',      target: '', cue: 'Core tight • controlled rotation • no hip shift' },
  // Other
  { id: 'sp_ot1', name: '3D Abductor Machine',                      muscles: 'Glutes',                          type: 'Iso',      target: '', cue: 'Full ROM • controlled return • no momentum' },
];

const WORKOUT_EXERCISES: Record<number, Omit<Exercise, 'sets'>[]> = {
  1: LEG_A_EXERCISES,
  2: PUSH_EXERCISES,
  3: PULL_EXERCISES,
  4: SHOULDER_EXERCISES,
  5: LEG_B_EXERCISES,
};

const SPLIT: Record<number, string> = {
  1: 'Leg A',
  2: 'Push Day',
  3: 'Pull Day',
  4: 'Boulder Shoulder',
  5: 'Leg B',
  6: 'Rest Day',
  0: 'Rest Day',
};

function getTodayWorkout() {
  return SPLIT[new Date().getDay()];
}

function formatTime(totalSeconds: number) {
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function initExercises(): Exercise[] {
  const day = new Date().getDay();
  const list = WORKOUT_EXERCISES[day] ?? [];
  return list.map(e => ({ ...e, sets: [{ weight: '', reps: '', rpe: '', drops: [] }] }));
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

function HistoryExerciseCard({ exercise }: { exercise: Exercise }) {
  const logged = exercise.sets.filter(s => s.weight || s.reps);
  if (logged.length === 0) return null;

  return (
    <View style={card.container}>
      <View style={card.header}>
        <Text style={card.name}>{exercise.name}</Text>
        <Text style={card.badge}>{exercise.type}</Text>
      </View>
      <Text style={card.muscles}>{exercise.muscles}</Text>
      <Text style={card.target}>Target: {exercise.target}</Text>
      {logged.map((s, i) => (
        <View key={i} style={card.setRow}>
          <Text style={card.setNum}>{i + 1}</Text>
          <Text style={histCard.setValue}>{s.weight || '—'} kg</Text>
          <Text style={card.sep}>×</Text>
          <Text style={histCard.setValue}>{s.reps || '—'} reps</Text>
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
    </View>
  );
}

// ─── Exercise Card ────────────────────────────────────────────────────────────

function ExerciseCard({
  exercise,
  onChange,
  onSwap,
  onConfirmSet,
}: {
  exercise: Exercise;
  onChange: (updated: Exercise) => void;
  onSwap?: () => void;
  onConfirmSet?: () => void;
}) {
  const [confirmedSets, setConfirmedSets] = useState<Set<number>>(new Set());
  function updateSet(si: number, field: 'weight' | 'reps', value: string) {
    const sets = exercise.sets.map((s, i) => i === si ? { ...s, [field]: value } : s);
    const now = Date.now();
    const startedAt = field === 'weight' && !exercise.startedAt ? now : exercise.startedAt;
    const endedAt = field === 'reps' && value ? now : exercise.endedAt;
    onChange({ ...exercise, sets, startedAt, endedAt });
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
    <View style={card.container}>
      <View style={card.header}>
        {onSwap ? (
          <TouchableOpacity onPress={onSwap} style={{ flex: 1 }}>
            <Text style={[card.name, { color: '#007AFF' }]}>{exercise.name}</Text>
            <Text style={card.swapHint}>tap to swap</Text>
          </TouchableOpacity>
        ) : (
          <Text style={card.name}>{exercise.name}</Text>
        )}
        <Text style={card.badge}>{exercise.type}</Text>
      </View>
      <Text style={card.muscles}>{exercise.muscles.split(',')[0].trim()}</Text>
      <Text style={card.target}>Target: {exercise.target}</Text>

      {exercise.sets.map((set, si) => (
        <View key={si} style={card.setRow}>
          <Text style={card.setNum}>{si + 1}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={card.setInner}>
              {/* Main set */}
              <TextInput
                style={card.input}
                value={set.weight}
                onChangeText={v => updateSet(si, 'weight', v)}
                keyboardType="decimal-pad"
                placeholder="kg"
                placeholderTextColor="#ccc"
              />
              <Text style={card.sep}>×</Text>
              <TextInput
                style={card.input}
                value={set.reps}
                onChangeText={v => updateSet(si, 'reps', v)}
                keyboardType="number-pad"
                placeholder="reps"
                placeholderTextColor="#ccc"
              />
              {/* Drop sets */}
              {set.drops.map((drop, di) => (
                <View key={di} style={card.dropGroup}>
                  <Text style={card.arrow}>→</Text>
                  <TextInput
                    style={card.input}
                    value={drop.weight}
                    onChangeText={v => updateDrop(si, di, 'weight', v)}
                    keyboardType="decimal-pad"
                    placeholder="kg"
                    placeholderTextColor="#ccc"
                  />
                  <Text style={card.sep}>×</Text>
                  <TextInput
                    style={card.input}
                    value={drop.reps}
                    onChangeText={v => updateDrop(si, di, 'reps', v)}
                    keyboardType="number-pad"
                    placeholder="reps"
                    placeholderTextColor="#ccc"
                  />
                  <TouchableOpacity onPress={() => removeDrop(si, di)}>
                    <Text style={card.dropRemove}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {/* + Drop */}
              <TouchableOpacity style={card.dropBtn} onPress={() => addDrop(si)}>
                <Text style={card.dropBtnText}>+ Drop</Text>
              </TouchableOpacity>
              {/* RPE — one field for the whole set */}
              <Text style={card.sep}>@</Text>
              <TextInput
                style={[card.input, card.rpeInput]}
                value={set.rpe}
                onChangeText={v => updateRpe(si, v)}
                keyboardType="decimal-pad"
                placeholder="RPE"
                placeholderTextColor="#ccc"
              />
            </View>
          </ScrollView>
          {/* Confirm set */}
          <TouchableOpacity
            onPress={() => {
              setConfirmedSets(prev => new Set([...prev, si]));
              onConfirmSet?.();
            }}
            style={[card.confirmBtn, confirmedSets.has(si) && card.confirmBtnDone]}
          >
            <Text style={[card.confirmBtnText, confirmedSets.has(si) && card.confirmBtnTextDone]}>✓</Text>
          </TouchableOpacity>
          {/* Remove set */}
          <TouchableOpacity onPress={() => removeSet(si)} style={card.removeBtn}>
            <Text style={card.removeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity style={card.addSet} onPress={addSet}>
        <Text style={card.addSetText}>+ Add Set</Text>
      </TouchableOpacity>

      <Text style={card.cue}>{exercise.cue}</Text>
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
}: {
  exercise: Exercise;
  index: number;
  total: number;
  onChange: (updated: Exercise) => void;
  onSwap: () => void;
  onRemove: () => void;
  onReorder: (from: number, to: number) => void;
  onConfirmSet?: () => void;
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
        <ExerciseCard exercise={exercise} onChange={onChange} onSwap={onSwap} onConfirmSet={onConfirmSet} />
      </Animated.View>
    </GestureDetector>
  );
}

// ─── History Screen ───────────────────────────────────────────────────────────

const WORKOUT_ORDER = ['Leg A', 'Push Day', 'Pull Day', 'Boulder Shoulder', 'Leg B'];

function HistoryScreen({ history, onBack, onDelete }: { history: HistoryEntry[]; onBack: () => void; onDelete: (id: string) => void }) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [openDates, setOpenDates] = useState<Record<string, boolean>>({});

  function toggleGroup(name: string) {
    setOpenGroups(prev => ({ ...prev, [name]: !prev[name] }));
  }

  function toggleDate(key: string) {
    setOpenDates(prev => ({ ...prev, [key]: !prev[key] }));
  }

  // Group history by workout name
  const grouped: Record<string, HistoryEntry[]> = {};
  for (const entry of history) {
    if (!grouped[entry.workoutName]) grouped[entry.workoutName] = [];
    grouped[entry.workoutName].push(entry);
  }

  const categories = WORKOUT_ORDER.filter(name => grouped[name]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.historyHeader}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.historyBack}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.historyTitle}>History</Text>
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
                    renderRightActions={() => (
                      <TouchableOpacity style={coll.deleteBtn} onPress={() => onDelete(entry.id)}>
                        <Text style={coll.deleteBtnText}>Delete</Text>
                      </TouchableOpacity>
                    )}
                  >
                    {/* Date row */}
                    <TouchableOpacity style={coll.dateRow} onPress={() => toggleDate(dateKey)}>
                      <Text style={coll.dateText}>{entry.date}</Text>
                      <Text style={coll.dateMeta}>
                        {formatTime(entry.duration + entry.restTime)}
                      </Text>
                      <Text style={coll.chevronSm}>{openDates[dateKey] ? '▲' : '▼'}</Text>
                    </TouchableOpacity>

                    {/* Exercise cards */}
                    {openDates[dateKey] && (
                      <View style={coll.cardList}>
                        {entry.exercises.map(ex => (
                          <HistoryExerciseCard key={ex.id} exercise={ex} />
                        ))}
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

// ─── Types ───────────────────────────────────────────────────────────────────

type HistoryEntry = {
  id: string;
  date: string;
  workoutName: string;
  duration: number;
  restTime: number;
  exercises: Exercise[];
};

function getSwapOptions(exerciseId: string, current: Omit<Exercise, 'sets'>[]): Omit<Exercise, 'sets'>[] {
  return SWAP_POOL.filter(s => s.id !== exerciseId && !current.some(e => e.id === s.id && e.id !== exerciseId));
}

const WEEK_DAYS = [1, 2, 3, 4, 5];

const POSTER_NAMES: Record<number, string> = {
  1: 'TERRA FIRMA',
  2: 'OVERRIDE',
  3: 'UNDERTOW',
  4: 'BOULDER SHOULDER',
  5: 'AFTERMATH',
};

const POSTER_COLORS: Record<number, string> = {
  1: '#FF006E',
  2: '#00D4FF',
  3: '#BF5FFF',
  4: '#FFD700',
  5: '#39FF14',
};

// Typography matched to workout tone
const DAY_TEXT_STYLES: Record<number, object> = {
  1: { fontSize: 64, fontWeight: '900', letterSpacing: -6 },                      // granite slab — immovable leg A
  2: { fontSize: 40, fontWeight: '800', letterSpacing: -1, fontStyle: 'italic' }, // charging forward — push day
  3: { fontSize: 34, fontWeight: '300', letterSpacing: 9, fontStyle: 'italic' },  // flowing current — pull day
  4: { fontSize: 13, fontWeight: '600', letterSpacing: 14 },                      // precise chisel — shoulder isolation
  5: { fontSize: 52, fontWeight: '100', letterSpacing: 3 },                       // depleted but standing — leg B
};

// one box only
const BOXED_DAYS = new Set([1]);

function formatSessionForCoach(
  workoutName: string,
  date: string,
  duration: number,
  restTime: number,
  exs: Exercise[]
): string {
  const lines: string[] = [
    `WORKOUT: ${workoutName}`,
    `DATE: ${date}`,
    `ACTIVE: ${formatTime(duration)}  |  REST: ${formatTime(restTime)}`,
    ``,
  ];

  exs.forEach(ex => {
    lines.push(`${ex.name} [${ex.muscles}] — ${ex.type}`);
    lines.push(`Target: ${ex.target}`);
    ex.sets.forEach((s, i) => {
      let row = `  Set ${i + 1}: ${s.weight}kg × ${s.reps}`;
      if (s.drops.length > 0) {
        row += `  →  ${s.drops.map(d => `${d.weight}kg × ${d.reps}`).join(' → ')}`;
      }
      lines.push(row);
    });
    lines.push('');
  });

  lines.push(`---`);
  lines.push(`Analyse this session:`);
  lines.push(`1. Performance notes — what was strong, what dropped`);
  lines.push(`2. Targets for my next ${workoutName} session`);
  lines.push(`3. Any recovery or programming flags`);

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
  const lastWeekEntry = history
    .filter(h => h.workoutName === workoutName)
    .slice(1, 2)[0]; // skip most recent (this week), take previous

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

const HISTORY_PATH = FileSystem.documentDirectory + 'history.json';
const BW_PATH = FileSystem.documentDirectory + 'bodyweight.json';

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

export default function HomeScreen() {
  const [screen, setScreen] = useState<'home' | 'active' | 'summary' | 'history'>('home');
  const [seconds, setSeconds] = useState(0);
  const [totalSessionSecs, setTotalSessionSecs] = useState(0); // cumulative from start, never pauses
  const [paused, setPaused] = useState(false);
  const [restSeconds, setRestSeconds] = useState(0);       // total rest (for history)
  const [currentRestSecs, setCurrentRestSecs] = useState(0); // per-set rest display
  const [finalSeconds, setFinalSeconds] = useState(0);
  const [finalRest, setFinalRest] = useState(0);
  const [bodyweight, setBodyweight] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [weekPlan, setWeekPlan] = useState<Record<number, Omit<Exercise, 'sets'>[]>>({
    1: [...LEG_A_EXERCISES],
    2: [...PUSH_EXERCISES],
    3: [...PULL_EXERCISES],
    4: [...SHOULDER_EXERCISES],
    5: [...LEG_B_EXERCISES],
  });
  const [expandedDay, setExpandedDay] = useState<number | null>(() => {
    const d = new Date().getDay();
    return d >= 1 && d <= 5 ? d : 1;
  });
  const [swapContext, setSwapContext] = useState<{ day: number; exerciseId: string | null } | null>(null);
  const [activeSwapId, setActiveSwapId] = useState<string | null>(null); // '__add__' = add mode
  const [swapQuery, setSwapQuery] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const completedDays = [...new Set(history.map(h => WORKOUT_TO_DAY[h.workoutName]).filter(Boolean))];

  const workoutInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const restInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const totalInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartRef = useRef<number>(0);
  const activeStartRef = useRef<number>(0);   // timestamp when current active period began
  const activeAccRef = useRef<number>(0);     // accumulated active seconds before current period
  const restStartRef = useRef<number>(0);     // timestamp when current rest period began
  const restAccRef = useRef<number>(0);       // accumulated rest seconds before current period
  const todayWorkout = getTodayWorkout();

  function startWorkout() {
    const todayDay = new Date().getDay();
    const plan = weekPlan[todayDay] ?? [];
    setSeconds(0);
    setTotalSessionSecs(0);
    setRestSeconds(0);
    setPaused(false);
    activeAccRef.current = 0;
    activeStartRef.current = Date.now();
    sessionStartRef.current = Date.now();
    restAccRef.current = 0;
    setExercises(plan.map(e => ({ ...e, sets: [{ weight: '', reps: '', rpe: '', drops: [] }] })));
    setScreen('active');
    workoutInterval.current = setInterval(() => {
      setSeconds(activeAccRef.current + Math.round((Date.now() - activeStartRef.current) / 1000));
    }, 1000);
    totalInterval.current = setInterval(() => {
      setTotalSessionSecs(Math.round((Date.now() - sessionStartRef.current) / 1000));
    }, 1000);
  }

  function toggleRest() {
    if (!paused) {
      // Manual rest button — pause workout, start rest from 0
      activeAccRef.current += Math.round((Date.now() - activeStartRef.current) / 1000);
      if (workoutInterval.current) clearInterval(workoutInterval.current);
      setCurrentRestSecs(0);
      restStartRef.current = Date.now();
      restInterval.current = setInterval(() => {
        const cur = Math.round((Date.now() - restStartRef.current) / 1000);
        setCurrentRestSecs(cur);
        setRestSeconds(restAccRef.current + cur);
      }, 1000);
      setPaused(true);
    } else {
      // Continue — end rest, resume workout
      restAccRef.current += Math.round((Date.now() - restStartRef.current) / 1000);
      if (restInterval.current) clearInterval(restInterval.current);
      setCurrentRestSecs(0);
      activeStartRef.current = Date.now();
      workoutInterval.current = setInterval(() => {
        setSeconds(activeAccRef.current + Math.round((Date.now() - activeStartRef.current) / 1000));
      }, 1000);
      setPaused(false);
    }
  }

  function startFreshRest() {
    // Called on each ✓ — accumulates current rest and restarts from 0
    if (paused) {
      restAccRef.current += Math.round((Date.now() - restStartRef.current) / 1000);
      if (restInterval.current) clearInterval(restInterval.current);
    } else {
      activeAccRef.current += Math.round((Date.now() - activeStartRef.current) / 1000);
      if (workoutInterval.current) clearInterval(workoutInterval.current);
      setPaused(true);
    }
    setCurrentRestSecs(0);
    restStartRef.current = Date.now();
    restInterval.current = setInterval(() => {
      const cur = Math.round((Date.now() - restStartRef.current) / 1000);
      setCurrentRestSecs(cur);
      setRestSeconds(restAccRef.current + cur);
    }, 1000);
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
    const entry: HistoryEntry = {
      id: Date.now().toString(),
      date: new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
      workoutName: todayWorkout,
      duration: finalActive,
      restTime: finalRest_,
      exercises: exercises,
    };
    setHistory(prev => {
      const updated = [entry, ...prev];
      FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(updated));
      return updated;
    });
    setFinalSeconds(finalActive);
    setFinalRest(finalRest_);
    setScreen('summary');
  }

  function reset() {
    setSeconds(0);
    setTotalSessionSecs(0);
    setRestSeconds(0);
    setCurrentRestSecs(0);
    setPaused(false);
    activeAccRef.current = 0;
    restAccRef.current = 0;
    if (totalInterval.current) clearInterval(totalInterval.current);
    setScreen('home');
  }

  useEffect(() => {
    return () => {
      if (workoutInterval.current) clearInterval(workoutInterval.current);
      if (restInterval.current) clearInterval(restInterval.current);
      if (totalInterval.current) clearInterval(totalInterval.current);
    };
  }, []);

  useEffect(() => {
    (async () => {
      const info = await FileSystem.getInfoAsync(HISTORY_PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(HISTORY_PATH);
        setHistory(JSON.parse(raw));
      } else {
        setHistory(SEED_HISTORY);
        await FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(SEED_HISTORY));
      }
      const bwInfo = await FileSystem.getInfoAsync(BW_PATH);
      if (bwInfo.exists) {
        const raw = await FileSystem.readAsStringAsync(BW_PATH);
        setBodyweight(JSON.parse(raw));
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
              <Text style={poster.phase}>WEEK 1  LINE UP</Text>
            </View>
            <TouchableOpacity style={poster.histBtn} onPress={() => setScreen('history')}>
              <Text style={poster.histBtnText}>HISTORY</Text>
            </TouchableOpacity>
          </View>

          {/* ── Lineup ── */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: 16 }}>
            {(() => {
              const nextUpDay = WEEK_DAYS.find(d => !completedDays.includes(d)) ?? null;
              return WEEK_DAYS.map(day => {
              const isToday = day === new Date().getDay();
              const isDone = completedDays.includes(day);
              const isExpanded = expandedDay === day;
              const color = POSTER_COLORS[day];
              const historyEntry = history.find(h => WORKOUT_TO_DAY[h.workoutName] === day);
              const displayExercises: (Omit<Exercise, 'sets'> & { sets?: Exercise['sets'] })[] =
                isDone && historyEntry ? historyEntry.exercises : weekPlan[day] ?? [];
              const nameOpacity = isDone ? 0.18 : 1;

              return (
                <View key={day}>
                  <TouchableOpacity
                    style={[poster.slot, isToday && { backgroundColor: 'rgba(255,255,255,0.03)', borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }]}
                    onPress={() => setExpandedDay(isExpanded ? null : day)}
                    activeOpacity={0.6}
                  >
                    {BOXED_DAYS.has(day) ? (
                      <View style={{ borderWidth: 1.5, borderColor: `rgba(255,255,255,${isDone ? 0.1 : 0.7})`, paddingHorizontal: 24, paddingVertical: 10, marginTop: 6 }}>
                        <AnimatedPosterName day={day} isActive={!isDone && day === nextUpDay} style={[poster.artistName, DAY_TEXT_STYLES[day], { color: `rgba(255,255,255,${nameOpacity})` }]} />
                      </View>
                    ) : (
                      <AnimatedPosterName day={day} isActive={!isDone && day === nextUpDay} style={[poster.artistName, DAY_TEXT_STYLES[day], { color: `rgba(255,255,255,${nameOpacity})`, marginTop: 6 }]} />
                    )}
                    {isToday && <Text style={poster.todayTag}>— TODAY —</Text>}
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={poster.cardList}>
                      {displayExercises.map(ex => (
                        <View key={ex.id} style={{ position: 'relative' }}>
                          <TouchableOpacity
                            style={[poster.darkCard, { borderLeftColor: color + '66' }]}
                            onPress={() => !isDone && setSwapContext({ day, exerciseId: ex.id })}
                            activeOpacity={isDone ? 1 : 0.7}
                          >
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Text style={poster.cardName}>{ex.name}</Text>
                              <Text style={poster.cardBadge}>{ex.type}</Text>
                            </View>
                            <Text style={poster.cardMuscles}>{ex.muscles}</Text>
                            {isDone && ex.sets ? (
                              <Text style={poster.cardSets}>
                                {ex.sets.map(s => `${s.weight}kg × ${s.reps}`).join('  ·  ')}
                              </Text>
                            ) : (
                              <>
                                <Text style={poster.cardTarget}>{ex.target}</Text>
                                <Text style={poster.cardCue}>{ex.cue}</Text>
                              </>
                            )}
                          </TouchableOpacity>
                          {!isDone && (
                            <TouchableOpacity
                              style={poster.cardRemove}
                              onPress={() => setWeekPlan(prev => ({
                                ...prev,
                                [day]: (prev[day] ?? []).filter(e => e.id !== ex.id),
                              }))}
                            >
                              <Text style={poster.cardRemoveText}>✕</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      ))}
                      {!isDone && (
                        <TouchableOpacity
                          style={poster.addExBtn}
                          onPress={() => setSwapContext({ day, exerciseId: null })}
                        >
                          <Text style={poster.addExBtnText}>+ ADD EXERCISE</Text>
                        </TouchableOpacity>
                      )}
                      {isDone && historyEntry && (
                        <TouchableOpacity
                          style={poster.coachBtn}
                          onPress={() => Share.share({ message: formatSessionForCoach(SPLIT[day], historyEntry.date, historyEntry.duration, historyEntry.restTime, historyEntry.exercises) })}
                        >
                          <Text style={poster.coachBtnText}>Coach This →</Text>
                        </TouchableOpacity>
                      )}
                      {!isDone && (
                        <TouchableOpacity
                          style={poster.coachBtn}
                          onPress={() => Share.share({ message: formatUpcomingSessionForCoach(day, weekPlan, history) })}
                        >
                          <Text style={poster.coachBtnText}>Coach This →</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            });
            })()}
          </ScrollView>

          {/* ── Swap Modal ── */}
          {swapContext !== null && (
            <TouchableOpacity style={swap.overlay} activeOpacity={1} onPress={() => { setSwapContext(null); setSwapQuery(''); }}>
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
            </TouchableOpacity>
          )}

          {/* ── Footer ── */}
          <View style={poster.footer}>
            <TouchableOpacity style={poster.startBtn} onPress={startWorkout}>
              <Text style={poster.startBtnText}>START WORKOUT</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Active ── */}
      {screen === 'active' && (
        <View style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
          <View style={styles.timerBar}>
            <Text style={styles.timerBarTime}>{formatTime(totalSessionSecs)}</Text>
            {paused ? (
              <Text style={styles.timerBarRest}>Rest {formatTime(currentRestSecs)}</Text>
            ) : (
              <Text style={styles.timerBarRest}>Active {formatTime(seconds)}</Text>
            )}
            <TouchableOpacity style={styles.restBtn} onPress={toggleRest}>
              <Text style={styles.restBtnText}>{paused ? 'Continue' : 'Rest'}</Text>
            </TouchableOpacity>
            <Text style={styles.timerBarTitle}>{todayWorkout}</Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
            {exercises.map((ex, idx) => (
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
                onConfirmSet={() => startFreshRest()}
              />
            ))}
            <TouchableOpacity style={styles.addExBtn} onPress={() => setActiveSwapId('__add__')}>
              <Text style={styles.addExBtnText}>+ Add Exercise</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.endBtn} onPress={endWorkout}>
              <Text style={styles.endBtnText}>End Workout</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* ── Active Swap / Add Modal ── */}
          {activeSwapId !== null && (
            <TouchableOpacity
              style={swap.overlay}
              activeOpacity={1}
              onPress={() => { setActiveSwapId(null); setSwapQuery(''); }}
            >
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
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Summary ── */}
      {screen === 'summary' && (
        <View style={{ flex: 1 }}>
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
              style={[styles.button, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee', color: '#000', fontSize: 16, textAlign: 'center', marginBottom: 0 }]}
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
                const date = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
                Share.share({ message: formatSessionForCoach(todayWorkout, date, finalSeconds, finalRest, exercises) });
              }}
            >
              <Text style={styles.buttonText}>Coach This →</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, { marginTop: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee' }]} onPress={reset}>
              <Text style={[styles.buttonText, { color: '#000' }]}>Done</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* ── History ── */}
      {screen === 'history' && (
        <HistoryScreen
          history={history}
          onBack={() => setScreen('home')}
          onDelete={(id) => setHistory(prev => {
            const updated = prev.filter(e => e.id !== id);
            FileSystem.writeAsStringAsync(HISTORY_PATH, JSON.stringify(updated));
            return updated;
          })}
        />
      )}
    </View>
    </GestureHandlerRootView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
  title: { fontSize: 32, fontWeight: 'bold' },
  workoutName: { fontSize: 18, color: '#666', marginBottom: 8 },
  button: { backgroundColor: '#000', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 8 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  timerBar: {
    backgroundColor: '#fff',
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    gap: 6,
  },
  timerBarTitle: { fontSize: 13, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 },
  timerBarTime: { fontSize: 42, fontWeight: '300', letterSpacing: 3 },
  timerBarRest: { fontSize: 13, color: '#999' },
  restBtn: { borderWidth: 1, borderColor: '#000', paddingVertical: 12, borderRadius: 6, marginTop: 4, alignSelf: 'stretch', alignItems: 'center' },
  restBtnText: { fontSize: 14, fontWeight: '600' },
  endBtn: { borderWidth: 1, borderColor: '#ccc', paddingVertical: 12, borderRadius: 8, alignSelf: 'stretch', alignItems: 'center', marginTop: 8 },
  endBtnText: { fontSize: 15, color: '#999', textAlign: 'center' },
  addExBtn: { borderWidth: 1, borderColor: '#ddd', paddingVertical: 12, borderRadius: 8, alignSelf: 'stretch', alignItems: 'center', marginBottom: 8 },
  addExBtnText: { fontSize: 14, color: '#007AFF' },
  list: { padding: 16, paddingBottom: 32 },
  summaryLabel: { fontSize: 13, color: '#999', textTransform: 'uppercase', letterSpacing: 1 },
  summaryValue: { fontSize: 36, fontWeight: '300', letterSpacing: 3, marginBottom: 8 },
  homeHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  homeFooter: { padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee' },
  historyBtn: { paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: '#ddd', borderRadius: 8 },
  historyBtnText: { fontSize: 13, color: '#666' },
  historyHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', alignItems: 'center', gap: 16 },
  historyBack: { fontSize: 16, color: '#007AFF' },
  historyTitle: { fontSize: 18, fontWeight: '600' },
});

const hist = StyleSheet.create({
  sessionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, marginTop: 8 },
  workoutName: { fontSize: 16, fontWeight: '600' },
  date: { fontSize: 12, color: '#999' },
  meta: { fontSize: 12, color: '#aaa', marginBottom: 10 },
});

const coll = StyleSheet.create({
  group: { backgroundColor: '#fff', borderRadius: 12, marginBottom: 12, overflow: 'hidden' },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  groupName: { fontSize: 16, fontWeight: '600' },
  chevron: { fontSize: 12, color: '#999' },
  dateRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  dateText: { fontSize: 14, color: '#333', flex: 1 },
  dateMeta: { fontSize: 12, color: '#999', marginRight: 8 },
  chevronSm: { fontSize: 10, color: '#ccc' },
  cardList: { backgroundColor: '#f5f5f5', padding: 12, gap: 0 },
  deleteBtn: { backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center', width: 80 },
  deleteBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});

const histCard = StyleSheet.create({
  setValue: { fontSize: 14, color: '#333', minWidth: 56, textAlign: 'center' },
});

const summ = StyleSheet.create({
  exRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  exName: { fontSize: 14, color: '#333', flex: 1 },
  exTime: { fontSize: 14, color: '#888', fontVariant: ['tabular-nums'] },
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
  cardList: { paddingHorizontal: 16, paddingBottom: 4 },
  darkCard: { backgroundColor: '#0c0c18', borderRadius: 6, padding: 14, marginBottom: 8, borderLeftWidth: 2 },
  cardName: { fontSize: 13, fontWeight: '600', color: '#ccc', flex: 1 },
  cardBadge: { fontSize: 9, letterSpacing: 2, color: '#333', textTransform: 'uppercase' },
  cardMuscles: { fontSize: 11, color: '#333', marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },
  cardTarget: { fontSize: 12, color: '#555', marginTop: 6 },
  cardCue: { fontSize: 11, color: '#2a2a40', fontStyle: 'italic', marginTop: 4 },
  cardSets: { fontSize: 12, color: '#666', marginTop: 6 },
  coachBtn: { marginTop: 4, marginBottom: 12, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center' },
  coachBtnText: { fontSize: 11, letterSpacing: 5, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
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
  startBtn: { paddingVertical: 18, alignItems: 'center', borderWidth: 1, borderColor: '#222' },
  startBtnText: { color: '#fff', fontSize: 11, letterSpacing: 7, fontWeight: '600' },
  cardRemove: { position: 'absolute', top: 8, right: 8, padding: 6 },
  cardRemoveText: { fontSize: 11, color: '#333' },
  addExBtn: { marginTop: 4, marginBottom: 12, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center' },
  addExBtnText: { fontSize: 10, letterSpacing: 5, color: 'rgba(255,255,255,0.35)', fontWeight: '600' },
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
  container: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  name: { fontSize: 16, fontWeight: '600', flex: 1 },
  badge: { fontSize: 11, color: '#fff', backgroundColor: '#333', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  muscles: { fontSize: 13, color: '#888' },
  target: { fontSize: 13, color: '#555', marginBottom: 8 },
  setRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  setNum: { width: 20, fontSize: 12, color: '#999', textAlign: 'center', marginRight: 4 },
  setInner: { flexDirection: 'row', alignItems: 'center' },
  input: {
    width: 56,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
    fontSize: 14,
    textAlign: 'center',
  },
  sep: { fontSize: 14, color: '#999', marginHorizontal: 4 },
  rpeInput: { width: 44 },
  dropGroup: { flexDirection: 'row', alignItems: 'center' },
  arrow: { fontSize: 14, color: '#999', marginHorizontal: 6 },
  dropRemove: { fontSize: 11, color: '#ccc', marginLeft: 4 },
  dropBtn: { marginLeft: 10, justifyContent: 'center' },
  dropBtnText: { fontSize: 12, color: '#FF6B6B' },
  removeBtn: { width: 28, alignItems: 'center', marginLeft: 4 },
  removeBtnText: { color: '#ccc', fontSize: 14 },
  confirmBtn: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: '#ccc', alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  confirmBtnDone: { backgroundColor: '#34C759', borderColor: '#34C759' },
  confirmBtnText: { fontSize: 13, color: '#ccc', fontWeight: '600' },
  confirmBtnTextDone: { color: '#fff' },
  addSet: { marginTop: 4 },
  addSetText: { fontSize: 13, color: '#007AFF' },
  cue: { fontSize: 12, color: '#aaa', marginTop: 8, fontStyle: 'italic' },
  exTime: { fontSize: 12, color: '#888', marginTop: 6 },
  swapHint: { fontSize: 10, color: '#007AFF', opacity: 0.6, marginTop: 1, letterSpacing: 0.5 },
});

const drag = StyleSheet.create({
  handle: { backgroundColor: '#fff', borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingVertical: 8, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f0f0f0', flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: -12 },
  handleDots: { fontSize: 13, color: '#ccc', letterSpacing: 2 },
  handleLabel: { fontSize: 10, color: '#ccc', letterSpacing: 1.5, textTransform: 'uppercase' },
  removeBtn: { position: 'absolute', right: 12, padding: 4 },
  removeBtnText: { fontSize: 13, color: '#ccc' },
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
