// ASHFALL — world/civilians.js
// Civilian pedestrians: pure city ambience. 12-18 walkers on the sidewalks in
// muted streetwear, phone/window idle stops, and a poll-based flee reaction to
// nearby combat / vehicles. NEVER hittable: none of these meshes go into
// enemies.targets or world.raycastMeshes, so bullets and balls pass through by
// construction. No damage, no killfeed, no ragdoll.
//
// Contract: createCivilians({ scene, world, player, getThreats }) ->
//   { update(dt), list }
//
// Perf: one shared vertex-colored material for every civilian; geometry is
// merged per outfit variant (6 meshes / civilian: body, head, 2 arms, 2 legs;
// +1 for the few who carry a bag/umbrella) and shared across civs of that
// variant. Decisions (threat scan, path routing, separation, ground sampling)
// run on a ~5Hz per-civ staggered think tick; the per-frame path is pose math
// only, with zero allocation.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ---------------------------------------------------------------- tuning */
const HIP = 0.9;            // hip pivot height (pre-scale)
const FLEE_SPEED = 5.5;
const CALM_RESUME = 6;      // seconds of calm before a fleeing civ walks again
const STUMBLE_DUR = 0.55;
const COUNT = 18;           // "avec plus de gens" — top of the 12-18 band

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* ---------------------------------------------------------------- temps */
const _danger = new THREE.Vector3();

/* ================================================================ assets
 * One white-base standard material; all part colors live in vertex colors,
 * so a whole civilian variant is at most 5 unique merged geometries (arm and
 * leg geometry is reused for both sides) drawn with a single shared material.
 * Bodies are sculpted from tapered cylinders + ellipsoid joint bulges so the
 * silhouette reads human at street distance: neck, chest-over-waist, flared
 * coat hems, knees/elbows, heel+toe shoes, and a face (eye sockets darkened
 * in vertex color, dark iris beads, nose wedge, ear hints) on every head. */

const CLOTH = new THREE.MeshStandardMaterial({
  color: 0xffffff, roughness: 0.94, metalness: 0, vertexColors: true,
});

