import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Ink } from '@/constants/theme';
import { POSTER_COLORS, POSTER_NAMES, SPLIT } from '../constants/programs';

// List-sized versions of DAY_TEXT_STYLES: same weight, slant and tracking per act, scaled to fit a row.
const NAME_STYLES: Record<number, object> = {
  1: { fontSize: 30, fontWeight: '900', letterSpacing: -2 },
  2: { fontSize: 26, fontWeight: '800', fontStyle: 'italic', letterSpacing: -0.5 },
  3: { fontSize: 22, fontWeight: '300', fontStyle: 'italic', letterSpacing: 4 },
  4: { fontSize: 14, fontWeight: '600', letterSpacing: 5 },
  5: { fontSize: 28, fontWeight: '100', letterSpacing: 1.5 },
};

type Props = {
  day: number;
  done: boolean;
  isRest: boolean;
  last: boolean;
  onSelect: () => void;
  onRest: () => void;
};

export function ActRow({ day, done, isRest, last, onSelect, onRest }: Props) {
  const color = POSTER_COLORS[day];
  return (
    <View style={[s.row, !last && s.divider]}>
      <TouchableOpacity
        style={s.main}
        onPress={onSelect}
        disabled={done}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={`${POSTER_NAMES[day]}, ${SPLIT[day]}`}>
        <View style={[s.bar, { backgroundColor: color, opacity: done ? 0.25 : 1 }]} />
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[NAME_STYLES[day], { color: done ? Ink.textFaint : color, textTransform: 'uppercase' }]}>
            {POSTER_NAMES[day]}
          </Text>
          {SPLIT[day].toLowerCase() !== POSTER_NAMES[day].toLowerCase() && <Text style={s.split}>{SPLIT[day]}</Text>}
        </View>
      </TouchableOpacity>
      {done ? (
        <Text style={s.status}>{isRest ? 'Rest day' : 'Done ✓'}</Text>
      ) : (
        <TouchableOpacity style={s.restBtn} onPress={onRest} accessibilityRole="button">
          <Text style={s.restText}>Rest</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: Ink.line },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  split: { fontSize: 13, color: Ink.textFaint, marginTop: 3 },
  status: { fontSize: 13, color: Ink.textFaint },
  restBtn: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderColor: Ink.line, borderRadius: 18 },
  restText: { fontSize: 13, fontWeight: '600', color: Ink.textDim },
});
