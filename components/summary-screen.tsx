import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { Ink } from '@/constants/theme';
import { formatTime } from '@/lib/format';
import { estimateNetKcal, sessionVolume } from '@/lib/session-stats';
import { BriefCard } from './brief-card';
import { BriefChat } from './brief-chat';
import { NUMPAD_DONE_ID } from './exercise-card';
import type { ChatMessage, Exercise, SessionBrief } from '../types';

type Props = {
  exercises: Exercise[];
  /** Lifting time in seconds. */
  finalSeconds: number;
  /** Resting time in seconds. */
  finalRest: number;
  bodyweight: string;
  onBodyweightChange: (value: string) => void;
  onDone: () => void;
  onContinue: () => void;
  /** The coach's read of the session; 'none' hides the card (nothing logged to coach). */
  brief?: SessionBrief;
  briefStatus: 'none' | 'loading' | 'ready' | 'failed';
  briefTitle: string;
  onRetryBrief: () => void;
  feel?: number;
  onFeel: (n: number) => void;
  /** Why the lifter trained this way today; the coach reads it. */
  athleteNote?: string;
  onAthleteNote: (text: string) => void;
  chat: ChatMessage[];
  asking: boolean;
  askFailed: boolean;
  onAsk: (question: string) => void;
};

/** The screen shown after Finish workout: totals, a bodyweight field for the kcal estimate, and next steps. */
export function SummaryScreen(props: Props) {
  // The text box is local until the lifter sends it, so typing doesn't regenerate the brief.
  const [why, setWhy] = useState(props.athleteNote ?? '');
  return <SummaryBody {...props} why={why} setWhy={setWhy} />;
}

