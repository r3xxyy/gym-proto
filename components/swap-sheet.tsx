import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Ink } from '@/constants/theme';
import type { Exercise } from '@/types';

type Option = Omit<Exercise, 'sets'>;

/** Gesture-driven sheet for swapping or adding an exercise; the search field rides above the keyboard. */
export function SwapSheet({ open, title, options, onPick, onCustom, onClose }: {
  open: boolean;
  title: string;
  options: Option[];
  onPick: (opt: Option) => void;
  onCustom: (name: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) ref.current?.present();
    else ref.current?.dismiss();
  }, [open]);

  const backdrop = useCallback((props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
  ), []);

  const q = query.trim().toLowerCase();
  const shown = options.filter(o => !q || o.name.toLowerCase().includes(q) || o.muscles.toLowerCase().includes(q));
  const exact = options.some(o => o.name.toLowerCase() === q);

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={['70%']}
      enableDynamicSizing={false}
      backdropComponent={backdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={s.bg}
      handleIndicatorStyle={s.handle}
      onDismiss={() => { setQuery(''); onClose(); }}>
      <BottomSheetScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{title}</Text>
        <BottomSheetTextInput
          style={s.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search or type custom name…"
          placeholderTextColor="#444"
          autoCorrect={false}
        />
        {q !== '' && !exact && (
          <TouchableOpacity style={s.option} onPress={() => onCustom(query.trim())}>
            <Text style={s.optName}>&quot;{query.trim()}&quot;</Text>
            <Text style={s.optMuscles}>custom — tap to use</Text>
          </TouchableOpacity>
        )}
        {shown.map(opt => (
          <TouchableOpacity key={opt.id} style={s.option} onPress={() => onPick(opt)}>
            <Text style={s.optName}>{opt.name}</Text>
            <Text style={s.optMuscles}>{opt.muscles}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={s.close} onPress={onClose}>
          <Text style={s.closeText}>CLOSE</Text>
        </TouchableOpacity>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const s = StyleSheet.create({
  bg: { backgroundColor: Ink.raised },
  handle: { backgroundColor: Ink.line },
  content: { padding: 24, paddingTop: 8, paddingBottom: 48 },
  title: { fontSize: 18, fontWeight: '700', color: Ink.text, marginBottom: 12 },
  search: { backgroundColor: Ink.bg, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, fontSize: 16, color: Ink.text, marginBottom: 12 },
  option: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Ink.line },
  optName: { fontSize: 16, fontWeight: '500', color: Ink.text },
  optMuscles: { fontSize: 12, color: Ink.textFaint, marginTop: 2, textTransform: 'capitalize' },
  close: { marginTop: 16, minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: Ink.line, borderRadius: 12, alignItems: 'center' },
  closeText: { fontSize: 15, fontWeight: '600', color: Ink.textDim },
});
