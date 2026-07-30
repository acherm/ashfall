// ASHFALL — enemies/enemies.js
// Procedural articulated AI soldiers: model, animation, AI, waves, damage,
// per-soldier weapon types (mk4/smg/dmr) and floor weapon drops.
// LEVEL / DIFFICULTY progression: every 2 cleared waves the difficulty climbs
// (tankier / more accurate / more aggressive / more numerous spawns, plus
// HEAVY + RUSHER archetypes at higher levels); main.js calls setStartLevel(n)
// before the first wave and the manager auto-drives hud.setLevel / levelBanner.
// Contract: createEnemyManager({ scene, world, fx, audio, hud, player }) ->
//   { targets, applyDamage, spawnWave, spawnAt, update, drops, addDrop,
//     setStartLevel, get level, get difficultyName, ... }

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeTextures } from '../world/textures.js';

/* ================================================================ shared
 * Textures / materials / geometries are built ONCE at module scope and
 * shared by every soldier instance (max 12 alive, no instancing needed). */

const TEX = makeTextures();
for (const t of [TEX.camo.map, TEX.camo.normalMap, TEX.camo.roughnessMap]) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
}

function camoMat(tint) {
  return new THREE.MeshStandardMaterial({
    map: TEX.camo.map,
    normalMap: TEX.camo.normalMap,
    roughnessMap: TEX.camo.roughnessMap,
    color: tint,
    roughness: 1.0,
    metalness: 0.0,
    vertexColors: true,
  });
}
function clothMat(color, rough = 0.92) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: rough,
    metalness: 0.0,
    normalMap: TEX.camo.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    vertexColors: true,
  });
}

// Three soldier colour variants — woodland-green, arid-tan and dark-urban
// grey. The camo map is dark (avg ~0.3), so uniform tints run bright and gear
// runs flat-dark to get strong value separation between cloth / armour /
// webbing at range.
const VARIANTS = [
  {
    // woodland: light grey-green uniform, ranger-green carrier, black webbing
    camo: camoMat(0xe6ead0),
    pants: camoMat(0xc2c6ab),
    helmet: camoMat(0x767c5e),
    carrier: clothMat(0x5d6a4c),
    webbing: clothMat(0x33302a),
    rifleFurn: new THREE.MeshStandardMaterial({ color: 0x30333a, roughness: 0.7, metalness: 0.15, vertexColors: true }),
  },
  {
    // arid: light tan uniform, coyote-brown carrier, dark earth webbing
    camo: camoMat(0xf5e3b8),
    pants: camoMat(0xd8c496),
    helmet: camoMat(0x9d8a62),
    carrier: clothMat(0x87693f),
    webbing: clothMat(0x3a2f22),
    // flat-dark-earth furniture — reads "modern carbine" against dark gear
    rifleFurn: new THREE.MeshStandardMaterial({ color: 0x846f4b, roughness: 0.75, metalness: 0.08, vertexColors: true }),
  },
  {
    // dark-urban: cool grey-blue uniform, near-black carrier — night-ops read
    camo: camoMat(0xb2bac2),
    pants: camoMat(0x8f969c),
    helmet: camoMat(0x53585e),
    carrier: clothMat(0x393e45),
    webbing: clothMat(0x24262b),
    rifleFurn: new THREE.MeshStandardMaterial({ color: 0x40444c, roughness: 0.72, metalness: 0.12, vertexColors: true }),
  },
];
const MAT = {
  // faces carry a whisper of emissive "bounce" so helmet-brim shadow never
  // swallows them — far below glow level, just readable fill
  face: new THREE.MeshStandardMaterial({ color: 0x46392a, roughness: 0.95, metalness: 0, vertexColors: true, emissive: 0x0c0906, emissiveIntensity: 1 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc79a70, roughness: 0.72, metalness: 0, vertexColors: true, emissive: 0x241509, emissiveIntensity: 1 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x272220, roughness: 0.92, metalness: 0, vertexColors: true }),
  boot: new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 0.85, metalness: 0.05, vertexColors: true }),
  pad: new THREE.MeshStandardMaterial({ color: 0x22251d, roughness: 0.95, metalness: 0, vertexColors: true }),
  rifle: new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.28, metalness: 0.55 }),
  rifleFurniture: new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.7, metalness: 0.1 }),
  // face-feature materials (read at 2-10m): slightly glossy whites/pupils so
  // they catch a highlight, matte brow/paint so they read as shadow lines
  eyeWhite: new THREE.MeshStandardMaterial({ color: 0xd9d2c2, roughness: 0.35, metalness: 0, vertexColors: true, emissive: 0x1c1a16, emissiveIntensity: 1 }),
  pupil: new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 0.25, metalness: 0, vertexColors: true }),
  brow: new THREE.MeshStandardMaterial({ color: 0x1e1712, roughness: 0.9, metalness: 0, vertexColors: true }),
  lip: new THREE.MeshStandardMaterial({ color: 0x7c4636, roughness: 0.8, metalness: 0, vertexColors: true }),
  paint: new THREE.MeshStandardMaterial({ color: 0x39402e, roughness: 1, metalness: 0, vertexColors: true }),
};

/* Anatomy helpers ---------------------------------------------------------
 * limbGeo: tapered capsule — conical shaft with hemispherical caps whose
 * centers sit exactly on the joint pivots (y=0 is the UPPER joint, the shaft
 * hangs down -Y like the old translated cylinders), so knee/elbow bends
 * rotate a sphere inside a sphere and never open gaps. */
function limbGeo(rTop, rBot, len, radial = 9) {
  const pts = [];
  for (let i = 0; i <= 4; i++) { // bottom cap (distal joint)
    const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.001, rBot * Math.cos(a)), -len + rBot * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(rTop, 0));
  for (let i = 1; i <= 4; i++) { // top cap (proximal joint)
    const a = (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.001, rTop * Math.cos(a)), rTop * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, radial);
}
// mirror-merged left+right copies of a feature -> ONE mesh for the pair
function mergedPair(geo, dx) {
  const l = geo.clone();
  l.translate(-dx, 0, 0);
  geo.translate(dx, 0, 0);
  return mergeGeometries([geo, l], false);
}

const G = {};
{
  // pelvis: rounded hip mass (glutes + iliac flare), wider and deeper than
  // the waist above it — the belt line cuts across it
  G.pelvis = new THREE.SphereGeometry(0.15, 12, 9);
  G.pelvis.scale(1.22, 0.75, 0.86);
  G.belt = new THREE.BoxGeometry(0.37, 0.085, 0.26);
  G.hipPouch = new THREE.BoxGeometry(0.075, 0.13, 0.15);
  G.beltPouch = new THREE.BoxGeometry(0.09, 0.1, 0.07);
  // torso: lathed trunk profile — narrow waist, ribcage swell, chest/lat
  // spread at the armpit line, rounding off into the shoulders. Elliptical
  // cross-section (wider than deep). Chest width ~0.41 vs waist ~0.27.
  {
    const prof = [
      [0.001, -0.26], [0.107, -0.253], [0.125, -0.19], [0.134, -0.09],
      [0.143, 0.03], [0.155, 0.12], [0.16, 0.185], [0.148, 0.225],
      [0.11, 0.252], [0.001, 0.26],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    G.torso = new THREE.LatheGeometry(prof, 12);
    G.torso.scale(1.28, 1, 0.74);
  }
  G.carrier = new THREE.BoxGeometry(0.42, 0.37, 0.32);
  G.collar = new THREE.CylinderGeometry(0.082, 0.09, 0.075, 10, 1, true);
  G.pouch = new THREE.BoxGeometry(0.095, 0.12, 0.09);
  G.pouchWide = new THREE.BoxGeometry(0.16, 0.105, 0.08);
  G.radio = new THREE.BoxGeometry(0.075, 0.15, 0.07);
  G.antenna = new THREE.CylinderGeometry(0.007, 0.004, 0.38, 5);
  G.strap = new THREE.BoxGeometry(0.09, 0.05, 0.28);
  G.sling = new THREE.BoxGeometry(0.05, 0.46, 0.024);
  G.backpack = new THREE.BoxGeometry(0.3, 0.32, 0.13);
  G.shoulderPad = new THREE.BoxGeometry(0.105, 0.05, 0.15);
  // neck flares into the trapezius; trapPair is the neck->shoulder slope
  // (two smooth blobs merged into one mesh) that kills the "head on a post"
  G.neck = new THREE.CylinderGeometry(0.047, 0.06, 0.115, 9);
  {
    const blob = new THREE.SphereGeometry(0.075, 9, 7);
    blob.scale(1.45, 0.6, 1.05);
    const r = blob.clone();
    r.rotateZ(-0.38); // outer edge slopes down toward the shoulder
    r.translate(0.115, 0, 0);
    blob.rotateZ(0.38);
    blob.translate(-0.115, 0, 0);
    G.trapPair = mergeGeometries([r, blob], false);
  }
  G.head = new THREE.CapsuleGeometry(0.082, 0.07, 4, 12);
  G.skinStrip = new THREE.BoxGeometry(0.15, 0.06, 0.024);
  // face kit — all pairs are pre-merged so eyes cost 2 meshes total
  G.scleraPair = mergedPair(new THREE.SphereGeometry(0.0145, 7, 5).scale(1.1, 0.8, 0.5), 0.0315);
  G.pupilPair = mergedPair(new THREE.SphereGeometry(0.008, 6, 5).scale(1, 1, 0.5), 0.0315);
  G.browBar = new THREE.BoxGeometry(0.112, 0.011, 0.02);
  G.nose = new THREE.CylinderGeometry(0.013, 0.021, 0.055, 3); // wedge, apex +Z
  G.nose.scale(0.78, 1, 1.2);
  G.nose.rotateX(-0.12);
  G.mouth = new THREE.BoxGeometry(0.042, 0.0065, 0.012);
  G.jaw = new THREE.SphereGeometry(0.06, 9, 7);
  G.jaw.scale(1.15, 0.72, 0.95);
  G.earPair = mergedPair(new THREE.SphereGeometry(0.02, 6, 5).scale(0.55, 1.05, 0.8), 0.079);
  G.paintPair = mergedPair(new THREE.BoxGeometry(0.055, 0.02, 0.03).rotateZ(0.5).rotateY(-0.5), 0.048);
  G.helmet = new THREE.SphereGeometry(0.152, 16, 12, 0, Math.PI * 2, 0, 1.95);
  G.helmet.scale(1, 0.85, 1.12);
  G.helmetRim = new THREE.CylinderGeometry(0.143, 0.154, 0.038, 14, 1, true);
  G.helmetRim.scale(1, 1, 1.08);
  G.brim = new THREE.BoxGeometry(0.15, 0.024, 0.06);
  G.goggles = new THREE.BoxGeometry(0.155, 0.055, 0.045);
  G.nvg = new THREE.BoxGeometry(0.04, 0.055, 0.035);
  // deltoid cap, slightly dropped — reads "rounded shoulder" not "ball joint"
  G.shoulder = new THREE.SphereGeometry(0.07, 9, 7);
  G.shoulder.scale(1, 1.18, 1);
  // limbs: tapered capsules, thicker proximal than distal (thigh>calf,
  // upper arm>forearm); every cap doubles as the joint sphere
  G.upperArm = limbGeo(0.054, 0.044, 0.27);
  G.forearm = limbGeo(0.047, 0.033, 0.255);
  // mitt hand: palm capsule + thumb capsule angled forward, merged
  {
    const palm = new THREE.CapsuleGeometry(0.036, 0.045, 3, 8);
    palm.scale(0.78, 1, 1.05);
    const thumb = new THREE.CapsuleGeometry(0.0145, 0.032, 3, 6);
    thumb.rotateX(-1.15);
    thumb.translate(0, 0.018, 0.04);
    G.hand = mergeGeometries([palm, thumb], false);
  }
  G.thigh = limbGeo(0.082, 0.06, 0.4);
  G.thighPouch = new THREE.BoxGeometry(0.075, 0.17, 0.13);
  G.shin = limbGeo(0.06, 0.041, 0.365);
  G.kneepad = new THREE.BoxGeometry(0.11, 0.14, 0.075);
  // boot: sole + heel counter + ankle upper + rounded toe cap, one merged mesh
  {
    const sole = new THREE.BoxGeometry(0.112, 0.045, 0.295);
    sole.translate(0, -0.0425, 0.055);
    const heel = new THREE.BoxGeometry(0.106, 0.06, 0.055);
    heel.translate(0, -0.012, -0.072);
    const upper = new THREE.BoxGeometry(0.1, 0.1, 0.16);
    upper.translate(0, 0.012, -0.008);
    const toe = new THREE.SphereGeometry(0.05, 9, 7);
    toe.scale(1.12, 0.8, 1.65);
    toe.translate(0, -0.024, 0.128);
    G.boot = mergeGeometries([sole, heel, upper, toe], false);
  }
  // rifle — oversized slightly so it reads at 20-40m through fog
  G.receiver = new THREE.BoxGeometry(0.05, 0.085, 0.34);
  G.handguard = new THREE.BoxGeometry(0.047, 0.062, 0.3);
  G.barrel = new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8);
  G.barrel.rotateX(Math.PI / 2);
  G.muzzleDev = new THREE.BoxGeometry(0.028, 0.032, 0.07);
  G.mag = new THREE.BoxGeometry(0.04, 0.16, 0.078);
  G.stock = new THREE.BoxGeometry(0.044, 0.075, 0.2);
  G.optic = new THREE.BoxGeometry(0.04, 0.058, 0.1);
  G.grip = new THREE.BoxGeometry(0.032, 0.09, 0.05);
  G.foregrip = new THREE.BoxGeometry(0.03, 0.085, 0.04);
  // smg: stubby handguard + fat suppressor can + long stick mag
  G.handguardSMG = new THREE.BoxGeometry(0.05, 0.062, 0.16);
  G.suppressor = new THREE.CylinderGeometry(0.028, 0.028, 0.18, 10);
  G.suppressor.rotateX(Math.PI / 2);
  G.magSMG = new THREE.BoxGeometry(0.034, 0.2, 0.052);
  // dmr: extended barrel + boxy scope housing
  G.barrelDMR = new THREE.CylinderGeometry(0.011, 0.011, 0.44, 8);
  G.barrelDMR.rotateX(Math.PI / 2);
  G.scopeDMR = new THREE.BoxGeometry(0.046, 0.065, 0.18);
}

