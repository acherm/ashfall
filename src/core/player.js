import * as THREE from 'three';

const EYE_STAND = 1.68;
const EYE_CROUCH = 1.15;
const RADIUS = 0.38;
const WALK = 4.4, SPRINT = 6.7, CROUCH = 2.2;
const ACCEL_GROUND = 10, ACCEL_AIR = 2;
const JUMP = 4.6, GRAVITY = 13.5;
const SENS = 0.0021;
const FOV_BASE = 74, FOV_SPRINT = 80, FOV_ADS = 46;

// ---------------------------------------------------------------- body
// First-person body awareness: chest slice + pelvis + two articulated legs
// (hip/knee/ankle pivots) attached at player.position facing yaw. Built to
// be seen from the player's own camera looking down — the chest top stays
// ~0.25-0.28 m below the eye standing AND crouched, so pitch 1.45 never
// clips it — and by the sun: castShadow is ON (the player finally casts a
// shadow), receiveShadow off like the viewmodel.
function buildBody() {
  const matShirt = new THREE.MeshStandardMaterial({ color: 0x454936, roughness: 0.93, metalness: 0 });
  const matVest = new THREE.MeshStandardMaterial({ color: 0x2c2f26, roughness: 0.96, metalness: 0 });
  const matPants = new THREE.MeshStandardMaterial({ color: 0x3a3d2f, roughness: 0.9, metalness: 0 });
  const matBoot = new THREE.MeshStandardMaterial({ color: 0x1f1e1c, roughness: 0.82, metalness: 0.04 });

  const root = new THREE.Group();
  const M = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // chest slice — pivot at its base so the crouch lean folds it forward.
  // The whole torso sits BEHIND the eye axis (spine back, +z ≈ 0.11) the way
  // a real ribcage hangs behind the eyes: looking straight down you see the
  // chest front + pouches + legs, not a giant slab top filling the frame.
  const chest = new THREE.Group();
  root.add(chest);
  // wedge profile: a slim collar slice sits right under the camera and the
  // torso flares as it descends — the top face never swamps the look-down
  // frame the way one full-width slab does
  M(chest, new THREE.BoxGeometry(0.21, 0.075, 0.15), matShirt, 0, 0.30, 0.12);  // collar
  M(chest, new THREE.BoxGeometry(0.31, 0.13, 0.20), matShirt, 0, 0.205, 0.115); // upper chest
  M(chest, new THREE.BoxGeometry(0.38, 0.24, 0.235), matShirt, 0, 0.055, 0.115); // ribcage
  M(chest, new THREE.BoxGeometry(0.28, 0.21, 0.055), matVest, 0, 0.06, -0.005); // plate front
  M(chest, new THREE.BoxGeometry(0.30, 0.24, 0.05), matVest, 0, 0.06, 0.23);    // plate back
  M(chest, new THREE.BoxGeometry(0.095, 0.10, 0.20), matShirt, 0.215, 0.215, 0.115);  // shoulder R
  M(chest, new THREE.BoxGeometry(0.095, 0.10, 0.20), matShirt, -0.215, 0.215, 0.115); // shoulder L
  // mag pouches on the vest front — texture interest when looking down
  M(chest, new THREE.BoxGeometry(0.08, 0.105, 0.03), matPants, -0.058, -0.01, -0.036);
  M(chest, new THREE.BoxGeometry(0.08, 0.105, 0.03), matPants, 0.058, -0.01, -0.036);

  // pelvis + belt
  const pelvis = new THREE.Group();
  root.add(pelvis);
  M(pelvis, new THREE.BoxGeometry(0.34, 0.17, 0.24), matPants, 0, -0.005, 0.01);
  M(pelvis, new THREE.BoxGeometry(0.36, 0.055, 0.26), matVest, 0, 0.075, 0.01);

  // leg: hip group → thigh capsule + knee group → calf capsule + ankle group → boot
  const leg = (sx) => {
    const hip = new THREE.Group();
    hip.position.set(sx, 0.96, 0.10);
    root.add(hip);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.079, 0.28, 4, 12), matPants);
    thigh.position.set(0, -0.21, 0);
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.set(0, -0.45, 0);
    hip.add(knee);
    const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.25, 4, 12), matPants);
    calf.position.set(0, -0.185, 0.012);
    knee.add(calf);
    const ankle = new THREE.Group();
    ankle.position.set(0, -0.38, 0);
    knee.add(ankle);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.095, 0.29), matBoot);
    boot.position.set(0, -0.045, -0.075);
    ankle.add(boot);
    const toe = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.055, 0.06), matBoot);
    toe.position.set(0, -0.062, -0.235);
    ankle.add(toe);
    return { hip, knee, ankle };
  };
  const legL = leg(-0.12);
  const legR = leg(0.12);

  root.traverse((o) => {
    o.frustumCulled = false;               // always at the camera — never cull
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
  });
  return { root, chest, pelvis, legL, legR };
}

