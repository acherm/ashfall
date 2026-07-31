import * as THREE from 'three';
import { createRenderer } from './core/renderer.js';
import { createInput } from './core/input.js';
import { createPlayer } from './core/player.js';
import { createWorld } from './world/map.js';
import { createFX } from './fx/particles.js';
import { createWeapon } from './weapons/weapon.js';
import { createEnemyManager } from './enemies/enemies.js';
import { createHUD } from './ui/hud.js';
import { createAudio } from './audio/audio.js';
import { createFootballs } from './fx/footballs.js';
import { createCars } from './vehicles/cars.js';
import { createCivilians } from './world/civilians.js';
import { createNetplay } from './net/netplay.js';
import { createGrenades } from './fx/grenades.js';

const params = new URLSearchParams(location.search);
const SHOT = params.has('shot');
window.__SHOT_MODE__ = SHOT;
// CR7 MODE: footballs instead of bullets, Ronaldos instead of soldiers.
// Must be set before any module is constructed — they read it at build time.
const FOOTBALL = params.has('football');
window.__FOOTBALL__ = FOOTBALL;

const canvas = document.getElementById('game');
const menu = document.getElementById('menu');

const R = createRenderer({ canvas });
const input = createInput(canvas);
// touch device? → on-screen controls, no pointer lock
const IS_TOUCH = (window.matchMedia && matchMedia('(pointer: coarse)').matches)
  || 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
input.initTouch?.();
const world = createWorld(R.scene);
const fx = createFX({ scene: R.scene, camera: R.camera });
const hud = createHUD();
const audio = createAudio();
const player = createPlayer({ camera: R.camera, input, world, hud, audio });
const enemies = createEnemyManager({ scene: R.scene, world, fx, audio, hud, player });
const weapon = createWeapon({
  camera: R.camera, scene: R.scene, input, fx, audio, hud, player,
  getTargets: () => enemies.targets,
  applyDamage: (o, d, p, n) => enemies.applyDamage(o, d, p, n),
  worldMeshes: () => world.raycastMeshes,
  getDrops: () => enemies.drops ?? [],
  squish: (p) => world.squishAt?.(p), // shot trash bins wobble (world adds squishAt)
});

// CR7 MODE wiring: one shared projectile system; player balls knock Ronaldos
// down, Ronaldo balls damage the player
const fb = FOOTBALL ? createFootballs({ scene: R.scene, world }) : null;
const goals = { you: 0, cr7: 0 };
if (fb) {
  fb.setEnemyProvider(() => (enemies.hitVolumes ? enemies.hitVolumes() : []));
  fb.setPlayerProvider(() => ({ pos: player.position, radius: 0.38, height: 1.8 }));
  fb.onEnemyHit = (ref, point) => {
    if (enemies.knockdown && enemies.knockdown(ref, point)) {
      hud.hitmarker(true);
      audio.hitConfirm();
      goals.you++;
      hud.setScoreboard?.(goals.you, goals.cr7);
    }
  };
  fb.onPlayerHit = (fromPos, kicker) => {
    player.takeDamage(6, fromPos);
    goals.cr7++;
    hud.setScoreboard?.(goals.you, goals.cr7);
    // the scorer celebrates: SIUU jump + spin
    if (kicker) enemies.celebrate?.(kicker);
  };
  hud.setScoreboard?.(0, 0);
  weapon.setFootballs?.(fb);
  enemies.setFootballs?.(fb);
  hud.setBallMode?.(true);
}

// area blast shared by the missile truck AND thrown grenades: kills enemies in
// the radius; if `hurtPlayer`, also damages the player when they're too close
function areaBlast(point, radius, hurtPlayer = false) {
  const vols = enemies.hitVolumes ? enemies.hitVolumes() : [];
  let kills = 0;
  for (const v of vols) {
    const dx = v.pos.x - point.x, dz = v.pos.z - point.z;
    if (Math.hypot(dx, dz) < radius + (v.radius || 0.34)) {
      if (enemies.runover?.(v.ref, 25)) kills++;
    }
  }
  if (hurtPlayer && player.alive !== false) {
    const d = Math.hypot(player.position.x - point.x, player.position.z - point.z);
    if (d < radius + 0.5) {
      const dmg = Math.round(70 * (1 - d / (radius + 0.5)));
      if (dmg > 0) { player.takeDamage(dmg, point); player.addViewKick(0.05 * Math.random() - 0.025, 0.05 * Math.random() - 0.025); }
    }
  }
  return kills;
}

