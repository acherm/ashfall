// CallOfAcher — world/mapGandy.js
// "Vallée de Gandy / chemin de la vallée" near Draguignan (Var, Provence).
// A limestone GORGE trail: a winding dirt/rock path spine along Z flanked by
// stepped-strata limestone cliffs, the shallow Nartuby stream running alongside,
// garrigue vegetation (Aleppo pine / oak / scrub / dry grass / rosemary),
// scattered boulders, a dry-stone wall, a ruined bergerie, a wooden signpost and
// a little stone footbridge. Fully procedural, same createWorld(scene) contract
// as world/map.js so player/enemies/weapons/civilians run unchanged.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeTextures } from './textures.js';

export function createWorld(scene) {
  const T = makeTextures();
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  const colliders = [];
  const raycastMeshes = [];
  const enemySpawns = [];
  const coverPoints = [];
  let time = 0;

  // ------------------------------------------------------------- helpers
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const HPI = Math.PI / 2;
  const rand = (() => { let s = 20240726; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
  const rr = (a, b) => a + rand() * (b - a);
  const _lastP = new THREE.Vector3(0, 0, 30);

  // WINDING TRAIL centerline x = f(z). Gentle Provençal meander; amplitude kept
  // small (~±5m) so the whole playable spine reads as one canyon and the
  // screenshot scenarios (which drop the player at fixed x near 0..5) stay on it.
  const TRAIL = (z) => 3.4 * Math.sin(z * 0.031) + 1.7 * Math.sin(z * 0.083 + 0.7);

  function cloneT(t, rx, ry, rot) {
    const c = t.clone();
    c.repeat.set(rx, ry);
    if (rot) { c.rotation = rot; c.center.set(0.5, 0.5); }
    c.needsUpdate = true;
    return c;
  }
  function stdMat(set, o = {}) {
    const rx = o.rx ?? 1, ry = o.ry ?? 1;
    const m = new THREE.MeshStandardMaterial({
      map: cloneT(set.map, rx, ry, o.rot),
      normalMap: cloneT(set.normalMap, rx, ry, o.rot),
      roughnessMap: cloneT(set.roughnessMap, rx, ry, o.rot),
      color: o.color ?? 0xffffff,
      roughness: o.rough ?? 1.0,
      metalness: o.metal ?? 0.0,
    });
    m.normalScale.set(o.ns ?? 1, o.ns ?? 1);
    return m;
  }
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

  // ---- static-mesh baking: collapse hundreds of small static meshes into ONE
  // mesh per material (draw-count is the budget). Colliders are pushed
  // separately, coarse, so collision stays cheap.
  const mergeBins = new Map();
  function bake(mesh, o = {}) {
    mesh.updateMatrixWorld(true);
    const mat = mesh.material;
    let bin = mergeBins.get(mat);
    if (!bin) {
      bin = { mat, geos: [], surface: o.surface ?? 'concrete', cast: o.cast ?? true, recv: o.recv ?? true, ray: o.ray ?? true };
      mergeBins.set(mat, bin);
    }
    bin.geos.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
    if (o.collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    return mesh;
  }
  function finalizeBakes() {
    for (const bin of mergeBins.values()) {
      if (!bin.geos.length) continue;
      const m = new THREE.Mesh(mergeGeometries(bin.geos, false), bin.mat);
      m.castShadow = bin.cast; m.receiveShadow = bin.recv;
      m.userData.surface = bin.surface;
      root.add(m);
      if (bin.ray) raycastMeshes.push(m);
    }
    mergeBins.clear();
  }
  function boxCollider(cx, cy, cz, hx, hy, hz) {
    colliders.push(new THREE.Box3(V3(cx - hx, cy - hy, cz - hz), V3(cx + hx, cy + hy, cz + hz)));
  }

  // ------------------------------------------------------------- materials
  const M = {
    ground: stdMat(T.dirt, { rx: 150, ry: 150, ns: 1.4, color: 0x9c9877 }),   // garrigue soil (olive-grey)
    trail: stdMat(T.dirt, { rx: 2.0, ry: 2.0, ns: 1.5, color: 0xcbb48d }),    // warm dusty rock path
    bed: stdMat(T.dirt, { rx: 2.2, ry: 2.2, ns: 1.6, color: 0x8a8168 }),      // wet stream bed
    lime1: stdMat(T.concrete, { rx: 3, ry: 2, ns: 1.7, color: 0xe0d6b6, rough: 0.99 }), // pale limestone
    lime2: stdMat(T.concrete, { rx: 3, ry: 2, ns: 1.7, color: 0xcabd96, rough: 1.0 }),  // ochre strata band
    lime3: stdMat(T.concrete, { rx: 3, ry: 2, ns: 1.7, color: 0xeae1c4, rough: 0.97 }), // bright weathered band
    limeShad: stdMat(T.concrete, { rx: 3, ry: 3, ns: 1.6, color: 0xbcb190, rough: 1.0 }), // shaded/base rock
    boulder: stdMat(T.concrete, { rx: 1.4, ry: 1.4, ns: 1.8, color: 0xcabd99, rough: 1.0 }),
    scree: stdMat(T.concrete, { rx: 1.2, ry: 1.2, ns: 1.7, color: 0xbcb191, rough: 1.0 }),
    stone: stdMat(T.concrete, { rx: 1.5, ry: 1.5, ns: 1.6, color: 0xcfc4a3, rough: 1.0 }), // dry-stone / bergerie
    bark: stdMat(T.wood, { rx: 1, ry: 3, ns: 1.4, color: 0x6a5641, rough: 1.0 }),
    wood: stdMat(T.wood, { rx: 1, ry: 1, ns: 1.1, color: 0x8a7355 }),
    foliage: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0.0, flatShading: true }),
    foliageHero: new THREE.MeshStandardMaterial({ color: 0x66743f, roughness: 1.0, metalness: 0.0, flatShading: true }),
    scrub: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0.0, flatShading: true }),
    grass: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide }),
    // near-unlit so distant ridges read as flat hazy-blue silhouettes (not sun-blown
    // white peaks); fog blends the far ring toward the horizon haze
    ridge: new THREE.MeshStandardMaterial({ color: 0x141a24, emissive: 0x3d4d67, roughness: 1.0, metalness: 0.0, fog: true }),
  };

  // ------------------------------------------------------------- fog + sky
  // Warm Provençal haze — thinner than the city (0.006) so the valley reads far.
  const HAZE = 0xcdc2a6;
  scene.fog = new THREE.FogExp2(HAZE, 0.006);
  scene.background = new THREE.Color(HAZE);

  const sunDir = V3(-0.42, -0.58, -0.70).normalize(); // FROM sun TO scene (midday-ish, ahead-left)
  const sunPosDir = sunDir.clone().negate();

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uSun: { value: sunPosDir },
      uZenith: { value: new THREE.Color(0x2f6db0) },
      uMid: { value: new THREE.Color(0x7ba6d6) },
      uHorizon: { value: new THREE.Color(0xd8ccac) },
      uWarm: { value: new THREE.Color(0xf1d9a4) },
      uGround: { value: new THREE.Color(0xcabf9d) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uZenith, uMid, uHorizon, uWarm, uGround;
      varying vec3 vDir;
      float vhash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vnoise(vec2 p){
        vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(vhash(i),vhash(i+vec2(1.0,0.0)),u.x),
                   mix(vhash(i+vec2(0.0,1.0)),vhash(i+vec2(1.0,1.0)),u.x),u.y);
      }
      float cfbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<3;i++){ v+=a*vnoise(p); p=p*2.03+17.17; a*=0.5; } return v; }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.14, h));
        col = mix(col, uZenith, smoothstep(0.12, 0.62, h));
        // warm sun-side horizon bias
        vec3 sunFlat = normalize(vec3(uSun.x, 0.0, uSun.z));
        vec3 dFlat = normalize(vec3(d.x, 0.001, d.z));
        float az = dot(dFlat, sunFlat)*0.5+0.5;
        float low = 1.0 - smoothstep(0.0, 0.30, abs(h));
        col = mix(col, uWarm, az*az*low*0.38);
        // sparse high fair-weather clouds
        vec2 cp = d.xz / max(d.y, 0.10);
        float cl = cfbm(cp*0.9 + vec2(4.0,8.0))*0.7 + cfbm(cp*2.4 + vec2(1.0,9.0))*0.3;
        float cmask = smoothstep(0.10, 0.22, h) * (1.0 - smoothstep(0.45, 0.62, h));
        float ca = smoothstep(0.56, 0.68, cl) * cmask * 0.30;
        col = mix(col, vec3(1.0,0.99,0.96), ca);
        // sun disc + glow
        float sd = dot(d, uSun);
        col += uWarm * pow(max(sd,0.0), 8.0) * 0.20;
        col += vec3(1.0,0.88,0.68) * pow(max(sd,0.0), 170.0) * 0.9;
        col += vec3(1.6,1.34,1.02) * smoothstep(0.99940, 0.99968, sd);
        col = mix(col, uGround, smoothstep(-0.02, -0.22, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 40, 24), skyMat);
  sky.frustumCulled = false;
  root.add(sky);

  // ------------------------------------------------------------- lights
  const sun = new THREE.DirectionalLight(0xffe9c8, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const HALF = 56;
  sun.shadow.camera.left = -HALF; sun.shadow.camera.right = HALF;
  sun.shadow.camera.top = HALF; sun.shadow.camera.bottom = -HALF;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 240;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  root.add(sun); root.add(sun.target);

  const SUN_DIST = 110;
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
  recenterSun(V3(0, 0, 30));

  // sky bounce: bright blue-sky hemisphere + dim warm bounce off opposite azimuth
  const hemi = new THREE.HemisphereLight(0xbcd4ee, 0x87805e, 1.35);
  root.add(hemi);
  const skyFill = new THREE.DirectionalLight(0x9fb6cf, 0.32);
  skyFill.castShadow = false;
  skyFill.position.set(0.42, 0.5, 0.70).multiplyScalar(60);
  root.add(skyFill); root.add(skyFill.target);

  const updaters = [];

  // ------------------------------------------------------------- ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(760, 760), M.ground);
  ground.rotation.x = -HPI;
  ground.castShadow = false; ground.receiveShadow = true;
  ground.userData.surface = 'dirt';
  root.add(ground);
  raycastMeshes.push(ground);
  colliders.push(new THREE.Box3(V3(-380, -3, -380), V3(380, 0, 380))); // floor

  // ------------------------------------------------------------- ribbon builder
  // Flat horizontal strip following a centerline curve (used for trail + stream).
  function ribbon(centerFn, halfW, z0, z1, step, y, repeat) {
    const pos = [], uv = [], idx = [];
    let vAcc = 0, prevZ = null, prevC = null, row = 0;
    for (let z = z0; z <= z1 + 1e-6; z += step) {
      const cx = centerFn(z);
      const dxdz = (centerFn(z + 0.05) - centerFn(z - 0.05)) / 0.1;
      let nx = 1, nz = -dxdz; const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
      if (prevZ !== null) vAcc += Math.hypot(z - prevZ, cx - prevC) / repeat;
      pos.push(cx - nx * halfW, y, z - nz * halfW, cx + nx * halfW, y, z + nz * halfW);
      const uu = (2 * halfW) / repeat;
      uv.push(0, vAcc, uu, vAcc);
      prevZ = z; prevC = cx; row++;
    }
    for (let i = 0; i < row - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const nrm = new Float32Array(pos.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1; // flat: normal up
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(idx);
    return g;
  }

  // main trail (warm dusty rock, slightly proud of the ground to kill z-fight)
  {
    const g = ribbon(TRAIL, 3.1, -74, 74, 2, 0.02, 3.4);
    const trail = new THREE.Mesh(g, M.trail);
    trail.material.side = THREE.DoubleSide;
    trail.receiveShadow = true; trail.castShadow = false;
    trail.userData.surface = 'dirt';
    root.add(trail); raycastMeshes.push(trail);
  }

  // ------------------------------------------------------------- instancing
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(),
        _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(),
        _col = new THREE.Color();
  function makeInst(geo, mat, max, o = {}) {
    const im = new THREE.InstancedMesh(geo, mat, max);
    im.count = 0;
    im.castShadow = o.cast ?? true;
    im.receiveShadow = o.recv ?? true;
    im.userData.surface = o.surface ?? 'concrete';
    root.add(im);
    if (o.ray ?? true) raycastMeshes.push(im);
    return im;
  }
  function inst(im, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0, color) {
    _p.set(x, y, z); _s.set(sx, sy, sz);
    _q.setFromEuler(_e.set(rx, ry, rz));
    _m4.compose(_p, _q, _s);
    im.setMatrixAt(im.count, _m4);
    if (color !== undefined) im.setColorAt(im.count, _col.setHex(color));
    im.count++;
  }
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const boulderInst = makeInst(rockGeo, M.boulder, 220, { surface: 'concrete' });          // cover boulders
  const screeInst = makeInst(rockGeo, M.scree, 900, { surface: 'concrete', cast: true });  // talus/scree
  const pebbleInst = makeInst(rockGeo, M.scree, 700, { surface: 'concrete', cast: false, ray: false }); // path pebbles
  const trunkGeo = new THREE.CylinderGeometry(0.10, 0.17, 1, 6);
  const trunkInst = makeInst(trunkGeo, M.bark, 340, { surface: 'wood' });
  const pineGeo = new THREE.ConeGeometry(1, 1, 7);
  const pineInst = makeInst(pineGeo, M.foliage, 760, { surface: 'dirt' });
  const oakGeo = new THREE.IcosahedronGeometry(1, 0);
  const oakInst = makeInst(oakGeo, M.foliage, 520, { surface: 'dirt' });
  const bushInst = makeInst(oakGeo, M.scrub, 900, { surface: 'dirt', cast: true });
  const rosemaryInst = makeInst(oakGeo, M.scrub, 340, { surface: 'dirt', cast: false, ray: false });
  const grassGeo = new THREE.ConeGeometry(1, 1, 4, 1, true);
  const grassInst = makeInst(grassGeo, M.grass, 1200, { surface: 'dirt', cast: false, ray: false });

  // ------------------------------------------------------------- cliffs
  // Stepped-strata limestone massifs flank the trail: stacked, receding rock
  // slabs (banded tints = sedimentary layers) rising 8-25m, forming the canyon
  // walls + level boundary + cover. One coarse Box3 per massif for collision.
  const limeBands = [M.lime1, M.lime2, M.lime3, M.limeShad];
  function massif(side, zc, nearX, height, wz) {
    const layers = Math.max(4, Math.round(height / 2.3));
    const depth = rr(5, 9);
    let y = 0, maxRecede = 0;
    for (let i = 0; i < layers; i++) {
      const t = i / layers;
      const lh = (height / layers) * rr(0.82, 1.22);
      const recede = t * t * rr(2.4, 4.6);
      maxRecede = Math.max(maxRecede, recede);
      const w = wz * rr(0.72, 1.05) * (1 - t * 0.32);
      const dep = depth * rr(0.8, 1.15);
      const bandMat = i === 0 ? M.limeShad : limeBands[i % 3];
      const m = box(dep, lh, w, bandMat);
      m.position.set(nearX + side * (recede + dep * 0.5), y + lh / 2, zc + rr(-1.4, 1.4));
      m.rotation.y = rr(-0.20, 0.20);
      m.rotation.z = side * rr(-0.04, 0.05);
      m.rotation.x = rr(-0.03, 0.03);
      bake(m, { surface: 'concrete' });
      y += lh * rr(0.86, 1.0);
    }
    // coarse collider: from the near rock face outward
    const x0 = nearX, x1 = nearX + side * (maxRecede + depth + 3);
    colliders.push(new THREE.Box3(
      V3(Math.min(x0, x1), -2, zc - wz * 0.6), V3(Math.max(x0, x1), height + 2, zc + wz * 0.6)));
    // talus/scree apron at the base, spilling toward the trail
    const nT = Math.round(rr(10, 18));
    for (let k = 0; k < nT; k++) {
      const off = rand() * rand() * 4.5;
      const s = rr(0.4, 1.5);
      inst(screeInst, nearX - side * off, s * 0.35 + 0.02, zc + rr(-wz * 0.55, wz * 0.55),
        s * rr(0.9, 1.5), s * rr(0.6, 1.0), s * rr(0.9, 1.5),
        rr(0, Math.PI), rr(-0.3, 0.3), rr(-0.3, 0.3));
    }
  }

  // build overlapping massifs down both walls; canyon half-width breathes 9..12m,
  // heights swell toward the middle of the gorge for a dramatic pinch.
  for (const side of [-1, 1]) {
    let z = -74;
    while (z < 74) {
      const span = rr(8, 12);
      const zc = z + span * 0.5;
      const canyonHalf = 9 + 2.6 * Math.sin(zc * 0.05 + (side > 0 ? 0 : 1.7)) + rr(-0.6, 0.9);
      const nearX = TRAIL(zc) + side * canyonHalf;
      const mid = 1 - Math.min(1, Math.abs(zc) / 70);
      const height = rr(8, 13) + mid * rr(4, 12);
      massif(side, zc, nearX, height, span * 1.35);
      z += span;
    }
  }
  // guaranteed containment box (invisible) — massifs stop the player first
  colliders.push(new THREE.Box3(V3(-60, -2, -78), V3(60, 40, -74)));
  colliders.push(new THREE.Box3(V3(-60, -2, 74), V3(60, 40, 78)));
  colliders.push(new THREE.Box3(V3(-24, -2, -78), V3(-18, 40, 78)));
  colliders.push(new THREE.Box3(V3(18, -2, -78), V3(24, 40, 78)));

  // BADLANDS: a wider apron of lower limestone outcrops / broken mesas set back
  // BEHIND the canyon walls (x |TRAIL±18..48|). Unreachable (the containment box
  // stops the player at ±18) so pure backdrop — fills the aerial and makes the
  // gorge read as one shoulder of a larger Provençal massif. Merged into the
  // limestone meshes (same materials), no colliders.
  for (const side of [-1, 1]) {
    for (let z = -82; z < 82; z += rr(9, 15)) {
      const baseX = TRAIL(z) + side * rr(18, 44);
      const clumps = 2 + (rand() * 3 | 0);
      const H = rr(4, 16);
      for (let k = 0; k < clumps; k++) {
        const h = H * rr(0.5, 1.1);
        const useCone = rand() < 0.45;
        const mat = limeBands[(rand() * 3) | 0];
        const cx = baseX + rr(-6, 6), cz = z + rr(-6, 6);
        let m;
        if (useCone) {
          m = new THREE.Mesh(new THREE.ConeGeometry(rr(3, 7), h, 5), mat);
          m.geometry.scale(1, 1, rr(0.7, 1.1));
        } else {
          m = box(rr(4, 9), h, rr(4, 9), mat);
        }
        m.position.set(cx, h * 0.5 - 0.5, cz);
        m.rotation.y = rr(0, Math.PI);
        m.rotation.z = rr(-0.12, 0.12);
        bake(m, { surface: 'concrete' });
      }
    }
  }

  // distant ridgeline: two overlapping rings of low broad hazy hills so the
  // canyon rim reads as an arrière-pays massif, not isolated spikes. Deep
  // blue-grey; the fog blends the far ring toward the horizon haze.
  {
    const ridgeGeos = [];
    const ring = (count, rad0, rad1, h0, h1, wide) => {
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + rr(-0.12, 0.12);
        const rad = rr(rad0, rad1);
        const rx = Math.cos(ang) * rad, rz = Math.sin(ang) * rad;
        const w = rr(wide * 0.9, wide * 1.5), h = rr(h0, h1);
        const g = new THREE.ConeGeometry(w * 0.5, h, 5);
        g.scale(1, 1, 0.45);
        g.rotateY(rr(0, Math.PI));
        g.translate(rx, h * 0.5 - 12, rz);
        ridgeGeos.push(g);
      }
    };
    ring(46, 180, 220, 15, 28, 135);  // near ridge band (low, broad, overlapping)
    ring(38, 255, 330, 22, 42, 200);  // far ring (melts into haze)
    const ridge = new THREE.Mesh(mergeGeometries(ridgeGeos, false), M.ridge);
    ridge.castShadow = false; ridge.receiveShadow = false;
    ridge.frustumCulled = false;
    root.add(ridge); // not a collider, not raycast — pure backdrop
  }

  // ------------------------------------------------------------- stream (Nartuby)
  // Shallow rocky stream on the WEST side of the trail for a stretch, sitting in
  // a wet bed. Blue-green translucent plane with an animated ripple shader.
  const STREAM = (z) => TRAIL(z) - 6.4 + 0.8 * Math.sin(z * 0.06);
  const SZ0 = -22, SZ1 = 46;
  {
    const bedG = ribbon(STREAM, 2.6, SZ0 - 2, SZ1 + 2, 2, 0.0, 2.4);
    const bed = new THREE.Mesh(bedG, M.bed);
    bed.material.side = THREE.DoubleSide;
    bed.receiveShadow = true; bed.castShadow = false;
    bed.userData.surface = 'dirt';
    root.add(bed); raycastMeshes.push(bed);
  }
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: true, side: THREE.DoubleSide, fog: false,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x255249) },
      uShallow: { value: new THREE.Color(0x57a08f) },
      uHaze: { value: new THREE.Color(HAZE) },
      uToSun: { value: sunPosDir },
      uFog: { value: 0.006 },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWorld = wp.xyz;
        gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uFog; uniform vec3 uDeep, uShallow, uHaze, uToSun;
      varying vec3 vWorld;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p),f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y); }
      void main(){
        vec2 uv = vWorld.xz; float t = uTime;
        vec2 rp = vec2(0.0);
        rp.x += sin(uv.x*1.6 + t*1.3)*0.5 + (n(uv*0.9 + vec2(t*0.15,0.0))-0.5);
        rp.y += cos(uv.y*1.8 - t*1.1)*0.5 + (n(uv*1.1 - vec2(0.0,t*0.12))-0.5);
        vec3 N = normalize(vec3(rp.x*0.22, 1.0, rp.y*0.22));
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N,V),0.0), 3.0);
        vec3 dsun = normalize(uToSun);
        vec3 H = normalize(dsun + V);
        float spec = pow(max(dot(N,H),0.0), 64.0);
        vec3 col = mix(uDeep, uShallow, clamp(N.y*0.5+0.35,0.0,1.0));
        col = mix(col, uHaze*1.08, fres*0.55);
        col += spec * vec3(1.0,0.96,0.82) * 0.85;
        float dist = length(cameraPosition - vWorld);
        float fog = 1.0 - exp(-uFog*uFog*dist*dist);
        col = mix(col, uHaze, clamp(fog,0.0,1.0));
        gl_FragColor = vec4(col, mix(0.72, 0.94, fres));
      }`,
  });
  {
    const g = ribbon(STREAM, 2.15, SZ0, SZ1, 2, 0.10, 1.0);
    const water = new THREE.Mesh(g, waterMat);
    water.renderOrder = 2;
    water.castShadow = false; water.receiveShadow = false;
    root.add(water); // not raycast, not collider — bullets pass through to the bed
  }
  // stepping stones + a couple of mid-stream boulders
  for (let i = 0; i < 9; i++) {
    const z = SZ0 + 4 + i * ((SZ1 - SZ0 - 8) / 8);
    const s = rr(0.6, 1.1);
    inst(boulderInst, STREAM(z) + rr(-1.4, 1.4), s * 0.4, z,
      s * rr(1.0, 1.5), s * rr(0.7, 1.0), s * rr(1.0, 1.5), rr(0, Math.PI));
  }

  // little stone footbridge crossing the stream mid-way (cover + landmark)
  {
    const bz = 18, bx = STREAM(bz);
    for (const a of [-1, 1]) { // stone abutments
      const ab = box(1.6, 0.9, 1.4, M.stone);
      ab.position.set(bx + a * 2.4, 0.45, bz);
      bake(ab, { surface: 'concrete', collide: true });
    }
    const deck = box(6.4, 0.28, 2.0, M.wood); // plank deck
    deck.position.set(bx, 0.92, bz);
    bake(deck, { surface: 'wood' });
    boxCollider(bx, 0.55, bz, 3.2, 0.55, 1.0);
    for (const a of [-1, 1]) { // low log rails
      const rail = box(6.4, 0.12, 0.14, M.wood);
      rail.position.set(bx, 1.34, bz + a * 0.9);
      bake(rail, { surface: 'wood', collide: false });
      for (const rx2 of [-2.6, 0, 2.6]) {
        const post = box(0.14, 0.5, 0.14, M.wood);
        post.position.set(bx + rx2, 1.12, bz + a * 0.9);
        bake(post, { surface: 'wood', collide: false });
      }
    }
    coverPoints.push(V3(bx + 3.6, 0, bz), V3(bx - 3.6, 0, bz));
  }

  // ------------------------------------------------------------- dry-stone wall
  // "mur en pierre sèche": a low stacked-stone wall along an east-side stretch.
  {
    const z0 = -6, z1 = 17, sideOff = 3.9;
    let prevY = 0;
    for (let z = z0; z <= z1; z += 0.62) {
      const wx = TRAIL(z) + sideOff + 0.4 * Math.sin(z * 0.4);
      const rows = 3;
      for (let r = 0; r < rows; r++) {
        const s = box(rr(0.5, 0.72), rr(0.24, 0.32), rr(0.42, 0.6), M.stone);
        s.position.set(wx + rr(-0.08, 0.08), 0.14 + r * 0.28, z);
        s.rotation.y = rr(-0.25, 0.25);
        bake(s, { surface: 'concrete', collide: false });
      }
      prevY = z;
    }
    boxCollider(TRAIL((z0 + z1) / 2) + sideOff, 0.45, (z0 + z1) / 2, 0.9, 0.45, (z1 - z0) / 2 + 0.4);
    coverPoints.push(V3(TRAIL(2) + sideOff - 1.1, 0, 2), V3(TRAIL(22) + sideOff - 1.1, 0, 22));
  }

  // ------------------------------------------------------------- ruined bergerie
  // Small stone shepherd's hut with a collapsed corner — take cover behind it.
  {
    const bz = -24, bx = TRAIL(bz) - 6.6, W = 5.2, D = 4.6, H = 2.7, TH = 0.5;
    const wallN = box(W, H, TH, M.stone); wallN.position.set(bx, H / 2, bz - D / 2); bake(wallN, { surface: 'concrete', collide: true });
    // south wall with a door gap: two segments
    const segW = (W - 1.4) / 2;
    const ws1 = box(segW, H, TH, M.stone); ws1.position.set(bx - (1.4 / 2 + segW / 2), H / 2, bz + D / 2); bake(ws1, { surface: 'concrete', collide: true });
    const ws2 = box(segW, H * 0.55, TH, M.stone); ws2.position.set(bx + (1.4 / 2 + segW / 2), H * 0.55 / 2, bz + D / 2); bake(ws2, { surface: 'concrete', collide: true });
    const wallW = box(TH, H, D, M.stone); wallW.position.set(bx - W / 2, H / 2, bz); bake(wallW, { surface: 'concrete', collide: true });
    // east wall: collapsed to half height (ruined)
    const wallE = box(TH, H * 0.5, D, M.stone); wallE.position.set(bx + W / 2, H * 0.5 / 2, bz); bake(wallE, { surface: 'concrete', collide: true });
    // fallen roof beams + rubble spill
    for (let i = 0; i < 4; i++) {
      const beam = box(W * 0.9, 0.16, 0.2, M.wood);
      beam.position.set(bx + rr(-0.6, 0.6), rr(0.4, 1.2), bz - D / 2 + 0.6 + i * 0.9);
      beam.rotation.z = rr(-0.2, 0.05); beam.rotation.y = rr(-0.2, 0.2);
      bake(beam, { surface: 'wood', collide: false });
    }
    for (let i = 0; i < 20; i++) {
      const s = rr(0.3, 0.7);
      inst(screeInst, bx + rr(-W / 2, W / 2) + 2.0, s * 0.3, bz + rr(-D / 2, D / 2),
        s, s * 0.7, s, rr(0, Math.PI));
    }
    coverPoints.push(V3(bx, 0, bz + D / 2 + 1.4), V3(bx - W / 2 - 1.6, 0, bz), V3(bx + W / 2 + 1.6, 0, bz - 1.5));
    enemySpawns.push(V3(bx + W / 2 + 2.2, 0, bz), V3(bx - 1, 0, bz - D / 2 - 2.4));
  }

  // ------------------------------------------------------------- wooden signpost
  {
    const sz = 44, sx = TRAIL(sz) - 4.0;
    const post = box(0.16, 2.3, 0.16, M.wood); post.position.set(sx, 1.15, sz);
    bake(post, { surface: 'wood', collide: false });
    boxCollider(sx, 1.15, sz, 0.16, 1.15, 0.16);
    const s1 = box(1.5, 0.34, 0.06, M.wood); s1.position.set(sx + 0.6, 2.0, sz); s1.rotation.y = 0.15; bake(s1, { surface: 'wood', collide: false });
    const s2 = box(1.3, 0.30, 0.06, M.wood); s2.position.set(sx - 0.55, 1.6, sz); s2.rotation.y = -0.5; bake(s2, { surface: 'wood', collide: false });
    coverPoints.push(V3(sx, 0, sz + 0.8));
  }

  // ------------------------------------------------------------- vegetation
  // Aleppo pine: thin trunk + 2 stacked olive cones. Oak: stout trunk + rounded
  // olive blob. Foliage tone varies per-instance for an organic garrigue read.
  const _greens = [0x5c6a38, 0x6b7846, 0x717e4e, 0x556234, 0x788552];
  function greenPick() { return _greens[(rand() * _greens.length) | 0]; }
  const _scrubGreens = [0x6a7440, 0x76804c, 0x616c3a, 0x828b58];
  function scrubPick() { return _scrubGreens[(rand() * _scrubGreens.length) | 0]; }

  function pineTree(x, z, scale) {
    const th = 3.4 * scale;
    inst(trunkInst, x, th * 0.5, z, 1, th, 1, 0, rr(-0.05, 0.05), rr(-0.05, 0.05));
    // umbrella canopy: 2-3 flattened cones stacked near the top
    const layers = 2 + (rand() < 0.5 ? 1 : 0);
    for (let i = 0; i < layers; i++) {
      const cy = th * (0.72 + i * 0.16 * scale);
      const cr = (2.1 - i * 0.4) * scale * rr(0.9, 1.1);
      inst(pineInst, x + rr(-0.2, 0.2), cy, z + rr(-0.2, 0.2),
        cr, (1.5 - i * 0.2) * scale, cr, rr(0, Math.PI), 0, rr(-0.05, 0.05), greenPick());
    }
  }
  function oakTree(x, z, scale) {
    const th = 2.1 * scale;
    inst(trunkInst, x, th * 0.5, z, 1.25, th, 1.25, 0, rr(-0.06, 0.06), rr(-0.06, 0.06));
    const n = 2 + (rand() < 0.6 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const r = rr(1.5, 2.4) * scale;
      inst(oakInst, x + rr(-0.9, 0.9), th + rr(-0.2, 0.9) * scale, z + rr(-0.9, 0.9),
        r, r * rr(0.7, 0.9), r, rr(0, Math.PI), rr(-0.2, 0.2), rr(-0.2, 0.2), greenPick());
    }
  }

  // scatter trees on the slopes (avoid trail center, stream and the flat spine)
  let placedTrees = 0;
  for (let i = 0; i < 300 && placedTrees < 150; i++) {
    const z = rr(-72, 72);
    const side = rand() < 0.5 ? -1 : 1;
    const off = rr(4.2, 12) * side;
    const x = TRAIL(z) + off;
    // keep off the stream lane
    if (z > SZ0 && z < SZ1 && Math.abs(x - STREAM(z)) < 2.4) continue;
    const scale = rr(0.7, 1.3);
    if (rand() < 0.62) pineTree(x, z, scale); else oakTree(x, z, scale);
    placedTrees++;
  }
  // wider tree band across the badlands apron (aerial green; unreachable decor)
  for (let i = 0; i < 60; i++) {
    const z = rr(-80, 80);
    const x = TRAIL(z) + rr(14, 40) * (rand() < 0.5 ? -1 : 1);
    const scale = rr(0.7, 1.2);
    if (rand() < 0.6) pineTree(x, z, scale); else oakTree(x, z, scale);
  }

  // scrub bushes + rosemary/thyme clumps + dry grass tufts across the terrain
  for (let i = 0; i < 340; i++) {
    const z = rr(-80, 80);
    const off = rr(3.6, 40) * (rand() < 0.5 ? -1 : 1);
    const x = TRAIL(z) + off;
    if (z > SZ0 && z < SZ1 && Math.abs(x - STREAM(z)) < 2.0) continue;
    const r = rr(0.5, 1.2);
    inst(bushInst, x, r * 0.55, z, r, r * rr(0.6, 0.85), r, rr(0, Math.PI), 0, 0, scrubPick());
  }
  for (let i = 0; i < 180; i++) {
    const z = rr(-73, 73);
    const off = rr(3.2, 13) * (rand() < 0.5 ? -1 : 1);
    const x = TRAIL(z) + off;
    const r = rr(0.35, 0.7);
    inst(rosemaryInst, x, r * 0.4, z, r * rr(1.1, 1.6), r * 0.5, r * rr(1.1, 1.6), rr(0, Math.PI), 0, 0, 0x8ea089);
  }
  for (let i = 0; i < 1100; i++) {
    const z = rr(-74, 74);
    const off = rr(1.2, 30) * (rand() < 0.5 ? -1 : 1);
    const x = TRAIL(z) + off;
    if (z > SZ0 && z < SZ1 && Math.abs(x - STREAM(z)) < 1.4) continue;
    const hgt = rr(0.28, 0.52);
    const w = rr(0.07, 0.13);
    inst(grassInst, x, hgt * 0.5, z, w, hgt, w, rr(0, Math.PI), 0, 0, rr(0, 1) < 0.5 ? 0x86794a : 0x6f6a42);
  }
  // path pebbles / small rock scatter directly on the trail for texture
  for (let i = 0; i < 500; i++) {
    const z = rr(-74, 74);
    const off = rr(-3.0, 3.0);
    const s = rr(0.06, 0.22);
    inst(pebbleInst, TRAIL(z) + off, s * 0.4, z, s * rr(1, 1.6), s * 0.6, s * rr(1, 1.6), rr(0, Math.PI), 0, 0, 0xb6ab8d);
  }

  // ------------------------------------------------------------- boulders (cover)
  // Big cover boulders + rock piles along the trail shoulders. Each doubles as a
  // coverPoint on the trail-facing side and, for the larger ones, an enemySpawn.
  const boulderSpots = [
    [46, -5.6, 1.5], [38, 5.4, 1.7], [30, -6.2, 1.4], [24, 6.0, 1.6],
    [16, -5.0, 1.8], [8, 5.8, 1.5], [1, -6.4, 1.6], [-8, 5.2, 1.7],
    [-16, -5.8, 1.9], [-24, 6.2, 1.5], [-30, -5.0, 1.6], [-40, 5.6, 1.8],
    [-48, -6.0, 1.5], [-56, 5.0, 1.7], [-62, -5.4, 1.6], [-68, 4.8, 1.5],
  ];
  for (const [z, off, sc] of boulderSpots) {
    const x = TRAIL(z) + off, side = Math.sign(off);
    // a cluster: one big + a couple of satellites
    inst(boulderInst, x, sc * 0.7, z, sc * rr(1.2, 1.6), sc * rr(1.0, 1.4), sc * rr(1.2, 1.6), rr(0, Math.PI), rr(-0.1, 0.1), rr(-0.1, 0.1));
    for (let k = 0; k < 2; k++) {
      const s2 = sc * rr(0.4, 0.7);
      inst(boulderInst, x + rr(-1.4, 1.4), s2 * 0.6, z + rr(-1.4, 1.4), s2 * 1.3, s2, s2 * 1.3, rr(0, Math.PI));
    }
    boxCollider(x, sc * 0.7, z, sc * 0.95, sc * 0.7, sc * 0.95);
    coverPoints.push(V3(x - side * (sc + 0.6), 0, z)); // trail-facing side
  }

  // ------------------------------------------------------------- spawns + cover
  // enemy spawns spread along the whole trail, behind rocks / up the slopes.
  const spawnDefs = [
    [42, 6], [34, -6], [26, 6.5], [12, -6.5], [4, 6], [-4, -6],
    [-12, 6.5], [-20, -6.5], [-28, 6], [-36, -6.5], [-44, 6.5], [-52, -6],
    [-58, 6], [-64, -5.5], [-70, 4.5], [-70, -4.5],
  ];
  for (const [z, off] of spawnDefs) enemySpawns.push(V3(TRAIL(z) + off, 0, z));

  // extra cover points: terrain folds / trail edges between the boulders
  const coverDefs = [
    [40, 2.5], [32, -2.8], [20, 3.0], [10, -3.0], [2, 2.6], [-6, -2.8],
    [-14, 3.0], [-22, -2.6], [-32, 2.8], [-42, -2.8], [-50, 2.6], [-60, -2.6],
    [36, -4.6], [18, 4.6], [-2, -4.4], [-26, 4.4], [-46, -4.4], [-66, 3.6],
  ];
  for (const [z, off] of coverDefs) coverPoints.push(V3(TRAIL(z) + off, 0, z));

  // ------------------------------------------------------------- hero trees (sway)
  // A handful of individually-modelled pines near the trail sway in the update
  // loop (the bulk of the forest is static instances for perf).
  const heroTrees = [];
  const heroFoliageMat = M.foliageHero;
  function heroPine(x, z, scale) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const th = 3.6 * scale;
    const trunk = new THREE.Mesh(trunkGeo, M.bark);
    trunk.scale.set(1, th, 1); trunk.position.y = th * 0.5;
    trunk.castShadow = true; trunk.receiveShadow = true;
    trunk.userData.surface = 'wood'; g.add(trunk); raycastMeshes.push(trunk);
    const canopy = new THREE.Group(); canopy.position.y = th * 0.72;
    for (let i = 0; i < 3; i++) {
      const cr = (2.2 - i * 0.5) * scale;
      const cone = new THREE.Mesh(pineGeo, heroFoliageMat);
      cone.scale.set(cr, (1.6 - i * 0.2) * scale, cr);
      cone.position.y = i * 0.7 * scale;
      cone.material = heroFoliageMat;
      cone.castShadow = true; cone.receiveShadow = true;
      cone.userData.surface = 'dirt';
      // tint via vertex color-free: give each hero its own material tint
      canopy.add(cone); raycastMeshes.push(cone);
    }
    g.add(canopy);
    root.add(g);
    heroTrees.push({ canopy, ph: rand() * 6.28, amp: rr(0.02, 0.045), f: rr(0.6, 1.0) });
    // collider so you can't walk through the trunk
    boxCollider(x, 1.2, z, 0.3, 1.2, 0.3);
  }
  heroPine(TRAIL(50) - 4.4, 50, 1.1);
  heroPine(TRAIL(40) + 4.8, 40, 1.25);
  heroPine(TRAIL(22) - 4.6, 22, 1.0);
  heroPine(TRAIL(6) + 4.4, 6, 1.2);
  heroPine(TRAIL(-18) - 4.8, -18, 1.15);
  heroPine(TRAIL(-40) + 4.6, -40, 1.05);
  heroPine(TRAIL(-58) - 4.4, -58, 1.2);

  // ------------------------------------------------------------- dust motes
  // Warm floating dust drifting in the sun; follows the player, wraps in a box.
  {
    const N = 240;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rr(-40, 40); pos[i * 3 + 1] = rr(0, 18); pos[i * 3 + 2] = rr(-40, 40);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dustMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        uniform float uTime; varying float vF;
        void main(){
          vec3 p = position;
          p.x += sin(uTime*0.10 + position.y*0.5)*2.0 + uTime*0.20;
          p.y += sin(uTime*0.15 + position.x*0.3)*0.6;
          p.z += cos(uTime*0.08 + position.x*0.4)*1.5;
          p.x = mod(p.x+40.0, 80.0)-40.0;
          p.z = mod(p.z+40.0, 80.0)-40.0;
          p.y = mod(p.y, 18.0)+1.0;
          vec4 mv = modelViewMatrix*vec4(p,1.0);
          gl_Position = projectionMatrix*mv;
          gl_PointSize = clamp(46.0 / -mv.z, 0.6, 3.5);
          vF = smoothstep(70.0, 8.0, -mv.z);
        }`,
      fragmentShader: /* glsl */`
        varying float vF;
        void main(){ vec2 c = gl_PointCoord-0.5; if(dot(c,c)>0.25) discard;
          float a = smoothstep(0.25,0.0,dot(c,c))*0.30*vF;
          gl_FragColor = vec4(1.0,0.94,0.78,a); }`,
    });
    const dust = new THREE.Points(g, dustMat);
    dust.frustumCulled = false;
    root.add(dust);
    updaters.push((dt, px, pz) => { dust.position.set(px, 0, pz); dustMat.uniforms.uTime.value = time; });
  }

  // ------------------------------------------------------------- finalize
  finalizeBakes();
  for (const im of [boulderInst, screeInst, pebbleInst, trunkInst, pineInst, oakInst,
                    bushInst, rosemaryInst, grassInst]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.frustumCulled = true;
  }

  // ------------------------------------------------------------- walk paths
  // Civilian loops on the flat trail spine (down one shoulder, back the other),
  // clear of the stream and rock colliders. y=0.
  function trailLoop(za, zb, offA, offB, step) {
    const pts = [];
    for (let z = za; z >= zb; z -= step) pts.push(V3(TRAIL(z) + offA, 0, z));
    for (let z = zb; z <= za; z += step) pts.push(V3(TRAIL(z) + offB, 0, z));
    return pts;
  }
  const walkPaths = [
    trailLoop(48, -30, 1.4, -1.4, 8),   // main promenade
    trailLoop(30, -66, 1.6, -1.2, 9),   // lower gorge circuit
    trailLoop(52, 6, -1.5, 1.5, 7),     // near-spawn stroll
  ];

  // nudge every spawn / cover / walk waypoint OUT of any solid prop collider
  // (boulders, dry-stone wall, bergerie, footbridge, cliff bases) so nobody
  // spawns or navigates inside geometry. Cheap one-shot at build time.
  const solidC = colliders.filter((b) => b.max.y > 0.4 && b.min.y < 2.2 &&
    (b.max.x - b.min.x) < 80 && (b.max.z - b.min.z) < 80);
  function nudgeOut(p, margin) {
    for (let it = 0; it < 5; it++) {
      let moved = false;
      for (const b of solidC) {
        if (p.x > b.min.x - margin && p.x < b.max.x + margin &&
            p.z > b.min.z - margin && p.z < b.max.z + margin) {
          const pL = p.x - (b.min.x - margin), pR = (b.max.x + margin) - p.x;
          const pB = p.z - (b.min.z - margin), pF = (b.max.z + margin) - p.z;
          const m = Math.min(pL, pR, pB, pF);
          if (m === pL) p.x = b.min.x - margin; else if (m === pR) p.x = b.max.x + margin;
          else if (m === pB) p.z = b.min.z - margin; else p.z = b.max.z + margin;
          moved = true;
        }
      }
      if (!moved) break;
    }
    // fallback: if still trapped between overlapping boxes, pull into the always-
    // clear trail corridor (|x-TRAIL| <= 2.6) on the same side
    for (const b of solidC) {
      if (p.x > b.min.x - margin && p.x < b.max.x + margin &&
          p.z > b.min.z - margin && p.z < b.max.z + margin) {
        const c = TRAIL(p.z);
        p.x = c + Math.max(-2.6, Math.min(2.6, p.x - c));
        break;
      }
    }
    return p;
  }
  enemySpawns.forEach((p) => nudgeOut(p, 0.6));
  coverPoints.forEach((p) => nudgeOut(p, 0.45));
  walkPaths.forEach((path) => path.forEach((p) => nudgeOut(p, 0.45)));

  // ------------------------------------------------------------- spawn + api
  const playerSpawn = V3(TRAIL(52), 0, 52);
  const api = {
    colliders,
    raycastMeshes,
    enemySpawns,
    coverPoints,
    walkPaths,
    sunDir,
    playerSpawn,
    playerSpawnYaw: 0, // yaw 0 faces -Z — spawn looks DOWN the trail
    bins: [],          // no squishy cover here; keep the weapon's squish wire safe
    squishAt() {},
    update(dt, playerPos) {
      time += dt;
      if (playerPos) {
        recenterSun(playerPos);
        _lastP.copy(playerPos);
        sky.position.set(playerPos.x, 0, playerPos.z); // sky follows camera (far-plane clip)
      }
      waterMat.uniforms.uTime.value = time;
      // sway the hero pines' canopies
      for (let i = 0; i < heroTrees.length; i++) {
        const h = heroTrees[i];
        h.canopy.rotation.z = h.amp * Math.sin(time * h.f + h.ph);
        h.canopy.rotation.x = h.amp * 0.7 * Math.cos(time * h.f * 0.8 + h.ph);
      }
      const px = _lastP.x, pz = _lastP.z;
      for (let i = 0; i < updaters.length; i++) updaters[i](dt, px, pz);
    },
  };
  if (typeof window !== 'undefined' && window.__SHOT_MODE__) window.__world = api; // probe hook
  return api;
}