// paint a clone of `src` in a flat color with cheap down-face shading
function tinted(src, hex, mul = 1) {
  const g = src.clone();
  const col = new THREE.Color(hex).multiplyScalar(mul);
  const n = g.attributes.normal;
  const cnt = g.attributes.position.count;
  const arr = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    const shade = 1 - 0.28 * Math.max(0, -n.getY(i));
    arr[i * 3] = col.r * shade;
    arr[i * 3 + 1] = col.g * shade;
    arr[i * 3 + 2] = col.b * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// like tinted(), but bakes facial shading into skull/jaw skin: darkened eye
// sockets and a faint mouth shadow (positions in head-pivot space)
function paintFace(src, hex) {
  const g = src.clone();
  const col = new THREE.Color(hex);
  const pos = g.attributes.position;
  const n = g.attributes.normal;
  const cnt = pos.count;
  const arr = new Float32Array(cnt * 3);
  const gauss = (x, y, z, px, py, pz, sig) => {
    const dx = x - px, dy = y - py, dz = z - pz;
    return Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * sig * sig));
  };
  for (let i = 0; i < cnt; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let shade = 1 - 0.22 * Math.max(0, -n.getY(i));
    const eye = Math.max(
      gauss(x, y, z, 0.0295, 0.146, 0.076, 0.021),
      gauss(x, y, z, -0.0295, 0.146, 0.076, 0.021));
    shade *= 1 - 0.40 * eye;                                  // sockets
    shade *= 1 - 0.16 * gauss(x, y, z, 0, 0.090, 0.068, 0.013); // mouth
    arr[i * 3] = col.r * shade;
    arr[i * 3 + 1] = col.g * shade;
    arr[i * 3 + 2] = col.b * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

let ASSETS = null;
function civilianAssets() {
  if (ASSETS) return ASSETS;

  const cyl = (rt, rb, h, seg = 8, open = false) =>
    new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const ell = (r, sx, sy, sz, x, y, z, w = 10, hh = 8) => {
    const g = new THREE.SphereGeometry(r, w, hh);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    return g;
  };
  const cap = (r, w, hh, theta) =>
    new THREE.SphereGeometry(r, w, hh, 0, Math.PI * 2, 0, theta);
  // forearm/calf assemblies: local shape -> baked joint bend -> joint offset
  const bendFore = (g) => { g.rotateX(-0.38); g.translate(0, -0.263, 0); return g; };
  const bendCalf = (g) => { g.rotateX(0.09); g.translate(0, -0.425, 0); return g; };

  /* ---- base body parts (uncolored; cloned + tinted per outfit) ---- */
  const B = {};

  // torso family (torso-group space; hips at y=0, head pivot at y=0.545)
  B.pelvis = ell(0.155, 1.05, 0.60, 0.72, 0, -0.04, 0);
  B.chest = cyl(0.150, 0.125, 0.26, 10);
  B.chest.scale(1.22, 1, 0.76); B.chest.translate(0, 0.415, 0);
  B.waist = cyl(0.125, 0.136, 0.17, 10);
  B.waist.scale(1.18, 1, 0.72); B.waist.translate(0, 0.20, 0);
  B.shoulders = ell(0.150, 1.40, 0.42, 0.78, 0, 0.525, 0);
  B.chestSlim = cyl(0.144, 0.120, 0.26, 10);
  B.chestSlim.scale(1.14, 1, 0.70); B.chestSlim.translate(0, 0.415, 0);
  B.waistSlim = cyl(0.117, 0.127, 0.17, 10);
  B.waistSlim.scale(1.10, 1, 0.66); B.waistSlim.translate(0, 0.20, 0);
  B.shouldersSlim = ell(0.145, 1.36, 0.40, 0.72, 0, 0.525, 0);
  B.hemShort = cyl(0.138, 0.170, 0.22, 10);       // jacket hem flares over hips
  B.hemShort.scale(1.16, 1, 0.76); B.hemShort.translate(0, 0.03, 0);
  B.hemSuit = cyl(0.128, 0.148, 0.20, 10);
  B.hemSuit.scale(1.10, 1, 0.68); B.hemSuit.translate(0, 0.03, 0);
  B.hemLong = cyl(0.140, 0.210, 0.50, 10);        // long coat: hem to mid-thigh
  B.hemLong.scale(1.14, 1, 0.80); B.hemLong.translate(0, -0.11, 0);
  B.skirt = cyl(0.130, 0.270, 0.50, 11);          // A-line dress silhouette
  B.skirt.scale(1.02, 1, 0.88); B.skirt.translate(0, -0.13, 0);
  B.belt = cyl(0.130, 0.132, 0.05, 10);
  B.belt.scale(1.19, 1, 0.74); B.belt.translate(0, 0.155, 0);
  B.collar = cyl(0.085, 0.105, 0.08, 9, true);
  B.collar.scale(1.08, 1, 0.90); B.collar.translate(0, 0.545, 0);
  B.neck = cyl(0.048, 0.055, 0.10, 8);            // body-side neck stub
  B.neck.translate(0, 0.545, 0.01);
  B.placket = box(0.032, 0.44, 0.02);
  B.placket.translate(0, 0.30, 0.108);
  B.shirtV = box(0.078, 0.15, 0.016);             // suit: shirt triangle
  B.shirtV.translate(0, 0.465, 0.100);
  B.tie = box(0.028, 0.22, 0.014);
  B.tie.translate(0, 0.345, 0.108);
  B.hoodDown = ell(0.095, 1.25, 0.55, 0.85, 0, 0.515, -0.12, 9, 7);
  // puffer: one puffy column, ribbed via overlapping radial bulges
  B.rib1 = ell(0.160, 1.20, 0.66, 0.80, 0, 0.075, 0);
  B.rib2 = ell(0.166, 1.24, 0.68, 0.82, 0, 0.185, 0);
  B.rib3 = ell(0.164, 1.22, 0.68, 0.80, 0, 0.30, 0);
  B.rib4 = ell(0.156, 1.16, 0.66, 0.76, 0, 0.415, 0);
  B.rib5 = ell(0.142, 1.08, 0.62, 0.72, 0, 0.505, 0);
  B.puffCollar = ell(0.100, 1.24, 0.58, 1.00, 0, 0.545, 0);

  // head parts (head-pivot space; skull + face baked into the merge)
  B.hNeck = cyl(0.044, 0.052, 0.11, 8);
  B.hNeck.translate(0, 0.05, 0);
  B.skull = new THREE.SphereGeometry(0.086, 14, 11);
  B.skull.scale(0.90, 1.02, 0.96); B.skull.translate(0, 0.157, 0);
  B.jaw = new THREE.SphereGeometry(0.075, 12, 9);
  B.jaw.scale(0.80, 0.72, 0.86); B.jaw.translate(0, 0.104, 0.010);
  B.nose = new THREE.ConeGeometry(0.016, 0.05, 4);
  B.nose.rotateX(Math.PI / 2 + 0.18); B.nose.translate(0, 0.130, 0.078);
  B.earL = ell(0.021, 0.42, 1.00, 0.78, 0.076, 0.146, -0.004, 6, 5);
  B.earR = ell(0.021, 0.42, 1.00, 0.78, -0.076, 0.146, -0.004, 6, 5);
  B.eyeL = new THREE.SphereGeometry(0.0125, 6, 5);
  B.eyeL.translate(0.0295, 0.146, 0.070);
  B.eyeR = new THREE.SphereGeometry(0.0125, 6, 5);
  B.eyeR.translate(-0.0295, 0.146, 0.070);
  // headwear, all fitted to the skull
  B.hair = cap(0.0905, 12, 8, 1.85);
  B.hair.scale(0.92, 0.97, 1.00); B.hair.rotateX(-0.26);
  B.hair.translate(0, 0.163, -0.004);
  B.buzz = cap(0.0885, 12, 7, 1.55);
  B.buzz.scale(0.91, 0.94, 0.99); B.buzz.rotateX(-0.22);
  B.buzz.translate(0, 0.161, -0.002);
  B.bob = cap(0.093, 12, 9, 2.35);                // longer cut, covers the nape
  B.bob.scale(0.94, 1.00, 1.03); B.bob.rotateX(-0.52); // strong front lift: face stays open
  B.bob.translate(0, 0.155, -0.010);
  B.bun = ell(0.030, 1, 0.9, 1, 0, 0.205, -0.078, 8, 6);
  B.beanie = cap(0.094, 12, 8, 1.62);
  B.beanie.scale(0.93, 0.93, 1.00); B.beanie.translate(0, 0.172, 0);
  B.beanieBand = cyl(0.086, 0.088, 0.048, 12, true);
  B.beanieBand.scale(1, 1, 1.06); B.beanieBand.translate(0, 0.174, 0);
  B.hoodUp = cap(0.114, 12, 9, 2.05);
  B.hoodUp.scale(0.96, 1.00, 1.10); B.hoodUp.rotateX(-0.38);
  B.hoodUp.translate(0, 0.150, -0.014);

  // arm (shoulder-pivot space, hangs -Y, baked elbow bend forward)
  B.shoulder = ell(0.062, 1.15, 0.92, 1.02, 0, 0, 0, 9, 7);
  B.upperArm = cyl(0.054, 0.046, 0.25, 8);
  B.upperArm.translate(0, -0.135, 0);
  B.elbow = new THREE.SphereGeometry(0.047, 8, 6);
  B.elbow.translate(0, -0.263, 0);
  B.cuff = bendFore(cyl(0.049, 0.051, 0.055, 8).translate(0, -0.045, 0));
  B.forearm = bendFore(cyl(0.045, 0.032, 0.22, 8).translate(0, -0.145, 0));
  B.hand = bendFore(ell(0.042, 0.75, 1.30, 0.95, 0, 0, 0, 8, 6).translate(0, -0.285, 0));
  // puffer arm: quilted segments (heavy overlap so it reads as one sleeve)
  B.pShoulder = ell(0.068, 1.15, 0.88, 1.05, 0, 0, 0, 9, 7);
  B.pSeg1 = ell(0.058, 1.0, 1.02, 1.0, 0, -0.08, 0);
  B.pSeg2 = ell(0.055, 1.0, 1.02, 1.0, 0, -0.165, 0);
  B.pElbow = new THREE.SphereGeometry(0.049, 8, 6);
  B.pElbow.translate(0, -0.263, 0);
  B.pFore1 = bendFore(ell(0.050, 1, 1.0, 1, 0, -0.085, 0));
  B.pFore2 = bendFore(ell(0.046, 1, 1.0, 1, 0, -0.165, 0));
  B.pCuff = bendFore(cyl(0.040, 0.043, 0.05, 8).translate(0, -0.235, 0));

  // leg (hip-pivot space; shin angles back a touch, heel+toe shoe)
  B.hipJ = ell(0.066, 1.0, 0.85, 1.0, 0, -0.015, 0, 8, 6);
  B.thigh = cyl(0.068, 0.055, 0.40, 8);
  B.thigh.translate(0, -0.215, 0);
  B.knee = new THREE.SphereGeometry(0.052, 8, 6);
  B.knee.translate(0, -0.425, 0);
  B.calfBulge = bendCalf(ell(0.048, 0.95, 1.30, 1.00, 0, -0.095, 0));
  B.calf = bendCalf(cyl(0.049, 0.030, 0.36, 8).translate(0, -0.185, 0));
  B.ankle = cyl(0.030, 0.034, 0.07, 7);
  B.ankle.translate(0, -0.80, -0.012);
  B.heel = box(0.076, 0.056, 0.11);
  B.heel.translate(0, -0.870, -0.025);
  B.toe = box(0.080, 0.048, 0.15);
  B.toe.translate(0, -0.874, 0.095);
  B.toeCap = ell(0.040, 1.0, 0.55, 1.10, 0, -0.872, 0.165, 8, 5);
  // slim leg (tights) + low-heel shoe for the dress silhouettes
  B.thighS = cyl(0.056, 0.046, 0.40, 8);
  B.thighS.translate(0, -0.215, 0);
  B.kneeS = new THREE.SphereGeometry(0.044, 8, 6);
  B.kneeS.translate(0, -0.425, 0);
  B.calfBulgeS = bendCalf(ell(0.041, 0.95, 1.30, 1.00, 0, -0.095, 0));
  B.calfS = bendCalf(cyl(0.041, 0.024, 0.36, 8).translate(0, -0.185, 0));
  B.ankleS = cyl(0.024, 0.027, 0.07, 7);
  B.ankleS.translate(0, -0.80, -0.010);
  B.heelH = box(0.052, 0.075, 0.055);
  B.heelH.translate(0, -0.861, -0.045);
  B.soleT = box(0.066, 0.034, 0.145);
  B.soleT.translate(0, -0.881, 0.065);
  B.toeCapS = ell(0.033, 1.0, 0.50, 1.10, 0, -0.883, 0.130, 8, 5);

  // hand-carried props (arm-pivot space; hand rests near (0,-0.53,0.11))
  B.bagBody = box(0.17, 0.21, 0.065);
  B.bagBody.translate(0, -0.705, 0.106);
  B.bagHandle = box(0.018, 0.10, 0.016);
  B.bagHandle.translate(0, -0.565, 0.106);
  B.umbTop = cyl(0.034, 0.014, 0.46, 7);          // wrapped canopy, tapers down
  B.umbTop.translate(0, -0.80, 0.106);
  B.umbTip = cyl(0.012, 0.005, 0.10, 6);
  B.umbTip.translate(0, -1.075, 0.106);
  B.umbHandle = cyl(0.014, 0.014, 0.09, 6);
  B.umbHandle.translate(0, -0.545, 0.106);

  const SKINS = [0xc79a70, 0x8a5f40, 0xe0b48d, 0x6b4630, 0xa87a58, 0xd4a284];
  const HAIRS = [0x2a2119, 0x171310, 0x4c4038, 0x8e8a82, 0x33241a];

  // muted city outfits — 12 variants: long coats, puffers, suit-ish jackets,
  // two dress silhouettes, bag/umbrella carriers, short & tall builds
  const OUTFITS = [
    { style: 'long', coat: 0x6f7276, pants: 0x3a3d42, shoes: 0x232323,
      top: 'hair', topC: HAIRS[0], prop: 'bag', propC: 0x3c3229, bh: 1.0, bw: 1.0 },
    { style: 'puffer', coat: 0x2f3a4e, pants: 0x46413a, shoes: 0x2a2622,
      top: 'beanie', topC: 0x2e3236, bh: 0.98, bw: 1.06 },
    { style: 'suit', coat: 0x35373c, pants: 0x303237, shoes: 0x1d1c1e,
      top: 'buzz', topC: HAIRS[1], shirt: 0xd6d4cc, tie: 0x4c2a2c, bh: 1.02, bw: 0.98 },
    { style: 'jacket', coat: 0x565941, pants: 0x3f3b34, shoes: 0x2b2a26,
      top: 'hair', topC: HAIRS[3], hoodDown: true, bh: 0.94, bw: 0.99 },
    { style: 'long', coat: 0x5c3330, pants: 0x33363b, shoes: 0x232326,
      top: 'beanie', topC: 0x24272c, prop: 'umbrella', propC: 0x26282d, bh: 1.0, bw: 0.97 },
    { style: 'dress', coat: 0x584a52, pants: 0x2b282c, shoes: 0x2b2226,
      top: 'bob', topC: HAIRS[0], bh: 0.97, bw: 0.94 },
    { style: 'puffer', coat: 0x7a7264, pants: 0x3a3f47, shoes: 0x35302a,
      top: 'buzz', topC: HAIRS[4], bh: 1.0, bw: 1.05 },
    { style: 'jacket', coat: 0x5d4a36, pants: 0x35363a, shoes: 0x1f1d1b,
      top: 'hair', topC: HAIRS[4], bh: 1.0, bw: 1.02 },
    { style: 'jacket', coat: 0x4e5866, pants: 0x3a3f47, shoes: 0x24262a,
      top: 'beanie', topC: 0x50443a, prop: 'bag', propC: 0x4a423b, bh: 1.05, bw: 1.0 },
    { style: 'suit', coat: 0x4a4f44, pants: 0x3f423c, shoes: 0x2a2724,
      top: 'bob', topC: HAIRS[2], shirt: 0xcfcdc2, tie: 0x2e3438, bh: 1.06, bw: 0.99 },
    { style: 'jacket', coat: 0x33353a, pants: 0x2c2e33, shoes: 0x1c1c1e,
      top: 'hood', bh: 0.99, bw: 1.0 },
    { style: 'dress', coat: 0x3e4a4a, pants: 0x2e2b30, shoes: 0x241f22,
      top: 'bun', topC: HAIRS[1], bh: 0.95, bw: 0.95 },
  ];

  const variants = OUTFITS.map((o, i) => {
    const skin = SKINS[i % SKINS.length];
    const coatDark = new THREE.Color(o.coat).multiplyScalar(0.78).getHex();
    const slim = o.style === 'suit' || o.style === 'dress';

    // ---- body
    const bodyParts = [tinted(B.neck, skin)];
    if (o.style === 'puffer') {
      bodyParts.push(
        tinted(B.pelvis, o.pants),
        tinted(B.rib1, o.coat), tinted(B.rib2, o.coat, 0.97),
        tinted(B.rib3, o.coat), tinted(B.rib4, o.coat, 0.96),
        tinted(B.rib5, o.coat), tinted(B.puffCollar, o.coat, 0.9),
        tinted(B.placket, coatDark));
    } else {
      bodyParts.push(
        tinted(B.pelvis, o.pants),
        tinted(slim ? B.chestSlim : B.chest, o.coat),
        tinted(slim ? B.waistSlim : B.waist, o.coat, 0.97),
        tinted(slim ? B.shouldersSlim : B.shoulders, o.coat),
        tinted(B.collar, coatDark));
      if (o.style === 'long') {
        bodyParts.push(tinted(B.hemLong, o.coat, 0.94), tinted(B.belt, coatDark),
          tinted(B.placket, coatDark));
      } else if (o.style === 'suit') {
        bodyParts.push(tinted(B.hemSuit, o.coat, 0.96),
          tinted(B.shirtV, o.shirt), tinted(B.tie, o.tie),
          tinted(B.placket, coatDark));
      } else if (o.style === 'dress') {
        bodyParts.push(tinted(B.skirt, o.coat, 0.96), tinted(B.belt, coatDark));
      } else {
        bodyParts.push(tinted(B.hemShort, o.coat, 0.94), tinted(B.placket, coatDark));
      }
      if (o.hoodDown || o.top === 'hood') bodyParts.push(tinted(B.hoodDown, coatDark));
    }

    // ---- head: skull + face + headwear
    const headParts = [
      tinted(B.hNeck, skin),
      paintFace(B.skull, skin), paintFace(B.jaw, skin),
      tinted(B.nose, skin, 1.04),
      tinted(B.earL, skin, 0.97), tinted(B.earR, skin, 0.97),
      tinted(B.eyeL, 0x221b16), tinted(B.eyeR, 0x221b16),
    ];
    if (o.top === 'hair') headParts.push(tinted(B.hair, o.topC));
    else if (o.top === 'buzz') headParts.push(tinted(B.buzz, o.topC, 0.9));
    else if (o.top === 'bob') headParts.push(tinted(B.bob, o.topC));
    else if (o.top === 'bun') headParts.push(tinted(B.hair, o.topC), tinted(B.bun, o.topC, 0.92));
    else if (o.top === 'beanie') headParts.push(tinted(B.beanie, o.topC), tinted(B.beanieBand, o.topC, 0.85));
    else headParts.push(tinted(B.hoodUp, o.coat, 0.92)); // hood worn up

    // ---- arms (one geometry, mirrored by the rig)
    const armParts = o.style === 'puffer'
      ? [tinted(B.pShoulder, o.coat), tinted(B.pSeg1, o.coat),
         tinted(B.pSeg2, o.coat, 0.96), tinted(B.pElbow, o.coat, 0.93),
         tinted(B.pFore1, o.coat, 0.96), tinted(B.pFore2, o.coat, 0.92),
         tinted(B.pCuff, coatDark), tinted(B.hand, skin)]
      : [tinted(B.shoulder, o.coat), tinted(B.upperArm, o.coat),
         tinted(B.elbow, o.coat, 0.95), tinted(B.cuff, coatDark),
         tinted(B.forearm, o.coat, 0.94), tinted(B.hand, skin)];

    // ---- legs
    const legParts = o.style === 'dress'
      ? [tinted(B.thighS, o.pants), tinted(B.kneeS, o.pants, 0.96),
         tinted(B.calfBulgeS, o.pants, 0.95), tinted(B.calfS, o.pants, 0.94),
         tinted(B.ankleS, o.pants, 0.9), tinted(B.heelH, o.shoes),
         tinted(B.soleT, o.shoes), tinted(B.toeCapS, o.shoes, 0.94)]
      : [tinted(B.hipJ, o.pants), tinted(B.thigh, o.pants),
         tinted(B.knee, o.pants, 0.96), tinted(B.calfBulge, o.pants, 0.95),
         tinted(B.calf, o.pants, 0.94), tinted(B.ankle, o.shoes, 0.8),
         tinted(B.heel, o.shoes), tinted(B.toe, o.shoes),
         tinted(B.toeCap, o.shoes, 0.94)];

    // ---- carried prop (7th mesh on the right arm for a few variants)
    let prop = null;
    if (o.prop === 'bag') {
      prop = mergeGeometries(
        [tinted(B.bagBody, o.propC), tinted(B.bagHandle, o.propC, 0.7)], false);
    } else if (o.prop === 'umbrella') {
      prop = mergeGeometries(
        [tinted(B.umbTop, o.propC), tinted(B.umbTip, 0x76716a),
         tinted(B.umbHandle, 0x4a3a2c)], false);
    }

    return {
      body: mergeGeometries(bodyParts, false),
      head: mergeGeometries(headParts, false),
      arm: mergeGeometries(armParts, false),
      leg: mergeGeometries(legParts, false),
      prop,
      bh: o.bh, bw: o.bw,
      hasProp: !!o.prop,
    };
  });

  ASSETS = { variants };
  return ASSETS;
}

// 6 meshes per civilian (7 with a carried prop); arms/legs reuse one
// geometry for both sides
function buildCivilian(variantIdx) {
  const V = civilianAssets().variants[variantIdx];
  const mk = (geo, cast) => {
    const m = new THREE.Mesh(geo, CLOTH);
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  };
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP;
  root.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);
  torso.add(mk(V.body, true));
  const headPiv = new THREE.Group();
  headPiv.position.set(0, 0.545, 0.012);
  torso.add(headPiv);
  headPiv.add(mk(V.head, true));
  const mkArm = (side) => {
    const g = new THREE.Group();
    g.position.set(0.215 * side, 0.5, 0);
    torso.add(g);
    g.add(mk(V.arm, false));
    return g;
  };
  const mkLeg = (side) => {
    const g = new THREE.Group();
    g.position.set(0.105 * side, -0.015, 0);
    hips.add(g);
    g.add(mk(V.leg, true));
    return g;
  };
  const armR = mkArm(-1);
  const armL = mkArm(1);
  if (V.prop) armR.add(mk(V.prop, false));
  return {
    root,
    variant: V,
    rig: { hips, torso, headPiv, armR, armL, legR: mkLeg(-1), legL: mkLeg(1) },
  };
}