// drivable cars — camera/controls take over while driving (player.update skipped)
const cars = createCars({
  scene: R.scene, world, input, player, hud, audio, camera: R.camera, fx,
  getEnemyVolumes: () => (enemies.hitVolumes ? enemies.hitVolumes() : []),
  runover: (ref, speed) => enemies.runover?.(ref, speed),
  missileStrike: (point, radius) => areaBlast(point, radius, false),
});

// thrown grenades — G / touch NADE / gamepad; area blast that can hurt you too
const grenades = createGrenades({ scene: R.scene, world, fx, audio });
grenades.onExplode = (pos, radius) => {
  const kills = areaBlast(pos, radius, true);
  if (kills > 0) hud.killfeed?.(kills > 2 ? 'Grenade — multi kill!' : 'Grenade kill');
};
let nades = 4, nadeCd = 0;
const _throwDir = new THREE.Vector3();
const _fwd = new THREE.Vector3(); // reused for touch aim-assist
function throwGrenade() {
  if (nades <= 0 || nadeCd > 0 || cars.driving || player.alive === false) return;
  nades--; nadeCd = 0.7;
  hud.setGrenades?.(nades);
  R.camera.getWorldDirection(_throwDir);
  const eye = player.getEyePos();
  eye.addScaledVector(_throwDir, 0.4);
  grenades.throw(eye, _throwDir, 18);
}

// civilian pedestrians — pure ambience, never targets
const civilians = createCivilians({
  scene: R.scene, world, player,
  getThreats: () => (enemies.hitVolumes ? enemies.hitVolumes().map((v) => v.pos) : []),
});

// online co-op (stage 1): peer-to-peer, renders a blue teammate avatar
const net = createNetplay({ scene: R.scene });
let netSendT = 0, remoteFirePrev = false;
const _rdir = new THREE.Vector3();
net.onData?.((msg) => {
  if (!msg || msg.t !== 'p') return;
  net.applyRemote(msg);
  if (msg.fire && !remoteFirePrev) {
    const mz = net.remoteMuzzle();
    if (mz) {
      _rdir.set(-Math.sin(msg.yaw || 0), 0, -Math.cos(msg.yaw || 0));
      fx.muzzleFlash(mz, _rdir);
      fx.tracer(mz, _rdir.clone().multiplyScalar(80).add(mz));
    }
  }
  remoteFirePrev = !!msg.fire;
});

// weapon-swap discard: weapon.js reaches the drops system through the array
// itself (getDrops().addDrop) — bridge the enemies API onto its stable array
if (enemies.drops && enemies.addDrop && !enemies.drops.addDrop) {
  enemies.drops.addDrop = (type, pos) => enemies.addDrop(type, pos);
}

player.onFov = (deg) => R.setFov(deg);
player.position.copy(world.playerSpawn);
player.yaw = world.playerSpawnYaw ?? Math.PI;

let started = SHOT;

