// ASHFALL — world/textures.js
// Canvas-procedural PBR-ish texture sets. Everything generated at runtime, 512px,
// tileable. Normal maps derived from a per-material heightfield via Sobel.
import * as THREE from 'three';

const S = 512;

// ---------------------------------------------------------------- rng / noise
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable value-noise lattice. `cells` must divide nothing in particular but
// wraps modulo `cells`, so the result tiles perfectly.
function makeLattice(cells, rand) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return (x, y) => {
    // x,y in [0,1)
    const fx = x * cells, fy = y * cells;
    let x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    x0 = ((x0 % cells) + cells) % cells;
    y0 = ((y0 % cells) + cells) % cells;
    const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[y0 * cells + x0], b = g[y0 * cells + x1];
    const c = g[y1 * cells + x0], d = g[y1 * cells + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

// Tileable fbm built from wrapped lattices (octave frequencies all wrap).
function makeFbm(rand, baseCells, octaves) {
  const layers = [];
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) { layers.push(makeLattice(cells, rand)); cells *= 2; }
  return (x, y) => {
    let v = 0, amp = 0.5, sum = 0;
    for (let o = 0; o < layers.length; o++) {
      v += layers[o](x, y) * amp; sum += amp; amp *= 0.5;
    }
    return v / sum;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, t) => { const u = clamp01((t - a) / (b - a)); return u * u * (3 - 2 * u); };

// ---------------------------------------------------------------- core builder
// build(name) fills height[] (0..1) and rgb[] (0..255 x3) then we derive maps.
function buildSet(fill, opts = {}) {
  const height = new Float32Array(S * S);
  const rgb = new Uint8ClampedArray(S * S * 3);
  const rough = new Float32Array(S * S);
  rough.fill(0.85);
  fill(height, rgb, rough);

  // --- albedo canvas (grime pass baked by fill) --------------------------------
  const cAlb = document.createElement('canvas'); cAlb.width = cAlb.height = S;
  const gAlb = cAlb.getContext('2d');
  const idA = gAlb.createImageData(S, S);
  for (let i = 0, j = 0; i < S * S; i++, j += 4) {
    idA.data[j] = rgb[i * 3];
    idA.data[j + 1] = rgb[i * 3 + 1];
    idA.data[j + 2] = rgb[i * 3 + 2];
    idA.data[j + 3] = 255;
  }
  gAlb.putImageData(idA, 0, 0);

  // --- normal map via Sobel over wrapped heightfield ---------------------------
  const strength = opts.normalStrength ?? 2.2;
  const cNor = document.createElement('canvas'); cNor.width = cNor.height = S;
  const gNor = cNor.getContext('2d');
  const idN = gNor.createImageData(S, S);
  const H = (x, y) => height[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const tl = H(x - 1, y - 1), t = H(x, y - 1), tr = H(x + 1, y - 1);
      const l = H(x - 1, y), r = H(x + 1, y);
      const bl = H(x - 1, y + 1), b = H(x, y + 1), br = H(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      // tangent-space normal (green-up convention matches three)
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv; nz *= inv;
      const j = (y * S + x) * 4;
      idN.data[j] = (nx * 0.5 + 0.5) * 255;
      idN.data[j + 1] = (ny * 0.5 + 0.5) * 255;
      idN.data[j + 2] = (nz * 0.5 + 0.5) * 255;
      idN.data[j + 3] = 255;
    }
  }
  gNor.putImageData(idN, 0, 0);

  // --- roughness map ------------------------------------------------------------
  const cRou = document.createElement('canvas'); cRou.width = cRou.height = S;
  const gRou = cRou.getContext('2d');
  const idR = gRou.createImageData(S, S);
  for (let i = 0, j = 0; i < S * S; i++, j += 4) {
    const v = clamp01(rough[i]) * 255;
    idR.data[j] = v; idR.data[j + 1] = v; idR.data[j + 2] = v; idR.data[j + 3] = 255;
  }
  gRou.putImageData(idR, 0, 0);

  const mk = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4; // 8 was measurably costly once the city multiplied ground fill
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(cAlb, true), normalMap: mk(cNor, false), roughnessMap: mk(cRou, false) };
}

// Bake AO-from-height + grime streaks into albedo (shared helper).
function grime(rgb, height, rough, fbm, amt = 0.35, streakAmt = 0.22) {
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const i = y * S + x, u = x / S;
      // cavity darkening
      const cav = 1 - clamp01((0.55 - height[i]) * amt * 2.4);
      // vertical water streaks: stretched noise
      const st = fbm(u * 6, v * 0.35);
      const streak = 1 - streakAmt * smooth(0.55, 0.8, st) * (0.4 + 0.6 * v);
      const m = cav * streak;
      rgb[i * 3] *= m; rgb[i * 3 + 1] *= m; rgb[i * 3 + 2] *= m;
      rough[i] = clamp01(rough[i] + (1 - m) * 0.15);
    }
  }
}

