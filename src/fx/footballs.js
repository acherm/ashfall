// ============================================================================
// ASHFALL — fx/footballs.js  (FOOTBALL MODE — "CR7 MODE")
// Pooled football projectiles: kick launch, gravity + Magnus curve,
// sphere-vs-AABB bounces against world colliders + ground, capsule hit tests,
// sleep-when-slow then fade + recycle.
// Contract: createFootballs({ scene, world }) -> { kick, setEnemyProvider,
//   setPlayerProvider, onEnemyHit, onPlayerHit, onBounce, update, count }
// ============================================================================
import * as THREE from 'three';

const POOL = 16;
const BALL_R = 0.11;
const GRAVITY = 9.8;
const REST = 0.55;           // restitution vs ground / colliders
const TANG_FRIC = 0.86;      // tangential velocity kept per bounce
const ROLL_FRIC = 1.1;       // exponential rolling decel /s when grounded
const LIFE = 7.0;            // seconds before fade + recycle
const FADE = 0.45;
const SLEEP_SPEED = 0.35;    // m/s -> sleep when grounded
const MAGNUS_K = 0.0045;     // lateral accel = K * (angVel x vel)
const HIT_MIN_SPEED = 1.6;   // armed ball must be moving to score a hit
const PLAYER_HIT_R = 0.55;   // forgiving test radius for ENEMY balls vs the
                             // player — a ball grazing you should count

