import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { GLView } from 'expo-gl';

// ── Geometry ──────────────────────────────────────────────────────────────────

type Mesh = { positions: number[]; normals: number[]; indices: number[] };
type PathPoint = { p: [number, number]; n: [number, number] };

const TUBE = 12;   // samples around a wire

// Chain link: an oval torus lying in the XY plane.
const R = 0.22;    // radius of the end arcs, to the wire centre
const L = 0.34;    // length of each straight side
const WIRE = 0.075;
// Distance between neighbouring link centres when the chain is pulled taut.
const PITCH = L + 2 * R - 2 * WIRE;

// Oval screw-gate carabiner, same orientation convention as a link.
const CR = 0.42;
const CL = 0.7;
const CWIRE = 0.095;
const GATE_WIRE = 0.07;
const SLEEVE_WIRE = 0.13;
// Centre-to-centre distance between the carabiner and the link hooked on either end.
const CARABINER_GAP = CL / 2 + CR - CWIRE - WIRE + L / 2 + R;

/** Point on a stadium outline at arc length `s`, starting at the bottom of the right side. */
function stadiumPoint(s: number, r: number, l: number): PathPoint {
  const arc = Math.PI * r;
  if (s < l) return { p: [r, -l / 2 + s], n: [1, 0] };
  if (s < l + arc) {
    const a = (s - l) / r;
    return { p: [r * Math.cos(a), l / 2 + r * Math.sin(a)], n: [Math.cos(a), Math.sin(a)] };
  }
  if (s < 2 * l + arc) return { p: [-r, l / 2 - (s - l - arc)], n: [-1, 0] };
  const a = Math.PI + (s - 2 * l - arc) / r;
  return { p: [r * Math.cos(a), -l / 2 + r * Math.sin(a)], n: [Math.cos(a), Math.sin(a)] };
}

/**
 * Sweeps a circle of the given radius along a path in the XY plane. A closed path wraps
 * round on itself; an open one gets a flat cap at each end.
 */
function sweep(mesh: Mesh, path: PathPoint[], radius: number, closed: boolean) {
  const base = mesh.positions.length / 3;
  const n = path.length;
  for (const { p, n: nm } of path) {
    for (let j = 0; j < TUBE; j++) {
      const phi = (j / TUBE) * Math.PI * 2;
      const c = Math.cos(phi), s = Math.sin(phi);
      mesh.positions.push(p[0] + radius * c * nm[0], p[1] + radius * c * nm[1], radius * s);
      mesh.normals.push(c * nm[0], c * nm[1], s);
    }
  }
  const rings = closed ? n : n - 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < TUBE; j++) {
      const a = base + i * TUBE + j;
      const b = base + ((i + 1) % n) * TUBE + j;
      const a2 = base + i * TUBE + ((j + 1) % TUBE);
      const b2 = base + ((i + 1) % n) * TUBE + ((j + 1) % TUBE);
      mesh.indices.push(a, b, a2, b, b2, a2);
    }
  }
  if (closed) return;

  // End caps: a fan of triangles facing along the tube.
  for (const end of [0, n - 1]) {
    const prev = path[end === 0 ? 1 : n - 2].p, cur = path[end].p;
    let tx = cur[0] - prev[0], ty = cur[1] - prev[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const centre = mesh.positions.length / 3;
    mesh.positions.push(cur[0], cur[1], 0);
    mesh.normals.push(tx, ty, 0);
    const ring = mesh.positions.length / 3;
    const nm = path[end].n;
    for (let j = 0; j < TUBE; j++) {
      const phi = (j / TUBE) * Math.PI * 2;
      mesh.positions.push(cur[0] + radius * Math.cos(phi) * nm[0], cur[1] + radius * Math.cos(phi) * nm[1], radius * Math.sin(phi));
      mesh.normals.push(tx, ty, 0);
    }
    for (let j = 0; j < TUBE; j++) mesh.indices.push(centre, ring + j, ring + ((j + 1) % TUBE));
  }
}

/**
 * A rivet or pin lying along z: a short barrel with domed heads, centred on (cx, cy).
 * Revolved from a profile of (radius, z, normal-radial, normal-z).
 */
