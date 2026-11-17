import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ink } from '@/constants/theme';
import type { SessionBrief } from '../types';

type Props = {
  title: string;
  status: 'loading' | 'ready' | 'failed';
  brief?: SessionBrief;
  onRetry: () => void;
};

const targetLine = (t: SessionBrief['targets'][number]) =>
  `${t.weightKg !== null ? `${t.weightKg} kg × ` : ''}${t.reps} × ${t.sets}${t.rpeCap !== null ? `  ·  RPE ≤${t.rpeCap}` : ''}`;

/** The coach's read of the session, in the same sections as a pasted analysis: performance, next targets, flags. */
export function BriefCard({ title, status, brief, onRetry }: Props) {
  return (
    <View style={s.card}>
      <Text style={s.title}>{title}</Text>

      {status === 'loading' && (
        <View style={s.loading}>
          <ActivityIndicator color={Ink.textDim} />
          <Text style={s.dim}>Reading your session…</Text>
        </View>
      )}

      {status === 'failed' && (
        <View>
          <Text style={s.dim}>Couldn&apos;t reach the coach. Check your connection and try again.</Text>
          <TouchableOpacity style={s.retry} onPress={onRetry}><Text style={s.retryText}>Try again</Text></TouchableOpacity>
        </View>
      )}

      {status === 'ready' && brief && (
        <>
          <Text style={s.section}>Performance</Text>
          {brief.performance.strong.map((l, i) => <Text key={`s${i}`} style={s.line}>+  {l}</Text>)}
          {brief.performance.flagged.map((l, i) => <Text key={`f${i}`} style={s.line}>−  {l}</Text>)}

          {brief.targets.length > 0 && <Text style={s.section}>Next session targets</Text>}
          {brief.targets.map((t, i) => (
            <View key={i} style={s.targetRow}>
              <Text style={s.targetName}>{t.exercise}</Text>
              <Text style={s.targetVal}>{targetLine(t)}</Text>
              {!!t.note && <Text style={s.note}>{t.note}</Text>}
            </View>
          ))}

          <Text style={s.section}>Flags</Text>
          {brief.flags.map((f, i) => (
            <View key={i} style={s.flag}>
              <Text style={s.flagHead}>{f.flag}</Text>
              {!!f.reason && <Text style={s.line}>{f.reason}</Text>}
              {!!f.recommendation && <Text style={s.rec}>→ {f.recommendation}</Text>}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 24, backgroundColor: Ink.raised, borderRadius: 16, padding: 16 },
  title: { fontFamily: 'Unbounded_700Bold', fontSize: 13, color: Ink.text, letterSpacing: 0.5 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  dim: { fontSize: 14, color: Ink.textDim, marginTop: 10 },
  retry: { marginTop: 12, alignSelf: 'flex-start', borderWidth: 1, borderColor: Ink.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 18 },
  retryText: { fontSize: 14, color: Ink.text, fontWeight: '600' },
  section: { fontFamily: 'Unbounded_500Medium', fontSize: 11, color: Ink.textDim, marginTop: 18, marginBottom: 6, letterSpacing: 0.8, textTransform: 'uppercase' },
  line: { fontSize: 14, color: Ink.text, lineHeight: 20, marginBottom: 4 },
  targetRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Ink.line },
  targetName: { fontSize: 14, color: Ink.textDim },
  targetVal: { fontSize: 16, color: Ink.text, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, color: Ink.textFaint, marginTop: 2 },
  flag: { marginBottom: 12 },
  flagHead: { fontSize: 14, color: Ink.text, fontWeight: '700', marginBottom: 2 },
  rec: { fontSize: 14, color: Ink.text, fontWeight: '600', lineHeight: 20 },
});
