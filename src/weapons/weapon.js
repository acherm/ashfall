// ============================================================================
// ASHFALL — weapons/weapon.js
// Procedural M4-class viewmodel + full-auto hitscan combat.
// createWeapon({ camera, scene, input, fx, audio, hud, player,
//                getTargets, applyDamage, worldMeshes })
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeFootballTexture } from '../fx/footballs.js';

// ---------------------------------------------------------------- tunables
const SCALE = 0.8;                       // viewmodel scale (anti wall-clip)
const SIGHT_Y = 0.0656;                  // optic axis height, rifle-local (m)
const HIP_POS = new THREE.Vector3(0.16, -0.14, -0.34);
const HIP_ROT = { x: -0.015, y: 0.085, z: -0.05 };
// Every optic sits on the rifle-local axis (0, SIGHT_Y, z). With uniform
// SCALE the scaled offset is SIGHT_Y*SCALE = 0.0525, so an ADS position of
// (0, ADS_Y, z) puts the sight exactly on the camera -Z axis => exact screen
// center at full ADS for every weapon type (only the z distance varies).
const ADS_Y = -SIGHT_Y * SCALE;
const SPRINT_POS = new THREE.Vector3(-0.055, -0.028, 0.045);
const SPRINT_ROT = { x: 0.38, y: 0.42, z: 0.28 };
const PICKUP_RANGE = 2.2;                // m, ground-drop interaction radius
const EQUIP_TIME = 0.35;                 // s, raise animation after a pickup

// ---- 3-slot loadout: primary rifle (slot 1) + pistol (slot 2) + knife (slot 3)
const SWAP_TIME = 0.32;                  // s, lower-old / raise-new on a slot swap

// PISTOL framing: lower-right sidearm hold. ADS converges to (0, ADS_Y, adsZ):
// the iron sights live on the rifle-shared axis (x=0, y=SIGHT_Y) so the same
// ADS_Y math centers them pixel-exact at full ADS.
const PISTOL_HIP_POS = new THREE.Vector3(0.132, -0.178, -0.30);
const PISTOL_HIP_ROT = { x: -0.02, y: 0.10, z: -0.05 };
const PISTOL_SPRINT_POS = new THREE.Vector3(-0.05, -0.03, 0.03);
const PISTOL_SPRINT_ROT = { x: 0.42, y: 0.5, z: 0.30 };
const PISTOL_ADS_Z = -0.245;

// KNIFE framing: right-hand hold, blade angled across the view. No ADS.
const KNIFE_HIP_POS = new THREE.Vector3(0.15, -0.15, -0.34);
const KNIFE_HIP_ROT = { x: 0.02, y: -0.12, z: 0.05 };
const KNIFE_SPRINT_POS = new THREE.Vector3(-0.05, -0.03, 0.04);
const KNIFE_SPRINT_ROT = { x: 0.40, y: 0.5, z: 0.30 };
const KNIFE_SWING_TIME = 0.5;            // s, full slash animation
const KNIFE_STRIKE_T = 0.44;             // fraction of the swing where the ray fires
const KNIFE_COOLDOWN = 0.55;             // s, minimum gap between swing starts
const KNIFE_RANGE = 2.4;                 // m, melee reach

// ---------------------------------------------------------- weapon arsenal
// One family, three types. mk4 keeps the exact pre-arsenal stats (default
// loadout is unchanged until the player picks something up).
const WEAPON_DEFS = {
  mk4: {
    name: 'MK4 CARBINE', hudMode: '5.56 MM — AUTO',
    auto: true, rpm: 720, dmg: 26,
    spreadHip: 1.4, spreadAds: 0.12,
    bloomAdd: 0.35, bloomMax: 1.6, bloomDecay: 4.5,
    magSize: 30, reserveStart: 150, reloadTime: 2.1,
    adsSpeed: 14, adsZ: -0.22,
    kickPitch: 0.0072, kickPitchRand: 0.0026, kickYawRand: 0.0056,
    vmKick: 1.0, vmKickMaxZ: 0.055, vmKickMaxP: 0.09,
  },
  smg: {
    // fast, loose, ammo-rich: light per-shot kick that stacks hard, wide hip
    // cone; faster hands (ADS + reload) than the carbine
    name: 'VULCAN-9', hudMode: '9 MM — AUTO',
    auto: true, rpm: 950, dmg: 17,
    spreadHip: 1.9, spreadAds: 0.30,
    bloomAdd: 0.30, bloomMax: 2.8, bloomDecay: 3.0,
    magSize: 36, reserveStart: 180, reloadTime: 1.8,
    adsSpeed: 19, adsZ: -0.21,
    kickPitch: 0.0042, kickPitchRand: 0.0019, kickYawRand: 0.0064,
    vmKick: 0.75, vmKickMaxZ: 0.05, vmKickMaxP: 0.08,
  },
  dmr: {
    // SEMI-AUTO: exactly one round per trigger click, hard single kick,
    // laser-precise at ADS, slow deliberate handling
    name: 'LYNX-7', hudMode: '7.62 — SEMI',
    auto: false, rpm: 250, dmg: 55,
    spreadHip: 0.9, spreadAds: 0.05,
    bloomAdd: 1.1, bloomMax: 2.2, bloomDecay: 5.5,
    magSize: 12, reserveStart: 48, reloadTime: 2.45,
    adsSpeed: 10, adsZ: -0.18,
    kickPitch: 0.021, kickPitchRand: 0.005, kickYawRand: 0.004,
    vmKick: 2.1, vmKickMaxZ: 0.11, vmKickMaxP: 0.17,
    heavyShot: true,                     // prefers a deeper report if audio has one
  },
  // ---- SLOT 2: sidearm. SEMI-AUTO (one round per click), light recoil, tight
  // cone, fast iron-sight ADS. Reserve auto-refills on equip — it's a fallback.
  pistol: {
    name: 'M9 SIDEARM', hudMode: '9 MM — SEMI',
    kind: 'pistol', auto: false, rpm: 360, dmg: 34,
    spreadHip: 2.2, spreadAds: 0.4,
    bloomAdd: 0.5, bloomMax: 2.0, bloomDecay: 6.0,
    magSize: 15, reserveStart: 60, reloadTime: 1.4,
    adsSpeed: 20, adsZ: PISTOL_ADS_Z,
    kickPitch: 0.006, kickPitchRand: 0.0022, kickYawRand: 0.004,
    vmKick: 0.9, vmKickMaxZ: 0.045, vmKickMaxP: 0.08,
    pistolShot: true,                    // lighter report variant if audio has one
  },
  // ---- SLOT 3: melee. No ammo, no ADS, no muzzle fx — a slash + short ray.
  knife: {
    name: 'COMBAT KNIFE', hudMode: 'MELEE',
    kind: 'knife', melee: true, dmg: 140, rpm: 120,
    spreadHip: 3.0, spreadAds: 3.0, bloomDecay: 5.0,
  },
};

const { damp, lerp, clamp, degToRad, smoothstep } = THREE.MathUtils;
const sm01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// ---------------------------------------------------------------- textures
// Worn gunmetal / polymer albedo + roughness pair. Box/cylinder UVs run 0..1
// per face, so the lightened border reads as edge-wear on every machined part.
// Albedo is deliberately mid-dark (~0.18-0.28 sRGB) — with no envmap the
// only lighting response comes from diffuse + punctual specular, so near-zero
// albedo renders as a dead black silhouette.
function makeWearMaps(kind) {
  const S = 256;
  const cm = document.createElement('canvas'); cm.width = cm.height = S;
  const cr = document.createElement('canvas'); cr.width = cr.height = S;
  const g = cm.getContext('2d');
  const r = cr.getContext('2d');
  const metal = kind === 'metal';

  // base coat: cool gunmetal vs olive-drab polymer — both kept mid-dark
  // (~25% below the original pass) so the viewmodel sits in scene shadow
  // instead of glowing against the street.
  g.fillStyle = metal ? '#2d3237' : '#313421';
  g.fillRect(0, 0, S, S);
  const rBase = metal ? 110 : 172;
  r.fillStyle = `rgb(${rBase},${rBase},${rBase})`;
  r.fillRect(0, 0, S, S);

  // large soft tonal blotches — breaks the flat machine-uniform look
  for (let i = 0; i < 48; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const rad = 22 + Math.random() * 70;
    const lite = Math.random() > 0.55;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, lite ? 'rgba(235,240,245,0.07)' : 'rgba(0,0,0,0.11)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    const rr = r.createRadialGradient(x, y, 0, x, y, rad);
    const rv = rBase + (lite ? -28 : 24);
    rr.addColorStop(0, `rgba(${rv},${rv},${rv},0.5)`);
    rr.addColorStop(1, `rgba(${rv},${rv},${rv},0)`);
    r.fillStyle = rr;
    r.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // vertical grime drips — dirty field-carry look on sun-facing flats
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * S, y = Math.random() * S * 0.7;
    const len = 12 + Math.random() * 46, w = 1 + Math.random() * 2;
    const dg = g.createLinearGradient(0, y, 0, y + len);
    dg.addColorStop(0, `rgba(12,12,10,${0.10 + Math.random() * 0.1})`);
    dg.addColorStop(1, 'rgba(12,12,10,0)');
    g.fillStyle = dg;
    g.fillRect(x, y, w, len);
    r.fillStyle = `rgba(${rBase + 26},${rBase + 26},${rBase + 26},0.4)`;
    r.fillRect(x, y, w, len);
  }

  if (metal) {
    // brushed/anodized horizontal streaks — subtle anisotropic feel
    for (let i = 0; i < 170; i++) {
      const y = Math.random() * S, w = 30 + Math.random() * 200;
      const x = Math.random() * S - 60;
      const lite = Math.random() > 0.5;
      g.fillStyle = lite ? 'rgba(165,175,185,0.085)' : 'rgba(0,0,0,0.09)';
      g.fillRect(x, y, w, 1);
      const rv = rBase + (lite ? -26 : 20);
      r.fillStyle = `rgba(${rv},${rv},${rv},0.5)`;
      r.fillRect(x, y, w, 1);
    }
    // fine scratches — bright, low-roughness hairlines
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const len = 8 + Math.random() * 34;
      const a = Math.random() * Math.PI;
      const dx = Math.cos(a) * len, dy = Math.sin(a) * len * 0.35;
      g.strokeStyle = `rgba(185,193,202,${0.10 + Math.random() * 0.18})`;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y + dy); g.stroke();
      r.strokeStyle = 'rgba(48,48,48,0.55)';
      r.lineWidth = 1;
      r.beginPath(); r.moveTo(x, y); r.lineTo(x + dx, y + dy); r.stroke();
    }
  } else {
    // polymer stipple grain
    for (let i = 0; i < 2400; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const lite = Math.random() > 0.45;
      g.fillStyle = lite ? 'rgba(168,168,150,0.11)' : 'rgba(0,0,0,0.13)';
      g.fillRect(x, y, 1.4, 1.4);
      const rv = rBase + (lite ? -14 : 10);
      r.fillStyle = `rgba(${rv},${rv},${rv},0.55)`;
      r.fillRect(x, y, 1.4, 1.4);
    }
  }
  // grime speckle both
  for (let i = 0; i < 900; i++) {
    g.fillStyle = 'rgba(0,0,0,0.10)';
    g.fillRect(Math.random() * S, Math.random() * S, 1, 1);
  }
  // edge wear frame: lighter albedo, shinier roughness toward face borders
  const EW = metal ? 11 : 7;
  for (let i = 0; i < EW; i++) {
    const a = (1 - i / EW) * (metal ? 0.26 : 0.15);
    g.strokeStyle = `rgba(${metal ? '188,196,205' : '150,150,132'},${a})`;
    g.lineWidth = 1;
    g.strokeRect(i + 0.5, i + 0.5, S - 1 - i * 2, S - 1 - i * 2);
    const rv = rBase - (metal ? 62 : 44) * (1 - i / EW);
    r.strokeStyle = `rgba(${rv},${rv},${rv},0.6)`;
    r.lineWidth = 1;
    r.strokeRect(i + 0.5, i + 0.5, S - 1 - i * 2, S - 1 - i * 2);
  }
  // random chips / bare-metal nicks near edges
  for (let i = 0; i < 52; i++) {
    const edge = Math.floor(Math.random() * 4);
    const t = Math.random() * S;
    const d = Math.random() * 14;
    const x = edge === 0 ? d : edge === 1 ? S - d : t;
    const y = edge === 2 ? d : edge === 3 ? S - d : t;
    const sz = 1 + Math.random() * (metal ? 2.4 : 1.6);
    g.fillStyle = metal ? 'rgba(196,203,211,0.55)' : 'rgba(150,150,134,0.4)';
    g.fillRect(x, y, sz, sz);
    r.fillStyle = 'rgba(52,52,52,0.7)';
    r.fillRect(x, y, sz, sz);
  }

  const map = new THREE.CanvasTexture(cm);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const rough = new THREE.CanvasTexture(cr);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  rough.anisotropy = 4;
  return { map, rough };
}

// Dark hard-rubber / coated-fitting maps for the small furniture parts
// (butt pad, rail base, muzzle rings…). Matters most at ADS where the butt
// pad end-cap fills the lower frame: stipple + edge-wear frame gives those
// faces real texture + a lit top-edge instead of one flat gray slab.
function makeRubberMaps() {
  const S = 256;
  const cm = document.createElement('canvas'); cm.width = cm.height = S;
  const cr = document.createElement('canvas'); cr.width = cr.height = S;
  const g = cm.getContext('2d');
  const r = cr.getContext('2d');
  g.fillStyle = '#202224'; g.fillRect(0, 0, S, S);
  r.fillStyle = 'rgb(205,205,205)'; r.fillRect(0, 0, S, S);
  // soft blotches
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const rad = 20 + Math.random() * 60;
    const lite = Math.random() > 0.5;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, lite ? 'rgba(210,215,220,0.05)' : 'rgba(0,0,0,0.12)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // rubber stipple
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const lite = Math.random() > 0.42;
    g.fillStyle = lite ? 'rgba(150,153,158,0.10)' : 'rgba(0,0,0,0.16)';
    g.fillRect(x, y, 1.3, 1.3);
    const rv = 205 + (lite ? -22 : 14);
    r.fillStyle = `rgba(${rv},${rv},${rv},0.5)`;
    r.fillRect(x, y, 1.3, 1.3);
  }
  // worn edge frame — reads as a subtle highlight along box top edges
  for (let i = 0; i < 8; i++) {
    const a = (1 - i / 8) * 0.22;
    g.strokeStyle = `rgba(168,173,180,${a})`;
    g.lineWidth = 1;
    g.strokeRect(i + 0.5, i + 0.5, S - 1 - i * 2, S - 1 - i * 2);
    const rv = 205 - 70 * (1 - i / 8);
    r.strokeStyle = `rgba(${rv},${rv},${rv},0.6)`;
    r.strokeRect(i + 0.5, i + 0.5, S - 1 - i * 2, S - 1 - i * 2);
  }
  const map = new THREE.CanvasTexture(cm);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  const rough = new THREE.CanvasTexture(cr);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  return { map, rough };
}

