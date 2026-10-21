import { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { GLView } from 'expo-gl';

// ── mat4 (column-major, WebGL convention) ────────────────────────────────────

function perspective(out: Float32Array, fov: number, asp: number, n: number, f: number) {
  const t = 1 / Math.tan(fov / 2);
  out.fill(0);
  out[0] = t / asp; out[5] = t;
  out[10] = (f + n) / (n - f); out[11] = -1;
  out[14] = (2 * f * n) / (n - f);
  return out;
}

function lookAt(out: Float32Array, ex: number, ey: number, ez: number) {
  // Camera at (ex,ey,ez) looking at origin, up=(0,1,0)
  let fx = -ex, fy = -ey, fz = -ez;
  const fl = Math.sqrt(fx*fx + fy*fy + fz*fz);
  fx/=fl; fy/=fl; fz/=fl;
  // s = f × (0,1,0)
  const sx = -fz, sy = 0, sz = fx;
  const sl = Math.sqrt(sx*sx + sy*sy + sz*sz);
  const sxn = sx/sl, syn = sy/sl, szn = sz/sl;
  // u = s × f
  const ux = syn*fz - szn*fy, uy = szn*fx - sxn*fz, uz = sxn*fy - syn*fx;
  out[0]=sxn; out[1]=ux;  out[2]=-fx; out[3]=0;
  out[4]=syn; out[5]=uy;  out[6]=-fy; out[7]=0;
  out[8]=szn; out[9]=uz;  out[10]=-fz; out[11]=0;
  out[12]=-(sxn*ex+syn*ey+szn*ez);
  out[13]=-(ux*ex+uy*ey+uz*ez);
  out[14]=fx*ex+fy*ey+fz*ez;
  out[15]=1;
  return out;
}

function mul(out: Float32Array, a: Float32Array, b: Float32Array) {
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i+k*4] * b[k+j*4];
      out[i+j*4] = s;
    }
  return out;
}

function rotY(out: Float32Array, a: number) {
  const c = Math.cos(a), s = Math.sin(a);
  out.fill(0);
  out[0]=c; out[2]=-s; out[5]=1; out[8]=s; out[10]=c; out[15]=1;
  return out;
}

function rotX(out: Float32Array, a: number) {
  const c = Math.cos(a), s = Math.sin(a);
  out.fill(0);
  out[0]=1; out[5]=c; out[6]=s; out[9]=-s; out[10]=c; out[15]=1;
  return out;
}

// ── Geometry ──────────────────────────────────────────────────────────────────

interface Geo { pos: number[]; nor: number[]; idx: number[] }

// Tube swept along an elliptical path (in XY plane, hole along Z by default).
// Rx = half-width, Ry = half-height of the link oval. ryAngle rotates around Y.
function ellipseTubeGeo(Rx: number, Ry: number, r: number, segPath: number, segTube: number,
                        tx: number, ty: number, tz: number, ryAngle = 0): Geo {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const cRY = Math.cos(ryAngle), sRY = Math.sin(ryAngle);
  for (let i = 0; i <= segPath; i++) {
    const u = (2 * Math.PI * i) / segPath;
    const cu = Math.cos(u), su = Math.sin(u);
    // Path point on ellipse
    const px = Rx * cu, py = Ry * su;
    // Frame normal: inward (toward ring center), used as tube e1
    const pLen = Math.sqrt(px * px + py * py);
    const fnx = -px / pLen, fny = -py / pLen;
    // Binormal e2 = (0,0,1) for XY-plane curve
    for (let j = 0; j <= segTube; j++) {
      const v = (2 * Math.PI * j) / segTube;
      const cv = Math.cos(v), sv = Math.sin(v);
      const x0 = px + r * cv * fnx;
      const y0 = py + r * cv * fny;
      const z0 = r * sv;
      const nnx = cv * fnx, nny = cv * fny, nnz = sv;
      pos.push(x0 * cRY - z0 * sRY + tx, y0 + ty, x0 * sRY + z0 * cRY + tz);
      nor.push(nnx * cRY - nnz * sRY, nny, nnx * sRY + nnz * cRY);
    }
  }
  for (let i = 0; i < segPath; i++) {
    for (let j = 0; j < segTube; j++) {
      const a = i * (segTube + 1) + j, b = a + segTube + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { pos, nor, idx };
}

function mergeGeo(...geos: Geo[]) {
  const ap: number[] = [], an: number[] = [], ai: number[] = [];
  let off = 0;
  for (const g of geos) {
    ap.push(...g.pos); an.push(...g.nor);
    ai.push(...g.idx.map(i => i + off));
    off += g.pos.length / 3;
  }
  return { positions: new Float32Array(ap), normals: new Float32Array(an), indices: new Uint16Array(ai) };
}

// ── Chrome matcap (generated, no external file) ───────────────────────────────

function makeMatcap(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px / (size - 1)) * 2 - 1;
      const ny = 1 - (py / (size - 1)) * 2;
      const i = (py * size + px) * 4;
      if (nx * nx + ny * ny > 1) { data[i + 3] = 0; continue; }

      // Primary specular: bright hotspot top-left
      const hd = Math.sqrt((nx + 0.30) * (nx + 0.30) + (ny - 0.42) * (ny - 0.42));
      const spec = Math.pow(Math.max(0, 1 - hd * 1.4), 2.2);

      // Secondary fill: softer bottom-right bounce
      const hd2 = Math.sqrt((nx - 0.38) * (nx - 0.38) + (ny + 0.50) * (ny + 0.50));
      const spec2 = Math.pow(Math.max(0, 1 - hd2 * 2.6), 3.0);

      // Chrome environment: bright top, DARK equatorial band, medium bottom
      const topBright  = Math.max(0, ny) * 150;
      const darkEquator = Math.exp(-(ny * ny) * 10) * 80;   // pinch dark band at center
      const bottomFill = Math.max(0, -ny - 0.15) * 90;

      const base = Math.max(0, 30 + topBright - darkEquator + bottomFill);
      const val  = base + spec * 255 + spec2 * 75;

      data[i]     = Math.min(255, val);
      data[i + 1] = Math.min(255, val + 2);
      data[i + 2] = Math.min(255, val + 12);   // faint blue-white chrome cast
      data[i + 3] = 255;
    }
  }
  return data;
}