/* Fake baked AO — per-vertex greyscale multiplied into the shared materials.
 * Cheap value shaping so faces read even in flat hemisphere fill: darker
 * toward armpits / crotch / under the helmet brim, down-facing faces dip. */
{
  const c01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const bake = (geo, fn) => {
    const p = geo.attributes.position, n = geo.attributes.normal;
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      let v = fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
      v = v < 0.45 ? 0.45 : v > 1 ? 1 : v;
      c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  };
  const generic = (x, y, z, nx, ny) => 1 - 0.22 * Math.max(0, -ny);
  for (const k in G) bake(G[k], generic);
  bake(G.torso, (x, y, z, nx, ny) => {
    let v = 0.78 + 0.22 * c01((y + 0.26) / 0.52);       // dark toward waist
    if (Math.abs(nx) > 0.7) v *= 0.8 + 0.12 * (1 - c01((y + 0.26) / 0.52)); // armpit sides
    return v - 0.18 * Math.max(0, -ny);
  });
  bake(G.carrier, (x, y, z, nx, ny) =>
    (0.8 + 0.2 * c01((y + 0.185) / 0.37)) * (Math.abs(nx) > 0.7 ? 0.85 : 1) - 0.2 * Math.max(0, -ny));
  bake(G.pelvis, (x, y, z, nx, ny) => 0.86 - 0.2 * Math.max(0, -ny));
  bake(G.thigh, (x, y, z, nx, ny) => 1 - 0.32 * c01((y + 0.46) / 0.54));   // dark at hip
  bake(G.shin, (x, y, z, nx, ny) => 1 - 0.22 * c01(1 + y / 0.42));         // dark behind knee
  bake(G.upperArm, (x, y, z, nx, ny) => 1 - 0.32 * c01(1 + y / 0.3));      // dark at armpit
  bake(G.forearm, (x, y, z, nx, ny) => 1 - 0.16 * c01(1 + y / 0.28));
  bake(G.head, (x, y, z, nx, ny) => 1 - 0.3 * c01(y / 0.105));             // under helmet brim
  bake(G.helmet, (x, y, z, nx, ny) => 1 - 0.35 * Math.max(0, -ny));
  bake(G.shoulder, (x, y, z, nx, ny) => 0.9 - 0.25 * Math.max(0, -ny));
}

/* ---------------------------------------------------------------- temps */
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _muz = new THREE.Vector3();
const _end = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _ray = new THREE.Raycaster();

/* ------------------------------------------------- weapon-type tuning
 * Normal-mode soldiers spawn as mk4 (50%) / smg (30%) / dmr (20%). mk4 is
 * the untouched baseline — its numbers are byte-for-byte the pre-arsenal
 * behavior, and it doubles as the fallback wherever e.weapon is null
 * (football mode, so CR7 movement/cover choices never change). */
const WEAPONS = {
  mk4: {
    mag: 25, acc: 1, range: 48,
    burst: () => 3 + ((Math.random() * 3) | 0),
    roundDelay: () => 0.1 + Math.random() * 0.035,
    burstDelay: () => 0.7 + Math.random() * 0.7,
    peekBursts: () => 2 + ((Math.random() * 2) | 0),
    firstShot: () => 0.18 + Math.random() * 0.3,
    dmg: () => 6 + Math.random() * 6,
    prefCover: 13, maxCover: 30, closeBias: true, holdAt: 16, holdOdds: 0.45,
  },
  smg: { // sprays short frequent bursts and pushes inside 18m
    mag: 32, acc: 0.85, range: 38,
    burst: () => 2 + ((Math.random() * 2) | 0),
    roundDelay: () => 0.07 + Math.random() * 0.03,
    burstDelay: () => 0.45 + Math.random() * 0.4,
    peekBursts: () => 3 + ((Math.random() * 2) | 0),
    firstShot: () => 0.15 + Math.random() * 0.25,
    dmg: () => 6 + Math.random() * 6,
    prefCover: 9, maxCover: 26, closeBias: true, holdAt: 18, holdOdds: 0.3,
  },
  dmr: { // patient single heavy shots, holds range
    mag: 6, acc: 1.5, range: 60,
    burst: () => 1,
    roundDelay: () => 0.4, // unused with 1-round bursts; keep sane anyway
    burstDelay: () => 1.6 + Math.random() * 1.0,
    peekBursts: () => 2 + ((Math.random() * 3) | 0),
    firstShot: () => 0.5 + Math.random() * 0.6,
    dmg: () => 13 + Math.random() * 6, // 16±3
    prefCover: 24, maxCover: 40, closeBias: false, holdAt: 44, holdOdds: 0.2,
  },
};
const wpn = (e) => WEAPONS[e.weapon] || WEAPONS.mk4;

const HIP_H = 0.97;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// module-scope joint blend (no per-frame closure): rotation eases toward v by f
function poseTo(o, ax, v, f) { o.rotation[ax] += (v - o.rotation[ax]) * f; }
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* ---------------------------------------------- LEVEL / DIFFICULTY scaling
 * A progression layer over the wave manager: every 2 cleared waves the
 * internal `level` climbs, making LIVE-wave spawns tankier, more accurate,
 * more aggressive and more numerous, and folding in HEAVY (tanky juggernaut)
 * and RUSHER (fast glass-cannon) archetypes at higher levels. scaleFor(1) is
 * the identity — level 1 is byte-for-byte the pre-level game feel. Scripted
 * screenshot enemies NEVER scale (hp 100 / identity, no tint/scale tell) so
 * shot-mode framing never drifts. Same manager drives football mode, so the
 * scaling applies to the Ronaldos too. */

const MAX_LEVEL = 12;
const DIFF_NAMES = ['RECRUIT', 'REGULAR', 'HARDENED', 'VETERAN', 'ELITE', 'BRUTAL', 'SAVAGE', 'NIGHTMARE'];
function diffName(l) { return DIFF_NAMES[clamp((l | 0) - 1, 0, DIFF_NAMES.length - 1)]; }

// memoized per-level multiplier bundle — a pure fn of the level, cached so no
// per-frame / per-spawn allocation ever happens (at most 12 tiny objects made)
const _scaleCache = [];
function scaleFor(level) {
  level = clamp(level | 0, 1, MAX_LEVEL);
  let s = _scaleCache[level];
  if (s) return s;
  const L = level - 1; // 0 at level 1 -> identity
  s = {
    level,
    hp: Math.min(3.0, 1 + 0.30 * L),      // tankier: cap 3x from the level alone
    chance: Math.min(2.7, 1 + 0.13 * L),  // *0.18 base stays <= ~0.486 (< ~0.5)
    dmg: Math.min(2.2, 1 + 0.12 * L),     // harder hits, cap 2.2x
    speed: Math.min(1.35, 1 + 0.05 * L),  // faster move/advance, cap 1.35x
    aggro: Math.min(1, 0.13 * L),         // 0..1: shorter pauses, longer bursts, faster reload
  };
  _scaleCache[level] = s;
  return s;
}
const IDENTITY_SCALE = scaleFor(1); // frozen level-1 bundle for scripted enemies

// archetype spawn odds shift toward tanky/fast as the level climbs; rushers
// appear from L2, heavies from L3, ~25% each in the mid band up to ~0.34.
function pickArchetype(level) {
  const pRush = level >= 2 ? clamp(0.18 + 0.03 * (level - 2), 0, 0.34) : 0;
  const pHeavy = level >= 3 ? clamp(0.16 + 0.03 * (level - 3), 0, 0.34) : 0;
  const r = Math.random();
  if (r < pHeavy) return 'heavy';
  if (r < pHeavy + pRush) return 'rusher';
  return 'normal';
}
// per-archetype stat tags: hp / speed multipliers + a body-damage resistance
// so HEAVY body shots chip slowly and headshots matter. The scale + tint
// silhouette tells are applied at spawn (applyArchetypeLook).
const ARCH = {
  normal: { hp: 1, speed: 1, bodyMul: 1 },
  heavy: { hp: 2.4, speed: 0.72, bodyMul: 0.5 },
  rusher: { hp: 0.7, speed: 1.4, bodyMul: 1 },
};

/* ================================================================ model */