// ================================================================ materials
function texAsphalt() {
  const rand = mulberry32(101);
  const fbm = makeFbm(rand, 8, 5), fine = makeFbm(mulberry32(102), 64, 3);
  const crackNoise = makeFbm(mulberry32(103), 6, 5);
  const broad = makeFbm(mulberry32(104), 2, 3); // large tonal patches (tileable)
  return buildSet((h, rgb, rough) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      let hh = 0.5 + (fbm(u, v) - 0.5) * 0.35 + (fine(u, v) - 0.5) * 0.5;
      // cracks: ridged noise thresholded into thin dark canyons
      const c = Math.abs(crackNoise(u, v) - 0.5) * 2;
      const crack = smooth(0.06, 0.0, c);
      hh -= crack * 0.5;
      // patch repair: rectangle-ish darker smooth zone
      const patch = smooth(0.62, 0.7, fbm(u * 0.5 + 0.31, v * 0.5 + 0.7));
      hh = lerp(hh, 0.52, patch * 0.7);
      h[i] = clamp01(hh);
      const speck = fine(u * 2, v * 2);
      const blotch = broad(u, v) - 0.5; // breaks up the uniform speckle
      let g = 46 + speck * 21 + (fbm(u, v) - 0.5) * 18 + blotch * 24;
      g *= 1 - crack * 0.55;
      g = lerp(g, 34, patch * 0.8);
      rgb[i * 3] = g * 1.02; rgb[i * 3 + 1] = g * 1.0; rgb[i * 3 + 2] = g * 0.96;
      rough[i] = 0.94 - speck * 0.08 + patch * 0.03 - blotch * 0.05;
    }
    grime(rgb, h, rough, fbm, 0.3, 0.1);
  }, { normalStrength: 2.6 });
}

function texConcrete() {
  const fbm = makeFbm(mulberry32(201), 6, 5), fine = makeFbm(mulberry32(202), 48, 3);
  const stain = makeFbm(mulberry32(203), 4, 4);
  return buildSet((h, rgb, rough) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      // shutter/form lines every 1/4
      const form = Math.abs(((v * 4) % 1) - 0.5) * 2;
      const seam = smooth(0.97, 1.0, form);
      let hh = 0.55 + (fbm(u, v) - 0.5) * 0.22 + (fine(u, v) - 0.5) * 0.25 - seam * 0.35;
      // small pores
      const pore = smooth(0.78, 0.95, fine(u * 1.7 + 0.4, v * 1.7));
      hh -= pore * 0.25;
      h[i] = clamp01(hh);
      let g = 133 + (fbm(u, v) - 0.5) * 30 + (fine(u, v) - 0.5) * 16;
      const st = smooth(0.55, 0.85, stain(u, v));
      g *= 1 - st * 0.19 - seam * 0.25 - pore * 0.3;
      rgb[i * 3] = g * 1.0; rgb[i * 3 + 1] = g * 0.985; rgb[i * 3 + 2] = g * 0.94;
      rough[i] = 0.9 + st * 0.06;
    }
    grime(rgb, h, rough, fbm, 0.4, 0.3);
  }, { normalStrength: 2.0 });
}

