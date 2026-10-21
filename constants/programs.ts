// ─── Program Data ─────────────────────────────────────────────────────────────
// All hardcoded exercise arrays, weekly plans, split metadata, and UI constants
// extracted from index.tsx for maintainability.

import type { Exercise } from '../types';

// ─── Program Epoch & Week ────────────────────────────────────────────────────

export const PROGRAM_EPOCH = new Date(2026, 3, 13).getTime(); // local midnight

export function getCurrentProgramWeek(epoch = PROGRAM_EPOCH): number {
  return Math.max(1, Math.floor((Date.now() - epoch) / (7 * 24 * 60 * 60 * 1000)) + 1);
}

export function getCurrentWeekBounds(epoch = PROGRAM_EPOCH): { start: number; end: number } {
  const week = getCurrentProgramWeek(epoch);
  const start = epoch + (week - 1) * 7 * 24 * 60 * 60 * 1000;
  return { start, end: start + 7 * 24 * 60 * 60 * 1000 };
}

// ─── Base Day Arrays (Week 2 defaults) ───────────────────────────────────────

export const PUSH_EXERCISES: Omit<Exercise, 'sets'>[] = [
  {
    id: '1',
    name: 'Flat DB Bench Press',
    muscles: 'Mid Chest, Triceps',
    type: 'Compound',
    target: '40 kg × 6–8 × 3',
    cue: 'Retract scapula into bench • DBs at chest level • drive up and slightly together • elbows max 75° flare • 2s descent',
  },
  {
    id: '3',
    name: 'Incline DB Bench Press',
    muscles: 'Upper Chest, Triceps',
    type: 'Compound',
    target: '37.5 kg × 6–8 × 3',
    cue: '30–45° incline • same scapula retraction • feel upper chest stretch at bottom • press in an arc not straight up',
  },
  {
    id: '5',
    name: 'Decline Machine Press',
    muscles: 'Lower Chest, Triceps',
    type: 'Compound',
    target: '45 kg × 6–8 × 3',
    cue: 'Elbows slightly below chest height • squeeze pecs at lockout • slow eccentric — chest not shoulders',
  },
  {
    id: '7',
    name: 'Pec Deck Fly',
    muscles: 'Chest',
    type: 'Iso',
    target: '79 kg × 10–12 × 2 + dropset',
    cue: 'Slight bend in elbow fixed throughout • lead with elbows not hands • squeeze hard at peak • 2s hold',
  },
  {
    id: '2',
    name: 'Hammer Curl',
    muscles: 'Brachialis, Biceps',
    type: 'Iso',
    target: '20 kg × 4–6 × 3 + dropset → ~14 kg',
    cue: 'Neutral grip • full hang at bottom • curl to shoulder height • no swing — if torso rocks weight is too heavy',
  },
  {
    id: '4',
    name: 'Incline Supinated Curl',
    muscles: 'Biceps Long Head',
    type: 'Iso',
    target: '20 kg × 4–6 × 3 + dropset → ~14 kg',
    cue: 'Full dead hang at bottom — let bicep fully stretch • supinate wrist as you curl • don\'t swing at top',
  },
  {
    id: '6',
    name: 'Preacher Curl',
    muscles: 'Biceps Short Head',
    type: 'Iso',
    target: '38–40 kg × 10–12 × 3',
    cue: 'Upper arm fixed on pad throughout • full extension at bottom — don\'t cut it short • squeeze hard at peak • 2s hold',
  },
];

export const LEG_A_EXERCISES: Omit<Exercise, 'sets'>[] = [
  {
    id: 'la1',
    name: 'Hack Squat',
    muscles: 'Quads, Glutes',
    type: 'Compound',
    target: '85 kg × 8 × 3',
    cue: 'Feet hip width • knees track over toes • full depth • drive through mid-foot • don\'t let lower back round at bottom',
  },
  {
    id: 'la2',
    name: 'DB Romanian Deadlift',
    muscles: 'Hamstrings, Glutes',
    type: 'Compound',
    target: '42.5 kg × 8 × 3',
    cue: 'Soft knee • push hips back not down • 3s lowering • feel hamstring stretch before reversing • squeeze glutes at top',
  },
  {
    id: 'la3',
    name: 'Cable Pull-Through',
    muscles: 'Glutes, Hamstrings',
    type: 'Compound',
    target: '50 kg × 10 × 3',
    cue: 'Hinge at hip not waist • let cable pull you into stretch • drive hips forward explosively • squeeze glutes hard at lockout — not a lower back movement',
  },
  {
    id: 'la4',
    name: 'Hip Thrust (Machine)',
    muscles: 'Glute Maximus',
    type: 'Compound',
    target: '85 kg × 10 × 3',
    cue: 'Chin tucked • drive through heels • full hip extension at top • 1s pause — don\'t hyperextend spine',
  },
  {
    id: 'la5',
    name: 'Seated Leg Curl',
    muscles: 'Hamstrings',
    type: 'Iso',
    target: '55 kg × 10 × 3',
    cue: 'Initiate with hamstring not momentum • 3s eccentric on the way up • full range both directions',
  },
  {
    id: 'la6',
    name: 'Seated Calf Raise',
    muscles: 'Gastrocnemius',
    type: 'Iso',
    target: '15 kg × 15 × 3',
    cue: 'Full stretch at bottom — 2s hold • drive up through ball of foot • squeeze at top',
  },
  {
    id: 'la7',
    name: 'Cable Crunch',
    muscles: 'Abs',
    type: 'Iso',
    target: '73 kg × 12 × 3',
    cue: 'Rope at forehead • curl spine down — not a hip hinge • elbows to knees • hold contraction 1s at bottom',
  },
];