// Weapon prop, +Z toward the muzzle. Shared by the soldier rig (held across
// the chest) and the floor drops. mk4 layout is byte-identical to the
// original carbine; smg reads stubby with a fat suppressor can; dmr reads
// long with a scope box. Returns the group + muzzle tip Z for tracers.
function buildRifleProp(type, furn) {
  const g = new THREE.Group();
  const put = (geo, mat, x, y, z, shadow = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  put(G.receiver, MAT.rifle, 0, 0, 0.02, true);
  const grip = put(G.grip, furn, 0, -0.075, -0.06);
  grip.rotation.x = 0.4;
  let muzzleZ = 0.67;
  if (type === 'smg') {
    // stubby PDW: short handguard, suppressor swallowing the barrel stub,
    // long stick mag, collapsed stock, low-profile micro optic
    put(G.handguardSMG, furn, 0, 0, 0.25);
    put(G.barrel, MAT.rifle, 0, 0.005, 0.36).scale.set(1, 1, 0.5);
    put(G.suppressor, MAT.rifle, 0, 0.005, 0.44);
    const mag = put(G.magSMG, MAT.rifle, 0, -0.12, 0.09);
    mag.rotation.x = -0.12;
    put(G.stock, furn, 0, 0.002, -0.15).scale.set(0.9, 0.85, 0.55);
    put(G.optic, MAT.rifle, 0, 0.062, 0.03).scale.set(0.85, 0.7, 0.7);
    muzzleZ = 0.55;
  } else if (type === 'dmr') {
    // marksman rifle: free-float handguard + extended barrel, tall scope
    // box, stretched stock — silhouette clearly longer than the mk4
    put(G.handguard, furn, 0, 0, 0.33);
    put(G.barrelDMR, MAT.rifle, 0, 0.005, 0.66);
    put(G.muzzleDev, MAT.rifle, 0, 0.005, 0.9);
    const mag = put(G.mag, MAT.rifle, 0, -0.1, 0.06);
    mag.rotation.x = -0.18;
    mag.scale.set(1, 0.8, 1);
    put(G.stock, furn, 0, 0.002, -0.24).scale.set(1, 1.1, 1.25);
    put(G.scopeDMR, MAT.rifle, 0, 0.075, 0.02);
    muzzleZ = 0.94;
  } else {
    put(G.handguard, furn, 0, 0, 0.33);
    put(G.barrel, MAT.rifle, 0, 0.005, 0.56);
    put(G.muzzleDev, MAT.rifle, 0, 0.005, 0.63);
    const fgrip = put(G.foregrip, furn, 0, -0.065, 0.36);
    fgrip.rotation.x = 0.25;
    const mag = put(G.mag, MAT.rifle, 0, -0.105, 0.07);
    mag.rotation.x = -0.32;
    put(G.stock, furn, 0, 0.002, -0.22);
    put(G.optic, MAT.rifle, 0, 0.07, 0.06);
  }
  return { group: g, muzzleZ };
}

function buildSoldier(variantIdx, weaponType, bareFace) {
  const V = VARIANTS[variantIdx];
  // per-soldier kit rolls, independent of variant — breaks the clone-army read
  const kit = {
    goggles: Math.random() < 0.5,
    backpack: Math.random() < 0.6,
    nvg: Math.random() < 0.7,
    antenna: Math.random() < 0.6,
    // bare painted face vs balaclava; scripted shots pin it so the model-
    // inspection scenarios always show one of each
    balaclava: bareFace == null ? Math.random() < 0.55 : !bareFace,
    dropLegSide: Math.random() < 0.5 ? -1 : 1,
    gearYaw: (Math.random() < 0.5 ? -1 : 1) * (0.035 + Math.random() * 0.035), // 2–4°
    pouchShift: (Math.random() - 0.5) * 0.024,
  };
  // helmet cover tint drifts ±8% per soldier; only this material is cloned
  const helmetMat = V.helmet.clone();
  helmetMat.color.multiplyScalar(0.92 + Math.random() * 0.16);
  const heads = [], torsos = [], limbs = [];
  const mesh = (geo, mat, x, y, z, bucket, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    if (bucket) bucket.push(m);
    return m;
  };

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP_H;
  root.add(hips);

  // pelvis + battle belt kit — near-black belt line breaks torso from legs
  hips.add(mesh(G.pelvis, V.pants, 0, -0.04, 0, torsos));
  hips.add(mesh(G.belt, V.webbing, 0, 0.03, 0, null, false));
  hips.add(mesh(G.hipPouch, V.webbing, 0.185, -0.03, -0.02, null, false));
  hips.add(mesh(G.hipPouch, V.webbing, -0.185, -0.03, -0.02, null, false));
  hips.add(mesh(G.beltPouch, V.webbing, 0.09, -0.01, 0.12, null, false));
  hips.add(mesh(G.beltPouch, V.webbing, -0.09, -0.01, 0.12, null, false));

  // legs — pivot at hip, knee child pivot, boot on shin
  const mkLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0.135 * side, -0.02, 0);
    hip.rotation.z = -0.06 * side;
    hips.add(hip);
    hip.add(mesh(G.thigh, V.pants, 0, 0, 0, limbs));
    // drop-leg pouch on one outer thigh, side rolled per soldier
    if (side === kit.dropLegSide) hip.add(mesh(G.thighPouch, V.webbing, 0.1 * side, -0.24, 0.015, null, false));
    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    hip.add(knee);
    knee.add(mesh(G.shin, V.pants, 0, 0, 0, limbs));
    knee.add(mesh(G.kneepad, MAT.pad, 0, -0.055, 0.042, null, false));
    knee.add(mesh(G.boot, MAT.boot, 0, -0.4, 0.02, limbs));
    return { hip, knee };
  };
  const legR = mkLeg(-1);
  const legL = mkLeg(1);

  // torso: light camo shirt under a dark plate carrier, black webbing on top
  const torso = new THREE.Group();
  torso.position.y = 0.02;
  hips.add(torso);
  torso.add(mesh(G.torso, V.camo, 0, 0.27, 0, torsos));
  torso.add(mesh(G.carrier, V.carrier, 0, 0.3, 0, torsos));
  torso.add(mesh(G.collar, V.carrier, 0, 0.5, 0, null, false));
  // trapezius slope between shoulders and collar — visible above the carrier
  torso.add(mesh(G.trapPair, V.camo, 0, 0.505, -0.01, null, false));
  if (variantIdx === 0) {
    // triple mag rack + chest radio with whip antenna
    torso.add(mesh(G.pouch, V.webbing, -0.115 + kit.pouchShift, 0.155, 0.19, null, false));
    torso.add(mesh(G.pouch, V.webbing, kit.pouchShift, 0.155, 0.19, null, false));
    torso.add(mesh(G.pouch, V.webbing, 0.115 + kit.pouchShift, 0.155, 0.19, null, false));
    const radio = mesh(G.radio, V.webbing, 0.165, 0.395, 0.14, null, false);
    radio.rotation.y = kit.gearYaw;
    torso.add(radio);
    if (kit.antenna) {
      const ant = mesh(G.antenna, MAT.rifleFurniture, 0.165, 0.63, 0.1, null, false);
      ant.rotation.x = -0.22;
      torso.add(ant);
    }
  } else {
    // admin pouch + mag pouch, manpack radio on the back
    torso.add(mesh(G.pouchWide, V.webbing, -0.075 + kit.pouchShift, 0.16, 0.185, null, false));
    torso.add(mesh(G.pouch, V.webbing, 0.1 + kit.pouchShift, 0.15, 0.19, null, false));
    const backZ = kit.backpack ? -0.105 : 0; // ride on the pack face if worn
    const radio = mesh(G.radio, V.webbing, -0.1, 0.4, -0.185 + backZ, null, false);
    radio.rotation.y = kit.gearYaw;
    torso.add(radio);
    if (kit.antenna) {
      const ant = mesh(G.antenna, MAT.rifleFurniture, -0.1, 0.62, -0.22 + backZ, null, false);
      ant.rotation.x = 0.3;
      torso.add(ant);
    }
  }
  if (kit.backpack) {
    const pack = mesh(G.backpack, V.carrier, 0, 0.31, -0.2, null, false);
    pack.rotation.y = kit.gearYaw;
    torso.add(pack);
  }
  torso.add(mesh(G.strap, V.webbing, 0.13, 0.5, 0, null, false));
  torso.add(mesh(G.strap, V.webbing, -0.13, 0.5, 0, null, false));
  const sling = mesh(G.sling, V.webbing, 0.02, 0.3, 0.185, null, false);
  sling.rotation.z = 0.72;
  torso.add(sling);

  // head: two face variants under the same helmet — dark balaclava with a
  // skin strip at the eyes, or a bare face with camo paint, jaw and ears.
  // Both get real eyes (white hint + pupil), a brow shadow bar and a nose
  // wedge so the face reads at 2-10m.
  const headPiv = new THREE.Group();
  headPiv.position.set(0, 0.52, 0.01);
  torso.add(headPiv);
  const faceMat = kit.balaclava ? MAT.face : MAT.skin;
  headPiv.add(mesh(G.neck, faceMat, 0, 0.025, 0, null, false));
  headPiv.add(mesh(G.head, faceMat, 0, 0.13, 0, heads));
  headPiv.add(mesh(G.jaw, faceMat, 0, 0.052, 0.014, null, false));
  if (kit.balaclava) {
    // skin strip sits at the eye line BELOW the helmet rim so the face
    // actually reads (higher placements hide inside the helmet shell)
    headPiv.add(mesh(G.skinStrip, MAT.skin, 0, 0.1, 0.076, null, false));
  } else {
    headPiv.add(mesh(G.earPair, MAT.skin, 0, 0.128, -0.002, null, false));
    headPiv.add(mesh(G.paintPair, MAT.paint, 0, 0.082, 0.064, null, false));
    headPiv.add(mesh(G.mouth, MAT.lip, 0, 0.052, 0.077, null, false));
  }
  headPiv.add(mesh(G.scleraPair, MAT.eyeWhite, 0, 0.104, 0.0805, null, false));
  headPiv.add(mesh(G.pupilPair, MAT.pupil, 0, 0.104, 0.0855, null, false));
  headPiv.add(mesh(G.browBar, MAT.brow, 0, 0.129, 0.079, null, false));
  headPiv.add(mesh(G.nose, faceMat, 0, 0.083, 0.088, null, false));
  headPiv.add(mesh(G.helmet, helmetMat, 0, 0.19, 0, heads));
  headPiv.add(mesh(G.helmetRim, V.webbing, 0, 0.137, 0, null, false));
  const brim = mesh(G.brim, helmetMat, 0, 0.16, 0.155, null, false);
  brim.rotation.x = 0.12;
  headPiv.add(brim);
  if (kit.goggles) {
    headPiv.add(mesh(G.goggles, MAT.pad, 0, 0.24, 0.148, null, false));
  }
  if (kit.nvg) {
    headPiv.add(mesh(G.nvg, MAT.rifleFurniture, 0, 0.225, 0.165, null, false));
  }

  // arms — shoulder pivot, elbow pivot, hand on forearm
  const mkArm = (side) => {
    const sh = new THREE.Group();
    sh.position.set(0.235 * side, 0.475, 0);
    torso.add(sh);
    sh.add(mesh(G.shoulder, V.camo, 0, -0.01, 0, null, false));
    sh.add(mesh(G.shoulderPad, V.carrier, 0, 0.035, 0, null, false));
    sh.add(mesh(G.upperArm, V.camo, 0, 0, 0, limbs));
    const el = new THREE.Group();
    el.position.set(0, -0.3, 0);
    sh.add(el);
    el.add(mesh(G.forearm, V.camo, 0, 0, 0, limbs));
    return { sh, el };
  };
  const armR = mkArm(-1);
  const armL = mkArm(1);

  // rifle prop — held across the chest, +Z is muzzle direction; the
  // silhouette varies with the soldier's rolled weapon type
  const prop = buildRifleProp(weaponType, V.rifleFurn);
  const rifle = prop.group;
  torso.add(rifle);
  // gloved hands ride the weapon itself so the grip always reads: right hand
  // wraps the pistol grip, left hand cups the handguard
  const handR = mesh(G.hand, MAT.glove, 0, -0.1, -0.06, null, false);
  handR.rotation.x = 0.35;
  rifle.add(handR);
  const handL = mesh(G.hand, MAT.glove, 0, -0.055, weaponType === 'smg' ? 0.24 : 0.3, null, false);
  handL.rotation.x = 0.12;
  rifle.add(handL);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.005, prop.muzzleZ);
  rifle.add(muzzle);

  return {
    group: root,
    rig: {
      hips, torso, headPiv, rifle, muzzle,
      shR: armR.sh, elR: armR.el, shL: armL.sh, elL: armL.el,
      hipR: legR.hip, kneeR: legR.knee, hipL: legL.hip, kneeL: legL.knee,
    },
    heads, torsos, limbs,
  };
}

/* ==================================================== FOOTBALL MODE assets
 * "CR7 mode" (?football=1): the same rig reskinned as Ronaldo-style
 * footballers. Assets are built lazily on first spawn so normal mode pays
 * nothing. Playful parody: kit + slicked hair + athletic build, no gear. */

const KICK_HIT = 0.42; // wind-up time before ball contact
const KICK_DUR = 0.78; // full kick animation length

// SIUU goal celebration timeline (seconds from trigger)
const SIUU_CROUCH = 0.18; // hop-skip windup: knees load, arms swing back
const SIUU_LAND = 0.75;   // airborne 360° spin ends (apex ~0.9m mid-air)
const SIUU_ABSORB = 0.85; // landing knee absorb
const SIUU_HOLD = 1.95;   // held power stance ends
const SIUU_END = 2.25;    // blended back into the AI pose
const SIUU_JUMP = 0.9;    // jump apex height (m)

let FB = null;
function footballAssets() {
  if (FB) return FB;

  // new geometry gets a barely-there down-face AO so kits stay vivid
  const bakeSoft = (geo) => {
    const p = geo.attributes.position, n = geo.attributes.normal;
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const v = 1 - 0.14 * Math.max(0, -n.getY(i));
      c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return geo;
  };
  // reused soldier geometry keeps its shape but the baked AO is relaxed so
  // the saturated kit colours don't go muddy at the waist/armpits
  const soften = (geo) => {
    const g2 = geo.clone();
    const c = g2.attributes.color;
    for (let i = 0; i < c.count; i++) {
      const v = 0.66 + 0.34 * c.getX(i);
      c.setXYZ(i, v, v, v);
    }
    return g2;
  };

  const hair = new THREE.SphereGeometry(0.096, 14, 10, 0, Math.PI * 2, 0, 1.75);
  hair.scale(1, 0.95, 1.1);

  const cyl = (rt, rb, h, ty) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, 8);
    if (ty) g.translate(0, ty, 0);
    return g;
  };

  const geo = {
    torso: soften(G.torso), thigh: soften(G.thigh), shin: soften(G.shin),
    upperArm: soften(G.upperArm), forearm: soften(G.forearm),
    hand: soften(G.hand), shoulder: soften(G.shoulder),
    head: soften(G.head), neck: soften(G.neck),
    boot: soften(G.boot), collar: soften(G.collar),
    trapPair: soften(G.trapPair), jaw: soften(G.jaw), earPair: soften(G.earPair),
    nose: soften(G.nose), mouth: soften(G.mouth),
    scleraPair: soften(G.scleraPair), pupilPair: soften(G.pupilPair),
    hair: bakeSoft(hair),
    sleeve: bakeSoft(cyl(0.06, 0.054, 0.15, -0.075)),
    cuff: bakeSoft(cyl(0.057, 0.056, 0.022, 0)),
    // rounded glute/hip mass under the shorts (shared pelvis geometry) with
    // an elliptic waistband ring that actually wraps it
    shortsHip: soften(G.pelvis),
    waistband: bakeSoft(new THREE.CylinderGeometry(0.153, 0.153, 0.032, 14).scale(1.24, 1, 0.92)),
    shortsLeg: bakeSoft(cyl(0.092, 0.085, 0.17, -0.085)),
    stripe: bakeSoft(new THREE.BoxGeometry(0.012, 0.16, 0.05)),
    sockTop: bakeSoft(cyl(0.065, 0.063, 0.055, 0)),
    numBack: bakeSoft(new THREE.PlaneGeometry(0.19, 0.22)),
    numChest: bakeSoft(new THREE.PlaneGeometry(0.062, 0.072)),
    brow: bakeSoft(new THREE.BoxGeometry(0.034, 0.008, 0.013)),
  };

  // canvas-drawn shirt number — white "7", red-trimmed on the away kit
  const seven = (fill, outline) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.font = '900 200px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (outline) {
      ctx.lineWidth = 30;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = outline;
      ctx.strokeText('7', 128, 138);
    }
    ctx.fillStyle = fill;
    ctx.fillText('7', 128, 138);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  const numMat = (tex) => new THREE.MeshStandardMaterial({
    map: tex, transparent: true, alphaTest: 0.12, roughness: 0.85, metalness: 0,
    vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1,
  });
  const kit = (color, rough = 0.82) => new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: 0,
    normalMap: TEX.camo.normalMap, normalScale: new THREE.Vector2(0.3, 0.3),
    vertexColors: true,
  });

  const mats = {
    skin: new THREE.MeshStandardMaterial({ color: 0xc08a5f, roughness: 0.62, metalness: 0, vertexColors: true, emissive: 0x1e1206, emissiveIntensity: 1 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x1c150e, roughness: 0.42, metalness: 0, vertexColors: true }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a201a, roughness: 0.55, metalness: 0, vertexColors: true }),
  };

  const variants = [
    { // Portugal-style home: saturated red, white trim, bright green boots
      jersey: kit(0xd8112b), shorts: kit(0xb90e24), sock: kit(0xce1027),
      trim: kit(0xf2f1ec, 0.75),
      boots: new THREE.MeshStandardMaterial({ color: 0x27d148, roughness: 0.3, metalness: 0.05, vertexColors: true }),
      num: numMat(seven('#f4f4f2', null)),
    },
    { // white away kit: red trim, gold boots
      jersey: kit(0xf1f0e8), shorts: kit(0xf1f0e8), sock: kit(0xeceade),
      trim: kit(0xbe1023, 0.75),
      boots: new THREE.MeshStandardMaterial({ color: 0xe2b03a, roughness: 0.28, metalness: 0.45, vertexColors: true }),
      num: numMat(seven('#f4f4f2', '#b30f24')),
    },
    { // dark teal/black third kit: aqua trim, white 7 on deep teal
      jersey: kit(0x0e5a52), shorts: kit(0x12161b), sock: kit(0x0d453e),
      trim: kit(0x3bd8c0, 0.75),
      boots: new THREE.MeshStandardMaterial({ color: 0x181a20, roughness: 0.3, metalness: 0.3, vertexColors: true }),
      num: numMat(seven('#eafff9', '#06231f')),
    },
  ];

  FB = { geo, mats, variants };
  return FB;
}