function texBrick() {
  const fbm = makeFbm(mulberry32(301), 8, 4), fine = makeFbm(mulberry32(302), 64, 3);
  const varn = makeLattice(64, mulberry32(303));
  const ROWS = 12, COLS = 6; // brick courses per tile
  return buildSet((h, rgb, rough) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const row = Math.floor(v * ROWS);
      const offs = (row % 2) * 0.5;
      const bu = ((u + offs / COLS * COLS * (1 / COLS)) * COLS) % 1; // u within brick
      const bx = Math.floor((u * COLS + (row % 2) * 0.5));
      const bv = (v * ROWS) % 1;
      // mortar margins
      const mU = Math.min(bu, 1 - bu), mV = Math.min(bv, 1 - bv);
      const mortar = 1 - smooth(0.0, 0.07, mU) * smooth(0.0, 0.12, mV);
      // per-brick tone variation (wraps because lattice wraps)
      const tone = varn(((bx % COLS) + COLS) % COLS / COLS + 0.5 / COLS,
                        ((row % ROWS) + ROWS) % ROWS / ROWS + 0.5 / ROWS);
      let hh = 0.62 + (fine(u, v) - 0.5) * 0.18 + (fbm(u, v) - 0.5) * 0.1;
      hh = lerp(hh, 0.18 + fine(u * 2, v * 2) * 0.1, mortar);
      // chipped brick corners
      const chip = smooth(0.86, 0.98, fine(u * 1.3 + 0.2, v * 1.3 + 0.6)) * (1 - mortar);
      hh -= chip * 0.3;
      h[i] = clamp01(hh);
      // muted iron-spot brick: dusty red-brown range (lifted so shadow sides
      // stay readable under hemi light alone)
      let r = 127 + tone * 42 + (fine(u, v) - 0.5) * 22;
      let g = 82 + tone * 24 + (fine(u, v) - 0.5) * 16;
      let b = 70 + tone * 16 + (fine(u, v) - 0.5) * 12;
      const mr = 132 + fine(u * 3, v * 3) * 26; // mortar grey
      r = lerp(r, mr, mortar); g = lerp(g, mr * 0.97, mortar); b = lerp(b, mr * 0.92, mortar);
      const dk = 1 - chip * 0.25;
      rgb[i * 3] = r * dk; rgb[i * 3 + 1] = g * dk; rgb[i * 3 + 2] = b * dk;
      rough[i] = 0.88 + mortar * 0.06;
    }
    grime(rgb, h, rough, fbm, 0.36, 0.26);
  }, { normalStrength: 3.0 });
}

function texPlaster() {
  const fbm = makeFbm(mulberry32(401), 5, 5), fine = makeFbm(mulberry32(402), 40, 3);
  const chipN = makeFbm(mulberry32(403), 4, 4);
  const brickFine = makeFbm(mulberry32(404), 48, 2);
  return buildSet((h, rgb, rough) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      // chipped patches reveal brick tone beneath
      const chip = smooth(0.6, 0.72, chipN(u, v) + (fine(u, v) - 0.5) * 0.14);
      let hh = 0.6 + (fbm(u, v) - 0.5) * 0.16 + (fine(u, v) - 0.5) * 0.12;
      hh = lerp(hh, 0.3 + (brickFine(u, v) - 0.5) * 0.2, chip);
      // hairline cracks
      const c = Math.abs(fbm(u * 1.7 + 0.35, v * 1.7) - 0.5) * 2;
      const crack = smooth(0.045, 0.0, c) * (1 - chip);
      hh -= crack * 0.3;
      h[i] = clamp01(hh);
      // dusty tan plaster
      let r = 168 + (fbm(u, v) - 0.5) * 26 + (fine(u, v) - 0.5) * 14;
      let g = r * 0.94, b = r * 0.84;
      // exposed masonry underneath: darker red-grey
      const br = 108 + brickFine(u, v) * 30;
      r = lerp(r, br * 1.05, chip); g = lerp(g, br * 0.78, chip); b = lerp(b, br * 0.66, chip);
      const dk = 1 - crack * 0.4;
      rgb[i * 3] = r * dk; rgb[i * 3 + 1] = g * dk; rgb[i * 3 + 2] = b * dk;
      rough[i] = 0.87 + chip * 0.06;
    }
    grime(rgb, h, rough, fbm, 0.4, 0.34);
  }, { normalStrength: 2.4 });
}