export const PULL_EXERCISES: Omit<Exercise, 'sets'>[] = [
  { id: 'pu1', name: 'Pull-Ups (Bodyweight)', muscles: 'Lats, Upper Back, Biceps', type: 'Compound', target: 'BW × 6–8 × 3', cue: 'Dead hang start • depress scapula before pulling • drive elbows to hips not hands to bar • chin over bar • controlled descent — no kipping' },
  { id: 'pu2', name: 'Chest-Supported Row', muscles: 'Mid Back, Lats', type: 'Compound', target: '65 kg × 8 × 3', cue: 'Chest pinned to pad throughout • retract scapula first then pull • elbows at 45° to torso • squeeze at peak — don\'t shrug' },
  { id: 'pu3', name: 'Lat Pulldown', muscles: 'Lats', type: 'Compound', target: '76 kg × 8 × 3', cue: 'Slight lean back • pull bar to upper chest • drive elbows down and back • full stretch at top — feel the lat lengthen' },
  { id: 'pu4', name: 'Seated Cable Row', muscles: 'Mid Back', type: 'Compound', target: '70 kg × 8–10 × 3', cue: 'Tall spine • hinge slightly forward on eccentric • row to lower chest • pause 1s at contraction — no momentum' },
  { id: 'pu5', name: 'Rope Tricep Pushdown', muscles: 'Triceps', type: 'Iso', target: '59 kg × 10–12 × 3 + dropset', cue: 'Elbows pinned to sides throughout • split rope at bottom • full lockout • 1s hold — don\'t let elbows drift forward' },
  { id: 'pu6', name: 'Supinated Single-Arm Pushdown', muscles: 'Triceps', type: 'Iso', target: '25 kg × 10–12 × 3 + dropset', cue: 'Palm facing up • elbow fixed at side • rotate wrist to full supination at lockout — feel the long head stretch at top' },
  { id: 'pu8', name: 'Cable Curl', muscles: 'Biceps', type: 'Iso', target: '15–17.5 kg × 12–15 × 2', cue: 'Standing • elbows slightly forward of torso • full stretch at bottom • squeeze hard at top — finisher, control over load' },
  { id: 'pu7', name: 'Cable Crunch', muscles: 'Abs', type: 'Iso', target: '73 kg × 12 × 3', cue: 'Rope at forehead • curl spine — not hips • hold 1s at bottom • slow return' },
];

export const SHOULDER_EXERCISES: Omit<Exercise, 'sets'>[] = [
  { id: 'sh1', name: 'Machine Shoulder Press', muscles: 'Anterior Delt, Triceps', type: 'Compound', target: '50 kg × 8 × 3', cue: 'Seat height so handles start at shoulder level • press in slight arc • don\'t fully lock out — keep tension on delt • control the descent' },
  { id: 'sh3', name: 'Seated DB Lateral Raise', muscles: 'Lateral Delt', type: 'Iso', target: '20 kg × 10–12 × 3', cue: 'Slight forward lean • lead with elbow not hand • raise to just above shoulder height • 2s hold at top — if traps are taking over the weight is too heavy' },
  { id: 'sh2', name: 'Chest-Supported Rear Delt Row', muscles: 'Rear Delt', type: 'Iso', target: '32.5 kg × 10 × 3', cue: 'Chest on pad • arms out at 90° to torso • drive elbows back and out — not down • externally rotate at peak • squeeze rear delt not mid back' },
  { id: 'sh4', name: 'Cable Rear Delt Pull (Bow & Arrow)', muscles: 'Rear Delt', type: 'Iso', target: '32 kg × 10–12 × 2 + dropset', cue: 'Single arm • pull across body to ear height • elbow leads • rotate shoulder back at end range — think drawing a bow' },
  { id: 'sh5', name: 'Standing Side Delt Raise Machine', muscles: 'Lateral Delt', type: 'Iso', target: '32 kg × 8–10 × 3', cue: 'Slight forward lean into pad • lead with elbow • raise to just above shoulder — don\'t shrug at top • slow controlled return' },
  { id: 'sh6', name: 'Tricep Machine Extension', muscles: 'Triceps', type: 'Iso', target: '30–35 kg × 10–12 × 3 + dropset', cue: 'Upper arm fixed • full extension at bottom — don\'t cut range short • 1s hold at lockout • slow return — feel the stretch at top' },
  { id: 'sh7', name: 'Cable Curl', muscles: 'Biceps', type: 'Iso', target: '15–17.5 kg × 12–15 × 1', cue: 'Finisher — full stretch • full squeeze • no momentum. One crisp set' },
];

export const LEG_B_EXERCISES: Omit<Exercise, 'sets'>[] = [
  { id: 'lb1', name: 'Leg Press', muscles: 'Quads, Glutes', type: 'Compound', target: '130 kg × 8 × 3', cue: 'Feet hip width mid-platform • full depth without lower back rounding off seat • drive through mid-foot — don\'t lock out at top' },
  { id: 'lb2', name: 'Bulgarian Split Squat (Smith)', muscles: 'Quads, Glutes', type: 'Compound', target: '45.9 kg × 8 × 3', cue: 'Front foot far enough forward so shin stays vertical • lower straight down — don\'t lean forward • drive through front heel • back knee just above floor' },
  { id: 'lb3', name: 'Lying / Seated Leg Curl', muscles: 'Hamstrings', type: 'Iso', target: '68 kg × 8–10 × 3', cue: '3s eccentric — fight the weight on the way up • full range both directions • don\'t let hips rise off pad' },
  { id: 'lb5', name: 'Leg Extension', muscles: 'Quads', type: 'Iso', target: '84 kg × 8–10 × 3', cue: 'Sit tall • full extension at top — 1s pause • slow 3s descent • toes neutral or slightly inward' },
  { id: 'lb6', name: 'Seated Calf Raise', muscles: 'Calves', type: 'Iso', target: '20 kg × 15 × 3', cue: 'Full stretch at bottom — 2s hold • drive through ball of foot • squeeze at top • don\'t bounce' },
  { id: 'lb7', name: 'Cable Crunch', muscles: 'Abs', type: 'Iso', target: '73 kg × 12 × 3', cue: 'Third abs session — spine curls not hips hinge • 1s hold at bottom • same as Day 1' },
];

// ─── Swap Pool ────────────────────────────────────────────────────────────────