function addPin(mesh: Mesh, cx: number, cy: number, r: number, h: number) {
  const SEG = 16;
  const d = r * 0.35;
  const profile: [number, number, number, number][] = [
    [0, -h - d, 0, -1],
    [0.6 * r, -h - 0.8 * d, 0.3, -0.95],
    [r, -h, 0.75, -0.66],
    [r, h, 0.75, 0.66],
    [0.6 * r, h + 0.8 * d, 0.3, 0.95],
    [0, h + d, 0, 1],
  ];
  const base = mesh.positions.length / 3;
  for (const [rad, z, nr, nz] of profile) {
    for (let j = 0; j < SEG; j++) {
      const phi = (j / SEG) * Math.PI * 2;
      const c = Math.cos(phi), sn = Math.sin(phi);
      mesh.positions.push(cx + rad * c, cy + rad * sn, z);
      const l = Math.hypot(nr, nz);
      mesh.normals.push((nr * c) / l, (nr * sn) / l, nz / l);
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = base + i * SEG + j;
      const b = base + (i + 1) * SEG + j;
      const a2 = base + i * SEG + ((j + 1) % SEG);
      const b2 = base + (i + 1) * SEG + ((j + 1) % SEG);
      mesh.indices.push(a, b, a2, b, b2, a2);
    }
  }
}

const finish = (m: Mesh) => ({
  positions: new Float32Array(m.positions),
  normals: new Float32Array(m.normals),
  indices: new Uint16Array(m.indices),
});

function buildLink() {
  const mesh: Mesh = { positions: [], normals: [], indices: [] };
  const total = 2 * L + 2 * Math.PI * R;
  const path: PathPoint[] = [];
  for (let i = 0; i < 48; i++) path.push(stadiumPoint((i / 48) * total, R, L));
  sweep(mesh, path, WIRE, true);
  return finish(mesh);
}

function buildCarabiner() {
  const mesh: Mesh = { positions: [], normals: [], indices: [] };

  // Frame: the stadium outline without its right-hand side, which is the gate.
  const total = 2 * CL + 2 * Math.PI * CR;
  const frame: PathPoint[] = [];
  const steps = 56;
  for (let i = 0; i <= steps; i++) frame.push(stadiumPoint(CL + (i / steps) * (total - CL), CR, CL));
  sweep(mesh, frame, CWIRE, false);

  // Gate: a thinner straight bar closing the right-hand side.
  const bar = (y0: number, y1: number): PathPoint[] =>
    Array.from({ length: 6 }, (_, i) => ({ p: [CR, y0 + ((y1 - y0) * i) / 5] as [number, number], n: [1, 0] as [number, number] }));
  sweep(mesh, bar(-CL / 2, CL / 2), GATE_WIRE, false);

  // Screw sleeve: a knurled collar near the hinge end of the gate, ridges alternating in radius.
  const ridges = 7;
  for (let k = 0; k < ridges; k++) {
    const y0 = -CL / 2 + 0.04 + k * 0.045;
    sweep(mesh, bar(y0, y0 + 0.045), k % 2 === 0 ? SLEEVE_WIRE : SLEEVE_WIRE + 0.02, false);
  }
  // Thin washer where the sleeve meets the gate.
  sweep(mesh, bar(-CL / 2 + 0.04 + ridges * 0.045, -CL / 2 + 0.07 + ridges * 0.045), SLEEVE_WIRE - 0.035, false);

  // Hardware: hinge pin, nose pin and a rivet plate on the spine, heads proud of both faces.
  addPin(mesh, CR, -CL / 2 - 0.015, 0.075, CWIRE + 0.012);
  addPin(mesh, CR, CL / 2 + 0.015, 0.065, CWIRE + 0.01);
  addPin(mesh, -CR, 0, 0.12, CWIRE + 0.012);
  addPin(mesh, -CR, 0, 0.05, CWIRE + 0.03);
  return finish(mesh);
}

// ── Matrices (column-major) ───────────────────────────────────────────────────

function perspective(fov: number, aspect: number, near: number, far: number) {
  const t = 1 / Math.tan(fov / 2);
  const out = new Float32Array(16);
  out[0] = t / aspect; out[5] = t;
  out[10] = (far + near) / (near - far); out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function mulInto(out: Float32Array, a: Float32Array, b: Float32Array) {
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i + k * 4] * b[k + j * 4];
      out[i + j * 4] = s;
    }
}

// ── Strands ───────────────────────────────────────────────────────────────────

