import { useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Keyboard, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector, Swipeable } from 'react-native-gesture-handler';
import { Ink } from '@/constants/theme';
import { nowMs } from '@/lib/format';
import type { Exercise } from '../types';

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
export const NUMPAD_ID = 'numpad-bar';
export const NUMPAD_DONE_ID = 'numpad-done';
let numpadNext: (() => void) | null = null;
/** Called by the Next button in the keyboard bar. */
export function runNumpadNext() { numpadNext?.(); }

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

export function DraggableCard({
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
    minWidth: 0,
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