function texMetal() {
  const fbm = makeFbm(mulberry32(501), 6, 4), fine = makeFbm(mulberry32(502), 56, 3);
  const RIDGES = 16;
  return buildSet((h, rgb, rough) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      // corrugation: sine ridges along u
      const ridge = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * RIDGES);
      let hh = 0.25 + ridge * 0.55 + (fine(u, v) - 0.5) * 0.08;
      const dent = smooth(0.68, 0.85, fbm(u, v));
      hh -= dent * 0.18;
      h[i] = clamp01(hh);
      let g = 96 + ridge * 26 + (fine(u, v) - 0.5) * 18;
      // rust blooming in dents / lower half
      const rustAmt = clamp01(dent * 0.9 + smooth(0.5, 0.95, v) * 0.35 * fbm(u * 2, v * 2));
      let r = lerp(g * 0.98, 96, rustAmt), gg = lerp(g * 1.0, 58, rustAmt), b = lerp(g * 1.04, 40, rustAmt);
      rgb[i * 3] = r; rgb[i * 3 + 1] = gg; rgb[i * 3 + 2] = b;
      rough[i] = lerp(0.52 + (fine(u, v) - 0.5) * 0.12, 0.95, rustAmt);
    }
    grime(rgb, h, rough, fbm, 0.28, 0.3);
  }, { normalStrength: 2.8 });
}

function texRust() {
  const fbm = makeFbm(mulberry32(601), 5, 5), fine = makeFbm(mulberry32(602), 44, 3);
  return buildSet((h, rgb, rough) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const blister = smooth(0.4, 0.75, fbm(u, v)) ;
      let hh = 0.5 + (fine(u, v) - 0.5) * 0.3 + blister * 0.2 - 0.1;
      h[i] = clamp01(hh);
      // deep oxidized browns with darker pits
      const t = fbm(u * 1.4 + 0.2, v * 1.4);
      let r = lerp(56, 118, t) + (fine(u, v) - 0.5) * 26;
      let g = r * lerp(0.5, 0.62, t), b = r * lerp(0.36, 0.44, t);
      const pit = smooth(0.75, 0.92, fine(u * 1.8, v * 1.8));
      const dk = 1 - pit * 0.5;
      rgb[i * 3] = r * dk; rgb[i * 3 + 1] = g * dk; rgb[i * 3 + 2] = b * dk;
      rough[i] = 0.92 + pit * 0.04;
    }
    grime(rgb, h, rough, fbm, 0.35, 0.2);
  }, { normalStrength: 2.4 });
}

function texWood() {
  const fbm = makeFbm(mulberry32(701), 4, 4), fine = makeFbm(mulberry32(702), 3, 6);
  const PLANKS = 6;
  return buildSet((h, rgb, rough) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const pv = (u * PLANKS) % 1;
      const gap = 1 - smooth(0.0, 0.045, Math.min(pv, 1 - pv));
      const plank = Math.floor(u * PLANKS);
      // grain: stretched noise along v
      const grain = fine(u * 2 + plank * 0.37, v * 0.18);
      let hh = 0.55 + (grain - 0.5) * 0.3 - gap * 0.5 + (fbm(u, v) - 0.5) * 0.1;
      h[i] = clamp01(hh);
      const tone = 0.8 + ((plank * 73) % 7) / 7 * 0.35;
      let r = (112 + grain * 44) * tone * 0.92;
      let g = r * 0.76, b = r * 0.58;
      const weather = smooth(0.55, 0.85, fbm(u + 0.4, v));
      r = lerp(r, 118, weather * 0.55); g = lerp(g, 112, weather * 0.55); b = lerp(b, 104, weather * 0.55);
      const dk = 1 - gap * 0.55;
      rgb[i * 3] = r * dk; rgb[i * 3 + 1] = g * dk; rgb[i * 3 + 2] = b * dk;
      rough[i] = 0.86 + weather * 0.06;
    }
    grime(rgb, h, rough, fbm, 0.3, 0.16);
  }, { normalStrength: 2.2 });
}

function texSandbag() {
  const fbm = makeFbm(mulberry32(801), 6, 4), fine = makeFbm(mulberry32(802), 72, 2);
  const WEAVE = 90;
  return buildSet((h, rgb, rough) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      // burlap weave: two crossed sine grids
      const wa = Math.sin(u * Math.PI * 2 * WEAVE) * Math.sin(v * Math.PI * 2 * WEAVE * 0.5 + 1.3);
      const wb = Math.sin(v * Math.PI * 2 * WEAVE) * Math.sin(u * Math.PI * 2 * WEAVE * 0.5);
      let hh = 0.5 + (wa + wb) * 0.09 + (fbm(u, v) - 0.5) * 0.28 + (fine(u, v) - 0.5) * 0.1;
      h[i] = clamp01(hh);
      // muted olive-tan burlap: faded khaki, desaturated, sits tonally below
      // the sunlit plaster (which bases around 168)
      const t = fbm(u * 1.3, v * 1.3);
      let r = 85 + t * 23 + (wa + wb) * 7 + (fine(u, v) - 0.5) * 10;
      let g = r * 0.93, b = r * 0.74;
      // olive cast
      g = lerp(g, r * 0.98, 0.35);
      rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
      rough[i] = 0.95;
    }
    grime(rgb, h, rough, fbm, 0.35, 0.2);
  }, { normalStrength: 2.0 });
}