export const SWAP_POOL: Omit<Exercise, 'sets'>[] = [
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
  { id: 'sp_co4', name: 'Cable Side Crunch',                        muscles: 'Obliques, Abs',                   type: 'Iso',      target: '', cue: 'Side bend only — no rotation • pull rib toward hip • keep hips fixed • slow return — don\'t let cable yank you back' },
  { id: 'sp_co5', name: 'Cable Woodchopper',                        muscles: 'Obliques, Abs',                   type: 'Iso',      target: '', cue: 'Rotate from thoracic spine • hips face forward throughout • arms are levers only • slow controlled return' },
  { id: 'sp_co6', name: 'Cable Torso Rotation',                     muscles: 'Obliques, Abs',                   type: 'Iso',      target: '', cue: 'Hips locked — rotate upper body only • no momentum • slow deliberate both directions — feel the oblique work' },
  { id: 'sp_co7', name: "Captain's Chair Leg Raises",               muscles: 'Abs',                             type: 'Iso',      target: '', cue: 'Posterior pelvic tilt before lifting • knees to hip height or higher • slow controlled descent — no drop • no momentum' },
  // Other
  { id: 'sp_ot1', name: '3D Abductor Machine',                      muscles: 'Glutes',                          type: 'Iso',      target: '', cue: 'Full ROM • controlled return • no momentum' },
];

// ─── Weekly Programs ──────────────────────────────────────────────────────────

// Week 2 (named day arrays above)
export const W2_DAY_EXERCISES: Record<number, Omit<Exercise, 'sets'>[]> = {
  1: LEG_A_EXERCISES,
  2: PUSH_EXERCISES,
  3: PULL_EXERCISES,
  4: SHOULDER_EXERCISES,
  5: LEG_B_EXERCISES,
};

