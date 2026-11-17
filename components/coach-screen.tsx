import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ink } from '@/constants/theme';
import { BriefChat } from './brief-chat';
import type { ChatMessage } from '../types';

type Props = {
  title: string;
  onBack: () => void;
  /** The card for what the coach wrote; the chat appears under it once `ready`. */
  children: ReactNode;
  ready: boolean;
  chat: ChatMessage[];
  asking: boolean;
  askFailed: boolean;
  onAsk: (question: string) => void;
  /** The old paste-into-another-chat route, kept as a fallback. */
  onShare: () => void;
};

/** In-app coaching for a past session, this week or an upcoming session: what the coach wrote, then follow-up questions. */
export function CoachScreen({ title, onBack, children, ready, chat, asking, askFailed, onAsk, onShare }: Props) {
  return (
    <View style={{ flex: 1, backgroundColor: Ink.bg }}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} hitSlop={12} accessibilityLabel="Back"><Text style={s.back}>‹</Text></TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
        {children}
        {ready && <BriefChat messages={chat} asking={asking} failed={askFailed} onAsk={onAsk} />}
        <TouchableOpacity style={s.share} onPress={onShare}><Text style={s.shareText}>Share as text</Text></TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Ink.line, flexDirection: 'row', alignItems: 'center', gap: 16 },
  back: { fontSize: 32, color: Ink.text, lineHeight: 34 },
  title: { flex: 1, fontFamily: 'Unbounded_700Bold', fontSize: 15, color: Ink.text },
  list: { padding: 16, paddingBottom: 40 },
  share: { marginTop: 16, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: Ink.line, alignItems: 'center', justifyContent: 'center' },
  shareText: { fontSize: 14, color: Ink.textDim, fontWeight: '600' },
});
