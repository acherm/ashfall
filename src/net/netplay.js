// ASHFALL — net/netplay.js
// STAGE 1 online 2-player CO-OP: peer-to-peer over WebRTC via peerjs. The
// PeerJS free cloud broker is used for SIGNALLING ONLY — once the data channel
// is up, player state (position / yaw / pitch / weapon slot / alive / fire)
// travels directly P2P. This module owns the connection lifecycle AND a
// friendly BLUE teammate avatar it renders into the scene, interpolating the
// remote player's transform so main.js just has to pump send()/onData().
//
// Contract (main.js depends on it):
//   createNetplay({ scene }) -> {
//     host()            -> Promise<CODE>   // become host, resolve with a 4-char join code
//     join(code)        -> Promise<void>   // dial a host by code, resolve on data-channel open
//     get connected     : bool
//     get isHost        : bool
//     get status        : 'idle'|'hosting'|'connecting'|'connected'|'error'|'closed'
//     onStatus(fn)                          // fn(status, info)  info = code | error message
//     send(obj)                             // fire-and-forget over the data channel
//     onData(fn)                            // fn(obj) for every received message
//     applyRemote(state)                    // latest remote player state for interpolation
//     update(dt)                            // interpolate + animate the teammate avatar
//     remoteMuzzle()    -> Vector3 | null   // world muzzle position (for tracer/flash)
//     dispose()
//   }
//
// PLAYER-STATE MESSAGE SHAPE (what applyRemote reads — main.js sends this ~20/s):
//   { t: 'p', x, y, z, yaw, pitch, slot, alive, fire, name }
//   x,y,z are the remote player's FEET position; yaw/pitch match player.yaw /
//   player.pitch. applyRemote is tolerant: it reads those fields off whatever
//   object it's handed (a bare state or the whole message).
//
// Robustness: every peerjs callback is wrapped, connect has a ~15s timeout, and
// nothing here is allowed to throw into the game loop.

import * as THREE from 'three';
import { Peer } from 'peerjs';

// ---- code generation (avoid ambiguous 0/O/1/I) ---------------------------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
  return s;
}
const PEER_PREFIX = 'ashfall-';