// ---------------------------------------------------------------- texture
// Classic 32-panel football: spherical Voronoi over the truncated-icosahedron
// panel centers (12 icosahedron vertices = black pentagons, 20 dodecahedron
// vertices = white hexagons), rasterized into the equirectangular UV space of
// a SphereGeometry. Voronoi boundaries become dark stitched seams, so the
// pentagon/hexagon layout is geometrically correct — including at the poles.
export function makeFootballTexture(size = 512) {
  const PHI = (1 + Math.sqrt(5)) / 2;
  const centers = [];
  const add = (x, y, z, black) => {
    const l = Math.hypot(x, y, z);
    centers.push({ x: x / l, y: y / l, z: z / l, black });
  };
  // 12 icosahedron vertices -> pentagon (black) panel centers
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
    add(0, s1, s2 * PHI, true);
    add(s1, s2 * PHI, 0, true);
    add(s2 * PHI, 0, s1, true);
  }
  // 20 dodecahedron vertices (= icosa face centers) -> hexagon (white) centers
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    add(sx, sy, sz, false);
  }
  const ia = 1 / PHI;
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
    add(0, s1 * ia, s2 * PHI, false);
    add(s1 * ia, s2 * PHI, 0, false);
    add(s2 * PHI, 0, s1 * ia, false);
  }

  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const px = img.data;
  const SEAM = 0.058;        // angular half-gap that reads as a seam (rad)
  const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

  let o = 0;
  for (let y = 0; y < size; y++) {
    const pol = ((y + 0.5) / size) * Math.PI;
    const sp = Math.sin(pol), cp = Math.cos(pol);
    for (let x = 0; x < size; x++) {
      const az = ((x + 0.5) / size) * Math.PI * 2;
      const dx = sp * Math.cos(az), dy = cp, dz = sp * Math.sin(az);
      let best = -2, second = -2, bi = 0;
      for (let i = 0; i < 32; i++) {
        const cc = centers[i];
        const d = dx * cc.x + dy * cc.y + dz * cc.z;
        if (d > best) { second = best; best = d; bi = i; }
        else if (d > second) second = d;
      }
      const a1 = Math.acos(Math.min(1, best));
      const a2 = Math.acos(Math.min(1, Math.max(-1, second)));
      const edge = a2 - a1;                 // 0 exactly on a panel boundary
      const seam = 1 - sm(edge / SEAM);     // 1 at seam, 0 inside panel
      const black = centers[bi].black;
      // panel base + faint leather grain
      const grain = (Math.random() - 0.5) * (black ? 6 : 11);
      let r, gg, bb;
      if (black) { r = 30 + grain; gg = 30 + grain; bb = 33 + grain; }
      else { r = 231 + grain; gg = 227 + grain; bb = 219 + grain; }
      // soft bevel shading toward panel edges, then the dark stitched seam
      const bevel = 1 - 0.16 * sm(1 - edge / (SEAM * 2.6));
      r *= bevel; gg *= bevel; bb *= bevel;
      r = r * (1 - seam) + 24 * seam;
      gg = gg * (1 - seam) + 23 * seam;
      bb = bb * (1 - seam) + 22 * seam;
      px[o++] = r; px[o++] = gg; px[o++] = bb; px[o++] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // scuffs + street grime so the ball isn't showroom-fresh
  for (let i = 0; i < 26; i++) {
    const sx = Math.random() * size, sy = Math.random() * size;
    const rad = 8 + Math.random() * 34;
    const dark = Math.random() > 0.4;
    const gr = g.createRadialGradient(sx, sy, 0, sx, sy, rad);
    gr.addColorStop(0, dark ? 'rgba(58,52,44,0.10)' : 'rgba(255,255,250,0.07)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 420; i++) {
    g.fillStyle = `rgba(40,36,30,${0.05 + Math.random() * 0.08})`;
    g.fillRect(Math.random() * size, Math.random() * size, 1.4, 1.4);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------- temps
const UP = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _d = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _mag = new THREE.Vector3();
const _cc = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _hitPoint = new THREE.Vector3();
const _hitVel = new THREE.Vector3();

// ============================================================================
export function createFootballs({ scene, world }) {
  const texture = makeFootballTexture(512);
  const geo = new THREE.SphereGeometry(BALL_R, 26, 20);
  const balls = [];
  for (let i = 0; i < POOL; i++) {
    const mat = new THREE.MeshStandardMaterial({
      map: texture, roughness: 0.62, metalness: 0.02,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    scene.add(mesh);
    balls.push({
      mesh, mat,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      angVel: new THREE.Vector3(),
      active: false, asleep: false, fading: false,
      age: 0, fadeT: 0, owner: 'player', armed: false,
    });
  }

  let enemyProvider = null;
  let playerProvider = null;

  const api = {
    onEnemyHit: null,
    onPlayerHit: null,
    onBounce: null,       // (pos, strength 0..1) — weapon wires audio.bounce
    kick,
    update,
    setEnemyProvider(fn) { enemyProvider = fn; },
    setPlayerProvider(fn) { playerProvider = fn; },
    get count() {
      let n = 0;
      for (let i = 0; i < POOL; i++) if (balls[i].active) n++;
      return n;
    },
  };

  function fireBounce(b, vn) {
    if (api.onBounce) {
      try { api.onBounce(b.pos, Math.min(1, vn / 10)); } catch (e) { /* keep */ }
    }
  }

  // ------------------------------------------------------------------ kick
  function kick(from, dir, speed, curve = 0, owner = 'player', ownerRef = null) {
    let b = null, oldest = null, oldestAge = -1;
    for (let i = 0; i < POOL; i++) {
      const c = balls[i];
      if (!c.active) { b = c; break; }
      if (c.age > oldestAge) { oldestAge = c.age; oldest = c; }
    }
    if (!b) b = oldest;
    b.active = true; b.asleep = false; b.fading = false;
    b.age = 0; b.fadeT = 0;
    b.owner = owner === 'enemy' ? 'enemy' : 'player';
    b.ownerRef = ownerRef; // which enemy kicked it — for the SIUU celebration
    b.armed = true;
    b.pos.copy(from);
    b.vel.copy(dir).normalize().multiplyScalar(speed);
    // backspin about the lateral axis (visual whip) + side spin from curve
    // (side spin is what the Magnus term turns into lateral drift)
    _axis.crossVectors(UP, b.vel);
    if (_axis.lengthSq() > 1e-6) {
      _axis.normalize();
      b.angVel.copy(_axis).multiplyScalar(-(8 + speed * 0.25));
    } else {
      b.angVel.set(0, 0, 0);
    }
    b.angVel.y += curve * 10;
    b.mat.opacity = 1;
    b.mat.transparent = false;
    b.mesh.scale.setScalar(1);
    b.mesh.position.copy(b.pos);
    b.mesh.visible = true;
    return b;
  }

  // ------------------------------------------------------------- collision
  // Sphere vs world-space AABB: push out along the contact normal, reflect
  // with restitution, keep friction-scaled tangential velocity.
  // Returns 0 = no contact, 2 = up-facing contact (grounded), 1 = other.
  function collideBox(b, box) {
    if (b.pos.x < box.min.x - BALL_R || b.pos.x > box.max.x + BALL_R ||
        b.pos.y < box.min.y - BALL_R || b.pos.y > box.max.y + BALL_R ||
        b.pos.z < box.min.z - BALL_R || b.pos.z > box.max.z + BALL_R) return 0;
    _cp.copy(b.pos).clamp(box.min, box.max);
    _d.subVectors(b.pos, _cp);
    const d2 = _d.lengthSq();
    if (d2 > BALL_R * BALL_R) return 0;
    if (d2 > 1e-9) {
      const dl = Math.sqrt(d2);
      _n.copy(_d).multiplyScalar(1 / dl);
      b.pos.addScaledVector(_n, BALL_R - dl + 1e-4);
    } else {
      // center inside the box: exit through the nearest face
      let pen = box.max.x - b.pos.x; _n.set(1, 0, 0);
      let t = b.pos.x - box.min.x;
      if (t < pen) { pen = t; _n.set(-1, 0, 0); }
      t = box.max.y - b.pos.y;
      if (t < pen) { pen = t; _n.set(0, 1, 0); }
      t = b.pos.y - box.min.y;
      if (t < pen) { pen = t; _n.set(0, -1, 0); }
      t = box.max.z - b.pos.z;
      if (t < pen) { pen = t; _n.set(0, 0, 1); }
      t = b.pos.z - box.min.z;
      if (t < pen) { pen = t; _n.set(0, 0, -1); }
      b.pos.addScaledVector(_n, pen + BALL_R + 1e-4);
    }
    const vn = b.vel.dot(_n);
    if (vn < 0) {
      _vt.copy(b.vel).addScaledVector(_n, -vn);   // tangential part
      b.vel.copy(_vt).multiplyScalar(TANG_FRIC).addScaledVector(_n, -vn * REST);
      // contact friction spins the ball toward rolling in the slide direction
      _axis.crossVectors(_n, _vt);
      b.angVel.addScaledVector(_axis, 0.06 / BALL_R);
      if (-vn > 1.0) fireBounce(b, -vn);
      // kill micro-bounces on up faces so balls settle on box tops
      if (_n.y > 0.7 && -vn * REST < 0.5) {
        b.vel.addScaledVector(_n, -b.vel.dot(_n));
      }
    }
    return _n.y > 0.7 ? 2 : 1;
  }

  function stepBall(b, dt) {
    // gravity + Magnus (capped so extreme spins can't slingshot)
    _mag.crossVectors(b.angVel, b.vel).multiplyScalar(MAGNUS_K);
    const ml = _mag.length();
    if (ml > 6) _mag.multiplyScalar(6 / ml);
    b.vel.y -= GRAVITY * dt;
    b.vel.addScaledVector(_mag, dt);
    b.pos.addScaledVector(b.vel, dt);

    let grounded = false;
    // ground plane y = 0
    if (b.pos.y < BALL_R) {
      b.pos.y = BALL_R;
      if (b.vel.y < 0) {
        const vn = -b.vel.y;
        b.vel.y = vn > 0.9 ? vn * REST : 0;
        b.vel.x *= TANG_FRIC;
        b.vel.z *= TANG_FRIC;
        _vt.set(b.vel.x, 0, b.vel.z);
        _axis.crossVectors(UP, _vt);
        b.angVel.addScaledVector(_axis, 0.06 / BALL_R);
        if (vn > 1.0) fireBounce(b, vn);
      }
      grounded = b.vel.y < 0.5;
    }
    // world colliders
    const cols = world.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const hit = collideBox(b, cols[i]);
      if (hit === 2) grounded = true;
    }

    if (grounded) {
      // rolling friction + converge spin to true rolling: w = (up x v) / r
      const f = Math.exp(-ROLL_FRIC * dt);
      b.vel.x *= f;
      b.vel.z *= f;
      _vt.set(b.vel.x, 0, b.vel.z);
      const sp = _vt.length();
      _axis.crossVectors(UP, _vt).multiplyScalar(1 / BALL_R);
      b.angVel.lerp(_axis, Math.min(1, 8 * dt));
      if (sp < SLEEP_SPEED && Math.abs(b.vel.y) < 0.4) {
        b.asleep = true;
        b.vel.set(0, 0, 0);
        b.angVel.set(0, 0, 0);
      }
    } else {
      b.angVel.multiplyScalar(Math.exp(-0.12 * dt));
    }
  }

  // ------------------------------------------------------------- hit tests
  // Sphere vs vertical capsule { pos: feet, radius, height }. On overlap the
  // callback fires once (ball disarms) and the ball boings off the target.
  function capsuleHit(b, feet, radius, height) {
    const rr = radius + BALL_R;
    if (b.pos.y < feet.y - BALL_R || b.pos.y > feet.y + height + BALL_R) return false;
    const dx = b.pos.x - feet.x, dz = b.pos.z - feet.z;
    if (dx * dx + dz * dz > rr * rr) return false;
    const bot = feet.y + radius, top = feet.y + height - radius;
    const cy = Math.min(Math.max(b.pos.y, bot), top);
    _cc.set(feet.x, cy, feet.z);
    _d.subVectors(b.pos, _cc);
    const d2 = _d.lengthSq();
    if (d2 > rr * rr) return false;
    _hitVel.copy(b.vel);
    const dl = Math.sqrt(Math.max(d2, 1e-8));
    if (dl < 1e-3) _n.set(0, 0, 1);
    else _n.copy(_d).multiplyScalar(1 / dl);
    _hitPoint.copy(_cc).addScaledVector(_n, radius);
    b.pos.copy(_cc).addScaledVector(_n, rr + 0.01);
    const vn = b.vel.dot(_n);
    if (vn < 0) {
      _vt.copy(b.vel).addScaledVector(_n, -vn);
      b.vel.copy(_vt).multiplyScalar(0.7).addScaledVector(_n, -vn * REST);
    }
    return true;
  }

  function hitTests(b) {
    if (b.vel.lengthSq() < HIT_MIN_SPEED * HIT_MIN_SPEED) return;
    if (b.owner === 'player') {
      const foes = enemyProvider ? enemyProvider() : null;
      if (!foes) return;
      for (let i = 0; i < foes.length; i++) {
        const f = foes[i];
        if (!f || !f.pos) continue;
        if (capsuleHit(b, f.pos, f.radius || 0.34, f.height || 1.8)) {
          b.armed = false;
          if (api.onEnemyHit) {
            try { api.onEnemyHit(f.ref, _hitPoint.clone(), _hitVel.clone()); }
            catch (e) { /* keep sim alive */ }
          }
          break;
        }
      }
    } else {
      const p = playerProvider ? playerProvider() : null;
      if (!p || !p.pos) return;
      if (capsuleHit(b, p.pos, Math.max(p.radius || 0.38, PLAYER_HIT_R), p.height || 1.8)) {
        b.armed = false;
        if (api.onPlayerHit) {
          try { api.onPlayerHit(b.pos.clone(), b.ownerRef); }
          catch (e) { /* keep sim alive */ }
        }
      }
    }
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    if (!(dt > 0)) return;
    for (let i = 0; i < POOL; i++) {
      const b = balls[i];
      if (!b.active) continue;
      b.age += dt;
      if (!b.fading && b.age >= LIFE) {
        b.fading = true;
        b.fadeT = 0;
        b.mat.transparent = true;
      }
      if (b.fading) {
        b.fadeT += dt;
        const k = 1 - b.fadeT / FADE;
        if (k <= 0) {
          b.active = false;
          b.mesh.visible = false;
          b.mat.transparent = false;
          b.mat.opacity = 1;
          continue;
        }
        b.mat.opacity = k;
        b.mesh.scale.setScalar(0.65 + 0.35 * k);
      }
      if (!b.asleep) stepBall(b, dt);
      if (b.armed && !b.fading) hitTests(b);
      // visual spin from angular velocity
      const w = b.angVel.length();
      if (w > 0.01) {
        _axis.copy(b.angVel).multiplyScalar(1 / w);
        _q.setFromAxisAngle(_axis, w * dt);
        b.mesh.quaternion.premultiply(_q);
      }
      b.mesh.position.copy(b.pos);
    }
  }

  // shot-harness debug handle (mirrors main.js's window.__player pattern)
  if (window.__SHOT_MODE__) window.__fb = api;
  return api;
}
