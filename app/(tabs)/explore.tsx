import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, Modal, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { Exercise, HistoryEntry, UnlockedBadge } from '../../types';
import { ALL_BADGES } from '../../constants/badges';
import type { BadgeDefinition } from '../../constants/badges';
import { PROGRAM_EPOCH, getCurrentProgramWeek, getCurrentWeekBounds } from '../../constants/programs';

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
const BADGES_PATH  = FileSystem.documentDirectory + 'badges.json';
const EPOCH_PATH   = FileSystem.documentDirectory + 'epoch.json';

// Parses "Tue, 14 Apr 2026" as LOCAL midnight — avoids UTC parse skew on negative UTC offsets
const MONTH_IDX: Record<string, number> = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
function parseDateLocal(dateStr: string): number {
  const m = dateStr.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!m) return NaN;
  const month = MONTH_IDX[m[2]];
  if (month === undefined) return NaN;
  return new Date(parseInt(m[3]), month, parseInt(m[1])).getTime();
}

function formatTime(totalSeconds: number) {
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatWeekForCoach(weekEntries: HistoryEntry[]): string {
  const totalVolume = weekEntries.reduce((total, entry) =>
    total + entry.exercises.reduce((ev, ex) =>
      ev + ex.sets.reduce((s, set) => {
        const w = parseFloat(set.weight) || 0;
        const r = parseInt(set.reps) || 0;
        const dropVol = set.drops.reduce((dv, d) =>
          dv + (parseFloat(d.weight) || 0) * (parseInt(d.reps) || 0), 0);
        return s + w * r + dropVol;
      }, 0), 0), 0);

  const totalActive = weekEntries.reduce((t, e) => t + e.duration, 0);
  const totalRest = weekEntries.reduce((t, e) => t + e.restTime, 0);

  const lines: string[] = [
    `WEEK REVIEW`,
    `SESSIONS: ${weekEntries.length}  |  TOTAL VOLUME: ${totalVolume.toLocaleString()} kg`,
    `ACTIVE: ${formatTime(totalActive)}  |  REST: ${formatTime(totalRest)}`,
    ``,
  ];

  weekEntries.forEach(entry => {
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
  lines.push(``);
  return lines.join('\n');
}

function getMuscleGroups(muscles: string): string[] {
  const primary = muscles.split(',')[0].trim().toLowerCase();
  return MUSCLE_GROUPS[primary] ? [MUSCLE_GROUPS[primary]] : [];
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

function computeStats(history: HistoryEntry[], epoch = PROGRAM_EPOCH) {
  const weekMuscleSets: Record<string, number> = {};   // current week
  const fourWeekMuscleSets: Record<string, number> = {}; // rolling 4-week total
  const prMap: Record<string, { weight: number; date: string }> = {};

  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const { start: weekStart, end: weekEnd } = getCurrentWeekBounds(epoch);
  const fourWeekStart = weekStart - 3 * weekMs; // start of 4 weeks ago

  for (const entry of history) {
    const ts = parseDateLocal(entry.date);
    const isThisWeek  = ts >= weekStart    && ts < weekEnd;
    const isLast4Wks  = ts >= fourWeekStart && ts < weekEnd;

    for (const ex of entry.exercises) {
      const groups = getMuscleGroups(ex.muscles);
      const setCount = ex.sets.filter(s => s.weight || s.reps).length;

      groups.forEach(g => {
        if (isThisWeek) weekMuscleSets[g]     = (weekMuscleSets[g]     ?? 0) + setCount;
        if (isLast4Wks) fourWeekMuscleSets[g] = (fourWeekMuscleSets[g] ?? 0) + setCount;
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

  // 4-week weekly average per muscle
  const fourWeekAvgSets: Record<string, number> = {};
  for (const [g, total] of Object.entries(fourWeekMuscleSets)) {
    fourWeekAvgSets[g] = total / 4;
  }

  // Always show all MEV_MRV groups; sort by current-week sets desc, then alpha
  const allGroups = new Set([...Object.keys(MEV_MRV), ...Object.keys(weekMuscleSets), ...Object.keys(fourWeekAvgSets)]);
  const muscleVolume: MuscleVolume[] = [...allGroups]
    .map(group => ({ group, sets: weekMuscleSets[group] ?? 0 }))
    .sort((a, b) => {
      if (b.sets !== a.sets) return b.sets - a.sets;
      return a.group.localeCompare(b.group);
    });

  // PRs sorted by most recent date first
  const prs: PR[] = Object.entries(prMap)
    .map(([name, { weight, date }]) => ({ name, weight, date }))
    .sort((a, b) => parseDateLocal(b.date) - parseDateLocal(a.date));

  const currentWeek = getCurrentProgramWeek(epoch);
  const weeks = [0, 1, 2, 3].map(weeksAgo => {
    const weekNum = currentWeek - weeksAgo;
    if (weekNum < 1) return 0;
    const start = epoch + (weekNum - 1) * weekMs;
    const end = start + weekMs;
    return history.filter(entry => {
      const d = parseDateLocal(entry.date);
      return !isNaN(d) && d >= start && d < end && entry.workoutName !== 'Rest Day';
    }).length;
  });

  return { muscleVolume, weekMuscleSets, fourWeekAvgSets, prs, weeks };
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

  lines.push('--- SESSIONS PER WEEK ---');
  const cw = getCurrentProgramWeek();
  weeks.forEach((count, i) => lines.push(`Week ${cw - i}: ${count} session${count !== 1 ? 's' : ''}`));
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

// ─── Collapsible Section Header ───────────────────────────────────────────────

function SectionHeader({ title, collapsed, onToggle }: { title: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity style={s.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.sectionChevron}>{collapsed ? '›' : '⌄'}</Text>
    </TouchableOpacity>
  );
}

// ─── Badge Detail Modal ───────────────────────────────────────────────────────

const FAMILY_TINT_MODAL: Record<string, { bg: string; border: string; nameColor: string }> = {
  streak:   { bg: '#1a1100', border: '#3d2c00', nameColor: '#c4850a' },
  session:  { bg: '#091621', border: '#0e2438', nameColor: '#4a9fd4' },
  overload: { bg: '#190808', border: '#380f0f', nameColor: '#c44a4a' },
  holiday:  { bg: '#171300', border: '#362d00', nameColor: '#c4a800' },
};

function BadgeModal({ badge, unlockedAt, onClose }: { badge: BadgeDefinition; unlockedAt?: string; onClose: () => void }) {
  const tint = FAMILY_TINT_MODAL[badge.family];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={bm.backdrop} activeOpacity={1} onPress={onClose}>
        <View style={[bm.card, { backgroundColor: tint.bg, borderColor: tint.border }]}>
          <Text style={bm.icon}>{badge.icon}</Text>
          <Text style={[bm.name, { color: tint.nameColor }]}>{badge.name}</Text>
          <Text style={bm.flavour}>{badge.flavour}</Text>
          {unlockedAt
            ? <Text style={bm.date}>Unlocked {unlockedAt}</Text>
            : <Text style={bm.locked}>Not yet earned</Text>
          }
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StatsScreen() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [unlockedBadges, setUnlockedBadges] = useState<UnlockedBadge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedBadge, setSelectedBadge] = useState<BadgeDefinition | null>(null);
  const [programEpoch, setProgramEpoch] = useState(PROGRAM_EPOCH);

  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  function promptEpochEdit() {
    const current = new Date(programEpoch);
    const formatted = `${current.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][current.getMonth()]} ${current.getFullYear()}`;
    Alert.prompt(
      'Program Start Date',
      'Enter the first Monday of your current training block (e.g. 29 Jun 2026)',
      (val) => {
        if (!val?.trim()) return;
        const m = val.trim().match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
        if (!m) { Alert.alert('Invalid date', 'Use format: 29 Jun 2026'); return; }
        const MONTHS: Record<string, number> = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
        const month = MONTHS[m[2]];
        if (month === undefined) { Alert.alert('Invalid month'); return; }
        const newEpoch = new Date(parseInt(m[3]), month, parseInt(m[1])).getTime();
        setProgramEpoch(newEpoch);
        FileSystem.writeAsStringAsync(EPOCH_PATH, JSON.stringify(newEpoch));
      },
      'plain-text',
      formatted,
    );
  }

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const epochInfo = await FileSystem.getInfoAsync(EPOCH_PATH);
        if (epochInfo.exists) {
          const raw = await FileSystem.readAsStringAsync(EPOCH_PATH);
          const saved = JSON.parse(raw);
          if (typeof saved === 'number' && saved > 0) setProgramEpoch(saved);
        }
        const info = await FileSystem.getInfoAsync(HISTORY_PATH);
        if (info.exists) {
          const raw = await FileSystem.readAsStringAsync(HISTORY_PATH);
          const loaded = JSON.parse(raw);
          setHistory(loaded.filter((e: HistoryEntry) => !e.id.startsWith('seed-')));
        }
        const badgesInfo = await FileSystem.getInfoAsync(BADGES_PATH);
        if (badgesInfo.exists) {
          const raw = await FileSystem.readAsStringAsync(BADGES_PATH);
          setUnlockedBadges(JSON.parse(raw));
        }
        setLoaded(true);
      })();
    }, [])
  );

  if (!loaded) return <View style={s.root} />;

  if (history.length === 0) {
    return (
      <View style={[s.root, s.empty]}>
        <Text style={s.emptyText}>No sessions logged yet.</Text>
      </View>
    );
  }

  const { muscleVolume, weekMuscleSets, fourWeekAvgSets, prs, weeks } = computeStats(history, programEpoch);
  const maxWeek = Math.max(...weeks, 1);
  const currentWeek = getCurrentProgramWeek(programEpoch);
  const weekLabels = [0, 1, 2, 3].map(i => `Wk ${currentWeek - i}`);
  const { start: weekStart, end: weekEnd } = getCurrentWeekBounds(programEpoch);
  const weekEntries = history.filter(entry => {
    const d = parseDateLocal(entry.date);
    return d >= weekStart && d < weekEnd;
  });

  const unlockedMap = new Map(unlockedBadges.map(b => [b.id, b.unlockedAt]));

  // Group badges by family for display
  const badgeFamilies: { key: string; label: string; badges: BadgeDefinition[] }[] = [
    { key: 'streak',   label: 'Streak',              badges: ALL_BADGES.filter(b => b.family === 'streak')   },
    { key: 'session',  label: 'Session',              badges: ALL_BADGES.filter(b => b.family === 'session')  },
    { key: 'overload', label: 'Progressive Overload', badges: ALL_BADGES.filter(b => b.family === 'overload') },
    { key: 'holiday',  label: 'Holiday',              badges: ALL_BADGES.filter(b => b.family === 'holiday')  },
  ];

  const FAMILY_TINT: Record<string, { bg: string; border: string; glow: string }> = {
    streak:   { bg: '#1a1100', border: '#3d2c00', glow: '#c4850a' },
    session:  { bg: '#091621', border: '#0e2438', glow: '#1a6fa8' },
    overload: { bg: '#190808', border: '#380f0f', glow: '#8b1a1a' },
    holiday:  { bg: '#171300', border: '#362d00', glow: '#a89100' },
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={s.screenTitle}>Progress</Text>
        <TouchableOpacity onPress={promptEpochEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ fontSize: 10, letterSpacing: 2, color: '#333', textTransform: 'uppercase' }}>
            WK {currentWeek}  ✎
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Muscle Volume ── */}
      <SectionHeader title="Sets / wk — 4wk avg vs target" collapsed={!!collapsed['muscle']} onToggle={() => toggle('muscle')} />
      {!collapsed['muscle'] && (
        <View style={s.card}>
          {muscleVolume.map(({ group }) => {
            const weekly = weekMuscleSets[group] ?? 0;
            const avg = fourWeekAvgSets[group] ?? 0;
            const range = MEV_MRV[group];
            // Status driven by 4-week average (structural signal), not just this week
            let status: 'low' | 'ok' | 'high' = 'ok';
            if (range) {
              if (avg < range.mev) status = 'low';
              else if (avg > range.mrv) status = 'high';
            }
            const barColor = status === 'low' ? '#FF3B30' : status === 'high' ? '#FF9500' : '#34C759';
            const barPct = Math.min((avg / (range?.mrv ?? Math.max(avg, 1))) * 100, 100);
            return (
              <View key={group} style={s.barRow}>
                <Text style={[s.barLabel, status === 'low' && s.barLabelLow]}>{group}</Text>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { width: `${barPct}%` as any, backgroundColor: barColor }]} />
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.barCount, status === 'low' && s.barCountLow]}>{weekly} wk</Text>
                  <Text style={s.mevLabel}>{avg.toFixed(1)} avg</Text>
                </View>
                {range && <Text style={s.mevLabel}>{range.mev}–{range.mrv}</Text>}
              </View>
            );
          })}
          <Text style={s.mevNote}>Bar = 4wk avg  ·  Red = avg below MEV  ·  Orange = avg above MRV</Text>
        </View>
      )}

      {/* ── Sessions per week ── */}
      <SectionHeader title="Sessions per week" collapsed={!!collapsed['weeks']} onToggle={() => toggle('weeks')} />
      {!collapsed['weeks'] && (
        <View style={[s.card, s.weekRow]}>
          {weeks.map((count, i) => count === 0 ? null : (
            <View key={i} style={s.weekCol}>
              <View style={s.weekBarTrack}>
                <View style={[s.weekBarFill, { height: `${(count / maxWeek) * 100}%` as any }]} />
              </View>
              <Text style={s.weekCount}>{count}</Text>
              <Text style={s.weekLabel}>{weekLabels[i]}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── PRs ── */}
      <SectionHeader title="Personal records" collapsed={!!collapsed['prs']} onToggle={() => toggle('prs')} />
      {!collapsed['prs'] && (
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
      )}

      {/* ── Badges ── */}
      <SectionHeader title="Badges" collapsed={!!collapsed['badges']} onToggle={() => toggle('badges')} />
      {!collapsed['badges'] && (
        <View style={{ gap: 24 }}>
          {badgeFamilies.map(({ key, label, badges }) => {
            const tint = FAMILY_TINT[key];
            return (
              <View key={key}>
                <Text style={s.badgeFamilyLabel}>{label}</Text>
                <View style={s.badgeGrid}>
                  {badges.map(badge => {
                    const isUnlocked = unlockedMap.has(badge.id);
                    return (
                      <TouchableOpacity
                        key={badge.id}
                        style={[
                          s.badgeItem,
                          isUnlocked
                            ? { backgroundColor: tint.bg, borderColor: tint.border }
                            : s.badgeItemLocked,
                        ]}
                        onPress={() => setSelectedBadge(badge)}
                        activeOpacity={0.75}
                      >
                        <Text style={[s.badgeIcon, !isUnlocked && s.badgeIconLocked]}>
                          {badge.icon}
                        </Text>
                        <Text
                          style={[s.badgeName, !isUnlocked && s.badgeNameLocked, isUnlocked && { color: tint.glow }]}
                          numberOfLines={2}
                        >
                          {badge.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* ── Coach This Week ── */}
      <TouchableOpacity
        style={s.coachBtn}
        onPress={() => Share.share({ message: formatWeekForCoach(weekEntries) })}
      >
        <Text style={s.coachBtnText}>Coach This Week →</Text>
      </TouchableOpacity>

      {/* ── Badge Detail Modal ── */}
      {selectedBadge && (
        <BadgeModal
          badge={selectedBadge}
          unlockedAt={unlockedMap.get(selectedBadge.id)}
          onClose={() => setSelectedBadge(null)}
        />
      )}

    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080810' },
  content: { padding: 20, paddingTop: 64, paddingBottom: 40 },
  empty: { justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 15, color: '#555' },
  screenTitle: { fontSize: 28, fontWeight: '700', marginBottom: 24, color: '#fff' },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginTop: 24 },
  card: { backgroundColor: '#0e0e1c', borderRadius: 12, padding: 16, gap: 12 },

  // Bar chart
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { width: 90, fontSize: 13, color: '#ccc' },
  barLabelLow: { color: '#FF3B30' },
  barTrack: { flex: 1, height: 8, backgroundColor: '#1a1a2e', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#aaa', borderRadius: 4 },
  barFillLow: { backgroundColor: '#FF3B30' },
  barCount: { width: 28, fontSize: 13, color: '#555', textAlign: 'right' },
  barCountLow: { color: '#FF3B30', fontWeight: '600' },
  mevLabel: { width: 42, fontSize: 10, color: '#444', textAlign: 'right' },
  mevNote: { fontSize: 10, color: '#444', marginTop: 4 },

  // Week bars
  weekRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: 120 },
  weekCol: { alignItems: 'center', gap: 4, flex: 1 },
  weekBarTrack: { width: 28, height: 60, backgroundColor: '#1a1a2e', borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end' },
  weekBarFill: { width: '100%', backgroundColor: '#aaa', borderRadius: 4 },
  weekCount: { fontSize: 14, fontWeight: '600', color: '#ccc' },
  weekLabel: { fontSize: 10, color: '#555', textAlign: 'center' },

  // Coach
  coachBtn: { marginTop: 32, paddingVertical: 16, borderWidth: 1, borderColor: '#2a2a40', borderRadius: 8, alignItems: 'center' },
  coachBtnText: { fontSize: 13, fontWeight: '600', letterSpacing: 3, color: '#ccc', textTransform: 'uppercase' },

  // PRs
  prRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#1a1a2e' },
  prName: { fontSize: 14, color: '#ccc', fontWeight: '500' },
  prDate: { fontSize: 11, color: '#444', marginTop: 2 },
  prWeight: { fontSize: 18, fontWeight: '700', color: '#fff' },

  // Section headers (collapsible)
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 8, paddingVertical: 4 },
  sectionChevron: { fontSize: 18, color: '#444' },

  // Badge grid
  badgeFamilyLabel: { fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badgeItem: { width: 95, backgroundColor: '#0e0e1c', borderRadius: 10, borderWidth: 1, borderColor: '#1e1e30', padding: 10, alignItems: 'center', gap: 6 },
  badgeItemLocked: { borderColor: '#111', backgroundColor: '#0a0a14' },
  badgeIcon: { fontSize: 32, lineHeight: 40 },
  badgeIconLocked: { opacity: 0.2 },
  badgeName: { fontSize: 10, color: '#ccc', textAlign: 'center', lineHeight: 13, fontWeight: '600', letterSpacing: 0.3 },
  badgeNameLocked: { color: '#333' },
});

// ─── Badge Modal Styles ───────────────────────────────────────────────────────

const bm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 40 },
  card: { backgroundColor: '#0e0e1c', borderWidth: 1, borderColor: '#2a2a40', borderRadius: 16, padding: 32, alignItems: 'center', gap: 12, width: '100%' },
  icon:   { fontSize: 80, lineHeight: 96 },
  name:   { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: 1, textAlign: 'center' },
  flavour:{ fontSize: 14, color: '#777', textAlign: 'center', lineHeight: 22, fontStyle: 'italic' },
  date:   { fontSize: 11, color: '#555', marginTop: 4 },
  locked: { fontSize: 11, color: '#333', marginTop: 4, letterSpacing: 1, textTransform: 'uppercase' },
});