// Week 3
export const W3_DAY_EXERCISES: Record<number, Omit<Exercise, 'sets'>[]> = {
  1: [ // Lower A — DB RDL dropped; order: Hack Squat → Leg Curl → Hip Thrust → Pull-Through → Crunch → Calf
    { id: 'la1', name: 'Hack Squat',            muscles: 'Quads, Glutes',      type: 'Compound', target: '90 kg × 10 × 3',                           cue: 'Feet hip width • knees track over toes • full depth • drive through mid-foot • don\'t let lower back round at bottom' },
    { id: 'la5', name: 'Seated Leg Curl',        muscles: 'Hamstrings',         type: 'Iso',      target: '61 kg × 10 × 3',                           cue: 'Initiate with hamstring not momentum • 3s eccentric on the way up • full range both directions' },
    { id: 'la4', name: 'Hip Thrust (Machine)',   muscles: 'Glute Maximus',      type: 'Compound', target: '95 kg × 10 × 3',                           cue: 'Chin tucked • drive through heels • full hip extension at top • 1s pause — don\'t hyperextend spine' },
    { id: 'la3', name: 'Cable Pull-Through',     muscles: 'Glutes, Hamstrings', type: 'Compound', target: '58 kg × 10 × 3',                           cue: 'Hinge at hip not waist • let cable pull you into stretch • drive hips forward explosively • squeeze glutes hard at lockout' },
    { id: 'la7', name: 'Cable Crunch',           muscles: 'Abs',                type: 'Iso',      target: '75 kg × 12 × 3',                           cue: 'Rope at forehead • curl spine down — not a hip hinge • elbows to knees • hold contraction 1s at bottom' },
    { id: 'la6', name: 'Seated Calf Raise',      muscles: 'Gastrocnemius',      type: 'Iso',      target: '22.5 kg × 12 × 3 + dropset → 17.5 kg × 8', cue: 'Full stretch at bottom — 2s hold • drive up through ball of foot • squeeze at top' },
  ],
  2: [ // Push — all curls now have dropsets; Pec Deck 68.5 kg
    { id: '1', name: 'Flat DB Bench Press',    muscles: 'Mid Chest, Triceps',   type: 'Compound', target: '40 kg × 6 × 3',                        cue: 'Retract scapula into bench • DBs at chest level • drive up and slightly together • elbows max 75° flare • 2s descent' },
    { id: '3', name: 'Incline DB Bench Press', muscles: 'Upper Chest, Triceps', type: 'Compound', target: '37.5 kg × 6 × 3',                       cue: '30–45° incline • same scapula retraction • feel upper chest stretch at bottom • press in an arc not straight up' },
    { id: '5', name: 'Decline Machine Press',  muscles: 'Lower Chest, Triceps', type: 'Compound', target: '50 kg × 6 × 3',                         cue: 'Elbows slightly below chest height • squeeze pecs at lockout • slow eccentric — chest not shoulders' },
    { id: '7', name: 'Pec Deck Fly',           muscles: 'Chest',                type: 'Iso',      target: '68.5 kg × 8 × 3',                       cue: 'Slight bend in elbow fixed throughout • lead with elbows not hands • squeeze hard at peak • 2s hold' },
    { id: '2', name: 'Hammer Curl',            muscles: 'Brachialis, Biceps',   type: 'Iso',      target: '20 kg × 6 × 3 + dropset → 15 kg × 4',   cue: 'Neutral grip • full hang at bottom • curl to shoulder height • no swing — if torso rocks weight is too heavy' },
    { id: '4', name: 'Incline Supinated Curl', muscles: 'Biceps Long Head',     type: 'Iso',      target: '20 kg × 6 × 3 + dropset → 15 kg × 4',   cue: 'Full dead hang at bottom — let bicep fully stretch • supinate wrist as you curl • don\'t swing at top' },
    { id: '6', name: 'Preacher Curl',          muscles: 'Biceps Short Head',    type: 'Iso',      target: '41 kg × 6 × 3 + dropset → 32 kg × 4',   cue: 'Upper arm fixed on pad throughout • full extension at bottom — don\'t cut it short • squeeze hard at peak • 2s hold' },
  ],
  3: [ // Pull — Seated Cable Row and Lat Pulldown order swapped; pushdowns gain dropsets
    { id: 'pu1', name: 'Pull-Ups (Bodyweight)',         muscles: 'Lats, Upper Back, Biceps', type: 'Compound', target: 'BW × 8 × 3',                          cue: 'Dead hang start • depress scapula before pulling • drive elbows to hips not hands to bar • chin over bar • controlled descent — no kipping' },
    { id: 'pu2', name: 'Chest-Supported Row',           muscles: 'Mid Back, Lats',           type: 'Compound', target: '67.5 kg × 8 × 3',                     cue: 'Chest pinned to pad throughout • retract scapula first then pull • elbows at 45° to torso • squeeze at peak — don\'t shrug' },
    { id: 'pu4', name: 'Seated Cable Row',              muscles: 'Mid Back',                 type: 'Compound', target: '77.5 kg × 8 × 3',                     cue: 'Tall spine • hinge slightly forward on eccentric • row to lower chest • pause 1s at contraction — no momentum' },
    { id: 'pu3', name: 'Lat Pulldown',                  muscles: 'Lats',                     type: 'Compound', target: '73 kg × 8 × 3',                       cue: 'Slight lean back • pull bar to upper chest • drive elbows down and back • full stretch at top — feel the lat lengthen' },
    { id: 'pu5', name: 'Rope Tricep Pushdown',          muscles: 'Triceps',                  type: 'Iso',      target: '59 kg × 8 × 3 + dropset → 50 kg × 6', cue: 'Elbows pinned to sides throughout • split rope at bottom • full lockout • 1s hold — don\'t let elbows drift forward' },
    { id: 'pu6', name: 'Supinated Single-Arm Pushdown', muscles: 'Triceps',                  type: 'Iso',      target: '27 kg × 8 × 3 + dropset → 20 kg × 6', cue: 'Palm facing up • elbow fixed at side • rotate wrist to full supination at lockout — feel the long head stretch at top' },
    { id: 'pu8', name: 'Cable Curl',                    muscles: 'Biceps',                   type: 'Iso',      target: '45 kg × 8 × 3',                       cue: 'Standing • elbows slightly forward of torso • full stretch at bottom • squeeze hard at top — control over load' },
    { id: 'pu7', name: 'Cable Crunch',                  muscles: 'Abs',                      type: 'Iso',      target: '75 kg × 12 × 3',                      cue: 'Rope at forehead • curl spine — not hips • hold 1s at bottom • slow return' },
  ],
  4: [ // Boulder Shoulder — order changed; lateral + rear delt gain dropsets; Cable Fly + Crunch added
    { id: 'sh1', name: 'Machine Shoulder Press',             muscles: 'Anterior Delt, Triceps', type: 'Compound', target: '55 kg × 8 × 3',                        cue: 'Seat height so handles start at shoulder level • press in slight arc • don\'t fully lock out — keep tension on delt • control the descent' },
    { id: 'sh2', name: 'Chest-Supported Rear Delt Row',      muscles: 'Rear Delt',              type: 'Iso',      target: '35 kg × 10 × 3',                       cue: 'Chest on pad • arms out at 90° to torso • drive elbows back and out — not down • externally rotate at peak • squeeze rear delt not mid back' },
    { id: 'sh3', name: 'Seated DB Lateral Raise',            muscles: 'Lateral Delt',           type: 'Iso',      target: '20 kg × 8 × 3 + dropset → 15 kg × 6', cue: 'Slight forward lean • lead with elbow not hand • raise to just above shoulder height • 2s hold at top — if traps are taking over the weight is too heavy' },
    { id: 'sh4', name: 'Cable Rear Delt Pull (Bow & Arrow)', muscles: 'Rear Delt',              type: 'Iso',      target: '32 kg × 8 × 3 + dropset → 23 kg × 6', cue: 'Single arm • pull across body to ear height • elbow leads • rotate shoulder back at end range — think drawing a bow' },
    { id: 'sh5', name: 'Standing Side Delt Raise Machine',   muscles: 'Lateral Delt',           type: 'Iso',      target: '34 kg × 6 × 3 + dropset → 27 kg × 5', cue: 'Slight forward lean into pad • lead with elbow • raise to just above shoulder — don\'t shrug at top • slow controlled return' },
    { id: 'sh6', name: 'Tricep Machine Extension',           muscles: 'Triceps',                type: 'Iso',      target: '41 kg × 8 × 3 + dropset → 34 kg × 6', cue: 'Upper arm fixed • full extension at bottom — don\'t cut range short • 1s hold at lockout • slow return — feel the stretch at top' },
    { id: 'sh8', name: 'Cable Fly',                          muscles: 'Mid Chest',              type: 'Iso',      target: '65 kg × 8 × 3',                        cue: 'Arms arc forward and together • squeeze chest hard at peak • slight fixed bend in elbow • constant tension — don\'t let shoulders take over' },
    { id: 'sh9', name: 'Cable Crunch',                       muscles: 'Abs',                    type: 'Iso',      target: '75 kg × 12 × 3',                       cue: 'Rope at forehead • curl spine — not hips • hold 1s at bottom • slow return' },
  ],
  5: [ // Lower B — all targets progressed; calf raise gains dropset
    { id: 'lb1', name: 'Leg Press',                     muscles: 'Quads, Glutes', type: 'Compound', target: '140 kg × 10 × 3',                          cue: 'Feet hip width mid-platform • full depth without lower back rounding off seat • drive through mid-foot — don\'t lock out at top' },
    { id: 'lb2', name: 'Bulgarian Split Squat (Smith)', muscles: 'Quads, Glutes', type: 'Compound', target: '57.5 kg × 8 × 3',                           cue: 'Front foot far enough forward so shin stays vertical • lower straight down — don\'t lean forward • drive through front heel • back knee just above floor' },
    { id: 'lb3', name: 'Lying / Seated Leg Curl',       muscles: 'Hamstrings',    type: 'Iso',      target: '72.5 kg × 10 × 3',                          cue: '3s eccentric — fight the weight on the way up • full range both directions • don\'t let hips rise off pad' },
    { id: 'lb5', name: 'Leg Extension',                 muscles: 'Quads',         type: 'Iso',      target: '89 kg × 10 × 3',                            cue: 'Sit tall • full extension at top — 1s pause • slow 3s descent • toes neutral or slightly inward' },
    { id: 'lb6', name: 'Seated Calf Raise',             muscles: 'Calves',        type: 'Iso',      target: '22.5 kg × 12 × 3 + dropset → 17.5 kg × 8', cue: 'Full stretch at bottom — 2s hold • drive through ball of foot • squeeze at top • don\'t bounce' },
    { id: 'lb7', name: 'Cable Crunch',                  muscles: 'Abs',           type: 'Iso',      target: '75 kg × 12 × 3',                            cue: 'Third abs session — spine curls not hips hinge • 1s hold at bottom • same as Day 1' },
  ],
};

