import { useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

// ─── Types ────────────────────────────────────────────────────────────────────

type ParamField = {
  key: string;
  label: string;
  unit: string;
  keyboard?: 'default' | 'decimal-pad' | 'number-pad';
};

type CardioSession = {
  id: string;
  date: string;
  exercise: string;
  duration: number;
  params: Record<string, string>;
};

// ─── Exercise config ──────────────────────────────────────────────────────────

const EXERCISES: { name: string; emoji: string; params: ParamField[] }[] = [
  {
    name: 'Treadmill',
    emoji: '🏃',
    params: [
      { key: 'speed',    label: 'Speed',    unit: 'km/h', keyboard: 'decimal-pad' },
      { key: 'incline',  label: 'Incline',  unit: '%',    keyboard: 'decimal-pad' },
      { key: 'distance', label: 'Distance', unit: 'km',   keyboard: 'decimal-pad' },
    ],
  },
  {
    name: 'Incline Walk',
    emoji: '⛰️',
    params: [
      { key: 'speed',    label: 'Speed',    unit: 'km/h', keyboard: 'decimal-pad' },
      { key: 'incline',  label: 'Incline',  unit: '%',    keyboard: 'decimal-pad' },
      { key: 'distance', label: 'Distance', unit: 'km',   keyboard: 'decimal-pad' },
    ],
  },
  {
    name: 'Sprint Intervals',
    emoji: '⚡',
    params: [
      { key: 'rounds',        label: 'Rounds',       unit: '',    keyboard: 'number-pad' },
      { key: 'sprintSpeed',   label: 'Sprint speed', unit: 'km/h',keyboard: 'decimal-pad' },
      { key: 'sprintDuration',label: 'Sprint',       unit: 'sec', keyboard: 'number-pad' },
      { key: 'restDuration',  label: 'Rest',         unit: 'sec', keyboard: 'number-pad' },
      { key: 'incline',       label: 'Incline',      unit: '%',   keyboard: 'decimal-pad' },
    ],
  },
  {
    name: 'Cycling',
    emoji: '🚴',
    params: [
      { key: 'resistance', label: 'Resistance', unit: 'lvl', keyboard: 'number-pad' },
      { key: 'rpm',        label: 'RPM',        unit: '',    keyboard: 'number-pad' },
      { key: 'watts',      label: 'Watts',      unit: 'W',   keyboard: 'number-pad' },
      { key: 'distance',   label: 'Distance',   unit: 'km',  keyboard: 'decimal-pad' },
    ],
  },
  {
    name: 'Rowing',
    emoji: '🚣',
    params: [
      { key: 'pace',     label: 'Pace',     unit: '/500m', keyboard: 'default' },
      { key: 'spm',      label: 'SPM',      unit: '',      keyboard: 'number-pad' },
      { key: 'watts',    label: 'Watts',    unit: 'W',     keyboard: 'number-pad' },
      { key: 'distance', label: 'Distance', unit: 'm',     keyboard: 'number-pad' },
    ],
  },
  {
    name: 'Stairmaster',
    emoji: '🪜',
    params: [
      { key: 'level',    label: 'Level',     unit: '',  keyboard: 'number-pad' },
      { key: 'stepRate', label: 'Steps/min', unit: '',  keyboard: 'number-pad' },
    ],
  },
  {
    name: 'Elliptical',
    emoji: '🔄',
    params: [
      { key: 'resistance', label: 'Resistance', unit: 'lvl', keyboard: 'number-pad' },
      { key: 'rpm',        label: 'RPM',        unit: '',    keyboard: 'number-pad' },
      { key: 'distance',   label: 'Distance',   unit: 'km',  keyboard: 'decimal-pad' },
    ],
  },
  {
    name: 'Ski Erg',
    emoji: '⛷️',
    params: [
      { key: 'pace',     label: 'Pace',     unit: '/500m', keyboard: 'default' },
      { key: 'spm',      label: 'SPM',      unit: '',      keyboard: 'number-pad' },
      { key: 'distance', label: 'Distance', unit: 'm',     keyboard: 'number-pad' },
    ],
  },
  {
    name: 'Outdoor Run',
    emoji: '🌤️',
    params: [
      { key: 'distance', label: 'Distance', unit: 'km',  keyboard: 'decimal-pad' },
      { key: 'avgPace',  label: 'Avg pace', unit: '/km', keyboard: 'default' },
    ],
  },
  {
    name: 'HIIT',
    emoji: '🔥',
    params: [
      { key: 'rounds',       label: 'Rounds',    unit: '',    keyboard: 'number-pad' },
      { key: 'workInterval', label: 'Work',      unit: 'sec', keyboard: 'number-pad' },
      { key: 'restInterval', label: 'Rest',      unit: 'sec', keyboard: 'number-pad' },
      { key: 'description',  label: 'Exercises', unit: '',    keyboard: 'default' },
    ],
  },
];

// ─── Tabata Timer ─────────────────────────────────────────────────────────────

function TabataTimer({ workSec, restSec, totalRounds }: { workSec: number; restSec: number; totalRounds: number }) {
  const [phase, setPhase] = useState<'idle' | 'work' | 'rest' | 'done'>('idle');
  const [countdown, setCountdown] = useState(workSec || 20);
  const [currentRound, setCurrentRound] = useState(1);
  const [running, setRunning] = useState(false);

  // Reset if params change
  useEffect(() => {
    setRunning(false);
    setPhase('idle');
    setCountdown(workSec || 20);
    setCurrentRound(1);
  }, [workSec, restSec, totalRounds]);

  // Tick
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Phase transitions
  useEffect(() => {
    if (!running || countdown > 0) return;
    if (phase === 'work') {
      setPhase('rest');
      setCountdown(restSec || 10);
    } else if (phase === 'rest') {
      if (currentRound >= totalRounds) {
        setPhase('done');
        setRunning(false);
      } else {
        setCurrentRound(r => r + 1);
        setPhase('work');
        setCountdown(workSec || 20);
      }
    }
  }, [countdown, running]);

  function toggle() {
    if (phase === 'idle' || phase === 'done') {
      setPhase('work');
      setCountdown(workSec || 20);
      setCurrentRound(1);
      setRunning(true);
    } else {
      setRunning(r => !r);
    }
  }

  const isWork = phase === 'work';
  const isDone = phase === 'done';
  const isIdle = phase === 'idle';
  const color = isWork ? '#FF3B30' : isDone ? '#34C759' : isIdle ? '#999' : '#007AFF';
  const phaseLabel = isIdle ? 'READY' : isDone ? 'DONE' : isWork ? 'WORK' : 'REST';
  const progress = isIdle || isDone ? 1 : isWork
    ? countdown / (workSec || 20)
    : countdown / (restSec || 10);

  return (
    <View style={tab.container}>
      {/* Phase label */}
      <Text style={[tab.phase, { color }]}>{phaseLabel}</Text>

      {/* Countdown */}
      <Text style={[tab.countdown, { color }]}>
        {isIdle ? '--' : isDone ? '🎉' : String(countdown).padStart(2, '0')}
      </Text>

      {/* Progress bar */}
      <View style={tab.barTrack}>
        <View style={[tab.barFill, { width: `${progress * 100}%` as any, backgroundColor: color }]} />
      </View>

      {/* Round indicator */}
      {!isIdle && (
        <Text style={tab.rounds}>
          {isDone ? `${totalRounds} rounds complete` : `Round ${currentRound} of ${totalRounds}`}
        </Text>
      )}

      {/* Start / Pause / Restart */}
      <TouchableOpacity style={[tab.btn, { borderColor: color }]} onPress={toggle}>
        <Text style={[tab.btnText, { color }]}>
          {isIdle ? 'START' : isDone ? 'RESTART' : running ? 'PAUSE' : 'RESUME'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CARDIO_PATH = FileSystem.documentDirectory + 'cardio.json';

function formatTime(s: number) {
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatDuration(s: number) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CardioScreen() {
  const [screen, setScreen] = useState<'home' | 'select' | 'active' | 'summary'>('home');
  const [sessions, setSessions] = useState<CardioSession[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<typeof EXERCISES[0] | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [seconds, setSeconds] = useState(0);
  const [savedSession, setSavedSession] = useState<CardioSession | null>(null);
  const [intervalRound, setIntervalRound] = useState(1);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const exerciseRef = useRef<typeof EXERCISES[0] | null>(null);

  // Load persisted sessions
  useEffect(() => {
    (async () => {
      const info = await FileSystem.getInfoAsync(CARDIO_PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(CARDIO_PATH);
        setSessions(JSON.parse(raw));
      }
    })();
  }, []);

  // Cleanup timer
  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  function startSession(exercise: typeof EXERCISES[0]) {
    exerciseRef.current = exercise;
    setSelectedExercise(exercise);
    setParams({});
    setSeconds(0);
    setIntervalRound(1);
    setScreen('active');
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
  }

  function stopSession() {
    const exercise = exerciseRef.current;
    if (!exercise) return;
    if (timerRef.current) clearInterval(timerRef.current);
    const entry: CardioSession = {
      id: Date.now().toString(),
      date: new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
      exercise: exercise.name,
      duration: seconds,
      params,
    };
    const updated = [entry, ...sessions];
    setSessions(updated);
    FileSystem.writeAsStringAsync(CARDIO_PATH, JSON.stringify(updated));
    setSavedSession(entry);
    setScreen('summary');
  }

  function deleteSession(id: string) {
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    FileSystem.writeAsStringAsync(CARDIO_PATH, JSON.stringify(updated));
  }

  function reset() {
    exerciseRef.current = null;
    setScreen('home');
    setSelectedExercise(null);
    setParams({});
    setSeconds(0);
  }

  const isInterval = selectedExercise?.name === 'Sprint Intervals' || selectedExercise?.name === 'HIIT';
  const totalRounds = parseInt(params['rounds'] ?? '0') || 0;

  // ── Home ──
  if (screen === 'home') {
    return (
      <View style={s.root}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Cardio</Text>
        </View>
        <ScrollView contentContainerStyle={s.homeContent}>
          <TouchableOpacity style={s.startBtn} onPress={() => setScreen('select')}>
            <Text style={s.startBtnText}>START SESSION</Text>
          </TouchableOpacity>

          {sessions.length === 0 ? (
            <Text style={s.empty}>No cardio sessions logged yet.</Text>
          ) : (
            sessions.map(session => {
              const ex = EXERCISES.find(e => e.name === session.exercise);
              const keyParams = Object.entries(session.params)
                .filter(([, v]) => v)
                .map(([k, v]) => {
                  const field = ex?.params.find(p => p.key === k);
                  return field ? `${v}${field.unit}` : null;
                })
                .filter(Boolean)
                .slice(0, 3)
                .join('  ·  ');
              return (
                <View key={session.id} style={s.sessionCard}>
                  <View style={s.sessionRow}>
                    <Text style={s.sessionEmoji}>{ex?.emoji ?? '🏋️'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.sessionName}>{session.exercise}</Text>
                      <Text style={s.sessionDate}>{session.date}</Text>
                      {!!keyParams && <Text style={s.sessionParams}>{keyParams}</Text>}
                    </View>
                    <Text style={s.sessionDuration}>{formatDuration(session.duration)}</Text>
                    <TouchableOpacity onPress={() => deleteSession(session.id)} style={s.deleteBtn}>
                      <Text style={s.deleteBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    );
  }

  // ── Select ──
  if (screen === 'select') {
    return (
      <View style={s.root}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => setScreen('home')}>
            <Text style={s.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>Choose Exercise</Text>
        </View>
        <ScrollView contentContainerStyle={s.selectContent}>
          {EXERCISES.map(ex => (
            <TouchableOpacity key={ex.name} style={s.exerciseRow} onPress={() => startSession(ex)}>
              <Text style={s.exerciseEmoji}>{ex.emoji}</Text>
              <Text style={s.exerciseName}>{ex.name}</Text>
              <Text style={s.exerciseChevron}>›</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Active ──
  if (screen === 'active' && selectedExercise) {
    return (
      <View style={s.root}>
        {/* Timer bar */}
        <View style={s.timerBar}>
          <Text style={s.timerEmoji}>{selectedExercise.emoji}</Text>
          <Text style={s.timerExercise}>{selectedExercise.name}</Text>
          <Text style={s.timerTime}>{formatTime(seconds)}</Text>
          {isInterval && totalRounds > 0 && (
            <Text style={s.timerRounds}>Round {intervalRound} / {totalRounds}</Text>
          )}
        </View>

        <ScrollView contentContainerStyle={s.activeContent}>
          {/* Param inputs */}
          {selectedExercise.params.map(field => (
            <View key={field.key} style={s.paramRow}>
              <Text style={s.paramLabel}>{field.label}</Text>
              <View style={s.paramInputWrap}>
                <TextInput
                  style={s.paramInput}
                  value={params[field.key] ?? ''}
                  onChangeText={v => setParams(prev => ({ ...prev, [field.key]: v }))}
                  keyboardType={field.keyboard ?? 'default'}
                  placeholder="—"
                  placeholderTextColor="#ccc"
                />
                {!!field.unit && <Text style={s.paramUnit}>{field.unit}</Text>}
              </View>
            </View>
          ))}

          {/* Tabata timer for HIIT */}
          {selectedExercise.name === 'HIIT' && (
            <TabataTimer
              workSec={parseInt(params['workInterval'] ?? '20') || 20}
              restSec={parseInt(params['restInterval'] ?? '10') || 10}
              totalRounds={parseInt(params['rounds'] ?? '8') || 8}
            />
          )}

          {/* Manual round counter for Sprint Intervals */}
          {selectedExercise.name === 'Sprint Intervals' && totalRounds > 0 && (
            <View style={s.roundCounter}>
              <TouchableOpacity
                style={[s.roundBtn, intervalRound <= 1 && s.roundBtnDisabled]}
                onPress={() => setIntervalRound(r => Math.max(1, r - 1))}
              >
                <Text style={s.roundBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={s.roundLabel}>Round {intervalRound} of {totalRounds}</Text>
              <TouchableOpacity
                style={[s.roundBtn, intervalRound >= totalRounds && s.roundBtnDisabled]}
                onPress={() => setIntervalRound(r => Math.min(totalRounds, r + 1))}
              >
                <Text style={s.roundBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity style={s.stopBtn} onPress={stopSession}>
            <Text style={s.stopBtnText}>STOP & SAVE</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.discardBtn} onPress={reset}>
            <Text style={s.discardBtnText}>Discard</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Summary ──
  if (screen === 'summary' && savedSession) {
    const ex = EXERCISES.find(e => e.name === savedSession.exercise);
    return (
      <View style={s.root}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Session Done</Text>
        </View>
        <ScrollView contentContainerStyle={s.activeContent}>
          <Text style={s.summaryExercise}>{ex?.emoji} {savedSession.exercise}</Text>
          <Text style={s.summaryDate}>{savedSession.date}</Text>

          <Text style={s.summaryLabel}>Duration</Text>
          <Text style={s.summaryValue}>{formatDuration(savedSession.duration)}</Text>

          {ex?.params.map(field => {
            const val = savedSession.params[field.key];
            if (!val) return null;
            return (
              <View key={field.key}>
                <Text style={s.summaryLabel}>{field.label}</Text>
                <Text style={s.summaryValue}>{val}{field.unit ? ` ${field.unit}` : ''}</Text>
              </View>
            );
          })}

          <TouchableOpacity style={s.stopBtn} onPress={reset}>
            <Text style={s.stopBtnText}>DONE</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return null;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },

  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', alignItems: 'center', gap: 16 },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  back: { fontSize: 16, color: '#007AFF' },

  // Home
  homeContent: { padding: 16, paddingBottom: 40 },
  startBtn: { backgroundColor: '#000', paddingVertical: 18, borderRadius: 8, alignItems: 'center', marginBottom: 24 },
  startBtnText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 4 },
  empty: { fontSize: 14, color: '#aaa', textAlign: 'center', marginTop: 40 },

  sessionCard: { backgroundColor: '#fff', borderRadius: 12, marginBottom: 10, padding: 14 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sessionEmoji: { fontSize: 24 },
  sessionName: { fontSize: 15, fontWeight: '600', color: '#222' },
  sessionDate: { fontSize: 12, color: '#aaa', marginTop: 1 },
  sessionParams: { fontSize: 12, color: '#888', marginTop: 3 },
  sessionDuration: { fontSize: 16, fontWeight: '700', color: '#333', marginRight: 4 },
  deleteBtn: { padding: 4 },
  deleteBtnText: { fontSize: 13, color: '#ccc' },

  // Select
  selectContent: { padding: 16 },
  exerciseRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 8, gap: 14 },
  exerciseEmoji: { fontSize: 24 },
  exerciseName: { flex: 1, fontSize: 16, fontWeight: '500', color: '#222' },
  exerciseChevron: { fontSize: 20, color: '#ccc' },

  // Active
  timerBar: { paddingTop: 60, paddingBottom: 16, paddingHorizontal: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee', alignItems: 'center', gap: 4 },
  timerEmoji: { fontSize: 28 },
  timerExercise: { fontSize: 13, color: '#999', textTransform: 'uppercase', letterSpacing: 1 },
  timerTime: { fontSize: 52, fontWeight: '200', letterSpacing: 4 },
  timerRounds: { fontSize: 13, color: '#007AFF', fontWeight: '600' },

  activeContent: { padding: 20, paddingBottom: 40 },

  paramRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 8, justifyContent: 'space-between' },
  paramLabel: { fontSize: 15, color: '#333', fontWeight: '500' },
  paramInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  paramInput: { borderWidth: 1, borderColor: '#eee', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, fontSize: 16, textAlign: 'right', minWidth: 72, color: '#000' },
  paramUnit: { fontSize: 13, color: '#aaa', minWidth: 36 },

  roundCounter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 8 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  roundBtnDisabled: { backgroundColor: '#eee' },
  roundBtnText: { fontSize: 20, color: '#fff', fontWeight: '300' },
  roundLabel: { fontSize: 15, fontWeight: '600', color: '#333' },

  stopBtn: { backgroundColor: '#000', paddingVertical: 18, borderRadius: 8, alignItems: 'center', marginTop: 16 },
  stopBtnText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 4 },
  discardBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  discardBtnText: { fontSize: 14, color: '#aaa' },

  // Summary
  summaryExercise: { fontSize: 26, fontWeight: '700', color: '#111', marginBottom: 4 },
  summaryDate: { fontSize: 13, color: '#aaa', marginBottom: 24 },
  summaryLabel: { fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginTop: 16 },
  summaryValue: { fontSize: 28, fontWeight: '200', letterSpacing: 2, color: '#111' },
});

const tab = StyleSheet.create({
  container: { backgroundColor: '#fff', borderRadius: 12, padding: 20, marginBottom: 8, alignItems: 'center', gap: 10 },
  phase: { fontSize: 13, fontWeight: '800', letterSpacing: 6, textTransform: 'uppercase' },
  countdown: { fontSize: 80, fontWeight: '100', letterSpacing: 4, lineHeight: 88 },
  barTrack: { width: '100%', height: 6, backgroundColor: '#f0f0f0', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  rounds: { fontSize: 13, color: '#999', letterSpacing: 1 },
  btn: { marginTop: 4, paddingVertical: 12, paddingHorizontal: 36, borderWidth: 1.5, borderRadius: 8, alignItems: 'center' },
  btnText: { fontSize: 13, fontWeight: '700', letterSpacing: 4 },
});