// ICE servers: PeerJS defaults to a single Google STUN and NO TURN, so peers behind a
// symmetric NAT (very common on mobile/cellular networks) can't open a P2P data channel
// even though signalling succeeds — desktop↔desktop on friendly NATs works, mobile fails.
// Add extra STUN + a free public TURN relay (Open Relay) incl. TURN-over-TCP/443 so the
// connection can relay through restrictive networks. Passed to every Peer we create.
const PEER_OPTS = {
  debug: 0,
  config: {
    sdpSemantics: 'unified-plan',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:openrelay.metered.ca:80' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
  },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function errMsg(err) {
  if (!err) return 'Erreur de connexion';
  const t = err.type || '';
  if (t === 'peer-unavailable') return 'Aucune partie pour ce code';
  if (t === 'unavailable-id') return 'Code déjà pris — nouvel essai';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed')
    return 'Erreur réseau — vérifiez votre connexion';
  if (t === 'browser-incompatible') return 'Navigateur sans support WebRTC';
  if (t === 'timeout') return 'Connexion impossible (réseau/NAT) — réessayez';
  return err.message || String(t) || 'Erreur de connexion';
}

/* ============================================================ avatar model
 * A friendly soldier-ish humanoid built in the box/capsule proportion style of
 * enemies.js (head / torso / arms holding a dark rifle / articulated legs),
 * tinted a clear BLUE / teal so a glance separates teammate from the red-ish
 * enemies and neutral civilians. Front faces local +Z (rifle muzzle at +Z);
 * update() sets root.rotation.y = yaw + PI so it faces the remote's look dir.
 * Feet sit at the group origin (state x,y,z is feet); hips ride at HIP_H. */

const HIP_H = 0.98;      // hip pivot height above the feet
const MARKER_Y = 2.12;   // team marker floats here above the feet

function buildAvatar() {
  // friendly palette — cool blue/teal uniform, deep navy plate, cyan accents
  const matUni = new THREE.MeshStandardMaterial({ color: 0x2f7fa6, roughness: 0.85, metalness: 0.05 });
  const matPlate = new THREE.MeshStandardMaterial({ color: 0x1b3a4b, roughness: 0.9, metalness: 0.05 });
  const matPants = new THREE.MeshStandardMaterial({ color: 0x27566b, roughness: 0.9, metalness: 0.03 });
  const matHelmet = new THREE.MeshStandardMaterial({ color: 0x23596f, roughness: 0.8, metalness: 0.08 });
  const matFace = new THREE.MeshStandardMaterial({ color: 0x141a20, roughness: 0.7, metalness: 0.1 });
  const matBoot = new THREE.MeshStandardMaterial({ color: 0x12161a, roughness: 0.85, metalness: 0.05 });
  const matGlove = new THREE.MeshStandardMaterial({ color: 0x17262e, roughness: 0.9, metalness: 0.05 });
  const matRifle = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.4, metalness: 0.5 });
  // marker is UNLIT so it reads as a bright beacon in any lighting / fog
  const matMarker = new THREE.MeshBasicMaterial({ color: 0x27e6ff });
  const matMarkerRim = new THREE.MeshBasicMaterial({ color: 0x9af6ff });

  const root = new THREE.Group();
  const geoms = []; // for dispose()
  const mesh = (parent, geo, mat, x, y, z, shadow = true) => {
    geoms.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = false;
    parent.add(m);
    return m;
  };

  const hips = new THREE.Group();
  hips.position.y = HIP_H;
  root.add(hips);

  // pelvis + belt line
  mesh(hips, new THREE.BoxGeometry(0.32, 0.19, 0.24), matPants, 0, -0.02, 0);
  mesh(hips, new THREE.BoxGeometry(0.34, 0.06, 0.26), matPlate, 0, 0.08, 0, false);

  // torso: cool-blue shirt slab under a dark navy plate carrier + shoulders
  const torso = new THREE.Group();
  torso.position.y = 0.02;
  hips.add(torso);
  mesh(torso, new THREE.BoxGeometry(0.40, 0.30, 0.25), matUni, 0, 0.44, 0);   // upper chest
  mesh(torso, new THREE.BoxGeometry(0.36, 0.26, 0.24), matUni, 0, 0.17, 0);   // lower torso
  mesh(torso, new THREE.BoxGeometry(0.34, 0.32, 0.10), matPlate, 0, 0.34, 0.13, false); // plate front
  mesh(torso, new THREE.BoxGeometry(0.30, 0.30, 0.06), matPlate, 0, 0.34, -0.12, false); // plate back
  mesh(torso, new THREE.BoxGeometry(0.14, 0.10, 0.22), matPlate, 0.24, 0.55, 0, false);  // shoulder R
  mesh(torso, new THREE.BoxGeometry(0.14, 0.10, 0.22), matPlate, -0.24, 0.55, 0, false); // shoulder L

  // head — pitched a little with the aim; helmet + a dark visor face
  const headPiv = new THREE.Group();
  headPiv.position.set(0, 0.60, 0.0);
  torso.add(headPiv);
  mesh(headPiv, new THREE.CylinderGeometry(0.05, 0.06, 0.10, 8), matUni, 0, 0.02, 0, false); // neck
  mesh(headPiv, new THREE.CapsuleGeometry(0.095, 0.05, 4, 10), matHelmet, 0, 0.14, 0);       // head/helmet dome
  mesh(headPiv, new THREE.BoxGeometry(0.15, 0.07, 0.05), matFace, 0, 0.12, 0.085, false);    // visor strip (front +Z)
  mesh(headPiv, new THREE.SphereGeometry(0.115, 12, 9, 0, Math.PI * 2, 0, 1.7), matHelmet, 0, 0.16, 0); // helmet shell

  // aim rig — arms + rifle pivot about the shoulder line so pitch tilts them
  const aim = new THREE.Group();
  aim.position.set(0, 0.50, 0.02);
  torso.add(aim);

  // rifle held forward across the chest, muzzle at local +Z
  const rifle = new THREE.Group();
  rifle.position.set(0.0, -0.16, 0.26);
  aim.add(rifle);
  mesh(rifle, new THREE.BoxGeometry(0.05, 0.09, 0.34), matRifle, 0, 0, 0.02);        // receiver
  mesh(rifle, new THREE.BoxGeometry(0.047, 0.06, 0.28), matRifle, 0, 0, 0.30, false); // handguard
  mesh(rifle, new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8).rotateX(Math.PI / 2), matRifle, 0, 0.005, 0.52, false); // barrel
  const rmag = mesh(rifle, new THREE.BoxGeometry(0.04, 0.16, 0.078), matRifle, 0, -0.11, 0.06, false);
  rmag.rotation.x = -0.3;
  mesh(rifle, new THREE.BoxGeometry(0.044, 0.075, 0.2), matRifle, 0, 0.0, -0.20, false); // stock
  mesh(rifle, new THREE.BoxGeometry(0.04, 0.058, 0.1), matRifle, 0, 0.07, 0.05, false);  // optic
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.005, 0.62);
  rifle.add(muzzle);

  // arms reaching forward onto the rifle (static pose; the aim pivot animates)
  const mkArm = (side, elbowBend) => {
    const sh = new THREE.Group();
    sh.position.set(0.22 * side, 0.02, 0.02);
    sh.rotation.x = -1.15;          // raise the upper arm forward
    sh.rotation.z = 0.14 * side;    // tuck inward toward the rifle
    aim.add(sh);
    mesh(sh, new THREE.CapsuleGeometry(0.052, 0.16, 4, 8), matUni, 0, -0.12, 0);
    const el = new THREE.Group();
    el.position.set(0, -0.24, 0);
    el.rotation.x = elbowBend;      // bend the forearm forward to the grip
    sh.add(el);
    mesh(el, new THREE.CapsuleGeometry(0.045, 0.15, 4, 8), matUni, 0, -0.11, 0);
    mesh(el, new THREE.BoxGeometry(0.06, 0.07, 0.08), matGlove, 0, -0.23, 0.01, false); // hand
    return sh;
  };
  mkArm(1, 1.05);    // left hand cups the handguard (further forward)
  mkArm(-1, 0.75);   // right hand on the grip

  // articulated legs — hip pivot + knee pivot, for the walk cycle
  const mkLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0.11 * side, -0.04, 0);
    hips.add(hip);
    mesh(hip, new THREE.CapsuleGeometry(0.085, 0.28, 4, 10), matPants, 0, -0.22, 0);
    const knee = new THREE.Group();
    knee.position.set(0, -0.46, 0);
    hip.add(knee);
    mesh(knee, new THREE.CapsuleGeometry(0.068, 0.26, 4, 10), matPants, 0, -0.19, 0);
    mesh(knee, new THREE.BoxGeometry(0.12, 0.09, 0.30), matBoot, 0, -0.40, 0.05);
    return { hip, knee };
  };
  const legL = mkLeg(1);
  const legR = mkLeg(-1);

  // floating team marker — a bright cyan diamond (octahedron reads from ANY
  // angle, no camera needed) that slowly bobs + spins above the head
  const marker = new THREE.Group();
  marker.position.y = MARKER_Y;
  root.add(marker);
  const diamond = mesh(marker, new THREE.OctahedronGeometry(0.16), matMarker, 0, 0, 0, false);
  diamond.scale.set(0.72, 1.25, 0.72);
  const ring = mesh(marker, new THREE.TorusGeometry(0.17, 0.02, 6, 14), matMarkerRim, 0, 0, 0, false);
  ring.rotation.x = Math.PI / 2;

  // never cull (teammate may be anywhere / off-screen edges), cast shadows
  root.traverse((o) => {
    o.frustumCulled = false;
    if (o.isMesh && (o.material === matMarker || o.material === matMarkerRim)) o.castShadow = false;
  });

  const mats = [matUni, matPlate, matPants, matHelmet, matFace, matBoot, matGlove, matRifle, matMarker, matMarkerRim];
  return { root, hips, torso, headPiv, aim, rifle, muzzle, legL, legR, marker, geoms, mats };
}