// Week 4
export const W4_DAY_EXERCISES: Record<number, Omit<Exercise, 'sets'>[]> = {
  1: [ // Lower A — arm finishers added; order: Hack → Leg Curl → Pull-Through → Hip Thrust → Calf → Crunch → Preacher → Tricep Ext
    { id: 'la1', name: 'Hack Squat',                muscles: 'Quads, Glutes',      type: 'Compound', target: '95 kg × 10 × 3',                            cue: 'Feet hip width • knees track over toes • full depth • drive through mid-foot • don\'t let lower back round at bottom' },
    { id: 'la5', name: 'Seated Leg Curl',           muscles: 'Hamstrings',         type: 'Iso',      target: '75 kg × 10 × 3',                            cue: 'Initiate with hamstring not momentum • 3s eccentric on the way up • full range both directions' },
    { id: 'la3', name: 'Cable Pull-Through',        muscles: 'Glutes, Hamstrings', type: 'Compound', target: '61 kg × 10 × 3',                            cue: 'Hinge at hip not waist • let cable pull you into stretch • drive hips forward explosively • squeeze glutes hard at lockout' },
    { id: 'la4', name: 'Hip Thrust (Machine)',      muscles: 'Glute Maximus',      type: 'Compound', target: '100 kg × 10 × 3',                           cue: 'Chin tucked • drive through heels • full hip extension at top • 1s pause — don\'t hyperextend spine' },
    { id: 'la6', name: 'Seated Calf Raise',         muscles: 'Gastrocnemius',      type: 'Iso',      target: '22.5 kg × 12 × 3 + dropset → 17.5 kg × 8', cue: 'Full stretch at bottom — 2s hold • drive up through ball of foot • squeeze at top' },
    { id: 'la7', name: 'Cable Crunch',              muscles: 'Abs',                type: 'Iso',      target: '77 kg × 12 × 3',                            cue: 'Rope at forehead • curl spine down — not a hip hinge • elbows to knees • hold contraction 1s at bottom' },
    { id: 'la8', name: 'Preacher Curl (Machine)',   muscles: 'Biceps Short Head',  type: 'Iso',      target: '43 kg × 8 + dropset → 34 kg × 4',           cue: 'Upper arm fixed on pad throughout • full extension at bottom — don\'t cut it short • squeeze hard at peak • 2s hold' },
    { id: 'la9', name: 'Machine Triceps Extension', muscles: 'Triceps',            type: 'Iso',      target: '45 kg × 8 + dropset → 36 kg × 4',           cue: 'Upper arm fixed • full extension at bottom — don\'t cut range short • 1s hold at lockout • slow return — feel the stretch at top' },
  ],
  2: [ // Push — Preacher Curl dropped; bench targets reset; order adjusted
    { id: '1', name: 'Flat DB Bench Press',    muscles: 'Mid Chest, Triceps',   type: 'Compound', target: '37.5 kg × 8 × 3',                      cue: 'Retract scapula into bench • DBs at chest level • drive up and slightly together • elbows max 75° flare • 2s descent' },
    { id: '3', name: 'Incline DB Bench Press', muscles: 'Upper Chest, Triceps', type: 'Compound', target: '35 kg × 8 × 3',                        cue: '30–45° incline • same scapula retraction • feel upper chest stretch at bottom • press in an arc not straight up' },
    { id: '2', name: 'Hammer Curl',            muscles: 'Brachialis, Biceps',   type: 'Iso',      target: '20 kg × 6 × 3 + dropset → 15 kg × 4', cue: 'Neutral grip • full hang at bottom • curl to shoulder height • no swing — if torso rocks weight is too heavy' },
    { id: '5', name: 'Decline Machine Press',  muscles: 'Lower Chest, Triceps', type: 'Compound', target: '40 kg × 6 × 3',                        cue: 'Elbows slightly below chest height • squeeze pecs at lockout • slow eccentric — chest not shoulders' },
    { id: '7', name: 'Pec Deck Fly',           muscles: 'Chest',                type: 'Iso',      target: '70 kg × 8 × 3',                        cue: 'Slight bend in elbow fixed throughout • lead with elbows not hands • squeeze hard at peak • 2s hold' },
    { id: '4', name: 'Incline Supinated Curl', muscles: 'Biceps Long Head',     type: 'Iso',      target: '17.5 kg × 8 × 3 + dropset',            cue: 'Full dead hang at bottom — let bicep fully stretch • supinate wrist as you curl • don\'t swing at top' },
  ],
  3: [ // Pull — weighted pull-ups; Diverging LP; Single-arm row; Cable Curl dropped
    { id: 'pu1', name: 'Pull-Ups',                        muscles: 'Lats, Upper Back, Biceps', type: 'Compound', target: '5 kg × 8 × 3',                        cue: 'Dead hang start • depress scapula before pulling • drive elbows to hips not hands to bar • chin over bar • controlled descent' },
    { id: 'pu2', name: 'Chest-Supported Row',             muscles: 'Mid Back, Lats',           type: 'Compound', target: '70 kg × 8 × 3',                        cue: 'Chest pinned to pad throughout • retract scapula first then pull • elbows at 45° to torso • squeeze at peak — don\'t shrug' },
    { id: 'pu3', name: 'Diverging Lat Pulldown',          muscles: 'Lats',                     type: 'Compound', target: '84 kg × 8 × 3',                        cue: 'Slight lean back • pull bar to upper chest • drive elbows down and back • full stretch at top — feel the lat lengthen' },
    { id: 'pu5', name: 'Rope Tricep Pushdown',            muscles: 'Triceps',                  type: 'Iso',      target: '64 kg × 8 + dropset → 54 kg × 4',     cue: 'Elbows pinned to sides throughout • split rope at bottom • full lockout • 1s hold — don\'t let elbows drift forward' },
    { id: 'pu4', name: 'Single-Arm Seated Cable Row',     muscles: 'Mid Back',                 type: 'Compound', target: '40 kg × 8 × 3',                        cue: 'Tall spine • hinge slightly forward on eccentric • row to lower chest • pause 1s at contraction — no momentum' },
    { id: 'pu6', name: 'Supinated Single-Arm Pushdown',   muscles: 'Triceps',                  type: 'Iso',      target: '29 kg × 8 × 3 + dropset → 23 kg × 6', cue: 'Palm facing up • elbow fixed at side • rotate wrist to full supination at lockout — feel the long head stretch at top' },
    { id: 'pu7', name: 'Cable Crunch',                    muscles: 'Abs',                      type: 'Iso',      target: '77 kg × 12 × 3',                       cue: 'Rope at forehead • curl spine — not hips • hold 1s at bottom • slow return' },
  ],
  4: [ // Boulder Shoulder — Cable Fly + Tricep Ext replaced by Cable Bar Curl + Bar Pushdown
    { id: 'sh1',  name: 'Machine Shoulder Press',             muscles: 'Anterior Delt, Triceps', type: 'Compound', target: '57.5 kg × 8 × 3',                      cue: 'Seat height so handles start at shoulder level • press in slight arc • don\'t fully lock out — keep tension on delt • control the descent' },
    { id: 'sh2',  name: 'Chest-Supported Rear Delt Row',      muscles: 'Rear Delt',              type: 'Iso',      target: '37.5 kg × 10 × 3',                     cue: 'Chest on pad • arms out at 90° to torso • drive elbows back and out — not down • externally rotate at peak • squeeze rear delt not mid back' },
    { id: 'sh3',  name: 'Seated DB Lateral Raise',            muscles: 'Lateral Delt',           type: 'Iso',      target: '20 kg × 8 × 3 + dropset → 15 kg × 6', cue: 'Slight forward lean • lead with elbow not hand • raise to just above shoulder height • 2s hold at top — if traps are taking over the weight is too heavy' },
    { id: 'sh4',  name: 'Cable Rear Delt Pull (Bow & Arrow)', muscles: 'Rear Delt',              type: 'Iso',      target: '34 kg × 8 × 3 + dropset → 25 kg × 6', cue: 'Single arm • pull across body to ear height • elbow leads • rotate shoulder back at end range — think drawing a bow' },
    { id: 'sh5',  name: 'Side Delt Machine',                  muscles: 'Lateral Delt',           type: 'Iso',      target: '36 kg × 7 × 3 + dropset → 29 kg × 5', cue: 'Slight forward lean into pad • lead with elbow • raise to just above shoulder — don\'t shrug at top • slow controlled return' },
    { id: 'sh9',  name: 'Cable Crunch',                       muscles: 'Abs',                    type: 'Iso',      target: '77 kg × 12 × 3',                       cue: 'Rope at forehead • curl spine — not hips • hold 1s at bottom • slow return' },
    { id: 'sh10', name: 'Cable Bar Curl',                     muscles: 'Biceps',                 type: 'Iso',      target: '47 kg × 8 × 3',                        cue: 'Elbows pinned • full stretch at bottom • squeeze hard at top • controlled eccentric' },
    { id: 'sh11', name: 'Bar Pushdown',                       muscles: 'Triceps',                type: 'Iso',      target: '64 kg × 8 × 3 + dropset → 54 kg × 8', cue: 'Elbows pinned to sides • full lockout at bottom • 1s hold • slow return' },
  ],
  5: [ // Lower B — Standing Calf replaces Seated; targets progressed
    { id: 'lb1', name: 'Leg Press',                     muscles: 'Quads, Glutes', type: 'Compound', target: '145 kg × 10 × 3',                          cue: 'Feet hip width mid-platform • full depth without lower back rounding off seat • drive through mid-foot — don\'t lock out at top' },
    { id: 'lb2', name: 'Bulgarian Split Squat (Smith)', muscles: 'Quads, Glutes', type: 'Compound', target: '62.5 kg × 8 × 3',                           cue: 'Front foot far enough forward so shin stays vertical • lower straight down — don\'t lean forward • drive through front heel • back knee just above floor' },
    { id: 'lb3', name: 'Lying Leg Curl',                muscles: 'Hamstrings',    type: 'Iso',      target: '75 kg × 10 × 3',                            cue: '3s eccentric — fight the weight on the way up • full range both directions • don\'t let hips rise off pad' },
    { id: 'lb5', name: 'Leg Extension',                 muscles: 'Quads',         type: 'Iso',      target: '90 kg × 10 × 3',                            cue: 'Sit tall • full extension at top — 1s pause • slow 3s descent • toes neutral or slightly inward' },
    { id: 'lb6', name: 'Standing Calf Raise',           muscles: 'Calves',        type: 'Iso',      target: '22.5 kg × 12 × 3 + dropset → 17.5 kg × 8', cue: 'Full stretch at bottom — 2s hold • drive through ball of foot • squeeze at top • don\'t bounce' },
    { id: 'lb7', name: 'Cable Crunch',                  muscles: 'Abs',           type: 'Iso',      target: '77 kg × 12 × 3',                            cue: 'Third abs session — spine curls not hips hinge • 1s hold at bottom • same as Day 1' },
  ],
};

