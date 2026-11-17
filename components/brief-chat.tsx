import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ink } from '@/constants/theme';
import type { ChatMessage } from '../types';

const QUICK = ['Why these loads?', 'What if I push harder?', 'What do I fix first?'];

type Props = {
  messages: ChatMessage[];
  asking: boolean;
  failed: boolean;
  onAsk: (question: string) => void;
};

/** Follow-up questions about the brief. A failed question stays in the thread so it can be sent again. */
export function BriefChat({ messages, asking, failed, onAsk }: Props) {
  const [text, setText] = useState('');
  const send = (q: string) => {
    const question = q.trim();
    if (!question || asking) return;
    setText('');
    onAsk(question);
  };

  return (
    <View style={s.wrap}>
      <Text style={s.title}>ASK THE COACH</Text>

      {messages.map((m, i) => (
        <View key={i} style={[s.bubble, m.role === 'athlete' ? s.me : s.coach]}>
          <Text style={s.who}>{m.role === 'athlete' ? 'You' : 'Coach'}</Text>
          <Text style={s.msg}>{m.text}</Text>
        </View>
      ))}

      {asking && <View style={s.row}><ActivityIndicator color={Ink.textDim} /><Text style={s.dim}>Thinking…</Text></View>}
      {failed && !asking && (
        <View>
          <Text style={s.dim}>No answer. Check your connection.</Text>
          <TouchableOpacity style={s.retry} onPress={() => send(messages[messages.length - 1]?.text ?? '')}>
            <Text style={s.retryText}>Send again</Text>
          </TouchableOpacity>
        </View>
      )}

      {messages.length === 0 && (
        <View style={s.chips}>
          {QUICK.map(q => (
            <TouchableOpacity key={q} style={s.chip} onPress={() => send(q)}>
              <Text style={s.chipText}>{q}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={s.inputRow}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder="Ask about this session…"
          placeholderTextColor={Ink.textFaint}
          returnKeyType="send"
          onSubmitEditing={() => send(text)}
          editable={!asking}
          multiline={false}
        />
        <TouchableOpacity style={[s.send, (!text.trim() || asking) && { opacity: 0.4 }]} onPress={() => send(text)} disabled={!text.trim() || asking} accessibilityLabel="Send">
          <Text style={s.sendText}>↑</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 16, backgroundColor: Ink.raised, borderRadius: 16, padding: 16 },
  title: { fontFamily: 'Unbounded_700Bold', fontSize: 13, color: Ink.text, letterSpacing: 0.5, marginBottom: 10 },
  bubble: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Ink.line },
  me: {},
  coach: {},
  who: { fontFamily: 'Unbounded_500Medium', fontSize: 10, color: Ink.textDim, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 },
  msg: { fontSize: 14, color: Ink.text, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  dim: { fontSize: 14, color: Ink.textDim, marginTop: 10 },
  retry: { marginTop: 8, alignSelf: 'flex-start', borderWidth: 1, borderColor: Ink.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 18 },
  retryText: { fontSize: 14, color: Ink.text, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: Ink.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  chipText: { fontSize: 13, color: Ink.text },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  input: { flex: 1, height: 48, backgroundColor: Ink.bg, borderWidth: 1, borderColor: Ink.line, borderRadius: 24, paddingHorizontal: 16, fontSize: 15, color: Ink.text },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: Ink.text, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 20, fontWeight: '800', color: Ink.bg },
});