/* ================================================================ manager */

export function createCivilians({ scene, world, player, getThreats } = {}) {
  if (!scene || !world || !player) return { update() {}, list: [] };

  /* ------------------------------------------------------------ paths
   * Prefer world.walkPaths (city addendum); FALLBACK: two rectangle loops
   * hugging the main-street sidewalks (x ≈ ±7.9 / ±9.7, z -50..50), inner
   * lane one way and outer lane the other so foot traffic reads two-way. */
  function buildFallbackPaths() {
    const out = [];
    for (const s of [-1, 1]) {
      const pts = [];
      for (let z = -50; z <= 50; z += 10) pts.push(new THREE.Vector3(s * 7.9, 0, z));
      for (let z = 50; z >= -50; z -= 10) pts.push(new THREE.Vector3(s * 9.7, 0, z));
      out.push(pts);
    }
    return out;
  }
  const wpSrc = world.walkPaths;
  const paths = (Array.isArray(wpSrc) && wpSrc.length > 0 &&
    wpSrc.every((p) => Array.isArray(p) && p.length >= 4))
    ? wpSrc : buildFallbackPaths();

  /* ------------------------------------------------------------ state */
  const list = [];
  let time = 0;
  // module-level danger inputs, refreshed at 10Hz (not per-civ, not per-frame)
  let threats = [];
  let combatNear = false;
  let threatT = 0;
  let panicT = 0;
  const panicPos = new THREE.Vector3();
  // player velocity estimate — works while driving too (player tethers to the
  // vehicle), which is what makes civs dodge cars without touching cars.js
  const playerVel = new THREE.Vector3();
  const prevP = new THREE.Vector3();
  let pvInit = false;

  /* ------------------------------------------------------------ spawning */
  // the stretch of street the player sees first: ~25m down-street from spawn.
  // Two thirds of the crowd starts biased toward it so the city reads
  // populated from the opening frame; the rest spreads over the whole loop.
  const spawnFocus = new THREE.Vector3(0, 0, 27);
  if (world.playerSpawn) {
    const sy = world.playerSpawnYaw ?? 0;
    spawnFocus.set(
      world.playerSpawn.x - Math.sin(sy) * 25, 0,
      world.playerSpawn.z - Math.cos(sy) * 25);
  }

  function spawn(i) {
    const variantIdx = i % civilianAssets().variants.length;
    const built = buildCivilian(variantIdx);
    const pathIdx = i % paths.length;
    const path = paths[pathIdx];
    const k = (i / paths.length) | 0;
    let wpIdx;
    if (i % 3 !== 2) {
      // biased: best of 3 random waypoints, nearest the first-view stretch
      let bd = 1e9;
      wpIdx = 0;
      for (let t = 0; t < 3; t++) {
        const cand = (Math.random() * path.length) | 0;
        const w = path[cand];
        const d = Math.hypot(w.x - spawnFocus.x, w.z - spawnFocus.z);
        if (d < bd) { bd = d; wpIdx = cand; }
      }
    } else {
      // golden-ratio spread along the loop so the rest starts staggered
      const frac = (k * 0.618 + Math.random() * 0.06) % 1;
      wpIdx = (frac * path.length) | 0;
    }
    const wp = path[wpIdx];
    built.root.position.set(
      wp.x + (Math.random() - 0.5) * 0.8, 0.14, wp.z + (Math.random() - 0.5) * 1.6);
    // ±5% random height on top of the per-variant build (short/tall/wide)
    const h = (0.95 + Math.random() * 0.1) * built.variant.bh;
    const wdt = (0.96 + Math.random() * 0.08) * built.variant.bw;
    built.root.scale.set(h * wdt, h, h * wdt);
    scene.add(built.root);

    const dir = Math.random() < 0.5 ? -1 : 1;
    const nextWp = path[(wpIdx + dir + path.length) % path.length];
    const c = {
      group: built.root, rig: built.rig,
      pathIdx, wpIdx: (wpIdx + dir + path.length) % path.length, dir,
      lane: (Math.random() - 0.5) * 0.9,
      state: 'walk',
      walkSpeed: 1.4 + Math.random() * 0.6,
      speed: 0,
      yaw: Math.atan2(nextWp.x - wp.x, nextWp.z - wp.z),
      targetYaw: 0,
      groundY: 0.14,
      // think stagger
      thinkT: Math.random() * 0.25,
      calmT: 99,
      danger: new THREE.Vector3(),
      cowerTarget: new THREE.Vector3(),
      atCower: false,
      // idle
      idleType: 'phone', idleT: 0,
      nextIdleT: 5 + Math.random() * 18,
      // stumble
      stumbleT: 0, sideX: 1, sideZ: 0, stumbleSide: 1,
      // animation
      phase: Math.random() * 6.28, moveAmp: 0,
      runB: 0, crouchB: 0, phoneB: 0, windowB: 0,
      seed: Math.random() * 10,
      hunch: Math.random() * 0.07,
      gaitFreq: 3.2 + Math.random() * 0.8,
      armAmp: 0.26 + Math.random() * 0.14,
      // realism extras: carried prop, 2-handed phone stance, walking glances
      hasProp: built.variant.hasProp,
      phoneTwo: !built.variant.hasProp && Math.random() < 0.45,
      glanceT: 0, glanceYaw: 0, glanceB: 0,
    };
    c.targetYaw = c.yaw;
    list.push(c);
  }
  for (let i = 0; i < COUNT; i++) spawn(i);

  /* ------------------------------------------------------------ think ops */

  // one pass over world.colliders: sample ground height (low tops = walkable
  // surfaces) and push out of body-height obstacles (poles, barriers, walls,
  // parked cars — cars.js keeps its colliders in world.colliders)
  function groundAndPush(c) {
    const p = c.group.position;
    const cols = world.colliders;
    let g = 0;
    if (cols) {
      const R = 0.3;
      for (let i = 0; i < cols.length; i++) {
        const b = cols[i];
        if (p.x < b.min.x - R || p.x > b.max.x + R ||
            p.z < b.min.z - R || p.z > b.max.z + R) continue;
        if (b.max.y <= 0.5) {
          if (b.max.y > g && p.x >= b.min.x && p.x <= b.max.x &&
              p.z >= b.min.z && p.z <= b.max.z) g = b.max.y;
        } else if (b.min.y < 1.4) {
          const pushL = p.x - (b.min.x - R);
          const pushR = (b.max.x + R) - p.x;
          const pushB = p.z - (b.min.z - R);
          const pushF = (b.max.z + R) - p.z;
          const m = Math.min(pushL, pushR, pushB, pushF);
          if (m === pushL) p.x = b.min.x - R;
          else if (m === pushR) p.x = b.max.x + R;
          else if (m === pushB) p.z = b.min.z - R;
          else p.z = b.max.z + R;
        }
      }
    }
    c.groundY = g;
  }

  // radius separation vs other civs and the player (staggered via think)
  function separation(c) {
    const p = c.group.position;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === c) continue;
      const dx = p.x - o.group.position.x, dz = p.z - o.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.3 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (0.55 - d) * 0.5;
        p.x += (dx / d) * push;
        p.z += (dz / d) * push;
      }
    }
    const dx = p.x - player.position.x, dz = p.z - player.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.56 && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const push = (0.75 - d) * 0.6;
      p.x += (dx / d) * push;
      p.z += (dz / d) * push;
    }
  }

  function retarget(c) {
    const path = paths[c.pathIdx];
    const p = c.group.position;
    let ni = 0, nd = 1e9;
    for (let i = 0; i < path.length; i++) {
      const d = Math.hypot(path[i].x - p.x, path[i].z - p.z);
      if (d < nd) { nd = d; ni = i; }
    }
    c.wpIdx = (ni + c.dir + path.length) % path.length;
    c.nextIdleT = Math.max(c.nextIdleT, 5);
  }

  function startCower(c) {
    c.state = 'cower';
    c.atCower = false;
    c.stumbleT = 0;
    const p = c.group.position;
    // press outward, away from the street center, toward the building line
    let ox = p.x, oz = p.z;
    const l = Math.hypot(ox, oz);
    if (l > 1) { ox /= l; oz /= l; } else { ox = 1; oz = 0; }
    c.cowerTarget.set(p.x + ox * 1.6, 0, p.z + oz * 1.6);
  }

  // flee target: nearest path waypoint ≥25m from the danger; then keep
  // following that loop away from it until CALM_RESUME seconds of quiet
  function startFlee(c) {
    const p = c.group.position;
    let bp = -1, bi = -1, bd = 1e9;
    for (let pi = 0; pi < paths.length; pi++) {
      const path = paths[pi];
      for (let i = 0; i < path.length; i++) {
        const w = path[i];
        if (Math.hypot(w.x - c.danger.x, w.z - c.danger.z) < 25) continue;
        const d = Math.hypot(w.x - p.x, w.z - p.z);
        if (d < bd) { bd = d; bp = pi; bi = i; }
      }
    }
    if (bp < 0) { startCower(c); return; } // nowhere is far enough — hide
    const dSelf = Math.hypot(p.x - c.danger.x, p.z - c.danger.z);
    const w = paths[bp][bi];
    if (dSelf < 7) {
      // cornered: the only escape route runs straight through the danger
      const wx = w.x - p.x, wz = w.z - p.z;
      const wl = Math.hypot(wx, wz) || 1;
      const dx = (c.danger.x - p.x) / (dSelf || 1), dz = (c.danger.z - p.z) / (dSelf || 1);
      if ((wx / wl) * dx + (wz / wl) * dz > 0.65) { startCower(c); return; }
    }
    c.state = 'flee';
    c.stumbleT = 0;
    if (bp === c.pathIdx) {
      const path = paths[bp];
      let ni = 0, nd = 1e9;
      for (let i = 0; i < path.length; i++) {
        const d = Math.hypot(path[i].x - p.x, path[i].z - p.z);
        if (d < nd) { nd = d; ni = i; }
      }
      const fwd = (bi - ni + path.length) % path.length;
      c.dir = fwd <= path.length - fwd ? 1 : -1;
      c.wpIdx = (ni + c.dir + path.length) % path.length;
      const s = path[c.wpIdx];
      // never step toward the danger to reach the loop — flip if the first
      // waypoint that way is markedly closer to it than we are
      if (Math.hypot(s.x - c.danger.x, s.z - c.danger.z) < Math.min(dSelf - 1, 10)) {
        c.dir = -c.dir;
        c.wpIdx = (ni + c.dir + path.length) % path.length;
      }
    } else {
      // hop across the open street to the far loop, then follow it
      c.pathIdx = bp;
      c.wpIdx = bi;
      c.dir = Math.random() < 0.5 ? -1 : 1;
    }
  }

  function startStumble(c) {
    c.state = 'stumble';
    c.stumbleT = STUMBLE_DUR;
    // quick sidestep perpendicular to the oncoming travel direction
    const vl = Math.hypot(playerVel.x, playerVel.z) || 1;
    let sx = playerVel.z / vl, sz = -playerVel.x / vl;
    const rx = c.group.position.x - player.position.x;
    const rz = c.group.position.z - player.position.z;
    if (sx * rx + sz * rz < 0) { sx = -sx; sz = -sz; }
    c.sideX = sx;
    c.sideZ = sz;
    c.stumbleSide = (Math.cos(c.yaw) * sx - Math.sin(c.yaw) * sz) > 0 ? 1 : -1;
  }

  function think(c) {
    groundAndPush(c);
    separation(c);
    const p = c.group.position;

    // ---- danger scan (all poll-based, zero coupling to other modules)
    let found = false, vehicle = false, dd = 1e9;
    for (let i = 0; i < threats.length; i++) {
      const t = threats[i];
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d < 12 && d < dd) { dd = d; _danger.set(t.x, 0, t.z); found = true; }
    }
    const pd = Math.hypot(player.position.x - p.x, player.position.z - p.z);
    if (!found && combatNear && pd < 14) {
      // firefight raging around the player and the player is close — clear out
      _danger.set(player.position.x, 0, player.position.z);
      found = true;
    }
    if (pd < 8) {
      const ax = (p.x - player.position.x) / (pd || 1);
      const az = (p.z - player.position.z) / (pd || 1);
      const approach = playerVel.x * ax + playerVel.z * az;
      if (approach > 6) { // something fast bearing down — dodge it
        _danger.set(player.position.x, 0, player.position.z);
        found = true;
        vehicle = true;
      }
    }
    if (panicT > 0) {
      const d = Math.hypot(panicPos.x - p.x, panicPos.z - p.z);
      if (d < 14) { _danger.copy(panicPos); found = true; }
    }

    if (found) {
      c.calmT = 0;
      c.danger.copy(_danger);
      if (c.state === 'walk' || c.state === 'idle') {
        if (vehicle && pd < 2.6) startStumble(c); // near-miss: stumble first
        else startFlee(c);
      }
    }

    // ---- state upkeep (think runs ~every 0.2s)
    if (c.state === 'walk') {
      // occasional look-around while strolling (shop fronts, other people)
      if (c.glanceT > 0) c.glanceT -= 0.2;
      else if (Math.random() < 0.055) {
        c.glanceT = 0.9 + Math.random() * 1.4;
        c.glanceYaw = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.35);
      }
      c.nextIdleT -= 0.2;
      if (c.nextIdleT <= 0 && c.calmT > 8) {
        c.state = 'idle';
        // bag/umbrella carriers keep their hand down: they window-shop instead
        c.idleType = (!c.hasProp && Math.random() < 0.55) ? 'phone' : 'window';
        c.idleT = 2.6 + Math.random() * 3.4;
        c.nextIdleT = 9 + Math.random() * 18;
        if (c.idleType === 'window') {
          // turn toward the building line (outward from the street center)
          const l = Math.hypot(p.x, p.z) || 1;
          c.targetYaw = Math.atan2(p.x / l, p.z / l);
        }
      }
    } else if (c.state === 'idle') {
      c.idleT -= 0.2;
      if (c.idleT <= 0) { c.state = 'walk'; retarget(c); }
    } else if (c.state === 'flee') {
      if (c.calmT > CALM_RESUME) { c.state = 'walk'; retarget(c); }
    } else if (c.state === 'cower') {
      if (c.calmT > 4) { c.state = 'walk'; retarget(c); }
    }
  }

  /* ------------------------------------------------------------ movement */

  function move(c, dt) {
    const p = c.group.position;
    if (c.state === 'stumble') {
      c.stumbleT -= dt;
      p.x += c.sideX * 2.6 * dt;
      p.z += c.sideZ * 2.6 * dt;
      c.speed *= Math.max(0, 1 - dt * 6);
      if (c.stumbleT <= 0) startFlee(c);
    } else {
      let des = 0;
      if (c.state === 'walk' || c.state === 'flee') {
        const path = paths[c.pathIdx];
        const wp = path[c.wpIdx];
        // lane offset perpendicular to the current heading staggers traffic
        const tx = wp.x + Math.cos(c.yaw) * c.lane;
        const tz = wp.z - Math.sin(c.yaw) * c.lane;
        const fleeing = c.state === 'flee';
        des = fleeing ? FLEE_SPEED : c.walkSpeed;
        const dx = tx - p.x, dz = tz - p.z;
        const d = Math.hypot(dx, dz);
        if (d < (fleeing ? 1.3 : 0.8)) {
          c.wpIdx = (c.wpIdx + c.dir + path.length) % path.length;
          c.lane = clamp(c.lane + (Math.random() - 0.5) * 0.25, -0.5, 0.5);
        } else {
          c.targetYaw = Math.atan2(dx, dz);
        }
      } else if (c.state === 'cower') {
        const dx = c.cowerTarget.x - p.x, dz = c.cowerTarget.z - p.z;
        const d = Math.hypot(dx, dz);
        c.atCower = d < 0.4;
        if (!c.atCower) {
          des = 2.4;
          c.targetYaw = Math.atan2(dx, dz);
        } else {
          // hunched against the wall, glancing back toward the danger
          c.targetYaw = Math.atan2(p.x - c.danger.x, p.z - c.danger.z);
        }
      }
      c.speed += (des - c.speed) * Math.min(1, dt * (c.state === 'flee' ? 6.5 : 4.5));
      if (c.speed > 0.01) {
        p.x += Math.sin(c.yaw) * c.speed * dt;
        p.z += Math.cos(c.yaw) * c.speed * dt;
      }
    }
    p.y += (c.groundY - p.y) * Math.min(1, dt * 10);
  }

  /* ------------------------------------------------------------ animation */

  function animate(c, dt) {
    const r = c.rig;
    const sp = c.speed;
    c.moveAmp += (clamp(sp / 1.9, 0, 1.3) - c.moveAmp) * Math.min(1, dt * 8);
    const w = c.moveAmp;
    if (sp > 0.08) c.phase += dt * (c.gaitFreq + sp * 2.5);
    const kb = Math.min(1, dt * 5.5);
    c.runB += (((c.state === 'flee' || c.state === 'stumble') ? 1 : 0) - c.runB) * kb;
    c.crouchB += ((c.state === 'cower' ? (c.atCower ? 1 : 0.35) : 0) - c.crouchB) * kb;
    c.phoneB += (((c.state === 'idle' && c.idleType === 'phone') ? 1 : 0) - c.phoneB) * kb;
    c.windowB += (((c.state === 'idle' && c.idleType === 'window') ? 1 : 0) - c.windowB) * kb;
    c.glanceB += (((c.state === 'walk' && c.glanceT > 0) ? 1 : 0) - c.glanceB) *
      Math.min(1, dt * 3.5);
    const run = c.runB, cr = c.crouchB, ph = c.phoneB, wi = c.windowB;

    c.yaw += wrapAngle(c.targetYaw - c.yaw) * Math.min(1, dt * (5 + run * 4));
    c.group.rotation.y = c.yaw;

    // gait bob + crouch drop
    r.hips.position.y = HIP - 0.012 - cr * 0.24 +
      Math.abs(Math.cos(c.phase)) * (0.03 + 0.03 * run) * w;

    // legs: hip swing (negative rotation.x swings forward); knees are baked
    const swing = Math.sin(c.phase) * (0.48 + 0.42 * run) * w;
    r.legR.rotation.x = swing - 0.03 - cr * 0.3;
    r.legL.rotation.x = -swing - 0.03 - cr * 0.18;

    // torso: hunch + speed lean + breathing; shoulders counter-rotate the
    // pelvis while walking (spine counter-sway); stumble twist overlaid below
    const breathe = Math.sin(time * 1.8 + c.seed) * 0.012;
    r.torso.rotation.x = 0.025 + c.hunch + w * 0.05 + run * 0.2 + cr * 0.6 + ph * 0.07 + breathe;
    r.torso.rotation.z = Math.sin(c.phase) * 0.03 * w + (ph + wi) * 0.05;
    r.torso.rotation.y = -Math.sin(c.phase) * 0.09 * w * (1 - cr);

    // head: ambient drift + deliberate walking glances, phone-look down,
    // over-shoulder glances while fleeing
    r.headPiv.rotation.y =
      (1 - run) * (1 - ph) * (
        Math.sin(time * 0.55 + c.seed * 7) * 0.16 * (1 - w * 0.75) +
        c.glanceYaw * c.glanceB) +
      Math.sin(time * 1.4 + c.seed * 3) * 0.3 * run;
    r.headPiv.rotation.x = ph * (c.phoneTwo ? 0.72 : 0.62) + cr * 0.35 + run * 0.06 - wi * 0.1;

    // arms: relaxed hang + counter-swing; raised while fleeing; shielding
    // overhead while cowering; phone held up right-handed or in both hands;
    // a carried bag/umbrella quiets that arm's swing
    const pump = Math.sin(c.phase + Math.PI) * (c.armAmp + 0.25 * run) * w;
    const pumpR = c.hasProp ? pump * (0.25 + 0.75 * run) : pump;
    const ph2 = c.phoneTwo ? ph : 0;
    const baseX = -0.06 - run * 0.5 - cr * 1.7;
    r.armR.rotation.x = lerp(baseX + pumpR, -1.18, ph);
    r.armR.rotation.z = lerp(-0.07 - run * 0.16 - cr * 0.45, -0.22, ph);
    r.armL.rotation.x = lerp(baseX - pump, -1.08, ph2);
    r.armL.rotation.z = lerp(0.07 + run * 0.16 + cr * 0.45, 0.26, ph2);

    if (c.stumbleT > 0) {
      const wv = Math.sin((c.stumbleT / STUMBLE_DUR) * Math.PI);
      r.torso.rotation.z += wv * 0.38 * c.stumbleSide;
      r.torso.rotation.y += wv * 0.5 * c.stumbleSide;
      r.hips.position.y -= wv * 0.07;
      r.armR.rotation.z -= wv * 0.7;
      r.armL.rotation.z += wv * 0.7;
    }
  }

  /* ------------------------------------------------------------ update */

  function update(dt) {
    if (!(dt > 0)) return;
    time += dt;

    // player velocity estimate (teleport-proof)
    if (!pvInit) { prevP.copy(player.position); pvInit = true; }
    const ivx = (player.position.x - prevP.x) / dt;
    const ivz = (player.position.z - prevP.z) / dt;
    if (ivx * ivx + ivz * ivz < 1600) {
      const k = Math.min(1, dt * 10);
      playerVel.x += (ivx - playerVel.x) * k;
      playerVel.z += (ivz - playerVel.z) * k;
    }
    prevP.copy(player.position);

    // shared danger inputs at 10Hz
    threatT -= dt;
    if (threatT <= 0) {
      threatT = 0.1;
      threats = (getThreats && getThreats()) || [];
      combatNear = false;
      for (let i = 0; i < threats.length; i++) {
        const t = threats[i];
        const dx = t.x - player.position.x, dz = t.z - player.position.z;
        if (dx * dx + dz * dz < 900) { combatNear = true; break; }
      }
    }
    if (panicT > 0) panicT -= dt;

    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      c.calmT += dt;
      c.thinkT -= dt;
      if (c.thinkT <= 0) {
        c.thinkT = 0.15 + Math.random() * 0.1; // ~5Hz, staggered across civs
        think(c);
      }
      move(c, dt);
      animate(c, dt);
    }
  }

  // debug/probe hook — screenshot harness only, never in normal play
  if (window.__SHOT_MODE__) {
    window.__civ = {
      list,
      paths,
      count: list.length,
      // inject a fake danger at (x,z) — nearby civs flee it like gunfire
      panic(x, z) {
        if (typeof x === 'object' && x) { panicPos.set(x.x, 0, x.z); }
        else panicPos.set(x, 0, z);
        panicT = 2.5;
        for (const c of list) c.thinkT = Math.min(c.thinkT, 0.03);
      },
      state() {
        return list.map((c) => ({
          x: +c.group.position.x.toFixed(2),
          y: +c.group.position.y.toFixed(2),
          z: +c.group.position.z.toFixed(2),
          state: c.state,
          speed: +c.speed.toFixed(2),
          path: c.pathIdx,
        }));
      },
    };
  }

  return { update, list };
}