// Week 1 (re-entry baseline)
export const W1_DAY_EXERCISES: Record<number, Omit<Exercise, 'sets'>[]> = {
  1: [
    { id: 'la1', name: 'Hack Squat', muscles: 'Quads, Glutes', type: 'Compound', target: '80 kg × 6–8 × 3', cue: 'Knees forward • full depth • no bounce • constant tension' },
    { id: 'la2', name: 'DB Romanian Deadlift', muscles: 'Hamstrings, Glutes', type: 'Compound', target: '40 kg × 8 × 3', cue: 'Hips back • deep hamstring stretch • neutral spine • slow eccentric' },
    { id: 'la3', name: 'Cable Pull-Through', muscles: 'Glutes, Hamstrings', type: 'Compound', target: '50 kg × 10 × 3', cue: 'Hinge at hip not waist • glutes finish • no lower back drive • pause at lockout' },
    { id: 'la4', name: 'Hip Thrust (Machine)', muscles: 'Glute Maximus', type: 'Compound', target: '80 kg × 8–10 × 3', cue: 'Full lockout • 1–2s squeeze • ribs down • no hyperextension' },
    { id: 'la5', name: 'Seated Leg Curl', muscles: 'Hamstrings', type: 'Iso', target: '50 kg × 10 × 3', cue: 'Initiate with hamstring not momentum • 3s eccentric • full range both directions' },
    { id: 'la6', name: 'Seated Calf Raise', muscles: 'Gastrocnemius', type: 'Iso', target: '15 kg × 10–12 × 3', cue: 'Full stretch at bottom • 2s hold • drive through ball of foot • squeeze at top' },
    { id: 'la7', name: 'Cable Crunch', muscles: 'Abs', type: 'Iso', target: '73 kg × 12 × 3', cue: 'Rope at forehead • curl spine — not a hip hinge • elbows to knees • 1s hold' },
  ],
  2: [
    { id: '1', name: 'Flat DB Bench Press', muscles: 'Mid Chest, Triceps', type: 'Compound', target: '40 kg × 6–8 × 3', cue: 'Retract scapula into bench • drive up and slightly together • elbows max 75° • 2s descent' },
    { id: '3', name: 'Incline DB Bench Press', muscles: 'Upper Chest, Triceps', type: 'Compound', target: '37.5 kg × 6–8 × 3', cue: '30–45° incline • scapula retraction • feel upper chest stretch • press in arc not straight up' },
    { id: '5', name: 'Decline Machine Press', muscles: 'Lower Chest, Triceps', type: 'Compound', target: '45 kg × 6–8 × 3', cue: 'Elbows slightly below chest height • squeeze pecs at lockout • slow eccentric' },
    { id: '7', name: 'Pec Deck Fly', muscles: 'Chest', type: 'Iso', target: '79 kg × 10–12 × 2 + dropset', cue: 'Slight bend in elbow fixed • lead with elbows not hands • squeeze hard at peak • 2s hold' },
    { id: '2', name: 'Hammer Curl', muscles: 'Brachialis, Biceps', type: 'Iso', target: '20 kg × 4–6 × 3 + dropset', cue: 'Neutral grip • full hang at bottom • curl to shoulder • no swing' },
    { id: '4', name: 'Incline Supinated Curl', muscles: 'Biceps Long Head', type: 'Iso', target: '20 kg × 4–6 × 3 + dropset', cue: 'Full dead hang • supinate as you curl • don\'t swing at top' },
    { id: '6', name: 'Preacher Curl', muscles: 'Biceps Short Head', type: 'Iso', target: '38–40 kg × 10–12 × 3', cue: 'Upper arm fixed on pad • full extension at bottom • squeeze hard at peak • 2s hold' },
  ],
  3: [
    { id: 'pu1', name: 'Pull-Ups (Bodyweight)', muscles: 'Lats, Upper Back, Biceps', type: 'Compound', target: 'BW × 6–8 × 3', cue: 'Dead hang start • depress scapula • drive elbows to hips • chin over bar • no kipping' },
    { id: 'pu2', name: 'Chest-Supported Row', muscles: 'Mid Back, Lats', type: 'Compound', target: '60 kg × 8 × 3', cue: 'Chest pinned to pad • retract scapula first then pull • elbows 45° to torso • squeeze at peak' },
    { id: 'pu3', name: 'Lat Pulldown', muscles: 'Lats', type: 'Compound', target: '73 kg × 8 × 3', cue: 'Slight lean back • pull to upper chest • drive elbows down and back • full stretch at top' },
    { id: 'pu4', name: 'Seated Cable Row', muscles: 'Mid Back', type: 'Compound', target: '70 kg × 8–10 × 3', cue: 'Tall spine • hinge slightly forward on eccentric • row to lower chest • 1s pause' },
    { id: 'pu5', name: 'Rope Tricep Pushdown', muscles: 'Triceps', type: 'Iso', target: '59 kg × 10–12 × 3 + dropset', cue: 'Elbows pinned • split rope at bottom • full lockout • 1s hold' },
    { id: 'pu6', name: 'Supinated Single-Arm Pushdown', muscles: 'Triceps', type: 'Iso', target: '23 kg × 10–12 × 3 + dropset', cue: 'Palm facing up • elbow fixed • full supination at lockout' },
    { id: 'pu8', name: 'Cable Curl', muscles: 'Biceps', type: 'Iso', target: '15–17.5 kg × 12–15 × 2', cue: 'Elbows slightly forward • full stretch at bottom • squeeze at top — finisher' },
    { id: 'pu7', name: 'Cable Crunch', muscles: 'Abs', type: 'Iso', target: '73 kg × 12 × 3', cue: 'Rope at forehead • curl spine not hips • 1s hold at bottom • slow return' },
  ],
  4: [
    { id: 'sh1', name: 'Machine Shoulder Press', muscles: 'Anterior Delt, Triceps', type: 'Compound', target: '50 kg × 8 × 3', cue: 'Handles at shoulder level • press in slight arc • keep tension on delt • control descent' },
    { id: 'sh3', name: 'Seated DB Lateral Raise', muscles: 'Lateral Delt', type: 'Iso', target: '20 kg × 10–12 × 3', cue: 'Slight forward lean • lead with elbow • raise to shoulder height • 2s hold at top' },
    { id: 'sh2', name: 'Chest-Supported Rear Delt Row', muscles: 'Rear Delt', type: 'Iso', target: '32.5 kg × 10 × 3', cue: 'Chest on pad • arms at 90° to torso • drive elbows back and out • squeeze rear delt' },
    { id: 'sh4', name: 'Cable Rear Delt Pull (Bow & Arrow)', muscles: 'Rear Delt', type: 'Iso', target: '32 kg × 10–12 × 2 + dropset', cue: 'Single arm • pull to ear height • elbow leads • rotate shoulder back' },
    { id: 'sh5', name: 'Standing Side Delt Raise Machine', muscles: 'Lateral Delt', type: 'Iso', target: '37 kg × 8–10 × 3', cue: 'Slight forward lean • lead with elbow • raise to shoulder — don\'t shrug • slow return' },
    { id: 'sh6', name: 'Tricep Machine Extension', muscles: 'Triceps', type: 'Iso', target: '30–35 kg × 10–12 × 3 + dropset', cue: 'Upper arm fixed • full extension at bottom • 1s hold • slow return' },
    { id: 'sh7', name: 'Cable Curl', muscles: 'Biceps', type: 'Iso', target: '15–17.5 kg × 12–15 × 1', cue: 'Finisher — full stretch • full squeeze • no momentum. One crisp set' },
  ],
  5: [
    { id: 'lb1', name: 'Leg Press', muscles: 'Quads, Glutes', type: 'Compound', target: '120 kg × 8 × 3', cue: 'Feet hip width mid-platform • full depth • drive through mid-foot — don\'t lock out' },
    { id: 'lb2', name: 'Bulgarian Split Squat (Smith)', muscles: 'Quads, Glutes', type: 'Compound', target: '45.9 kg × 8 × 3', cue: 'Front foot far forward • shin stays vertical • lower straight down • drive through heel' },
    { id: 'lb3', name: 'Lying / Seated Leg Curl', muscles: 'Hamstrings', type: 'Iso', target: '68 kg × 8–10 × 3', cue: '3s eccentric • full range both directions • don\'t let hips rise off pad' },
    { id: 'lb5', name: 'Leg Extension', muscles: 'Quads', type: 'Iso', target: '84 kg × 8–10 × 3', cue: 'Sit tall • full extension at top — 1s pause • slow 3s descent' },
    { id: 'lb6', name: 'Seated Calf Raise', muscles: 'Calves', type: 'Iso', target: '15 kg × 12–15 × 3', cue: 'Full stretch at bottom — 2s hold • drive through ball of foot • squeeze at top' },
    { id: 'lb7', name: 'Cable Crunch', muscles: 'Abs', type: 'Iso', target: '73 kg × 12 × 3', cue: 'Spine curls not hips hinge • 1s hold at bottom' },
  ],
};