// ---------------------------------------------------------------- death / redeploy
// When the player is killed there was no way back — this adds a K.I.A. screen and
// a clean restart. Redeploy reloads with the current mode + the level you died on,
// so a fresh game starts at the same difficulty you reached (no stale module state).
const deathEl = document.getElementById('death');
const deathSub = document.getElementById('deathSub');
let dead = false, deathT = 0, deathShown = false;
function redeploy() {
  if (!dead) return;
  const q = [];
  if (FOOTBALL) q.push('football=1');
  const lvl = (enemies.level | 0) || startLevel;
  if (lvl > 1) q.push('level=' + lvl);
  location.search = q.length ? '?' + q.join('&') : '?'; // '?' forces a reload even if unchanged
}
if (deathEl) deathEl.addEventListener('click', redeploy);
window.addEventListener('keydown', (e) => {
  if (dead && (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter')) redeploy();
});

// ---------------------------------------------------------------- victory
// A win condition: eliminate a target number of hostiles → MISSION COMPLETE.
const WIN_KILLS = Math.max(20, +params.get('win') || 100);
const victoryEl = document.getElementById('victory');
const victoryStats = document.getElementById('victoryStats');
let won = false, runTime = 0;
function showVictory() {
  won = true;
  document.exitPointerLock?.();
  if (victoryStats) {
    const secs = Math.round(runTime);
    victoryStats.innerHTML =
      `Hostiles eliminated: <b>${enemies.kills | 0}</b><br>`
      + `Reached: <b>Level ${enemies.level | 0} · ${enemies.difficultyName || ''}</b><br>`
      + `Time: <b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b>`;
  }
  victoryEl?.classList.add('show');
}
document.getElementById('victoryReplay')?.addEventListener('click', () => {
  const q = [];
  if (FOOTBALL) q.push('football=1');
  if (startLevel > 1) q.push('level=' + startLevel);
  location.search = q.length ? '?' + q.join('&') : '?';
});
document.getElementById('victoryContinue')?.addEventListener('click', () => {
  victoryEl?.classList.remove('show');
  hud.setObjective('ENDLESS — HOLD THE SECTOR');
  if (!IS_TOUCH) input.requestLock();
});

// difficulty picker: chips set the starting level; ?level=N also works
let startLevel = Math.max(1, Math.min(12, +params.get('level') || 1));
const diffSel = document.getElementById('diffSel');
if (diffSel) {
  const chips = [...diffSel.querySelectorAll('.chip')];
  const highlight = () => chips.forEach((c) => c.classList.toggle('sel', +c.dataset.level === startLevel));
  chips.forEach((c) => c.addEventListener('click', (e) => {
    e.stopPropagation();
    startLevel = +c.dataset.level;
    highlight();
  }));
  highlight();
}

// co-op menu: Host shows a room code, Join connects with one
const coopHost = document.getElementById('coopHost');
const coopJoin = document.getElementById('coopJoin');
const coopCode = document.getElementById('coopCode');
const coopStatus = document.getElementById('coopStatus');
function setCoop(text, cls) { if (coopStatus) { coopStatus.textContent = text; coopStatus.className = cls || ''; } }
net.onStatus?.((s, info) => {
  if (s === 'hosting') setCoop('Share this code: ' + info, 'warn');
  else if (s === 'connecting') setCoop('Connecting…', 'warn');
  else if (s === 'connected') setCoop('Teammate connected — deploy!', 'ok');
  else if (s === 'error') setCoop(info || 'Connection failed', 'err');
  else if (s === 'closed') setCoop('Teammate disconnected', 'err');
});
coopHost?.addEventListener('click', (e) => {
  e.stopPropagation();
  setCoop('Creating room…', 'warn');
  net.host().then((code) => setCoop('Share this code: ' + code, 'warn')).catch(() => setCoop('Could not host', 'err'));
});
coopJoin?.addEventListener('click', (e) => {
  e.stopPropagation();
  const c = (coopCode?.value || '').trim();
  if (c.length < 4) { setCoop('Enter the 4-character code', 'err'); return; }
  setCoop('Joining…', 'warn');
  net.join(c).then(() => setCoop('Connected — deploy!', 'ok')).catch(() => setCoop('Join failed — check the code', 'err'));
});

// mode toggle button: full reload so every module rebuilds for the other mode
const modeBtn = document.getElementById('modeToggle');
if (modeBtn) {
  modeBtn.textContent = FOOTBALL ? '↩ back to combat mode' : '⚽ CR7 mode — footballs & Ronaldos';
  modeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    location.search = FOOTBALL ? '' : '?football=1';
  });
}

menu.addEventListener('click', () => {
  audio.unlock();
  audio.ambience();
  if (IS_TOUCH) {
    input.touchActive = true;
    document.getElementById('touch')?.classList.add('on');
  } else {
    input.requestLock();
  }
  menu.classList.add('hidden');
  if (!started) {
    started = true;
    enemies.setStartLevel?.(startLevel);
    enemies.spawnWave(4);
  }
  showHint();
});