// Glove / sleeve maps for the first-person hands.
//   glove  — near-black worn leather, lighter scuff wear across the knuckle
//            band, faint stitch rows, roughness ~0.85.
//   sleeve — olive-drab ripstop weave, matte (roughness ~0.92).
function makeHandMaps(kind) {
  const S = 256;
  const cm = document.createElement('canvas'); cm.width = cm.height = S;
  const cr = document.createElement('canvas'); cr.width = cr.height = S;
  const g = cm.getContext('2d');
  const r = cr.getContext('2d');
  const glove = kind === 'glove';
  g.fillStyle = glove ? '#17181a' : '#2f3325';
  g.fillRect(0, 0, S, S);
  const rBase = glove ? 217 : 235;
  r.fillStyle = `rgb(${rBase},${rBase},${rBase})`;
  r.fillRect(0, 0, S, S);

  if (glove) {
    // leather pore grain
    for (let i = 0; i < 2100; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const lite = Math.random() > 0.5;
      g.fillStyle = lite ? 'rgba(96,98,104,0.09)' : 'rgba(0,0,0,0.16)';
      g.fillRect(x, y, 1.4, 1.4);
    }
    // knuckle-band wear: a horizontal belt of lighter scuff blobs
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * S;
      const y = S * 0.36 + (Math.random() - 0.5) * S * 0.22;
      const rad = 7 + Math.random() * 20;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(126,128,132,0.16)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      const rr = r.createRadialGradient(x, y, 0, x, y, rad);
      rr.addColorStop(0, 'rgba(170,170,170,0.5)');   // worn = slightly shinier
      rr.addColorStop(1, 'rgba(170,170,170,0)');
      r.fillStyle = rr;
      r.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // stitch rows
    for (let s = 0; s < 5; s++) {
      const y = 26 + s * 50;
      for (let x = 0; x < S; x += 7) {
        g.fillStyle = 'rgba(70,72,76,0.55)';
        g.fillRect(x, y, 4, 1.4);
      }
    }
  } else {
    // ripstop weave: fine alternating warp/weft lines + speckle
    for (let y = 0; y < S; y += 3) {
      g.fillStyle = `rgba(0,0,0,${y % 6 ? 0.10 : 0.05})`;
      g.fillRect(0, y, S, 1);
    }
    for (let x = 0; x < S; x += 3) {
      g.fillStyle = `rgba(88,94,68,${x % 6 ? 0.09 : 0.045})`;
      g.fillRect(x, 0, 1, S);
    }
    for (let i = 0; i < 1500; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const lite = Math.random() > 0.5;
      g.fillStyle = lite ? 'rgba(120,126,92,0.10)' : 'rgba(0,0,0,0.12)';
      g.fillRect(x, y, 1.5, 1.5);
    }
    // dusty fade patches
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const rad = 24 + Math.random() * 60;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(140,140,116,0.06)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }

  const map = new THREE.CanvasTexture(cm);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  const rough = new THREE.CanvasTexture(cr);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  return { map, rough };
}

// Crisp round emitter: hard hot core, short falloff, fully transparent well
// inside the sprite quad so additive blending can never reveal the square.
function makeDotTexture() {
  const S = 64;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0.0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.24, 'rgba(255,214,200,1)');
  gr.addColorStop(0.42, 'rgba(255,80,52,0.9)');
  gr.addColorStop(0.60, 'rgba(255,42,26,0.22)');
  gr.addColorStop(0.74, 'rgba(255,42,26,0)');
  gr.addColorStop(1.0, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// DMR scope reticle: fine dark duplex crosshair + mil hashes + red center
// dot, clipped to a circle so the sprite corners never draw over the tube.
// Sprite center == texture center => exact screen center at full ADS.
function makeReticleTexture() {
  const S = 128;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.48, 0, Math.PI * 2); g.clip();
  g.strokeStyle = 'rgba(6,7,9,0.92)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(S / 2, 3); g.lineTo(S / 2, S - 3);
  g.moveTo(3, S / 2); g.lineTo(S - 3, S / 2);
  g.stroke();
  // thicker duplex posts toward the rim
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(S / 2, 3); g.lineTo(S / 2, 22);
  g.moveTo(S / 2, S - 22); g.lineTo(S / 2, S - 3);
  g.moveTo(3, S / 2); g.lineTo(22, S / 2);
  g.moveTo(S - 22, S / 2); g.lineTo(S - 3, S / 2);
  g.stroke();
  // mil hashes
  g.lineWidth = 1.5;
  for (let i = 1; i <= 2; i++) {
    const o = i * 15;
    g.beginPath();
    g.moveTo(S / 2 - 5, S / 2 + o); g.lineTo(S / 2 + 5, S / 2 + o);
    g.moveTo(S / 2 - 5, S / 2 - o); g.lineTo(S / 2 + 5, S / 2 - o);
    g.moveTo(S / 2 + o, S / 2 - 5); g.lineTo(S / 2 + o, S / 2 + 5);
    g.moveTo(S / 2 - o, S / 2 - 5); g.lineTo(S / 2 - o, S / 2 + 5);
    g.stroke();
  }
  // fine illuminated center dot
  g.fillStyle = 'rgba(255,58,38,0.95)';
  g.beginPath(); g.arc(S / 2, S / 2, 2.4, 0, Math.PI * 2); g.fill();
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- geometry
// Parameterized per weapon type — one shared receiver/grip/stock family with
// a per-type front end (handguard/barrel/muzzle), optic and magazine:
//   mk4 — 14" M-LOK handguard, birdcage, red dot, curved 5.56 mag (original)
//   smg — stubby handguard, short barrel + fat suppressor, thick straight mag
//   dmr — long slim handguard, long barrel, scope tube, short 7.62 box mag,
//         longer stock w/ cheek riser
function buildRifle(type = 'mk4') {
  const smg = type === 'smg', dmr = type === 'dmr';
  const bagMetal = [], bagPoly = [], bagDark = [], bagScope = [];
  const stockPoly = [], stockDark = [];   // own group → ADS tuck (see update)
  const ONE = new THREE.Vector3(1, 1, 1);
  const place = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      ONE));
    return geo;
  };
  const B = (bag, w, h, d, x, y, z, rx, ry, rz) =>
    bag.push(place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz));
  const C = (bag, rt, rb, h, seg, open, x, y, z, rx = 0, ry = 0, rz = 0, pre = 0) => {
    const geo = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    if (pre) geo.rotateY(pre);
    bag.push(place(geo, x, y, z, rx, ry, rz));
  };
  const T = (bag, R, tube, x, y, z) =>
    bag.push(place(new THREE.TorusGeometry(R, tube, 10, 28), x, y, z));
  const HPI = Math.PI / 2;

  // per-type front-end dimensions (mk4 values reproduce the original rifle)
  const HG_LEN = smg ? 0.15 : dmr ? 0.30 : 0.245;   // handguard length
  const HG_R = smg ? 0.0245 : dmr ? 0.020 : 0.0235; // handguard radius
  const HG_C = smg ? -0.23 : dmr ? -0.305 : -0.276; // handguard center z
  const HG_FRONT = HG_C - HG_LEN / 2;
  const BLEN = smg ? 0.045 : dmr ? 0.14 : 0.085;    // exposed barrel length
  const BSTART = HG_FRONT + 0.0035;
  const BEND = BSTART - BLEN;
  const STOCK_DZ = dmr ? 0.045 : 0;                 // marksman stock: longer

  // ---- receiver group (upper / lower / magwell)
  B(bagMetal, 0.038, 0.052, 0.205, 0, 0.008, -0.052);
  B(bagMetal, 0.034, 0.044, 0.022, 0, 0.008, -0.158);      // front taper
  B(bagMetal, 0.036, 0.046, 0.155, 0, -0.026, -0.028);     // lower
  B(bagMetal, 0.041, 0.034, 0.052, 0, -0.052, -0.078);     // magwell flare
  B(bagDark, 0.036, 0.006, 0.046, 0, -0.0685, -0.078);     // magwell mouth
  B(bagMetal, 0.03, 0.04, 0.008, 0, 0.0, 0.047);           // end plate

  // ---- picatinny rail: dark base strip + notch blocks (receiver → handguard)
  const RAIL_FRONT = HG_FRONT + 0.0135;
  const RAIL_LEN = 0.055 - RAIL_FRONT;
  B(bagDark, 0.03, 0.008, RAIL_LEN, 0, 0.038, 0.055 - RAIL_LEN / 2);
  const N_NOTCH = Math.round((0.046 - (HG_FRONT + 0.024)) / 0.0185);
  for (let i = 0; i < N_NOTCH; i++) {
    B(bagMetal, 0.034, 0.0065, 0.0095, 0, 0.0425, 0.046 - i * 0.0185);
  }
  B(bagMetal, 0.026, 0.006, HG_LEN - 0.005, 0, 0.0335, HG_C + 0.004); // handguard riser

  // ---- ejection port + right-side furniture
  B(bagMetal, 0.004, 0.027, 0.07, 0.0185, 0.005, -0.05);
  B(bagDark, 0.0045, 0.019, 0.06, 0.0192, 0.005, -0.05);
  B(bagMetal, 0.01, 0.018, 0.014, 0.0215, 0.006, -0.016, 0, 0.55, 0); // deflector
  C(bagMetal, 0.0075, 0.0075, 0.014, 10, false, 0.0235, 0.012, -0.006, 0, 0, HPI); // fwd assist
  C(bagDark, 0.006, 0.006, 0.005, 8, false, 0.02, -0.01, -0.05, 0, 0, HPI); // mag release

  // ---- left-side controls
  B(bagMetal, 0.0045, 0.028, 0.018, -0.0195, 0.004, -0.05);          // bolt catch
  C(bagMetal, 0.0055, 0.0055, 0.006, 8, false, -0.0205, -0.006, 0.008, 0, 0, HPI);
  B(bagMetal, 0.0045, 0.006, 0.026, -0.022, -0.006, -0.003);         // safety lever

  // ---- trigger group
  B(bagMetal, 0.007, 0.0045, 0.062, 0, -0.0585, -0.018);
  B(bagMetal, 0.007, 0.02, 0.0045, 0, -0.0495, -0.047);
  B(bagDark, 0.006, 0.021, 0.0055, 0, -0.046, -0.012, 0.28, 0, 0);

  // ---- buffer tube + telescoping stock (stock rides its own group so the
  //      ADS pose can tuck it down/forward out of the sight picture);
  //      dmr: extended marksman pull + cheek riser
  C(bagMetal, 0.0155, 0.0155, 0.115 + STOCK_DZ, 12, false, 0, 0.012, 0.102 + STOCK_DZ / 2, HPI);
  C(bagMetal, 0.017, 0.017, 0.011, 12, false, 0, 0.012, 0.051, HPI); // castle nut
  B(stockPoly, 0.04, 0.052, 0.095, 0, -0.006, 0.14 + STOCK_DZ);
  B(stockPoly, 0.034, 0.032, 0.095, 0, 0.022, 0.14 + STOCK_DZ);
  B(stockDark, 0.042, 0.096, 0.012, 0, -0.006, 0.192 + STOCK_DZ);     // rubber butt pad
  B(stockDark, 0.022, 0.01, 0.032, 0, -0.038, 0.128 + STOCK_DZ);      // adjust lever
  B(stockDark, 0.044, 0.006, 0.016, 0, -0.018, 0.158 + STOCK_DZ);     // sling slot
  if (dmr) B(stockPoly, 0.032, 0.013, 0.082, 0, 0.0435, 0.145 + STOCK_DZ); // cheek riser

  // ---- pistol grip
  B(bagPoly, 0.03, 0.092, 0.046, 0, -0.096, 0.03, -0.34, 0, 0);
  B(bagPoly, 0.033, 0.04, 0.034, 0, -0.064, 0.018, -0.34, 0, 0);
  B(bagPoly, 0.032, 0.014, 0.02, 0, -0.049, 0.036);        // beavertail
  B(bagDark, 0.027, 0.007, 0.04, 0, -0.139, 0.046, -0.34, 0, 0);

  // ---- M-LOK handguard (octagonal free-float tube)
  C(bagMetal, HG_R, HG_R, HG_LEN, 8, true, 0, 0.006, HG_C, HPI, 0, 0, Math.PI / 8);
  C(bagMetal, HG_R + 0.001, HG_R + 0.001, 0.014, 10, false, 0, 0.006, -0.16, HPI); // barrel nut
  C(bagMetal, HG_R + 0.0007, HG_R + 0.0007, 0.01, 8, false, 0, 0.006, HG_FRONT + 0.0025, HPI, 0, 0, Math.PI / 8);
  for (let z = -0.19; z > HG_FRONT + 0.035; z -= 0.042) {
    // M-LOK slots 3/9 o'clock, 6 o'clock between pairs
    B(bagDark, 0.005, 0.011, 0.035, HG_R - 0.001, 0.004, z);
    B(bagDark, 0.005, 0.011, 0.035, -(HG_R - 0.001), 0.004, z);
    if (z - 0.042 > HG_FRONT + 0.035) B(bagDark, 0.011, 0.005, 0.035, 0, -(HG_R - 0.007), z - 0.021);
  }
  C(bagDark, 0.006, 0.006, 0.004, 10, false, -HG_R, 0.004, -0.185, 0, 0, HPI); // QD socket

  // ---- barrel + per-type muzzle device
  C(bagMetal, 0.0095, 0.0105, BLEN, 10, false, 0, 0, BSTART - BLEN / 2, HPI);
  let MUZZLE_Z;
  if (smg) {
    // fat cylindrical suppressor swallowing the stub barrel
    C(bagDark, 0.0205, 0.0205, 0.125, 14, false, 0, 0, BEND - 0.0545, HPI);
    C(bagMetal, 0.0209, 0.0209, 0.007, 14, false, 0, 0, BEND + 0.0035, HPI);  // base ring
    C(bagMetal, 0.0209, 0.0209, 0.007, 14, false, 0, 0, BEND - 0.1125, HPI);  // end ring
    C(bagDark, 0.012, 0.012, 0.006, 12, false, 0, 0, BEND - 0.119, HPI);      // exit
    MUZZLE_Z = BEND - 0.1215;
  } else {
    // birdcage flash hider (mk4 + dmr share the family muzzle device)
    C(bagMetal, 0.0138, 0.0138, 0.009, 10, false, 0, 0, BEND + 0.0005, HPI);
    C(bagMetal, 0.0125, 0.0125, 0.042, 10, false, 0, 0, BEND - 0.019, HPI);
    B(bagDark, 0.029, 0.004, 0.008, 0, 0.0065, BEND - 0.009);
    B(bagDark, 0.029, 0.004, 0.008, 0, 0.0065, BEND - 0.022);
    B(bagDark, 0.004, 0.029, 0.008, 0, 0, BEND - 0.0155);
    C(bagDark, 0.0092, 0.0092, 0.006, 10, false, 0, 0, BEND - 0.0425, HPI);   // crown
    MUZZLE_Z = BEND - 0.045;
  }
  if (dmr) {
    // heavy-profile step where the barrel exits the handguard
    C(bagMetal, 0.0118, 0.0118, 0.035, 10, false, 0, 0, BSTART - 0.0175, HPI);
  }

  // ---- folded backup irons (omitted on the dmr — they would silhouette
  // inside the scope picture on the optical axis)
  if (!dmr) {
    const FRONT_IRON = HG_FRONT + 0.0365;
    B(bagMetal, 0.024, 0.007, 0.024, 0, 0.0495, 0.03);
    B(bagMetal, 0.022, 0.007, 0.028, 0, 0.0495, FRONT_IRON);
    B(bagMetal, 0.006, 0.007, 0.008, 0, 0.0565, FRONT_IRON);
  }

  if (dmr) {
    // ---- scope: mount + open main tube (the ADS eye looks straight through
    // it) + objective/eyepiece bells + rings + turrets. Optical axis stays on
    // (0, SIGHT_Y, z) => identical ADS centering to the red dot.
    B(bagMetal, 0.026, 0.015, 0.07, 0, 0.0525, -0.075);                        // mount
    C(bagScope, 0.0225, 0.0225, 0.08, 24, true, 0, SIGHT_Y, -0.075, HPI);      // main tube
    C(bagScope, 0.0285, 0.023, 0.026, 20, true, 0, SIGHT_Y, -0.126, HPI);      // objective bell
    T(bagMetal, 0.0285, 0.0035, 0, SIGHT_Y, -0.140);                           // objective ring
    C(bagScope, 0.0235, 0.026, 0.022, 20, true, 0, SIGHT_Y, -0.022, HPI);      // eyepiece bell
    T(bagMetal, 0.026, 0.0032, 0, SIGHT_Y, -0.010);                            // eye ring
    C(bagMetal, 0.009, 0.009, 0.014, 12, false, 0, SIGHT_Y + 0.026, -0.075);   // elevation turret
    C(bagMetal, 0.009, 0.009, 0.012, 12, false, 0.026, SIGHT_Y, -0.075, 0, 0, HPI); // windage
  } else {
    // ---- red-dot sight: mount + torus housing + turret + battery cap
    B(bagMetal, 0.026, 0.015, 0.052, 0, 0.0525, -0.075);
    T(bagMetal, 0.0205, 0.0052, 0, SIGHT_Y, -0.075);
    T(bagMetal, 0.018, 0.0035, 0, SIGHT_Y, -0.086);
    T(bagMetal, 0.018, 0.0035, 0, SIGHT_Y, -0.064);
    B(bagMetal, 0.013, 0.008, 0.014, 0, 0.0935, -0.075);
    C(bagMetal, 0.0075, 0.0075, 0.008, 10, false, 0.0245, SIGHT_Y, -0.075, 0, 0, HPI);
    C(bagMetal, 0.004, 0.004, 0.006, 8, false, 0.0145, 0.0525, -0.063, 0, 0, HPI);
    C(bagMetal, 0.004, 0.004, 0.006, 8, false, 0.0145, 0.0525, -0.087, 0, 0, HPI);
  }

  // ---- magazine (own group → reload animation)
  //   mk4: curved 5.56 30-rounder  smg: thick straight 9mm stick
  //   dmr: short 7.62 box
  const magBody = [], magDark = [];
  if (smg) {
    B(magBody, 0.031, 0.155, 0.057, 0, -0.068, -0.007, 0.10, 0, 0);
    for (let i = 0; i < 3; i++) {                       // witness ribs
      B(magDark, 0.033, 0.005, 0.05, 0, -0.032 - i * 0.042, -0.0105 + i * 0.0042, 0.10, 0, 0);
    }
    B(magDark, 0.035, 0.011, 0.063, 0, -0.146, -0.0145, 0.10, 0, 0);   // base pad
  } else if (dmr) {
    B(magBody, 0.027, 0.105, 0.064, 0, -0.044, -0.006, 0.14, 0, 0);
    B(magDark, 0.029, 0.005, 0.058, 0, -0.052, -0.007, 0.14, 0, 0);    // seam rib
    B(magDark, 0.031, 0.011, 0.070, 0, -0.098, -0.0135, 0.14, 0, 0);   // base pad
  } else {
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3(0, 0.012, 0);
    const down = new THREE.Vector3();
    const segLen = 0.033;
    for (let i = 0; i < 6; i++) {
      e.set(0.07 + i * 0.085, 0, 0);
      q.setFromEuler(e);
      down.set(0, -1, 0).applyQuaternion(q);
      const c = p.clone().addScaledVector(down, segLen * 0.5);
      const geo = new THREE.BoxGeometry(0.026, segLen + 0.004, 0.052);
      geo.applyMatrix4(new THREE.Matrix4().compose(c, q.clone(), ONE));
      magBody.push(geo);
      p.addScaledVector(down, segLen);
    }
    const base = new THREE.BoxGeometry(0.031, 0.01, 0.06);
    base.applyMatrix4(new THREE.Matrix4().compose(
      p.clone().addScaledVector(down, 0.003), q.clone(), ONE));
    magDark.push(base);
  }

  // ---- charging handle (own group → reload rack)
  const chGeos = [];
  const chPut = (w, h, d, x, y, z) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(x, y, z);
    chGeos.push(geo);
  };
  chPut(0.012, 0.009, 0.05, 0, 0, 0.006);
  chPut(0.026, 0.0065, 0.011, 0, 0, 0.03);   // latch stays inside the receiver
  chPut(0.015, 0.011, 0.017, 0, 0, 0.028);   // silhouette 15cm from the ADS eye

  return {
    metal: mergeGeometries(bagMetal),
    poly: bagPoly.length ? mergeGeometries(bagPoly) : null,
    dark: mergeGeometries(bagDark),
    scope: bagScope.length ? mergeGeometries(bagScope) : null,
    stockPoly: mergeGeometries(stockPoly),
    stockDark: mergeGeometries(stockDark),
    magBody: mergeGeometries(magBody),
    magDark: mergeGeometries(magDark),
    ch: mergeGeometries(chGeos),
    muzzleZ: MUZZLE_Z,
  };
}

