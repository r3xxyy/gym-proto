import { useRef, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ink } from '@/constants/theme';
import { PROGRAM_EPOCH, SPLIT_LABEL, WORKOUT_ORDER, WORKOUT_TO_DAY } from '../constants/programs';
import { formatSessionForCoach } from '@/lib/coach-text';
import { formatTime, parseHistoryDate, shortGym } from '@/lib/format';
import { sessionVolume } from '@/lib/session-stats';
import { NUMPAD_DONE_ID } from './exercise-card';
import type { Exercise, HistoryEntry } from '../types';

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
          style={hCard.notes}
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

export function HistoryScreen({ history, onBack, onDelete, onMerge, onEditEntry, programEpoch = PROGRAM_EPOCH }: {
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
        <View style={hist2.centered}>
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


const hist2 = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
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
  notes: { fontSize: 14, color: Ink.textDim, marginTop: 10, borderBottomWidth: 1, borderBottomColor: Ink.line, paddingVertical: 6 },
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