function buildRonaldo(variantIdx) {
  const A = footballAssets();
  const FG = A.geo, M = A.mats;
  const V = A.variants[variantIdx];
  const heads = [], torsos = [], limbs = [];
  const mesh = (geo, mat, x, y, z, bucket, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    if (bucket) bucket.push(m);
    return m;
  };

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP_H;
  root.add(hips);

  // shorts block + contrasting waistband replace pelvis/belt kit
  hips.add(mesh(FG.shortsHip, V.shorts, 0, -0.05, 0, torsos));
  hips.add(mesh(FG.waistband, V.trim, 0, 0.055, 0, null, false));

  // legs: shorts leg over skin thigh, sock shin with turnover, bright boots
  const mkLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0.135 * side, -0.02, 0);
    hip.rotation.z = -0.06 * side;
    hips.add(hip);
    hip.add(mesh(FG.thigh, M.skin, 0, 0, 0, limbs));
    hip.add(mesh(FG.shortsLeg, V.shorts, 0, -0.035, 0, null, false));
    hip.add(mesh(FG.stripe, V.trim, 0.085 * side, -0.1, 0, null, false));
    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    hip.add(knee);
    knee.add(mesh(FG.shin, V.sock, 0, 0, 0, limbs));
    knee.add(mesh(FG.sockTop, V.trim, 0, -0.055, 0, null, false));
    knee.add(mesh(FG.boot, V.boots, 0, -0.4, 0.02, limbs));
    return { hip, knee };
  };
  const legR = mkLeg(-1);
  const legL = mkLeg(1);

  // torso: jersey with collar trim, big "7" on the back, small on the chest
  const torso = new THREE.Group();
  torso.position.y = 0.02;
  hips.add(torso);
  torso.add(mesh(FG.torso, V.jersey, 0, 0.27, 0, torsos));
  torso.add(mesh(FG.collar, V.trim, 0, 0.5, 0, null, false));
  torso.add(mesh(FG.trapPair, V.jersey, 0, 0.505, -0.01, null, false));
  const numB = mesh(FG.numBack, V.num, 0, 0.3, -0.121, null, false);
  numB.rotation.y = Math.PI;
  torso.add(numB);
  torso.add(mesh(FG.numChest, V.num, 0.055, 0.395, 0.119, null, false));

  // head: skin face with a defined jaw, ears, real eyes (whites + pupils),
  // nose wedge and mouth; dark slicked-back hair cap with a sheen
  const headPiv = new THREE.Group();
  headPiv.position.set(0, 0.52, 0.01);
  torso.add(headPiv);
  headPiv.add(mesh(FG.neck, M.skin, 0, 0.025, 0, null, false));
  headPiv.add(mesh(FG.head, M.skin, 0, 0.13, 0, heads));
  headPiv.add(mesh(FG.jaw, M.skin, 0, 0.05, 0.014, null, false));
  headPiv.add(mesh(FG.earPair, M.skin, 0, 0.128, -0.002, null, false));
  const hair = mesh(FG.hair, M.hair, 0, 0.155, -0.012, heads);
  hair.rotation.x = -0.24; // tilt back: high slicked hairline, covered nape
  headPiv.add(hair);
  headPiv.add(mesh(FG.scleraPair, MAT.eyeWhite, 0, 0.118, 0.0835, null, false));
  headPiv.add(mesh(FG.pupilPair, MAT.pupil, 0, 0.118, 0.0885, null, false));
  headPiv.add(mesh(FG.brow, M.hair, 0.0325, 0.143, 0.081, null, false));
  headPiv.add(mesh(FG.brow, M.hair, -0.0325, 0.143, 0.081, null, false));
  headPiv.add(mesh(FG.nose, M.skin, 0, 0.092, 0.089, null, false));
  headPiv.add(mesh(FG.mouth, MAT.lip, 0, 0.06, 0.076, null, false));

  // arms: short jersey sleeve with cuff trim over bare skin, bare hands
  const mkArm = (side) => {
    const sh = new THREE.Group();
    sh.position.set(0.235 * side, 0.475, 0);
    torso.add(sh);
    sh.add(mesh(FG.shoulder, V.jersey, 0, -0.01, 0, null, false));
    sh.add(mesh(FG.sleeve, V.jersey, 0, -0.005, 0, limbs));
    sh.add(mesh(FG.cuff, V.trim, 0, -0.148, 0, null, false));
    sh.add(mesh(FG.upperArm, M.skin, 0, 0, 0, limbs));
    const el = new THREE.Group();
    el.position.set(0, -0.3, 0);
    sh.add(el);
    el.add(mesh(FG.forearm, M.skin, 0, 0, 0, limbs));
    el.add(mesh(FG.hand, M.skin, 0, -0.31, 0, null, false));
    return { sh, el };
  };
  const armR = mkArm(-1);
  const armL = mkArm(1);

  // empty stand-ins keep the shared rig contract — no weapon in this mode
  const rifle = new THREE.Group();
  torso.add(rifle);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.35, 0.2);
  rifle.add(muzzle);

  return {
    group: root,
    rig: {
      hips, torso, headPiv, rifle, muzzle,
      shR: armR.sh, elR: armR.el, shL: armL.sh, elL: armL.el,
      hipR: legR.hip, kneeR: legR.knee, hipL: legL.hip, kneeL: legL.knee,
    },
    heads, torsos, limbs,
  };
}

/* ================================================================ manager */

