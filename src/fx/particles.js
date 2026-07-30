// ASHFALL — fx/particles.js
// Pooled, allocation-free combat FX: muzzle flash, tracers, surface impacts,
// bullet-hole decals, brass casings, smoke columns, debris, small explosions.
// Everything procedural. GPU-instanced billboards/beams, CPU sim over flat
// Float32Array pools, zero per-frame allocation after construction.

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* module-scope temporaries (reused, never allocated per frame)        */
/* ------------------------------------------------------------------ */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _eul = new THREE.Euler();
const _qt = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _col = new THREE.Color();

const rand = (a, b) => a + Math.random() * (b - a);
const nrand = () => Math.random() * 2 - 1;

/* ------------------------------------------------------------------ */
/* procedural sprite textures                                          */
/* ------------------------------------------------------------------ */
function canvasTex(size, h, draw) {
  const c = document.createElement('canvas');
  c.width = size; c.height = h || size;
  draw(c.getContext('2d'), c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// clean radial glow, quadratic falloff
function makeGlowTexture() {
  return canvasTex(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.16)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

// lumpy smoke puff — union of soft blobs, edge forced to zero
function makePuffTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * 30;
      const bx = cx + Math.cos(a) * rr, by = cy + Math.sin(a) * rr;
      const br = rand(16, 40);
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      const al = rand(0.10, 0.22);
      g.addColorStop(0, `rgba(255,255,255,${al})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
    }
    // guarantee soft closed edge
    ctx.globalCompositeOperation = 'destination-in';
    const m = ctx.createRadialGradient(cx, cy, 0, cx, cy, 62);
    m.addColorStop(0, 'rgba(255,255,255,1)');
    m.addColorStop(0.62, 'rgba(255,255,255,0.85)');
    m.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = m;
    ctx.fillRect(0, 0, w, h);
  });
}

// muzzle star: hot white core + a few short FAT petals (reads as burning
// propellant gas at the crown, not a thin-rayed lens flare). At most two
// petals run slightly longer as brief spikes.
function makeStarTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    ctx.globalCompositeOperation = 'lighter';
    const petals = 6;
    const base = Math.random() * Math.PI;
    for (let i = 0; i < petals; i++) {
      const a = base + (i / petals) * Math.PI * 2 + nrand() * 0.26;
      // short fat petals; only two get a modestly longer spike
      const len = (i % 3 === 0) ? rand(20, 25) : rand(11, 18);
      const wd = rand(9, 15);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, 'rgba(255,246,226,0.95)');
      g.addColorStop(0.45, 'rgba(255,196,116,0.5)');
      g.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.fillStyle = g;
      // rounded petal: fat base, blunt tip
      ctx.beginPath();
      ctx.moveTo(0, -wd);
      ctx.quadraticCurveTo(len * 0.75, -wd * 0.55, len, 0);
      ctx.quadraticCurveTo(len * 0.75, wd * 0.55, 0, wd);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // hot white core
    let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 20);
    g.addColorStop(0, 'rgba(255,255,252,1)');
    g.addColorStop(0.45, 'rgba(255,222,164,0.8)');
    g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2); ctx.fill();
    // very tight faint halo just to soften petal roots
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 32);
    g.addColorStop(0, 'rgba(255,190,110,0.16)');
    g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, 32, 0, Math.PI * 2); ctx.fill();
  });
}

// horizontal streak for velocity-stretched sparks
function makeStreakTexture() {
  const w = 64, hgt = 16;
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, hgt);
  const d = img.data;
  for (let y = 0; y < hgt; y++) {
    const fy = ((y + 0.5) / hgt) * 2 - 1;
    const gy = Math.exp(-fy * fy * 7) + 0.22 * Math.exp(-fy * fy * 1.6);
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / w;
      const ex = Math.pow(Math.sin(Math.PI * fx), 1.15);
      const a = Math.min(1, gy * ex);
      const o = (y * w + x) * 4;
      d[o] = 255; d[o + 1] = 255; d[o + 2] = 255;
      d[o + 3] = (a * 255) | 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

// tracer beam: narrow white-hot line inside a soft warm halo, faded ends
function makeTracerTexture() {
  const w = 128, hgt = 16;
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, hgt);
  const d = img.data;
  for (let y = 0; y < hgt; y++) {
    const fy = ((y + 0.5) / hgt) * 2 - 1;
    const core = Math.exp(-fy * fy * 22);
    const halo = 0.4 * Math.exp(-fy * fy * 3.2);
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / w;
      const ex = Math.min(1, Math.sin(Math.PI * fx) * 2.4);
      const a = Math.min(1, (core + halo) * ex);
      const o = (y * w + x) * 4;
      // slightly warm halo, white core
      d[o] = 255;
      d[o + 1] = (255 * (0.86 + 0.14 * core)) | 0;
      d[o + 2] = (255 * (0.66 + 0.34 * core)) | 0;
      d[o + 3] = (a * 255) | 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

// ragged dark bullet hole with chipped rim + faint scorch halo
function makeHoleTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s);
  const d = img.data;
  const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28, p3 = Math.random() * 6.28;
  const R = 20;
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x - s / 2 + 0.5, dy = y - s / 2 + 0.5;
      const th = Math.atan2(dy, dx);
      const e = 1 + 0.17 * Math.sin(3 * th + p1) + 0.11 * Math.sin(7 * th + p2) + 0.07 * Math.sin(11 * th + p3);
      const r = Math.sqrt(dx * dx + dy * dy) / (R * e);
      const hole = 1 - smooth(0.55, 1.05, r);
      const scorch = 0.34 * (1 - smooth(0.85, 1.5, r));
      const a = Math.max(hole, scorch);
      // dark pit center, slightly lighter chipped rim, near-black scorch
      let v = 10 + 46 * smooth(0.15, 0.85, r) * hole + (Math.random() * 8 - 4);
      if (scorch > hole) v = 16;
      const o = (y * s + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = Math.max(0, v | 0);
      d[o + 3] = Math.min(255, (a * 255) | 0);
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

/* ------------------------------------------------------------------ */
/* shaders                                                             */
/* ------------------------------------------------------------------ */
const FRAG = `
uniform sampler2D uMap;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec2 vUv;
varying vec4 vCol;
varying float vFog;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vCol.a;
  if (a < 0.004) discard;
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vFog * vFog);
  vec3 col = t.rgb * vCol.rgb;
#ifdef ADDITIVE
  gl_FragColor = vec4(col * (1.0 - f), a);
#else
  gl_FragColor = vec4(mix(col, uFogColor, f), a);
#endif
}`;

const VERT_BILLBOARD = `
attribute vec3 aPos;
attribute vec2 aAux;   // x: size, y: rotation
attribute vec4 aCol;
varying vec2 vUv;
varying vec4 vCol;
varying float vFog;
void main() {
  vUv = uv;
  vCol = aCol;
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  float c = cos(aAux.y), s = sin(aAux.y);
  vec2 p = position.xy * aAux.x;
  mv.xy += vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const VERT_STRETCH = `
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec2 aAux;   // x: length, y: thickness
attribute vec4 aCol;
varying vec2 vUv;
varying vec4 vCol;
varying float vFog;
void main() {
  vUv = uv;
  vCol = aCol;
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  vec3 vv = mat3(modelViewMatrix) * aVel;
  vec2 d = vv.xy;
  float l = length(d);
  d = l > 1e-4 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  mv.xy += d * (position.x * aAux.x) + n * (position.y * aAux.y);
  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const VERT_BEAM = `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec4 aCol;
attribute float aW;
varying vec2 vUv;
varying vec4 vCol;
varying float vFog;
void main() {
  vUv = uv;
  vCol = aCol;
  vec3 s = (modelViewMatrix * vec4(aStart, 1.0)).xyz;
  vec3 e = (modelViewMatrix * vec4(aEnd, 1.0)).xyz;
  vec3 p = mix(s, e, position.x + 0.5);
  vec3 ax = e - s;
  vec3 side = cross(ax, p);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
  p += side * (position.y * aW);
  vFog = -p.z;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;

const VERT_DECAL = `
attribute vec3 aPos;
attribute vec3 aT;
attribute vec3 aB;
attribute float aA;
varying vec2 vUv;
varying vec4 vCol;
varying float vFog;
void main() {
  vUv = uv;
  vCol = vec4(1.0, 1.0, 1.0, aA);
  vec3 wp = aPos + aT * position.x + aB * position.y;
  vec4 mv = modelViewMatrix * vec4(wp, 1.0);
  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

function quadGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  // CCW winding for the bottom-up vertex layout below — the PlaneGeometry
  // index pattern [0,2,1, 2,3,1] assumes top-down rows and would wind these
  // vertices clockwise, so every quad gets backface-culled and never renders.
  g.setIndex([0, 1, 2, 2, 1, 3]);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0, 1, 0, 0, 1, 1, 1]), 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

function dynAttr(geo, name, cap, itemSize) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * itemSize), itemSize);
  a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute(name, a);
  return a;
}

function touch(attr, count, itemSize) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count * itemSize);
  attr.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* sprite particle pool (billboard or velocity-stretched)              */
/* ------------------------------------------------------------------ */
// record: 0-2 pos | 3-5 vel | 6 age | 7 life | 8 size0 | 9 size1
//         10 rot | 11 rotVel | 12-14 rgb (or brightness in 12 for heat)
//         15 alpha | 16 gravity | 17 drag | 18 fadeIn frac
//         19 fadePow (billboard) / lenMul (stretch)
const PSTRIDE = 20;

// spark heat ramp (hot white -> amber -> dull ember), HDR-ish for bloom
const HR0 = [2.5, 2.25, 1.85], HR1 = [2.1, 1.05, 0.34], HR2 = [0.8, 0.19, 0.05];

class SpritePool {
  constructor(scene, cap, texture, { additive = false, stretch = false, heat = false, renderOrder = 20, fogU }) {
    this.cap = cap;
    this.n = 0;
    this.stretch = stretch;
    this.heat = heat;
    this.data = new Float32Array(cap * PSTRIDE);
    const geo = this.geo = quadGeometry();
    this.aPos = dynAttr(geo, 'aPos', cap, 3);
    this.aAux = dynAttr(geo, 'aAux', cap, 2);
    this.aCol = dynAttr(geo, 'aCol', cap, 4);
    this.aVel = stretch ? dynAttr(geo, 'aVel', cap, 3) : null;
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uFogColor: fogU.color, uFogDensity: fogU.density },
      vertexShader: stretch ? VERT_STRETCH : VERT_BILLBOARD,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    if (additive) mat.defines = { ADDITIVE: 1 };
    const mesh = this.mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    mesh.visible = false;
    scene.add(mesh);
  }

  spawn(px, py, pz, vx, vy, vz, life, s0, s1, rot, rotVel, r, g, b, alpha, grav, drag, fadeIn, p19) {
    if (this.n >= this.cap) return;
    const d = this.data, o = this.n++ * PSTRIDE;
    d[o] = px; d[o + 1] = py; d[o + 2] = pz;
    d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = 0; d[o + 7] = life;
    d[o + 8] = s0; d[o + 9] = s1;
    d[o + 10] = rot; d[o + 11] = rotVel;
    d[o + 12] = r; d[o + 13] = g; d[o + 14] = b;
    d[o + 15] = alpha; d[o + 16] = grav; d[o + 17] = drag;
    d[o + 18] = fadeIn; d[o + 19] = p19;
  }

  update(dt) {
    const d = this.data, S = PSTRIDE;
    const pa = this.aPos.array, xa = this.aAux.array, ca = this.aCol.array;
    const va = this.aVel ? this.aVel.array : null;
    const stretch = this.stretch, heat = this.heat;
    let n = this.n, i = 0;
    while (i < n) {
      const o = i * S;
      const age = d[o + 6] + dt;
      const life = d[o + 7];
      if (age >= life) {
        n--;
        if (i !== n) d.copyWithin(o, n * S, n * S + S);
        continue;
      }
      d[o + 6] = age;
      let vx = d[o + 3], vy = d[o + 4] - d[o + 16] * dt, vz = d[o + 5];
      const drag = d[o + 17];
      if (drag > 0) {
        const m = Math.max(0, 1 - drag * dt);
        vx *= m; vy *= m; vz *= m;
      }
      d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
      const px = d[o] + vx * dt, py = d[o + 1] + vy * dt, pz = d[o + 2] + vz * dt;
      d[o] = px; d[o + 1] = py; d[o + 2] = pz;

      const t = age / life;
      const fi = d[o + 18];
      let a = d[o + 15];
      if (fi > 0) {
        const ein = age / (fi * life);
        if (ein < 1) a *= ein;
      }
      const j3 = i * 3, j2 = i * 2, j4 = i * 4;
      pa[j3] = px; pa[j3 + 1] = py; pa[j3 + 2] = pz;
      const inv = 1 - t;
      if (stretch) {
        a *= inv * Math.sqrt(inv); // pow 1.5
        const spd = Math.sqrt(vx * vx + vy * vy + vz * vz);
        va[j3] = vx; va[j3 + 1] = vy; va[j3 + 2] = vz;
        const len = spd * d[o + 19];
        xa[j2] = len > 0.02 ? len : 0.02;
        xa[j2 + 1] = d[o + 8] + (d[o + 9] - d[o + 8]) * t;
      } else {
        a *= Math.pow(inv, d[o + 19]);
        const grow = 1 - inv * inv;
        xa[j2] = d[o + 8] + (d[o + 9] - d[o + 8]) * grow;
        const rot = d[o + 10] + d[o + 11] * dt;
        d[o + 10] = rot;
        xa[j2 + 1] = rot;
      }
      if (heat) {
        const br = d[o + 12];
        let cr, cg, cb;
        if (t < 0.32) {
          const k = t / 0.32;
          cr = HR0[0] + (HR1[0] - HR0[0]) * k;
          cg = HR0[1] + (HR1[1] - HR0[1]) * k;
          cb = HR0[2] + (HR1[2] - HR0[2]) * k;
        } else {
          const k = (t - 0.32) / 0.68;
          cr = HR1[0] + (HR2[0] - HR1[0]) * k;
          cg = HR1[1] + (HR2[1] - HR1[1]) * k;
          cb = HR1[2] + (HR2[2] - HR1[2]) * k;
        }
        ca[j4] = cr * br; ca[j4 + 1] = cg * br; ca[j4 + 2] = cb * br;
      } else {
        ca[j4] = d[o + 12]; ca[j4 + 1] = d[o + 13]; ca[j4 + 2] = d[o + 14];
      }
      ca[j4 + 3] = a;
      i++;
    }
    this.n = n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      touch(this.aPos, n, 3);
      touch(this.aAux, n, 2);
      touch(this.aCol, n, 4);
      if (va) touch(this.aVel, n, 3);
    }
  }
}

/* ------------------------------------------------------------------ */
/* tracer beam pool                                                    */
/* ------------------------------------------------------------------ */
// record: 0-2 start | 3-5 end | 6 age | 7 life | 8 width | 9-11 rgb
const TSTRIDE = 12;

class TracerPool {
  constructor(scene, cap, texture, fogU) {
    this.cap = cap;
    this.n = 0;
    this.data = new Float32Array(cap * TSTRIDE);
    const geo = this.geo = quadGeometry();
    this.aStart = dynAttr(geo, 'aStart', cap, 3);
    this.aEnd = dynAttr(geo, 'aEnd', cap, 3);
    this.aCol = dynAttr(geo, 'aCol', cap, 4);
    this.aW = dynAttr(geo, 'aW', cap, 1);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uFogColor: fogU.color, uFogDensity: fogU.density },
      vertexShader: VERT_BEAM,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      defines: { ADDITIVE: 1 },
    });
    const mesh = this.mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 33;
    mesh.visible = false;
    scene.add(mesh);
  }

  spawn(fx0, fy0, fz0, tx, ty, tz, life, width, r, g, b) {
    if (this.n >= this.cap) return;
    const d = this.data, o = this.n++ * TSTRIDE;
    d[o] = fx0; d[o + 1] = fy0; d[o + 2] = fz0;
    d[o + 3] = tx; d[o + 4] = ty; d[o + 5] = tz;
    d[o + 6] = 0; d[o + 7] = life; d[o + 8] = width;
    d[o + 9] = r; d[o + 10] = g; d[o + 11] = b;
  }

  update(dt) {
    const d = this.data, S = TSTRIDE;
    const sa = this.aStart.array, ea = this.aEnd.array, ca = this.aCol.array, wa = this.aW.array;
    let n = this.n, i = 0;
    while (i < n) {
      const o = i * S;
      const age = d[o + 6] + dt;
      if (age >= d[o + 7]) {
        n--;
        if (i !== n) d.copyWithin(o, n * S, n * S + S);
        continue;
      }
      d[o + 6] = age;
      const t = age / d[o + 7];
      const a = Math.pow(1 - t, 1.3);
      const j3 = i * 3, j4 = i * 4;
      sa[j3] = d[o]; sa[j3 + 1] = d[o + 1]; sa[j3 + 2] = d[o + 2];
      ea[j3] = d[o + 3]; ea[j3 + 1] = d[o + 4]; ea[j3 + 2] = d[o + 5];
      ca[j4] = d[o + 9]; ca[j4 + 1] = d[o + 10]; ca[j4 + 2] = d[o + 11];
      ca[j4 + 3] = a;
      wa[i] = d[o + 8] * (1 - 0.45 * t);
      i++;
    }
    this.n = n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      touch(this.aStart, n, 3);
      touch(this.aEnd, n, 3);
      touch(this.aCol, n, 4);
      touch(this.aW, n, 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/* bullet-hole decal pool (ring buffer, oldest overwritten)            */
/* ------------------------------------------------------------------ */
class DecalPool {
  constructor(scene, cap, texture, fogU) {
    this.cap = cap;
    this.head = 0;
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.life.fill(-1); // inactive
    const geo = this.geo = quadGeometry();
    this.aPos = dynAttr(geo, 'aPos', cap, 3);
    this.aT = dynAttr(geo, 'aT', cap, 3);
    this.aB = dynAttr(geo, 'aB', cap, 3);
    this.aA = dynAttr(geo, 'aA', cap, 1);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uFogColor: fogU.color, uFogDensity: fogU.density },
      vertexShader: VERT_DECAL,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    const mesh = this.mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 4;
    mesh.visible = false;
    scene.add(mesh);
  }

  spawn(px, py, pz, nx, ny, nz, size) {
    const i = this.head % this.cap;
    this.head++;
    this.age[i] = 0;
    this.life[i] = rand(19, 23);
    _v1.set(nx, ny, nz).normalize();
    if (Math.abs(_v1.y) < 0.8) _v2.set(0, 1, 0); else _v2.set(1, 0, 0);
    _v3.crossVectors(_v2, _v1).normalize(); // tangent
    _v2.crossVectors(_v1, _v3);             // bitangent
    const th = Math.random() * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
    // rolled basis, scaled to decal width
    const tx = (_v3.x * c + _v2.x * s) * size, tyy = (_v3.y * c + _v2.y * s) * size, tz = (_v3.z * c + _v2.z * s) * size;
    const bx = (_v2.x * c - _v3.x * s) * size, by = (_v2.y * c - _v3.y * s) * size, bz = (_v2.z * c - _v3.z * s) * size;
    const j = i * 3;
    const pa = this.aPos.array, ta = this.aT.array, ba = this.aB.array;
    pa[j] = px + _v1.x * 0.006; pa[j + 1] = py + _v1.y * 0.006; pa[j + 2] = pz + _v1.z * 0.006;
    ta[j] = tx; ta[j + 1] = tyy; ta[j + 2] = tz;
    ba[j] = bx; ba[j + 1] = by; ba[j + 2] = bz;
    const count = Math.min(this.head, this.cap);
    touch(this.aPos, count, 3);
    touch(this.aT, count, 3);
    touch(this.aB, count, 3);
  }

  update(dt) {
    const count = Math.min(this.head, this.cap);
    this.geo.instanceCount = count;
    this.mesh.visible = count > 0;
    if (count === 0) return;
    const aa = this.aA.array;
    for (let i = 0; i < count; i++) {
      if (this.life[i] < 0) { aa[i] = 0; continue; }
      const age = this.age[i] + dt;
      this.age[i] = age;
      const rem = this.life[i] - age;
      if (rem <= 0) { this.life[i] = -1; aa[i] = 0; continue; }
      aa[i] = 0.92 * (rem < 3 ? rem / 3 : 1);
    }
    touch(this.aA, count, 1);
  }
}

/* ------------------------------------------------------------------ */
/* rigid chunk pool (casings, debris) — InstancedMesh, gravity+bounce  */
/* ------------------------------------------------------------------ */
// record: 0-2 pos | 3-5 vel | 6-8 euler | 9-11 angVel | 12-14 scale
//         15 age | 16 life | 17 bounced | 18 halfHeight | 19 restitution
const CSTRIDE = 20;

class ChunkPool {
  constructor(scene, cap, geometry, material, useColor) {
    this.cap = cap;
    this.n = 0;
    this.data = new Float32Array(cap * CSTRIDE);
    const mesh = this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (useColor) {
      _col.setRGB(1, 1, 1);
      for (let i = 0; i < cap; i++) mesh.setColorAt(i, _col);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    this.colorDirty = false;
  }

  spawn(px, py, pz, vx, vy, vz, wx, wy, wz, sx, sy, sz, life, half, rest, r, g, b) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    const d = this.data, o = i * CSTRIDE;
    d[o] = px; d[o + 1] = py; d[o + 2] = pz;
    d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = Math.random() * 6.28; d[o + 7] = Math.random() * 6.28; d[o + 8] = Math.random() * 6.28;
    d[o + 9] = wx; d[o + 10] = wy; d[o + 11] = wz;
    d[o + 12] = sx; d[o + 13] = sy; d[o + 14] = sz;
    d[o + 15] = 0; d[o + 16] = life; d[o + 17] = 0;
    d[o + 18] = half; d[o + 19] = rest;
    if (this.mesh.instanceColor) {
      const ca = this.mesh.instanceColor.array, j = i * 3;
      ca[j] = r; ca[j + 1] = g; ca[j + 2] = b;
      this.colorDirty = true;
    }
  }

  update(dt) {
    const d = this.data, S = CSTRIDE;
    const mesh = this.mesh;
    const ca = mesh.instanceColor ? mesh.instanceColor.array : null;
    let n = this.n, i = 0;
    while (i < n) {
      const o = i * S;
      const age = d[o + 15] + dt;
      if (age >= d[o + 16]) {
        n--;
        if (i !== n) {
          d.copyWithin(o, n * S, n * S + S);
          if (ca) { ca.copyWithin(i * 3, n * 3, n * 3 + 3); this.colorDirty = true; }
        }
        continue;
      }
      d[o + 15] = age;
      let vx = d[o + 3], vy = d[o + 4] - 11.5 * dt, vz = d[o + 5];
      let py = d[o + 1] + vy * dt;
      const half = d[o + 18];
      if (py - half < 0 && vy < 0) {
        py = half;
        if (!d[o + 17]) {
          vy = -vy * d[o + 19];
          vx *= 0.55; vz *= 0.55;
          d[o + 9] *= 0.5; d[o + 10] *= 0.5; d[o + 11] *= 0.5;
          d[o + 17] = 1;
        } else {
          vy = 0;
          const f = Math.max(0, 1 - 9 * dt);
          vx *= f; vz *= f;
          const wf = Math.max(0, 1 - 7 * dt);
          d[o + 9] *= wf; d[o + 10] *= wf; d[o + 11] *= wf;
        }
      }
      d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
      const px = d[o] + vx * dt, pz2 = d[o + 2] + vz * dt;
      d[o] = px; d[o + 1] = py; d[o + 2] = pz2;
      const ex = d[o + 6] + d[o + 9] * dt, ey = d[o + 7] + d[o + 10] * dt, ez = d[o + 8] + d[o + 11] * dt;
      d[o + 6] = ex; d[o + 7] = ey; d[o + 8] = ez;
      const t = age / d[o + 16];
      // scale-out over the last ~30% of life (~0.4s for casings) — no pop
      let k = (1 - t) / 0.3;
      if (k > 1) k = 1;
      _eul.set(ex, ey, ez);
      _qt.setFromEuler(_eul);
      _pos.set(px, py, pz2);
      _scl.set(d[o + 12] * k, d[o + 13] * k, d[o + 14] * k);
      _mat.compose(_pos, _qt, _scl);
      mesh.setMatrixAt(i, _mat);
      i++;
    }
    this.n = n;
    mesh.count = n;
    mesh.visible = n > 0;
    if (n > 0) mesh.instanceMatrix.needsUpdate = true;
    if (ca && this.colorDirty) {
      mesh.instanceColor.needsUpdate = true;
      this.colorDirty = false;
    }
  }
}

/* ------------------------------------------------------------------ */
/* pooled muzzle point lights                                          */
/* ------------------------------------------------------------------ */
class LightPool {
  constructor(scene, cap) {
    this.cap = cap;
    this.idx = 0;
    this.lights = [];
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.peak = new Float32Array(cap);
    for (let i = 0; i < cap; i++) {
      const l = new THREE.PointLight(0xffc36a, 0, 9, 2.1);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
      this.life[i] = 0;
    }
  }

  flash(x, y, z, peak, life) {
    const i = this.idx;
    this.idx = (i + 1) % this.cap;
    this.lights[i].position.set(x, y, z);
    this.age[i] = 0;
    this.life[i] = life;
    this.peak[i] = peak;
  }

  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      const age = this.age[i] + dt;
      this.age[i] = age;
      if (age >= this.life[i]) {
        this.life[i] = 0;
        this.lights[i].intensity = 0;
        continue;
      }
      const k = 1 - age / this.life[i];
      this.lights[i].intensity = this.peak[i] * k * k * k;
    }
  }
}

/* ------------------------------------------------------------------ */
/* createFX                                                            */
/* ------------------------------------------------------------------ */
export function createFX({ scene, camera }) {
  // shared fog uniforms (synced from scene.fog each frame)
  const fogU = {
    color: { value: new THREE.Color(0xb9c0c4) },
    density: { value: 0.011 },
  };

  const texGlow = makeGlowTexture();
  const texPuff = makePuffTexture();
  const texStar = makeStarTexture();
  const texStreak = makeStreakTexture();
  const texTracer = makeTracerTexture();
  const texHole = makeHoleTexture();

  // pools -----------------------------------------------------------
  const smoke = new SpritePool(scene, 384, texPuff, { renderOrder: 20, fogU });
  const glows = new SpritePool(scene, 48, texGlow, { additive: true, renderOrder: 30, fogU });
  const flashes = new SpritePool(scene, 24, texStar, { additive: true, renderOrder: 31, fogU });
  const sparks = new SpritePool(scene, 320, texStreak, { additive: true, stretch: true, heat: true, renderOrder: 32, fogU });
  const tracers = new TracerPool(scene, 64, texTracer, fogU);
  const decals = new DecalPool(scene, 60, texHole, fogU);
  const lights = new LightPool(scene, 4);

  // realistic 5.56x45 brass scale — small, non-emissive, glints not glows
  const casingGeo = new THREE.CylinderGeometry(0.0045, 0.004, 0.045, 7, 1);
  const casingMat = new THREE.MeshStandardMaterial({
    color: 0x7a6128, metalness: 0.85, roughness: 0.4,
  });
  const casings = new ChunkPool(scene, 40, casingGeo, casingMat, false);

  const debrisGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const debrisMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.96, metalness: 0.02, flatShading: true,
  });
  const chunks = new ChunkPool(scene, 96, debrisGeo, debrisMat, true);

  // persistent smoke column emitters ---------------------------------
  const COLS = 8;
  const colData = new Float32Array(COLS * 5); // x,y,z,timer,active
  let colIdx = 0;

  // helpers -----------------------------------------------------------
  function lodScale(px, py, pz) {
    const dx = camera.position.x - px, dy = camera.position.y - py, dz = camera.position.z - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    return d2 < 900 ? 1 : d2 < 3600 ? 0.55 : 0.3;
  }

  function burstSparks(px, py, pz, nx, ny, nz, count, spdMin, spdMax, lifeMin, lifeMax, thick, brightness, grav, lenMul, spread) {
    for (let k = 0; k < count; k++) {
      let dx = nx * (0.45 + Math.random()) + nrand() * spread;
      let dy = ny * (0.45 + Math.random()) + nrand() * spread;
      let dz = nz * (0.45 + Math.random()) + nrand() * spread;
      const il = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6);
      const spd = rand(spdMin, spdMax) * il;
      dx *= spd; dy *= spd; dz *= spd;
      sparks.spawn(px, py, pz, dx, dy, dz, rand(lifeMin, lifeMax),
        thick, thick * 0.6, 0, 0, brightness, 0, 0, 1, grav, 2.4, 0, lenMul);
    }
  }

  function dustPuffs(px, py, pz, nx, ny, nz, count, r, g, b, alpha, s0, s1, lifeMin, lifeMax, spd, grav) {
    for (let k = 0; k < count; k++) {
      const vx = nx * spd * (0.5 + Math.random()) + nrand() * spd * 0.55;
      const vy = ny * spd * (0.5 + Math.random()) + nrand() * spd * 0.4 + 0.25;
      const vz = nz * spd * (0.5 + Math.random()) + nrand() * spd * 0.55;
      const j = rand(0.8, 1.25);
      smoke.spawn(
        px + nrand() * 0.03, py + nrand() * 0.03, pz + nrand() * 0.03,
        vx, vy, vz, rand(lifeMin, lifeMax), s0 * j, s1 * j,
        Math.random() * 6.28, nrand() * 2.2,
        r * rand(0.9, 1.1), g * rand(0.9, 1.1), b * rand(0.9, 1.1),
        alpha, grav, 1.6, 0.07, 1.15);
    }
  }

  function chipBurst(px, py, pz, nx, ny, nz, count, sMin, sMax, spdMin, spdMax, life, r, g, b) {
    for (let k = 0; k < count; k++) {
      let dx = nx * (0.5 + Math.random()) + nrand() * 0.85;
      let dy = ny * (0.5 + Math.random()) + nrand() * 0.85 + 0.3;
      let dz = nz * (0.5 + Math.random()) + nrand() * 0.85;
      const il = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6);
      const spd = rand(spdMin, spdMax) * il;
      const s = rand(sMin, sMax);
      chunks.spawn(px, py, pz, dx * spd, dy * spd, dz * spd,
        nrand() * 22, nrand() * 22, nrand() * 22,
        s * rand(0.7, 1.3), s * rand(0.55, 1.1), s * rand(0.7, 1.3),
        rand(0.8, life), s * 0.5, 0.3,
        r * rand(0.85, 1.1), g * rand(0.85, 1.1), b * rand(0.85, 1.1));
    }
  }

  /* ------------------------------------------------------------ API */

  function muzzleFlash(pos, dir) {
    const px = pos.x + dir.x * 0.03, py = pos.y + dir.y * 0.03, pz = pos.z + dir.z * 0.03;
    const j = rand(0.75, 1.25);
    // small tight cluster at the barrel tip (~60-90px at hip-fire on 1600px),
    // quadratic opacity falloff, 2-3 frame life
    flashes.spawn(px, py, pz, 0, 0, 0, 0.05, 0.13 * j, 0.10 * j,
      Math.random() * 6.28, 0, 1.7, 1.4, 1.05, 0.95, 0, 0, 0, 2.0);
    // secondary smaller star, opposite roll — reads as flash "shape noise"
    flashes.spawn(px + dir.x * 0.02, py + dir.y * 0.02, pz + dir.z * 0.02,
      0, 0, 0, 0.038, 0.08 * j, 0.06 * j,
      Math.random() * 6.28, 0, 1.8, 1.55, 1.2, 0.9, 0, 0, 0, 2.0);
    // small warm glow kissing the crown — capped hard so it never projects a
    // halo disc over the scene (<=0.25 peak alpha, quadratic fade)
    glows.spawn(px, py, pz, 0, 0, 0, 0.06, 0.16 * j, 0.18 * j,
      0, 0, 1.25, 0.85, 0.45, 0.25, 0, 0, 0, 2.0);
    // flame tongues shooting forward
    for (let k = 0; k < 2; k++) {
      const s = rand(9, 14);
      sparks.spawn(px, py, pz,
        dir.x * s + nrand() * 1.6, dir.y * s + nrand() * 1.6, dir.z * s + nrand() * 1.6,
        rand(0.04, 0.06), 0.016, 0.010, 0, 0, 1.0, 0, 0, 1, 0, 0, 0, 0.017);
    }
    // fast tiny sparks
    for (let k = 0; k < 3; k++) {
      const s = rand(6, 13);
      sparks.spawn(px, py, pz,
        dir.x * s + nrand() * 2.2, dir.y * s + nrand() * 2.2 + 0.5, dir.z * s + nrand() * 2.2,
        rand(0.07, 0.16), 0.009, 0.005, 0, 0, 0.9, 0, 0, 1, 7, 1.6, 0, 0.014);
    }
    // smoke wisp drifting off the muzzle
    smoke.spawn(px + dir.x * 0.06, py + dir.y * 0.06, pz + dir.z * 0.06,
      dir.x * 0.55 + nrand() * 0.18, dir.y * 0.55 + 0.4, dir.z * 0.55 + nrand() * 0.18,
      rand(0.5, 0.75), 0.05, rand(0.26, 0.38), Math.random() * 6.28, nrand() * 3,
      0.30, 0.29, 0.275, 0.11, -0.4, 1.9, 0.12, 1.3);
    // modest warm light spill on the ground/walls, fast cubic decay —
    // low enough that it no longer blows out near-camera geometry or brass
    lights.flash(px, py, pz, rand(8, 12), 0.06);
  }

  function tracer(from, to) {
    tracers.spawn(from.x, from.y, from.z, to.x, to.y, to.z,
      0.07, 0.022, 2.1, 1.62, 1.05); // 0xffd9a0 pushed hot for bloom
  }

  function impact(point, normal, surface) {
    const px = point.x, py = point.y, pz = point.z;
    const nx = normal.x, ny = normal.y, nz = normal.z;
    const q = lodScale(px, py, pz);

    if (surface === 'metal') {
      burstSparks(px, py, pz, nx, ny, nz, (14 * q) | 0, 2.5, 8.5, 0.12, 0.34, 0.011, 1.0, 9.5, 0.03, 0.8);
      // brief hot ping at the impact point
      glows.spawn(px + nx * 0.02, py + ny * 0.02, pz + nz * 0.02, 0, 0, 0,
        0.05, 0.10, 0.07, 0, 0, 2.2, 1.7, 1.1, 0.85, 0, 0, 0, 1);
      dustPuffs(px + nx * 0.03, py + ny * 0.03, pz + nz * 0.03, nx, ny, nz,
        1, 0.34, 0.34, 0.335, 0.16, 0.06, 0.28, 0.4, 0.6, 0.7, -0.3);
      decals.spawn(px, py, pz, nx, ny, nz, rand(0.06, 0.085));
    } else if (surface === 'dirt') {
      dustPuffs(px + nx * 0.03, py + ny * 0.03, pz + nz * 0.03, nx, ny, nz,
        (3 * q) | 0 || 1, 0.40, 0.335, 0.245, 0.34, 0.10, rand(0.5, 0.7), 0.55, 0.9, 1.1, -0.5);
      chipBurst(px, py, pz, nx, ny, nz, (6 * q) | 0, 0.014, 0.034, 2.2, 5.2, 1.5, 0.30, 0.24, 0.165);
      decals.spawn(px, py, pz, nx, ny, nz, rand(0.075, 0.105));
    } else if (surface === 'flesh') {
      // dark red mist — desaturated, alpha-blended, quick bloom then droop
      for (let k = 0; k < ((4 * q) | 0 || 2); k++) {
        smoke.spawn(px + nrand() * 0.04, py + nrand() * 0.04, pz + nrand() * 0.04,
          nx * rand(0.5, 1.3) + nrand() * 0.7, ny * rand(0.5, 1.3) + nrand() * 0.5, nz * rand(0.5, 1.3) + nrand() * 0.7,
          rand(0.3, 0.55), rand(0.04, 0.07), rand(0.30, 0.44),
          Math.random() * 6.28, nrand() * 3,
          0.34 * rand(0.85, 1.1), 0.045, 0.045, 0.5, 2.2, 2.2, 0.06, 1.4);
      }
      // tight bright core puff sells the hit frame
      smoke.spawn(px, py, pz, nx * 0.6, ny * 0.6, nz * 0.6,
        0.16, 0.03, 0.17, Math.random() * 6.28, 0,
        0.52, 0.055, 0.05, 0.6, 0, 2, 0, 1.1);
      // droplets
      chipBurst(px, py, pz, nx, ny, nz, (5 * q) | 0, 0.006, 0.013, 1.6, 4.2, 1.0, 0.24, 0.028, 0.028);
    } else { // concrete + default
      dustPuffs(px + nx * 0.03, py + ny * 0.03, pz + nz * 0.03, nx, ny, nz,
        (3 * q) | 0 || 1, 0.50, 0.485, 0.455, 0.30, 0.09, rand(0.42, 0.6), 0.5, 0.85, 1.0, -0.4);
      chipBurst(px, py, pz, nx, ny, nz, (5 * q) | 0, 0.012, 0.028, 2.4, 5.6, 1.4, 0.40, 0.39, 0.365);
      burstSparks(px, py, pz, nx, ny, nz, (3 * q) | 0, 1.8, 4.5, 0.08, 0.16, 0.007, 0.55, 9, 0.02, 0.9);
      decals.spawn(px, py, pz, nx, ny, nz, rand(0.06, 0.09));
    }
  }

  function casing(pos, rightDir) {
    _v1.copy(rightDir).normalize();
    _v2.set(0, 1, 0);
    _v3.crossVectors(_v1, _v2); // right x up: points behind the shooter
    // brisk up-right-and-behind arc so brass clears the frame quickly
    casings.spawn(
      pos.x, pos.y, pos.z,
      _v1.x * rand(2.2, 3.4) + _v3.x * rand(0.3, 1.0),
      rand(1.6, 2.2),
      _v1.z * rand(2.2, 3.4) + _v3.z * rand(0.3, 1.0),
      nrand() * 34, nrand() * 34, nrand() * 34,
      0.75, 0.75, 0.8,
      rand(0.9, 1.4), 0.012, rand(0.28, 0.4), 0, 0, 0);
  }

  function smokeColumn(pos) {
    const i = (colIdx++ % COLS) * 5;
    colData[i] = pos.x; colData[i + 1] = pos.y; colData[i + 2] = pos.z;
    colData[i + 3] = Math.random() * 0.2; // stagger first puff
    colData[i + 4] = 1;
  }

  function debris(point, normal) {
    chipBurst(point.x, point.y, point.z, normal.x, normal.y, normal.z,
      6, 0.02, 0.058, 2.0, 5.5, 1.9, 0.36, 0.35, 0.33);
    dustPuffs(point.x, point.y, point.z, normal.x, normal.y, normal.z,
      2, 0.46, 0.45, 0.42, 0.24, 0.12, 0.5, 0.6, 0.9, 0.9, -0.4);
  }

  function explosionAt(pos) {
    const px = pos.x, py = pos.y, pz = pos.z;
    // core star
    flashes.spawn(px, py + 0.3, pz, 0, 0, 0, 0.07, 1.0, 0.8,
      Math.random() * 6.28, 0, 2.5, 2.1, 1.5, 1, 0, 0, 0, 0.9);
    // fireball puffs
    for (let k = 0; k < 6; k++) {
      glows.spawn(px + nrand() * 0.3, py + 0.3 + Math.random() * 0.4, pz + nrand() * 0.3,
        nrand() * 1.6, rand(1, 2.6), nrand() * 1.6,
        rand(0.16, 0.28), rand(0.4, 0.6), rand(1.1, 1.6), 0, 0,
        2.0, 1.05, 0.38, 0.65, -2, 2.5, 0.1, 1.5);
    }
    // smoke plume
    for (let k = 0; k < 8; k++) {
      smoke.spawn(px + nrand() * 0.4, py + 0.2 + Math.random() * 0.6, pz + nrand() * 0.4,
        nrand() * 0.8, rand(1.2, 2.6), nrand() * 0.8,
        rand(1.8, 3.2), rand(0.3, 0.6), rand(1.6, 2.6),
        Math.random() * 6.28, nrand() * 1.2,
        0.10 * rand(0.8, 1.3), 0.095, 0.09, 0.24, -0.5, 1.2, 0.12, 1.2);
    }
    // ground dust ring
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + nrand() * 0.4;
      smoke.spawn(px + Math.cos(a) * 0.5, py + 0.15, pz + Math.sin(a) * 0.5,
        Math.cos(a) * rand(2.5, 4), 0.4, Math.sin(a) * rand(2.5, 4),
        rand(0.7, 1.1), 0.3, rand(1.0, 1.5), Math.random() * 6.28, nrand() * 2,
        0.42, 0.40, 0.37, 0.3, 1.5, 2.6, 0.08, 1.3);
    }
    burstSparks(px, py + 0.3, pz, 0, 1, 0, 22, 5, 14, 0.25, 0.6, 0.014, 1.0, 10, 0.035, 1.6);
    chipBurst(px, py + 0.2, pz, 0, 1, 0, 9, 0.05, 0.13, 4, 9, 2.2, 0.33, 0.31, 0.29);
    lights.flash(px, py + 0.5, pz, 38, 0.13);
  }

  function update(dt) {
    // fog sync (cheap, no alloc)
    const fog = scene.fog;
    if (fog) {
      fogU.color.value.copy(fog.color);
      if (fog.isFogExp2) fogU.density.value = fog.density;
    }
    // smoke column emitters
    for (let i = 0; i < COLS; i++) {
      const o = i * 5;
      if (!colData[o + 4]) continue;
      colData[o + 3] -= dt;
      if (colData[o + 3] <= 0) {
        colData[o + 3] = rand(0.16, 0.3);
        const g = rand(0.065, 0.115);
        smoke.spawn(
          colData[o] + nrand() * 0.35, colData[o + 1] + Math.random() * 0.5, colData[o + 2] + nrand() * 0.35,
          0.16 + nrand() * 0.1, rand(0.6, 1.15), 0.07 + nrand() * 0.1,
          rand(4.2, 6.4), rand(0.45, 0.8), rand(2.1, 3.3),
          Math.random() * 6.28, nrand() * 0.5,
          g, g, g * 1.06, rand(0.13, 0.18), -0.06, 0.12, 0.16, 1.15);
      }
    }
    smoke.update(dt);
    glows.update(dt);
    flashes.update(dt);
    sparks.update(dt);
    tracers.update(dt);
    decals.update(dt);
    casings.update(dt);
    chunks.update(dt);
    lights.update(dt);
  }

  return { muzzleFlash, tracer, impact, casing, smokeColumn, debris, explosionAt, update };
}