function texCamo() {
  const fbm = makeFbm(mulberry32(901), 5, 4), fine = makeFbm(mulberry32(902), 60, 2);
  const blotA = makeFbm(mulberry32(903), 4, 3), blotB = makeFbm(mulberry32(904), 6, 3);
  // muted woodland-ish: olive / dark brown / tan / near-black
  const C = [[86, 88, 62], [64, 54, 42], [118, 108, 82], [42, 44, 38]];
  return buildSet((h, rgb, rough) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      // fabric weave height
      const wv = Math.sin(u * Math.PI * 2 * 120) * Math.sin(v * Math.PI * 2 * 120);
      h[i] = clamp01(0.5 + wv * 0.05 + (fine(u, v) - 0.5) * 0.12);
      const a = blotA(u, v), b = blotB(u + 0.33, v + 0.61);
      let ci = 0;
      if (a > 0.56) ci = 1; else if (a < 0.44) ci = 2;
      if (b > 0.62) ci = 3;
      const col = C[ci];
      const sh = 0.9 + (fine(u, v) - 0.5) * 0.22 + wv * 0.03;
      rgb[i * 3] = col[0] * sh; rgb[i * 3 + 1] = col[1] * sh; rgb[i * 3 + 2] = col[2] * sh;
      rough[i] = 0.96;
    }
    grime(rgb, h, rough, fbm, 0.2, 0.12);
  }, { normalStrength: 1.2 });
}

// Charred vehicle metal: sooty near-black with rust bloom at edges/dents and
// faint heat-scorch mottling. Used by the burned-out car hulks.
function texCharred() {
  const fbm = makeFbm(mulberry32(121), 5, 5), fine = makeFbm(mulberry32(122), 56, 3);
  const rustN = makeFbm(mulberry32(123), 4, 4);
  return buildSet((h, rgb, rough) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      // blistered paint + dents
      const blister = smooth(0.62, 0.82, fine(u * 1.4 + 0.2, v * 1.4));
      const dent = smooth(0.6, 0.85, fbm(u, v));
      let hh = 0.5 + (fine(u, v) - 0.5) * 0.22 - blister * 0.2 - dent * 0.12;
      h[i] = clamp01(hh);
      // sooty charcoal base with tonal mottling
      const soot = fbm(u * 1.6 + 0.4, v * 1.6);
      let g = 30 + soot * 22 + (fine(u, v) - 0.5) * 12;
      // rust/burn bloom creeping in patches
      const rustAmt = clamp01(smooth(0.56, 0.78, rustN(u, v)) * 0.85 + blister * 0.3);
      let r = lerp(g * 1.02, 96, rustAmt * 0.7);
      let gg = lerp(g, 52, rustAmt * 0.7);
      let b = lerp(g * 0.96, 34, rustAmt * 0.7);
      // vertical soot streaks
      const st = smooth(0.6, 0.85, fbm(u * 7, v * 0.4));
      const dk = 1 - st * 0.35;
      rgb[i * 3] = r * dk; rgb[i * 3 + 1] = gg * dk; rgb[i * 3 + 2] = b * dk;
      rough[i] = lerp(0.68 + soot * 0.15, 0.97, rustAmt);
    }
    grime(rgb, h, rough, fbm, 0.3, 0.2);
  }, { normalStrength: 2.2 });
}