// ---------------------------------------------------------------- pistol
// Procedural M9-class sidearm. Slide (own group → blowback/rack) + polymer
// frame/grip + magazine (own group → reload drop) + iron sights on the shared
// (x=0, y=SIGHT_Y) axis so ADS centers pixel-exact like the rifle optics.
// Muzzle at the barrel tip; points -Z, grip rakes back-down.
function buildPistol() {
  const bagMetal = [], bagPoly = [], bagDark = [];
  const slideMetal = [], slideDark = [];   // slide + sights (own group)
  const magBody = [], magDark = [];        // magazine (own group)
  const ONE = new THREE.Vector3(1, 1, 1);
  const HPI = Math.PI / 2;
  const place = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), ONE));
    return geo;
  };
  const B = (bag, w, h, d, x, y, z, rx, ry, rz) =>
    bag.push(place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz));
  const C = (bag, rt, rb, h, seg, open, x, y, z, rx = 0, ry = 0, rz = 0) =>
    bag.push(place(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), x, y, z, rx, ry, rz));
  const T = (bag, R, tube, x, y, z, rx = 0, ry = 0, rz = 0) =>
    bag.push(place(new THREE.TorusGeometry(R, tube, 10, 24), x, y, z, rx, ry, rz));

  const SY = SIGHT_Y;                   // 0.0656 — sight axis, shared with rifle
  const MUZZLE_Z = -0.150;

  // ---- slide group: main block, barrel/chamber, serrations, ejection port
  B(slideMetal, 0.028, 0.030, 0.196, 0, 0.045, -0.038);       // main slide
  B(slideMetal, 0.026, 0.014, 0.022, 0, 0.031, 0.057);        // rear hump
  B(slideDark, 0.020, 0.004, 0.150, 0, 0.061, -0.040);        // sight rib channel
  B(slideDark, 0.006, 0.015, 0.030, 0.012, 0.049, -0.006);    // ejection port
  for (let i = 0; i < 5; i++) B(slideDark, 0.0295, 0.026, 0.0025, 0, 0.045, 0.030 + i * 0.008);
  for (let i = 0; i < 4; i++) B(slideDark, 0.0295, 0.024, 0.0025, 0, 0.045, -0.100 - i * 0.008);
  C(slideMetal, 0.0086, 0.0086, 0.03, 12, false, 0, 0.045, -0.126, HPI); // barrel/chamber
  C(slideDark, 0.0058, 0.0058, 0.008, 10, false, 0, 0.045, -0.146, HPI); // bore mouth
  // iron sights: rear two-post notch + front blade, tops at y=SY, notch on x=0
  B(slideMetal, 0.006, 0.012, 0.010, -0.0075, SY - 0.006, 0.050);        // rear left post
  B(slideMetal, 0.006, 0.012, 0.010, 0.0075, SY - 0.006, 0.050);         // rear right post
  B(slideDark, 0.021, 0.006, 0.012, 0, SY - 0.015, 0.050);               // rear sight base
  B(slideMetal, 0.005, 0.012, 0.008, 0, SY - 0.006, -0.120);             // front blade

  // ---- frame (poly) + rail + slide-stop / takedown (metal accents)
  B(bagPoly, 0.024, 0.020, 0.162, 0, 0.026, -0.020);          // dust cover / frame top
  B(bagDark, 0.020, 0.008, 0.050, 0, 0.016, -0.100);          // accessory rail
  C(bagMetal, 0.004, 0.004, 0.028, 8, false, 0, 0.020, -0.030, 0, 0, HPI); // takedown pin
  B(bagMetal, 0.004, 0.009, 0.030, -0.013, 0.030, 0.020);     // slide-stop lever
  T(bagPoly, 0.019, 0.0045, 0, 0.006, 0.006, 0, HPI, 0);      // trigger guard ring
  B(bagDark, 0.006, 0.018, 0.005, 0, 0.006, 0.008, 0.22, 0, 0); // trigger

  // ---- grip (rakes back-down), textured polymer
  const GR = -0.36;
  B(bagPoly, 0.030, 0.104, 0.040, 0, -0.052, 0.030, GR, 0, 0);   // grip body
  B(bagPoly, 0.028, 0.030, 0.030, 0, -0.006, 0.016, GR, 0, 0);   // backstrap top
  B(bagPoly, 0.026, 0.014, 0.020, 0, 0.006, 0.050);              // beavertail
  B(bagDark, 0.006, 0.010, 0.012, 0.012, 0.030, 0.062);          // hammer / stop nub

  // ---- magazine (own group → reload drop)
  B(magBody, 0.026, 0.098, 0.034, 0, -0.050, 0.030, GR, 0, 0);
  B(magDark, 0.031, 0.012, 0.045, 0, -0.103, 0.052, GR, 0, 0);   // baseplate

  return {
    metal: mergeGeometries(bagMetal),
    poly: mergeGeometries(bagPoly),
    dark: mergeGeometries(bagDark),
    slideMetal: mergeGeometries(slideMetal),
    slideDark: mergeGeometries(slideDark),
    magBody: mergeGeometries(magBody),
    magDark: mergeGeometries(magDark),
    muzzleZ: MUZZLE_Z, muzzleY: 0.045,
  };
}

// ---------------------------------------------------------------- knife
// Procedural combat knife: tapered beveled blade (ExtrudeGeometry so the edge
// gets a real bevel), crossguard, wrapped handle, pommel. Built in its own
// local frame — blade forward (-Z), spine up (+Y), edge down (-Y); the model
// group angles it in the hand and the slash anim sweeps the whole thing.
function buildKnife() {
  const bagMetal = [], bagDark = [], bagPoly = [];
  const ONE = new THREE.Vector3(1, 1, 1);
  const place = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), ONE));
    return geo;
  };
  const B = (bag, w, h, d, x, y, z, rx, ry, rz) =>
    bag.push(place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz));

  // blade silhouette in XY (length along +X, width along Y) → extrude thin
  // along Z, bevel on → clip-point knife with a sharpened edge
  const shape = new THREE.Shape();
  shape.moveTo(0.0, -0.014);
  shape.lineTo(0.0, 0.016);
  shape.lineTo(0.085, 0.014);
  shape.lineTo(0.135, 0.007);
  shape.lineTo(0.160, 0.0);     // point
  shape.lineTo(0.110, -0.017);  // belly
  shape.lineTo(0.030, -0.016);
  shape.closePath();
  // ExtrudeGeometry is non-indexed (boxes are indexed) so the blade can't be
  // merged with them — it rides as its own metal mesh instead.
  const blade = new THREE.ExtrudeGeometry(shape, {
    depth: 0.006, bevelEnabled: true, bevelThickness: 0.0016,
    bevelSize: 0.0016, bevelSegments: 1, steps: 1,
  });
  blade.translate(0, 0, -0.0046);       // center the thickness on z=0
  blade.rotateY(Math.PI / 2);           // length +X → forward -Z, thickness → X
  B(bagDark, 0.004, 0.004, 0.09, 0, 0.004, -0.060);            // fuller groove

  // crossguard at z=0
  B(bagDark, 0.050, 0.012, 0.016, 0, 0, 0.004);
  B(bagMetal, 0.044, 0.008, 0.010, 0, 0, 0.004);

  // wrapped handle behind the guard (+Z) + ring ridges + pommel
  B(bagPoly, 0.020, 0.026, 0.086, 0, -0.002, 0.058);
  for (let i = 0; i < 6; i++) B(bagDark, 0.0215, 0.0275, 0.004, 0, -0.002, 0.026 + i * 0.012);
  B(bagMetal, 0.022, 0.028, 0.014, 0, -0.002, 0.104);         // pommel

  return {
    blade,
    metal: mergeGeometries(bagMetal),
    dark: mergeGeometries(bagDark),
    poly: mergeGeometries(bagPoly),
  };
}