// ─── Week Selector ────────────────────────────────────────────────────────────

export function getWeekExercises(week: number): Record<number, Omit<Exercise, 'sets'>[]> {
  if (week <= 1) return W1_DAY_EXERCISES;
  if (week === 2) return W2_DAY_EXERCISES;
  if (week === 3) return W3_DAY_EXERCISES;
  return W4_DAY_EXERCISES;
}

// ─── Split Metadata ───────────────────────────────────────────────────────────

export const SPLIT: Record<number, string> = {
  1: 'Leg A',
  2: 'Push Day',
  3: 'Pull Day',
  4: 'Boulder Shoulder',
  5: 'Leg B',
  6: 'Rest Day',
  0: 'Rest Day',
};

export const WORKOUT_ORDER = ['Leg A', 'Push Day', 'Pull Day', 'Boulder Shoulder', 'Leg B'];

// ─── Poster UI Constants ──────────────────────────────────────────────────────

export const WEEK_DAYS = [1, 2, 3, 4, 5];

export const POSTER_NAMES: Record<number, string> = {
  1: 'TERRA FIRMA',
  2: 'OVERRIDE',
  3: 'UNDERTOW',
  4: 'BOULDER SHOULDER',
  5: 'AFTERMATH',
};

export const POSTER_COLORS: Record<number, string> = {
  1: '#FF006E',
  2: '#00D4FF',
  3: '#BF5FFF',
  4: '#FFD700',
  5: '#39FF14',
};