type Strand = {
  c: [number, number, number];  // centre of the strand
  d: [number, number, number];  // direction it runs in (unit length)
  sway: number;                 // sideways wave amplitude in the screen plane
  depth: number;                // wave amplitude towards and away from the camera
  size: number;                 // link scale
  rough: number;                // extra surface roughness; high values read as out of focus
  dim: number;                  // brightness, lower for far or blurred strands
  speed: number;                // links travelling along the chain, world units per second
  phase: number;
};

const STRANDS: Strand[] = [
  { c: [-0.1, 1.5, 0], d: [0.62, -0.78, 0], sway: 0.18, depth: 0.35, size: 0.9, rough: 0, dim: 1, speed: 0.28, phase: 0 },
  { c: [0.1, 0.2, -0.8], d: [0.96, 0.28, 0], sway: 0.2, depth: 0.4, size: 0.85, rough: 0.1, dim: 0.85, speed: -0.22, phase: 2.1 },
  { c: [0.98, 0.5, 0.4], d: [-0.18, -0.98, 0], sway: 0.15, depth: 0.3, size: 1.0, rough: 0, dim: 0.95, speed: 0.2, phase: 4.2 },
  // Foreground strand, close to the camera, dark and soft like a defocused shot.
  { c: [0.2, -2.0, 2.2], d: [0.9, -0.35, 0], sway: 0.1, depth: 0.2, size: 2.0, rough: 1.0, dim: 0.28, speed: 0.15, phase: 1.3 },
];

// ── Shaders ───────────────────────────────────────────────────────────────────

const VS = `
attribute vec3 aPos;
attribute vec3 aNor;
uniform mat4 uMVP;
uniform mat4 uModel;
varying vec3 vNor;
varying vec3 vPos;
varying vec3 vLocal;
void main() {
  vLocal = aPos;
  vNor = mat3(uModel) * aNor;
  vPos = (uModel * vec4(aPos, 1.0)).xyz;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

// Liquid mercury: a smooth, almost perfect mirror of a dark studio with a few tall soft panels.
// Slow, low-frequency noise drifts through the normals so the reflections swim and pool like a
// liquid; a tone curve keeps the brightest panels silver rather than white.
const FS = `
precision highp float;
uniform vec3 uCam;
uniform float uSeed;
uniform float uRough;
uniform float uDim;
uniform float uTime;
varying vec3 vNor;
varying vec3 vPos;
varying vec3 vLocal;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// Soft-edged band: 1 inside |x - c| < w, fading to 0 over 'soft'.
float band(float x, float c, float w, float soft) {
  return smoothstep(w + soft, w - soft, abs(x - c));
}

vec3 studio(vec3 r) {
  float up = r.y;
  float az = atan(r.x, r.z);
  // Cool grey sky over a near-black floor, with a crisp horizon: the horizon line bending across
  // the curved wire is what makes the surface read as mercury.
  vec3 sky = mix(vec3(0.50, 0.53, 0.58), vec3(0.97, 0.98, 1.0), smoothstep(-0.05, 0.8, up));
  vec3 floorc = mix(vec3(0.02, 0.02, 0.025), vec3(0.42, 0.43, 0.46), smoothstep(-1.0, -0.04, up));
  vec3 c = mix(floorc, sky, smoothstep(-0.035, 0.035, up));
  // Dark band hugging the horizon, deepening the contrast along the wire.
  c *= 1.0 - 0.5 * exp(-pow((up - 0.10) / 0.09, 2.0));
  // Tall soft panels, each a bright vertical strip.
  float v1 = smoothstep(0.02, 0.2, up) * (1.0 - smoothstep(0.65, 0.9, up));
  c += vec3(0.95, 0.97, 1.0) * band(az, -0.95, 0.20, 0.16) * v1 * 0.85;
  c += vec3(0.85, 0.92, 1.0) * band(az, 0.75, 0.10, 0.12) * v1 * 0.70;
  c += vec3(1.0, 0.99, 0.97) * band(az, 2.45, 0.32, 0.20) * v1 * 0.60;
  // A broad soft box behind the camera, which is what camera-facing surfaces mirror.
  c += vec3(0.95, 0.96, 0.98) * band(az, 0.0, 0.5, 0.45) * smoothstep(-0.2, 0.3, up) * 0.5;
  // A strip light overhead and a faint cool kicker low behind.
  c += vec3(1.0) * band(up, 0.93, 0.03, 0.05) * 0.5;
  c += vec3(0.4, 0.5, 0.7) * band(az, -2.6, 0.25, 0.25) * (1.0 - v1) * smoothstep(-0.6, -0.1, up) * 0.35;
  return c;
}