// ---------------------------------------------------------------- hands
// Procedural gloved hands + sleeved forearms, rifle-local coordinates
// (parented to the rifle group → inherit sway/bob/recoil/reload for free).
// Right hand wraps the pistol grip (index alongside the frame, thumb over
// the back); left support hand cups the M-LOK handguard from below and is
// built around its own origin so the ADS pose can slide it rearward.
function buildHands() {
  const gloveR = [], sleeveR = [], gloveL = [], sleeveL = [];
  const ONE = new THREE.Vector3(1, 1, 1);
  const HPI = Math.PI / 2;
  const put = (bag, geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      ONE));
    bag.push(geo);
  };
  const box = (bag, w, h, d, x, y, z, rx, ry, rz) =>
    put(bag, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
  const cap = (bag, r, len, x, y, z, rx, ry, rz) =>
    put(bag, new THREE.CapsuleGeometry(r, len, 3, 10), x, y, z, rx, ry, rz);
  // capsule oriented along an arbitrary direction, centered at (cx,cy,cz)
  const capDir = (bag, r, len, cx, cy, cz, dx, dy, dz) => {
    const d = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion()
      .setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    const geo = new THREE.CapsuleGeometry(r, len, 3, 10);
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(cx, cy, cz), q, ONE));
    bag.push(geo);
  };
  // tapered tube from a start point along a direction (wrist → elbow)
  const tube = (bag, r0, r1, len, sx, sy, sz, dx, dy, dz) => {
    const d = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion()
      .setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().negate());
    const c = new THREE.Vector3(sx, sy, sz).addScaledVector(d, len * 0.5);
    const geo = new THREE.CylinderGeometry(r0, r1, len, 10);
    geo.applyMatrix4(new THREE.Matrix4().compose(c, q, ONE));
    bag.push(geo);
  };

  // ==== RIGHT HAND — pistol grip (grip rakes back at rx -0.34) ============
  const RAKE = -0.34;
  box(gloveR, 0.022, 0.072, 0.05, 0.0245, -0.093, 0.036, RAKE, 0, -0.06); // back of hand
  box(gloveR, 0.018, 0.03, 0.044, 0.019, -0.121, 0.048, RAKE, 0, 0.05);   // palm heel
  box(gloveR, 0.016, 0.058, 0.018, 0.016, -0.086, 0.007, RAKE, 0, 0);     // knuckle pad
  // index finger runs alongside the frame above the trigger guard
  cap(gloveR, 0.0065, 0.028, 0.0205, -0.059, -0.004, HPI, 0, 0);
  // middle/ring/pinky wrap the grip front then curl on its left flank
  for (let i = 1; i < 4; i++) {
    const y = -0.064 - 0.0165 * i;
    const zc = 0.03 - (y + 0.096) * 0.334;       // follow the grip rake
    cap(gloveR, 0.0067, 0.02, 0.002, y, zc - 0.0255, 0, 0, HPI);
    cap(gloveR, 0.006, 0.015, -0.0193, y - 0.001, zc - 0.014, HPI, 0, 0);
  }
  // thumb over the back of the grip, tip curling down the left side
  capDir(gloveR, 0.0074, 0.024, -0.001, -0.057, 0.043, -1, -0.3, 0.18);
  capDir(gloveR, 0.0066, 0.011, -0.0165, -0.0645, 0.047, -0.55, -1, 0.3);
  // wrist cuff (glove) then olive sleeve exiting toward bottom-right corner
  const dR = [0.433, -0.787, 0.433];
  tube(gloveR, 0.0265, 0.0305, 0.05, 0.028, -0.126, 0.052, ...dR);
  tube(sleeveR, 0.032, 0.044, 0.3, 0.028 + dR[0] * 0.045,
    -0.126 + dR[1] * 0.045, 0.052 + dR[2] * 0.045, ...dR);

  // ==== LEFT HAND — support grip, local origin = grip point on handguard ==
  box(gloveL, 0.026, 0.034, 0.062, 0.004, -0.0335, 0.002, -0.05, 0, 0.18); // palm
  box(gloveL, 0.02, 0.026, 0.05, 0.012, -0.041, 0.012, 0, 0, 0.25);        // heel
  for (let i = 0; i < 4; i++) {
    const z = 0.021 - 0.014 * i;
    cap(gloveL, 0.0066, 0.02, -0.004, -0.0255, z, 0, 0, HPI);    // under tube
    cap(gloveL, 0.0064, 0.02, -0.027, -0.006, z, 0, 0, -0.32);   // curl up left flank
  }
  // knuckle ridge ties the four curls into one hand mass (also the part that
  // stays readable beside the receiver column at ADS)
  box(gloveL, 0.013, 0.016, 0.058, -0.0275, -0.0135, 0.0, 0, 0, -0.15);
  capDir(gloveL, 0.0072, 0.026, 0.0235, -0.0125, -0.006, 0, 0.25, -1); // thumb, far side
  const dL = [-0.30, -0.92, 0.35];
  tube(gloveL, 0.025, 0.029, 0.045, 0.006, -0.046, 0.018, ...dL);
  tube(sleeveL, 0.031, 0.042, 0.34, 0.006 + dL[0] * 0.04,
    -0.046 + dL[1] * 0.04, 0.018 + dL[2] * 0.04, ...dL);

  return {
    gloveR: mergeGeometries(gloveR),
    sleeveR: mergeGeometries(sleeveR),
    gloveL: mergeGeometries(gloveL),
    sleeveL: mergeGeometries(sleeveL),
  };
}

// Shared low-level hand-geometry closure — the box/capsule/tube helpers the
// three viewmodels build their gloves from (kept identical so all weapons read
// as the same pair of hands). Returns { box, cap, capDir, tube } bound to bags.
function handHelpers() {
  const ONE = new THREE.Vector3(1, 1, 1);
  const put = (bag, geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), ONE));
    bag.push(geo);
  };
  const box = (bag, w, h, d, x, y, z, rx, ry, rz) =>
    put(bag, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
  const cap = (bag, r, len, x, y, z, rx, ry, rz) =>
    put(bag, new THREE.CapsuleGeometry(r, len, 3, 10), x, y, z, rx, ry, rz);
  const capDir = (bag, r, len, cx, cy, cz, dx, dy, dz) => {
    const d = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    const geo = new THREE.CapsuleGeometry(r, len, 3, 10);
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), q, ONE));
    bag.push(geo);
  };
  const tube = (bag, r0, r1, len, sx, sy, sz, dx, dy, dz) => {
    const d = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().negate());
    const c = new THREE.Vector3(sx, sy, sz).addScaledVector(d, len * 0.5);
    const geo = new THREE.CylinderGeometry(r0, r1, len, 10);
    geo.applyMatrix4(new THREE.Matrix4().compose(c, q, ONE));
    bag.push(geo);
  };
  return { box, cap, capDir, tube };
}

// Pistol hands (pistol-local coordinates). Right hand wraps the grip
// (~(0,-0.05,0.03), rake -0.36) with the index finger to the trigger; the
// LEFT support hand is built at its ADS/two-hand position cupping under the
// right — the update slides its group down-and-out for the one-hand hip hold.
function buildPistolHands() {
  const gloveR = [], sleeveR = [], gloveL = [], sleeveL = [];
  const { box, cap, capDir, tube } = handHelpers();
  const HPI = Math.PI / 2;
  const RAKE = -0.36;

  // ---- right (firing) hand on the grip
  box(gloveR, 0.023, 0.078, 0.044, 0.022, -0.050, 0.030, RAKE, 0, -0.05); // back of hand
  box(gloveR, 0.018, 0.030, 0.040, 0.017, -0.082, 0.046, RAKE, 0, 0.05);  // palm heel
  cap(gloveR, 0.0062, 0.024, 0.016, -0.006, 0.008, HPI, 0, 0);            // trigger finger
  for (let i = 0; i < 3; i++) {                 // middle/ring/pinky wrap the front
    const y = -0.030 - 0.017 * i;
    const zc = 0.030 - (y + 0.05) * 0.30;
    cap(gloveR, 0.0064, 0.020, 0.002, y, zc - 0.022, 0, 0, HPI);
    cap(gloveR, 0.0058, 0.014, -0.017, y - 0.001, zc - 0.012, HPI, 0, 0);
  }
  capDir(gloveR, 0.0072, 0.022, -0.004, -0.030, 0.052, -0.9, 0.2, 0.35);  // thumb up back
  const dR = [0.42, -0.80, 0.42];
  tube(gloveR, 0.026, 0.030, 0.05, 0.026, -0.088, 0.050, ...dR);
  tube(sleeveR, 0.031, 0.043, 0.30,
    0.026 + dR[0] * 0.045, -0.088 + dR[1] * 0.045, 0.050 + dR[2] * 0.045, ...dR);

  // ---- left (support) hand — two-hand grip pose (slides for hip in update)
  box(gloveL, 0.024, 0.030, 0.052, -0.020, -0.060, 0.030, -0.10, 0, 0.15); // palm under
  for (let i = 0; i < 4; i++) {                 // fingers wrap the front strap
    const y = -0.044 - 0.007 * i;
    cap(gloveL, 0.0060, 0.020, 0.008, y, 0.006 - i * 0.006, 0, 0, HPI);
  }
  box(gloveL, 0.014, 0.052, 0.030, -0.030, -0.052, 0.030, 0, 0, -0.22);   // heel/thumb mass
  capDir(gloveL, 0.0072, 0.024, 0.006, -0.030, 0.052, 0.2, 0.2, -1);      // left thumb fwd
  const dL = [-0.52, -0.78, 0.38];
  tube(gloveL, 0.025, 0.029, 0.05, -0.030, -0.086, 0.050, ...dL);
  tube(sleeveL, 0.030, 0.042, 0.30,
    -0.030 + dL[0] * 0.045, -0.086 + dL[1] * 0.045, 0.050 + dL[2] * 0.045, ...dL);

  return {
    gloveR: mergeGeometries(gloveR), sleeveR: mergeGeometries(sleeveR),
    gloveL: mergeGeometries(gloveL), sleeveL: mergeGeometries(sleeveL),
  };
}

// Knife hand (knife-local coordinates). A single right fist wrapping the
// handle (handle axis along +Z, centered ~ z 0.058), fingers curling over the
// far flank, thumb along the spine, sleeve exiting bottom-right.
function buildKnifeHands() {
  const gloveR = [], sleeveR = [];
  const { box, cap, capDir, tube } = handHelpers();
  const HPI = Math.PI / 2;

  box(gloveR, 0.030, 0.052, 0.066, 0.008, -0.004, 0.058, 0, 0, 0);   // hand mass on handle
  for (let i = 0; i < 4; i++) {                                      // fingers over far side
    const z = 0.030 + i * 0.018;
    cap(gloveR, 0.0072, 0.016, -0.016, -0.012, z, HPI, 0, 0);
  }
  box(gloveR, 0.014, 0.016, 0.066, -0.020, 0.0, 0.058, 0, 0, 0);     // knuckle ridge
  capDir(gloveR, 0.0076, 0.030, 0.020, 0.008, 0.052, 0.1, 0.2, 1);   // thumb along spine
  const dR = [0.40, -0.80, 0.45];
  tube(gloveR, 0.027, 0.031, 0.05, 0.008, -0.032, 0.100, ...dR);
  tube(sleeveR, 0.032, 0.045, 0.30,
    0.008 + dR[0] * 0.045, -0.032 + dR[1] * 0.045, 0.100 + dR[2] * 0.045, ...dR);

  return { gloveR: mergeGeometries(gloveR), sleeveR: mergeGeometries(sleeveR) };
}

// Two-hand ball carry for CR7 mode: mirrored gloved hands cupping the held
// ball from the flanks, fingers hinted as small boxes fanned over its upper
// curve, thumbs on the camera-facing quarter, sleeved forearms running down
// toward the bottom screen corners. Ball-local coordinates (r=0.11 sphere at
// the group origin) so the pair parents straight onto the viewmodel.
function buildBallHands() {
  const glove = [], sleeve = [];
  const ONE = new THREE.Vector3(1, 1, 1);
  const put = (bag, geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      ONE));
    bag.push(geo);
  };
  const box = (bag, w, h, d, x, y, z, rx, ry, rz) =>
    put(bag, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
  // tapered tube from a start point along a direction (wrist → elbow)
  const tube = (bag, r0, r1, len, sx, sy, sz, dx, dy, dz) => {
    const d = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion()
      .setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().negate());
    const c = new THREE.Vector3(sx, sy, sz).addScaledVector(d, len * 0.5);
    const geo = new THREE.CylinderGeometry(r0, r1, len, 10);
    geo.applyMatrix4(new THREE.Matrix4().compose(c, q, ONE));
    bag.push(geo);
  };

  for (const s of [-1, 1]) {
    // palm slab hugging the lower flank
    box(glove, 0.024, 0.088, 0.078, s * 0.112, -0.030, 0.012, 0.10, s * 0.22, s * 0.40);
    // heel of the palm tucked under the ball
    box(glove, 0.026, 0.036, 0.062, s * 0.090, -0.082, 0.030, 0.18, 0, s * 0.62);
    // four fingers curling over the upper flank (small boxes, tips inward,
    // hugging the sphere so they read as a grip rather than loose spikes)
    for (let i = 0; i < 4; i++) {
      const z = 0.052 - i * 0.036;
      const lift = 0.010 * (1.5 - Math.abs(i - 1.5)); // middle fingers ride higher
      box(glove, 0.017, 0.062, 0.024,
        s * (0.093 - i * 0.003), 0.022 + lift, z, 0, 0, s * 0.62);
    }
    // thumb on the camera-facing upper quarter
    box(glove, 0.019, 0.054, 0.021, s * 0.058, 0.016, 0.100, -0.55, 0, s * 0.85);
    // wrist cuff then olive sleeve exiting toward the bottom corner
    const d = [s * 0.52, -0.72, 0.46];
    tube(glove, 0.027, 0.031, 0.05, s * 0.122, -0.078, 0.046, ...d);
    tube(sleeve, 0.033, 0.046, 0.30,
      s * 0.122 + d[0] * 0.048, -0.078 + d[1] * 0.048, 0.046 + d[2] * 0.048, ...d);
  }

  return { glove: mergeGeometries(glove), sleeve: mergeGeometries(sleeve) };
}

