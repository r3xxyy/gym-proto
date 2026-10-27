import { Ink } from '@/constants/theme';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useFocusEffect } from 'expo-router';
import { Alert, Modal, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { HistoryEntry, UnlockedBadge } from '../../types';
import { ALL_BADGES } from '../../constants/badges';
import type { BadgeDefinition } from '../../constants/badges';
import { PROGRAM_EPOCH, getCurrentProgramWeek, getCurrentWeekBounds } from '../../constants/programs';
import { TrendChart } from '@/components/trend-chart';
import { parseDateLocal } from '@/lib/format';
import { countedSets, exerciseSeries, personalRecords } from '@/lib/progress';
import type { PersonalRecord } from '@/lib/progress';
import { sessionVolume } from '@/lib/session-stats';
import { formatWeekForCoach } from '@/lib/coach-text';
import { deloadHint } from '@/lib/deload';
import { BADGES_PATH, DELOAD_PATH, EPOCH_PATH, HISTORY_PATH } from '@/lib/storage';

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

function computeStats(history: HistoryEntry[], epoch = PROGRAM_EPOCH) {
  const weekMuscleSets: Record<string, number> = {};   // current week
  const fourWeekMuscleSets: Record<string, number> = {}; // rolling 4-week total

  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const { start: weekStart, end: weekEnd } = getCurrentWeekBounds(epoch);
  const fourWeekStart = weekStart - 3 * weekMs; // start of 4 weeks ago

  for (const entry of history) {
    const ts = parseDateLocal(entry.date);
    const isThisWeek  = ts >= weekStart    && ts < weekEnd;
    const isLast4Wks  = ts >= fourWeekStart && ts < weekEnd;

    for (const ex of entry.exercises) {
      const groups = getMuscleGroups(ex.muscles);
      const setCount = countedSets(ex).length;

      groups.forEach(g => {
        if (isThisWeek) weekMuscleSets[g]     = (weekMuscleSets[g]     ?? 0) + setCount;
        if (isLast4Wks) fourWeekMuscleSets[g] = (fourWeekMuscleSets[g] ?? 0) + setCount;
      });
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

  const currentWeek = getCurrentProgramWeek(epoch);
  const weeks = [0, 1, 2, 3].map(weeksAgo => {
    const weekNum = currentWeek - weeksAgo;
    if (weekNum < 1) return { sessions: 0, volume: 0 };
    const start = epoch + (weekNum - 1) * weekMs;
    const end = start + weekMs;
    const inWeek = history.filter(entry => {
      const d = parseDateLocal(entry.date);
      return d > 0 && d >= start && d < end && !entry.isRestDay && entry.workoutName !== 'Rest Day';
    });
    return { sessions: inWeek.length, volume: inWeek.reduce((t, e) => t + sessionVolume(e.exercises), 0) };
  });

  return { muscleVolume, weekMuscleSets, fourWeekAvgSets, weeks };
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const shortDay = (date: string) => { const m = date.match(/(\d{1,2})\s+([A-Za-z]{3})/); return m ? `${m[1]} ${m[2]}` : date; };
const kg = (n: number) => n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();

// ─── Collapsible Section Header ───────────────────────────────────────────────

function SectionHeader({ title, collapsed, onToggle }: { title: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity style={s.sectionHeader} onPress={onToggle} activeOpacity={0.7} accessibilityRole="button" accessibilityState={{ expanded: !collapsed }}>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.sectionChevron}>{collapsed ? '+' : '−'}</Text>
    </TouchableOpacity>
  );
}

// ─── Badge Detail Modal ───────────────────────────────────────────────────────

function BadgeModal({ badge, unlockedAt, onClose }: { badge: BadgeDefinition; unlockedAt?: string; onClose: () => void }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={bm.backdrop} activeOpacity={1} onPress={onClose}>
        <View style={bm.card}>
          <Text style={[bm.icon, !unlockedAt && { opacity: 0.35 }]}>{badge.icon}</Text>
          <Text style={bm.name}>{badge.name}</Text>
          <Text style={bm.flavour}>{badge.flavour}</Text>
          <Text style={bm.date}>{unlockedAt ? `Unlocked ${unlockedAt}` : 'Not yet earned'}</Text>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Exercise trend sheet ─────────────────────────────────────────────────────

function TrendSheet({ record, history, onClose }: { record: PersonalRecord; history: HistoryEntry[]; onClose: () => void }) {
  const [metric, setMetric] = useState<'e1rm' | 'volume'>('e1rm');
  const ref = useRef<BottomSheetModal>(null);
  useEffect(() => { ref.current?.present(); }, []);
  const backdrop = useCallback((props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
  ), []);
  const series = exerciseSeries(history, record.name).slice(-12);
  const points = series.map(p => ({ label: shortDay(p.date), value: metric === 'e1rm' ? p.e1rm : p.volume }));
  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backdropComponent={backdrop}
      backgroundStyle={{ backgroundColor: Ink.raised }}
      handleIndicatorStyle={{ backgroundColor: Ink.line }}
      onDismiss={onClose}>
      <BottomSheetView style={ts.sheet}>
        <Text style={ts.title}>{record.name}</Text>
        <Text style={ts.sub}>Best set {record.weight} × {record.reps}  ·  {shortDay(record.date)}</Text>
        <View style={ts.chips}>
          {([['e1rm', 'Est. 1RM'], ['volume', 'Volume']] as const).map(([key, label]) => (
            <TouchableOpacity key={key} style={[ts.chip, metric === key && ts.chipOn]} onPress={() => setMetric(key)}>
              <Text style={[ts.chipText, metric === key && ts.chipTextOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TrendChart points={points} unit="kg" />
        {series.length < 2 && <Text style={ts.hint}>Log this exercise twice to see a trend.</Text>}
        <TouchableOpacity style={ts.close} onPress={() => ref.current?.dismiss()}>
          <Text style={ts.closeText}>Close</Text>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function ProgressView({ history, unlockedBadges, programEpoch, onEditEpoch, deloadDismissedWeek, onDismissDeload }: {
  history: HistoryEntry[];
  unlockedBadges: UnlockedBadge[];
  programEpoch: number;
  onEditEpoch?: (epoch: number) => void;
  /** Program week in which the lighter-week hint was dismissed. */
  deloadDismissedWeek?: number;
  onDismissDeload?: (week: number) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedBadge, setSelectedBadge] = useState<BadgeDefinition | null>(null);
  const [trendFor, setTrendFor] = useState<PersonalRecord | null>(null);
  const [showAllPrs, setShowAllPrs] = useState(false);

  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  function promptEpochEdit() {
    const current = new Date(programEpoch);
    const formatted = `${current.getDate()} ${MONTHS[current.getMonth()]} ${current.getFullYear()}`;
    Alert.prompt(
      'Program Start Date',
      'Enter the first Monday of your current training block (e.g. 29 Jun 2026)',
      (val) => {
        if (!val?.trim()) return;
        const m = val.trim().match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
        if (!m) { Alert.alert('Invalid date', 'Use format: 29 Jun 2026'); return; }
        const month = MONTHS.indexOf(m[2][0].toUpperCase() + m[2].slice(1).toLowerCase());
        if (month < 0) { Alert.alert('Invalid month'); return; }
        onEditEpoch?.(new Date(parseInt(m[3]), month, parseInt(m[1])).getTime());
      },
      'plain-text',
      formatted,
    );
  }

  if (history.length === 0) {
    return (
      <View style={[s.root, s.empty]}>
        <Text style={s.emptyTitle}>Nothing here yet</Text>
        <Text style={s.emptyText}>Finish a workout and your progress shows up here.</Text>
      </View>
    );
  }

  const { muscleVolume, weekMuscleSets, fourWeekAvgSets, weeks } = computeStats(history, programEpoch);
  const maxSessions = Math.max(...weeks.map(w => w.sessions), 1);
  const currentWeek = getCurrentProgramWeek(programEpoch);
  const weekLabels = [0, 1, 2, 3].map(i => `Wk ${currentWeek - i}`);
  const { start: weekStart, end: weekEnd } = getCurrentWeekBounds(programEpoch);
  const weekEntries = history.filter(entry => {
    const d = parseDateLocal(entry.date);
    return d >= weekStart && d < weekEnd;
  });

  const hint = deloadDismissedWeek === currentWeek ? null : deloadHint(history, programEpoch, currentWeek);
  const prs = personalRecords(history);
  const shownPrs = showAllPrs ? prs : prs.slice(0, 8);
  const unlockedMap = new Map(unlockedBadges.map(b => [b.id, b.unlockedAt]));

  const badgeFamilies: { key: string; label: string; badges: BadgeDefinition[] }[] = [
    { key: 'streak',   label: 'Streaks',             badges: ALL_BADGES.filter(b => b.family === 'streak')   },
    { key: 'session',  label: 'Sessions',            badges: ALL_BADGES.filter(b => b.family === 'session')  },
    { key: 'overload', label: 'Progressive overload', badges: ALL_BADGES.filter(b => b.family === 'overload') },
    { key: 'holiday',  label: 'Holidays',            badges: ALL_BADGES.filter(b => b.family === 'holiday')  },
  ];

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <View style={s.titleRow}>
        <Text style={s.screenTitle}>Progress</Text>
        <TouchableOpacity style={s.weekPill} onPress={promptEpochEdit} hitSlop={8} accessibilityLabel="Edit program start date">
          <Text style={s.weekPillText}>Week {currentWeek}  ✎</Text>
        </TouchableOpacity>
      </View>

      {hint && (
        <View style={s.hintCard}>
          <Text style={s.hintText}>{hint}</Text>
          <TouchableOpacity onPress={() => onDismissDeload?.(currentWeek)} hitSlop={8}>
            <Text style={s.hintDismiss}>Dismiss for this week</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Muscle Volume ── */}
      <SectionHeader title="Sets per week" collapsed={!!collapsed['muscle']} onToggle={() => toggle('muscle')} />
      {!collapsed['muscle'] && (
        <View style={s.card}>
          {muscleVolume.map(({ group }) => {
            const weekly = weekMuscleSets[group] ?? 0;
            const avg = fourWeekAvgSets[group] ?? 0;
            const range = MEV_MRV[group];
            let status: 'low' | 'ok' | 'high' = 'ok';
            if (range) {
              if (avg < range.mev) status = 'low';
              else if (avg > range.mrv) status = 'high';
            }
            const scale = Math.max(range?.mrv ?? 0, avg, 1);
            return (
              <View key={group} style={s.muscleRow}>
                <View style={s.muscleTop}>
                  <Text style={s.muscleName}>{group}</Text>
                  <Text style={s.muscleStatus}>{status === 'low' ? 'Below target ▼' : status === 'high' ? 'Above target ▲' : 'On target'}</Text>
                </View>
                <View style={s.barTrack}>
                  {range && (
                    <View style={[s.barBand, { left: `${(range.mev / scale) * 100}%` as any, width: `${((range.mrv - range.mev) / scale) * 100}%` as any }]} />
                  )}
                  <View style={[s.barFill, { width: `${Math.min((avg / scale) * 100, 100)}%` as any }]} />
                </View>
                <Text style={s.muscleSub}>
                  {weekly} this week  ·  {avg.toFixed(1)} avg{range ? `  ·  target ${range.mev}–${range.mrv}` : ''}
                </Text>
              </View>
            );
          })}
          <Text style={s.note}>The bar is your 4-week average. The lighter band is the target range.</Text>
        </View>
      )}

      {/* ── Sessions per week ── */}
      <SectionHeader title="Sessions per week" collapsed={!!collapsed['weeks']} onToggle={() => toggle('weeks')} />
      {!collapsed['weeks'] && (
        <View style={[s.card, s.weekRow]}>
          {weeks.map((w, i) => w.sessions === 0 ? null : (
            <View key={i} style={s.weekCol}>
              <View style={s.weekBarTrack}>
                <View style={[s.weekBarFill, { height: `${(w.sessions / maxSessions) * 100}%` as any }]} />
              </View>
              <Text style={s.weekCount}>{w.sessions}</Text>
              <Text style={s.weekVol}>{kg(w.volume)} kg</Text>
              <Text style={s.weekLabel}>{weekLabels[i]}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── PRs ── */}
      <SectionHeader title="Personal records" collapsed={!!collapsed['prs']} onToggle={() => toggle('prs')} />
      {!collapsed['prs'] && (
        <View style={s.card}>
          {shownPrs.map(pr => (
            <TouchableOpacity key={pr.name} style={s.prRow} onPress={() => setTrendFor(pr)} activeOpacity={0.7}>
              <View style={{ flex: 1 }}>
                <Text style={s.prName}>{pr.name}</Text>
                <Text style={s.prDate}>{pr.weight} × {pr.reps}  ·  {shortDay(pr.date)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.prWeight}>{pr.e1rm} kg</Text>
                <Text style={s.prDate}>est. 1RM</Text>
              </View>
            </TouchableOpacity>
          ))}
          {prs.length > 8 && (
            <TouchableOpacity onPress={() => setShowAllPrs(v => !v)} style={s.moreBtn}>
              <Text style={s.moreText}>{showAllPrs ? 'Show fewer' : `Show all ${prs.length}`}</Text>
            </TouchableOpacity>
          )}
          <Text style={s.note}>Tap an exercise to see how it has trended.</Text>
        </View>
      )}

      {/* ── Badges ── */}
      <SectionHeader title="Badges" collapsed={!!collapsed['badges']} onToggle={() => toggle('badges')} />
      {!collapsed['badges'] && (
        <View style={{ gap: 24 }}>
          {badgeFamilies.map(({ key, label, badges }) => (
            <View key={key}>
              <Text style={s.badgeFamilyLabel}>{label}</Text>
              <View style={s.badgeGrid}>
                {badges.map(badge => {
                  const isUnlocked = unlockedMap.has(badge.id);
                  return (
                    <TouchableOpacity
                      key={badge.id}
                      style={[s.badgeItem, isUnlocked ? s.badgeItemOn : s.badgeItemLocked]}
                      onPress={() => setSelectedBadge(badge)}
                      activeOpacity={0.75}
                    >
                      <Text style={[s.badgeIcon, !isUnlocked && s.badgeIconLocked]}>{badge.icon}</Text>
                      <Text style={[s.badgeName, !isUnlocked && s.badgeNameLocked]} numberOfLines={2}>{badge.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Coach This Week ── */}
      <TouchableOpacity style={s.coachBtn} onPress={() => Share.share({ message: formatWeekForCoach(weekEntries) })}>
        <Text style={s.coachBtnText}>Coach this week</Text>
      </TouchableOpacity>

      {selectedBadge && (
        <BadgeModal badge={selectedBadge} unlockedAt={unlockedMap.get(selectedBadge.id)} onClose={() => setSelectedBadge(null)} />
      )}
      {trendFor && <TrendSheet record={trendFor} history={history} onClose={() => setTrendFor(null)} />}
    </ScrollView>
  );
}

export default function StatsScreen() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [unlockedBadges, setUnlockedBadges] = useState<UnlockedBadge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [programEpoch, setProgramEpoch] = useState(PROGRAM_EPOCH);
  const [deloadDismissedWeek, setDeloadDismissedWeek] = useState<number | undefined>(undefined);

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
          const parsed = JSON.parse(raw);
          setHistory(parsed.filter((e: HistoryEntry) => !e.id.startsWith('seed-')));
        }
        const badgesInfo = await FileSystem.getInfoAsync(BADGES_PATH);
        if (badgesInfo.exists) {
          const raw = await FileSystem.readAsStringAsync(BADGES_PATH);
          setUnlockedBadges(JSON.parse(raw));
        }
        const deloadInfo = await FileSystem.getInfoAsync(DELOAD_PATH);
        if (deloadInfo.exists) {
          const week = JSON.parse(await FileSystem.readAsStringAsync(DELOAD_PATH));
          if (typeof week === 'number') setDeloadDismissedWeek(week);
        }
        setLoaded(true);
      })();
    }, [])
  );

  if (!loaded) return <View style={s.root} />;

  return (
    <ProgressView
      history={history}
      unlockedBadges={unlockedBadges}
      programEpoch={programEpoch}
      deloadDismissedWeek={deloadDismissedWeek}
      onDismissDeload={(week) => {
        setDeloadDismissedWeek(week);
        FileSystem.writeAsStringAsync(DELOAD_PATH, JSON.stringify(week)).catch(() => {});
      }}
      onEditEpoch={(epoch) => {
        setProgramEpoch(epoch);
        FileSystem.writeAsStringAsync(EPOCH_PATH, JSON.stringify(epoch)).catch(() => {});
      }}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Ink.bg },
  content: { padding: 20, paddingTop: 64, paddingBottom: 48 },
  empty: { justifyContent: 'center', alignItems: 'center', padding: 40, gap: 8 },
  emptyTitle: { fontFamily: 'Unbounded_700Bold', fontSize: 20, color: Ink.text, textAlign: 'center' },
  emptyText: { fontSize: 15, color: Ink.textDim, textAlign: 'center' },
  hintCard: { marginTop: 20, borderWidth: 1, borderColor: Ink.textFaint, borderRadius: 14, padding: 16, gap: 10 },
  hintText: { fontSize: 15, lineHeight: 21, color: Ink.text },
  hintDismiss: { fontSize: 14, color: Ink.textDim },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  screenTitle: { fontFamily: 'Unbounded_700Bold', fontSize: 30, color: Ink.text },
  weekPill: { borderWidth: 1, borderColor: Ink.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  weekPillText: { fontSize: 13, color: Ink.textDim },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, marginBottom: 10, paddingVertical: 4 },
  sectionTitle: { fontFamily: 'Unbounded_500Medium', fontSize: 15, color: Ink.text },
  sectionChevron: { fontSize: 22, color: Ink.textDim, width: 24, textAlign: 'center' },
  card: { backgroundColor: Ink.raised, borderRadius: 14, padding: 16, gap: 16 },
  note: { fontSize: 13, color: Ink.textFaint },

  // Muscle volume
  muscleRow: { gap: 6 },
  muscleTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  muscleName: { fontSize: 15, fontWeight: '600', color: Ink.text },
  muscleStatus: { fontSize: 13, color: Ink.textDim },
  barTrack: { height: 10, backgroundColor: Ink.bg, borderRadius: 5, overflow: 'hidden' },
  barBand: { position: 'absolute', top: 0, bottom: 0, backgroundColor: Ink.line },
  barFill: { height: '100%', backgroundColor: Ink.text, borderRadius: 5 },
  muscleSub: { fontSize: 13, color: Ink.textFaint, fontVariant: ['tabular-nums'] },

  // Week bars
  weekRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', gap: 0 },
  weekCol: { alignItems: 'center', gap: 4, flex: 1 },
  weekBarTrack: { width: 32, height: 72, backgroundColor: Ink.bg, borderRadius: 8, overflow: 'hidden', justifyContent: 'flex-end' },
  weekBarFill: { width: '100%', backgroundColor: Ink.text, borderRadius: 8 },
  weekCount: { fontFamily: 'Unbounded_700Bold', fontSize: 16, color: Ink.text },
  weekVol: { fontSize: 12, color: Ink.textDim, fontVariant: ['tabular-nums'] },
  weekLabel: { fontSize: 12, color: Ink.textFaint, textAlign: 'center' },

  // PRs
  prRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  prName: { fontSize: 15, color: Ink.text, fontWeight: '600' },
  prDate: { fontSize: 13, color: Ink.textFaint, marginTop: 2 },
  prWeight: { fontFamily: 'Unbounded_700Bold', fontSize: 17, color: Ink.text },
  moreBtn: { alignSelf: 'flex-start', paddingVertical: 6 },
  moreText: { fontSize: 14, color: Ink.textDim },

  // Coach
  coachBtn: { marginTop: 32, minHeight: 52, justifyContent: 'center', borderWidth: 1, borderColor: Ink.text, borderRadius: 999, alignItems: 'center' },
  coachBtnText: { fontSize: 15, fontWeight: '600', color: Ink.text },

  // Badge grid
  badgeFamilyLabel: { fontSize: 14, color: Ink.textDim, marginBottom: 10 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badgeItem: { width: 100, borderRadius: 14, borderWidth: 1, padding: 10, alignItems: 'center', gap: 6 },
  badgeItemOn: { backgroundColor: Ink.raised, borderColor: Ink.text },
  badgeItemLocked: { backgroundColor: 'transparent', borderColor: Ink.line },
  badgeIcon: { fontSize: 32, lineHeight: 40 },
  badgeIconLocked: { opacity: 0.25 },
  badgeName: { fontSize: 12, color: Ink.text, textAlign: 'center', lineHeight: 15, fontWeight: '600' },
  badgeNameLocked: { color: Ink.textFaint },
});

// ─── Badge Modal Styles ───────────────────────────────────────────────────────

const bm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  card: { backgroundColor: Ink.raised, borderWidth: 1, borderColor: Ink.line, borderRadius: 20, padding: 32, alignItems: 'center', gap: 12, width: '100%' },
  icon:   { fontSize: 80, lineHeight: 96 },
  name:   { fontFamily: 'Unbounded_700Bold', fontSize: 20, color: Ink.text, textAlign: 'center' },
  flavour:{ fontSize: 15, color: Ink.textDim, textAlign: 'center', lineHeight: 22 },
  date:   { fontSize: 13, color: Ink.textFaint, marginTop: 4 },
});

// ─── Trend sheet styles ───────────────────────────────────────────────────────

const ts = StyleSheet.create({
  sheet: { padding: 24, paddingTop: 8, paddingBottom: 36 },
  title: { fontFamily: 'Unbounded_700Bold', fontSize: 18, color: Ink.text },
  sub: { fontSize: 14, color: Ink.textDim, marginTop: 4, marginBottom: 16 },
  chips: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  chip: { minHeight: 36, paddingHorizontal: 16, justifyContent: 'center', borderWidth: 1, borderColor: Ink.line, borderRadius: 18 },
  chipOn: { backgroundColor: Ink.text, borderColor: Ink.text },
  chipText: { fontSize: 14, fontWeight: '600', color: Ink.textDim },
  chipTextOn: { color: Ink.bg },
  hint: { fontSize: 14, color: Ink.textFaint, marginTop: 12 },
  close: { marginTop: 20, minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: Ink.line, borderRadius: 24, alignItems: 'center' },
  closeText: { fontSize: 15, fontWeight: '600', color: Ink.textDim },
});
