import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { Ink } from '@/constants/theme';

export type TrendPoint = { label: string; value: number };

const HEIGHT = 150;
const PAD = 14;

/** A plain white line chart: gridlines, a line, a dot per session, the latest point filled. */
export function TrendChart({ points, unit }: { points: TrendPoint[]; unit: string }) {
  const [width, setWidth] = useState(0);
  if (points.length === 0) return null;

  const values = points.map(p => p.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || Math.max(hi * 0.1, 1);
  const min = lo - span * 0.15, max = hi + span * 0.15;
  const x = (i: number) => (points.length === 1 ? width / 2 : PAD + (i * (width - 2 * PAD)) / (points.length - 1));
  const y = (v: number) => HEIGHT - PAD - ((v - min) / (max - min)) * (HEIGHT - 2 * PAD);
  const last = points[points.length - 1];

  return (
    <View>
      <View style={s.valueRow}>
        <Text style={s.value}>{last.value.toLocaleString()} <Text style={s.unit}>{unit}</Text></Text>
        <Text style={s.range}>{lo.toLocaleString()}–{hi.toLocaleString()}</Text>
      </View>
      <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ height: HEIGHT }}>
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            {[0.25, 0.5, 0.75].map(f => (
              <Line key={f} x1={PAD} x2={width - PAD} y1={HEIGHT * f} y2={HEIGHT * f} stroke={Ink.line} strokeWidth={1} />
            ))}
            {points.length > 1 && (
              <Polyline
                points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')}
                fill="none" stroke={Ink.text} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
              />
            )}
            {points.map((p, i) => (
              <Circle
                key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 5 : 3.5}
                fill={i === points.length - 1 ? Ink.text : Ink.raised} stroke={Ink.text} strokeWidth={2}
              />
            ))}
          </Svg>
        )}
      </View>
      <View style={s.axis}>
        <Text style={s.axisText}>{points[0].label}</Text>
        {points.length > 1 && <Text style={s.axisText}>{last.label}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  valueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  value: { fontFamily: 'Unbounded_700Bold', fontSize: 28, color: Ink.text },
  unit: { fontFamily: 'Unbounded_500Medium', fontSize: 13, color: Ink.textDim },
  range: { fontSize: 13, color: Ink.textFaint },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { fontSize: 12, color: Ink.textFaint },
});