// deploy hint: teaches controls, then fades. On touch, spell out move/look.
const hintEl = document.getElementById('hint');
let hintTimer = 0;
if (IS_TOUCH && hintEl) {
  const r2 = hintEl.querySelector('.row2');
  if (r2) r2.innerHTML = 'Left <b>MOVE</b> stick (push fully to sprint) &nbsp;&middot;&nbsp; swipe the <b>RIGHT side</b> to turn &nbsp;&middot;&nbsp; hold <b>AIM</b> on a foe to auto-fire &nbsp;&middot;&nbsp; <b>+</b> for grenade / weapons';
}
function showHint() {
  if (!hintEl) return;
  hintEl.classList.add('show');
  hintTimer = IS_TOUCH ? 13 : 9; // give mobile players longer to read
}
document.addEventListener('pointerlockchange', () => {
  if (dead || IS_TOUCH) return; // touch play doesn't use pointer lock at all
  if (!document.pointerLockElement && !SHOT && started) menu.classList.remove('hidden');
  else menu.classList.add('hidden');
});

hud.setObjective(FOOTBALL ? 'SCORE GOALS ON THE RONALDOS' : ('ELIMINATE ' + WIN_KILLS + ' HOSTILES'));
hud.setHealth(100);
hud.setAmmo(30, 150);
if (!FOOTBALL) hud.setGrenades?.(nades);

if (params.has('dbg')) { window.__player = player; window.__enemies = enemies; window.__input = input; window.__net = net; window.__R = R; window.__mkv = (x, y, z) => new THREE.Vector3(x, y, z); } // test hook

// ---------------------------------------------------------------- shot mode
let shotFrames = 0;
if (SHOT) {
  menu.classList.add('hidden');
  const scen = params.get('scenario') || 'street';
  stageScenario(scen);
  // live-probe handles for the diagnostic harness
  window.__fx = fx; window.__R = R; window.__player = player;
  window.__weapon = weapon;
  window.__mkv = (x, y, z) => new THREE.Vector3(x, y, z);
  window.__THREE = THREE; // probe hook (shot mode only)
  window.__input = input;
  window.__THREE = THREE;
}

