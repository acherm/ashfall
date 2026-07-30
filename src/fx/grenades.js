// Thrown fragmentation grenades: pooled projectiles with gravity + bounce, a
// timed fuse, and an area blast on detonation (visual via fx.explosionAt; the
// actual damage is applied by the onExplode callback wired in main.js).
import * as THREE from 'three';

const POOL = 8;
const R = 0.085;          // grenade radius
const GRAV = 11.0;
const REST = 0.42;        // bounce restitution
const FRIC = 0.7;         // tangential keep per bounce
const ROLL = 1.4;         // rolling decel /s
const FUSE = 2.2;         // seconds before it goes off
export const BLAST_RADIUS = 6.5;

const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export function createGrenades({ scene, world, fx, audio }) {
  // model: dark olive body + a lighter lever/spoon cap so it reads as a grenade
  const bodyGeo = new THREE.SphereGeometry(R, 12, 9);
  bodyGeo.scale(1, 1.18, 1);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b4a2e, roughness: 0.7, metalness: 0.35 });
  const capGeo = new THREE.CylinderGeometry(R * 0.5, R * 0.55, R * 0.5, 8);
  const capMat = new THREE.MeshStandardMaterial({ color: 0x6a6f62, roughness: 0.5, metalness: 0.6 });

  const gs = [];
  for (let i = 0; i < POOL; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = R * 1.1;
    g.add(body); g.add(cap);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    g.visible = false;
    g.frustumCulled = false;
    scene.add(g);
    gs.push({ g, pos: new THREE.Vector3(), vel: new THREE.Vector3(), av: new THREE.Vector3(),
      active: false, fuse: 0 });
  }

  const api = {
    onExplode: null,      // (pos: Vector3, radius) => {}
    throw: throwGrenade,
    update,
    get count() { let n = 0; for (const x of gs) if (x.active) n++; return n; },
  };

  function throwGrenade(from, dir, speed = 17) {
    let b = gs.find((x) => !x.active);
    if (!b) { // recycle the oldest by exploding it early — keeps the pool honest
      b = gs.reduce((a, c) => (c.fuse < a.fuse ? c : a), gs[0]);
      explode(b);
    }
    b.active = true; b.fuse = FUSE;
    b.pos.copy(from);
    b.vel.copy(dir).normalize().multiplyScalar(speed);
    b.vel.y += 2.4;                         // toss arc
    b.av.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 20);
    b.g.position.copy(from);
    b.g.visible = true;
    audio?.grenadeThrow?.();
    return b;
  }

  function bounceColliders(b) {
    const p = b.pos, v = b.vel;
    for (const c of world.colliders) {
      if (p.x + R < c.min.x || p.x - R > c.max.x) continue;
      if (p.z + R < c.min.z || p.z - R > c.max.z) continue;
      if (p.y + R < c.min.y || p.y - R > c.max.y) continue;
      // penetration on each axis, reflect on the smallest
      const dxp = c.max.x + R - p.x, dxn = p.x - (c.min.x - R);
      const dyp = c.max.y + R - p.y, dyn = p.y - (c.min.y - R);
      const dzp = c.max.z + R - p.z, dzn = p.z - (c.min.z - R);
      const m = Math.min(dxp, dxn, dyp, dyn, dzp, dzn);
      if (m === dyp) { p.y = c.max.y + R; if (v.y < 0) v.y = -v.y * REST; v.x *= FRIC; v.z *= FRIC; }
      else if (m === dyn) { p.y = c.min.y - R; if (v.y > 0) v.y = -v.y * REST; }
      else if (m === dxp) { p.x = c.max.x + R; if (v.x < 0) v.x = -v.x * REST; }
      else if (m === dxn) { p.x = c.min.x - R; if (v.x > 0) v.x = -v.x * REST; }
      else if (m === dzp) { p.z = c.max.z + R; if (v.z < 0) v.z = -v.z * REST; }
      else { p.z = c.min.z - R; if (v.z > 0) v.z = -v.z * REST; }
    }
  }

  function explode(b) {
    if (!b.active) return;
    b.active = false; b.g.visible = false;
    fx?.explosionAt?.(b.pos);
    _n.set(0, 1, 0);
    fx?.debris?.(b.pos, _n);
    audio?.explosion?.(b.pos);
    if (api.onExplode) { try { api.onExplode(b.pos.clone(), BLAST_RADIUS); } catch (e) { /* keep */ } }
  }

  function update(dt) {
    for (const b of gs) {
      if (!b.active) continue;
      b.fuse -= dt;
      if (b.fuse <= 0) { explode(b); continue; }
      b.vel.y -= GRAV * dt;
      b.pos.addScaledVector(b.vel, dt);
      if (b.pos.y - R < 0) {          // ground
        b.pos.y = R;
        if (b.vel.y < 0) b.vel.y = -b.vel.y * REST;
        b.vel.x *= FRIC; b.vel.z *= FRIC;
      }
      bounceColliders(b);
      // rolling drag when settled
      const grounded = b.pos.y <= R + 0.02;
      if (grounded) { const k = Math.max(0, 1 - ROLL * dt); b.vel.x *= k; b.vel.z *= k; }
      b.g.position.copy(b.pos);
      // tumble
      const sp = b.av.length();
      if (sp > 0.001) { _q.setFromAxisAngle(_n.copy(b.av).multiplyScalar(1 / sp), sp * dt); b.g.quaternion.premultiply(_q); }
    }
  }

  return api;
}