void main() {
  vec3 q = vLocal + vec3(uSeed * 1.7, uSeed * 0.3, uSeed * 2.9);
  vec3 n0 = normalize(vNor);
  // Two slow drifting octaves of normal wobble: the reflections flow instead of sitting still.
  float tt = uTime * 0.12;
  vec3 f1 = vec3(noise(q * 2.2 + tt), noise(q * 2.2 + 11.0 - tt), noise(q * 2.2 + 23.0 + tt)) - 0.5;
  vec3 f2 = vec3(noise(q * 5.0 - tt * 1.7), noise(q * 5.0 + 7.0), noise(q * 5.0 + 19.0 + tt * 1.3)) - 0.5;
  vec3 ripple = vec3(noise(q * 30.0), noise(q * 30.0 + 11.0), noise(q * 30.0 + 23.0)) - 0.5;
  vec3 n = normalize(n0 + f1 * 0.42 + f2 * 0.14 + ripple * (0.012 + 0.5 * uRough));

  vec3 v = normalize(vPos - uCam);
  vec3 env = studio(reflect(v, n));

  // Soft shoulder, then a gentle S-curve for the high contrast of liquid metal.
  vec3 c = 1.0 - exp(-env * 2.8);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);
  float rim = pow(1.0 - max(dot(n0, -v), 0.0), 3.0);
  c = mix(c, vec3(0.86, 0.89, 0.95), 0.15 * rim);
  gl_FragColor = vec4(c * uDim * vec3(0.98, 0.99, 1.01), 1.0);
}`;

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  /** Stops the render loop to save battery; draws one still frame instead. */
  paused?: boolean;
};

export function ChromeChains({ paused = false }: Props) {
  const glRef = useRef<any>(null);
  const drawRef = useRef<((t: number) => void) | null>(null);
  const rafRef = useRef(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const loop = useCallback(() => {
    drawRef.current?.(Date.now() / 1000);
    glRef.current?.endFrameEXP?.();
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const start = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (!drawRef.current) return;
    if (paused || reduceMotion) {
      drawRef.current(3);
      glRef.current?.endFrameEXP?.();
      return;
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [paused, reduceMotion, loop]);

  useEffect(() => {
    start();
    return () => cancelAnimationFrame(rafRef.current);
  }, [start]);

  const onContextCreate = useCallback((gl: any) => {
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    gl.viewport(0, 0, W, H);

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aNor = gl.getAttribLocation(prog, 'aNor');
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aNor);

    const upload = (g: { positions: Float32Array; normals: Float32Array; indices: Uint16Array }) => {
      const mk = (target: number, data: Float32Array | Uint16Array) => {
        const buf = gl.createBuffer();
        gl.bindBuffer(target, buf);
        gl.bufferData(target, data, gl.STATIC_DRAW);
        return buf;
      };
      return {
        pos: mk(gl.ARRAY_BUFFER, g.positions),
        nor: mk(gl.ARRAY_BUFFER, g.normals),
        idx: mk(gl.ELEMENT_ARRAY_BUFFER, g.indices),
        count: g.indices.length,
      };
    };
    const linkGeo = upload(buildLink());
    const carabinerGeo = upload(buildCarabiner());
    const useGeo = (g: typeof linkGeo) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, g.pos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.nor);
      gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx);
    };

    const uMVP = gl.getUniformLocation(prog, 'uMVP');
    const uModel = gl.getUniformLocation(prog, 'uModel');
    const uCam = gl.getUniformLocation(prog, 'uCam');
    const uSeed = gl.getUniformLocation(prog, 'uSeed');
    const uRough = gl.getUniformLocation(prog, 'uRough');
    const uDim = gl.getUniformLocation(prog, 'uDim');
    const uTime = gl.getUniformLocation(prog, 'uTime');

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

        useGeo(linkGeo);
        for (let i = 0; i < count; i++) {
          const base = i < ic ? i * pitchU : (ic - 1) * pitchU + 2 * gapU + (i - ic) * pitchU;
          // Neighbours of the carabiner sit edge-on to it, and orientation alternates from there.
          const dist = i < ic ? ic - 1 - i : i - ic;
          place(s, linkGeo.count, t, along(base), dist % 2 === 0, i + k * 17);
        }

        useGeo(carabinerGeo);
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
