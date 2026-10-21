import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Ink, Legible } from '@/constants/theme';
import { POSTER_NAMES, SPLIT, SPLIT_LABEL } from '../constants/programs';


type Props = {
  day: number;
  done: boolean;
  isRest: boolean;
  last?: boolean;
  onSelect: () => void;
  onRest: () => void;
  onUndoRest: () => void;
};

export function ActRow({ day, done, isRest, onSelect, onRest, onUndoRest }: Props) {
  return (
    <View style={s.row}>
      <TouchableOpacity
        style={s.main}
        onPress={onSelect}
        disabled={done}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={`${POSTER_NAMES[day]}, ${SPLIT_LABEL[day]}`}>
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={[s.name, done && { color: Ink.textFaint }]}>
            {POSTER_NAMES[day]}
          </Text>
          {SPLIT_LABEL[day].toLowerCase() !== POSTER_NAMES[day].toLowerCase() && <Text style={s.split}>{SPLIT_LABEL[day]}</Text>}
        </View>
      </TouchableOpacity>
      {done && isRest ? (
        <TouchableOpacity style={s.restBtn} onPress={onUndoRest} accessibilityRole="button" accessibilityLabel={`Undo rest day for ${POSTER_NAMES[day]}`}>
          <Text style={s.restText}>Undo rest</Text>
        </TouchableOpacity>
      ) : done ? (
        <Text style={s.status}>Done ✓</Text>
      ) : (
        <TouchableOpacity style={s.restBtn} onPress={onRest} accessibilityRole="button">
          <Text style={s.restText}>Rest</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  name: { fontFamily: 'Unbounded_700Bold', fontSize: 19, color: Ink.text, textTransform: 'uppercase', ...Legible },
  split: { fontSize: 14, fontWeight: '500', color: Ink.textDim, marginTop: 3, ...Legible },
  status: { fontSize: 14, fontWeight: '500', color: Ink.textDim, ...Legible },
  restBtn: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderColor: Ink.line, borderRadius: 18, backgroundColor: 'rgba(9,9,14,0.8)' },
  restText: { fontSize: 14, fontWeight: '600', color: Ink.text },
});
