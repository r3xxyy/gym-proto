import { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

// ─── Types (mirrored from index.tsx) ─────────────────────────────────────────

type Drop = { weight: string; reps: string };
type Set = { weight: string; reps: string; drops: Drop[] };
type Exercise = {
  id: string;
  name: string;
  muscles: string;
  type: 'Compound' | 'Iso';
  target: string;
  cue: string;
  sets: Set[];
};
type HistoryEntry = {
  id: string;
  date: string;
  workoutName: string;
  duration: number;
  restTime: number;
  exercises: Exercise[];
};

// ─── Muscle mapping ───────────────────────────────────────────────────────────

const MUSCLE_GROUPS: Record<string, string> = {
  'mid chest': 'Chest',
  'upper chest': 'Chest',
  'lower chest': 'Chest',
  'chest': 'Chest',
  'triceps': 'Triceps',
  'biceps': 'Biceps',
  'biceps long head': 'Biceps',
  'biceps short head': 'Biceps',
  'brachialis': 'Biceps',
  'lats': 'Back',
  'mid back': 'Back',
  'upper back': 'Back',
  'rear delt': 'Rear Delt',
  'lateral delt': 'Shoulders',
  'anterior delt': 'Shoulders',
  'deltoid': 'Shoulders',
  'shoulders': 'Shoulders',
  'quads': 'Quads',
  'hamstrings': 'Hamstrings',
  'glutes': 'Glutes',
  'glute maximus': 'Glutes',
  'gastrocnemius': 'Calves',
  'calves': 'Calves',
  'abs': 'Core',
};

const HISTORY_PATH = FileSystem.documentDirectory + 'history.json';

function getMuscleGroups(muscles: string): string[] {
  const parts = muscles.split(',').map(s => s.trim().toLowerCase());
  const result = new Set<string>();
  parts.forEach(p => { if (MUSCLE_GROUPS[p]) result.add(MUSCLE_GROUPS[p]); });
  return [...result];
}

// ─── MEV / MRV lookup (sets per week, from RP research) ──────────────────────

const MEV_MRV: Record<string, { mev: number; mrv: number }> = {
  'Chest':      { mev: 8,  mrv: 20 },
  'Back':       { mev: 10, mrv: 25 },
  'Shoulders':  { mev: 8,  mrv: 20 },
  'Rear Delt':  { mev: 6,  mrv: 20 },
  'Biceps':     { mev: 8,  mrv: 20 },
  'Triceps':    { mev: 6,  mrv: 18 },
  'Quads':      { mev: 8,  mrv: 20 },
  'Hamstrings': { mev: 6,  mrv: 20 },
  'Glutes':     { mev: 8,  mrv: 20 },
  'Calves':     { mev: 8,  mrv: 20 },
  'Core':       { mev: 0,  mrv: 25 },
};

// ─── Stats computation ────────────────────────────────────────────────────────

type MuscleVolume = { group: string; sets: number };
type PR = { name: string; weight: number; date: string };

function computeStats(history: HistoryEntry[]) {
  const muscleSets: Record<string, number> = {};
  const weekMuscleSets: Record<string, number> = {}; // current week only
  const prMap: Record<string, { weight: number; date: string }> = {};
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const entry of history) {
    for (const ex of entry.exercises) {
      const groups = getMuscleGroups(ex.muscles);
      const setCount = ex.sets.filter(s => s.weight || s.reps).length;
      const isThisWeek = new Date(entry.date).getTime() >= weekAgo;

      groups.forEach(g => {
        muscleSets[g] = (muscleSets[g] ?? 0) + setCount;
        if (isThisWeek) weekMuscleSets[g] = (weekMuscleSets[g] ?? 0) + setCount;
      });

      for (const s of ex.sets) {
        const w = parseFloat(s.weight);
        if (!isNaN(w) && w > 0) {
          if (!prMap[ex.name] || w > prMap[ex.name].weight) {
            prMap[ex.name] = { weight: w, date: entry.date };
          }
        }
      }
    }
  }

  const muscleVolume: MuscleVolume[] = Object.entries(muscleSets)
    .map(([group, sets]) => ({ group, sets }))
    .sort((a, b) => b.sets - a.sets);

  const prs: PR[] = Object.entries(prMap)
    .map(([name, { weight, date }]) => ({ name, weight, date }))
    .sort((a, b) => b.weight - a.weight);

  // Sessions per week — last 4 weeks
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const weeks = [0, 0, 0, 0];
  for (const entry of history) {
    const d = new Date(entry.date).getTime();
    const age = now - d;
    const weekIdx = Math.floor(age / weekMs);
    if (weekIdx < 4) weeks[weekIdx]++;
  }

  return { muscleVolume, weekMuscleSets, prs, weeks };
}

