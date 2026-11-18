import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ink } from '@/constants/theme';
import { rpeBias, useCoachLog } from '@/lib/coach-log';
import { FAILURE_TEXT, callGeminiResult, hasGeminiKey, useGeminiStatus, usingOverrideKey } from '@/lib/gemini';
import { saveKeyOverride } from '@/lib/gemini-key';
import { addCoachNotes, removeCoachNote, useCoachProfile } from '@/lib/coach-profile';

/** Which build this is, and whether Gemini is reachable. Opened by long-pressing the Week heading. */
export const BUILD_ID = process.env.EXPO_PUBLIC_BUILD_ID ?? 'dev (not a published build)';

const stillPaused = (until: number) => until > Date.now();
const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

export function Diagnostics({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { last, models, blockedUntil } = useGeminiStatus();
  const [newKey, setNewKey] = useState('');
  const [newNote, setNewNote] = useState('');
  const remembered = useCoachProfile(s => s.notes);
  const nudges = useCoachLog(s => s.nudges);
  const [testing, setTesting] = useState(false);
  const bias = rpeBias(nudges);
  const accepted = nudges.filter(n => n.outcome === 'accepted').length;

  function addNote() {
    addCoachNotes([newNote]);
    setNewNote('');
  }

  async function saveKey() {
    await saveKeyOverride(newKey);
    setNewKey('');
  }

  async function test() {
    setTesting(true);
    await callGeminiResult('Reply {"ok": true}', { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] });
    setTesting(false);
  }

  const row = (label: string, value: string) => (
    <View style={s.row}><Text style={s.label}>{label}</Text><Text style={s.value}>{value}</Text></View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={s.wrap}>
        <View style={s.head}>
          <Text style={s.title}>DIAGNOSTICS</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}><Text style={s.close}>Close</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          {row('Build', BUILD_ID)}
          {row('Gemini key', !hasGeminiKey() ? 'NONE' : usingOverrideKey() ? 'pasted on this phone' : 'from this build')}
          {stillPaused(blockedUntil) ? row('Gemini paused', `until ${new Date(blockedUntil).toLocaleTimeString()}, features use their built-in fallbacks`) : null}
          {row('Models to try', models.length ? models.join(', ') : 'not looked up yet')}
          {row('Last Gemini call', !last ? 'none yet' : last.ok ? `ok via ${last.model}, ${ago(last.at)}` : `failed: ${last.failure ? FAILURE_TEXT[last.failure] : '?'}${last.http ? ` (HTTP ${last.http})` : ''}, ${ago(last.at)}`)}
          {row('RPE nudges answered', `${nudges.length} (${accepted} accepted)`)}
          {row('RPE calibration', bias ? `${bias.bias > 0 ? '+' : ''}${bias.bias} from ${bias.samples} accepted` : 'not enough accepted nudges yet')}
          <Text style={[s.label, { marginTop: 28 }]}>What the coach remembers about you</Text>
          {remembered.length === 0 && <Text style={s.hint}>Nothing yet. When you explain why you train a certain way, the coach saves it here.</Text>}
          {remembered.map(n => (
            <View key={n.text} style={s.noteRow}>
              <Text style={s.noteText}>{n.text}</Text>
              <TouchableOpacity onPress={() => removeCoachNote(n.text)} hitSlop={12} accessibilityLabel="Forget this"><Text style={s.noteX}>×</Text></TouchableOpacity>
            </View>
          ))}
          <TextInput style={s.keyInput} value={newNote} onChangeText={setNewNote} placeholder="Tell the coach something, e.g. I train legs twice a week on purpose" placeholderTextColor={Ink.textFaint} onSubmitEditing={addNote} returnKeyType="done" />
          {!!newNote.trim() && (
            <TouchableOpacity style={s.btn} onPress={addNote}><Text style={s.btnText}>Add</Text></TouchableOpacity>
          )}

          <Text style={[s.label, { marginTop: 28 }]}>Use a different Gemini key</Text>
          <TextInput style={s.keyInput} value={newKey} onChangeText={setNewKey} placeholder="Paste a key, or leave empty to go back to the build's key" placeholderTextColor={Ink.textFaint} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <TouchableOpacity style={s.btn} onPress={saveKey}>
            <Text style={s.btnText}>{newKey.trim() ? 'Save key' : 'Use the build\'s key'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btn} onPress={test} disabled={testing}>
            <Text style={s.btnText}>{testing ? 'Testing…' : 'Test Gemini now'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: Ink.bg },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: Ink.line },
  title: { fontFamily: 'Unbounded_700Bold', fontSize: 14, color: Ink.text },
  close: { fontSize: 15, color: Ink.text, fontWeight: '600' },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Ink.line },
  label: { fontSize: 12, color: Ink.textDim, textTransform: 'uppercase', letterSpacing: 0.6 },
  value: { fontSize: 15, color: Ink.text, marginTop: 4 },
  hint: { fontSize: 13, color: Ink.textFaint, marginTop: 8, lineHeight: 18 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Ink.line },
  noteText: { flex: 1, fontSize: 14, color: Ink.text, lineHeight: 20 },
  noteX: { fontSize: 22, color: Ink.textDim },
  keyInput: { marginTop: 8, height: 52, backgroundColor: Ink.raised, borderWidth: 1, borderColor: Ink.line, borderRadius: 14, paddingHorizontal: 14, fontSize: 14, color: Ink.text },
  btn: { marginTop: 14, minHeight: 52, borderRadius: 26, borderWidth: 1, borderColor: Ink.text, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 15, color: Ink.text, fontWeight: '600' },
});