// ── Shaders ───────────────────────────────────────────────────────────────────

const VS = `
  attribute vec3 a_pos;
  attribute vec3 a_nor;
  uniform mat4 u_mvp;
  uniform mat4 u_mv;
  varying vec2 v_uv;
  void main() {
    vec3 vn = normalize(mat3(u_mv[0].xyz, u_mv[1].xyz, u_mv[2].xyz) * a_nor);
    v_uv = vn.xy * 0.5 + 0.5;
    gl_Position = u_mvp * vec4(a_pos, 1.0);
  }
`;

const FS = `
  precision mediump float;
  uniform sampler2D u_mc;
  varying vec2 v_uv;
  void main() {
    gl_FragColor = texture2D(u_mc, v_uv);
  }
`;

// ── Week 3: Chrome chain ──────────────────────────────────────────────────────
// Interlocking oval links. GAP = Ry so each link's top arc passes through
// the center of the next link — true geometric interlocking.
// Even links: face-on (ring in XY plane). Odd links: rotY(π/2) → edge-on.

function buildWeek3Geo() {
  const RX = 0.30;   // link half-width
  const RY = 0.72;   // link half-height (elongated — ~2.4× taller than wide)
  const TUBE = 0.10; // tube radius
  const GAP = RY;    // spacing = major radius → interlocking
  const N = 6;
  const centerY = (N - 1) * GAP / 2;
  return mergeGeo(...Array.from({ length: N }, (_, i) =>
    ellipseTubeGeo(RX, RY, TUBE, 36, 14, 0, i * GAP - centerY, 0,
                   i % 2 === 1 ? Math.PI / 2 : 0)
  ));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WeeklyBgShape({ week }: { week: number }) {
  const rafRef = useRef<number>(0);

  const onContextCreate = useCallback((gl: any) => {
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;

    // Compile shader
    function compile(type: number, src: string) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s); return s;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog); gl.useProgram(prog);

    // Geometry
    const geo = week === 3 ? buildWeek3Geo() : null;
    if (!geo) return;
    const indexCount = geo.indices.length;

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geo.positions, gl.STATIC_DRAW);

    const norBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, norBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geo.normals, gl.STATIC_DRAW);

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, 'a_pos');
    const aNor = gl.getAttribLocation(prog, 'a_nor');
    const uMVP = gl.getUniformLocation(prog, 'u_mvp');
    const uMV  = gl.getUniformLocation(prog, 'u_mv');
    const uMC  = gl.getUniformLocation(prog, 'u_mc');

    // Matcap texture
    const mcData = makeMatcap(128);
    const mcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, mcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, mcData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Matrices (all column-major)
    const proj = new Float32Array(16), view = new Float32Array(16);
    const rx = new Float32Array(16), ry = new Float32Array(16);
    const model = new Float32Array(16), mv = new Float32Array(16), mvp = new Float32Array(16);

    perspective(proj, 0.75, W/H, 0.1, 100);
    lookAt(view, 0, 0, 8);         // centred, slightly further back for chain height
    rotX(rx, 0.12);                // slight forward tilt to show link depth

    gl.enable(gl.DEPTH_TEST);
    gl.viewport(0, 0, W, H);

    let angle = 0;

    function render() {
      rafRef.current = requestAnimationFrame(render);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      angle += 0.007;
      rotY(ry, angle);
      mul(model, rx, ry);
      mul(mv, view, model);
      mul(mvp, proj, mv);

      gl.uniformMatrix4fv(uMVP, false, mvp);
      gl.uniformMatrix4fv(uMV,  false, mv);
      gl.uniform1i(uMC, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, norBuf);
      gl.enableVertexAttribArray(aNor);
      gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, mcTex);

      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
      gl.endFrameEXP();
    }

    render();
  }, [week]);

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); }, []);

  if (week < 3) return null;

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.22 }}>
      <GLView style={{ flex: 1 }} onContextCreate={onContextCreate} />
    </View>
  );
}