function SummaryBody({ exercises, finalSeconds, finalRest, bodyweight, onBodyweightChange, onDone, onContinue, brief, briefStatus, briefTitle, onRetryBrief, feel, onFeel, athleteNote, onAthleteNote, chat, asking, askFailed, onAsk, why, setWhy }: Props & { why: string; setWhy: (v: string) => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: Ink.bg }}>
      <View style={sum2.header}>
        <Text style={sum2.title}>Workout done</Text>
      </View>
      <ScrollView contentContainerStyle={sum2.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
        <View style={sum2.hero}>
          <Text style={sum2.heroLabel}>Total volume</Text>
          <Text style={sum2.heroValue}>{sessionVolume(exercises).toLocaleString()}<Text style={sum2.heroUnit}> kg</Text></Text>
        </View>

        <View style={sum2.grid}>
          <View style={sum2.cell}>
            <Text style={sum2.cellLabel}>Session</Text>
            <Text style={sum2.cellValue}>{formatTime(finalSeconds + finalRest)}</Text>
          </View>
          <View style={sum2.cell}>
            <Text style={sum2.cellLabel}>Lifting</Text>
            <Text style={sum2.cellValue}>{formatTime(finalSeconds)}</Text>
          </View>
          <View style={sum2.cell}>
            <Text style={sum2.cellLabel}>Resting</Text>
            <Text style={sum2.cellValue}>{formatTime(finalRest)}</Text>
          </View>
          <View style={sum2.cell}>
            <Text style={sum2.cellLabel}>Est. net kcal</Text>
            <Text style={sum2.cellValue}>
              {!!bodyweight && !!finalSeconds ? estimateNetKcal(parseFloat(bodyweight), finalSeconds, finalRest) : '—'}
            </Text>
          </View>
        </View>

        {briefStatus !== 'none' && (
          <View style={{ marginTop: 24 }}>
            <Text style={sum2.fieldLabel}>How did it feel? 1 rough · 5 great</Text>
            <View style={fe.row}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity
                  key={n}
                  style={[fe.chip, feel === n && fe.chipOn]}
                  onPress={() => onFeel(n)}
                  accessibilityLabel={`Felt ${n} out of 5`}>
                  <Text style={[fe.chipText, feel === n && fe.chipTextOn]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        {briefStatus === 'none' && <Text style={[sum2.fieldLabel, { marginTop: 20 }]}>No sets were logged this time, so the coach has nothing to read yet. Log a few sets and it will.</Text>}
        {briefStatus !== 'none' && (
          <View style={{ marginTop: 20 }}>
            <Text style={sum2.fieldLabel}>Anything the coach should know? Why you trained this way today</Text>
            <TextInput
              style={[sum2.field, { height: 76, fontFamily: undefined, fontSize: 15, textAlign: 'left', paddingHorizontal: 14, paddingTop: 12 }]}
              value={why}
              onChangeText={setWhy}
              placeholder="e.g. kept the weight the same on purpose, felt a tweak in my elbow, short on time…"
              placeholderTextColor={Ink.textFaint}
              multiline
              textAlignVertical="top"
            />
            {why.trim() !== (athleteNote ?? '') && (
              <TouchableOpacity style={sum2.secondary} onPress={() => onAthleteNote(why)}>
                <Text style={sum2.secondaryText}>Update the coach&apos;s read</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {briefStatus !== 'none' && (
          <BriefCard title={briefTitle} status={briefStatus} brief={brief} onRetry={onRetryBrief} />
        )}
        {briefStatus === 'ready' && brief && (
          <BriefChat messages={chat} asking={asking} failed={askFailed} onAsk={onAsk} />
        )}

        <Text style={[sum2.fieldLabel, { marginTop: 24 }]}>Bodyweight (kg), used for the kcal estimate</Text>
        <TextInput
          style={sum2.field}
          value={bodyweight}
          onChangeText={onBodyweightChange}
          keyboardType="decimal-pad"
          inputAccessoryViewID={NUMPAD_DONE_ID}
          placeholder="e.g. 80"
          placeholderTextColor={Ink.textFaint}
        />

        {exercises.some(ex => ex.startedAt && ex.endedAt) && (
          <>
            <Text style={[sum2.fieldLabel, { marginTop: 24 }]}>Time per exercise</Text>
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
          </>
        )}

        <TouchableOpacity style={sum2.primary} onPress={onDone}>
          <Text style={sum2.primaryText}>Done</Text>
        </TouchableOpacity>
        <TouchableOpacity style={sum2.secondary} onPress={onContinue}>
          <Text style={sum2.secondaryText}>Keep going</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const sum2 = StyleSheet.create({
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Ink.line },
  title: { fontFamily: 'Unbounded_700Bold', fontSize: 20, color: Ink.text },
  list: { padding: 16, paddingBottom: 32 },
  hero: { marginBottom: 20 },
  heroLabel: { fontSize: 14, color: Ink.textDim },
  heroValue: { fontFamily: 'Unbounded_700Bold', fontSize: 48, color: Ink.text, marginTop: 4, fontVariant: ['tabular-nums'] },
  heroUnit: { fontFamily: 'Unbounded_500Medium', fontSize: 18, color: Ink.textDim },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  cell: { width: '48%', flexGrow: 1, backgroundColor: Ink.raised, borderRadius: 14, padding: 16 },
  cellLabel: { fontSize: 13, color: Ink.textDim },
  cellValue: { fontFamily: 'Unbounded_700Bold', fontSize: 20, color: Ink.text, marginTop: 6, fontVariant: ['tabular-nums'] },
  fieldLabel: { fontSize: 14, color: Ink.textDim, marginBottom: 8 },
  field: { height: 52, backgroundColor: Ink.raised, borderWidth: 1, borderColor: Ink.line, borderRadius: 14, fontFamily: 'Unbounded_500Medium', fontSize: 18, textAlign: 'center', color: Ink.text },
  primary: { marginTop: 28, minHeight: 56, borderRadius: 28, backgroundColor: Ink.text, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, fontWeight: '800', color: Ink.bg },
  secondary: { marginTop: 10, minHeight: 52, borderRadius: 26, borderWidth: 1, borderColor: Ink.line, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '600', color: Ink.text },
});

const fe = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: Ink.line, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: Ink.text, borderColor: Ink.text },
  chipText: { fontFamily: 'Unbounded_500Medium', fontSize: 16, color: Ink.text },
  chipTextOn: { color: Ink.bg },
});

const summ = StyleSheet.create({
  exRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Ink.line },
  exName: { fontSize: 14, color: Ink.textDim, flex: 1 },
  exTime: { fontSize: 14, color: Ink.textDim, fontVariant: ['tabular-nums'] },
});

