import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, View } from 'react-native';
import { GLView } from 'expo-gl';
import { useIsFocused } from 'expo-router';
import {
  bindGeometry, buildCarabiner, buildLink, CARABINER_GAP, createChromeProgram, deleteGeometry, FRAMES, mulInto,
  perspective, PITCH, SLOW_FRAME_MS, STRANDS, TIERS, uploadGeometry,
} from '@/lib/chrome-gl';
import type { Strand, Tier } from '@/lib/chrome-gl';

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  /** Stops the render loop to save battery; draws one still frame instead. */
  paused?: boolean;
};

export function ChromeChains({ paused = false }: Props) {
  const glRef = useRef<any>(null);
  const drawRef = useRef<((t: number) => void) | null>(null);
  const rafRef = useRef(0);
  const rebuildRef = useRef<((tier: Tier) => void) | null>(null);
  const tierRef = useRef<'high' | 'low'>('high');
  const [reduceMotion, setReduceMotion] = useState(false);
  // Off-screen (other tab) or backgrounded: nothing is visible, so don't burn GPU on it.
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const loop = useCallback(() => {
    // Performance tiering: if the first frames run slow, rebuild the meshes with fewer segments.
    let last = 0, frames = 0, total = 0;
    let measuring = tierRef.current === 'high';
    function tick() {
      const now = Date.now();
      if (measuring && last) {
        total += now - last;
        if (++frames >= FRAMES) {
          measuring = false;
          if (total / frames > SLOW_FRAME_MS) {
            tierRef.current = 'low';
            rebuildRef.current?.(TIERS.low);
          }
        }
      }
      last = now;
      drawRef.current?.(now / 1000);
      glRef.current?.endFrameEXP?.();
      rafRef.current = requestAnimationFrame(tick);
    }
    tick();
  }, []);

  const start = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (!drawRef.current || !focused || !appActive) return;
    if (paused || reduceMotion) {
      drawRef.current(3);
      glRef.current?.endFrameEXP?.();
      return;
    }
    loop();
  }, [paused, reduceMotion, focused, appActive, loop]);

  useEffect(() => {
    start();
    return () => cancelAnimationFrame(rafRef.current);
  }, [start]);

  const onContextCreate = useCallback((gl: any) => {
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    gl.viewport(0, 0, W, H);

    const P = createChromeProgram(gl);
    const { uMVP, uModel, uCam, uSeed, uRough, uDim, uTime } = P;

    const upload = (g: Parameters<typeof uploadGeometry>[1]) => uploadGeometry(gl, g);
    let linkGeo = upload(buildLink(TIERS.high));
    let carabinerGeo = upload(buildCarabiner(TIERS.high));
    rebuildRef.current = (tier) => {
      for (const g of [linkGeo, carabinerGeo]) deleteGeometry(gl, g);
      linkGeo = upload(buildLink(tier));
      carabinerGeo = upload(buildCarabiner(tier));
    };
    const bind = (g: typeof linkGeo) => bindGeometry(gl, P, g);

    const t0 = Date.now() / 1000; // keeps the shader clock small enough for float precision
    const camZ = 6;
    // View is a pure translation, so projection * view is the projection with a z offset.
    const pv = perspective(0.8, W / H, 0.1, 40);
    pv[12] = 0; pv[13] = 0; pv[14] = pv[10] * -camZ + pv[14]; pv[15] = pv[11] * -camZ;
    gl.uniform3f(uCam, 0, 0, camZ);

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);

    // Scratch buffers reused every frame so the render loop doesn't allocate.
    const model = new Float32Array(16);
    const mvp = new Float32Array(16);
    model[15] = 1;

    // Per strand: how many links it takes to cross the screen, kept even so the
    // alternating orientation stays consistent around the ring.
    const counts = STRANDS.map((s) => 2 * Math.ceil(9 / (PITCH * s.size) / 2));

    /** Places one piece of a strand at chain coordinate `u` and draws it. */
    const place = (
      s: Strand, geoCount: number, t: number, u: number, edgeOn: boolean, seed: number,
    ) => {
      const perp: [number, number] = [-s.d[1], s.d[0]];
      const w1 = 0.8 * u + 0.6 * t + s.phase;
      const w2 = 0.6 * u + 0.45 * t + s.phase * 1.7;
      const a = s.sway * Math.sin(w1), b = s.depth * Math.sin(w2);
      const px = s.c[0] + s.d[0] * u + perp[0] * a;
      const py = s.c[1] + s.d[1] * u + perp[1] * a;
      const pz = s.c[2] + b;

      // Tangent: derivative of the position with respect to u.
      const da = s.sway * 0.8 * Math.cos(w1), db = s.depth * 0.6 * Math.cos(w2);
      let tx = s.d[0] + perp[0] * da, ty = s.d[1] + perp[1] * da, tz = db;
      const tl = Math.hypot(tx, ty, tz);
      tx /= tl; ty /= tl; tz /= tl;

      // B1 = T x Z lies in the screen plane; B2 = T x B1 points roughly at the camera.
      let b1x = ty, b1y = -tx;
      const b1l = Math.hypot(b1x, b1y) || 1;
      b1x /= b1l; b1y /= b1l;
      const b2x = -tz * b1y, b2y = tz * b1x, b2z = tx * b1y - ty * b1x;

      // Face-on pieces show their full outline, edge-on pieces are seen from the side,
      // with a slow twist along the chain.
      const theta = 0.5 * Math.sin(0.5 * u + 0.4 * t + s.phase) + (edgeOn ? Math.PI / 2 : 0);
      const ct = Math.cos(theta), st = Math.sin(theta);
      const wx = ct * b1x + st * b2x, wy = ct * b1y + st * b2y, wz = st * b2z;
      // N = W x T
      const nx = wy * tz - wz * ty, ny = wz * tx - wx * tz, nz = wx * ty - wy * tx;

      const sc = s.size;
      model[0] = wx * sc; model[1] = wy * sc; model[2] = wz * sc;
      model[4] = tx * sc; model[5] = ty * sc; model[6] = tz * sc;
      model[8] = nx * sc; model[9] = ny * sc; model[10] = nz * sc;
      model[12] = px; model[13] = py; model[14] = pz;

      mulInto(mvp, pv, model);
      gl.uniformMatrix4fv(uModel, false, model);
      gl.uniformMatrix4fv(uMVP, false, mvp);
      gl.uniform1f(uSeed, seed);
      gl.drawElements(gl.TRIANGLES, geoCount, gl.UNSIGNED_SHORT, 0);
    };

    drawRef.current = (t: number) => {
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(uTime, t < 1e6 ? t : t - t0);
      STRANDS.forEach((s, k) => {
        const pitchU = PITCH * s.size;
        const gapU = CARABINER_GAP * s.size;
        const count = counts[k];
        // The carabiner sits between link `ic - 1` and link `ic`, with extra room around it.
        const ic = count / 2;
        const span = (count - 1) * pitchU + 2 * gapU;
        gl.uniform1f(uRough, s.rough);
        gl.uniform1f(uDim, s.dim);

        // Each piece keeps its identity (index, texture seed, orientation) for good and slides
        // along the chain. When it passes the end it is moved to the other end, which is
        // always off-screen, so nothing visibly changes at the wrap.
        const along = (base: number) => {
          const v = base + t * s.speed;
          return (((v % span) + span) % span) - span / 2;
        };

        bind(linkGeo);
        for (let i = 0; i < count; i++) {
          const base = i < ic ? i * pitchU : (ic - 1) * pitchU + 2 * gapU + (i - ic) * pitchU;
          // Neighbours of the carabiner sit edge-on to it, and orientation alternates from there.
          const dist = i < ic ? ic - 1 - i : i - ic;
          place(s, linkGeo.count, t, along(base), dist % 2 === 0, i + k * 17);
        }

        bind(carabinerGeo);
        place(s, carabinerGeo.count, t, along((ic - 1) * pitchU + gapU), false, 101 + k);
      });
    };
    glRef.current = gl;
    start();
  }, [start]);

  return (
    <View
      pointerEvents="none"
      style={{ flex: 1 }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <GLView style={{ flex: 1 }} onContextCreate={onContextCreate} />
    </View>
  );
}