// Typography matched to workout tone
export const DAY_TEXT_STYLES: Record<number, object> = {
  1: { fontSize: 64, fontWeight: '900', letterSpacing: -6 },                      // granite slab — immovable leg A
  2: { fontSize: 40, fontWeight: '800', letterSpacing: -1, fontStyle: 'italic' }, // charging forward — push day
  3: { fontSize: 34, fontWeight: '300', letterSpacing: 9, fontStyle: 'italic' },  // flowing current — pull day
  4: { fontSize: 13, fontWeight: '600', letterSpacing: 14 },                      // precise chisel — shoulder isolation
  5: { fontSize: 52, fontWeight: '100', letterSpacing: 3 },                       // depleted but standing — leg B
};

// Days that get the boxed headliner treatment
export const BOXED_DAYS = new Set([1]);

// ─── Program Parser Data ──────────────────────────────────────────────────────

export const PARSE_DAY_HEADERS: Record<string, number> = {
  'LEG A': 1, 'PUSH DAY': 2, 'PULL DAY': 3, 'BOULDER SHOULDER': 4, 'LEG B': 5,
};

export const ALL_KNOWN_EXERCISES: Omit<Exercise, 'sets'>[] = [
  W1_DAY_EXERCISES, W2_DAY_EXERCISES, W3_DAY_EXERCISES, W4_DAY_EXERCISES,
].flatMap(w => Object.values(w).flat()).concat(SWAP_POOL);