// ============================================================================
export function createWeapon({
  camera, scene, input, fx, audio, hud, player,
  getTargets, applyDamage, worldMeshes, getDrops, squish,
}) {
  // camera must be in the scene graph for camera-attached meshes to render
  if (!camera.parent) scene.add(camera);

  // FOOTBALL MODE ("CR7 mode"): construction-time branch — the whole rifle
  // path below is replaced by the held-ball kicker. Normal mode untouched.
  if (window.__FOOTBALL__) {
    return createFootballWeapon({ camera, input, audio, hud, player });
  }

  // ------------------------------------------------------------ materials
  const wearM = makeWearMaps('metal');
  const wearP = makeWearMaps('polymer');
  const wearR = makeRubberMaps();
  const mapsGlove = makeHandMaps('glove');
  const mapsSleeve = makeHandMaps('sleeve');
  // Gunmetal: high metalness per the machined-part read; the punctual rig
  // (sun + hemi + viewmodel fill) supplies the specular response, and the
  // mid-dark albedo keeps what diffuse remains from going dead black.
  const matMetal = new THREE.MeshStandardMaterial({
    map: wearM.map, roughnessMap: wearM.rough, roughness: 1,
    metalness: 0.72, dithering: true,
  });
  const matPoly = new THREE.MeshStandardMaterial({
    map: wearP.map, roughnessMap: wearP.rough, roughness: 1,
    metalness: 0.04, dithering: true,
  });
  const matDark = new THREE.MeshStandardMaterial({
    map: wearR.map, roughnessMap: wearR.rough, roughness: 1,
    metalness: 0.12, dithering: true,
  });
  const matGlove = new THREE.MeshStandardMaterial({
    map: mapsGlove.map, roughnessMap: mapsGlove.rough, roughness: 1,
    metalness: 0.0, dithering: true,
  });
  const matSleeve = new THREE.MeshStandardMaterial({
    map: mapsSleeve.map, roughnessMap: mapsSleeve.rough, roughness: 1,
    metalness: 0.0, dithering: true,
  });

  // matte scope body: dark, DoubleSide so the open tube interior renders and
  // the ADS eye sees a clean dark ring instead of culled backfaces
  const matScope = new THREE.MeshStandardMaterial({
    map: wearR.map, roughnessMap: wearR.rough, roughness: 1,
    metalness: 0.18, side: THREE.DoubleSide, dithering: true,
  });
  // anodized-black, extra-darkened charging handle: the viewmodel takes
  // unshadowed sun on top faces and this part fills mid-frame at ADS
  const matCh = matDark.clone();
  matCh.color.setHex(0x6e7276);

  // ------------------------------------------------------------ viewmodels
  // One procedural build per weapon id, cached on first equip; swapping only
  // toggles visibility (no per-frame cost, no rebuild). getModel dispatches to
  // the rifle / pistol / knife builder by id. All three share the glove/sleeve
  // materials so they read as one pair of hands.
  const hands = buildHands();
  const pistolHands = buildPistolHands();
  const knifeHands = buildKnifeHands();
  const viewmodel = new THREE.Group();
  const models = {};

  function finalize(root) {
    root.traverse((o) => {
      o.frustumCulled = false;
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
    });
    root.visible = false;
    viewmodel.add(root);
  }

  function getModel(id) {
    if (models[id]) return models[id];
    const rec = id === 'pistol' ? buildPistolModel()
      : id === 'knife' ? buildKnifeModel()
        : buildRifleModel(id);
    models[id] = rec;
    return rec;
  }

  function buildRifleModel(type) {
    const geos = buildRifle(type);
    const rifle = new THREE.Group();
    rifle.scale.setScalar(SCALE);

    rifle.add(new THREE.Mesh(geos.metal, matMetal));
    if (geos.poly) rifle.add(new THREE.Mesh(geos.poly, matPoly));
    rifle.add(new THREE.Mesh(geos.dark, matDark));
    if (geos.scope) rifle.add(new THREE.Mesh(geos.scope, matScope));

    // telescoping stock on its own group: the ADS pose tucks it down into the
    // shoulder so the butt end-cap stays out of the sight picture
    const stockGroup = new THREE.Group();
    stockGroup.add(new THREE.Mesh(geos.stockPoly, matPoly));
    stockGroup.add(new THREE.Mesh(geos.stockDark, matDark));
    rifle.add(stockGroup);

    // gloved firing hand + forearm (fixed to the grip)
    const handR = new THREE.Group();
    handR.add(new THREE.Mesh(hands.gloveR, matGlove));
    handR.add(new THREE.Mesh(hands.sleeveR, matSleeve));
    rifle.add(handR);

    // gloved support hand + forearm; slides rearward on the handguard at ADS.
    // Base grip point tracks each type's handguard length.
    const LH_Z = type === 'smg' ? -0.242 : type === 'dmr' ? -0.335 : -0.302;
    const handL = new THREE.Group();
    handL.position.set(0, 0, LH_Z);
    handL.add(new THREE.Mesh(hands.gloveL, matGlove));
    handL.add(new THREE.Mesh(hands.sleeveL, matSleeve));
    rifle.add(handL);

    const MAG_POS = new THREE.Vector3(0, -0.058, -0.078);
    const magGroup = new THREE.Group();
    magGroup.position.copy(MAG_POS);
    magGroup.add(new THREE.Mesh(geos.magBody, matPoly));
    magGroup.add(new THREE.Mesh(geos.magDark, matDark));
    rifle.add(magGroup);

    const CH_POS = new THREE.Vector3(0, 0.0295, 0.052);
    const chGroup = new THREE.Group();
    chGroup.position.copy(CH_POS);
    chGroup.add(new THREE.Mesh(geos.ch, matCh));
    rifle.add(chGroup);

    // optic glass + aim emitter. Red dot (mk4/smg): hot additive emitter well
    // past 1.0 so bloom draws the halo. Scope (dmr): etched reticle sprite in
    // the tube, faint glass tint so the picture stays readable.
    const dmr = type === 'dmr';
    const lensMat = new THREE.MeshBasicMaterial({
      color: 0x0c141b, transparent: true, opacity: 0.32,
      depthWrite: false, fog: false,
    });
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(dmr ? 0.019 : 0.0155, 24), lensMat);
    lens.position.set(0, SIGHT_Y, dmr ? -0.016 : -0.076);
    lens.renderOrder = 20;
    rifle.add(lens);

    const dotMat = dmr
      ? new THREE.SpriteMaterial({
        map: makeReticleTexture(), transparent: true, opacity: 0,
        depthTest: false, depthWrite: false, fog: false,
      })
      : new THREE.SpriteMaterial({
        map: makeDotTexture(), color: new THREE.Color(16.0, 2.65, 1.65),
        blending: THREE.AdditiveBlending, transparent: true, opacity: 0,
        depthTest: false, depthWrite: false, fog: false,
      });
    const dot = new THREE.Sprite(dotMat);
    dot.scale.set(dmr ? 0.026 : 0.0016, dmr ? 0.026 : 0.0016, 1);
    dot.position.set(0, SIGHT_Y, dmr ? -0.075 : -0.071); // x=0,y=SIGHT_Y → center at ADS
    dot.renderOrder = 999;
    dot.visible = false;
    rifle.add(dot);

    const muzzleTip = new THREE.Object3D();
    muzzleTip.position.set(0, 0, geos.muzzleZ);
    rifle.add(muzzleTip);
    const ejectRef = new THREE.Object3D();
    ejectRef.position.set(0.028, 0.008, -0.05);
    rifle.add(ejectRef);

    finalize(rifle);
    return {
      kind: 'rifle', root: rifle,
      rifle, stockGroup, handL, magGroup, chGroup,
      lensMat, dotMat, dot, muzzleTip, ejectRef,
      MAG_POS, CH_POS, LH_Z,
      lensBase: dmr ? 0.08 : 0.18, lensAds: dmr ? 0.12 : 0.3,
    };
  }

  // Pistol model: slide (own group → blowback/rack) + frame + magazine (own
  // group → reload drop) + two gloved hands. Iron sights on the shared axis
  // → pixel-exact ADS centering (see PISTOL_ADS_Z / ADS_Y).
  function buildPistolModel() {
    const geos = buildPistol();
    const root = new THREE.Group();
    root.scale.setScalar(SCALE);
    root.add(new THREE.Mesh(geos.metal, matMetal));
    root.add(new THREE.Mesh(geos.poly, matPoly));
    root.add(new THREE.Mesh(geos.dark, matDark));

    const slideGroup = new THREE.Group();
    slideGroup.add(new THREE.Mesh(geos.slideMetal, matMetal));
    slideGroup.add(new THREE.Mesh(geos.slideDark, matDark));
    root.add(slideGroup);

    const magGroup = new THREE.Group();
    magGroup.add(new THREE.Mesh(geos.magBody, matPoly));
    magGroup.add(new THREE.Mesh(geos.magDark, matDark));
    root.add(magGroup);

    const handR = new THREE.Group();
    handR.add(new THREE.Mesh(pistolHands.gloveR, matGlove));
    handR.add(new THREE.Mesh(pistolHands.sleeveR, matSleeve));
    root.add(handR);
    const handL = new THREE.Group();
    handL.add(new THREE.Mesh(pistolHands.gloveL, matGlove));
    handL.add(new THREE.Mesh(pistolHands.sleeveL, matSleeve));
    root.add(handL);

    const muzzleTip = new THREE.Object3D();
    muzzleTip.position.set(0, geos.muzzleY, geos.muzzleZ);
    root.add(muzzleTip);
    const ejectRef = new THREE.Object3D();
    ejectRef.position.set(0.016, 0.05, -0.006);
    root.add(ejectRef);

    finalize(root);
    return { kind: 'pistol', root, slideGroup, magGroup, handR, handL, muzzleTip, ejectRef };
  }

  // Knife model: blade/guard/handle live under bladeGroup, which is angled in
  // the fist; the right hand parents onto it so grip + slash move together.
  function buildKnifeModel() {
    const geos = buildKnife();
    const root = new THREE.Group();
    root.scale.setScalar(SCALE);
    const bladeGroup = new THREE.Group();
    bladeGroup.add(new THREE.Mesh(geos.blade, matMetal));
    bladeGroup.add(new THREE.Mesh(geos.metal, matMetal));
    bladeGroup.add(new THREE.Mesh(geos.dark, matDark));
    bladeGroup.add(new THREE.Mesh(geos.poly, matPoly));
    // held blade-up-forward, edge canted inward
    bladeGroup.rotation.set(-0.5, 0.28, 0.34);
    bladeGroup.position.set(0.01, -0.02, 0.0);
    const handR = new THREE.Group();
    handR.add(new THREE.Mesh(knifeHands.gloveR, matGlove));
    handR.add(new THREE.Mesh(knifeHands.sleeveR, matSleeve));
    bladeGroup.add(handR);
    root.add(bladeGroup);

    finalize(root);
    return { kind: 'knife', root, bladeGroup };
  }

  viewmodel.position.copy(HIP_POS);
  camera.add(viewmodel);
  // viewmodel fill: real scenes bounce light onto a held weapon that our sparse
  // lighting can't provide; short-range warm point keeps the gun readable without
  // visibly lifting nearby world geometry
  // positioned upper-LEFT of camera: the hip pose holds the rifle on the
  // right, so its camera-facing flank points left — a right-side fill only
  // lights faces the player never sees
  // pulled to the camera plane (z 0) so the rear end-caps facing the player
  // catch grazing light instead of a head-on hotspot at ADS
  const vmFill = new THREE.PointLight(0xffeedd, 1.1, 2.6, 2);
  vmFill.position.set(-0.3, 0.24, 0.0);
  camera.add(vmFill);

  // ------------------------------------------------------------ state
  let t = 0;
  // 3-slot loadout. curSlot names the active slot; primaryType is the rifle in
  // slot 1 (pickup-swappable); curId is the concrete weapon id currently held.
  let curSlot = 'primary';
  let primaryType = 'mk4';
  let curId = 'mk4';
  let DEF = WEAPON_DEFS.mk4;
  let vm = null;                        // active model record (set by equip)
  let fireInt = 60 / DEF.rpm;
  let mag = DEF.magSize, reserve = DEF.reserveStart;
  const ammoStore = {};                 // per-weapon-id { mag, reserve } across swaps
  let equipT = 0;                       // raise anim after a pickup
  // slot-swap animation (lower old / raise new)
  let swapT = 0, swapLower = 0, pendingId = null, pendingSlot = null;
  let promptShown = false, promptLabel = '';
  let debugDrops = null;                // shot-mode probe override (see hook)
  let adsL = 0, adsShown = false;
  let sprintB = 0, deathB = 0;
  let bobPhase = 0, bobAmp = 0;
  let swayY = 0, swayP = 0, posSwayX = 0, posSwayY = 0, strafeRoll = 0;
  let lastYaw = player.yaw || 0, lastPitch = player.pitch || 0;
  let dip = 0, dipVel = 0, airY = 0, wasGrounded = true, prevVy = 0;
  let wall = 0;
  let kickZ = 0, kickP = 0, kickY = 0, kickR = 0;
  let bloom = 0;                        // degrees
  let fireT = 0;
  let reloading = false, reloadT = 0, transferred = false;
  // pistol slide blowback (own decay), knife melee state
  let pSlide = 0;
  let guardL = 0;                       // knife RMB guard-pose blend
  let swinging = false, swingT = 0, struck = false, knifeCD = 0, fireWasHeld = false;

  const shotRay = new THREE.Raycaster();
  const wallRay = new THREE.Raycaster();
  wallRay.far = 0.6;

  const _camPos = new THREE.Vector3();
  const _camDir = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _muzzle = new THREE.Vector3();
  const _eject = new THREE.Vector3();
  const _end = new THREE.Vector3();
  const _n = new THREE.Vector3();
  // reused scratch objects → zero per-frame heap allocation in update
  const _f = { alive: true, sprinting: false, grounded: true, vel: null, hspeed: 0 };
  const _k = { bobX: 0, bobY: 0, bobRoll: 0, bobPitch: 0 };
  const _p = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };

  // ------------------------------------------------------------ helpers
  function degToPx(deg) {
    const half = degToRad(camera.fov) * 0.5;
    return Math.tan(degToRad(deg)) / Math.tan(half) * (window.innerHeight * 0.5);
  }

  function startReload() {
    if (reloading || reserve <= 0 || mag >= DEF.magSize) return;
    reloading = true;
    reloadT = 0;
    transferred = false;
    audio.reload();
    hud.setAmmo(mag, reserve);
  }

  // Reset a model's animated sub-groups to neutral (mag seated, slide home,
  // optic off) — used when parking an outgoing model or cancelling a reload.
  function neutralize(m) {
    if (!m) return;
    if (m.kind === 'rifle') {
      m.magGroup.position.copy(m.MAG_POS);
      m.magGroup.rotation.x = 0;
      m.magGroup.visible = true;
      m.chGroup.position.copy(m.CH_POS);
      m.dotMat.opacity = 0;
      m.dot.visible = false;
    } else if (m.kind === 'pistol') {
      m.magGroup.position.set(0, 0, 0);
      m.magGroup.visible = true;
      m.slideGroup.position.z = 0;
    }
  }

  // Equip a weapon id (mk4/smg/dmr/pistol/knife). ammo: { mag?, reserve? } —
  // defaults to a full loadout; pickups pass half reserve. Melee ids ignore
  // ammo and drive the HUD dash instead of digits.
  function equip(id, ammo) {
    const def = WEAPON_DEFS[id] || WEAPON_DEFS.mk4;
    const m = getModel(id);
    if (vm && vm !== m) { vm.root.visible = false; neutralize(vm); }
    vm = m;
    DEF = def;
    curId = WEAPON_DEFS[id] ? id : 'mk4';
    fireInt = 60 / (def.rpm || 120);
    vm.root.visible = true;
    reloading = false;
    transferred = false;
    fireT = 0;
    bloom = 0;
    swinging = false; struck = false; knifeCD = 0; pSlide = 0;
    if (def.melee) {
      mag = 0; reserve = 0;
      hud.setMelee?.(true);
    } else {
      mag = ammo && ammo.mag != null ? ammo.mag : def.magSize;
      reserve = ammo && ammo.reserve != null ? ammo.reserve : def.reserveStart;
      hud.setMelee?.(false);
    }
    hud.setWeaponName?.(def.name, def.hudMode);
    if (!def.melee) hud.setAmmo(mag, reserve);
  }

  // Persist the active weapon's ammo so a swap back restores it.
  function saveAmmo() {
    if (DEF && !DEF.melee) ammoStore[curId] = { mag, reserve };
  }

  // Begin a slot swap: cancel any reload cleanly, stash ammo, kick the
  // lower-old / raise-new animation. The visible model flips at the midpoint.
  function selectSlot(slot) {
    if (slot !== 'primary' && slot !== 'pistol' && slot !== 'knife') return;
    if (slot === pendingSlot) return;
    if (slot === curSlot && !pendingId) return;
    if (reloading) { reloading = false; neutralize(vm); }
    saveAmmo();
    pendingSlot = slot;
    pendingId = slot === 'pistol' ? 'pistol' : slot === 'knife' ? 'knife' : primaryType;
    swapT = SWAP_TIME;
  }

  // Immediate (no-animation) slot equip — spawn default + debug hook.
  function equipSlotNow(slot) {
    const id = slot === 'pistol' ? 'pistol' : slot === 'knife' ? 'knife' : primaryType;
    curSlot = slot; pendingId = null; pendingSlot = null; swapT = 0; swapLower = 0;
    equip(id, resolveAmmo(id));
  }

  // Ammo to equip a weapon id with: restore from the store, and keep the
  // pistol reserve topped up (it's a reliable fallback → effectively infinite).
  function resolveAmmo(id) {
    if (id === 'knife') return null;
    const st = ammoStore[id];
    const ammo = { mag: st ? st.mag : undefined, reserve: st ? st.reserve : undefined };
    if (id === 'pistol') ammo.reserve = Math.max(ammo.reserve || 0, WEAPON_DEFS.pistol.reserveStart);
    return ammo;
  }

  // Advance the swap timer; flip the visible model at the midpoint (bottom of
  // the dip). swapLower is a 0→1→0 triangle the pose blocks read to dip/raise.
  function advanceSwap(dt) {
    if (swapT > 0) {
      swapT = Math.max(0, swapT - dt);
      if (pendingId && swapT <= SWAP_TIME * 0.5) {
        const id = pendingId; pendingId = null;
        curSlot = pendingSlot;
        equip(id, resolveAmmo(id));
      }
      const half = SWAP_TIME * 0.5;
      swapLower = swapT > half ? (SWAP_TIME - swapT) / half : swapT / half;
    } else {
      swapLower = 0;
    }
  }

  function shoot() {
    mag--;
    hud.setAmmo(mag, reserve);

    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_camDir);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    // spread cone: per-type hip/ads base + bloom
    const spreadDeg = lerp(DEF.spreadHip, DEF.spreadAds, adsL) + bloom;
    const a = Math.random() * Math.PI * 2;
    const r = Math.tan(degToRad(spreadDeg)) * Math.sqrt(Math.random());
    _dir.copy(_camDir)
      .addScaledVector(_right, Math.cos(a) * r)
      .addScaledVector(_up, Math.sin(a) * r)
      .normalize();

    shotRay.set(_camPos, _dir);
    shotRay.far = 260;
    const targets = getTargets() || [];
    const tHit = shotRay.intersectObjects(targets, false)[0] || null;
    const wHit = shotRay.intersectObjects(worldMeshes() || [], false)[0] || null;

    let hit = null, isEnemy = false;
    if (tHit && (!wHit || tHit.distance <= wHit.distance)) { hit = tHit; isEnemy = true; }
    else if (wHit) hit = wHit;

    if (hit) {
      if (hit.face) _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      else _n.copy(_dir).negate();
      if (isEnemy) {
        const res = applyDamage(hit.object, DEF.dmg, hit.point.clone(), _n.clone());
        if (res) { hud.hitmarker(!!res.killed); audio.hitConfirm(); }
      } else {
        const surface = hit.object.userData.surface || 'concrete';
        fx.impact(hit.point.clone(), _n.clone(), surface);
        if (hit.object.userData.squishy) squish?.(hit.point); // shot a trash bin → wobble
      }
      _end.copy(hit.point);
    } else {
      _end.copy(_camPos).addScaledVector(_dir, 200);
    }

    // muzzle fx (viewmodel pose already applied this frame → exact tip pos)
    vm.muzzleTip.getWorldPosition(_muzzle);
    fx.muzzleFlash(_muzzle.clone(), _camDir.clone());
    fx.tracer(_muzzle.clone(), _end.clone());
    vm.ejectRef.getWorldPosition(_eject);
    fx.casing(_eject.clone(), _right.clone());
    // per-type report: dmr deeper, pistol lighter, else the standard gunshot
    if (DEF.heavyShot && audio.gunshotHeavy) audio.gunshotHeavy();
    else if (DEF.pistolShot && audio.pistolShot) audio.pistolShot();
    else audio.gunshot();

    // recoil: camera view-kick (ADS ×0.55) + viewmodel kick + bloom — all
    // per-type: smg light-but-stacking, dmr one heavy deliberate kick
    const ks = 1 - 0.45 * adsL;
    player.addViewKick(
      (DEF.kickPitch + Math.random() * DEF.kickPitchRand) * ks,
      (Math.random() - 0.5) * DEF.kickYawRand * ks);
    const vs = (1 - 0.35 * adsL) * DEF.vmKick;
    kickZ = Math.min(kickZ + (0.012 + Math.random() * 0.004) * vs, DEF.vmKickMaxZ);
    kickP = Math.min(kickP + (0.017 + Math.random() * 0.007) * vs, DEF.vmKickMaxP);
    kickY += (Math.random() - 0.5) * 0.008 * vs;
    kickR += (Math.random() - 0.5) * 0.01 * vs;
    bloom = Math.min(bloom + DEF.bloomAdd, DEF.bloomMax);
  }

  // ---------------------------------------------------------- shared kinematics
  // View-rotation sway, movement bob, jump/land dip, sprint blend, wall pull,
  // death lower — weapon-agnostic, run once per frame for whichever slot is up
  // (state persists across swaps → smooth). Returns the frame's bob offsets.
  function stepKin(dt, f) {
    const { grounded, sprinting, vel, hspeed, alive } = f;
    const rate = 1 / Math.max(dt, 1e-4);
    const dYaw = (player.yaw - lastYaw) * rate;
    const dPitch = (player.pitch - lastPitch) * rate;
    lastYaw = player.yaw; lastPitch = player.pitch;
    swayY = damp(swayY, clamp(-dYaw * 0.016, -0.075, 0.075), 9, dt);
    swayP = damp(swayP, clamp(-dPitch * 0.014, -0.06, 0.06), 9, dt);
    const vxl = vel.x * _right.set(1, 0, 0).applyQuaternion(camera.quaternion).x
      + vel.z * _right.z;
    posSwayX = damp(posSwayX, clamp(-dYaw * 0.004 - vxl * 0.0032, -0.028, 0.028), 8, dt);
    posSwayY = damp(posSwayY, clamp(dPitch * 0.003, -0.02, 0.02), 8, dt);
    strafeRoll = damp(strafeRoll, clamp(-vxl * 0.012, -0.05, 0.05), 6, dt);

    bobAmp = damp(bobAmp, grounded ? Math.min(hspeed / 6.7, 1) : 0, 9, dt);
    if (grounded && hspeed > 0.3) bobPhase += dt * (5.4 + hspeed * 1.35);
    const bobK = (1 - adsL * 0.78) * (sprinting ? 1.35 : 1) * bobAmp;

    airY = damp(airY, grounded ? 0 : clamp(-vel.y * 0.006, -0.035, 0.035), 8, dt);
    if (grounded && !wasGrounded) dipVel -= Math.min(Math.max(0, -prevVy) * 0.018, 0.14);
    wasGrounded = grounded; prevVy = vel.y;
    dipVel += (-160 * dip - 16 * dipVel) * dt;
    dip += dipVel * dt;

    sprintB = damp(sprintB,
      (sprinting && adsL < 0.3 && !reloading && alive) ? 1 : 0, 10, dt);

    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_camDir);
    wallRay.set(_camPos, _camDir);
    const wh = wallRay.intersectObjects(worldMeshes() || [], false)[0];
    wall = damp(wall, wh ? clamp((0.55 - wh.distance) / 0.55, 0, 1) : 0, 10, dt);

    deathB = damp(deathB, alive ? 0 : 1, 6, dt);

    _k.bobX = Math.sin(bobPhase) * 0.0105 * bobK;
    _k.bobY = (Math.cos(bobPhase * 2) * 0.5 - 0.5) * 0.012 * bobK;
    _k.bobRoll = Math.sin(bobPhase) * 0.014 * bobK;
    _k.bobPitch = Math.sin(bobPhase * 2) * 0.006 * bobK;
    return _k;
  }

  // Fold the shared additive offsets (bob, sway, breathing, air/dip, recoil
  // kick, wall pull, swap dip, death slump) onto a pose object p in-place.
  function addShared(p, k, swayK, brK) {
    p.px += k.bobX; p.py += k.bobY; p.rx += k.bobPitch; p.rz += k.bobRoll;
    p.rx += swayP * swayK; p.ry += swayY * swayK;
    p.rz += -swayY * 0.5 * swayK + strafeRoll * swayK;
    p.px += posSwayX * swayK; p.py += posSwayY * swayK;
    p.py += Math.sin(t * 1.9) * 0.0016 * brK;
    p.px += Math.sin(t * 1.25 + 1.7) * 0.0012 * brK;
    p.rz += Math.sin(t * 1.5 + 0.6) * 0.004 * brK;
    p.rx += Math.sin(t * 1.9) * 0.003 * brK;
    p.py += airY * (1 - adsL * 0.6) + dip;
    p.rx += dip * 1.4;
    p.pz += kickZ; p.rx += kickP; p.ry += kickY; p.rz += kickR;
    p.pz += wall * 0.13; p.py -= wall * 0.03; p.rx += wall * 0.30;
    if (swapLower > 0) { p.py -= 0.17 * swapLower; p.pz += 0.03 * swapLower; p.rx -= 0.5 * swapLower; }
    p.py -= 0.24 * deathB; p.pz += 0.10 * deathB;
    p.rx -= 0.55 * deathB; p.rz -= 0.5 * deathB;
  }

  // Recoil recovery + crosshair spread — shared tail of every slot's update.
  function endFrame(dt, f) {
    kickZ = damp(kickZ, 0, 13, dt);
    kickP = damp(kickP, 0, 11, dt);
    kickY = damp(kickY, 0, 11, dt);
    kickR = damp(kickR, 0, 11, dt);
    bloom = damp(bloom, 0, DEF.bloomDecay || 5, dt);
    const moveDeg = Math.min(f.hspeed / 6.7, 1) * 0.7 + (f.grounded ? 0 : 0.8);
    const base = lerp(DEF.spreadHip || 2, DEF.spreadAds || 0.5, adsL);
    hud.setCrosshairSpread(clamp(6 + degToPx(base + bloom + moveDeg), 4, 90));
    if (hud.setSprint) hud.setSprint(f.sprinting);
  }

  // ---- SLOT 1: rifle (mk4/smg/dmr) — unchanged behavior from the pre-3-slot
  // build (ADS red-dot/scope, mag+charging-handle reload, support-hand chase,
  // auto/semi fire, ground pickups). Now just gated by the swap timer.
  function updateRifle(dt, f) {
    const { alive, sprinting } = f;
    const wantAds = alive && !reloading && !sprinting && !!input.aimHeld;
    adsL = damp(adsL, wantAds ? 1 : 0, DEF.adsSpeed, dt);
    if (adsL < 0.001) adsL = 0;
    if (adsL > 0.999) adsL = 1;
    player.setAdsLevel(adsL);
    const adsNow = adsL > 0.5;
    if (adsNow !== adsShown) { adsShown = adsNow; hud.setADS(adsNow); }
    vm.dotMat.opacity = smoothstep(adsL, 0.35, 0.92);
    vm.dot.visible = vm.dotMat.opacity > 0.02;
    vm.lensMat.opacity = vm.lensBase + vm.lensAds * adsL;
    vm.stockGroup.position.set(0, -0.012 * adsL, -0.006 * adsL);

    const k = stepKin(dt, f);

    // ---- reload progression
    let rlPosX = 0, rlPosY = 0, rlPosZ = 0, rlRX = 0, rlRY = 0, rlRZ = 0;
    let magY = 0, magR = 0;
    if (reloading) {
      reloadT += dt;
      const T = Math.min(reloadT / DEF.reloadTime, 1);
      const hold = Math.min(sm01(T / 0.13), 1 - sm01((T - 0.86) / 0.14));
      rlRZ = -0.55 * hold; rlRX = -0.14 * hold; rlRY = 0.10 * hold;
      rlPosX = 0.025 * hold; rlPosY = -0.03 * hold; rlPosZ = 0.015 * hold;

      if (T < 0.16) { /* seated */ }
      else if (T < 0.34) { const kk = (T - 0.16) / 0.18; magY = -0.30 * kk * kk; magR = 0.55 * kk; }
      else if (T < 0.50) { magY = -0.30; magR = 0.55; }
      else if (T < 0.68) { const kk = sm01((T - 0.50) / 0.18); magY = -0.30 * (1 - kk); magR = 0.45 * (1 - kk); }
      vm.magGroup.position.set(vm.MAG_POS.x, vm.MAG_POS.y + magY, vm.MAG_POS.z);
      vm.magGroup.rotation.x = magR;
      vm.magGroup.visible = !(T >= 0.335 && T < 0.505);

      if (T >= 0.68 && T < 0.76) {
        const b = Math.sin(Math.PI * (T - 0.68) / 0.08);
        rlPosY += 0.010 * b; rlRX += 0.06 * b;
      }
      let ch = 0;
      if (T >= 0.78 && T < 0.86) ch = sm01((T - 0.78) / 0.08);
      else if (T >= 0.86 && T < 0.90) ch = 1 - sm01((T - 0.86) / 0.04);
      vm.chGroup.position.z = vm.CH_POS.z + 0.048 * ch;
      if (ch > 0) { rlRY += 0.12 * ch; rlRX -= 0.03 * ch; rlPosZ += 0.008 * ch; }

      if (!transferred && T >= 0.68) {
        transferred = true;
        const take = Math.min(DEF.magSize - mag, reserve);
        mag += take; reserve -= take;
        hud.setAmmo(mag, reserve);
      }
      if (reloadT >= DEF.reloadTime) {
        reloading = false;
        vm.magGroup.position.copy(vm.MAG_POS);
        vm.magGroup.rotation.x = 0;
        vm.magGroup.visible = true;
        vm.chGroup.position.copy(vm.CH_POS);
      }
    } else {
      vm.magGroup.position.copy(vm.MAG_POS);
      vm.magGroup.rotation.x = 0;
      vm.magGroup.visible = true;
      vm.chGroup.position.copy(vm.CH_POS);
    }

    // ---- support hand: C-clamp on the handguard (slides rearward at ADS) or,
    // mid-reload, leaves the handguard to chase the magazine and seat it back.
    {
      let hlx = -0.026 * adsL, hly = 0.004 * adsL, hlz = vm.LH_Z + 0.075 * adsL;
      let hlrx = 0, hlrz = -0.12 * adsL;
      if (reloading) {
        const T = Math.min(reloadT / DEF.reloadTime, 1);
        const grab = Math.min(sm01(T / 0.11), 1 - sm01((T - 0.72) / 0.14));
        const dipY = Math.max(magY, -0.135);
        const tx = vm.MAG_POS.x + 0.006;
        const ty = vm.MAG_POS.y - 0.052 + dipY;
        const tz = vm.MAG_POS.z + 0.014 - dipY * 0.22;
        hlx += (tx - hlx) * grab;
        hly += (ty - hly) * grab;
        hlz += (tz - hlz) * grab;
        hlrx = (0.78 + magR * 0.45) * grab;
        hlrz = 0.10 * grab;
      }
      vm.handL.position.set(hlx, hly, hlz);
      vm.handL.rotation.set(hlrx, 0, hlrz);
    }

    // ---- compose pose
    const swayK = 1 - adsL * 0.82;
    const brK = (1 - adsL * 0.93) * (1 - sprintB * 0.5);
    const p = _p;
    p.px = lerp(HIP_POS.x, 0, adsL) + SPRINT_POS.x * sprintB;
    p.py = lerp(HIP_POS.y, ADS_Y, adsL) + SPRINT_POS.y * sprintB;
    p.pz = lerp(HIP_POS.z, DEF.adsZ, adsL) + SPRINT_POS.z * sprintB;
    p.rx = lerp(HIP_ROT.x, 0, adsL) + SPRINT_ROT.x * sprintB;
    p.ry = lerp(HIP_ROT.y, 0, adsL) + SPRINT_ROT.y * sprintB;
    p.rz = lerp(HIP_ROT.z, 0, adsL) + SPRINT_ROT.z * sprintB;
    p.px += rlPosX; p.py += rlPosY; p.pz += rlPosZ;
    p.rx += rlRX; p.ry += rlRY; p.rz += rlRZ;
    addShared(p, k, swayK, brK);
    if (equipT > 0) {
      equipT = Math.max(0, equipT - dt);
      const eqB = sm01(equipT / EQUIP_TIME);
      p.py -= 0.15 * eqB; p.px += 0.03 * eqB;
      p.rx -= 0.42 * eqB; p.rz -= 0.14 * eqB;
    }
    viewmodel.position.set(p.px, p.py, p.pz);
    viewmodel.rotation.set(p.rx, p.ry, p.rz);

    // ---- combat (after pose → exact muzzle world position)
    fireT -= dt;
    const clicked = input.firePressed();
    const canFire = alive && !reloading && !sprinting && mag > 0 && swapT <= 0 && equipT < 0.12;
    if (DEF.auto) {
      if (input.fireHeld && canFire) {
        while (fireT <= 0 && mag > 0) { shoot(); fireT += fireInt; }
      } else if (fireT < 0) fireT = 0;
    } else {
      if (fireT < 0) fireT = 0;
      if (clicked && canFire && fireT <= 0) { shoot(); fireT = fireInt; }
    }
    if (clicked && alive && !reloading && mag === 0) {
      audio.dryFire();
      if (reserve > 0) startReload();
    }
    if (alive && !reloading && mag === 0 && reserve > 0 && !input.fireHeld) startReload();
    if (input.pressed('KeyR') && alive && !reloading && mag < DEF.magSize && reserve > 0) startReload();

    updatePickups(f);
    endFrame(dt, f);
  }

  // ---- ground pickups (rifle only — the primary slot). Never runs under
  // __FOOTBALL__; weapon.update is skipped while driving.
  function updatePickups(f) {
    let nearDrop = null;
    if ((getDrops || debugDrops) && f.alive) {
      const drops = debugDrops || (getDrops ? getDrops() : null) || [];
      let bd = PICKUP_RANGE * PICKUP_RANGE;
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (!d || !d.pos) continue;
        const def = WEAPON_DEFS[d.type];
        if (!def || def.kind === 'pistol' || def.melee) continue; // rifles only
        const dx = d.pos.x - player.position.x;
        const dz = d.pos.z - player.position.z;
        const dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; nearDrop = d; }
      }
    }
    if (nearDrop) {
      const label = 'Y — PICK UP ' + WEAPON_DEFS[nearDrop.type].name;
      if (!promptShown || promptLabel !== label) {
        promptShown = true; promptLabel = label;
        hud.setPrompt?.(label);
      }
      if (input.pressed('KeyY')) {
        const oldType = primaryType;
        const at = nearDrop.pos.clone ? nearDrop.pos.clone() : null;
        const newType = nearDrop.type;
        nearDrop.take?.();
        const arr = debugDrops || (getDrops ? getDrops() : null);
        if (arr && typeof arr.addDrop === 'function' && at) arr.addDrop(oldType, at);
        primaryType = newType;
        delete ammoStore[oldType];
        equip(newType, { reserve: Math.floor(WEAPON_DEFS[newType].reserveStart / 2) });
        equipT = EQUIP_TIME;
        audio.dryFire?.();
        promptShown = false; promptLabel = '';
        hud.setPrompt?.(null);
      }
    } else if (promptShown) {
      promptShown = false; promptLabel = '';
      hud.setPrompt?.(null);
    }
  }

  // ---- SLOT 2: pistol — semi-auto, light recoil, fast iron-sight ADS. Reuses
  // shoot() (own DEF), with a slide blowback pop and a pistol reload (mag drop
  // + slide rack). Support hand slides from a low hip cup onto the grip at ADS.
  function updatePistol(dt, f) {
    const { alive, sprinting } = f;
    const wantAds = alive && !reloading && !sprinting && !!input.aimHeld;
    adsL = damp(adsL, wantAds ? 1 : 0, DEF.adsSpeed, dt);
    if (adsL < 0.001) adsL = 0;
    if (adsL > 0.999) adsL = 1;
    player.setAdsLevel(adsL);
    const adsNow = adsL > 0.5;
    if (adsNow !== adsShown) { adsShown = adsNow; hud.setADS(adsNow); }

    const k = stepKin(dt, f);
    pSlide = damp(pSlide, 0, 22, dt);

    let rlPosX = 0, rlPosY = 0, rlPosZ = 0, rlRX = 0, rlRY = 0, rlRZ = 0;
    let magY = 0, magShow = true, slideBack = 0;
    if (reloading) {
      reloadT += dt;
      const T = Math.min(reloadT / DEF.reloadTime, 1);
      const hold = Math.min(sm01(T / 0.14), 1 - sm01((T - 0.82) / 0.18));
      rlRZ = -0.50 * hold; rlRX = -0.12 * hold; rlRY = 0.14 * hold;
      rlPosX = 0.020 * hold; rlPosY = -0.028 * hold; rlPosZ = 0.012 * hold;
      if (T < 0.15) { /* seated */ }
      else if (T < 0.40) { const kk = (T - 0.15) / 0.25; magY = -0.16 * kk * kk; }
      else if (T < 0.55) { magY = -0.16; magShow = false; }
      else if (T < 0.78) { const kk = sm01((T - 0.55) / 0.23); magY = -0.16 * (1 - kk); }
      if (T >= 0.82 && T < 0.90) slideBack = sm01((T - 0.82) / 0.08);
      else if (T >= 0.90 && T < 0.96) slideBack = 1 - sm01((T - 0.90) / 0.06);
      if (!transferred && T >= 0.60) {
        transferred = true;
        const take = Math.min(DEF.magSize - mag, reserve);
        mag += take; reserve -= take;
        hud.setAmmo(mag, reserve);
      }
      if (reloadT >= DEF.reloadTime) reloading = false;
    }
    vm.magGroup.position.set(0, magY, 0);
    vm.magGroup.visible = magShow;
    vm.slideGroup.position.z = Math.max(pSlide * 0.014, slideBack * 0.020);

    // support hand: cupped low-left at hip → up onto the grip at ADS
    vm.handL.position.set(-0.03 * (1 - adsL), -0.05 * (1 - adsL), 0.03 * (1 - adsL));

    const swayK = 1 - adsL * 0.82;
    const brK = (1 - adsL * 0.93) * (1 - sprintB * 0.5);
    const p = _p;
    p.px = lerp(PISTOL_HIP_POS.x, 0, adsL) + PISTOL_SPRINT_POS.x * sprintB;
    p.py = lerp(PISTOL_HIP_POS.y, ADS_Y, adsL) + PISTOL_SPRINT_POS.y * sprintB;
    p.pz = lerp(PISTOL_HIP_POS.z, PISTOL_ADS_Z, adsL) + PISTOL_SPRINT_POS.z * sprintB;
    p.rx = lerp(PISTOL_HIP_ROT.x, 0, adsL) + PISTOL_SPRINT_ROT.x * sprintB;
    p.ry = lerp(PISTOL_HIP_ROT.y, 0, adsL) + PISTOL_SPRINT_ROT.y * sprintB;
    p.rz = lerp(PISTOL_HIP_ROT.z, 0, adsL) + PISTOL_SPRINT_ROT.z * sprintB;
    p.px += rlPosX; p.py += rlPosY; p.pz += rlPosZ;
    p.rx += rlRX; p.ry += rlRY; p.rz += rlRZ;
    addShared(p, k, swayK, brK);
    viewmodel.position.set(p.px, p.py, p.pz);
    viewmodel.rotation.set(p.rx, p.ry, p.rz);

    // ---- combat (semi-auto: one round per click)
    fireT -= dt;
    const clicked = input.firePressed();
    const canFire = alive && !reloading && !sprinting && mag > 0 && swapT <= 0;
    if (fireT < 0) fireT = 0;
    if (clicked && canFire && fireT <= 0) { shoot(); fireT = fireInt; pSlide = 1; }
    if (clicked && alive && !reloading && mag === 0) {
      audio.dryFire();
      if (reserve > 0) startReload();
    }
    if (alive && !reloading && mag === 0 && reserve > 0 && !input.fireHeld) startReload();
    if (input.pressed('KeyR') && alive && !reloading && mag < DEF.magSize && reserve > 0) startReload();

    endFrame(dt, f);
  }

  // ---- SLOT 3: knife — melee. No ADS/ammo/muzzle fx. A click (or a fresh
  // press of a held button) triggers a ~0.5s slash; at the strike moment a
  // short forward ray hits an enemy for a near-guaranteed kill.
  function updateKnife(dt, f) {
    const { alive, sprinting } = f;
    adsL = damp(adsL, 0, 12, dt);
    if (adsL < 0.001) adsL = 0;
    player.setAdsLevel(0);
    if (adsShown) { adsShown = false; hud.setADS(false); }
    guardL = damp(guardL, (alive && !!input.aimHeld && !swinging) ? 1 : 0, 12, dt);

    const k = stepKin(dt, f);

    knifeCD = Math.max(0, knifeCD - dt);
    const clicked = input.firePressed();
    const heldEdge = input.fireHeld && !fireWasHeld;
    fireWasHeld = input.fireHeld;
    if ((clicked || heldEdge) && alive && !swinging && knifeCD <= 0 && swapT <= 0 && !sprinting) {
      swinging = true; swingT = 0; struck = false; knifeCD = KNIFE_COOLDOWN;
      audio.knifeSwing?.();
    }

    let sx = 0, sy = 0, sz = 0, srx = 0, sry = 0, srz = 0;
    if (swinging) {
      swingT += dt;
      const s = Math.min(swingT / KNIFE_SWING_TIME, 1);
      const wind = sm01(s / 0.30);              // wind-up up-right
      const slash = sm01((s - 0.30) / 0.30);    // slash down-left
      const rec = sm01((s - 0.60) / 0.40);      // recover to rest
      srz = 0.70 * wind - 1.70 * slash + 1.00 * rec;
      srx = -0.55 * wind + 0.80 * slash - 0.25 * rec;
      sry = 0.45 * wind - 0.80 * slash + 0.35 * rec;
      sx = 0.06 * wind - 0.12 * slash + 0.06 * rec;
      sy = 0.06 * wind - 0.09 * slash + 0.03 * rec;
      sz = -0.07 * slash * (1 - rec);           // thrust forward at the strike
      if (!struck && s >= KNIFE_STRIKE_T) { struck = true; knifeStrike(); }
      if (s >= 1) swinging = false;
    }

    const p = _p;
    p.px = KNIFE_HIP_POS.x + KNIFE_SPRINT_POS.x * sprintB;
    p.py = KNIFE_HIP_POS.y + KNIFE_SPRINT_POS.y * sprintB;
    p.pz = KNIFE_HIP_POS.z + KNIFE_SPRINT_POS.z * sprintB;
    p.rx = KNIFE_HIP_ROT.x + KNIFE_SPRINT_ROT.x * sprintB;
    p.ry = KNIFE_HIP_ROT.y + KNIFE_SPRINT_ROT.y * sprintB;
    p.rz = KNIFE_HIP_ROT.z + KNIFE_SPRINT_ROT.z * sprintB;
    // RMB guard: pull in + tilt forward
    p.px += -0.04 * guardL; p.py += 0.02 * guardL; p.pz += 0.03 * guardL; p.rx += -0.18 * guardL;
    // slash
    p.px += sx; p.py += sy; p.pz += sz; p.rx += srx; p.ry += sry; p.rz += srz;
    addShared(p, k, 1, 1);
    viewmodel.position.set(p.px, p.py, p.pz);
    viewmodel.rotation.set(p.rx, p.ry, p.rz);

    endFrame(dt, f);
  }

  // Short forward melee ray at the strike moment: enemy first, blocked by world
  // geometry. Big damage = near-guaranteed kill (head/torso multipliers apply).
  function knifeStrike() {
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_camDir);
    shotRay.set(_camPos, _camDir);
    shotRay.far = KNIFE_RANGE;
    const tHit = shotRay.intersectObjects(getTargets() || [], false)[0] || null;
    if (!tHit) return;
    const wHit = shotRay.intersectObjects(worldMeshes() || [], false)[0] || null;
    if (wHit && wHit.distance < tHit.distance) return; // blocked by a wall
    if (tHit.face) _n.copy(tHit.face.normal).transformDirection(tHit.object.matrixWorld);
    else _n.copy(_camDir).negate();
    const res = applyDamage(tHit.object, DEF.dmg, tHit.point.clone(), _n.clone());
    if (res) {
      hud.hitmarker(!!res.killed);
      audio.hitConfirm();
      audio.knifeStab?.();
      fx.impact(tHit.point.clone(), _n.clone(), 'flesh');
    }
  }

  // ------------------------------------------------------------ update
  function update(dt) {
    t += dt;
    const alive = player.alive !== false;
    const sprinting = !!player.isSprinting;
    const grounded = player.isGrounded !== false;
    const vel = player.velocity || { x: 0, y: 0, z: 0 };
    const hspeed = Math.hypot(vel.x, vel.z);
    _f.alive = alive; _f.sprinting = sprinting; _f.grounded = grounded;
    _f.vel = vel; _f.hspeed = hspeed;
    const f = _f;

    // slot select — number row AND the Switch d-pad both emit Digit1/2/3
    if (input.pressed('Digit1')) selectSlot('primary');
    else if (input.pressed('Digit2')) selectSlot('pistol');
    else if (input.pressed('Digit3')) selectSlot('knife');

    advanceSwap(dt);

    if (vm.kind === 'pistol') updatePistol(dt, f);
    else if (vm.kind === 'knife') updateKnife(dt, f);
    else updateRifle(dt, f);
  }

  // default loadout: the mk4, full ammo — identical to the pre-arsenal game
  equip('mk4');

  // screenshot-harness hook: lets probes stage the other weapons directly and
  // feed a fabricated drops array. Only exists in shot mode — never in play.
  if (window.__SHOT_MODE__) {
    window.__weaponDebug = {
      // legacy + slot equip, immediate (no swap animation)
      equip: (id) => {
        if (id === 'pistol') equipSlotNow('pistol');
        else if (id === 'knife') equipSlotNow('knife');
        else { primaryType = id; equipSlotNow('primary'); }
      },
      select: (slot) => selectSlot(slot),       // animated swap (observe dip/raise)
      selectNow: (slot) => equipSlotNow(slot),  // immediate slot equip
      type: () => curId,
      slot: () => curSlot,
      ammo: () => [mag, reserve],
      setDrops: (arr) => { debugDrops = arr; },
      reload: () => { mag = Math.max(0, mag - 1); startReload(); },
    };
  }

  return { viewmodel, update, setFootballs: () => {} };
}