function stageScenario(name) {
  // deterministic-ish staging for the screenshot harness
  const place = (yaw, pitch, pos) => {
    player.yaw = yaw; player.pitch = pitch;
    if (pos) player.position.set(pos[0], pos[1], pos[2]);
  };
  // yaw 0 faces -Z (down the street); positive yaw turns left
  switch (name) {
    case 'street':
      place(0, 0.02);
      break;
    case 'ads': {
      place(-0.02, 0.015);
      enemies.spawnAt?.(new THREE.Vector3(1.2, 0, 22), 0.1);
      window.__forceADS = true;
      break;
    }
    case 'combat': {
      place(0.24, 0.03, [3.5, 0, 30]);
      enemies.spawnAt?.(new THREE.Vector3(-3, 0, 2), 0.3);
      enemies.spawnAt?.(new THREE.Vector3(4, 0, -8), -0.2);
      enemies.spawnAt?.(new THREE.Vector3(-5.5, 0, -20), 0.1);
      window.__forceFire = true;
      break;
    }
    case 'overview': {
      window.__overview = true;
      break;
    }
    case 'alley':
      place(1.35, 0.08, [5.5, 0, 18]);
      break;
    case 'soldier':
      // enemy model inspection: combat-posed hostile 4m ahead
      place(0, 0.0, [0, 0, 40]);
      enemies.spawnAt?.(new THREE.Vector3(-0.6, 0, 35.5), 0.15);
      enemies.spawnAt?.(new THREE.Vector3(1.6, 0, 33), -0.3);
      break;
    case 'cr7': {
      // football mode action: Ronaldos downrange, player ball kicked mid-flight
      place(0, 0.02, [0, 0, 46]);
      enemies.spawnAt?.(new THREE.Vector3(-2.2, 0, 30), 0.1);
      enemies.spawnAt?.(new THREE.Vector3(2.8, 0, 24), -0.15);
      enemies.spawnAt?.(new THREE.Vector3(-0.5, 0, 16), 0.05);
      window.__forceKick = true;
      break;
    }
    case 'cr7close':
      // Ronaldo model inspection at 3-4m
      place(0, 0.0, [0, 0, 40]);
      enemies.spawnAt?.(new THREE.Vector3(-0.7, 0, 36.2), 0.2);
      enemies.spawnAt?.(new THREE.Vector3(1.4, 0, 34), -0.25);
      break;
    case 'cr7siuu': {
      // celebration inspection: trigger at frame 20, capture mid-air spin
      place(0, 0.06, [0, 0, 42]);
      const scorer = enemies.spawnAt?.(new THREE.Vector3(-0.9, 0, 36), 0.1);
      enemies.spawnAt?.(new THREE.Vector3(2.2, 0, 33), -0.2);
      window.__siuuRef = scorer;
      hud.setScoreboard?.(3, 1);
      break;
    }
    case 'drive': {
      // driving inspection: player behind the wheel, rolling down the street
      place(0, 0.0, [0, 0, 46]);
      enemies.spawnAt?.(new THREE.Vector3(-2.5, 0, 20), 0.1);
      enemies.spawnAt?.(new THREE.Vector3(3, 0, 10), -0.1);
      cars.stageDrive?.();
      break;
    }
    case 'moto': {
      place(0, 0.0, [0, 0, 46]);
      enemies.spawnAt?.(new THREE.Vector3(-2.5, 0, 18), 0.1);
      cars.stageDrive?.('moto');
      break;
    }
    case 'truck': {
      place(0, 0.0, [0, 0, 46]);
      enemies.spawnAt?.(new THREE.Vector3(-3, 0, 8), 0.1);
      enemies.spawnAt?.(new THREE.Vector3(3.5, 0, -2), -0.1);
      cars.stageDrive?.('truck');
      break;
    }
    case 'fxprobe':
      // fixed-position fx spawns to verify flash/tracer/impact render at all
      place(0, 0.0, [0, 0, 46]);
      window.__fxprobe = true;
      break;
    default:
      place(0, 0);
  }
}
const SHOT_STOP = { combat: 52, cr7: 58, cr7siuu: 58, drive: 50, moto: 50, truck: 54 }[params.get('scenario')] ?? 40;
const SIUU_TRIGGER_FRAME = 30; // capture at SHOT_STOP catches the airborne spin near apex

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let acc = 0;

