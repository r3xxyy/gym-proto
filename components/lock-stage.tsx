import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { CollapsedRow } from '@/components/exercise-card';
import { Ink } from '@/constants/theme';
import { endStage, fadeAllLocks, fireLock, getCard, LOCK_MS, useLockStore } from '@/lib/lock-store';
import type { Stage } from '@/lib/lock-store';

const FLOAT_SCALE = 1.08;
const LIFT_MS = 320;       // the card has reached centre; the chain starts
const SLAM_MS = 260;
const THUD_MS = 170;       // the little squash after it lands, before the clone is removed
const BACKDROP = 0.72;

/**
 * The moment an exercise is finished: its collapsed card floats to the middle of the screen, gets
 * chained shut, then slams back into its slot. The backdrop swallows touches so nothing moves
 * underneath, and a tap on it skips to the slam.
 */
export function LockStage({ onDone }: { onDone: (id: string) => void }) {
  const stage = useLockStore(s => s.stage);
  const boxRef = useRef<any>(null);
  const origin = useRef({ x: 0, y: 0 });
  const [originPt, setOriginPt] = useState({ x: 0, y: 0 }); // same value, for placing the clone while rendering
  const size = useRef({ w: 0, h: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const skip = useRef<(() => void) | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });
  const [reduceMotion, setReduceMotion] = useState(false);

  // 0 = in its slot, 1 = floating at centre. Position, scale, shadow and backdrop all follow it.
  const lift = useSharedValue(0);
  const thud = useSharedValue(0);
  const dx = useSharedValue(0);   // slot -> centre
  const dy = useSharedValue(0);
  const ox = useSharedValue(0);   // how far the slot has moved since the stage began
  const oy = useSharedValue(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };

  const finish = useCallback((id: string) => {
    clearTimers();
    skip.current = null;
    endStage();
    // Only now, so opening an earlier card can't move the slot while the card is still flying home.
    // Not via `later`: ending the stage re-runs the effect below, whose cleanup clears those timers.
    setTimeout(() => onDoneRef.current(id), 60);
  }, []);

  const slam = useCallback((s: Stage) => {
    skip.current = null;
    const go = (toX: number, toY: number) => {
      ox.set(toX - s.from.x);
      oy.set(toY - s.from.y);
      lift.set(withTiming(0, { duration: SLAM_MS, easing: Easing.in(Easing.cubic) }));
      later(SLAM_MS, () => thud.set(withSequence(withTiming(-0.035, { duration: 60 }), withTiming(0, { duration: THUD_MS - 60 }))));
      later(SLAM_MS + THUD_MS, () => finish(s.id));
    };
    // The slot is re-measured now: the list may have shifted while the card was away.
    const real = getCard(s.id);
    if (!real) { go(s.from.x, s.from.y); return; }
    real.measureInWindow((x: number, y: number, w: number, h: number) => {
      if (w > 0 && h > 0) go(x, y); else go(s.from.x, s.from.y);
    });
  }, [finish, lift, thud, ox, oy]);

  useEffect(() => {
    if (!stage) return;
    const s = stage;
    clearTimers();

    if (reduceMotion) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      finish(s.id);
      return;
    }

    const { w: lw, h: lh } = size.current;
    // Centre of the screen, from the card's own centre.
    dx.set(lw / 2 - (s.from.x - origin.current.x + s.from.w / 2));
    dy.set(lh / 2 - (s.from.y - origin.current.y + s.from.h / 2));
    ox.set(0); oy.set(0); thud.set(0);
    lift.set(withSpring(1, { damping: 16, stiffness: 170, mass: 0.9 }));

    // The chain is drawn on the card as it will be seen: scaled up and centred.
    const tw = s.from.w * FLOAT_SCALE, th = s.from.h * FLOAT_SCALE;
    const rect = { x: origin.current.x + (lw - tw) / 2, y: origin.current.y + (lh - th) / 2, w: tw, h: th };
    later(LIFT_MS, () => fireLock(rect));
    later(LIFT_MS + LOCK_MS, () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      slam(s);
    });
    skip.current = () => {
      // Tapped away: stop the timeline, clear the chain and fly home from wherever the card is now.
      clearTimers();
      fadeAllLocks();
      slam(s);
    };
    return clearTimers;
  }, [stage?.id]);

  // Never leave a backdrop up that could block touches somewhere else.
  useEffect(() => () => { clearTimers(); fadeAllLocks(); endStage(); }, []);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: lift.get() * BACKDROP }));
  const cloneStyle = useAnimatedStyle(() => {
    const l = lift.get();
    return {
      transform: [
        { translateX: dx.get() * l + ox.get() * (1 - l) },
        { translateY: dy.get() * l + oy.get() * (1 - l) },
        { scale: 1 + (FLOAT_SCALE - 1) * l + thud.get() },
      ],
      shadowOpacity: 0.6 * l,
      shadowRadius: 8 + 22 * l,
    };
  });

  return (
    <View
      ref={boxRef}
      pointerEvents={stage ? 'auto' : 'none'}
      style={StyleSheet.absoluteFill}
      onLayout={e => {
        size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
        boxRef.current?.measureInWindow((x: number, y: number) => { origin.current = { x, y }; setOriginPt({ x, y }); });
      }}>
      {stage && !reduceMotion && (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: Ink.bg }, backdropStyle]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => skip.current?.()} accessibilityLabel="Skip" />
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.clone,
              { left: stage.from.x - originPt.x, top: stage.from.y - originPt.y, width: stage.from.w, height: stage.from.h },
              cloneStyle,
            ]}>
            <CollapsedRow name={stage.name} summary={stage.summary} done style={{ marginBottom: 0, flex: 1 }} />
          </Animated.View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clone: { position: 'absolute', shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, borderRadius: 14 },
});
