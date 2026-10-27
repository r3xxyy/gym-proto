import Svg, { Rect } from 'react-native-svg';
import { Ink } from '@/constants/theme';

// Plate colours follow the usual competition scheme; height is proportional to diameter.
const PLATE_LOOK: Record<number, { color: string; h: number; w: number }> = {
  20:   { color: '#2F6BFF', h: 56, w: 12 },
  15:   { color: '#F2C230', h: 50, w: 11 },
  10:   { color: '#2FA84F', h: 42, w: 10 },
  5:    { color: '#E8E8E8', h: 34, w: 8 },
  2.5:  { color: '#D9453D', h: 26, w: 7 },
  1.25: { color: '#B0B5BD', h: 20, w: 6 },
};
const GAP = 2;
const COLLAR = 8;
const SLEEVE = 28;
const HEIGHT = 60;

/** One side of the barbell: the loaded sleeve, heaviest plate nearest the collar. */
export function PlateBar({ plates }: { plates: number[] }) {
  const looks = plates.map(p => PLATE_LOOK[p]).filter(Boolean);
  const width = COLLAR + 6 + looks.reduce((n, l) => n + l.w + GAP, 0) + SLEEVE;
  return (
    <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} preserveAspectRatio="xMinYMid meet">
      <Rect x={0} y={HEIGHT / 2 - 3} width={width} height={6} rx={2} fill={Ink.textFaint} />
      <Rect x={0} y={HEIGHT / 2 - 14} width={COLLAR} height={28} rx={2} fill={Ink.textDim} />
      {looks.map((l, i) => {
        const x = COLLAR + 6 + looks.slice(0, i).reduce((n, p) => n + p.w + GAP, 0);
        return <Rect key={i} x={x} y={(HEIGHT - l.h) / 2} width={l.w} height={l.h} rx={2} fill={l.color} />;
      })}
    </Svg>
  );
}
