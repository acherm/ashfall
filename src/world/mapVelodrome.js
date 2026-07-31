// CallOfAcher — world/mapVelodrome.js
// Stade Vélodrome (Orange Vélodrome, Marseille). Fully procedural, EXPLORABLE:
// a 105x68 green pitch with painted markings + goals, a tiered seating BOWL
// (walkable stepped concrete) that curves into the Virage Nord / Virage Sud
// behind the goals, the iconic white wavy cantilever ROOF, corner floodlight
// pylons, a players' tunnel from the pitch into a concrete CONCOURSE corridor
// (couloirs) and two walk-in VESTIAIRES (locker rooms). Same createWorld(scene)
// contract as world/map.js so the game (player/enemies/weapons/civilians) is
// unchanged. Reuses makeTextures() for concrete/metal/dirt PBR sets.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeTextures } from './textures.js';

export function createWorld(scene) {
  const T = makeTextures();
  const root = new THREE.Group();
  root.name = 'velodrome';
  scene.add(root);

  const colliders = [];
  const raycastMeshes = [];
  const enemySpawns = [];
  const coverPoints = [];
  const updaters = [];
  let time = 0;

  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const rand = (() => { let s = 20130701; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
  const rr = (a, b) => a + rand() * (b - a);

  // ---- pitch metrics (metres). Length runs along Z, width along X. Goals at
  // z = ±PHZ, so the player facing -Z (yaw 0) looks straight down the pitch.
  const PHX = 34;      // half width  (68m)
  const PHZ = 52.5;    // half length (105m)

  // ---------------------------------------------------------------- helpers
  function cloneT(t, rx, ry) {
    const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c;
  }
  function stdMat(set, o = {}) {
    const rx = o.rx ?? 1, ry = o.ry ?? 1;
    const m = new THREE.MeshStandardMaterial({
      map: cloneT(set.map, rx, ry),
      normalMap: cloneT(set.normalMap, rx, ry),
      roughnessMap: cloneT(set.roughnessMap, rx, ry),
      color: o.color ?? 0xffffff, roughness: o.rough ?? 1.0, metalness: o.metal ?? 0.0,
    });
    m.normalScale.set(o.ns ?? 1, o.ns ?? 1);
    return m;
  }
  function addMesh(mesh, o = {}) {
    mesh.castShadow = o.cast ?? true;
    mesh.receiveShadow = o.recv ?? true;
    mesh.userData.surface = o.surface ?? 'concrete';
    root.add(mesh);
    if (o.ray ?? true) raycastMeshes.push(mesh);
    if (o.collide) { mesh.updateWorldMatrix(true, false); colliders.push(new THREE.Box3().setFromObject(mesh)); }
    return mesh;
  }
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  // conservative AABB collider for a Y-rotated box
  function obb(cx, cy, cz, hx, hy, hz, ry = 0) {
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    const ex = hx * c + hz * s, ez = hx * s + hz * c;
    colliders.push(new THREE.Box3(V3(cx - ex, cy - hy, cz - ez), V3(cx + ex, cy + hy, cz + ez)));
  }
  // geometry factory for merge bins: unit box transformed into world space
  const _mtx = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _pv = new THREE.Vector3(), _sv = new THREE.Vector3();
  function boxGeo(w, h, d, x, y, z, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    _e.set(0, ry, 0); _q.setFromEuler(_e);
    _mtx.compose(_pv.set(x, y, z), _q, _sv.set(1, 1, 1));
    return g.applyMatrix4(_mtx);
  }

  // ---------------------------------------------------------------- materials
  const M = {
    grassApron: stdMat(T.dirt, { rx: 60, ry: 60, color: 0x6f7a5c, ns: 1.1 }),
    concrete: stdMat(T.concrete, { rx: 3, ry: 3, color: 0xbfbcb4 }),
    concStruct: stdMat(T.concrete, { rx: 4, ry: 2, color: 0xb4b1a8 }),
    concDark: stdMat(T.concrete, { rx: 2, ry: 2, color: 0x8f8d86 }),
    tile: stdMat(T.concrete, { rx: 8, ry: 8, color: 0xcfd3d2 }),
    metal: stdMat(T.metal, { rx: 2, ry: 1, rough: 0.55, metal: 0.6, color: 0x9aa1a6 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xb9c0c6, roughness: 0.45, metalness: 0.7 }),
    roof: new THREE.MeshStandardMaterial({
      color: 0xeef2f6, roughness: 0.62, metalness: 0.08, side: THREE.DoubleSide,
      emissive: 0x8792a0, emissiveIntensity: 0.22,
    }),
    postWhite: new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.4, metalness: 0.1 }),
    net: new THREE.MeshStandardMaterial({
      color: 0xdfe4e8, roughness: 0.9, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false,
    }),
    dark: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.35, metalness: 0.4, emissive: 0x0a1018, emissiveIntensity: 0.5 }),
    lockerA: new THREE.MeshStandardMaterial({ color: 0x2f6a8c, roughness: 0.5, metalness: 0.45 }),
    lockerB: new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.5, metalness: 0.4 }),
    bench: stdMat(T.wood, { rx: 2, ry: 1, color: 0xb9ad92 }),
    strip: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0xfff4d8, emissiveIntensity: 1.1, roughness: 1 }),
    board: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x223a2a, emissiveIntensity: 0.6, roughness: 1 }),
  };
  // floodlight lamp banks (emissive; flicker in update)
  const floodMat = new THREE.MeshStandardMaterial({ color: 0x101418, emissive: 0xfff6e0, emissiveIntensity: 1.7, roughness: 0.6 });
  const floodMats = [];

  // ---------------------------------------------------------------- fog + sky
  // bright daytime; thin fog so the far stands read but the bowl still has depth
  scene.fog = new THREE.FogExp2(0xcdd9e4, 0.006);
  scene.background = new THREE.Color(0xbcd0e2);

  const sunDir = V3(-0.34, -0.87, -0.36).normalize(); // FROM sun TO scene (high, raking)
  const sunPosDir = sunDir.clone().negate();

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uSun: { value: sunPosDir },
      uZenith: { value: new THREE.Color(0x3f74b0) },
      uMid: { value: new THREE.Color(0x87b0d8) },
      uHorizon: { value: new THREE.Color(0xd4e2ee) },
      uWarm: { value: new THREE.Color(0xfff3d8) },
      uGround: { value: new THREE.Color(0xbfcbd6) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uZenith, uMid, uHorizon, uWarm, uGround; varying vec3 vDir;
      float vhash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(vhash(i),vhash(i+vec2(1,0)),u.x), mix(vhash(i+vec2(0,1)),vhash(i+vec2(1,1)),u.x), u.y); }
      float cfbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<3;i++){ v+=a*vnoise(p); p=p*2.03+17.17; a*=0.5; } return v; }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.14, h));
        col = mix(col, uZenith, smoothstep(0.12, 0.62, h));
        vec3 sunFlat = normalize(vec3(uSun.x,0.0,uSun.z));
        vec3 dFlat = normalize(vec3(d.x,0.001,d.z));
        float az = dot(dFlat,sunFlat)*0.5+0.5;
        float low = 1.0 - smoothstep(0.0,0.3,abs(h));
        col = mix(col, uWarm, az*az*low*0.28);
        // thin fair-weather cloud sheet
        vec2 cp = d.xz/max(d.y,0.09);
        float cl = cfbm(cp*1.0+vec2(4.0,2.0))*0.7 + cfbm(cp*2.7+vec2(9.0,1.0))*0.3;
        float cmask = smoothstep(0.06,0.16,h)*(1.0-smoothstep(0.4,0.6,h));
        float ca = smoothstep(0.56,0.7,cl)*cmask*0.5;
        col = mix(col, vec3(1.0), ca);
        float sd = dot(d,uSun);
        col += uWarm * pow(max(sd,0.0),8.0)*0.18;
        col += vec3(1.0,0.94,0.82)*pow(max(sd,0.0),200.0)*0.9;
        col += vec3(1.5,1.4,1.2)*smoothstep(0.9994,0.9997,sd);
        col = mix(col, uGround, smoothstep(-0.02,-0.22,h));
        gl_FragColor = vec4(col,1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(360, 40, 24), skyMat);
  sky.frustumCulled = false;
  root.add(sky);

  // ---------------------------------------------------------------- lights
  const sun = new THREE.DirectionalLight(0xfff1d8, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const HALF = 72;
  sun.shadow.camera.left = -HALF; sun.shadow.camera.right = HALF;
  sun.shadow.camera.top = HALF; sun.shadow.camera.bottom = -HALF;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  root.add(sun); root.add(sun.target);

  const SUN_DIST = 150;
  const TEXEL = (HALF * 2) / 2048;
  const snapRight = V3(0, 1, 0).cross(sunDir).normalize();
  const snapUp = sunDir.clone().cross(snapRight).normalize();
  const _snap = new THREE.Vector3();
  function recenterSun(p) {
    _snap.set(p.x, 0, p.z);
    const cr = _snap.dot(snapRight), cu = _snap.dot(snapUp);
    _snap.addScaledVector(snapRight, Math.round(cr / TEXEL) * TEXEL - cr);
    _snap.addScaledVector(snapUp, Math.round(cu / TEXEL) * TEXEL - cu);
    sun.target.position.copy(_snap);
    sun.position.copy(_snap).addScaledVector(sunDir, -SUN_DIST);
    sun.target.updateMatrixWorld();
  }
  recenterSun(V3(0, 0, 0));

  const hemi = new THREE.HemisphereLight(0xa9c4dd, 0x6a6f5e, 1.35);
  root.add(hemi);
  const skyFill = new THREE.DirectionalLight(0x9fb6cc, 0.32);
  skyFill.castShadow = false;
  skyFill.position.set(0.34, 0.6, 0.36).multiplyScalar(80);
  root.add(skyFill); root.add(skyFill.target);

  // interior lights (<=3 real PointLights total): corridor + both vestiaires
  function ptLight(x, y, z, color, intensity, range) {
    const l = new THREE.PointLight(color, intensity, range, 2);
    l.position.set(x, y, z); l.castShadow = false; root.add(l); return l;
  }
  ptLight(-52, 2.7, 0, 0xfff2d6, 9, 15);     // corridor
  ptLight(-59, 2.6, 13, 0xfff2d6, 7, 12);    // home vestiaire
  ptLight(-59, 2.6, -13, 0xfff2d6, 7, 12);   // away vestiaire

  // ---------------------------------------------------------------- ground apron
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), M.grassApron);
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02;
  addMesh(apron, { collide: false, cast: false, surface: 'dirt' });
  colliders.push(new THREE.Box3(V3(-260, -2, -260), V3(260, 0, 260))); // floor plane

  // concrete esplanade ring outside the stands (so elevated views read solid)
  const espl = new THREE.Mesh(new THREE.PlaneGeometry(180, 210), stdMat(T.concrete, { rx: 40, ry: 46, color: 0x9a9791 }));
  espl.rotation.x = -Math.PI / 2; espl.position.y = -0.01;
  addMesh(espl, { collide: false, cast: false });

  // ---------------------------------------------------------------- the pitch
  function makePitchTex() {
    const k = 20; // px per metre
    const RX0 = -39, RZ0 = -60, RW = 78, RH = 120;
    const W = RW * k, H = RH * k;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const X = (wx) => (wx - RX0) * k, Z = (wz) => (wz - RZ0) * k;
    // base + mowing stripes (bands along Z)
    g.fillStyle = '#396e30'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 20; i++) {
      const z0 = -60 + i * 6;
      g.fillStyle = (i % 2) ? '#3c7433' : '#34682c';
      g.fillRect(0, Z(z0), W, 6 * k + 1);
    }
    // subtle wear blotches
    for (let i = 0; i < 900; i++) {
      const x = rand() * W, y = rand() * H, r = rr(6, 34);
      g.fillStyle = `rgba(${rand() < 0.5 ? '30,58,26' : '70,108,58'},${rr(0.03, 0.1)})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // white markings
    g.strokeStyle = 'rgba(236,240,236,0.92)'; g.fillStyle = 'rgba(236,240,236,0.92)';
    g.lineWidth = 0.14 * k;
    const line = (x0, z0, x1, z1) => { g.beginPath(); g.moveTo(X(x0), Z(z0)); g.lineTo(X(x1), Z(z1)); g.stroke(); };
    const rect = (x0, z0, x1, z1) => { line(x0, z0, x1, z0); line(x1, z0, x1, z1); line(x1, z1, x0, z1); line(x0, z1, x0, z0); };
    const spot = (x, z) => { g.beginPath(); g.arc(X(x), Z(z), 0.18 * k, 0, 7); g.fill(); };
    const arc = (x, z, r, a0, a1) => { g.beginPath(); g.arc(X(x), Z(z), r * k, a0, a1); g.stroke(); };
    rect(-PHX, -PHZ, PHX, PHZ);       // touchlines + goal lines
    line(-PHX, 0, PHX, 0);            // halfway line
    arc(0, 0, 9.15, 0, 7);            // centre circle
    spot(0, 0);                       // centre spot
    for (const s of [1, -1]) {        // both ends
      const gl = s * PHZ;
      rect(-20.16, gl, 20.16, gl - s * 16.5);   // penalty area
      rect(-9.16, gl, 9.16, gl - s * 5.5);      // goal area
      spot(0, gl - s * 11);                     // penalty spot
      // penalty arc (only the part outside the box)
      const pAy = gl - s * 11;
      if (s > 0) arc(0, pAy, 9.15, Math.PI * 0.68, Math.PI * 1.32);
      else arc(0, pAy, 9.15, Math.PI * -0.32, Math.PI * 0.32);
      // corner arcs
      for (const cx of [-PHX, PHX]) arc(cx, gl, 1, 0, 7);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
    return tex;
  }
  const pitchMat = new THREE.MeshStandardMaterial({ map: makePitchTex(), roughness: 0.92, color: 0xffffff });
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(78, 120), pitchMat);
  pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0.015;
  addMesh(pitch, { collide: false, cast: false, surface: 'dirt' });
  // solid pitch floor collider (thin) — the apron floor already backs it
  colliders.push(new THREE.Box3(V3(-39, -1, -60), V3(39, 0.015, 60)));

  // ---------------------------------------------------------------- goals + flags
  const goalMeshes = [];
  function goal(zEnd, dir) { // dir = +1 posts toward -Z net, etc. (net faces pitch)
    const gw = 7.32, gh = 2.44, r = 0.12;
    const g = new THREE.Group();
    const postGeo = new THREE.CylinderGeometry(r, r, gh, 10);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, M.postWhite);
      p.position.set(s * gw / 2, gh / 2, 0); g.add(p);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, gw + r * 2, 10), M.postWhite);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, gh, 0); g.add(bar);
    // net: back plane + top plane, sloping away from pitch
    const depth = 1.9;
    const backNet = box(gw, gh, 0.02, M.net); backNet.position.set(0, gh / 2, dir * depth); g.add(backNet);
    const topNet = box(gw, 0.02, depth, M.net); topNet.position.set(0, gh, dir * depth / 2); g.add(topNet);
    for (const s of [-1, 1]) { const sn = box(0.02, gh, depth, M.net); sn.position.set(s * gw / 2, gh / 2, dir * depth / 2); g.add(sn); }
    g.position.set(0, 0, zEnd);
    for (const m of g.children) { m.castShadow = true; m.receiveShadow = false; m.userData.surface = 'metal'; raycastMeshes.push(m); }
    root.add(g);
    // thin post colliders
    for (const s of [-1, 1]) obb(s * gw / 2, gh / 2, zEnd, r + 0.04, gh / 2, r + 0.04, 0);
    goalMeshes.push(g);
  }
  goal(PHZ, 1); goal(-PHZ, -1);

  const flags = [];
  function cornerFlag(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), M.postWhite);
    pole.position.set(x, 0.75, z); addMesh(pole, { collide: false, cast: true, surface: 'metal' });
    const flag = box(0.4, 0.28, 0.02, new THREE.MeshStandardMaterial({ color: 0xd23a3a, roughness: 0.8, side: THREE.DoubleSide }));
    flag.position.set(x + 0.2 * Math.sign(x || 1), 1.32, z);
    addMesh(flag, { collide: false, cast: true, surface: 'concrete' });
    flags.push({ flag, x0: flag.position.x, ph: rand() * 6 });
  }
  for (const s of [-1, 1]) for (const t of [-1, 1]) cornerFlag(s * PHX, t * PHZ);

  // ---------------------------------------------------------------- the BOWL
  // Oval ring of straight stepped mini-stands. Each tier is a solid concrete
  // block from the ground to its tread top → the front faces form a staircase
  // the 0.55m auto-step climbs. Seats are one InstancedMesh (per-instance
  // colour: pale white with sky-blue accent bands, bluer in the virages).
  const tierGeos = [];      // merged → one concrete mesh
  const railGeos = [];      // merged → one metal mesh
  const MAXSEATS = 22000;
  // seat = pan + back (back faces outward so occupants face the pitch)
  const seatGeo = mergeGeometries([
    new THREE.BoxGeometry(0.44, 0.07, 0.40).translate(0, 0.035, -0.03),
    new THREE.BoxGeometry(0.44, 0.40, 0.07).translate(0, 0.22, 0.18),
  ], false);
  const seatMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.0, emissive: 0x101820, emissiveIntensity: 0.0 });
  const seats = new THREE.InstancedMesh(seatGeo, seatMat, MAXSEATS);
  seats.count = 0; seats.castShadow = false; seats.receiveShadow = true;
  seats.userData.surface = 'concrete';
  root.add(seats); raycastMeshes.push(seats);
  const _seatC = new THREE.Color();
  let cseed = 7777; const cr01 = () => { cseed = (cseed * 16807) % 2147483647; return (cseed - 1) / 2147483646; };

  const hoardDefs = []; // pitchside advertising boards (instanced, blank colours)

  function buildSegment(cx, cz, outAngle, length, nTiers, rise, run, isVirage) {
    const oc = Math.cos(outAngle), os = Math.sin(outAngle); // outward = (os,0,oc)? -> use (sin,cos)
    const ox = Math.sin(outAngle), oz = Math.cos(outAngle); // outward
    const ax = Math.cos(outAngle), az = -Math.sin(outAngle); // along
    for (let i = 0; i < nTiers; i++) {
      const outD = (i + 0.5) * run;
      const topH = (i + 1) * rise;
      const bx = cx + ox * outD, bz = cz + oz * outD;
      tierGeos.push(boxGeo(length, topH, run, bx, topH / 2, bz, outAngle));
      obb(bx, topH / 2, bz, length / 2, topH / 2, run / 2, outAngle);
      // seats on the tread (near the back so there's foot room ahead)
      const sy = topH + 0.02;
      const sOut = (i + 0.72) * run;
      const sx = cx + ox * sOut, sz = cz + oz * sOut;
      const nSeat = Math.max(2, Math.floor(length / 0.56));
      const blue = isVirage ? (i % 3 === 0) : (i === 3 || i === 4 || i === 9 || i === 10);
      for (let s = 0; s < nSeat; s++) {
        if (seats.count >= MAXSEATS) break;
        const al = -length / 2 + 0.3 + s * (length - 0.6) / Math.max(1, nSeat - 1);
        const px = sx + ax * al, pz = sz + az * al;
        _e.set(0, outAngle, 0); _q.setFromEuler(_e);
        _mtx.compose(_pv.set(px, sy, pz), _q, _sv.set(1, 1, 1));
        seats.setMatrixAt(seats.count, _mtx);
        let R2 = 0.86, G = 0.87, B = 0.85;
        if (blue) { R2 = 0.28; G = 0.47; B = 0.72; }
        const jit = cr01();
        if (jit < 0.05) { R2 = 0.22; G = 0.22; B = 0.24; }        // dark/empty
        else if (jit > 0.97 && !blue) { R2 = 0.30; G = 0.50; B = 0.74; } // stray blue
        const v = 0.88 + cr01() * 0.16;
        _seatC.setRGB(R2 * v, G * v, B * v);
        seats.setColorAt(seats.count, _seatC);
        seats.count++;
      }
      // front railing along the very first tier (pitch-side cover)
      if (i === 0) {
        const rx = cx + ox * 0.04, rz = cz + oz * 0.04;
        railGeos.push(boxGeo(length, 0.06, 0.05, rx, 1.02, rz, outAngle));
        for (let p = 0; p <= 4; p++) {
          const al = -length / 2 + p * length / 4;
          railGeos.push(boxGeo(0.05, 1.02, 0.05, rx + ax * al, 0.51, rz + az * al, outAngle));
        }
        // advertising hoarding on the tier-0 riser (blank colour, no collider)
        hoardDefs.push([cx + ox * -0.02, 0.42, cz + oz * -0.02, length, outAngle, isVirage]);
      }
    }
    return { topH: nTiers * rise, outD: nTiers * run };
  }

  const mastGeos = [];   // roof support masts (box: position+normal+uv)

  // build the oval bowl: long sides + curved virages behind the goals
  const A0 = 36.5, B0 = 56.5;   // inner (front) oval semi-axes
  const MSEG = 30;
  const standInfo = [];
  for (let m = 0; m < MSEG; m++) {
    const alpha = (m / MSEG) * Math.PI * 2;
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const fx = A0 * ca, fz = B0 * sa;
    let nx = ca / A0, nz = sa / B0; const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
    const outAngle = Math.atan2(nx, nz);
    const an = ((m + 1) / MSEG) * Math.PI * 2;
    const segLen = Math.hypot(A0 * Math.cos(an) - fx, B0 * Math.sin(an) - fz) + 1.8;
    const isVirage = Math.abs(sa) > 0.6;
    // TUNNEL / vomitory gap on the west side (α≈π → x≈-36, z≈0)
    const west = ca < -0.985;
    const nTiers = isVirage ? 16 : 13;
    const rise = isVirage ? 0.35 : 0.34;
    const run = isVirage ? 0.80 : 0.90;
    let info = { topH: nTiers * rise, outD: nTiers * run };
    if (!west) info = buildSegment(fx, fz, outAngle, segLen, nTiers, rise, run, isVirage);
    standInfo.push({ fx, fz, outAngle, alpha, west, info });
  }
  if (tierGeos.length) addMesh(new THREE.Mesh(mergeGeometries(tierGeos, false), M.concStruct), { collide: false, surface: 'concrete' });
  if (railGeos.length) addMesh(new THREE.Mesh(mergeGeometries(railGeos, false), M.rail), { collide: false, surface: 'metal', cast: false });

  // ---- continuous white wavy cantilever ROOF (one closed scalloped ring) ----
  {
    const NS = 6;
    const ring = [];
    for (let m = 0; m < MSEG; m++) {
      const S = standInfo[m];
      const ox = Math.sin(S.outAngle), oz = Math.cos(S.outAngle);
      const standTop = S.info.topH, standOut = S.info.outD;
      const oR = standOut + 2.2, oF = -3.2;
      const P0o = oR, P0h = standTop + 3.8;
      const P1o = standOut * 0.42, P1h = standTop + 13.2;
      const P2o = oF, P2h = standTop + 10.4;
      const row = [];
      for (let s = 0; s < NS; s++) {
        const u = s / (NS - 1), iu = 1 - u;
        const oo = iu * iu * P0o + 2 * iu * u * P1o + u * u * P2o;
        let hy = iu * iu * P0h + 2 * iu * u * P1h + u * u * P2h;
        hy += Math.sin(S.alpha * 8) * 1.4 * u * u;   // wavy leading edge, continuous
        row.push([S.fx + ox * oo, hy, S.fz + oz * oo]);
      }
      ring.push(row);
    }
    const verts = [], idx = []; let vi = 0;
    for (let m = 0; m < MSEG; m++) {
      const a = ring[m], b = ring[(m + 1) % MSEG];
      for (let s = 0; s < NS - 1; s++) {
        verts.push(...a[s], ...a[s + 1], ...b[s], ...b[s + 1]);
        idx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3); vi += 4;
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    rg.setIndex(idx); rg.computeVertexNormals();
    addMesh(new THREE.Mesh(rg, M.roof), { collide: false, surface: 'metal', recv: false });
    // support masts every other segment
    for (let m = 0; m < MSEG; m += 2) {
      const S = standInfo[m];
      const ox = Math.sin(S.outAngle), oz = Math.cos(S.outAngle);
      const oR = S.info.outD + 2.2, mh = S.info.topH + 3.8;
      mastGeos.push(boxGeo(0.4, mh, 0.4, S.fx + ox * oR, mh / 2, S.fz + oz * oR, S.outAngle));
    }
    if (mastGeos.length) addMesh(new THREE.Mesh(mergeGeometries(mastGeos, false), M.roof), { collide: false, surface: 'metal', recv: false });
  }
  seats.instanceMatrix.needsUpdate = true;
  if (seats.instanceColor) seats.instanceColor.needsUpdate = true;
  seats.computeBoundingSphere();

  // pitchside advertising hoardings (blank colour bands — NO logos), instanced
  {
    const hg = new THREE.BoxGeometry(1, 1, 1);
    const him = new THREE.InstancedMesh(hg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), hoardDefs.length + 2);
    him.castShadow = false; him.receiveShadow = true; him.userData.surface = 'concrete';
    const cols = [0xdedee0, 0x2f6f9e, 0xe4e6e8, 0x3a7ba8, 0xcfd2d4];
    const cc = new THREE.Color();
    hoardDefs.forEach((d, i) => {
      _e.set(0, d[4], 0); _q.setFromEuler(_e);
      _mtx.compose(_pv.set(d[0], d[1], d[2]), _q, _sv.set(d[3] * 0.98, 0.5, 0.08));
      him.setMatrixAt(i, _mtx);
      him.setColorAt(i, cc.setHex(cols[i % cols.length]));
    });
    him.count = hoardDefs.length;
    him.instanceMatrix.needsUpdate = true; if (him.instanceColor) him.instanceColor.needsUpdate = true;
    him.computeBoundingSphere();
    root.add(him); raycastMeshes.push(him);
  }

  // ---------------------------------------------------------------- floodlight pylons
  function pylon(x, z) {
    const g = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 30, 8), M.metal);
    mast.position.y = 15; g.add(mast);
    // lamp bank tilted toward the pitch centre
    const toC = Math.atan2(-x, -z);
    const bank = box(6.5, 3.0, 0.5, floodMat.clone());
    bank.position.set(0, 30, 0); bank.rotation.y = toC; bank.rotation.x = 0.5;
    floodMats.push(bank.material);
    g.add(bank);
    // lamp cells (dark grid over the emissive panel)
    g.position.set(x, 0, z);
    for (const m of g.children) { m.castShadow = true; m.receiveShadow = false; m.userData.surface = 'metal'; raycastMeshes.push(m); }
    root.add(g);
    obb(x, 8, z, 0.7, 8, 0.7, 0);
  }
  for (const s of [-1, 1]) for (const t of [-1, 1]) pylon(s * 46, t * 66);

  // big screen high on the North virage (dark, non-emissive)
  {
    const frame = box(11, 6.4, 0.6, M.dark); frame.position.set(0, 15, 64);
    addMesh(frame, { collide: false, surface: 'metal' });
    const scr = box(10, 5.4, 0.2, M.screen); scr.position.set(0, 15, 63.6);
    addMesh(scr, { collide: false, surface: 'metal' });
    for (const s of [-1, 1]) { const leg = box(0.6, 15, 0.6, M.metal); leg.position.set(s * 4, 7.5, 65); addMesh(leg, { collide: false, surface: 'metal' }); obb(s * 4, 7.5, 65, 0.35, 7.5, 0.35, 0); }
  }

  // pitchside dugouts (two covered benches near the tunnel, west midfield)
  function dugout(z) {
    const roof = box(5, 0.15, 1.8, M.dark); roof.position.set(-35.4, 1.7, z); roof.rotation.z = -0.12;
    addMesh(roof, { collide: false, surface: 'metal' });
    const seat = box(4.6, 0.5, 0.5, M.bench); seat.position.set(-35.2, 0.5, z + 0.4);
    addMesh(seat, { collide: false, surface: 'concrete' }); obb(-35.2, 0.5, z + 0.4, 2.3, 0.5, 0.35, 0);
    for (const s of [-1, 1]) { const post = box(0.12, 1.7, 0.12, M.metal); post.position.set(-33.4, 0.85, z + s * 0.85); addMesh(post, { collide: false, surface: 'metal' }); }
  }
  dugout(6); dugout(-6);

  // ---------------------------------------------------------------- players' tunnel
  // covered passage from the pitch (west touchline, midfield) through the bowl
  // gap out to the concourse corridor behind the stand.
  function wall(x, y, z, w, h, d, mat, surface) {
    const m = box(w, h, d, mat || M.concrete); m.position.set(x, y, z);
    addMesh(m, { collide: true, surface: surface || 'concrete' }); return m;
  }
  const TUN_Z = 2.1;   // half-width of the tunnel (4.2m)
  const TUN_X0 = -50, TUN_X1 = -34; // spans from corridor front to pitch edge
  const TCX = (TUN_X0 + TUN_X1) / 2, TLEN = TUN_X1 - TUN_X0;
  wall(TCX, 1.5, TUN_Z + 0.2, TLEN, 3.0, 0.4, M.concDark);   // north wall
  wall(TCX, 1.5, -TUN_Z - 0.2, TLEN, 3.0, 0.4, M.concDark);  // south wall
  { const ceil = box(TLEN, 0.3, TUN_Z * 2 + 0.8, M.concDark); ceil.position.set(TCX, 3.1, 0); addMesh(ceil, { collide: true, surface: 'concrete', recv: false }); }
  { // tunnel-mouth header at the pitch side (dark opening framed by concrete)
    const head = box(0.6, 1.2, TUN_Z * 2 + 1.6, M.concStruct); head.position.set(TUN_X1 - 0.2, 3.5, 0); addMesh(head, { collide: false }); obb(TUN_X1 - 0.2, 3.5, 0, 0.3, 1.2, TUN_Z + 0.8, 0); }
  { const floorT = box(TLEN, 0.04, TUN_Z * 2, M.tile); floorT.position.set(TCX, 0.03, 0); addMesh(floorT, { collide: false, cast: false, surface: 'concrete' }); }

  // ---------------------------------------------------------------- concourse corridor
  const COR_X0 = -54, COR_X1 = -50, COR_CX = -52;
  const COR_Z0 = -30, COR_Z1 = 30, COR_H = 3.3;
  { const f = box(4, 0.04, 60, M.concrete); f.position.set(COR_CX, 0.03, 0); addMesh(f, { collide: false, cast: false }); }
  // front wall (pitch side) with the tunnel opening at z∈[-TUN_Z,TUN_Z]
  { const s0 = COR_Z0, s1 = -TUN_Z; wall(COR_X1, COR_H / 2, (s0 + s1) / 2, 0.3, COR_H, s1 - s0); }
  { const s0 = TUN_Z, s1 = COR_Z1; wall(COR_X1, COR_H / 2, (s0 + s1) / 2, 0.3, COR_H, s1 - s0); }
  // back wall with two vestiaire door openings at z∈[8,14] and [-14,-8]
  const backSegs = [[-30, -14], [-8, 8], [14, 30]];
  for (const [s0, s1] of backSegs) wall(COR_X0, COR_H / 2, (s0 + s1) / 2, 0.3, COR_H, s1 - s0);
  wall(COR_CX, COR_H / 2, COR_Z0, 4, COR_H, 0.3);  // south end
  wall(COR_CX, COR_H / 2, COR_Z1, 4, COR_H, 0.3);  // north end
  { const ceil = box(4.2, 0.25, 60, M.concDark); ceil.position.set(COR_CX, COR_H, 0); addMesh(ceil, { collide: true, surface: 'concrete', recv: false }); }
  // strip lights + dressing (pipes/doors) along the corridor
  for (let z = COR_Z0 + 5; z < COR_Z1; z += 9) {
    const strip = box(0.3, 0.06, 3.2, M.strip); strip.position.set(COR_CX, COR_H - 0.2, z); addMesh(strip, { collide: false, cast: false, surface: 'metal' });
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 60, 8), M.metal); // once
    if (z === COR_Z0 + 5) { pipe.rotation.x = Math.PI / 2; pipe.position.set(COR_X0 + 0.25, COR_H - 0.5, 0); addMesh(pipe, { collide: false, surface: 'metal' }); }
    const door = box(0.08, 2.1, 1.0, M.dark); door.position.set(COR_X1 - 0.2, 1.05, z + 3); addMesh(door, { collide: false, surface: 'metal' });
  }

  // ---------------------------------------------------------------- vestiaires
  function vestiaire(zc, home) {
    const X0 = -64, X1 = -54, Z0 = zc - 7, Z1 = zc + 7, H = 3.0;
    const cx = (X0 + X1) / 2;
    // tiled floor
    const f = box(10, 0.05, 14, M.tile); f.position.set(cx, 0.04, zc); addMesh(f, { collide: false, cast: false, surface: 'concrete' });
    // walls (front wall has the door gap toward the corridor at z∈[zc-3,zc+3])
    wall(X0, H / 2, zc, 0.3, H, 14, M.concrete);          // back
    wall(cx, H / 2, Z0, 10, H, 0.3, M.concrete);          // south
    wall(cx, H / 2, Z1, 10, H, 0.3, M.concrete);          // north
    for (const [s0, s1] of [[zc - 7, zc - 3], [zc + 3, zc + 7]]) wall(X1, H / 2, (s0 + s1) / 2, 0.3, H, s1 - s0, M.concrete); // front w/ door
    { const ceil = box(10, 0.2, 14, M.concDark); ceil.position.set(cx, H, zc); addMesh(ceil, { collide: true, surface: 'concrete', recv: false }); }
    // ceiling strip light
    const strip = box(4, 0.06, 0.3, M.strip); strip.position.set(cx, H - 0.15, zc); addMesh(strip, { collide: false, cast: false, surface: 'metal' });
    // locker banks along the back wall
    const lmat = home ? M.lockerA : M.lockerB;
    for (let i = 0; i < 6; i++) {
      const lz = zc - 5 + i * 2;
      const l = box(0.9, 2.0, 1.4, lmat); l.position.set(X0 + 0.8, 1.0, lz); addMesh(l, { collide: true, surface: 'metal' });
    }
    // bench in front of lockers
    const b = box(0.4, 0.45, 11, M.bench); b.position.set(X0 + 2.0, 0.45, zc); addMesh(b, { collide: true, surface: 'concrete' });
    // tactics board on the south wall
    const board = box(0.06, 1.2, 2.0, M.board); board.position.set(cx, 1.7, Z0 + 0.25); addMesh(board, { collide: false, surface: 'concrete' });
  }
  vestiaire(13, true); vestiaire(-13, false);

  // ---------------------------------------------------------------- boundary walls
  function invisWall(cx, cz, hx, hz) { colliders.push(new THREE.Box3(V3(cx - hx, -2, cz - hz), V3(cx + hx, 40, cz + hz))); }
  invisWall(0, 78, 90, 2); invisWall(0, -78, 90, 2);
  invisWall(70, 0, 2, 90); invisWall(-70, 0, 2, 90);

  // ---------------------------------------------------------------- spawns + cover
  enemySpawns.push(
    // pitch
    V3(0, 0, 0), V3(-15, 0, 20), V3(15, 0, -18), V3(-20, 0, -30), V3(20, 0, 28),
    V3(0, 0, -38), V3(10, 0, 10), V3(-10, 0, -10),
    // stand fronts (base of the bowl, both long sides + virages)
    V3(-33, 0, 12), V3(-33, 0, -14), V3(33, 0, 14), V3(33, 0, -8),
    V3(12, 0, 50), V3(-12, 0, -50),
    // tunnel mouth + corridor
    V3(-40, 0, 0), V3(-52, 0, 16), V3(-52, 0, -16), V3(-52, 0, 0),
  );
  coverPoints.push(
    // behind the pitchside railings / stand fronts
    V3(-33, 0, 8), V3(-33, 0, -10), V3(33, 0, 8), V3(33, 0, -10),
    V3(0, 0, 49), V3(0, 0, -49), V3(16, 0, 46), V3(-16, 0, -46),
    // pitch cover (centre circle, boxes, spots)
    V3(0, 0, 9), V3(0, 0, -9), V3(9, 0, 0), V3(-9, 0, 0),
    V3(0, 0, 40), V3(0, 0, -40), V3(15, 0, 25), V3(-15, 0, -25),
    // tunnel / corridor / vestiaire doorways
    V3(-42, 0, 0), V3(-51, 0, 26), V3(-51, 0, -26), V3(-53, 0, 0),
    V3(-54, 0, 13), V3(-54, 0, -13), V3(20, 0, -30), V3(-20, 0, 30),
  );

  // ---------------------------------------------------------------- walk paths
  const WP = (pts) => pts.map((p) => V3(p[0], 0, p[1]));
  const walkPaths = [
    WP([[-22, 22], [22, 22], [22, -22], [-22, -22]]),                       // pitch centre loop
    WP([[0, 40], [26, 20], [26, -20], [0, -40], [-26, -20], [-26, 20]]),    // pitch perimeter jog
    WP([[-51.4, 26], [-52.6, 26], [-52.6, -26], [-51.4, -26]]),             // corridor patrol
  ];

  // ---------------------------------------------------------------- animation
  updaters.push((dt) => {
    // floodlight flicker (subtle, it's daytime)
    for (let i = 0; i < floodMats.length; i++) {
      floodMats[i].emissiveIntensity = 1.7 + Math.sin(time * (7 + i) + i * 1.7) * 0.12;
    }
    // corner flags flutter
    for (const f of flags) {
      f.flag.rotation.y = Math.sin(time * 3 + f.ph) * 0.5;
      f.flag.rotation.z = Math.sin(time * 4.3 + f.ph) * 0.12;
    }
    // faint crowd shimmer across the seating
    seatMat.emissiveIntensity = 0.05 + Math.sin(time * 1.3) * 0.03;
  });

  // ---------------------------------------------------------------- api
  const _lastP = V3(0, 0, 44);
  const api = {
    colliders, raycastMeshes, enemySpawns, coverPoints, walkPaths, sunDir,
    playerSpawn: V3(0, 0, 44),   // feet, on the pitch near the +Z goal
    playerSpawnYaw: 0,           // yaw 0 faces -Z → looks straight down the pitch
    bins: [],
    squishAt() {},
    update(dt, playerPos) {
      time += dt;
      if (playerPos) {
        recenterSun(playerPos);
        _lastP.copy(playerPos);
        sky.position.set(playerPos.x, 0, playerPos.z);
      }
      for (let i = 0; i < updaters.length; i++) updaters[i](dt);
    },
  };
  if (typeof window !== 'undefined' && window.__SHOT_MODE__) window.__world = api;
  return api;
}
