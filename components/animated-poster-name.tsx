import { useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { POSTER_NAMES } from '../constants/programs';

// ─── Animated Poster Name ─────────────────────────────────────────────────────

export function AnimatedPosterName({ day, isActive, style }: { day: number; isActive: boolean; style: object }) {
  const val = useSharedValue(1);
  const on = useSharedValue(isActive ? 1 : 0);

  useEffect(() => { on.value = isActive ? 1 : 0; }, [isActive]);

  useEffect(() => {
    if (day === 1) {
      // TERRA FIRMA — seismic thud: slam up, recoil, settle
      val.value = withRepeat(withSequence(
        withTiming(1, { duration: 900 }),
        withTiming(1.14, { duration: 110 }),
        withTiming(0.94, { duration: 80 }),
        withTiming(1, { duration: 180 }),
        withTiming(1, { duration: 700 })
      ), -1, false);
    } else if (day === 2) {
      // OVERRIDE — violent machine-gun shake then pause
      val.value = withRepeat(withSequence(
        withTiming(1,  { duration: 40 }), withTiming(-1, { duration: 40 }),
        withTiming(1,  { duration: 40 }), withTiming(-1, { duration: 40 }),
        withTiming(1,  { duration: 40 }), withTiming(-1, { duration: 40 }),
        withTiming(0,  { duration: 40 }),
        withTiming(0,  { duration: 1100 })
      ), -1, false);
    } else if (day === 3) {
      // UNDERTOW — slow rise + fade, like being pulled under
      val.value = withRepeat(withSequence(
        withTiming(1, { duration: 2000 }), withTiming(0, { duration: 2000 })
      ), -1, false);
    } else if (day === 4) {
      // BOULDER SHOULDER — high-voltage strobe burst
      val.value = withRepeat(withSequence(
        withTiming(1, { duration: 30 }), withTiming(0, { duration: 30 }),
        withTiming(1, { duration: 30 }), withTiming(0, { duration: 30 }),
        withTiming(1, { duration: 30 }), withTiming(0, { duration: 30 }),
        withTiming(0, { duration: 700 })
      ), -1, false);
    } else if (day === 5) {
      // AFTERMATH — nearly vanishes, drags itself back
      val.value = withRepeat(withSequence(
        withTiming(1, { duration: 2200 }), withTiming(0.05, { duration: 2800 })
      ), -1, false);
    }
  }, []);

  const animStyle = useAnimatedStyle(() => {
    if (on.value === 0) return {};
    if (day === 1) return { transform: [{ scale: val.value }] };
    if (day === 2) return { transform: [{ translateX: val.value * 18 }] };
    if (day === 3) return { transform: [{ translateY: val.value * -22 }], opacity: 0.3 + val.value * 0.7 };
    if (day === 4) return { opacity: val.value };
    if (day === 5) return { opacity: val.value };
    return {};
  });

  return <Animated.Text style={[style, animStyle]}>{POSTER_NAMES[day]}</Animated.Text>;
}