// ─── Coach formatter ─────────────────────────────────────────────────────────

function formatStatsForCoach(
  muscleVolume: MuscleVolume[],
  prs: PR[],
  weeks: number[],
  totalSessions: number,
): string {
  const lines: string[] = [];

  lines.push('=== GYM PROGRESS SUMMARY ===');
  lines.push(`Total sessions logged: ${totalSessions}`);
  lines.push('');

  lines.push('--- SESSIONS PER WEEK (most recent first) ---');
  const weekLabels = ['This week', 'Last week', '2 weeks ago', '3 weeks ago'];
  weeks.forEach((count, i) => lines.push(`${weekLabels[i]}: ${count} session${count !== 1 ? 's' : ''}`));
  lines.push('');

  lines.push('--- SETS BY MUSCLE GROUP (all time) ---');
  const maxSets = muscleVolume[0]?.sets ?? 1;
  muscleVolume.forEach(({ group, sets }) => {
    const bar = '█'.repeat(Math.round((sets / maxSets) * 10));
    const flag = sets === muscleVolume[muscleVolume.length - 1].sets ? ' ← LAGGING' : '';
    lines.push(`${group.padEnd(14)} ${bar.padEnd(10)} ${sets} sets${flag}`);
  });
  lines.push('');

  lines.push('--- PERSONAL RECORDS ---');
  prs.forEach(({ name, weight, date }) => {
    lines.push(`${name}: ${weight} kg  (${date})`);
  });
  lines.push('');

  lines.push('--- QUESTIONS FOR YOU ---');
  lines.push('1. Based on the above, which muscle groups should I prioritise this week?');
  lines.push('2. Should I adjust any weights or rep ranges given the PRs logged?');
  lines.push('3. Is my weekly session frequency on track?');

  return lines.join('\n');
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StatsScreen() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const info = await FileSystem.getInfoAsync(HISTORY_PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(HISTORY_PATH);
        setHistory(JSON.parse(raw));
      }
      setLoaded(true);
    })();
  }, []);

  if (!loaded) return <View style={s.root} />;

  if (history.length === 0) {
    return (
      <View style={[s.root, s.empty]}>
        <Text style={s.emptyText}>No sessions logged yet.</Text>
      </View>
    );
  }

  const { muscleVolume, weekMuscleSets, prs, weeks } = computeStats(history);
  const maxSets = muscleVolume[0]?.sets ?? 1;
  const maxWeek = Math.max(...weeks, 1);

  const weekLabels = ['This week', 'Last week', '2w ago', '3w ago'];

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.screenTitle}>Progress</Text>

      {/* ── Muscle Volume ── */}
      <Text style={s.sectionTitle}>Sets by muscle group — this week</Text>
      <View style={s.card}>
        {muscleVolume.map(({ group }) => {
          const weekly = weekMuscleSets[group] ?? 0;
          const range = MEV_MRV[group];
          const allTime = muscleVolume.find(m => m.group === group)?.sets ?? 0;
          let status: 'low' | 'ok' | 'high' = 'ok';
          if (range) {
            if (weekly < range.mev) status = 'low';
            else if (weekly > range.mrv) status = 'high';
          }
          const barColor = status === 'low' ? '#FF3B30' : status === 'high' ? '#FF9500' : '#34C759';
          return (
            <View key={group} style={s.barRow}>
              <Text style={[s.barLabel, status === 'low' && s.barLabelLow]}>{group}</Text>
              <View style={s.barTrack}>
                <View style={[s.barFill, { width: `${Math.min((weekly / (range?.mrv ?? 20)) * 100, 100)}%` as any, backgroundColor: barColor }]} />
              </View>
              <Text style={[s.barCount, status === 'low' && s.barCountLow]}>{weekly}</Text>
              {range && <Text style={s.mevLabel}>{range.mev}–{range.mrv}</Text>}
            </View>
          );
        })}
        <Text style={s.mevNote}>Green = in range  ·  Red = below MEV  ·  Orange = above MRV</Text>
      </View>

      {/* ── Sessions per week ── */}
      <Text style={s.sectionTitle}>Sessions per week</Text>
      <View style={[s.card, s.weekRow]}>
        {weeks.map((count, i) => (
          <View key={i} style={s.weekCol}>
            <View style={s.weekBarTrack}>
              <View style={[s.weekBarFill, { height: `${(count / maxWeek) * 100}%` as any }]} />
            </View>
            <Text style={s.weekCount}>{count}</Text>
            <Text style={s.weekLabel}>{weekLabels[i]}</Text>
          </View>
        ))}
      </View>

      {/* ── PRs ── */}
      <Text style={s.sectionTitle}>Personal records</Text>
      <View style={s.card}>
        {prs.map(({ name, weight, date }) => (
          <View key={name} style={s.prRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.prName}>{name}</Text>
              <Text style={s.prDate}>{date}</Text>
            </View>
            <Text style={s.prWeight}>{weight} kg</Text>
          </View>
        ))}
      </View>

      {/* ── Coach This ── */}
      <TouchableOpacity
        style={s.coachBtn}
        onPress={() => Share.share({ message: formatStatsForCoach(muscleVolume, prs, weeks, history.length) })}
      >
        <Text style={s.coachBtnText}>Coach This →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20, paddingTop: 64, paddingBottom: 40 },
  empty: { justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 15, color: '#999' },
  screenTitle: { fontSize: 28, fontWeight: '700', marginBottom: 24 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginTop: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 12 },

  // Bar chart
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { width: 90, fontSize: 13, color: '#333' },
  barLabelLow: { color: '#FF3B30' },
  barTrack: { flex: 1, height: 8, backgroundColor: '#f0f0f0', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#333', borderRadius: 4 },
  barFillLow: { backgroundColor: '#FF3B30' },
  barCount: { width: 28, fontSize: 13, color: '#999', textAlign: 'right' },
  barCountLow: { color: '#FF3B30', fontWeight: '600' },
  mevLabel: { width: 42, fontSize: 10, color: '#bbb', textAlign: 'right' },
  mevNote: { fontSize: 10, color: '#bbb', marginTop: 4 },

  // Week bars
  weekRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: 120 },
  weekCol: { alignItems: 'center', gap: 4, flex: 1 },
  weekBarTrack: { width: 28, height: 60, backgroundColor: '#f0f0f0', borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end' },
  weekBarFill: { width: '100%', backgroundColor: '#333', borderRadius: 4 },
  weekCount: { fontSize: 14, fontWeight: '600', color: '#333' },
  weekLabel: { fontSize: 10, color: '#aaa', textAlign: 'center' },

  // Coach
  coachBtn: { marginTop: 32, paddingVertical: 16, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, alignItems: 'center' },
  coachBtnText: { fontSize: 13, fontWeight: '600', letterSpacing: 3, color: '#333', textTransform: 'uppercase' },

  // PRs
  prRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  prName: { fontSize: 14, color: '#333', fontWeight: '500' },
  prDate: { fontSize: 11, color: '#bbb', marginTop: 2 },
  prWeight: { fontSize: 18, fontWeight: '700', color: '#333' },
});