export function createEnemyManager({ scene, world, fx, audio, hud, player }) {
  // CR7 mode is decided once, at construction — main.js sets the global first
  const FOOTBALL = !!window.__FOOTBALL__;
  let fbRef = null; // football projectile system, wired via .setFootballs(fb)

  const list = [];
  const targets = [];
  const claimedCover = new Set();

  let time = 0;
  let kills = 0;
  let waveNum = 0, waveSize = 0, toSpawn = 0, trickleT = 0, waveDelay = 0;
  let spawnCounter = 0, scriptedCount = 0;
  // LEVEL / DIFFICULTY progression state (see scaleFor / pickArchetype above)
  let level = 1, startLevel = 1, wavesCleared = 0, hudLevelShown = false;

  hud.setScore(0);

  // set the running level + drive the level HUD (guarded: hud may lack them)
  function applyLevel(newLevel, banner) {
    level = clamp(newLevel | 0, 1, MAX_LEVEL);
    hudLevelShown = true;
    hud.setLevel?.(level, diffName(level));
    if (banner) hud.levelBanner?.(level, diffName(level));
  }
  // main.js calls this BEFORE the first wave to start harder (default 1)
  function setStartLevel(n) {
    startLevel = clamp(Math.round(+n) || 1, 1, MAX_LEVEL);
    wavesCleared = 0;
    applyLevel(startLevel, false);
  }

  const KILL_LINES = [
    'Hostile down', 'Target neutralized', 'Enemy KIA',
    'Hostile eliminated', 'Contact dropped', 'Tango down',
  ];
  const FB_LINES = [
    'SIUUU!', 'GOOOAL!', 'CR7 down!', 'Hat-trick incoming!', 'CR7 down — SIUUU!',
  ];
  const RUNOVER_LINES = ['Roadkill!', 'Écrasé!', 'Hit and run!'];
  const RUNOVER_FB_LINES = ['Roadkill!', 'Écrasé!', 'Hit and run!', 'CR7 écrasé — SIUU?'];

  /* ------------------------------------------------------------ spawning */

  // archetype silhouette + colour tell, applied at spawn to LIVE enemies only.
  // Bulk/lean scale reads at range; a per-instance material tint (deduped, so
  // ~8 clones per soldier — spawn-time only, disposed when the corpse recycles)
  // darkens heavies / lightens rushers. Football keeps the vivid kit (scale is
  // the tell). Returns the cloned materials to dispose, or null.
  function applyArchetypeLook(S, arch) {
    const g = S.group;
    if (arch === 'heavy') { g.scale.x *= 1.16; g.scale.y *= 1.09; g.scale.z *= 1.16; }
    else { g.scale.x *= 0.9; g.scale.y *= 0.97; g.scale.z *= 0.9; } // rusher: lean
    if (FOOTBALL) return null;
    const mul = arch === 'heavy' ? 0.6 : 1.16;
    const map = new Map();
    const out = [];
    g.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.color) return;
      let m = map.get(o.material);
      if (!m) {
        m = o.material.clone();
        m.color.multiplyScalar(mul);
        if (arch === 'heavy' && m.emissive) m.emissive.multiplyScalar(0.6);
        map.set(o.material, m);
        out.push(m);
      }
      o.material = m;
    });
    return out;
  }

  // longer bursts as the level climbs; rushers keep bursts short (they trade
  // burst length for more frequent peeks — see startPeek)
  function archBurst(e, W) {
    let b = W.burst() + Math.round(e.sc.aggro * 2);
    if (e.arch === 'rusher') b = Math.max(2, b - 1);
    return b;
  }

  function spawnEnemy(pos, yaw, scripted) {
    // scripted screenshot enemies keep the historical two-variant cycle (so
    // the cr7/soldier shot staging never drifts) plus a deterministic
    // mk4/smg/dmr showcase; live spawns cycle all three variants and roll
    // weapon types 50/30/20
    const variant = scripted ? scriptedCount % 2 : spawnCounter++ % 3;
    let weapon = null;
    if (!FOOTBALL) {
      if (scripted) weapon = ['mk4', 'smg', 'dmr'][scriptedCount % 3];
      else {
        const r = Math.random();
        weapon = r < 0.5 ? 'mk4' : r < 0.8 ? 'smg' : 'dmr';
      }
    }
    // level / archetype shape LIVE wave spawns only; scripted screenshot
    // enemies stay at the identity so shot framing never drifts
    const sc = scripted ? IDENTITY_SCALE : scaleFor(level);
    const arch = scripted ? 'normal' : pickArchetype(sc.level);
    const A = ARCH[arch];

    const S = FOOTBALL
      ? buildRonaldo(variant)
      : buildSoldier(variant, weapon, scripted ? scriptedCount % 2 === 0 : null);
    S.group.position.set(pos.x, 0, pos.z);
    S.group.rotation.y = yaw;
    S.group.scale.setScalar(0.96 + Math.random() * 0.08); // height variation
    const clonedMats = arch !== 'normal' ? applyArchetypeLook(S, arch) : null;
    scene.add(S.group);

    // seeded idle-pose asymmetry so no two soldiers strike the same stance
    const seed = Math.random() * 10;
    const sr = (m) => { const v = Math.sin(seed * m + m) * 43758.5453; return v - Math.floor(v); };

    const e = {
      group: S.group, rig: S.rig,
      state: scripted ? 'combat' : 'patrol',
      phase: scripted ? 'peek' : 'hold',
      phaseT: 0.4 + Math.random() * 1.2,
      hp: 100 * sc.hp * A.hp,
      sc, arch, bodyMul: A.bodyMul, _clonedMats: clonedMats,
      scripted, counted: !scripted,
      yaw, targetYaw: yaw, aimYaw: yaw,
      vel: new THREE.Vector3(),
      dest: new THREE.Vector3(),
      destActive: false,
      speed: 0, speedMul: (0.9 + Math.random() * 0.2) * sc.speed * A.speed,
      coverIdx: -1,
      // senses
      losT: Math.random() * 0.25, hasLOS: false, lostT: 0,
      lastSeenPos: new THREE.Vector3().copy(pos),
      alertT: 0,
      // firing (football mode reuses shotT/burstsLeft for kick pacing)
      weapon,
      mag: weapon ? WEAPONS[weapon].mag : 25,
      burstLeft: 0, burstsLeft: 0, shotT: 0,
      kickT: -1, kicked: false,
      celebT: -1, celebYaw: 0, // SIUU celebration timer (-1 = inactive)
      strafeT: 0, strafeDir: 1, strafeC: 1.5 + Math.random() * 2,
      peekT: 0,
      // animation
      walkPhase: Math.random() * 6.28, moveAmp: 0,
      aim: scripted ? 1 : 0, aimTgt: scripted ? 1 : 0,
      crouch: 0, crouchTgt: 0,
      aimPitch: 0, aimPitchTgt: 0,
      twistS: 0, flinchT: 0, flinchS: 1, recoilT: 0,
      seed,
      poseLean: (sr(1.3) - 0.5) * 0.1,   // ±0.05 torso roll
      poseKnee: (sr(2.7) - 0.5) * 0.12,  // ±0.06 extra bend on one knee
      poseKneeL: sr(3.9) < 0.5,          // which knee takes it
      poseHead: (sr(5.1) - 0.5) * 0.08,  // ±0.04 head yaw bias
      // death
      deadT: 0, thudded: false, fallStyle: 'flat',
      fallAxis: new THREE.Vector3(1, 0, 0),
      fallDir: new THREE.Vector3(0, 0, 1),
      fallSpin: Math.random() < 0.5 ? -1 : 1,
      yawQ: new THREE.Quaternion(),
      snapT: 0, snapX: pos.x, snapZ: pos.z,
    };
    // capsule volume for football hits — pos is a live feet-position reference
    e.vol = { ref: e, pos: e.group.position, radius: 0.34, height: 1.8 };
    const tag = (arr, part) => {
      for (const m of arr) {
        m.userData.enemy = e;
        m.userData.part = part;
        targets.push(m);
      }
    };
    tag(S.heads, 'head');
    tag(S.torsos, 'torso');
    tag(S.limbs, 'limb');
    list.push(e);
    return e;
  }

  // rotate through a shuffled ordering of ALL spawn points so squads converge
  // from every direction instead of clumping at one random door
  let spawnOrder = [], spawnCursor = 0;
  function buildSpawnOrder() {
    const pts = world.enemySpawns || [];
    spawnOrder = pts.map((_, i) => i);
    for (let i = spawnOrder.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = spawnOrder[i]; spawnOrder[i] = spawnOrder[j]; spawnOrder[j] = t;
    }
    spawnCursor = 0;
  }

  function pickSpawnPoint() {
    const pts = world.enemySpawns;
    if (!pts || !pts.length) return null;
    if (spawnOrder.length !== pts.length) buildSpawnOrder();
    // walk the rotation; relax the player-distance rule only if a full lap
    // found nothing acceptable
    for (const minD of [22, 14, 0]) {
      for (let k = 0; k < spawnOrder.length; k++) {
        const p = pts[spawnOrder[(spawnCursor + k) % spawnOrder.length]];
        if (p.distanceTo(player.position) < minD) continue;
        let crowded = false;
        for (const e of list) {
          if (e.state !== 'dead' && e.group.position.distanceToSquared(p) < 6) { crowded = true; break; }
        }
        if (!crowded) {
          spawnCursor = (spawnCursor + k + 1) % spawnOrder.length;
          return p;
        }
      }
    }
    return pts[(Math.random() * pts.length) | 0];
  }

  function trySpawnOne() {
    if (toSpawn <= 0) return;
    const p = pickSpawnPoint();
    if (!p) return;
    toSpawn--;
    _a.set(p.x + (Math.random() - 0.5) * 1.2, 0, p.z + (Math.random() - 0.5) * 1.2);
    const yaw = Math.atan2(player.position.x - _a.x, player.position.z - _a.z);
    spawnEnemy(_a, yaw, false);
  }

  function spawnWave(n) {
    waveNum++;
    // surface the level indicator on the first live wave even if main.js never
    // called setStartLevel (no-op in scripted shot scenarios: they never spawn
    // a wave, so the level UI stays hidden and framing never drifts)
    if (!hudLevelShown) applyLevel(level, false);
    // floor 12, hard cap 24 alive-per-wave — the street stays crowded
    waveSize = clamp(n, 12, 24);
    toSpawn = waveSize;
    buildSpawnOrder();
    const burst = Math.min(toSpawn, 5); // rest trickles in fast (no hitch)
    for (let i = 0; i < burst; i++) trySpawnOne();
    if (waveNum > 1) hud.killfeed('Wave ' + waveNum + ' inbound');
  }

  function spawnAt(pos, yaw) {
    const e = spawnEnemy(pos, yaw, true);
    // deterministic-ish staged fire so screenshot frames catch flashes/tracers
    e.burstLeft = 4;
    e.shotT = 0.35 + scriptedCount * 0.22;
    if (FOOTBALL) e.shotT = 0.3 + scriptedCount * 0.35; // staggered kick wind-ups
    scriptedCount++;
    // pose immediately: combat aim, weapon shouldered
    e.aim = 1; e.aimTgt = 1;
    animate(e, 0.016);
    e.group.updateMatrixWorld(true);
    return e;
  }

  /* ------------------------------------------------------------ cover */

  function freeCover(e) {
    if (e.coverIdx >= 0) { claimedCover.delete(e.coverIdx); e.coverIdx = -1; }
  }

  function goToCover(e) {
    freeCover(e);
    const W = wpn(e); // per-type ranges; mk4 defaults = pre-arsenal numbers
    // RUSHER archetype hunts cover much closer to the player and always closes
    const rush = e.arch === 'rusher';
    const prefCover = rush ? Math.min(W.prefCover, 9) : W.prefCover;
    const closeBias = rush || W.closeBias;
    const cps = world.coverPoints;
    const ep = e.group.position, pp = player.position;
    const myD = ep.distanceTo(pp);
    let best = -1, bestScore = 1e9;
    for (let i = 0; i < cps.length; i++) {
      if (claimedCover.has(i)) continue;
      const cp = cps[i];
      const dP = cp.distanceTo(pp);
      if (dP < 6 || dP > Math.max(W.maxCover, myD)) continue;
      const dE = cp.distanceTo(ep);
      if (dE < 0.8) continue;
      let score = dE + Math.abs(dP - prefCover) * 0.7 + Math.random() * 4;
      if (closeBias && dP > myD - 1) score += 10; // prefer closing distance
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) {
      claimedCover.add(best);
      e.coverIdx = best;
      e.dest.copy(cps[best]);
      e.dest.x += (Math.random() - 0.5) * 0.5;
      e.dest.z += (Math.random() - 0.5) * 0.5;
      e.destActive = true;
      e.phase = 'advance';
      e.crouchTgt = 0.15;
    } else {
      startPeek(e);
    }
  }

  /* ------------------------------------------------------------ senses */

  function checkLOS(e) {
    const p = e.group.position;
    _a.set(p.x, p.y + 1.56 - e.crouch * 0.42, p.z);
    const eye = player.getEyePos();
    _d.subVectors(eye, _a);
    const dist = _d.length();
    if (dist < 0.6) return true;
    _d.multiplyScalar(1 / dist);
    _ray.set(_a, _d);
    _ray.near = 0.05;
    _ray.far = dist - 0.5;
    return _ray.intersectObjects(world.raycastMeshes, false).length === 0;
  }

  function enterCombat(e) {
    if (e.state === 'dead' || e.state === 'combat') return;
    e.state = 'combat';
    e.hasLOS = true;
    e.lostT = 0;
    e.lastSeenPos.copy(player.position);
    e.mag = wpn(e).mag;
    const d = e.group.position.distanceTo(player.position);
    // Ronaldos open with the kick, not the cover sprint
    if (FOOTBALL ? d < 30 && Math.random() < 0.8 : d < 20 && Math.random() < 0.5) startPeek(e);
    else goToCover(e);
    // shout: nearby patrols go alert
    for (const o of list) {
      if (o !== e && !o.scripted && o.state === 'patrol' &&
          o.group.position.distanceToSquared(e.group.position) < 400) {
        o.state = 'alert';
        o.alertT = 0;
        o.lastSeenPos.copy(player.position);
        o.destActive = false;
      }
    }
  }

  function senses(e) {
    if (!player.alive) return;
    const p = e.group.position;
    const dx = player.position.x - p.x, dz = player.position.z - p.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (e.state === 'combat') {
      if (dist < 60) {
        e.hasLOS = checkLOS(e);
        if (e.hasLOS) { e.lastSeenPos.copy(player.position); e.lostT = 0; }
      } else e.hasLOS = false;
      return;
    }
    if (dist > 45) return;
    const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - e.yaw));
    const inCone = ang < 0.87; // ~100° total cone
    const alertClose = e.state === 'alert' && dist < 30;
    if ((inCone || alertClose) && checkLOS(e)) enterCombat(e);
  }

  // player gunfire is "heard" — nearby patrols investigate
  function onNoise(ev) {
    if (ev.button !== 0) return;
    if (!document.pointerLockElement && !window.__SHOT_MODE__) return;
    if (!player.alive) return;
    for (const e of list) {
      if (e.scripted || e.state === 'dead' || e.state === 'combat') continue;
      if (e.group.position.distanceToSquared(player.position) < 35 * 35) {
        if (e.state !== 'alert') { e.state = 'alert'; e.alertT = 0; e.destActive = false; }
        else e.alertT = Math.min(e.alertT, 4);
        e.lastSeenPos.set(
          player.position.x + (Math.random() - 0.5) * 3, 0,
          player.position.z + (Math.random() - 0.5) * 3);
      }
    }
  }
  window.addEventListener('mousedown', onNoise);

  /* ------------------------------------------------------------ firing */

  function fireRound(e) {
    const rig = e.rig;
    rig.muzzle.getWorldPosition(_muz);
    if (e.scripted) {
      // fire along facing — staged tracers for the screenshot harness
      const dist = 26 + Math.random() * 18;
      _end.set(
        _muz.x + Math.sin(e.yaw) * dist + (Math.random() - 0.5) * 1.6,
        _muz.y + (Math.random() - 0.5) * 0.8,
        _muz.z + Math.cos(e.yaw) * dist + (Math.random() - 0.5) * 1.6);
    } else {
      const W = wpn(e); // dmr: rarer but heavier + truer shots
      const eye = player.getEyePos();
      const dist = _muz.distanceTo(eye);
      // level scales the base hit chance (cap keeps 0.18*sc.chance <= ~0.486)
      let chance = 0.18 * e.sc.chance * W.acc * clamp(1.25 - dist / 55, 0.3, 1.1);
      if (player.isSprinting) chance *= 0.65;          // hard to track
      if (player.adsLevel > 0.5) chance *= 1.15;       // slow, planted target
      if (eye.y - player.position.y < 1.3) chance *= 0.7; // crouched: small
      if (Math.random() < chance) {
        _end.copy(eye);
        _end.x += (Math.random() - 0.5) * 0.1;
        _end.y += (Math.random() - 0.5) * 0.1;
        _end.z += (Math.random() - 0.5) * 0.1;
        player.takeDamage(W.dmg() * e.sc.dmg, e.group.position);
      } else {
        // near miss: perpendicular scatter growing with range, snap past player
        _d.subVectors(eye, _muz);
        const h = Math.max(0.001, Math.hypot(_d.x, _d.z));
        _b.set(-_d.z / h, 0, _d.x / h);
        const off = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * (0.5 + dist * 0.045));
        _end.copy(eye)
          .addScaledVector(_b, off)
          .add(_a.set(0, (Math.random() - 0.4) * (0.3 + dist * 0.02), 0));
        _d.subVectors(_end, _muz).normalize();
        _end.copy(_muz).addScaledVector(_d, dist + 4 + Math.random() * 14);
        if (Math.random() < 0.2) {
          _a.copy(eye).addScaledVector(_b, off * 0.5);
          audio.ricochet(_a);
        }
      }
    }
    _d.subVectors(_end, _muz).normalize();
    fx.muzzleFlash(_muz, _d);
    fx.tracer(_muz, _end);
    audio.enemyGunshot(_muz);
    e.recoilT = e.weapon === 'dmr' ? 0.15 : 0.09; // heavier visual kick
  }

  /* -------------------------------------------------- football kicks
   * CR7 mode attack: no gunfire, no flash, no tracer — a lobbed football.
   * Lead the player by flight time and solve the low-arc launch elevation
   * for the range (speed 19-22, backspin lift folded in) so kicks from
   * 10-30m genuinely threaten. Scripted spawnAt enemies keep the original
   * 18 m/s lob so screenshot scenarios stay frame-stable. */

  function launchKick(e) {
    if (!fbRef) return;
    const ep = e.group.position;
    if (e.scripted) {
      // legacy lob — scripted spawnAt enemies keep the exact historical
      // trajectory so cr7/cr7close/cr7siuu screenshot framing never drifts
      _muz.set(ep.x + Math.sin(e.yaw) * 0.42, 0.45, ep.z + Math.cos(e.yaw) * 0.42);
      const dist = Math.hypot(player.position.x - _muz.x, player.position.z - _muz.z);
      const tf = dist / 15; // ~horizontal ball speed once elevated
      _end.set(
        player.position.x + player.velocity.x * tf * 0.8,
        player.position.y + 1.1,
        player.position.z + player.velocity.z * tf * 0.8);
      _d.subVectors(_end, _muz);
      const dh = _d.y;
      const hDist = Math.max(1, Math.hypot(_d.x, _d.z));
      // ballistic elevation for a flat range at 18 m/s + height correction
      let elev = 0.5 * Math.asin(clamp(9.8 * hDist / (18 * 18), 0, 1))
        + Math.atan2(dh, hDist) * 0.85;
      elev = clamp(elev, 0.03, 0.75);
      const ce = Math.cos(elev) / hDist;
      _d.set(_d.x * ce, Math.sin(elev), _d.z * ce);
      // ownerRef rides the ball so onPlayerHit can credit (and SIUU) the scorer
      fbRef.kick(_muz, _d, 18, (Math.random() - 0.5) * 3, 'enemy', e);
      audio.kickAt?.(_muz);
      return;
    }
    // live AI: chest-high volley (SPEC's chestPos — the old shin-high launch
    // slammed straight into the cover the kicker was peeking over), hotter and
    // flatter low-arc solve, honest flight-time lead, tame curve. Backspin
    // Magnus lift (~+1 m/s²) is folded into the effective gravity so long
    // kicks stop sailing over the target.
    _muz.set(ep.x + Math.sin(e.yaw) * 0.45, 1.05, ep.z + Math.cos(e.yaw) * 0.45);
    const dist = Math.hypot(player.position.x - _muz.x, player.position.z - _muz.z);
    const v = clamp(16.5 + dist * 0.28, 19, 22); // flat rockets in close, 22 at range
    const tf = dist / (v * 0.92);                // ≈ flight time for the lead
    _end.set(
      player.position.x + player.velocity.x * tf,
      player.position.y + 0.75 + Math.random() * 0.5,
      player.position.z + player.velocity.z * tf);
    _d.subVectors(_end, _muz);
    // human feet, not aimbots: lateral scatter grows with range so roughly a
    // third to a half of kicks land — the rest whizz past close enough to scare
    const h0 = Math.max(1, Math.hypot(_d.x, _d.z));
    const err = (Math.random() * 2 - 1) * (0.35 + dist * 0.075);
    _end.x += (-_d.z / h0) * err;
    _end.z += (_d.x / h0) * err;
    _d.subVectors(_end, _muz);
    const dh = _d.y;
    const hDist = Math.max(1, Math.hypot(_d.x, _d.z));
    const g = 8.8, v2 = v * v; // 9.8 minus backspin lift
    const disc = v2 * v2 - g * (g * hDist * hDist + 2 * dh * v2);
    let elev = disc > 0
      ? Math.atan((v2 - Math.sqrt(disc)) / (g * hDist)) // exact low arc
      : 0.6;                                            // out of reach: max loft
    elev = clamp(elev, 0.02, 0.6);
    const ce = Math.cos(elev) / hDist;
    _d.set(_d.x * ce, Math.sin(elev), _d.z * ce);
    // ownerRef rides the ball so onPlayerHit can credit (and SIUU) the scorer
    fbRef.kick(_muz, _d, v, (Math.random() - 0.5) * 1.1, 'enemy', e);
    audio.kickAt?.(_muz);
  }

  // advances an active kick; launches the ball at contact. False when done.
  function stepKick(e, dt) {
    e.kickT += dt;
    if (!e.kicked && e.kickT >= KICK_HIT) { e.kicked = true; launchKick(e); }
    if (e.kickT >= KICK_DUR) { e.kickT = -1; return false; }
    return true;
  }

  /* ---------------------------------------------------- SIUU celebration
   * Scored on the player: hop-skip windup, high jump with a mid-air 360°
   * yaw spin (arms flung wide, then sweeping), landing planted in the
   * signature power stance — legs wide, chest out, head down, both arms
   * swept down-back-out. Held ~1.1s, then blended back into the AI.
   * While active the celebration owns the rig: no movement, no kicks, no
   * flinch — but kill()/knockdown() still override cleanly. */

  function celebrate(ref) {
    if (!FOOTBALL || !ref || ref.celebT >= 0 || ref.state === 'dead') return false;
    if (list.indexOf(ref) < 0) return false;
    ref.celebT = 0;
    ref.celebYaw = ref.yaw;
    ref.kickT = -1;    // abort any kick mid-wind-up (ball never launches)
    ref.kicked = false;
    ref.shotT = Math.max(ref.shotT, 1.4); // no instant kick out of the pose
    ref.vel.set(0, 0, 0);
    ref.speed = 0;
    ref.strafeT = 0;
    ref.flinchT = 0;
    return true;
  }

  function stepCelebrate(e, dt) {
    const prev = e.celebT;
    e.celebT += dt;
    e.flinchT = 0; // celebrations shrug off incoming balls (death still wins)
    const t = e.celebT;
    const r = e.rig;
    if (t >= SIUU_END) {
      e.celebT = -1;
      r.hipR.rotation.z = 0.06;   // exact build-time leg splay restored
      r.hipL.rotation.z = -0.06;
      animate(e, dt);
      return;
    }

    // base standing pose first (keeps aim/crouch easing alive so the
    // blend-out below lands on whatever the AI wants next)
    e.targetYaw = e.yaw;
    e.aimYaw = e.yaw;
    animate(e, dt);

    // ---- choreography targets for this instant
    let hipsY = 0, spin = 0, wide = 0;
    let hipX = 0, hipXR = 0, hipXL = 0, kneeX = 0.1;
    let torsoX = 0, headX = 0, shX = 0, shOut = 0, elX = -0.3;
    if (t < SIUU_CROUCH) {
      // windup: quick hop-skip dropping into a loaded crouch, arms back
      const u = t / SIUU_CROUCH;
      hipsY = u < 0.35 ? 0.05 * Math.sin((u / 0.35) * Math.PI)
        : -0.3 * ((u - 0.35) / 0.65);
      hipX = -0.6 * u; kneeX = 0.1 + 1.15 * u;
      torsoX = 0.3 * u; headX = 0.12 * u;
      shX = 0.75 * u; shOut = 0.18 * u; elX = -0.3;
    } else if (t < SIUU_LAND) {
      // airborne: parabolic jump + full 360° yaw spin; legs scissor for a
      // dynamic silhouette, arms fling out wide then sweep toward landing
      const u = (t - SIUU_CROUCH) / (SIUU_LAND - SIUU_CROUCH);
      hipsY = SIUU_JUMP * 4 * u * (1 - u);
      spin = u * Math.PI * 2;
      const legU = clamp(u * 1.4, 0, 1);
      hipX = lerp(-0.55, -0.08, legU);
      kneeX = lerp(1.15, 0.15, legU);
      hipXR = -0.35 * Math.sin(u * Math.PI);
      hipXL = 0.18 * Math.sin(u * Math.PI);
      torsoX = lerp(0.3, -0.24, clamp(u * 1.7, 0, 1));
      headX = lerp(0.12, 0.24, u);
      if (u < 0.45) {
        const v = u / 0.45;
        shX = lerp(0.75, 0.05, v); shOut = lerp(0.18, 1.3, v);
      } else {
        const v = (u - 0.45) / 0.55;
        shX = lerp(0.05, 0.82, v); shOut = lerp(1.3, 0.6, v);
      }
      elX = lerp(-0.45, -0.08, u);
      wide = clamp((u - 0.6) / 0.4, 0, 1); // legs open ahead of touchdown
    } else {
      // land absorb -> the held SIUU power stance (blend-out handled by f)
      const u = t < SIUU_ABSORB ? (t - SIUU_LAND) / (SIUU_ABSORB - SIUU_LAND) : 1;
      const dip = t < SIUU_ABSORB ? Math.sin(u * Math.PI) : 0;
      wide = 1;
      hipsY = -0.07 - 0.16 * dip;
      hipX = -0.07 - 0.25 * dip;
      kneeX = 0.14 + 0.5 * dip;
      torsoX = -0.22 + 0.1 * dip           // chest out
        + Math.sin(time * 2.1 + e.seed) * 0.015; // held pose breathes
      headX = 0.3;                          // head slightly down
      shX = 0.85; shOut = 0.62; elX = -0.06; // arms swept down-back-out
    }
    if (prev < SIUU_LAND && t >= SIUU_LAND) {
      fx.impact(e.group.position, _a.set(0, 1, 0), 'dirt'); // landing dust
      audio.bodyFall?.(); // planted thud — no new audio methods
    }

    // ---- apply over the base pose; f eases the overlay out after the hold
    const f = t > SIUU_HOLD ? 1 - (t - SIUU_HOLD) / (SIUU_END - SIUU_HOLD) : 1;
    e.yaw = wrapAngle(e.celebYaw + spin);
    e.targetYaw = e.yaw;
    e.group.rotation.y = e.yaw;
    r.hips.position.y += hipsY * f;
    poseTo(r.hipR, 'x', hipX + hipXR, f); poseTo(r.hipL, 'x', hipX + hipXL, f);
    poseTo(r.kneeR, 'x', kneeX, f); poseTo(r.kneeL, 'x', kneeX * 0.92, f);
    r.hipR.rotation.z = lerp(0.06, -0.32 * wide, f);
    r.hipL.rotation.z = lerp(-0.06, 0.32 * wide, f);
    poseTo(r.torso, 'x', torsoX, f); poseTo(r.torso, 'y', 0, f);
    poseTo(r.headPiv, 'x', headX, f); poseTo(r.headPiv, 'y', 0, f);
    poseTo(r.shR, 'x', shX, f); poseTo(r.shR, 'z', -shOut, f);
    poseTo(r.shL, 'x', shX, f); poseTo(r.shL, 'z', shOut, f);
    poseTo(r.elR, 'x', elX, f); poseTo(r.elL, 'x', elX, f);
  }

  function startPeek(e) {
    e.phase = 'peek';
    e.peekT = 0;
    e.destActive = false;
    e.aimTgt = 1;
    if (FOOTBALL) {
      // kicks instead of bursts: 2-3 kicks per peek, athletic upright stance;
      // higher levels wind up faster (aggro), rushers kick one extra time
      e.crouchTgt = 0.05;
      e.burstsLeft = 2 + ((Math.random() * 2) | 0) + (e.arch === 'rusher' ? 1 : 0);
      e.shotT = (0.25 + Math.random() * 0.4) * (1 - 0.45 * e.sc.aggro);
      return;
    }
    const W = wpn(e);
    e.crouchTgt = 0.1;
    // rushers peek more often (shorter bursts); higher levels open fire sooner
    e.burstsLeft = W.peekBursts() + (e.arch === 'rusher' ? 1 : 0);
    e.burstLeft = archBurst(e, W);
    e.shotT = W.firstShot() * (1 - 0.45 * e.sc.aggro);
  }

  function reposition(e) {
    const d = e.group.position.distanceTo(player.position);
    if (FOOTBALL) {
      // striker temperament: at working range stay planted and keep the balls
      // coming — cover-running was eating ~90% of combat time (measured)
      if (d > 26 || Math.random() < 0.25) goToCover(e);
      else {
        e.phase = 'hold';
        e.phaseT = 0.35 + Math.random() * 0.5;
        e.crouchTgt = 0.15;
        e.aimTgt = 0.85;
        e.destActive = false;
      }
      return;
    }
    // smg pushes until inside 18m; dmr holds range and mostly repositions
    // in place; mk4 keeps the original 16m / 45% numbers. RUSHERS rarely hold
    // and keep pushing in — hold odds cut hard, hold range extended.
    const W = wpn(e);
    const rush = e.arch === 'rusher';
    const holdAt = rush ? W.holdAt + 12 : W.holdAt;
    const holdOdds = rush ? W.holdOdds * 0.25 : W.holdOdds;
    if (d > holdAt || Math.random() < holdOdds) goToCover(e);
    else {
      e.phase = 'hold';
      e.phaseT = 0.7 + Math.random() * 0.9;
      e.crouchTgt = 0.85;
      e.aimTgt = 0.7;
      e.destActive = false;
    }
  }

  /* ------------------------------------------------------------ AI states */

  function updatePatrol(e, dt) {
    e.aimTgt = 0;
    e.crouchTgt = 0;
    if (e.phase === 'hold' || !e.destActive) {
      e.speed = 0;
      e.phaseT -= dt;
      if (e.phaseT <= 0) {
        const cps = world.coverPoints;
        for (let tries = 0; tries < 6; tries++) {
          const cp = cps[(Math.random() * cps.length) | 0];
          if (cp.distanceTo(e.group.position) > 6) {
            e.dest.set(cp.x + (Math.random() - 0.5), 0, cp.z + (Math.random() - 0.5));
            e.destActive = true;
            e.phase = 'move';
            break;
          }
        }
        e.phaseT = 2 + Math.random() * 2;
      }
    } else {
      e.speed = 1.5 * e.speedMul;
      if (arrived(e)) {
        e.destActive = false;
        e.phase = 'hold';
        e.phaseT = 1.5 + Math.random() * 2.5;
      }
    }
  }

  function updateAlert(e, dt) {
    e.aimTgt = 0.45;
    e.crouchTgt = 0;
    e.alertT += dt;
    if (!e.destActive) {
      e.dest.set(
        e.lastSeenPos.x + (Math.random() - 0.5) * 4, 0,
        e.lastSeenPos.z + (Math.random() - 0.5) * 4);
      e.destActive = true;
      e.phase = 'move';
      e.phaseT = 1.4 + Math.random();
    }
    if (e.phase === 'move') {
      e.speed = 2.4 * e.speedMul;
      if (arrived(e)) { e.phase = 'hold'; e.speed = 0; e.phaseT = 1.4 + Math.random(); }
    } else {
      e.speed = 0;
      e.phaseT -= dt;
      if (e.phaseT <= 0) e.destActive = false; // search another nearby point
    }
    if (e.alertT > 12) {
      e.state = 'patrol';
      e.destActive = false;
      e.phase = 'hold';
      e.phaseT = 1;
    }
  }

  function updateCombat(e, dt) {
    const ep = e.group.position;
    if (!player.alive) {
      e.aimTgt = 0.35; e.crouchTgt = 0; e.speed = 0; e.destActive = false;
      e.aimPitchTgt = 0;
      return;
    }
    const tp = e.hasLOS ? player.position : e.lastSeenPos;
    const dx = tp.x - ep.x, dz = tp.z - ep.z;
    const hDist = Math.max(0.001, Math.hypot(dx, dz));
    e.aimYaw = Math.atan2(dx, dz);
    e.aimPitchTgt = Math.atan2(tp.y + 1.45 - 1.38, hDist);
    const pDist = ep.distanceTo(player.position);

    if (!e.hasLOS) e.lostT += dt;
    if (e.lostT > 7) {
      freeCover(e);
      e.state = 'alert';
      e.alertT = 0;
      e.destActive = false;
      return;
    }

    switch (e.phase) {
      case 'advance': {
        e.speed = 3.4 * e.speedMul;
        e.aimTgt = 0.55;
        // striker instinct: a clear look at working range beats finishing the
        // run to cover (expected interrupt ~1.5s into an advance)
        if (FOOTBALL && e.hasLOS && pDist < 24 && Math.random() < dt * 0.7) {
          freeCover(e);
          startPeek(e);
          break;
        }
        if (arrived(e)) {
          e.destActive = false;
          e.speed = 0;
          e.phase = 'hold';
          e.phaseT = 0.5 + Math.random() * 0.9;
          e.crouchTgt = 0.85;
        } else if (pDist < 8) startPeek(e);
        break;
      }
      case 'hold': {
        e.speed = 0;
        e.targetYaw = e.aimYaw;
        e.aimTgt = 0.7;
        e.phaseT -= dt;
        if (e.phaseT <= 0) startPeek(e);
        break;
      }
      case 'peek': {
        e.speed = 0;
        e.targetYaw = e.aimYaw;
        e.aimTgt = 1;
        e.crouchTgt = FOOTBALL ? 0.05 : 0.1;
        e.peekT += dt;
        // occasional strafe step
        e.strafeC -= dt;
        if (e.strafeC <= 0) {
          e.strafeC = 1.2 + Math.random() * 2.2;
          if (Math.random() < 0.5) {
            e.strafeT = 0.4 + Math.random() * 0.25;
            e.strafeDir = Math.random() < 0.5 ? -1 : 1;
          }
        }
        if (FOOTBALL) {
          // kick attack: wind-up -> ball at contact -> 2.2-3.5s cooldown.
          // Requires LOS ≤ 40m and a wired projectile system (else no attack).
          if (e.kickT >= 0) {
            if (!stepKick(e, dt)) {
              e.burstsLeft--;
              e.shotT = (1.8 + Math.random() * 1.0) * (1 - 0.4 * e.sc.aggro);
              if (e.burstsLeft <= 0) reposition(e);
            }
          } else if (e.hasLOS && pDist <= 40 && fbRef) {
            e.shotT -= dt;
            if (e.shotT <= 0) { e.kickT = 0; e.kicked = false; }
          } else if (e.peekT > 1.6) {
            reposition(e);
          }
          break;
        }
        if (e.mag <= 0) {
          e.phase = 'reload';
          e.phaseT = 2.2 * (1 - 0.35 * e.sc.aggro); // faster reloads as level rises
          e.crouchTgt = 0.8;
          e.aimTgt = 0.45;
          break;
        }
        const W = wpn(e);
        if (e.hasLOS && pDist < W.range) {
          e.shotT -= dt;
          if (e.shotT <= 0) {
            if (e.burstLeft > 0) {
              fireRound(e);
              e.mag--;
              e.burstLeft--;
              e.shotT = W.roundDelay();
              if (e.burstLeft === 0) {
                e.burstsLeft--;
                e.shotT = W.burstDelay() * (1 - 0.4 * e.sc.aggro); // tighter pacing
              }
            } else if (e.burstsLeft > 0) {
              e.burstLeft = archBurst(e, W);
            } else {
              reposition(e);
            }
          }
        } else if (e.peekT > 1.6) {
          reposition(e);
        }
        break;
      }
      case 'reload': {
        e.speed = 0;
        e.targetYaw = e.aimYaw;
        e.phaseT -= dt;
        if (e.phaseT <= 0) {
          e.mag = wpn(e).mag;
          e.phase = 'hold';
          e.phaseT = 0.3;
        }
        break;
      }
      default:
        goToCover(e);
    }
  }

  function updateScripted(e, dt) {
    // frozen combat pose at exact spawn yaw; fires blanks downrange.
    // __enemyRest is a shot-harness hook to inspect the low-ready pose.
    e.aimTgt = window.__enemyRest ? 0 : 1;
    e.aimPitchTgt = 0;
    e.targetYaw = e.yaw;
    e.speed = 0;
    if (window.__enemyRest) return;
    if (FOOTBALL) {
      // staged kick loop for the shot harness — never gunfire in this mode
      if (e.kickT >= 0) {
        if (!stepKick(e, dt)) e.shotT = 2.4 + (e.seed % 1) * 0.8;
      } else {
        e.shotT -= dt;
        if (e.shotT <= 0) { e.kickT = 0; e.kicked = false; }
      }
      return;
    }
    e.shotT -= dt;
    if (e.shotT <= 0) {
      if (e.burstLeft > 0) {
        fireRound(e);
        e.burstLeft--;
        e.shotT = 0.11;
      } else {
        e.burstLeft = 4;
        e.shotT = 0.85 + (e.seed % 1) * 0.5;
      }
    }
  }

  /* ------------------------------------------------------------ movement */

  function arrived(e) {
    const p = e.group.position;
    const dx = e.dest.x - p.x, dz = e.dest.z - p.z;
    return dx * dx + dz * dz < 0.55;
  }

  function collideAxis(e, axis) {
    const pos = e.group.position, r = 0.33;
    const cols = world.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.max.y < 0.4 || c.min.y > 1.6) continue; // step over / duck under
      if (pos.x + r <= c.min.x || pos.x - r >= c.max.x) continue;
      if (pos.z + r <= c.min.z || pos.z - r >= c.max.z) continue;
      if (axis === 0) {
        const pushPos = c.max.x + r - pos.x, pushNeg = pos.x - (c.min.x - r);
        pos.x = pushPos < pushNeg ? c.max.x + r : c.min.x - r;
      } else {
        const pushPos = c.max.z + r - pos.z, pushNeg = pos.z - (c.min.z - r);
        pos.z = pushPos < pushNeg ? c.max.z + r : c.min.z - r;
      }
    }
  }

  function locomote(e, dt) {
    const pos = e.group.position;
    _a.set(0, 0, 0);
    if (e.destActive && e.speed > 0) {
      _a.set(e.dest.x - pos.x, 0, e.dest.z - pos.z);
      const d = Math.hypot(_a.x, _a.z);
      if (d > 0.02) {
        let s = e.speed / d;
        if (d < 1.2) s *= Math.max(0.35, d / 1.2); // ease into arrival
        _a.multiplyScalar(s);
      } else _a.set(0, 0, 0);
    }
    if (e.strafeT > 0) {
      e.strafeT -= dt;
      _a.x += Math.cos(e.yaw) * e.strafeDir * 1.3;
      _a.z += -Math.sin(e.yaw) * e.strafeDir * 1.3;
    }
    const k = Math.min(1, dt * 8);
    e.vel.x += (_a.x - e.vel.x) * k;
    e.vel.z += (_a.z - e.vel.z) * k;
    pos.x += e.vel.x * dt;
    collideAxis(e, 0);
    pos.z += e.vel.z * dt;
    collideAxis(e, 1);
    pos.y = 0;

    // face movement direction while traveling (combat aims override elsewhere)
    const sp = Math.hypot(e.vel.x, e.vel.z);
    if (sp > 0.4 && (e.state === 'patrol' || e.state === 'alert' || e.phase === 'advance')) {
      e.targetYaw = Math.atan2(e.vel.x, e.vel.z);
      if (e.state === 'combat' && e.group.position.distanceTo(player.position) < 12) {
        e.targetYaw = e.aimYaw;
      }
    }

    // stuck? repick destination
    e.snapT += dt;
    if (e.snapT > 1) {
      const moved = Math.hypot(pos.x - e.snapX, pos.z - e.snapZ);
      if (e.destActive && e.speed > 0.5 && moved < 0.3) {
        e.destActive = false;
        if (e.state === 'combat' && e.phase === 'advance') goToCover(e);
      }
      e.snapT = 0;
      e.snapX = pos.x;
      e.snapZ = pos.z;
    }
  }

  /* ------------------------------------------------------------ animation */

  function animate(e, dt) {
    const r = e.rig;
    const speed = Math.hypot(e.vel.x, e.vel.z);
    const k = Math.min(1, dt * 7);

    e.moveAmp += (clamp(speed / 3.2, 0, 1.1) - e.moveAmp) * Math.min(1, dt * 8);
    const w = e.moveAmp;
    if (speed > 0.12) e.walkPhase += dt * (4 + speed * 2.6);
    e.aim += (e.aimTgt - e.aim) * k;
    e.crouch += (e.crouchTgt - e.crouch) * Math.min(1, dt * 6);
    e.aimPitch += (e.aimPitchTgt - e.aimPitch) * Math.min(1, dt * 9);
    const aim = e.aim, cr = e.crouch;

    // body yaw eases toward target
    e.yaw += wrapAngle(e.targetYaw - e.yaw) * Math.min(1, dt * 6.5);
    e.group.rotation.y = e.yaw;

    // hips: constant idle knee-bend drop + crouch drop + gait bob
    r.hips.position.y = HIP_H - 0.02 - cr * 0.33 + Math.abs(Math.cos(e.walkPhase)) * 0.05 * w;
    // gait weight shift: hips sway ±~2.5cm over the planted foot with a
    // pelvic yaw/roll; standing bodies keep a slow micro-sway so nobody
    // reads as a statue. The spine counter-rotates below (torso.rotation.y).
    const sway = Math.sin(e.walkPhase) * w;
    r.hips.position.x = sway * 0.027 + (1 - w) * Math.sin(time * 0.7 + e.seed * 3) * 0.006;
    r.hips.rotation.y = sway * 0.07;
    r.hips.rotation.z = -sway * 0.04;

    // legs — note: for a limb hanging along -Y, NEGATIVE rotation.x swings it
    // forward (+Z); knees flex backward with POSITIVE rotation.x. A constant
    // idle bend + per-soldier knee bias kills the locked-knee column read.
    const swing = Math.sin(e.walkPhase) * 0.6 * w;
    const lift = 0.85 * w;
    r.hipR.rotation.x = swing - cr * 0.85 - 0.04;
    r.hipL.rotation.x = -swing - cr * 0.95 - 0.04;
    r.kneeR.rotation.x = Math.max(0, Math.cos(e.walkPhase - 0.4)) * lift + cr * 1.5
      + 0.08 + (e.poseKneeL ? 0 : e.poseKnee);
    r.kneeL.rotation.x = Math.max(0, -Math.cos(e.walkPhase - 0.4)) * lift + cr * 1.55
      + 0.08 + (e.poseKneeL ? e.poseKnee : 0);

    // torso lean / twist / flinch / breathing
    const breathe = Math.sin(time * 1.9 + e.seed) * 0.012;
    let flinch = 0;
    if (e.flinchT > 0) {
      flinch = Math.sin((e.flinchT / 0.28) * Math.PI);
      e.flinchT -= dt;
    }
    r.torso.rotation.x = 0.04 + w * 0.1 + cr * 0.3 + breathe - flinch * 0.24;
    r.torso.rotation.z = e.poseLean;
    let twist = 0;
    if (aim > 0.05 && e.state !== 'patrol') {
      twist = clamp(wrapAngle(e.aimYaw - e.yaw), -0.6, 0.6);
    }
    e.twistS += (twist - e.twistS) * k;
    // spine counter-rotation vs the pelvis while walking keeps shoulders calm
    r.torso.rotation.y = e.twistS * aim + flinch * 0.12 * e.flinchS - sway * 0.12;

    // head: scan when idle, sight down rifle when aiming
    const scan = (1 - aim) * Math.sin(time * 0.6 + e.seed * 7) * 0.5;
    r.headPiv.rotation.y = scan + e.twistS * 0.35 + e.poseHead;
    r.headPiv.rotation.x = -e.aimPitch * 0.5 * aim - flinch * 0.3;

    if (FOOTBALL) {
      // athletic arms: relaxed hang while moving, opening into a wide
      // ready-for-anything spread as "aim" rises. No weapon to hold.
      const pump = Math.sin(e.walkPhase + Math.PI) * 0.5 * w;
      r.shR.rotation.x = -0.08 - 0.38 * aim + pump + breathe * 0.5;
      r.shR.rotation.y = 0;
      r.shR.rotation.z = -0.07 - 0.2 * aim;
      // elbow flexes as the arm swings forward — runner's arm carriage
      r.elR.rotation.x = -0.32 - 0.6 * aim - Math.max(0, -pump) * 0.7;
      r.shL.rotation.x = -0.08 - 0.38 * aim - pump + breathe * 0.5;
      r.shL.rotation.y = 0;
      r.shL.rotation.z = 0.07 + 0.2 * aim;
      r.elL.rotation.x = -0.32 - 0.6 * aim - Math.max(0, pump) * 0.7;
      if (e.recoilT > 0) e.recoilT -= dt;

      // kick overlay: back-swing, whip through contact, recover
      if (e.kickT >= 0) {
        const t = e.kickT;
        let sw; // -1 = full back-swing, +1.2 = follow-through
        if (t < 0.3) sw = -Math.sin((t / 0.3) * Math.PI * 0.5);
        else if (t < KICK_HIT) sw = -1 + ((t - 0.3) / (KICK_HIT - 0.3)) * 2.2;
        else sw = 1.2 * (1 - Math.min(1, (t - KICK_HIT) / (KICK_DUR - KICK_HIT)));
        const m = Math.abs(sw);
        r.hipR.rotation.x = -0.95 * sw - 0.06;                 // strike leg
        r.kneeR.rotation.x = Math.max(0, -sw) * 1.15 + 0.08;   // heel-up cock
        r.hipL.rotation.x -= 0.12 * m;                         // planted leg
        r.kneeL.rotation.x += 0.3 * m;
        r.torso.rotation.x += sw * 0.15;                       // lean & whip
        r.shR.rotation.z -= 0.5 * m;                           // arms out
        r.shL.rotation.z += 0.5 * m;
        r.hips.position.y -= 0.05 * m;
      }
      return;
    }

    // arms: low-ready <-> firing stance. Hands are parented to the rifle;
    // shoulders stay tucked (|z| <= 0.15, elbows below shoulder line) and the
    // shoulder yaw turns each elbow hinge so forearms reach in to the weapon.
    const armSwing = Math.sin(e.walkPhase + Math.PI) * 0.25 * w * (1 - aim);
    let rec = 0;
    if (e.recoilT > 0) { rec = e.recoilT / 0.09; e.recoilT -= dt; }
    r.shR.rotation.x = lerp(-0.2, -0.15, aim) + armSwing + rec * 0.06 + breathe * 0.4;
    r.shR.rotation.y = lerp(0.7, 0.55, aim);
    r.shR.rotation.z = lerp(0.12, 0.15, aim);
    // elbows breathe with the swing so the arms never read as welded tubes
    r.elR.rotation.x = lerp(-0.9, -1.85, aim) + Math.min(0, armSwing) * 1.1;
    r.shL.rotation.x = lerp(-0.7, -1.3, aim) - armSwing + breathe * 0.4;
    r.shL.rotation.y = lerp(-0.35, -0.3, aim);
    r.shL.rotation.z = lerp(-0.12, -0.15, aim);
    r.elL.rotation.x = lerp(-0.35, -0.3, aim) + Math.min(0, -armSwing) * 1.1;

    // cheek-to-stock: as aim rises the head cants and drops toward the sight
    // line and the torso leans a touch into the stock
    r.headPiv.rotation.z = -0.12 * aim;
    r.headPiv.rotation.y += 0.2 * aim;
    r.headPiv.rotation.x += 0.07 * aim;
    r.torso.rotation.z = e.poseLean - 0.045 * aim;

    // rifle: true low-ready at rest (stock at the shoulder pocket, muzzle
    // angled ~30° down-forward), shouldered when aiming. Keep a yaw offset at
    // full aim so the weapon reads angled instead of foreshortening to a dot.
    r.rifle.position.set(
      lerp(0.02, -0.1, aim),
      lerp(0.16, 0.42, aim),
      lerp(0.27, 0.24, aim) - rec * 0.03);
    r.rifle.rotation.x = lerp(0.5, -e.aimPitch, aim) - rec * 0.07;
    r.rifle.rotation.y = lerp(0.18, 0.42, aim);
    r.rifle.rotation.z = lerp(0.06, 0.05, aim);
  }

  /* ------------------------------------------------------------ drops
   * Normal mode only: dead soldiers leave their weapon on the ground as a
   * pickup — the prop lying flat plus a slow-breathing additive ground disc
   * so it reads interactive. `.drops` entries are { type, pos, take() };
   * max 6 takeable at once, the oldest fades out when a 7th lands.
   * `.addDrop(type, pos)` is also called by weapon.js when the player swaps
   * weapons (the discarded gun becomes a drop). Football mode: `.drops`
   * stays empty and addDrop is a no-op. */

  const drops = [];
  const fadingDrops = [];
  let dropGlowGeo = null, dropGlowTex = null;

  function addDrop(type, pos) {
    if (FOOTBALL || !pos) return;
    if (!WEAPONS[type]) type = 'mk4';
    if (!dropGlowGeo) {
      dropGlowGeo = new THREE.CircleGeometry(0.5, 18);
      dropGlowGeo.rotateX(-Math.PI / 2);
      // soft radial falloff so the pool reads as glow, not painted decal
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const ctx = cv.getContext('2d');
      const grd = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)');
      grd.addColorStop(0.55, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 64, 64);
      dropGlowTex = new THREE.CanvasTexture(cv);
    }
    const gx = pos.x, gz = pos.z;
    // seat the pickup on whatever is underfoot (road 0.04, sidewalk 0.14,
    // rubble, car roofs...) — one raycast per drop, creation-time only
    _ray.set(_a.set(gx, 2.5, gz), _b.set(0, -1, 0));
    _ray.near = 0;
    _ray.far = 4;
    const hits = _ray.intersectObjects(world.raycastMeshes, false);
    const gy = hits.length ? hits[0].point.y : 0.04;
    const g = new THREE.Group();
    g.position.set(gx, gy, gz);
    g.rotation.y = Math.random() * Math.PI * 2;
    const prop = buildRifleProp(type, MAT.rifleFurniture).group;
    prop.position.set(0, 0.05, -0.14); // recentre the long axis on the disc
    prop.rotation.z = 1.45 + (Math.random() - 0.5) * 0.2; // lying on its side
    prop.rotation.x = (Math.random() - 0.5) * 0.08;
    g.add(prop);
    const mat = new THREE.MeshBasicMaterial({
      map: dropGlowTex, color: 0xffcf82, transparent: true, opacity: 0.26,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.Mesh(dropGlowGeo, mat);
    glow.position.y = 0.02;
    g.add(glow);
    scene.add(g);
    const d = {
      type,
      pos: g.position, // live Vector3, y stays 0
      take() {
        const i = drops.indexOf(d);
        if (i < 0) return null; // already taken or faded out
        drops.splice(i, 1);
        scene.remove(g);
        mat.dispose();
        return d.type;
      },
      _g: g, _prop: prop, _mat: mat,
      _phase: Math.random() * 6.28, _fadeT: 0,
    };
    drops.push(d);
    if (drops.length > 6) fadingDrops.push(drops.shift()); // oldest fades out
  }

  function updateDrops(dt) {
    for (const d of drops) {
      // subtle slow pulse — amber breathing on the ground glow
      d._mat.opacity = 0.16 + 0.16 * (0.5 + 0.5 * Math.sin(time * 2.2 + d._phase));
    }
    for (let i = fadingDrops.length - 1; i >= 0; i--) {
      const d = fadingDrops[i];
      d._fadeT += dt;
      const u = clamp(1 - d._fadeT / 0.9, 0, 1);
      d._g.scale.setScalar(Math.max(0.01, u));
      d._prop.position.y = 0.05 - (1 - u) * 0.05; // settle into the ground
      d._mat.opacity = 0.26 * u;
      if (d._fadeT >= 0.9) {
        fadingDrops.splice(i, 1);
        scene.remove(d._g);
        d._mat.dispose();
      }
    }
  }

  /* ------------------------------------------------------------ death */

  function kill(e, hitPoint) {
    e.state = 'dead';
    e.deadT = 0;
    e.thudded = false;
    e.fallPush = 0.7; // body slide speed while tipping (runover boosts it)
    e.speed = 0;
    e.destActive = false;
    e.vel.set(0, 0, 0);
    freeCover(e);
    if (e.celebT >= 0) {
      // knocked down mid-SIUU: cancel cleanly, un-splay the legs (nothing
      // else needs restoring — the jump rides hips.position.y, which the
      // death slump re-targets every frame)
      e.celebT = -1;
      e.rig.hipR.rotation.z = 0.06;
      e.rig.hipL.rotation.z = -0.06;
    }
    // remove hittable parts
    for (let i = targets.length - 1; i >= 0; i--) {
      if (targets[i].userData.enemy === e) targets.splice(i, 1);
    }
    // fall away from the shot, with scatter
    const p = e.group.position;
    _d.set(p.x - player.position.x, 0, p.z - player.position.z);
    if (hitPoint) _d.add(_a.set(p.x - hitPoint.x, 0, p.z - hitPoint.z).multiplyScalar(2));
    if (_d.lengthSq() < 0.01) _d.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    _d.normalize();
    // CR7 mode: half the knockdowns end sitting, arms out — comedic, no gore
    e.fallStyle = FOOTBALL && Math.random() < 0.55 ? 'sit' : 'flat';
    const rot = (Math.random() - 0.5) * 1.1;
    const c = Math.cos(rot), s = Math.sin(rot);
    e.fallDir.set(_d.x * c - _d.z * s, 0, _d.x * s + _d.z * c);
    e.fallAxis.set(e.fallDir.z, 0, -e.fallDir.x).normalize();
    e.yawQ.setFromAxisAngle(_a.set(0, 1, 0), e.yaw);
    // the soldier's weapon lands beside the falling body as a pickup
    if (!FOOTBALL) {
      _a.copy(p)
        .addScaledVector(e.fallAxis, (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.25))
        .addScaledVector(e.fallDir, 0.15 + Math.random() * 0.3);
      addDrop(e.weapon || 'mk4', _a);
    }
    kills++;
    hud.setScore(kills);
    audio.bodyFall?.();
  }

  function updateDead(e, dt) {
    e.deadT += dt;
    const t = e.deadT;
    const r = e.rig;
    const FD = 0.72;
    const sit = e.fallStyle === 'sit';
    const FA = sit ? 1.12 : 1.55; // sit: reclined, not flat on the back

    // tip over: accelerating fall, then a small damped bounce at impact
    let ang;
    if (t < FD) ang = FA * Math.pow(t / FD, 1.7);
    else ang = FA + Math.sin((t - FD) * 16) * 0.1 * Math.exp(-(t - FD) * 5.5);
    _q1.setFromAxisAngle(e.fallAxis, ang);
    e.group.quaternion.multiplyQuaternions(_q1, e.yawQ);
    if (t < 0.5) {
      e.group.position.x += e.fallDir.x * dt * e.fallPush;
      e.group.position.z += e.fallDir.z * dt * e.fallPush;
    }
    if (!e.thudded && ang >= FA - 0.05) {
      e.thudded = true;
      fx.impact(e.group.position, _a.set(0, 1, 0), 'dirt');
    }

    // joints slump toward a loose sprawl
    const k = Math.min(1, dt * 5);
    const s = (o, ax, v) => { o.rotation[ax] += (v - o.rotation[ax]) * k; };
    if (sit) {
      // knocked Ronaldo ends sitting: legs out front, arms spread wide
      s(r.shR, 'x', -0.5); s(r.shR, 'z', -1.25); s(r.elR, 'x', -0.15);
      s(r.shL, 'x', -0.5); s(r.shL, 'z', 1.25); s(r.elL, 'x', -0.15);
      s(r.hipR, 'x', -1.25); s(r.kneeR, 'x', 0.25);
      s(r.hipL, 'x', -1.1); s(r.kneeL, 'x', 0.35);
      s(r.headPiv, 'x', -0.3); s(r.headPiv, 'y', 0.25 * e.fallSpin);
      s(r.torso, 'x', 0.3); s(r.torso, 'y', 0.15 * e.fallSpin);
      r.hips.position.y += (0.6 - r.hips.position.y) * k;
    } else {
      s(r.shR, 'x', -0.3); s(r.shR, 'z', 0.85); s(r.elR, 'x', -0.45);
      s(r.shL, 'x', 0.2); s(r.shL, 'z', -0.8); s(r.elL, 'x', -0.3);
      s(r.hipR, 'x', -0.35); s(r.kneeR, 'x', 0.55);
      s(r.hipL, 'x', 0.15); s(r.kneeL, 'x', 0.25);
      s(r.headPiv, 'x', 0.45); s(r.headPiv, 'y', 0.5 * e.fallSpin);
      s(r.torso, 'x', 0.12); s(r.torso, 'y', 0.3 * e.fallSpin);
      s(r.rifle, 'x', 1.1);
      r.hips.position.y += (0.95 - r.hips.position.y) * k;
    }

    // corpse persists 15s, then sinks away
    if (t > 15) e.group.position.y -= dt * 0.5;
    if (t > 16.8) {
      scene.remove(e.group);
      // free per-instance archetype-tint materials (heavies/rushers only)
      if (e._clonedMats) { for (const m of e._clonedMats) m.dispose(); e._clonedMats = null; }
      const i = list.indexOf(e);
      if (i >= 0) list.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------ damage in */

  function applyDamage(mesh, dmg, point, normal) {
    const e = mesh && mesh.userData && mesh.userData.enemy;
    if (!e || e.state === 'dead') return null;
    const part = mesh.userData.part;
    const headshot = part === 'head';
    // HEAVY archetype: body/limb shots chip slowly (bodyMul<1) so headshots
    // (always full ×2.2) matter; everyone else keeps the original multipliers
    e.hp -= dmg * (headshot ? 2.2 : (part === 'limb' ? 0.8 : 1) * (e.bodyMul || 1));
    if (!FOOTBALL) fx.impact(point, normal, 'flesh'); // never blood in CR7 mode
    e.flinchT = 0.28;
    e.flinchS = Math.random() < 0.5 ? -1 : 1;
    if (!e.scripted && e.state !== 'combat') enterCombat(e);
    if (!e.scripted) { e.lastSeenPos.copy(player.position); e.hasLOS = true; e.lostT = 0; }
    if (e.hp <= 0) {
      kill(e, point);
      hud.killfeed(FOOTBALL
        ? FB_LINES[(Math.random() * FB_LINES.length) | 0]
        : headshot
          ? 'Headshot — hostile down'
          : KILL_LINES[(Math.random() * KILL_LINES.length) | 0]);
      return { killed: true, headshot };
    }
    return { killed: false, headshot };
  }

  /* ------------------------------------------------------------ football API
   * Available in BOTH modes per SPEC: capsule volumes for ball-vs-enemy
   * tests, comedic no-blood knockdowns, and the projectile-system setter. */

  const _vols = [];
  function hitVolumes() {
    _vols.length = 0;
    for (const e of list) if (e.state !== 'dead') _vols.push(e.vol);
    return _vols;
  }

  function knockdown(ref, point) {
    if (!ref || ref.state === 'dead' || list.indexOf(ref) < 0) return false;
    kill(ref, point); // no-blood fall (reuses death anim), score + thud inside
    hud.killfeed(FB_LINES[(Math.random() * FB_LINES.length) | 0]);
    return true;
  }

  // player drove a car into an enemy — instant kill in both modes. kill()
  // already cancels a mid-SIUU celebration and tips the body away from the
  // player (= away from the car); fast hits shove the body further.
  function runover(ref, speed) {
    if (!ref || ref.state === 'dead' || list.indexOf(ref) < 0) return false;
    kill(ref, null);
    if (speed > 12) ref.fallPush = 2.6; // hard hit: longer body slide
    const lines = FOOTBALL ? RUNOVER_FB_LINES : RUNOVER_LINES;
    hud.killfeed(lines[(Math.random() * lines.length) | 0]);
    return true;
  }

  function setFootballs(fb) { fbRef = fb; }

  /* ------------------------------------------------------------ waves */

  function countedAlive() {
    let n = 0;
    for (const e of list) if (e.counted && e.state !== 'dead') n++;
    return n;
  }

  function waveLogic(dt) {
    if (waveSize <= 0) return;
    const alive = countedAlive();
    // alive target grows with the wave AND +1 per level, but a HARD CAP of 24
    // simultaneous keeps the LOS-budget and draw cost bounded. Spawn cadence
    // tightens a touch as the level climbs.
    const lvlBonus = Math.min(6, level - 1);
    const target = Math.min(24, Math.min(11 + waveNum, 18) + lvlBonus);
    if (toSpawn > 0 && alive < target && alive < 24) {
      trickleT -= dt;
      if (trickleT <= 0) {
        trySpawnOne();
        const cad = Math.max(0.6, 1 - 0.045 * (level - 1));
        trickleT = (alive < target - 2 ? 0.28 : 1.0) * cad;
      }
    }
    if (toSpawn === 0 && alive === 0) {
      waveDelay += dt;
      if (waveDelay > 4) {
        waveDelay = 0;
        // wave cleared -> ramp the difficulty every 2 cleared waves (banner on
        // each level-up); then send the next, bigger wave
        wavesCleared++;
        const next = clamp(startLevel + (wavesCleared >> 1), 1, MAX_LEVEL);
        if (next !== level) applyLevel(next, true);
        spawnWave(Math.min(waveSize + 2, 24));
      }
    } else waveDelay = 0;
  }

  /* ------------------------------------------------------------ update */

  function update(dt) {
    time += dt;
    waveLogic(dt);
    updateDrops(dt);

    // hard per-frame LOS raycast budget across the whole crowd: with up to ~22
    // alive the stagger still averages well under 1 ray/frame; this caps spikes
    let losBudget = 5;

    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.state === 'dead') { updateDead(e, dt); continue; }

      // SIUU celebration owns the enemy outright: no senses, no AI, no
      // locomotion, no kicks — only death/knockdown can interrupt
      if (e.celebT >= 0) { stepCelebrate(e, dt); continue; }

      if (e.scripted) {
        updateScripted(e, dt);
        animate(e, dt);
        continue;
      }

      // senses on a staggered tick — ≤1 LOS raycast/enemy/frame, and at
      // most `losBudget` across all enemies (over budget: retry shortly)
      e.losT -= dt;
      if (e.losT <= 0) {
        if (losBudget > 0) {
          losBudget--;
          e.losT = 0.21 + Math.random() * 0.09;
          senses(e);
        } else e.losT = 0.05;
      }

      if (e.state === 'patrol') updatePatrol(e, dt);
      else if (e.state === 'alert') updateAlert(e, dt);
      else updateCombat(e, dt);

      locomote(e, dt);
      animate(e, dt);
    }

    // gentle pairwise separation so soldiers never merge
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.state === 'dead') continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.state === 'dead') continue;
        const dx = b.group.position.x - a.group.position.x;
        const dz = b.group.position.z - a.group.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.0001 && d2 < 0.81) {
          // a celebrating enemy is planted — the other one takes the push
          const aP = a.celebT < 0, bP = b.celebT < 0;
          if (!aP && !bP) continue;
          const d = Math.sqrt(d2);
          const push = (0.9 - d) * (aP && bP ? 0.5 : 1) / d;
          if (aP) {
            a.group.position.x -= dx * push;
            a.group.position.z -= dz * push;
          }
          if (bP) {
            b.group.position.x += dx * push;
            b.group.position.z += dz * push;
          }
        }
      }
    }
  }

  const mgr = {
    targets, drops, applyDamage, spawnWave, spawnAt, update,
    hitVolumes, knockdown, runover, setFootballs, celebrate, addDrop,
    setStartLevel,
    get level() { return level; },
    get difficultyName() { return diffName(level); },
  };
  // shot-harness debug handle (mirrors main.js's window.__player pattern)
  if (window.__SHOT_MODE__) window.__enemies = mgr;
  return mgr;
}
