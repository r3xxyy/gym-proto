import { useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Ink } from '@/constants/theme';
import type { BadgeDefinition } from '../constants/badges';

// ─── Badge Unlock Overlay ─────────────────────────────────────────────────────

export function BadgeUnlockOverlay({ badge, onDismiss }: { badge: BadgeDefinition; onDismiss: () => void }) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 250 });
    scale.value = withSpring(1, { damping: 14, stiffness: 130 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  }, []);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <TouchableOpacity style={badgeOverlay.backdrop} activeOpacity={1} onPress={onDismiss}>
      <Animated.View style={[badgeOverlay.card, cardStyle]}>
        <Text style={badgeOverlay.label}>BADGE UNLOCKED</Text>
        <Text style={badgeOverlay.icon}>{badge.icon}</Text>
        <Text style={badgeOverlay.name}>{badge.name}</Text>
        <Text style={badgeOverlay.flavour}>{badge.flavour}</Text>
        <Text style={badgeOverlay.hint}>tap to continue</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}


const badgeOverlay = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  card: {
    backgroundColor: Ink.raised,
    borderWidth: 1,
    borderColor: Ink.line,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    maxWidth: 300,
  },
  label: { fontSize: 9, color: Ink.textFaint, },
  icon:  { fontSize: 72, lineHeight: 90 },
  name:  { fontSize: 20, fontWeight: '700', color: '#fff', textAlign: 'center' },
  flavour: { fontSize: 13, color: Ink.textDim, textAlign: 'center', lineHeight: 20, fontStyle: 'italic' },
  hint:  { fontSize: 10, color: Ink.textFaint, marginTop: 8 },
});