/* ================================================================ factory */

export function createNetplay({ scene }) {
  // ---- connection state ---------------------------------------------------
  let peer = null;
  let conn = null;
  let isHost = false;
  let connected = false;
  let status = 'idle';
  let currentCode = null;

  let statusFn = null;
  let dataFn = null;

  // join() promise plumbing (so conn 'open' can resolve it)
  let joinResolve = null, joinReject = null, joinTimer = null, joinSettled = false;

  function setStatus(s, info) {
    status = s;
    if (statusFn) { try { statusFn(s, info ?? null); } catch (_) { /* never throw into caller */ } }
  }

  function teardownConn() {
    if (conn) { try { conn.close(); } catch (_) {} }
    conn = null;
    connected = false;
  }
  function teardownPeer() {
    teardownConn();
    if (peer) { try { peer.destroy(); } catch (_) {} }
    peer = null;
  }

  // wire a data connection (incoming for host, outgoing for join)
  function wireConn(c) {
    // a host that's already paired ignores further dial-ins
    if (conn && conn !== c && connected) { try { c.close(); } catch (_) {} return; }
    conn = c;

    const onOpen = () => {
      connected = true;
      setStatus('connected', isHost ? currentCode : null);
      if (joinResolve && !joinSettled) {
        joinSettled = true;
        if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
        const r = joinResolve; joinResolve = null; joinReject = null;
        try { r(); } catch (_) {}
      }
    };
    // PeerJS sometimes hands over an already-open connection
    if (c.open) onOpen();
    else { try { c.on('open', onOpen); } catch (_) {} }

    try {
      c.on('data', (d) => { if (dataFn) { try { dataFn(d); } catch (_) {} } });
      c.on('close', () => {
        connected = false;
        if (conn === c) conn = null;
        if (status !== 'error') setStatus('closed');
      });
      c.on('error', () => { /* swallow — keep the loop alive */ });
    } catch (_) {}
  }

  // ---- host ---------------------------------------------------------------
  function host() {
    isHost = true;
    return new Promise((resolve, reject) => {
      let settled = false;
      let attempts = 0;
      const attempt = () => {
        const code = makeCode();
        teardownPeer();
        setStatus('hosting', code);
        let p;
        try {
          p = new Peer(PEER_PREFIX + code, PEER_OPTS);
        } catch (err) {
          if (!settled) { settled = true; setStatus('error', errMsg(err)); reject(err); }
          return;
        }
        peer = p;
        try {
          p.on('open', () => {
            currentCode = code;
            setStatus('hosting', code);
            if (!settled) { settled = true; resolve(code); }
          });
          p.on('connection', (c) => wireConn(c));
          p.on('error', (err) => {
            // code collided with another host — pick a fresh one and retry
            if (err && err.type === 'unavailable-id' && attempts++ < 10) { attempt(); return; }
            setStatus('error', errMsg(err));
            if (!settled) { settled = true; reject(err); }
          });
          p.on('disconnected', () => { if (!connected) { try { p.reconnect(); } catch (_) {} } });
        } catch (err) {
          if (!settled) { settled = true; setStatus('error', errMsg(err)); reject(err); }
        }
      };
      attempt();
    });
  }

  // ---- join ---------------------------------------------------------------
  function join(code) {
    isHost = false;
    joinSettled = false;
    const target = PEER_PREFIX + String(code || '').trim().toUpperCase();
    return new Promise((resolve, reject) => {
      joinResolve = resolve; joinReject = reject;
      teardownPeer();
      setStatus('connecting', null);

      const fail = (err) => {
        if (joinSettled) return;
        joinSettled = true;
        if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
        setStatus('error', errMsg(err));
        joinResolve = null; joinReject = null;
        try { reject(err instanceof Error ? err : new Error(errMsg(err))); } catch (_) {}
      };

      joinTimer = setTimeout(() => fail({ type: 'timeout', message: 'Connection timed out' }), 15000);

      let p;
      try {
        p = new Peer(PEER_OPTS);
      } catch (err) { fail(err); return; }
      peer = p;

      try {
        p.on('open', () => {
          let c;
          try {
            c = p.connect(target, { reliable: true });
          } catch (err) { fail(err); return; }
          if (!c) { fail({ type: 'peer-unavailable' }); return; }
          wireConn(c);
        });
        p.on('error', (err) => fail(err));
        p.on('disconnected', () => { if (!connected) { try { p.reconnect(); } catch (_) {} } });
      } catch (err) { fail(err); }
    });
  }

  /* ============================================ teammate avatar + interp */
  const AV = buildAvatar();
  AV.root.visible = false;
  scene.add(AV.root);

  const remote = { x: 0, y: 0, z: 0, yaw: Math.PI, pitch: 0, slot: 0, alive: true, fire: false, name: '' };
  const disp = { x: 0, y: 0, z: 0, yaw: Math.PI, pitch: 0 };
  const prevPos = new THREE.Vector3();
  let haveState = false;
  let dispSpeed = 0, walkAmp = 0, walkPhase = Math.random() * 6.28, idleT = 0, markerT = 0;

  function applyRemote(state) {
    if (!state) return;
    const s = state;
    if (typeof s.x === 'number') remote.x = s.x;
    if (typeof s.y === 'number') remote.y = s.y;
    if (typeof s.z === 'number') remote.z = s.z;
    if (typeof s.yaw === 'number') remote.yaw = s.yaw;
    if (typeof s.pitch === 'number') remote.pitch = s.pitch;
    if (s.slot != null) remote.slot = s.slot;
    if (s.alive != null) remote.alive = !!s.alive;
    if (s.fire != null) remote.fire = !!s.fire;
    if (s.name != null) remote.name = String(s.name);
    if (!haveState) {
      // first packet: snap so we don't lerp in from the origin
      disp.x = remote.x; disp.y = remote.y; disp.z = remote.z;
      disp.yaw = remote.yaw; disp.pitch = remote.pitch;
      prevPos.set(remote.x, remote.y, remote.z);
      haveState = true;
    }
  }

  function update(dt) {
    if (!(dt > 0)) dt = 0.016;
    markerT += dt;

    const show = connected && remote.alive && haveState;
    if (AV.root.visible !== show) AV.root.visible = show;
    if (!show) return;

    // transform interpolation (position lerp ~12/s, yaw slerp shortest-path)
    const k = 1 - Math.exp(-12 * dt);
    disp.x += (remote.x - disp.x) * k;
    disp.y += (remote.y - disp.y) * k;
    disp.z += (remote.z - disp.z) * k;
    disp.yaw += wrapAngle(remote.yaw - disp.yaw) * k;
    disp.pitch += (remote.pitch - disp.pitch) * k;

    // velocity estimate (horizontal) → drives the walk cycle amplitude/rate
    const dx = disp.x - prevPos.x, dz = disp.z - prevPos.z;
    const inst = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
    dispSpeed += (inst - dispSpeed) * Math.min(1, 6 * dt);
    prevPos.set(disp.x, disp.y, disp.z);

    // place + orient (front is local +Z, so yaw + PI faces the look direction)
    AV.root.position.set(disp.x, disp.y, disp.z);
    AV.root.rotation.y = disp.yaw + Math.PI;
    AV.aim.rotation.x = -disp.pitch;               // rifle/arms pitch with the aim
    AV.headPiv.rotation.x = -disp.pitch * 0.45;    // head follows a little

    // walk cycle scaled by interpolated ground speed
    const moving = dispSpeed > 0.4;
    const targetAmp = moving ? clamp01(dispSpeed / 4.4) : 0;
    walkAmp += (targetAmp - walkAmp) * Math.min(1, 8 * dt);
    walkPhase += dt * (moving ? (5.5 + dispSpeed * 0.9) : 0);
    const swing = Math.sin(walkPhase) * 0.55 * walkAmp;
    AV.legL.hip.rotation.x = swing;
    AV.legR.hip.rotation.x = -swing;
    AV.legL.knee.rotation.x = Math.max(0, -swing) * 1.3 + 0.08 * walkAmp; // bend on back-swing
    AV.legR.knee.rotation.x = Math.max(0, swing) * 1.3 + 0.08 * walkAmp;

    // vertical bob (walk) + gentle idle breathing/sway
    idleT += dt;
    const bob = Math.sin(walkPhase * 2) * 0.03 * walkAmp;
    const breathe = Math.sin(idleT * 1.6) * 0.012 * (1 - walkAmp);
    AV.hips.position.y = HIP_H + bob + breathe;
    AV.torso.rotation.z = Math.sin(idleT * 1.05) * 0.02 * (1 - walkAmp) + swing * 0.06;
    AV.torso.rotation.x = 0.03 + 0.05 * walkAmp;   // slight forward lean while moving

    // team marker: slow bob + spin (self-updates even standing still)
    AV.marker.position.y = MARKER_Y + Math.sin(markerT * 2.2) * 0.06;
    AV.marker.rotation.y += dt * 1.1;
  }

  function remoteMuzzle() {
    if (!connected || !remote.alive || !haveState) return null;
    // force the world matrix up-to-date in case this is called before render;
    // return a FRESH vector so callers can retain it safely
    try { AV.muzzle.updateWorldMatrix(true, false); } catch (_) { return null; }
    return AV.muzzle.getWorldPosition(new THREE.Vector3());
  }

  // ---- send / subscribe ---------------------------------------------------
  function send(obj) {
    if (!connected || !conn) return;
    try { if (conn.open) conn.send(obj); } catch (_) { /* no-op on a dead channel */ }
  }
  function onStatus(fn) { statusFn = typeof fn === 'function' ? fn : null; }
  function onData(fn) { dataFn = typeof fn === 'function' ? fn : null; }

  function dispose() {
    if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
    joinSettled = true; joinResolve = null; joinReject = null;
    teardownPeer();
    try {
      scene.remove(AV.root);
      for (const g of AV.geoms) { try { g.dispose(); } catch (_) {} }
      for (const m of AV.mats) { try { m.dispose(); } catch (_) {} }
    } catch (_) {}
    setStatus('closed');
  }

  return {
    host,
    join,
    get connected() { return connected; },
    get isHost() { return isHost; },
    get status() { return status; },
    get code() { return currentCode; },
    onStatus,
    onData,
    send,
    applyRemote,
    update,
    remoteMuzzle,
    dispose,
  };
}

export default createNetplay;