function tick(dt) {
  input.update?.(dt); // gamepad poll (Gamepad API is poll-based)
  if (!SHOT && !started && input.menuPressed?.()) menu.click();
  else if (!SHOT && started && !document.pointerLockElement && input.menuPressed?.()) {
    menu.classList.add('hidden'); // pad-only resume: hide menu, inputs bypass lock
  }
  if (started) {
    if (window.__forceADS) input.aimHeld = true;
    if (window.__forceFire) input.fireHeld = shotFrames > 20;
    // one kick launched ~0.45s before capture: ball ~8m out, mid-arc at frame 58
    if (window.__forceKick) input.fireHeld = shotFrames > 28 && shotFrames < 33;
    if (window.__siuuRef && shotFrames === SIUU_TRIGGER_FRAME) {
      enemies.celebrate?.(window.__siuuRef);
      window.__siuuRef = null;
    }
    if (window.__fxprobe && shotFrames >= 30) {
      const eye = player.getEyePos();
      const from = new THREE.Vector3(eye.x + 0.3, eye.y - 0.1, eye.z - 1.2);
      const dir = new THREE.Vector3(0, 0, -1);
      if (shotFrames % 5 === 0) {
        fx.muzzleFlash(from, dir);
        fx.tracer(from, new THREE.Vector3(eye.x + 0.5, eye.y - 0.2, eye.z - 40));
      }
      if (shotFrames === 35) fx.impact(new THREE.Vector3(-2, 1.4, eye.z - 15), new THREE.Vector3(1, 0, 0.4).normalize(), 'concrete');
    }

    const driving = !!cars.driving;
    if (!driving) player.update(dt);
    // touch aim-assist: hold AIM with an enemy near the reticle → auto-fire, so
    // mobile players don't have to aim pixel-perfect (only while aiming, so the
    // manual FIRE button still works normally otherwise)
    if (IS_TOUCH && !FOOTBALL && !driving && player.alive !== false && input.aimHeld) {
      R.camera.getWorldDirection(_fwd);
      const eye = player.getEyePos();
      let onTarget = false;
      const vols = enemies.hitVolumes ? enemies.hitVolumes() : [];
      for (const v of vols) {
        const dx = v.pos.x - eye.x, dy = (v.pos.y + 0.9) - eye.y, dz = v.pos.z - eye.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 70 || dist < 1) continue;
        if ((dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / dist > 0.9991) { onTarget = true; break; } // ~2.4° cone
      }
      input.fireHeld = onTarget;
    }
    // grenades: throw on G (also fed by touch NADE + gamepad), then simulate
    nadeCd = Math.max(0, nadeCd - dt);
    if (!FOOTBALL && (input.pressed('KeyG') || input.pressed('KeyB'))) throwGrenade();
    grenades.update(dt);
    cars.update(dt);
    if (weapon.viewmodel) {
      const wantVisible = !driving && !window.__overview;
      if (weapon.viewmodel.visible !== wantVisible) weapon.viewmodel.visible = wantVisible;
    }
    world.update(dt, player.position);
    enemies.update(dt);
    civilians.update(dt);
    if (!driving) weapon.update(dt);
    fx.update(dt);
    if (fb) fb.update(dt);
    // co-op: broadcast our state ~20/s, interpolate the teammate every frame
    if (net.connected) {
      netSendT -= dt;
      if (netSendT <= 0) {
        netSendT = 0.05;
        net.send({ t: 'p', x: player.position.x, y: player.position.y, z: player.position.z,
          yaw: player.yaw, pitch: player.pitch, alive: player.alive !== false,
          fire: !driving && !!input.fireHeld });
      }
    }
    net.update(dt);

    if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) hintEl?.classList.remove('show'); }
    hud.update(dt);
    hud.setCompassYaw(player.yaw + Math.PI); // -Z (down the street) reads as North
    audio.update(player.getEyePos(), player.yaw);

    // win condition: eliminate the target number of hostiles (combat mode)
    if (!SHOT && !FOOTBALL && !won && player.alive !== false) {
      runTime += dt;
      if ((enemies.kills | 0) >= WIN_KILLS) showVictory();
    }

    // death → K.I.A. screen after the slump plays, then redeploy on input
    if (!SHOT && player.alive === false) {
      if (!dead) { dead = true; deathT = 0; document.exitPointerLock?.(); }
      deathT += dt;
      if (!deathShown && deathT > 1.6) {
        deathShown = true;
        const ln = enemies.level | 0;
        if (deathSub) deathSub.textContent = ln > 1
          ? `Fell at Level ${ln} · ${enemies.difficultyName || ''}`.trim()
          : 'You were eliminated';
        deathEl?.classList.add('show');
      }
      if (dead && input.menuPressed?.()) redeploy(); // gamepad A / Start
    }
  }

  if (window.__overview) {
    R.camera.position.set(56, 88, 92);
    R.camera.lookAt(-4, 0, -6);
    if (weapon.viewmodel) weapon.viewmodel.visible = false;
  }

  R.render(dt);

  if (SHOT) shotFrames++;
}

function frame() {
  // shot mode: fixed timestep + hard stop so the captured frame deterministically
  // contains an in-flight muzzle flash and tracer
  if (SHOT && shotFrames >= SHOT_STOP) { window.__shotReady = true; return; }
  requestAnimationFrame(frame);
  tick(SHOT ? 1 / 60 : Math.min(clock.getDelta(), 0.05));
}
if (SHOT) {
  menu.style.transition = 'none';
  window.__tick = (n) => { for (let i = 0; i < n; i++) tick(1 / 60); };
}
frame();
