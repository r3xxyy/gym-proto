// Pure GL pieces of the chrome chains: link and carabiner meshes, matrices and the mercury shader.
// Shared by the home-screen chains and the set-lock overlay.

// ── Geometry ──────────────────────────────────────────────────────────────────

export type Mesh = { positions: number[]; normals: number[]; indices: number[] };
export type PathPoint = { p: [number, number]; n: [number, number] };

/** Geometry detail: samples around a wire, around a pin, and along each path. */
export type Tier = { tube: number; seg: number; path: number };
export const TIERS: Record<'high' | 'low', Tier> = {
  high: { tube: 12, seg: 16, path: 1 },
  low: { tube: 6, seg: 8, path: 0.5 },
};
// Average frame time over the first FRAMES frames above this drops to the low tier.
export const SLOW_FRAME_MS = 20;
export const FRAMES = 60;

// Chain link: an oval torus lying in the XY plane.
const R = 0.22;    // radius of the end arcs, to the wire centre
const L = 0.34;    // length of each straight side
const WIRE = 0.075;
// Distance between neighbouring link centres when the chain is pulled taut.
export const PITCH = L + 2 * R - 2 * WIRE;

// Oval screw-gate carabiner, same orientation convention as a link.
const CR = 0.42;
const CL = 0.7;
const CWIRE = 0.095;
const GATE_WIRE = 0.07;
const SLEEVE_WIRE = 0.13;
// Centre-to-centre distance between the carabiner and the link hooked on either end.
export const CARABINER_GAP = CL / 2 + CR - CWIRE - WIRE + L / 2 + R;

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
function sweep(mesh: Mesh, path: PathPoint[], radius: number, closed: boolean, TUBE: number) {
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
function addPin(mesh: Mesh, cx: number, cy: number, r: number, h: number, SEG: number) {
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

export function buildLink({ tube, path: detail }: Tier) {
  const mesh: Mesh = { positions: [], normals: [], indices: [] };
  const total = 2 * L + 2 * Math.PI * R;
  const path: PathPoint[] = [];
  const n = Math.round(48 * detail);
  for (let i = 0; i < n; i++) path.push(stadiumPoint((i / n) * total, R, L));
  sweep(mesh, path, WIRE, true, tube);
  return finish(mesh);
}

export function buildCarabiner({ tube, seg, path: detail }: Tier) {
  const mesh: Mesh = { positions: [], normals: [], indices: [] };

  // Frame: the stadium outline without its right-hand side, which is the gate.
  const total = 2 * CL + 2 * Math.PI * CR;
  const frame: PathPoint[] = [];
  const steps = Math.round(56 * detail);
  for (let i = 0; i <= steps; i++) frame.push(stadiumPoint(CL + (i / steps) * (total - CL), CR, CL));
  sweep(mesh, frame, CWIRE, false, tube);

  // Gate: a thinner straight bar closing the right-hand side.
  const bar = (y0: number, y1: number): PathPoint[] =>
    Array.from({ length: 6 }, (_, i) => ({ p: [CR, y0 + ((y1 - y0) * i) / 5] as [number, number], n: [1, 0] as [number, number] }));
  sweep(mesh, bar(-CL / 2, CL / 2), GATE_WIRE, false, tube);

  // Screw sleeve: a knurled collar near the hinge end of the gate, ridges alternating in radius.
  const ridges = 7;
  for (let k = 0; k < ridges; k++) {
    const y0 = -CL / 2 + 0.04 + k * 0.045;
    sweep(mesh, bar(y0, y0 + 0.045), k % 2 === 0 ? SLEEVE_WIRE : SLEEVE_WIRE + 0.02, false, tube);
  }
  // Thin washer where the sleeve meets the gate.
  sweep(mesh, bar(-CL / 2 + 0.04 + ridges * 0.045, -CL / 2 + 0.07 + ridges * 0.045), SLEEVE_WIRE - 0.035, false, tube);

  // Hardware: hinge pin, nose pin and a rivet plate on the spine, heads proud of both faces.
  addPin(mesh, CR, -CL / 2 - 0.015, 0.075, CWIRE + 0.012, seg);
  addPin(mesh, CR, CL / 2 + 0.015, 0.065, CWIRE + 0.01, seg);
  addPin(mesh, -CR, 0, 0.12, CWIRE + 0.012, seg);
  addPin(mesh, -CR, 0, 0.05, CWIRE + 0.03, seg);
  return finish(mesh);
}

// ── Matrices (column-major) ───────────────────────────────────────────────────

export function perspective(fov: number, aspect: number, near: number, far: number) {
  const t = 1 / Math.tan(fov / 2);
  const out = new Float32Array(16);
  out[0] = t / aspect; out[5] = t;
  out[10] = (far + near) / (near - far); out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function mulInto(out: Float32Array, a: Float32Array, b: Float32Array) {
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i + k * 4] * b[k + j * 4];
      out[i + j * 4] = s;
    }
}

// ── Strands ───────────────────────────────────────────────────────────────────

export type Strand = {
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

export const STRANDS: Strand[] = [
  { c: [-0.1, 1.5, 0], d: [0.62, -0.78, 0], sway: 0.18, depth: 0.35, size: 0.9, rough: 0, dim: 1, speed: 0.28, phase: 0 },
  { c: [0.1, 0.2, -0.8], d: [0.96, 0.28, 0], sway: 0.2, depth: 0.4, size: 0.85, rough: 0.1, dim: 0.85, speed: -0.22, phase: 2.1 },
  { c: [0.98, 0.5, 0.4], d: [-0.18, -0.98, 0], sway: 0.15, depth: 0.3, size: 1.0, rough: 0, dim: 0.95, speed: 0.2, phase: 4.2 },
  // Foreground strand, close to the camera, dark and soft like a defocused shot.
  { c: [0.2, -2.0, 2.2], d: [0.9, -0.35, 0], sway: 0.1, depth: 0.2, size: 2.0, rough: 1.0, dim: 0.28, speed: 0.15, phase: 1.3 },
];

// ── Shaders ───────────────────────────────────────────────────────────────────

export const VS = `
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
export const FS = `
precision highp float;
uniform vec3 uCam;
uniform float uSeed;
uniform float uRough;
uniform float uDim;
uniform float uTime;
// Lock overlay only. All four default to 0, which leaves the home-screen look untouched.
uniform float uSweep;   // world x of the shimmer band
uniform float uSweepW;  // half-width of the band
uniform float uFlash;   // shimmer strength
uniform float uFade;    // 0 visible, 1 gone
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
  // A dark studio with a few hard, bright panels. Mercury is all contrast: near-black reflections
  // sitting right next to bright strips, with the horizon line bending across the wire.
  vec3 sky = mix(vec3(0.27, 0.29, 0.33), vec3(0.72, 0.75, 0.82), smoothstep(-0.05, 0.9, up));
  vec3 floorc = mix(vec3(0.008, 0.008, 0.012), vec3(0.12, 0.125, 0.15), smoothstep(-1.0, -0.04, up));
  vec3 c = mix(floorc, sky, smoothstep(-0.03, 0.03, up));
  c *= 1.0 - 0.8 * exp(-pow((up - 0.10) / 0.09, 2.0));
  float v1 = smoothstep(0.0, 0.18, up) * (1.0 - smoothstep(0.7, 0.92, up));
  c += vec3(1.0, 1.0, 1.02) * band(az, -0.95, 0.16, 0.07) * v1 * 1.35;
  c += vec3(0.9, 0.95, 1.0) * band(az, 0.75, 0.07, 0.06) * v1 * 1.1;
  c += vec3(1.0, 0.99, 0.97) * band(az, 2.45, 0.22, 0.10) * v1 * 0.95;
  c += vec3(1.0) * band(az, 0.1, 0.05, 0.05) * smoothstep(0.0, 0.25, up) * 0.8;
  c += vec3(1.0) * band(up, 0.93, 0.025, 0.04) * 0.7;
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
  vec3 c = 1.0 - exp(-env * 2.0);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.55);
  float rim = pow(1.0 - max(dot(n0, -v), 0.0), 3.0);
  c = mix(c, vec3(0.86, 0.89, 0.95), 0.15 * rim);
  // Shimmer: a bright panel sliding along the chain, strongest where the metal already reflects light.
  float glint = uFlash * smoothstep(uSweepW + 0.0001, 0.0, abs(vPos.x - uSweep));
  c += vec3(0.92, 0.96, 1.0) * glint * (0.35 + 0.9 * dot(env, vec3(0.333)));
  float keep = 1.0 - uFade;
  gl_FragColor = vec4(c * uDim * vec3(0.98, 0.99, 1.01) * keep, keep);
}`;

// ── GL setup shared by every chrome surface ───────────────────────────────────

export type Geometry = ReturnType<typeof buildLink>;

export function createChromeProgram(gl: any) {
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
  const u = (name: string) => gl.getUniformLocation(prog, name);
  return {
    aPos, aNor,
    uMVP: u('uMVP'), uModel: u('uModel'), uCam: u('uCam'), uSeed: u('uSeed'), uRough: u('uRough'),
    uDim: u('uDim'), uTime: u('uTime'), uSweep: u('uSweep'), uSweepW: u('uSweepW'), uFlash: u('uFlash'), uFade: u('uFade'),
  };
}

export type ChromeProgram = ReturnType<typeof createChromeProgram>;

export function uploadGeometry(gl: any, g: Geometry) {
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
}

export type GpuGeometry = ReturnType<typeof uploadGeometry>;

export function deleteGeometry(gl: any, g: GpuGeometry) {
  gl.deleteBuffer(g.pos);
  gl.deleteBuffer(g.nor);
  gl.deleteBuffer(g.idx);
}

export function bindGeometry(gl: any, p: ChromeProgram, g: GpuGeometry) {
  gl.bindBuffer(gl.ARRAY_BUFFER, g.pos);
  gl.vertexAttribPointer(p.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, g.nor);
  gl.vertexAttribPointer(p.aNor, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx);
}
