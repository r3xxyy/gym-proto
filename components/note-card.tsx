import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ink } from '@/constants/theme';
import type { CoachNote } from '../types';

type Props = { title: string; status: 'loading' | 'ready' | 'failed' | 'none'; note?: CoachNote | null; empty: string; onRetry: () => void };

/** A week review or upcoming-session plan: titled sections of short lines. */
export function NoteCard({ title, status, note, empty, onRetry }: Props) {
  return (
    <View style={s.card}>
      <Text style={s.title}>{title}</Text>
      {status === 'loading' && (
        <View style={s.row}><ActivityIndicator color={Ink.textDim} /><Text style={s.dim}>Reading your training…</Text></View>
      )}
      {status === 'none' && <Text style={s.dim}>{empty}</Text>}
      {status === 'failed' && (
        <View>
          <Text style={s.dim}>Couldn&apos;t reach the coach. Check your connection and try again.</Text>
          <TouchableOpacity style={s.retry} onPress={onRetry}><Text style={s.retryText}>Try again</Text></TouchableOpacity>
        </View>
      )}
      {status === 'ready' && note?.sections.map((sec, i) => (
        <View key={i}>
          <Text style={s.section}>{sec.heading}</Text>
          {sec.lines.map((l, j) => <Text key={j} style={s.line}>{l}</Text>)}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 8, backgroundColor: Ink.raised, borderRadius: 16, padding: 16 },
  title: { fontFamily: 'Unbounded_700Bold', fontSize: 13, color: Ink.text, letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  dim: { fontSize: 14, color: Ink.textDim, marginTop: 10 },
  retry: { marginTop: 12, alignSelf: 'flex-start', borderWidth: 1, borderColor: Ink.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 18 },
  retryText: { fontSize: 14, color: Ink.text, fontWeight: '600' },
  section: { fontFamily: 'Unbounded_500Medium', fontSize: 11, color: Ink.textDim, marginTop: 18, marginBottom: 6, letterSpacing: 0.8, textTransform: 'uppercase' },
  line: { fontSize: 14, color: Ink.text, lineHeight: 20, marginBottom: 6 },
});