// ============================================================================
// FOOTBALL MODE — held-ball viewmodel + kick launcher (window.__FOOTBALL__).
// No rifle, no raycast, no muzzle flash/tracer/casing, no reload/dry-fire.
// LMB punts a pooled football down the crosshair ray (0.6s cooldown); the
// held ball pops away on the kick and scales back in during the cooldown.
// RMB is a plain fov zoom via the player.setAdsLevel path — no sight.
// ============================================================================
const BALL_HOLD = new THREE.Vector3(0.155, -0.205, -0.44);
const BALL_ROT = { x: 0.02, y: 0.0, z: -0.06 };
const KICK_CD = 0.6;
const KICK_SPEED = 24;
const KICK_UP = 1.2;             // m/s vertical bias on the launch velocity
// player fov path lerps 74 -> 46 at t=1; cap t so full "aim" reads ~ -15 deg —
// enough that lining up a shot clearly zooms (the old -8 deg felt like nothing)
const ADS_ZOOM_T = 15 / 28;

function createFootballWeapon({ camera, input, audio, hud, player }) {
  // ------------------------------------------------------------ viewmodel
  const texture = makeFootballTexture(512);
  const ballMat = new THREE.MeshStandardMaterial({
    map: texture, roughness: 0.62, metalness: 0.02, dithering: true,
  });
  const viewmodel = new THREE.Group();
  const pivot = new THREE.Group();        // kick pop / resupply scale rides here
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 26, 20), ballMat);
  ball.rotation.set(0.85, 0.5, 0.2);      // frame a pentagon toward the camera
  pivot.add(ball);
  viewmodel.add(pivot);
  // gloved carrying hands: parented to the viewmodel (NOT the pivot) so they
  // stay up and ready while the kicked ball pops away and regrows in them
  const mapsGlove = makeHandMaps('glove');
  const mapsSleeve = makeHandMaps('sleeve');
  const matGlove = new THREE.MeshStandardMaterial({
    map: mapsGlove.map, roughnessMap: mapsGlove.rough, roughness: 1,
    metalness: 0.0, dithering: true,
  });
  const matSleeve = new THREE.MeshStandardMaterial({
    map: mapsSleeve.map, roughnessMap: mapsSleeve.rough, roughness: 1,
    metalness: 0.0, dithering: true,
  });
  const bh = buildBallHands();
  const handsG = new THREE.Group();
  handsG.add(new THREE.Mesh(bh.glove, matGlove));
  handsG.add(new THREE.Mesh(bh.sleeve, matSleeve));
  viewmodel.add(handsG);
  viewmodel.traverse((o) => {
    o.frustumCulled = false;
    if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
  });
  viewmodel.position.copy(BALL_HOLD);
  camera.add(viewmodel);
  // same viewmodel fill as the rifle: keeps the held ball readable in shade
  const vmFill = new THREE.PointLight(0xffeedd, 0.9, 2.4, 2);
  vmFill.position.set(-0.3, 0.24, 0.0);
  camera.add(vmFill);

  hud.setBallMode?.(true);

  // ------------------------------------------------------------ state
  let fb = null;
  let t = 0;
  let adsL = 0;
  let kickT = 0;                          // cooldown remaining
  let bobPhase = 0, bobAmp = 0;
  let swayY = 0, swayP = 0, posSwayX = 0, posSwayY = 0;
  let lastYaw = player.yaw || 0, lastPitch = player.pitch || 0;
  let dip = 0, dipVel = 0, airY = 0, wasGrounded = true, prevVy = 0;
  let sprintB = 0, deathB = 0;

  const _camPos = new THREE.Vector3();
  const _camDir = new THREE.Vector3();
  const _upCam = new THREE.Vector3();
  const _from = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  function degToPx(deg) {
    const half = degToRad(camera.fov) * 0.5;
    return Math.tan(degToRad(deg)) / Math.tan(half) * (window.innerHeight * 0.5);
  }

  function doKick() {
    kickT = KICK_CD;
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_camDir);
    _upCam.set(0, 1, 0).applyQuaternion(camera.quaternion);
    // launch from just below screen center, right where the held ball pops
    _from.copy(_camPos)
      .addScaledVector(_camDir, 0.55)
      .addScaledVector(_upCam, -0.22);
    _dir.copy(_camDir).multiplyScalar(KICK_SPEED);
    // upward arc bias, but fade it out as you aim DOWN so you can actually kick
    // low — at a nearby Ronaldo's feet or the ground (before: always +1.2 up, so
    // aiming down still lobbed the ball over their heads)
    _dir.y += KICK_UP * Math.max(0, Math.min(1, 1 + _camDir.y * 1.8));
    const speed = _dir.length();
    _dir.multiplyScalar(1 / speed);
    if (fb) fb.kick(_from, _dir, speed, (Math.random() - 0.5) * 1.3, 'player');
    audio.kick?.();
  }

  // ------------------------------------------------------------ update
  function update(dt) {
    t += dt;
    const alive = player.alive !== false;
    const sprinting = !!player.isSprinting;
    const grounded = player.isGrounded !== false;
    const vel = player.velocity || { x: 0, y: 0, z: 0 };
    const hspeed = Math.hypot(vel.x, vel.z);

    // ---- ADS = fov zoom only (crosshair stays: no sight to aim through)
    const wantAds = alive && !!input.aimHeld;
    adsL = damp(adsL, wantAds ? 1 : 0, 14, dt);
    if (adsL < 0.001) adsL = 0;
    if (adsL > 0.999) adsL = 1;
    player.setAdsLevel(adsL * ADS_ZOOM_T);

    // ---- sway from view-rotation rate
    const rate = 1 / Math.max(dt, 1e-4);
    const dYaw = (player.yaw - lastYaw) * rate;
    const dPitch = (player.pitch - lastPitch) * rate;
    lastYaw = player.yaw; lastPitch = player.pitch;
    swayY = damp(swayY, clamp(-dYaw * 0.014, -0.07, 0.07), 9, dt);
    swayP = damp(swayP, clamp(-dPitch * 0.012, -0.055, 0.055), 9, dt);
    posSwayX = damp(posSwayX, clamp(-dYaw * 0.004, -0.025, 0.025), 8, dt);
    posSwayY = damp(posSwayY, clamp(dPitch * 0.003, -0.02, 0.02), 8, dt);

    // ---- movement bob
    bobAmp = damp(bobAmp, grounded ? Math.min(hspeed / 6.7, 1) : 0, 9, dt);
    if (grounded && hspeed > 0.3) bobPhase += dt * (5.4 + hspeed * 1.35);
    const bobK = (sprinting ? 1.3 : 1) * bobAmp;
    const bobX = Math.sin(bobPhase) * 0.011 * bobK;
    const bobY = (Math.cos(bobPhase * 2) * 0.5 - 0.5) * 0.013 * bobK;
    const bobRoll = Math.sin(bobPhase) * 0.016 * bobK;

    // ---- jump inertia + landing dip spring
    airY = damp(airY, grounded ? 0 : clamp(-vel.y * 0.006, -0.035, 0.035), 8, dt);
    if (grounded && !wasGrounded) {
      dipVel -= Math.min(Math.max(0, -prevVy) * 0.018, 0.14);
    }
    wasGrounded = grounded; prevVy = vel.y;
    dipVel += (-160 * dip - 16 * dipVel) * dt;
    dip += dipVel * dt;

    sprintB = damp(sprintB, sprinting && adsL < 0.5 ? 1 : 0, 10, dt);
    deathB = damp(deathB, alive ? 0 : 1, 6, dt);

    // ---- kick (0.6s cooldown; CR7 can shoot on the run)
    kickT = Math.max(0, kickT - dt);
    const clicked = input.firePressed();
    if ((input.fireHeld || clicked) && alive && kickT <= 0) doKick();

    // ---- held-ball resupply: pop away fast, regrow with a soft overshoot
    let s = 1, kickPush = 0;
    if (kickT > 0) {
      const since = KICK_CD - kickT;
      if (since < 0.1) {
        const k = since / 0.1;
        s = 1 - k;
        kickPush = k;
      } else {
        const g = sm01((since - 0.1) / (KICK_CD - 0.1));
        s = g * (1 + 0.16 * Math.sin(g * Math.PI));
      }
    }
    pivot.scale.setScalar(Math.max(0.001, s));
    pivot.position.set(0, -0.02 * (1 - s), -0.16 * kickPush);
    ball.rotation.y += dt * 0.25;         // idle life: lazy spin in the palm

    // ---- compose pose
    let px = BALL_HOLD.x, py = BALL_HOLD.y, pz = BALL_HOLD.z;
    let rx = BALL_ROT.x, ry = BALL_ROT.y, rz = BALL_ROT.z;
    // aim: drop the ball DOWN and aside so it clears the crosshair (you need to
    // SEE the target you're kicking at), then the stronger zoom + tighter reticle
    // do the aiming. Raising it to centre just blocked the view.
    px += 0.03 * adsL; py += -0.11 * adsL; pz += -0.02 * adsL;
    rx += 0.14 * adsL;
    // sprint: ball tucked against the chest, leaning with the run
    px += -0.05 * sprintB; py += -0.045 * sprintB; pz += 0.05 * sprintB;
    rx += 0.18 * sprintB; rz += 0.22 * sprintB;
    // bob + sway
    px += bobX + posSwayX; py += bobY + posSwayY;
    rx += swayP; ry += swayY; rz += bobRoll - swayY * 0.5;
    // breathing
    py += Math.sin(t * 1.9) * 0.0019;
    px += Math.sin(t * 1.25 + 1.7) * 0.0013;
    rz += Math.sin(t * 1.5 + 0.6) * 0.004;
    // air inertia + landing dip
    py += airY + dip;
    rx += dip * 1.4;
    // death slump
    py -= 0.22 * deathB; rx -= 0.5 * deathB; rz -= 0.4 * deathB;

    viewmodel.position.set(px, py, pz);
    viewmodel.rotation.set(rx, ry, rz);

    // ---- crosshair
    const moveDeg = Math.min(hspeed / 6.7, 1) * 0.7 + (grounded ? 0 : 0.8);
    const totalDeg = lerp(1.0, 0.32, adsL) + moveDeg; // reticle tightens on aim
    hud.setCrosshairSpread(clamp(6 + degToPx(totalDeg), 4, 90));
    if (hud.setSprint) hud.setSprint(sprinting);
  }

  function setFootballs(ref) {
    fb = ref;
    // footballs module is audio-agnostic; the weapon owns the audio ref
    if (fb) fb.onBounce = (pos, strength) => audio.bounce?.(pos, strength);
  }

  return { viewmodel, update, setFootballs };
}
