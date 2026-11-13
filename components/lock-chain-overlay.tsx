import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { GLView } from 'expo-gl';
import {
  bindGeometry, buildCarabiner, buildLink, createChromeProgram, mulInto, PITCH, TIERS, uploadGeometry,
} from '@/lib/chrome-gl';
import { clearLocks, CLAMP_MS, KILL_MS, LOCK_MS, SHIMMER_END_MS, useLockStore } from '@/lib/lock-store';
import type { Lock } from '@/lib/lock-store';

// Mesh units are scaled to points. The carabiner is chunkier than the links so it reads as the clasp.
const LINK_SCALE = 40;
const CARABINER_SCALE = 30;
const CARABINER_RIGHT_INSET = 26; // carabiner centre sits this far from the row's right edge, over the tick
// Centre-to-centre distance between the carabiner and the link hooked on its left, in points.
const HOOK_GAP = CARABINER_SCALE * 0.675 + LINK_SCALE * 0.315;
const ROW_FALLBACK = 48;

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * One transparent GL layer over the session. Idle it costs nothing: it draws only while a set is
 * being locked, then stops. Each lock is scissored to its own row, so no chain can leave the row.
 */
export function LockChainOverlay() {
  const boxRef = useRef<ComponentRef<typeof View>>(null);
  const glRef = useRef<any>(null);
  const drawRef = useRef<((now: number) => void) | null>(null);
  const rafRef = useRef(0);
  const origin = useRef({ x: 0, y: 0 });
  const size = useRef({ w: 0, h: 0 });
  const [reduceMotion, setReduceMotion] = useState(false);
  const locks = useLockStore(s => s.locks);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const measure = useCallback(() => {
    boxRef.current?.measureInWindow((x, y) => { origin.current = { x, y }; });
  }, []);

  const loop = useCallback(() => {
    function tick() {
      const now = Date.now();
      const live = useLockStore.getState().locks.some(l => isLive(l, now));
      if (!live) {
        // Blank the layer once, then idle.
        drawRef.current?.(0);
        rafRef.current = 0;
        clearLocks();
        return;
      }
      drawRef.current?.(now);
      rafRef.current = requestAnimationFrame(tick);
    }
    tick();
  }, []);

  useEffect(() => {
    if (!locks.length) return;
    if (reduceMotion || !drawRef.current) { clearLocks(); return; }
    if (!rafRef.current) {
      // Measure first: the origin must be current before the first frame is placed.
      boxRef.current?.measureInWindow((x, y) => {
        origin.current = { x, y };
        if (!rafRef.current) loop();
      });
    }
  }, [locks, reduceMotion, loop]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const onContextCreate = useCallback((gl: any) => {
    const P = createChromeProgram(gl);
    const link = uploadGeometry(gl, buildLink(TIERS.high));
    const carabiner = uploadGeometry(gl, buildCarabiner(TIERS.high));

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);

    const model = new Float32Array(16);
    const mvp = new Float32Array(16);
    const proj = new Float32Array(16);
    model[15] = 1;
    proj[15] = 1;

    /** One chain piece lying along +x, twisted by `theta` about that axis. */
    const place = (geo: typeof link, scale: number, x: number, y: number, theta: number, seed: number) => {
      const c = Math.cos(theta) * scale, s = Math.sin(theta) * scale;
      // columns: W (mesh x), T (mesh y, along the chain), N = W x T (mesh z)
      model[0] = 0; model[1] = c; model[2] = s;
      model[4] = scale; model[5] = 0; model[6] = 0;
      model[8] = 0; model[9] = s; model[10] = -c;
      model[12] = x; model[13] = y; model[14] = 0;
      mulInto(mvp, proj, model);
      gl.uniformMatrix4fv(P.uModel, false, model);
      gl.uniformMatrix4fv(P.uMVP, false, mvp);
      gl.uniform1f(P.uSeed, seed);
      gl.drawElements(gl.TRIANGLES, geo.count, gl.UNSIGNED_SHORT, 0);
    };

    drawRef.current = (now: number) => {
      const { w: lw, h: lh } = size.current;
      if (!lw || !lh) return;
      const kx = gl.drawingBufferWidth / lw, ky = gl.drawingBufferHeight / lh;
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

      // The clear honours the scissor, so wipe the whole layer first with the test off.
      gl.disable(gl.SCISSOR_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!now) { gl.endFrameEXP(); return; }

      // Orthographic, in points, origin bottom-left so "up" in the reflections is up on screen.
      proj[0] = 2 / lw; proj[5] = 2 / lh; proj[10] = -1 / 200;
      proj[12] = -1; proj[13] = -1;
      gl.enable(gl.SCISSOR_TEST);
      bindGeometry(gl, P, link);

      for (const lock of useLockStore.getState().locks) {
        if (!isLive(lock, now)) continue;
        const { rect } = lock;
        const rx = rect.x - origin.current.x;
        const ry = lh - (rect.y - origin.current.y + rect.h); // bottom edge, y up
        gl.scissor(Math.round(rx * kx), Math.round(ry * ky), Math.round(rect.w * kx), Math.round(rect.h * ky));
        gl.clear(gl.DEPTH_BUFFER_BIT);

        const age = now - lock.startedAt;
        const cy = ry + Math.min(rect.h, ROW_FALLBACK) / 2;
        const cx = rx + rect.w - CARABINER_RIGHT_INSET;
        // The chain runs in from the row's left edge, carabiner leading, and is taut when it lands.
        const slide = -(1 - easeOut(clamp01(age / CLAMP_MS))) * (cx - rx + 60);
        const pitch = PITCH * LINK_SCALE;
        const count = Math.ceil((cx - rx) / pitch) + 1;

        let fade = clamp01((age - SHIMMER_END_MS) / (LOCK_MS - SHIMMER_END_MS));
        if (lock.killedAt) fade = Math.max(fade, clamp01((now - lock.killedAt) / KILL_MS));
        const sweepT = clamp01((age - CLAMP_MS) / (SHIMMER_END_MS - CLAMP_MS));
        const flash = age < CLAMP_MS ? 0 : 1 - clamp01((age - 550) / 150);

        gl.uniform3f(P.uCam, cx, cy, 500);
        gl.uniform1f(P.uTime, now / 1000 % 1000);
        gl.uniform1f(P.uRough, 0);
        gl.uniform1f(P.uDim, 1);
        gl.uniform1f(P.uFade, fade);
        gl.uniform1f(P.uFlash, flash);
        gl.uniform1f(P.uSweepW, 40);
        gl.uniform1f(P.uSweep, rx - 60 + sweepT * (rect.w + 120));

        for (let i = 0; i < count; i++) {
          // Link 0 hooks the carabiner and sits edge-on to it; orientation alternates down the chain.
          const theta = (i % 2 === 0 ? Math.PI / 2 : 0) + 0.18 * Math.sin(i * 1.7 + lock.id);
          place(link, LINK_SCALE, cx - HOOK_GAP - i * pitch + slide, cy, theta, i + lock.id * 7);
        }

        bindGeometry(gl, P, carabiner);
        // Snap shut: a small overshoot that settles as the haptic lands.
        const snap = 1 + 0.12 * (1 - clamp01((age - CLAMP_MS) / 120)) * (age >= CLAMP_MS ? 1 : 0);
        place(carabiner, CARABINER_SCALE * snap, cx + slide, cy, 0, 101 + lock.id);
        bindGeometry(gl, P, link);
      }
      gl.disable(gl.SCISSOR_TEST);
      gl.endFrameEXP();
    };
    glRef.current = gl;
  }, []);

  return (
    <View
      ref={boxRef}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={e => { size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; measure(); }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
    </View>
  );
}

function isLive(l: Lock, now: number) {
  return now - l.startedAt < LOCK_MS && (!l.killedAt || now - l.killedAt < KILL_MS);
}