export function createPlayer({ camera, input, world, hud, audio }) {
  const p = {
    position: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(),
    yaw: Math.PI,
    pitch: 0,
    isGrounded: true,
    isSprinting: false,
    health: 100,
    alive: true,
    adsLevel: 0,
    onFov: null,
    getEyePos,
    update,
    setAdsLevel(t) { p.adsLevel = t; },
    addViewKick(pitchKick, yawKick) { kick.x += pitchKick; kick.y += yawKick; },
    takeDamage,
  };

  let eyeHeight = EYE_STAND;
  let crouching = false;
  let fov = FOV_BASE;
  let bobPhase = 0, bobAmp = 0, roll = 0;
  let lastDamageTime = -10, timeAlive = 0;
  let deathRoll = 0, deathEye = 0;
  let celebT = -1;                        // SIUU celebration: jump + 360° camera spin
  let celebSpin = 0;
  const kick = new THREE.Vector2();       // accumulated recoil offset (pitch, yaw)
  const box = new THREE.Box3();
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();
  let stepSide = 0;

  // ---- first-person body ---------------------------------------------------
  const body = buildBody();
  let legAmp = 0;                          // eased leg-cycle amplitude
  let airB = 0;                            // eased airborne-pose blend

  // Visibility must be settled every RENDERED frame — including while driving,
  // when main.js skips player.update entirely. A zero-area sentinel mesh on
  // the camera draws no fragments in any pass but still gets onBeforeRender:
  // hide the body whenever the camera left the first-person eye (chase cam
  // while driving, __overview flyby) or the player is dead (death cam).
  const sentinel = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute(
      'position', new THREE.BufferAttribute(new Float32Array(9), 3)),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false })
  );
  sentinel.frustumCulled = false;
  sentinel.onBeforeRender = () => {
    if (!body.root.parent && camera.parent) camera.parent.add(body.root);
    const dx = camera.position.x - p.position.x;
    const dy = camera.position.y - (p.position.y + eyeHeight);
    const dz = camera.position.z - p.position.z;
    const firstPerson = dx * dx + dy * dy + dz * dz <= 2.25; // (1.5 m)²
    const want = firstPerson && p.alive && !window.__overview;
    if (body.root.visible !== want) body.root.visible = want;
  };
  camera.add(sentinel);

  function getEyePos() {
    return new THREE.Vector3(p.position.x, p.position.y + (p.alive ? eyeHeight : 0.4 + deathEye), p.position.z);
  }

  function takeDamage(amount, fromPos) {
    if (!p.alive) return;
    p.health = Math.max(0, p.health - amount);
    lastDamageTime = timeAlive;
    hud.setHealth(p.health);
    audio.hurt();
    if (fromPos) {
      const dx = fromPos.x - p.position.x, dz = fromPos.z - p.position.z;
      const worldAngle = Math.atan2(dx, dz);
      hud.showDamageFrom(worldAngle - p.yaw + Math.PI);
    }
    if (p.health <= 0) p.alive = false;
  }

  function collide() {
    // axis-separated push-out against world AABBs
    const pos = p.position;
    if (pos.y < 0) { pos.y = 0; if (p.velocity.y < 0) { landIfFalling(); p.velocity.y = 0; } p.isGrounded = true; }
    const height = crouching ? 1.3 : 1.8;
    for (const c of world.colliders) {
      box.copy(c);
      // expand by radius horizontally
      if (pos.x + RADIUS < box.min.x || pos.x - RADIUS > box.max.x) continue;
      if (pos.z + RADIUS < box.min.z || pos.z - RADIUS > box.max.z) continue;
      if (pos.y > box.max.y - 0.001 || pos.y + height < box.min.y) {
        // possibly standing on it
        continue;
      }
      const topPen = box.max.y - pos.y;
      if (topPen > 0 && topPen < 0.55 && p.velocity.y <= 0.01) {
        // step / land on top
        pos.y = box.max.y;
        if (p.velocity.y < -0.5) landIfFalling();
        p.velocity.y = Math.max(0, p.velocity.y);
        p.isGrounded = true;
        continue;
      }
      // horizontal push-out: smallest axis
      const pushXPos = box.max.x + RADIUS - pos.x;
      const pushXNeg = pos.x - (box.min.x - RADIUS);
      const pushZPos = box.max.z + RADIUS - pos.z;
      const pushZNeg = pos.z - (box.min.z - RADIUS);
      const minPush = Math.min(pushXPos, pushXNeg, pushZPos, pushZNeg);
      if (minPush === pushXPos) { pos.x = box.max.x + RADIUS; if (p.velocity.x < 0) p.velocity.x = 0; }
      else if (minPush === pushXNeg) { pos.x = box.min.x - RADIUS; if (p.velocity.x > 0) p.velocity.x = 0; }
      else if (minPush === pushZPos) { pos.z = box.max.z + RADIUS; if (p.velocity.z < 0) p.velocity.z = 0; }
      else { pos.z = box.min.z - RADIUS; if (p.velocity.z > 0) p.velocity.z = 0; }
    }
  }

  let wasFalling = false;
  function landIfFalling() {
    if (wasFalling) { audio.land(); bobPhase = 0; landDip = 0.09; wasFalling = false; }
  }
  let landDip = 0;

  function update(dt) {
    timeAlive += dt;

    if (p.alive) {
      // look
      const { dx, dy } = input.takeMouseDelta();
      const sens = SENS * (1 - 0.45 * p.adsLevel);
      p.yaw -= dx * sens;
      p.pitch -= dy * sens;
      p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));

      // move intent — analog stick wins over digital keys when deflected
      crouching = input.isDown('ControlLeft') || input.isDown('KeyC');
      let f, s;
      const gx = input.moveX || 0, gy = input.moveY || 0;
      if (Math.hypot(gx, gy) > 0.05) {
        f = -gy; s = gx;
      } else {
        f = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
        s = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
      }
      p.isSprinting = input.isDown('ShiftLeft') && f > 0 && !crouching && p.adsLevel < 0.3;
      let speed = p.isSprinting ? SPRINT : crouching ? CROUCH : WALK;
      speed *= (1 - 0.45 * p.adsLevel);

      fwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      right.set(-fwd.z, 0, fwd.x);
      wish.set(0, 0, 0).addScaledVector(fwd, f).addScaledVector(right, s);
      const wlen = wish.length();
      if (wlen > 0) wish.normalize().multiplyScalar(speed * Math.min(1, wlen));

      const accel = p.isGrounded ? ACCEL_GROUND : ACCEL_AIR;
      p.velocity.x += (wish.x - p.velocity.x) * Math.min(1, accel * dt);
      p.velocity.z += (wish.z - p.velocity.z) * Math.min(1, accel * dt);

      if (input.pressed('Space') && p.isGrounded) {
        p.velocity.y = JUMP;
        p.isGrounded = false;
      }

      // SIUU celebration (KeyV): hop + full spin, aim restored at the end
      if (input.pressed('KeyV') && p.isGrounded && celebT < 0) {
        celebT = 0;
        p.velocity.y = 3.6;
        p.isGrounded = false;
        hud.killfeed?.('SIUUU!');
      }
    } else {
      p.velocity.x *= 0.9; p.velocity.z *= 0.9;
      deathRoll = Math.min(deathRoll + dt * 1.6, 0.44);
    }

    // gravity + integrate
    p.velocity.y -= GRAVITY * dt;
    if (p.velocity.y < -1.5 && !p.isGrounded) wasFalling = true;
    p.isGrounded = false;
    p.position.addScaledVector(p.velocity, dt);
    collide();

    // health regen
    if (p.alive && p.health < 100 && timeAlive - lastDamageTime > 4.5) {
      p.health = Math.min(100, p.health + 12 * dt);
      hud.setHealth(p.health);
    }

    // eye height ease
    const targetEye = crouching ? EYE_CROUCH : EYE_STAND;
    eyeHeight += (targetEye - eyeHeight) * Math.min(1, 12 * dt);

    // head bob
    const groundSpeed = Math.hypot(p.velocity.x, p.velocity.z);
    const moving = groundSpeed > 0.8 && p.isGrounded;
    const targetAmp = moving ? (p.isSprinting ? 0.032 : 0.021) * (1 - 0.7 * p.adsLevel) : 0;
    bobAmp += (targetAmp - bobAmp) * Math.min(1, 8 * dt);
    if (moving) {
      const prev = bobPhase;
      bobPhase += dt * (5.2 + groundSpeed * 0.85);
      // footstep at each bob trough
      if (Math.sin(prev * 2) > 0 && Math.sin(bobPhase * 2) <= 0) {
        stepSide = 1 - stepSide;
        audio.footstep();
      }
    }
    const bobY = Math.sin(bobPhase * 2) * bobAmp;
    const bobX = Math.cos(bobPhase) * bobAmp * 0.7;

    // strafe lean
    const strafeVel = p.velocity.dot(right);
    const targetRoll = p.alive ? -strafeVel * 0.0027 : deathRoll;
    roll += (targetRoll - roll) * Math.min(1, 10 * dt);

    // land dip decay
    landDip += (0 - landDip) * Math.min(1, 7 * dt);

    // SIUU spin: eased 2π over 0.7s — net zero, so aim is unchanged after
    if (celebT >= 0) {
      celebT += dt;
      const t = Math.min(celebT / 0.7, 1);
      celebSpin = Math.PI * 2 * t * t * (3 - 2 * t);
      if (t >= 1 && p.isGrounded) { celebT = -1; celebSpin = 0; }
    }

    // recoil recovery
    kick.x += (0 - kick.x) * Math.min(1, 9 * dt);
    kick.y += (0 - kick.y) * Math.min(1, 9 * dt);

    // fov
    const base = p.isSprinting ? FOV_SPRINT : FOV_BASE;
    const targetFov = base + (FOV_ADS - base) * p.adsLevel;
    fov += (targetFov - fov) * Math.min(1, 12 * dt);
    if (p.onFov) p.onFov(fov);

    // camera transform
    const eye = getEyePos();
    camera.position.set(eye.x + bobX * Math.cos(p.yaw), eye.y + bobY - landDip, eye.z - bobX * Math.sin(p.yaw));
    camera.rotation.order = 'YXZ';
    camera.rotation.set(p.pitch + kick.x, p.yaw + kick.y + celebSpin, roll);

    // ---- first-person body pose ---------------------------------------
    // Rides the same bobPhase as the head bob / footstep cycle so the leg
    // plants line up with the audible footsteps (swing peaks at each step).
    if (p.alive) {
      body.root.position.copy(p.position);
      body.root.rotation.y = p.yaw + celebSpin;

      const drop = EYE_STAND - eyeHeight;              // 0 → 0.53, eased
      const crouchB = Math.min(1, Math.max(0, drop / (EYE_STAND - EYE_CROUCH)));
      const cb = Math.sqrt(crouchB);                   // leg-fold blend (keeps feet near ground mid-ease)
      airB += ((p.isGrounded ? 0 : 1) - airB) * Math.min(1, 10 * dt);
      const ampT = moving ? 0.42 + 0.26 * Math.min(1, groundSpeed / SPRINT) : 0;
      legAmp += (ampT - legAmp) * Math.min(1, 9 * dt);

      // chest slice: base pivot lean, subtle walk counter-sway
      body.chest.position.set(0, 1.055 - drop * 0.98, 0.06 * crouchB);
      body.chest.rotation.set(
        -(0.24 * crouchB + 0.12 * airB + 0.05 * legAmp),
        Math.sin(bobPhase) * 0.08 * legAmp, 0);

      // pelvis: sinks with the eye, shifts back as the knees drive forward
      const hipY = 0.96 - drop * 0.94;
      const hipZ = 0.10 + 0.07 * crouchB;
      body.pelvis.position.set(0, hipY + 0.045, hipZ);
      body.pelvis.rotation.y = -Math.sin(bobPhase) * 0.05 * legAmp;

      // legs: idle stance → walk/sprint cycle → squat fold → airborne tuck
      const swing = Math.sin(bobPhase) * legAmp * (1 - 0.6 * cb) * (1 - 0.7 * airB);
      const hipPose = 0.16 + 0.98 * cb;      // idle: boots a touch ahead — toes peek past the vest
      const kneePose = -0.22 - 1.90 * cb;
      const poseLeg = (leg, sx, sw, hipAir, kneeAir) => {
        leg.hip.position.set(sx, hipY, hipZ);
        const h = hipPose + sw + hipAir * airB;
        const k = kneePose - (0.18 * legAmp + 0.95 * Math.max(0, -sw)) + kneeAir * airB;
        leg.hip.rotation.x = h;
        leg.knee.rotation.x = k;
        // ankle keeps the boot sole level while grounded, toes drop in the air
        leg.ankle.rotation.x = -(h + k) * (1 - 0.55 * airB) - 0.35 * airB;
      };
      poseLeg(body.legL, -0.12, swing, 0.85, -1.15);
      poseLeg(body.legR, 0.12, -swing, 0.42, -0.72);
    }

    hud.setSprint(p.isSprinting);
  }

  return p;
}