// Concrete paver tiles for plazas: grid seams + per-tile tonal variation,
// same dusty grey family as texConcrete so it sits in the palette.
function texPaver() {
  const fbm = makeFbm(mulberry32(221), 6, 4), fine = makeFbm(mulberry32(222), 44, 3);
  const varn = makeLattice(8, mulberry32(223));
  const N = 8; // tiles per side
  return buildSet((h, rgb, rough) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const tu = (u * N) % 1, tv = (v * N) % 1;
      const gx = Math.floor(u * N), gy = Math.floor(v * N);
      const mU = Math.min(tu, 1 - tu), mV = Math.min(tv, 1 - tv);
      const seam = 1 - smooth(0.0, 0.045, mU) * smooth(0.0, 0.045, mV);
      const tone = varn(gx / N + 0.5 / N, gy / N + 0.5 / N);
      // slight per-tile tilt/settling
      const tilt = (tone - 0.5) * 0.1 * (tu - 0.5 + tv - 0.5);
      let hh = 0.58 + (fine(u, v) - 0.5) * 0.14 + tilt - seam * 0.42;
      const chip = smooth(0.84, 0.96, fine(u * 1.6 + 0.2, v * 1.6));
      hh -= chip * 0.2;
      h[i] = clamp01(hh);
      let g = 124 + tone * 26 + (fine(u, v) - 0.5) * 16 + (fbm(u, v) - 0.5) * 18;
      g *= 1 - seam * 0.3 - chip * 0.2;
      rgb[i * 3] = g * 1.0; rgb[i * 3 + 1] = g * 0.98; rgb[i * 3 + 2] = g * 0.93;
      rough[i] = 0.9 + seam * 0.05;
    }
    grime(rgb, h, rough, fbm, 0.36, 0.2);
  }, { normalStrength: 2.4 });
}

// ---------------------------------------------------------------- skyline windows
// Unlit silhouette facade for the distant skyline: base white (tinted by the
// material color in map.js), sparse window-cell grid — ~10% dim warm lit, the
// rest near-black — with per-row contrast so far rows melt into the fog.
// Bottom 20px kept plain: the box top-face UVs are collapsed there so roofs
// read as solid silhouette from elevated views.
function makeSkylineWinTex(contrast, seed) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 256);
  const rand = mulberry32(seed);
  const cw = 6, chh = 9;
  const dark = Math.round(255 - (255 - 84) * contrast);
  for (let y = 8; y < 256 - 20 - chh; y += chh) {
    for (let x = 5; x < 128 - 5 - cw; x += cw) {
      if (rand() < 0.24) continue; // missing cell -> irregular grid
      if (rand() < 0.09) {
        // dim warm lit window, fading with row contrast
        const r = Math.round(lerp(255, 238, contrast));
        const gg = Math.round(lerp(255, 186, contrast));
        const b = Math.round(lerp(255, 122, contrast));
        g.fillStyle = `rgb(${r},${gg},${b})`;
      } else {
        g.fillStyle = `rgb(${dark},${dark},${Math.min(255, dark + 3)})`;
      }
      g.fillRect(x, y, cw - 3, chh - 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function texDirt() {
  const fbm = makeFbm(mulberry32(111), 6, 5), fine = makeFbm(mulberry32(112), 52, 3);
  return buildSet((h, rgb, rough) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      let hh = 0.5 + (fbm(u, v) - 0.5) * 0.5 + (fine(u, v) - 0.5) * 0.3;
      // pebbles
      const peb = smooth(0.8, 0.95, fine(u * 1.6 + 0.3, v * 1.6));
      hh += peb * 0.15;
      h[i] = clamp01(hh);
      const t = fbm(u, v);
      let r = 96 + t * 34 + (fine(u, v) - 0.5) * 20 + peb * 20;
      let g = r * 0.87, b = r * 0.7;
      rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
      rough[i] = 0.96;
    }
    grime(rgb, h, rough, fbm, 0.3, 0.08);
  }, { normalStrength: 2.6 });
}

// ================================================================ export
export function makeTextures() {
  return {
    asphalt: texAsphalt(),
    concrete: texConcrete(),
    brick: texBrick(),
    plaster: texPlaster(),
    metal: texMetal(),
    rust: texRust(),
    wood: texWood(),
    sandbag: texSandbag(),
    camo: texCamo(),
    dirt: texDirt(),
    charred: texCharred(),
    paver: texPaver(),
    // near / mid / far skyline rows — progressively lower contrast
    skylineWin: [
      makeSkylineWinTex(1.0, 7001),
      makeSkylineWinTex(0.55, 7013),
      makeSkylineWinTex(0.32, 7027),
    ],
  };
}
