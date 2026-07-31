// ASHFALL — world/map.js
// Ruined city district. Fully procedural: sky shader, sun + tuned shadows,
// ~40 damaged buildings on a real street grid (main street spine + two avenues
// at x±38 + cross streets), plaza, parking lot, urban furniture (instanced),
// skyline ring, ground clutter. Exports sidewalk walkPaths for civilians.
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

  // ---------------------------------------------------------------- helpers
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const rand = (() => { let s = 1337; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
  const rr = (a, b) => a + rand() * (b - a);

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
  function add(mesh, o = {}) {
    mesh.castShadow = o.cast ?? true;
    mesh.receiveShadow = o.recv ?? true;
    mesh.userData.surface = o.surface ?? 'concrete';
    root.add(mesh);
    if (o.ray ?? true) raycastMeshes.push(mesh);
    if (o.collide ?? true) {
      mesh.updateWorldMatrix(true, false);
      colliders.push(new THREE.Box3().setFromObject(mesh));
    }
    return mesh;
  }
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

  // ---- static-mesh baking -------------------------------------------------
  // Hundreds of small static meshes (building bodies, wrecks, barriers,
  // decals...) collapse into ONE mesh per material: the draw count is what
  // kills the frame here, not triangles. Colliders still come from the
  // original mesh transforms; merged geometry stays raycastable (all low-poly).
  const bakeBins = new Map();
  const bandIdx = (x) => (x < -15 ? 0 : x > 15 ? 2 : 1);
  const binKeys = new Map(); // material -> per-band key objects
  function bakeMesh(mesh, o = {}) {
    mesh.updateMatrixWorld(true);
    const pushGeo = (m) => {
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      // bins split west|center|east: tighter spheres -> better frustum
      // culling, saner opaque sorting, cheaper raycast rejection
      let keys = binKeys.get(m.material);
      if (!keys) { keys = [{ mat: m.material }, { mat: m.material }, { mat: m.material }]; binKeys.set(m.material, keys); }
      const key = keys[bandIdx(m.matrixWorld.elements[12])];
      let bin = bakeBins.get(key);
      if (!bin) { bin = { geos: [], o }; bakeBins.set(key, bin); }
      bin.geos.push(g);
    };
    if (mesh.isMesh) pushGeo(mesh);
    else mesh.traverse((m) => { if (m.isMesh) pushGeo(m); });
    if (o.collide ?? true) {
      const b = new THREE.Box3().setFromObject(mesh);
      colliders.push(b);
    }
    return mesh;
  }
  function finalizeBakes() {
    for (const [key, bin] of bakeBins) {
      const mesh = new THREE.Mesh(mergeGeometries(bin.geos, false), key.mat);
      mesh.castShadow = bin.o.cast ?? true;
      mesh.receiveShadow = bin.o.recv ?? true;
      mesh.userData.surface = bin.o.surface ?? 'concrete';
      root.add(mesh);
      if (bin.o.ray ?? true) raycastMeshes.push(mesh);
    }
    bakeBins.clear();
  }
  // conservative AABB collider for a Y-rotated box
  function obbCollider(cx, cy, cz, hx, hy, hz, ry = 0) {
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    const ex = hx * c + hz * s, ez = hx * s + hz * c;
    colliders.push(new THREE.Box3(V3(cx - ex, cy - hy, cz - ez), V3(cx + ex, cy + hy, cz + ez)));
  }
  function invisibleWall(cx, cz, hx, hz, h = 30) {
    colliders.push(new THREE.Box3(V3(cx - hx, -2, cz - hz), V3(cx + hx, h, cz + hz)));
  }

  // ---------------------------------------------------------------- materials
  const M = {
    asphalt: stdMat(T.asphalt, { rx: 5, ry: 40, ns: 1.3 }),
    sidewalk: stdMat(T.concrete, { rx: 22, ry: 1.4, color: 0xb7b3aa, ns: 0.9 }),
    curb: stdMat(T.concrete, { rx: 30, ry: 0.25, color: 0xc3bfb4 }),
    dirt: stdMat(T.dirt, { rx: 30, ry: 30, ns: 1.4, color: 0xb9b0a2 }),
    concrete: stdMat(T.concrete, { rx: 3, ry: 3 }),
    trim: stdMat(T.concrete, { rx: 1, ry: 1, color: 0xaaa79e }),
    barrier: stdMat(T.concrete, { rx: 1.5, ry: 1, color: 0xb2aea6 }),
    brickA: stdMat(T.brick, { rx: 4, ry: 4, ns: 1.2 }),
    brickB: stdMat(T.brick, { rx: 4, ry: 4, color: 0xc8b6a8, ns: 1.2 }),
    plasterA: stdMat(T.plaster, { rx: 3, ry: 3, ns: 1.1 }),
    plasterB: stdMat(T.plaster, { rx: 3, ry: 3, color: 0xb8b09e, ns: 1.1 }),
    concA: stdMat(T.concrete, { rx: 4, ry: 4, color: 0xc4c1ba }),
    concB: stdMat(T.concrete, { rx: 4, ry: 4, color: 0xa9a69d }),
    metal: stdMat(T.metal, { rx: 2, ry: 1, rough: 0.75, metal: 0.35 }),
    rust: stdMat(T.rust, { rx: 2, ry: 2, rough: 0.95 }),
    wood: stdMat(T.wood, { rx: 1, ry: 1 }),
    sandbag: stdMat(T.sandbag, { rx: 1.2, ry: 0.8, ns: 1.4 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x0a0e14, roughness: 0.35, metalness: 0.6,
      emissive: 0x0a0e14, emissiveIntensity: 0.35,
    }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.9 }),
    pole: stdMat(T.wood, { rx: 1, ry: 4, color: 0x6b5f52 }),
    carShell: stdMat(T.rust, { rx: 2, ry: 1, color: 0x4a443e, rough: 0.92 }),
    carBurnt: new THREE.MeshStandardMaterial({ color: 0x181614, roughness: 0.96 }),
    carChar: stdMat(T.charred, { rx: 2, ry: 1, ns: 1.1 }),
    carWin: new THREE.MeshStandardMaterial({ color: 0x060708, roughness: 0.5, metalness: 0.4 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x0e0e0f, roughness: 0.98 }),
    // city expansion: unit-repeat materials — geometry carries metric UVs
    asphaltU: stdMat(T.asphalt, { rx: 1, ry: 1, ns: 1.3 }),
    walkU: stdMat(T.concrete, { rx: 1, ry: 1, color: 0xb7b3aa, ns: 0.9 }),
    curbU: stdMat(T.concrete, { rx: 1, ry: 1, color: 0xc3bfb4 }),
    paver: stdMat(T.paver, { rx: 4, ry: 4, ns: 1.1, color: 0xb5b1a8 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.62, metalness: 0.55 }),
    lampHead: new THREE.MeshStandardMaterial({
      color: 0x22262b, roughness: 0.5, metalness: 0.4,
      emissive: 0xffb668, emissiveIntensity: 0.75,
    }),
    kioskA: stdMat(T.metal, { rx: 2, ry: 1, color: 0x515a48, rough: 0.8, metal: 0.25 }),
    kioskB: stdMat(T.metal, { rx: 2, ry: 1, color: 0x5a4f42, rough: 0.8, metal: 0.25 }),
  };

  // shared wall materials cache: buildings with the same texture family,
  // tint and quantized repeat reuse one material (GPU texture set) instead
  // of cloning three canvas textures per building
  const wallMatCache = new Map();
  function wallMatFor(texKey, colorHex, rx, ry) {
    const k = `${texKey}_${colorHex}_${rx}_${ry}`;
    let m = wallMatCache.get(k);
    if (!m) {
      m = stdMat(T[texKey], { rx, ry, color: colorHex, ns: 1.15 });
      wallMatCache.set(k, m);
    }
    return m;
  }

  // ---------------------------------------------------------------- fog + sky
  // fog matched to the sky shader's horizon band so distant geometry melts
  // into the dome instead of cutting out against a cooler milk wall
  scene.fog = new THREE.FogExp2(0xc2bdb0, 0.0095); // slightly thinner: cross streets must read
  scene.background = new THREE.Color(0xc2bdb0);

  const sunDir = V3(-0.45, -0.34, -0.83).normalize(); // FROM sun TO scene (downward)
  const sunPosDir = sunDir.clone().negate();          // toward the sun

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSun: { value: sunPosDir },
      uZenith: { value: new THREE.Color(0x46596b) },
      uMid: { value: new THREE.Color(0x8ba0af) },
      uHorizon: { value: new THREE.Color(0xafa896) },
      uWarm: { value: new THREE.Color(0xe6c493) },
      uGround: { value: new THREE.Color(0xc2bdb0) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uZenith, uMid, uHorizon, uWarm, uGround;
      varying vec3 vDir;
      float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), u.x),
                   mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float cfbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + 17.17; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        // vertical gradient: horizon haze -> mid -> steel zenith
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.11, h));
        col = mix(col, uZenith, smoothstep(0.10, 0.58, h));
        // warm bias toward sun azimuth near horizon (widened so the fog wall
        // inherits a sun-side warm gradient)
        vec3 sunFlat = normalize(vec3(uSun.x, 0.0, uSun.z));
        vec3 dFlat = normalize(vec3(d.x, 0.001, d.z));
        float az = dot(dFlat, sunFlat) * 0.5 + 0.5;
        float low = 1.0 - smoothstep(0.0, 0.28, abs(h));
        col = mix(col, uWarm, az * az * low * 0.42);
        // thin broken cloud sheet: cheap value-noise fbm projected on the dome
        vec2 cp = d.xz / max(d.y, 0.08);
        float cl = cfbm(cp * 1.1 + vec2(3.1, 7.7));
        cl = cl * 0.72 + cfbm(cp * 3.1 + vec2(11.0, 1.0)) * 0.28;
        float cmask = smoothstep(0.04, 0.13, h) * (1.0 - smoothstep(0.36, 0.55, h));
        float ca = smoothstep(0.5, 0.62, cl) * cmask * 0.22;
        vec3 ccol = mix(uMid * 1.14, uWarm * 1.05, az * az);
        col = mix(col, ccol, ca);
        // sun disc + layered glow
        float sd = dot(d, uSun);
        float glowWide = pow(max(sd, 0.0), 9.0);
        float glowTight = pow(max(sd, 0.0), 160.0);
        float disc = smoothstep(0.99938, 0.99965, sd);
        col += uWarm * glowWide * 0.22;
        col += vec3(1.0, 0.86, 0.66) * glowTight * 0.85;
        col += vec3(1.55, 1.28, 0.98) * disc;
        // below horizon: settle into ground haze
        col = mix(col, uGround, smoothstep(-0.02, -0.24, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 40, 24), skyMat);
  sky.frustumCulled = false;
  root.add(sky);

  // ---------------------------------------------------------------- lights
  const sun = new THREE.DirectionalLight(0xffe3c0, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const HALF = 55;
  sun.shadow.camera.left = -HALF; sun.shadow.camera.right = HALF;
  sun.shadow.camera.top = HALF; sun.shadow.camera.bottom = -HALF;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.03;
  root.add(sun);
  root.add(sun.target);

  // texel-snap basis for shadow recentering
  const SUN_DIST = 95;
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

  // sky bounce: lifted hemisphere + a dim shadowless fill from opposite the
  // sun azimuth so shadowed facades/asphalt keep form instead of crushing black
  const hemi = new THREE.HemisphereLight(0x93aac2, 0x5c554b, 1.4);
  root.add(hemi);
  const skyFill = new THREE.DirectionalLight(0x8fa3b8, 0.35);
  skyFill.castShadow = false;
  // direction mirrored from sunDir in X/Z, same downward Y
  skyFill.position.set(-0.45, 0.34, -0.83).multiplyScalar(60);
  root.add(skyFill);
  root.add(skyFill.target);

  // ---------------------------------------------------------------- ground + streets
  // dirt base reaches out under the skyline ring so elevated views never see
  // a ground edge; texture density kept at the old plane's ~4.5m/repeat
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), M.dirt);
  ground.material = stdMat(T.dirt, { rx: 155, ry: 155, ns: 1.4, color: 0xb9b0a2 });
  ground.rotation.x = -Math.PI / 2;
  add(ground, { collide: false, cast: false, surface: 'dirt' });
  colliders.push(new THREE.Box3(V3(-350, -2, -350), V3(350, 0, 350))); // floor

  const road = new THREE.Mesh(new THREE.PlaneGeometry(14, 124), M.asphalt);
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.04;
  add(road, { collide: false, cast: false });
  colliders.push(new THREE.Box3(V3(-7, -2, -62), V3(7, 0.04, 62))); // road surface

  // main-street sidewalks + curbs (landmark geometry — unchanged)
  for (const s of [-1, 1]) {
    const walk = box(3.5, 0.14, 124, M.sidewalk);
    walk.position.set(s * 8.75, 0.07, 0);
    add(walk, { cast: false });
    const curb = box(0.22, 0.19, 124, M.curb);
    curb.position.set(s * 7.05, 0.095, 0);
    add(curb, { collide: false, cast: false });
  }

  // ------------------------------------------------- city street grid
  // Avenues at x±38 (asphalt x 33..43), cross streets: North St through the
  // spawn intersection (z 46..54), Mid-North (z 17.5..24.5), Mid-South
  // (z -21.5..-15.5), SW service alley (z -51..-45, west only). All new
  // pavement merges into 3 meshes (roads / walks / curbs) with metric UVs.
  const mergeBins = { road: [], walk: [], curb: [] };
  function uvScale(geo, su, sv) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    return geo;
  }
  // w = width (across), len = length (along), alongZ orientation
  function roadPatch(cx, cz, w, len, alongZ = true) {
    const g = new THREE.PlaneGeometry(w, len);
    uvScale(g, w * 0.35, len * 0.33);
    g.rotateX(-Math.PI / 2);
    if (!alongZ) g.rotateY(Math.PI / 2);
    g.translate(cx, 0.038, cz);
    mergeBins.road.push(g);
    const hx = alongZ ? w / 2 : len / 2, hz = alongZ ? len / 2 : w / 2;
    colliders.push(new THREE.Box3(V3(cx - hx, -2, cz - hz), V3(cx + hx, 0.038, cz + hz)));
  }
  function walkPatch(cx, cz, w, len, alongZ = true) {
    const g = new THREE.BoxGeometry(w, 0.14, len);
    uvScale(g, w * 6.3, len * 0.0113);
    if (!alongZ) g.rotateY(Math.PI / 2);
    g.translate(cx, 0.07, cz);
    mergeBins.walk.push(g);
    const hx = alongZ ? w / 2 : len / 2, hz = alongZ ? len / 2 : w / 2;
    colliders.push(new THREE.Box3(V3(cx - hx, -1, cz - hz), V3(cx + hx, 0.14, cz + hz)));
  }
  function curbRun(cx, cz, len, alongZ = true) {
    const g = new THREE.BoxGeometry(0.22, 0.19, len);
    uvScale(g, len * 0.242, 0.25);
    if (!alongZ) g.rotateY(Math.PI / 2);
    g.translate(cx, 0.095, cz);
    mergeBins.curb.push(g);
  }

  // avenues (10m asphalt, z -58..56, ends capped with rubble later)
  for (const s of [-1, 1]) roadPatch(s * 38, -1, 10, 114);
  // cross streets
  roadPatch(0, 50, 108, 8, false);        // North St (through spawn intersection)
  roadPatch(0, 21, 108, 7, false);        // Mid-North St
  roadPatch(0, -18.5, 108, 6, false);     // Mid-South St
  roadPatch(-33.5, -48, 53, 6, false);    // SW service alley
  roadPatch(17.25, -10, 13.5, 8, false);  // parking lot pad (replaces a building lot)

  // avenue sidewalks: inner x±(30.5..33), outer x±(43..45.5); segments skip
  // every cross-street corridor so nothing overlaps the roadway
  const aveWalkSegs = {
    west: [[56, 60], [26.5, 44], [-14, 15.5], [-43.5, -21.5], [-60, -53]],
    east: [[56, 60], [26.5, 44], [-14, 15.5], [-60, -21.5]],
  };
  for (const s of [-1, 1]) {
    const segs = s < 0 ? aveWalkSegs.west : aveWalkSegs.east;
    for (const [z0, z1] of segs) {
      const cz = (z0 + z1) / 2, len = z1 - z0;
      walkPatch(s * 31.75, cz, 2.5, len);
      walkPatch(s * 44.25, cz, 2.5, len);
      curbRun(s * 33.11, cz, len);
      curbRun(s * 42.89, cz, len);
    }
  }
  // cross-street sidewalks (2m strips both sides, split around main + avenues)
  // arms start at x±10.5: the main-street sidewalk already covers 7..10.5
  const crossArms = [[10.5, 30.5], [-30.5, -10.5], [43, 60], [-60, -43]];
  function crossWalks(zLo, zHi, arms = crossArms) {
    for (const [x0, x1] of arms) {
      const cx = (x0 + x1) / 2, len = x1 - x0;
      walkPatch(cx, zLo - 1, 2, len, false);
      walkPatch(cx, zHi + 1, 2, len, false);
      curbRun(cx, zLo + 0.11, len, false);
      curbRun(cx, zHi - 0.11, len, false);
    }
  }
  crossWalks(46, 54);
  crossWalks(17.5, 24.5);
  crossWalks(-21.5, -15.5);
  // alley: single north-side walk, west arms only
  for (const [x0, x1] of [[-30.5, -10.5], [-60, -43]]) {
    walkPatch((x0 + x1) / 2, -44.25, 1.5, x1 - x0, false);
    curbRun((x0 + x1) / 2, -44.89, x1 - x0, false);
  }
  // corner pads where sidewalk loops turn at the avenues
  const padBands = [[44, 46], [24.5, 26.5], [15.5, 17.5], [-15.5, -13.5], [-23.5, -21.5]];
  for (const s of [-1, 1]) {
    for (const [z0, z1] of padBands) walkPatch(s * 31.75, (z0 + z1) / 2, 2.5, z1 - z0);
  }
  walkPatch(-31.75, -44.25, 2.5, 1.5); // alley corner (west)

  for (const [bin, mat, opts] of [
    ['road', M.asphaltU, { collide: false, cast: false }],
    ['walk', M.walkU, { collide: false, cast: false }],
    ['curb', M.curbU, { collide: false, cast: false, ray: false }],
  ]) {
    const merged = mergeGeometries(mergeBins[bin], false);
    add(new THREE.Mesh(merged, mat), opts);
  }

  // plaza pavers (west avenue, x -30.5..-23, z 26.5..33.5)
  {
    const g = uvScale(new THREE.PlaneGeometry(7.5, 7), 1.9, 1.75);
    g.rotateX(-Math.PI / 2);
    const plaza = new THREE.Mesh(g, M.paver);
    plaza.position.set(-26.75, 0.055, 30);
    add(plaza, { collide: false, cast: false });
  }

  // map bounds (invisible)
  invisibleWall(0, 62, 120, 2);
  invisibleWall(0, -62, 120, 2);
  invisibleWall(61.5, 0, 2, 120);
  invisibleWall(-61.5, 0, 2, 120);

  // ---------------------------------------------------------------- road markings
  // worn-paint alpha: chipped blotches + ragged edges so stripes read as old
  // paint, not fresh. Local PRNG so the shared rand() sequence stays untouched.
  function makeWornPaintTex() {
    let ps = 90210;
    const pr = (a, b) => { ps = (ps * 16807) % 2147483647; return a + ((ps - 1) / 2147483646) * (b - a); };
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
    const chip = (x, y, r0, a) => {
      const grd = g.createRadialGradient(x, y, 0.5, x, y, r0);
      grd.addColorStop(0, `rgba(0,0,0,${a})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r0, y - r0, r0 * 2, r0 * 2);
    };
    for (let i = 0; i < 70; i++) chip(pr(0, 128), pr(0, 128), pr(3, 13), pr(0.3, 0.85));
    for (let i = 0; i < 44; i++) { // eat the edges harder -> broken outline
      const edge = i % 4;
      const x = edge < 2 ? pr(0, 128) : (edge === 2 ? pr(-3, 8) : pr(120, 131));
      const y = edge >= 2 ? pr(0, 128) : (edge === 0 ? pr(-3, 8) : pr(120, 131));
      chip(x, y, pr(5, 15), pr(0.55, 1));
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }
  const lineGeo = new THREE.PlaneGeometry(1, 1);
  lineGeo.rotateX(-Math.PI / 2);
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0x97917f, roughness: 1, transparent: true, opacity: 0.5,
    alphaMap: makeWornPaintTex(),
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  // defs: [x, z, scaleX, scaleZ] — dashes, crosswalk stripes, stop lines,
  // parking stalls across the whole grid (one instanced draw)
  const lineDefs = [];
  for (let i = 0; i < 21; i++) // main street dashed center line (landmark)
    lineDefs.push([rr(-0.04, 0.04), -58 + i * 5.8 + rr(-0.2, 0.2), 0.16, 2.6]);
  for (let i = 0; i < 7; i++) // crosswalk near spawn (landmark)
    lineDefs.push([-5.4 + i * 1.8, 43, 0.6, 3.4]);
  lineDefs.push([0, 46, 12.6, 0.4]); // stop line (landmark)
  for (const s of [-1, 1]) // avenue center dashes
    for (let i = 0; i < 19; i++)
      lineDefs.push([s * 38 + rr(-0.05, 0.05), -55 + i * 5.9 + rr(-0.2, 0.2), 0.16, 2.6]);
  for (const cz of [50, 21, -18.5]) // cross-street dashes (skip intersections)
    for (let i = 0; i < 19; i++) {
      const x = -55 + i * 5.9 + rr(-0.3, 0.3);
      if (Math.abs(x) < 9 || Math.abs(Math.abs(x) - 38) < 7) continue;
      lineDefs.push([x, cz + rr(-0.05, 0.05), 2.6, 0.16]);
    }
  for (let i = 0; i < 7; i++) { // crosswalks at Mid-North / Mid-South on main
    lineDefs.push([-5.4 + i * 1.8, 25.5, 0.6, 2.2]);
    lineDefs.push([-5.4 + i * 1.8, -14.5, 0.6, 2.2]);
  }
  lineDefs.push([0, 27.2, 12.6, 0.35], [0, -12.8, 12.6, 0.35]); // stop lines
  for (const s of [-1, 1]) // avenue crosswalks where the walk loops cross
    for (const cz of [40, -40])
      for (let i = 0; i < 6; i++)
        lineDefs.push([s * 38 - 3.75 + i * 1.5, cz, 0.5, 2.8]);
  for (const sx of [12, 14.7, 17.4, 20.1, 22.8]) // parking stall lines
    for (const sz of [-8.5, -12.9])
      lineDefs.push([sx, sz, 0.14, 4.2]);
  const lines = new THREE.InstancedMesh(lineGeo, lineMat, lineDefs.length);
  lines.castShadow = false; lines.receiveShadow = true;
  {
    const m = new THREE.Matrix4();
    lineDefs.forEach((d, i) => {
      m.makeScale(d[2], 1, d[3]);
      m.setPosition(d[0], 0.055, d[1]);
      lines.setMatrixAt(i, m);
    });
    lines.instanceMatrix.needsUpdate = true;
  }
  root.add(lines);

  // traffic-polished wheel tracks: soft dark lanes so the asphalt isn't a
  // single homogeneous speckle field. Tileable along length (periodic sines).
  function makeTrackTex() {
    const c = document.createElement('canvas'); c.width = 32; c.height = 256;
    const g = c.getContext('2d');
    const id = g.createImageData(32, 256);
    for (let y = 0; y < 256; y++) {
      const t = y / 256;
      const wob = Math.sin(t * Math.PI * 2 * 3) * 2.6 + Math.sin(t * Math.PI * 2 * 7 + 2.1) * 1.8;
      let amp = 0.62 + 0.38 * Math.sin(t * Math.PI * 2 * 5 + 1.2) * Math.sin(t * Math.PI * 2 * 2);
      for (let x = 0; x < 32; x++) {
        const d = Math.abs(x - 15.5 - wob) / 14;
        const a = Math.max(0, 1 - d * d * 2.4) * amp;
        const j = (y * 32 + x) * 4;
        const v = a * 255;
        id.data[j] = v; id.data[j + 1] = v; id.data[j + 2] = v; id.data[j + 3] = 255;
      }
    }
    g.putImageData(id, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  {
    const trackTexBase = makeTrackTex();
    const trackGeo = new THREE.PlaneGeometry(1, 1);
    trackGeo.rotateX(-Math.PI / 2);
    const trackXs = [-3.2, -1.15, 1.15, 3.2];
    for (let i = 0; i < trackXs.length; i++) {
      const tt = trackTexBase.clone();
      tt.repeat.set(1, 9);
      tt.offset.set(0, i * 0.31);
      tt.needsUpdate = true;
      const tm = new THREE.MeshStandardMaterial({
        color: 0x181614, roughness: 1, transparent: true, opacity: 0.26,
        alphaMap: tt, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
      const track = new THREE.Mesh(trackGeo, tm);
      track.position.set(trackXs[i], 0.048, 0);
      track.scale.set(0.85, 1, 118);
      track.castShadow = false; track.receiveShadow = true;
      root.add(track);
    }
  }

  const updaters = [];

  // ---------------------------------------------------------------- instanced sets
  // Unit geometries, matrices give size. One draw call per family.
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
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(),
        _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  function inst(im, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
    _p.set(x, y, z); _s.set(sx, sy, sz);
    _q.setFromEuler(_e.set(rx, ry, rz));
    _m4.compose(_p, _q, _s);
    im.setMatrixAt(im.count++, _m4);
  }

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  // window glass / trim / brick split into west|center|east bands: keeps each
  // InstancedMesh's bounding sphere tight so LOS/bullet raycasts and frustum
  // culling reject whole districts instead of testing every instance
  const mkBand = (mat, max, o) => [
    makeInst(unitBox, mat, max.w, o), makeInst(unitBox, mat, max.c, o), makeInst(unitBox, mat, max.e, o),
  ];
  // trim/side-brick skip the bullet-raycast lists: sills and far rubble are
  // 3cm proud of walls — a pass-through decal lands invisibly close behind,
  // and dropping ~8k instance sphere-tests keeps enemy LOS rays at the old cost
  const glassBand = mkBand(M.glass, { w: 850, c: 950, e: 850 }, { cast: false });
  const trimBand = mkBand(M.trim, { w: 2000, c: 2200, e: 2000 }, { ray: false });
  trimBand[0].castShadow = trimBand[2].castShadow = false; // side-district sills/parapets: no shadow pass
  const brickBand = mkBand(M.brickA, { w: 400, c: 800, e: 400 });
  brickBand[0].userData.noRay = true; // kept raycastable only in the center band
  raycastMeshes.splice(raycastMeshes.indexOf(brickBand[0]), 1);
  raycastMeshes.splice(raycastMeshes.indexOf(brickBand[2]), 1);
  brickBand[0].castShadow = brickBand[2].castShadow = false; // avenue rubble: AO carries it
  // current-band bindings: setBand() retargets every glassInst/trimInst/
  // brickInst reference (building interiors + street scatter alike)
  let glassInst = glassBand[1], trimInst = trimBand[1], brickInst = brickBand[1];
  let BAND = { glass: glassInst, trim: trimInst, brick: brickInst };
  function setBand(x) {
    const i = x < -15 ? 0 : x > 15 ? 2 : 1;
    glassInst = glassBand[i]; trimInst = trimBand[i]; brickInst = brickBand[i];
    BAND = { glass: glassInst, trim: trimInst, brick: brickInst };
  }
  const woodInst = makeInst(unitBox, M.wood, 140, { surface: 'concrete' });
  const metalInst = makeInst(unitBox, M.metal, 430, { surface: 'metal', ray: false });
  const drumGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.88, 14);
  const drumInst = makeInst(drumGeo, M.rust, 36, { surface: 'metal' });
  const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  const cylInst = makeInst(unitCyl, M.rust, 330, { surface: 'metal', ray: false, cast: false }); // vents, tanks, downpipes
  const bagGeo = new THREE.SphereGeometry(0.5, 8, 6);
  const bagInst = makeInst(bagGeo, M.sandbag, 330, { surface: 'dirt' });
  const debrisGeo = new THREE.DodecahedronGeometry(0.5, 0);
  const debrisInst = makeInst(debrisGeo, M.concB, 950, { ray: false, cast: false });
  const paperGeo = new THREE.PlaneGeometry(1, 1); paperGeo.rotateX(-Math.PI / 2);
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xafa997, roughness: 1, side: THREE.DoubleSide });
  const paperInst = makeInst(paperGeo, paperMat, 340, { cast: false, ray: false });
  const patchMat = new THREE.MeshStandardMaterial({
    color: 0x35322d, roughness: 1, transparent: true, opacity: 0.62,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const patchInst = makeInst(paperGeo.clone(), patchMat, 100, { cast: false, ray: false, recv: true });
  // streetlight family: pole, angled arm, emissive head — 3 draws for all
  const lampPoleGeo = new THREE.CylinderGeometry(0.075, 0.12, 1, 8);
  const lampPoleInst = makeInst(lampPoleGeo, M.lamp, 30, { surface: 'metal', ray: false });
  const lampArmInst = makeInst(unitBox, M.lamp, 30, { surface: 'metal', ray: false });
  const lampHeadInst = makeInst(unitBox, M.lampHead, 30, { surface: 'metal', ray: false });

  // ---------------------------------------------------------------- scorch decal texture
  function makeScorchTex() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    const grd = g.createRadialGradient(64, 96, 6, 64, 96, 78);
    grd.addColorStop(0, 'rgba(12,10,8,0.92)');
    grd.addColorStop(0.45, 'rgba(16,14,12,0.72)');
    grd.addColorStop(1, 'rgba(20,18,16,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    // upward licks
    for (let i = 0; i < 10; i++) {
      const x = 26 + i * 8 + Math.sin(i * 3.7) * 5;
      const h = 44 + Math.abs(Math.sin(i * 2.3)) * 46;
      const lg = g.createLinearGradient(0, 100, 0, 100 - h);
      lg.addColorStop(0, 'rgba(10,9,8,0.85)');
      lg.addColorStop(1, 'rgba(10,9,8,0)');
      g.fillStyle = lg;
      g.fillRect(x - 4, 100 - h, 8, h);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const scorchMat = new THREE.MeshStandardMaterial({
    map: makeScorchTex(), transparent: true, roughness: 1, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const scorchGeo = new THREE.PlaneGeometry(1, 1);
  function scorch(x, y, z, ry, w = 2.6, h = 3.4) {
    const d = new THREE.Mesh(scorchGeo, scorchMat);
    d.position.set(x, y, z); d.rotation.y = ry; d.scale.set(w, h, 1);
    bakeMesh(d, { collide: false, ray: false, cast: false });
  }

  // ---------------------------------------------------------------- buildings
  const wallMats = {
    brickA: M.brickA, brickB: M.brickB, plasterA: M.plasterA,
    plasterB: M.plasterB, concA: M.concA, concB: M.concB,
  };
  // lit windows: [buildingIndex, story, col, colorHex] — warm amber kept below
  // clip so the glow reads as interior light, not a white hole
  const litPicks = {
    1: [1, 1, 0xff9a45], 3: [2, 2, 0xff8f38], 10: [1, 3, 0x86a9d8],
    13: [2, 1, 0xff9a45], 20: [2, 2, 0xff8f38], 26: [4, 3, 0x86a9d8],
    32: [3, 2, 0xffa04c],
  };
  const litMeshes = [];

  const CURB_X = 10.5; // facade line

  // rubble mound: 40-80 brick/concrete chunks piled in a rough cone against a wall
  function rubbleMound(fx, side, cz, spread = 2.0) {
    const n = Math.round(rr(40, 80));
    for (let i = 0; i < n; i++) {
      const dd = rand();                       // 0 at wall -> 1 out on sidewalk
      const off = dd * dd * 2.1 + 0.12;
      const dz = rand() + rand() - 1;          // triangular: piles at center
      const z = cz + dz * spread;
      const hNorm = Math.max(0, 1 - off / 2.0) * Math.max(0.08, 1 - Math.abs(dz) * 0.9);
      const y = 0.06 + hNorm * hNorm * rr(0.7, 1.3);
      const s = rr(0.1, 0.5);
      const im = i % 3 === 0 ? debrisInst : BAND.brick;
      inst(im, fx - side * off, y, z,
        s, s * rr(0.5, 0.9), s * rr(0.7, 1.2),
        rr(0, Math.PI), rr(-0.5, 0.5), rr(-0.5, 0.5));
    }
    obbCollider(fx - side * 0.6, 0.3, cz, 0.8, 0.3, spread * 0.7, 0);
  }

  // segmented parapet run with per-building height jitter + broken gaps.
  // skipBox (optional) = {x0,x1,z0,z1}: bite region where the roofline is gone.
  function parapets(xc, zc, d, w, H, skipBox, lite) {
    const pT = 0.28;
    const baseH = rr(0.35, 0.78); // per-building parapet height
    const run = (cx, cz, alongZ, len) => {
      let t = -len / 2;
      while (t < len / 2 - 0.15) {
        const seg = Math.min(lite ? rr(2.5, 4.4) : rr(1.3, 2.7), len / 2 - t);
        const mid = t + seg / 2;
        const px = alongZ ? cx : cx + mid;
        const pz = alongZ ? cz + mid : cz;
        t += seg + 0.02;
        if (skipBox && px > skipBox.x0 && px < skipBox.x1 && pz > skipBox.z0 && pz < skipBox.z1) continue;
        if (rand() < 0.13) { // broken gap: drop a couple of bricks on the roof edge
          inst(BAND.brick, px + rr(-0.2, 0.2), H + 0.12, pz + rr(-0.2, 0.2),
            rr(0.25, 0.45), rr(0.12, 0.2), rr(0.25, 0.4), rr(0, Math.PI), 0, rr(-0.3, 0.3));
          continue;
        }
        const hh = baseH * rr(0.72, 1.28);
        inst(BAND.trim, px, H + hh / 2, pz,
          alongZ ? pT : seg, hh, alongZ ? seg : pT);
      }
    };
    run(xc, zc - w / 2 + pT / 2, false, d);
    run(xc, zc + w / 2 - pT / 2, false, d);
    run(xc - d / 2 + pT / 2, zc, true, w);
    run(xc + d / 2 - pT / 2, zc, true, w);
  }

  // ------------------------------------------------- enterable interiors
  // "qu'on puisse rentrer dans les maisons et tirer des fenêtres": hollow
  // ground floor, concrete stair, walkable floor-1 slab, and OPEN firing
  // windows — the door/window rects are true gaps in geometry AND colliders.
  const interiorGlowMat = new THREE.MeshStandardMaterial({
    color: 0x060504, emissive: 0xffb877, emissiveIntensity: 0.55, roughness: 1,
  });
  const enterables = []; // probe/debug: key nav points per enterable building
  function enterableShell(bi, fx, dir, zc, w, d, H, mat, cols, span) {
    const T = 0.32;
    const doorCol = bi % cols;
    const doorU = -span / 2 + doorCol * 2.2;
    const openCols = new Set(cols >= 5
      ? [1, Math.floor(cols / 2), cols - 2]
      : [0, cols - 1]);
    const holes = [{ u0: doorU - 0.66, u1: doorU + 0.66, y0: 0, y1: 2.45 }];
    for (const c of openCols) {
      const u = -span / 2 + c * 2.2;
      holes.push({ u0: u - 0.6, u1: u + 0.6, y0: 4.2, y1: 5.3 });
    }
    // uv remap keeps the brick/plaster courses continuous across segments
    const remap = (g, uf0, ufl, vf0, vfl) => {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uf0 + uv.getX(i) * ufl, vf0 + uv.getY(i) * vfl);
      return g;
    };
    const emitFacade = (u0, u1, y0, y1) => {
      if (u1 - u0 < 0.02 || y1 - y0 < 0.02) return;
      const g = remap(new THREE.BoxGeometry(T, y1 - y0, u1 - u0),
        (u0 + w / 2) / w, (u1 - u0) / w, y0 / H, (y1 - y0) / H);
      const m = new THREE.Mesh(g, mat);
      m.position.set(fx + dir * (T / 2), (y0 + y1) / 2, zc + (u0 + u1) / 2);
      bakeMesh(m);
    };
    const ys = [0, 2.45, 4.2, 5.3, 6];
    for (let i = 0; i < ys.length - 1; i++) {
      const y0 = ys[i], y1 = ys[i + 1];
      const bandHoles = holes
        .filter((h) => h.y0 <= y0 + 0.01 && h.y1 >= y1 - 0.01)
        .sort((a, b) => a.u0 - b.u0);
      let u = -w / 2;
      for (const h of bandHoles) { emitFacade(u, h.u0, y0, y1); u = h.u1; }
      emitFacade(u, w / 2, y0, y1);
    }
    // rear + side walls (ground+first floor), solid block above
    const rear = new THREE.Mesh(
      remap(new THREE.BoxGeometry(T, 6, w), 0, 1, 0, 6 / H), mat);
    rear.position.set(fx + dir * (d - T / 2), 3, zc);
    bakeMesh(rear);
    for (const s of [-1, 1]) {
      const sw = new THREE.Mesh(
        remap(new THREE.BoxGeometry(d - 2 * T, 6, T), 0, 1, 0, 6 / H), mat);
      sw.position.set(fx + dir * (d / 2), 3, zc + s * (w / 2 - T / 2));
      bakeMesh(sw);
    }
    const up = new THREE.Mesh(
      remap(new THREE.BoxGeometry(d, H - 6, w), 0, 1, 6 / H, (H - 6) / H), mat);
    up.position.set(fx + dir * (d / 2), 6 + (H - 6) / 2, zc);
    bakeMesh(up);
    // interior concrete floor pad
    const pad = box(d - 2 * T, 0.08, w - 2 * T, M.concrete);
    pad.position.set(fx + dir * (d / 2), 0.05, zc);
    bakeMesh(pad, { cast: false });
    // floor-1 slab with a stair hole on the side away from the door
    const sSt = doorU > 0 ? -1 : 1;
    const iu0 = -w / 2 + T, iu1 = w / 2 - T;
    const hu0 = sSt > 0 ? iu1 - 1.3 : iu0;
    const hu1 = sSt > 0 ? iu1 : iu0 + 1.3;
    const slabPiece = (a0, a1, u0, u1) => {
      if (a1 - a0 < 0.05 || u1 - u0 < 0.05) return;
      const m = box(a1 - a0, 0.26, u1 - u0, M.concB);
      m.position.set(fx + dir * ((a0 + a1) / 2), 3.0, zc + (u0 + u1) / 2);
      bakeMesh(m);
    };
    slabPiece(T, 1.6, iu0, iu1);
    slabPiece(1.6, 4.15, sSt > 0 ? iu0 : hu1, sSt > 0 ? hu0 : iu1);
    slabPiece(4.15, d - T, iu0, iu1);
    // chunky concrete stair: 6 risers of 0.525 (player auto-step is 0.55)
    const uSt = (hu0 + hu1) / 2;
    for (let i = 0; i < 6; i++) {
      const topY = 0.525 * (i + 1);
      const deep = i === 5 ? 0.78 : 0.5;
      const st = box(deep, topY, 1.2, M.concB);
      st.position.set(fx + dir * (1.35 + i * 0.47 + (i === 5 ? 0.14 : 0)), topY / 2, zc + uSt);
      bakeMesh(st);
    }
    // dim interior glow panel on the floor-1 rear wall + sparse dressing
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), interiorGlowMat);
    glow.position.set(fx + dir * (d - T - 0.02), 4.6, zc - sSt * w * 0.15);
    glow.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    bakeMesh(glow, { collide: false, ray: false, cast: false });
    inst(woodInst, fx + dir * (d * 0.55), 0.4, zc - sSt * (w * 0.22), 0.8, 0.8, 0.8, rr(0, 3));
    inst(woodInst, fx + dir * (d * 0.4), 3.53, zc + uSt * 0.3, 0.7, 0.7, 0.7, rr(0, 3));
    for (let i = 0; i < 5; i++) {
      inst(paperInst, fx + dir * rr(1, d - 1), 0.1, zc + rr(-w / 2 + 0.6, w / 2 - 0.6),
        rr(0.18, 0.32), 1, rr(0.2, 0.36), rr(0, Math.PI * 2));
    }
    // door markers: sandbag pair just outside
    inst(bagInst, fx - dir * 0.55, 0.14, zc + doorU + 0.82, 0.6, 0.3, 0.42, rr(0, 2));
    inst(bagInst, fx - dir * 0.5, 0.14, zc + doorU - 0.85, 0.62, 0.3, 0.44, rr(0, 2));
    const firstOpen = -span / 2 + [...openCols][0] * 2.2;
    enterables.push({
      door: [fx - dir * 1.1, zc + doorU], inside: [fx + dir * 2.2, zc + doorU],
      stairBase: [fx + dir * 1.0, zc + uSt], stairTop: [fx + dir * 3.9, zc + uSt],
      slab: [fx + dir * (d * 0.55), zc], win: [fx + dir * 0.9, zc + firstOpen],
      winOut: [fx - dir * 7, zc + firstOpen], dir,
    });
    return { doorCol, openCols };
  }

  // fx = facade plane x, dir = inward x direction (+1 body extends toward +x),
  // zc = facade center z. o: { wrapN/wrapS: full window grid on that z face
  // (corner buildings wrap onto cross streets), lite: cheaper far-row
  // dressing, enter: hollow ground floor + firing positions upstairs }
  function building(bi, fx, dir, zc, w, d, stories, matName, damage, o = {}) {
    const H = stories * 3;
    const xc = fx + dir * (d / 2);
    setBand(xc);
    const side = dir; // outward offsets below written as fx - side * k
    const texKey = matName.startsWith('brick') ? 'brick' : matName.startsWith('plaster') ? 'plaster' : 'concrete';
    const mat = wallMatFor(texKey, wallMats[matName].color.getHex(),
      Math.min(5, Math.max(2, Math.round(w / 3.4))), Math.min(7, Math.max(2, Math.round(H / 3.4))));
    // window grid layout (also drives the enterable shell)
    const cols = Math.max(2, Math.floor((w - 2.2) / 2.2));
    const span = (cols - 1) * 2.2;
    const doorCol = bi % cols;
    // damage bite: top-floor corner bay chunk removed (~1/3 of buildings)
    const bite = damage === 1 && stories >= 3 && !o.enter;
    const bodyH = bite ? H - 3 : H;
    let enterInfo = null;
    if (o.enter) {
      enterInfo = enterableShell(bi, fx, dir, zc, w, d, H, mat, cols, span);
    } else {
      const body = box(d, bodyH, w, mat);
      body.position.set(xc, bodyH / 2, zc);
      bakeMesh(body);
    }
    if (bite) colliders.push(new THREE.Box3( // keep full-height blocker
      V3(Math.min(xc - d / 2, xc + d / 2), bodyH, zc - w / 2),
      V3(Math.max(xc - d / 2, xc + d / 2), H, zc + w / 2)));

    // --- top story built from per-bay facade boxes when bitten
    let biteBox = null, biteMidZ = 0;
    if (bite) {
      const FT = 1.3;                       // facade slab thickness
      const core = box(d - FT, 3, w, mat);  // back core of the top story
      core.position.set(xc + side * (FT / 2), H - 1.5, zc);
      bakeMesh(core, { collide: false });
      const nb = Math.max(3, Math.round(w / 2.2));
      const bw = w / nb;
      const biteEnd = bi === 3 ? -1 : 1;     // most bites face the spawn-side corner
      const nBite = bi % 4 === 3 ? 3 : 2;    // bays gone
      const fxc = fx + side * (FT / 2);
      for (let b = 0; b < nb; b++) {
        const ti = biteEnd > 0 ? nb - 1 - b : b; // index counted from bite corner
        const bz = zc - w / 2 + bw * (b + 0.5);
        if (ti < nBite - 1) continue;            // fully collapsed bay
        if (ti === nBite - 1) {                  // ragged stub at the bite edge
          const sh = rr(0.6, 1.5);
          const stub = box(FT, sh, bw * rr(0.7, 1), mat);
          stub.position.set(fxc, H - 3 + sh / 2, bz);
          stub.rotation.x = rr(-0.04, 0.04);
          bakeMesh(stub, { collide: false });
          continue;
        }
        const bay = box(FT, 3, bw, mat);
        bay.position.set(fxc, H - 1.5, bz);
        bakeMesh(bay, { collide: false });
        // window in the surviving bay
        inst(glassInst, fx + side * 0.045, H - 1.25, bz, 0.16, 1.55, Math.min(1.15, bw - 0.7));
        inst(trimInst, fx - side * 0.03, H - 0.39, bz, 0.24, 0.15, Math.min(1.42, bw - 0.5));
      }
      const biteW = bw * (nBite - 0.1);
      const z0 = biteEnd > 0 ? zc + w / 2 - biteW : zc - w / 2;
      const z1 = biteEnd > 0 ? zc + w / 2 : zc - w / 2 + biteW;
      biteMidZ = (z0 + z1) / 2;
      biteBox = {
        x0: Math.min(fx, fx + side * (FT + 0.4)) - 0.3,
        x1: Math.max(fx, fx + side * (FT + 0.4)) + 0.3,
        z0: z0 - 0.25, z1: z1 + 0.25,
      };
      // dark interior backing plane behind the missing bays
      const backing = box(0.1, 2.9, biteW, M.dark);
      backing.position.set(fx + side * (FT - 0.04), H - 1.55, biteMidZ);
      bakeMesh(backing, { collide: false, cast: false });
      // protruding floor-slab edge at the bite
      const slabEdge = box(FT + 0.5, 0.2, biteW + 0.25, M.concB);
      slabEdge.position.set(fx + side * ((FT - 0.5) / 2), H - 3 + 0.1, biteMidZ);
      bakeMesh(slabEdge, { collide: false });
      // loose bricks on the exposed slab
      for (let i = 0; i < 8; i++) {
        inst(brickInst, fx + side * rr(0.1, FT - 0.2), H - 3 + 0.28, biteMidZ + rr(-biteW / 2, biteW / 2),
          rr(0.25, 0.55), rr(0.14, 0.26), rr(0.25, 0.5), rr(0, Math.PI), 0, rr(-0.35, 0.35));
      }
      scorch(fx - side * 0.02, H - 3.6, biteMidZ, side > 0 ? -Math.PI / 2 : Math.PI / 2, 3.4, 3.8);
    }

    // parapet caps: jittered heights, broken gaps, skipping the bite
    parapets(xc, zc, d, w, H, biteBox, o.lite);

    // --- rooftop dressing: HVAC boxes, vent pipes, water tank
    const nAC = 1 + (bi % 3);
    for (let i = 0; i < nAC; i++) {
      inst(metalInst, xc + rr(-d / 4, d / 4), H + 0.3, zc + rr(-w / 3, w / 3),
        rr(0.9, 1.5), rr(0.5, 0.75), rr(0.7, 1.1), rr(0, Math.PI));
    }
    const nVent = 2 + (bi % 2);
    for (let i = 0; i < nVent; i++) {
      const vh = rr(0.5, 1.1);
      inst(cylInst, xc + side * rr(0, d / 4) + rr(-d / 5, d / 5), H + vh / 2, zc + rr(-w / 2.6, w / 2.6),
        rr(0.24, 0.4), vh, rr(0.24, 0.4));
    }
    { // water tank on a low plinth, kept toward the back of the roof
      const tr = rr(1.5, 2.2), th = rr(1.5, 2.1);
      const tx = xc + side * rr(d / 8, d / 4.5);
      const tz = zc + rr(-w / 4, w / 4);
      inst(trimInst, tx, H + 0.14, tz, tr * 0.66, 0.28, tr * 0.66, rr(0, Math.PI));
      inst(cylInst, tx, H + 0.28 + th / 2, tz, tr, th, tr);
      inst(cylInst, tx, H + 0.28 + th + 0.09, tz, tr * 0.86, 0.18, tr * 0.86); // lid
    }

    // window grid on street facade
    const lit = litPicks[bi];
    const stMax = bite ? stories - 1 : stories; // bitten top story handled above
    for (let st = 0; st < stMax; st++) {
      for (let c = 0; c < cols; c++) {
        const wz = zc - span / 2 + c * 2.2;
        const wy = st * 3 + 1.75;
        if (st === 0 && c === doorCol) {
          // doorway: enterable = real opening; otherwise dark recess
          if (!o.enter) inst(glassInst, fx + side * 0.09, 1.28, wz, 0.2, 2.56, 1.3);
          inst(trimInst, fx - side * 0.02, 2.68, wz, 0.3, 0.18, 1.55);
          inst(trimInst, fx - side * 0.25, 0.09, wz, 0.5, 0.18, 1.6);
          continue;
        }
        if (enterInfo && st === 1 && enterInfo.openCols.has(c)) {
          // open firing window: sill + lintel frame a real gap
          inst(trimInst, fx - side * 0.03, wy + 0.86, wz, 0.24, 0.15, 1.42);
          inst(trimInst, fx - side * 0.04, wy - 0.85, wz, 0.28, 0.1, 1.42);
          continue;
        }
        // glass slab sits nearly flush; lintel/sill protrude past it -> recess read
        inst(glassInst, fx + side * 0.045, wy, wz, 0.16, 1.55, 1.15);
        inst(trimInst, fx - side * 0.03, wy + 0.86, wz, 0.24, 0.15, 1.42);
        if (!o.lite) inst(trimInst, fx - side * 0.04, wy - 0.85, wz, 0.28, 0.1, 1.42);
        if (lit && lit[0] === st && lit[1] === c) {
          const lm = new THREE.Mesh(
            new THREE.PlaneGeometry(1.05, 1.42),
            new THREE.MeshStandardMaterial({
              color: 0x000000, emissive: lit[2], emissiveIntensity: 0.95,
              roughness: 1,
            }));
          lm.position.set(fx - side * 0.09, wy, wz);
          lm.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
          lm.userData.tv = bi === 10; // the old spill light window: TV flicker
          root.add(lm);
          litMeshes.push(lm);
        }
      }
    }
    // windows on z faces: FULL grid + sills + doorway where the face wraps
    // onto a cross street (corner buildings), sparse alley windows elsewhere,
    // none on lite far rows
    const dCols = Math.max(1, Math.floor((d - 2.4) / 2.6));
    const dSpan = (dCols - 1) * 2.6;
    for (const zi of [-1, 1]) {
      const wrap = (zi > 0 && o.wrapN) || (zi < 0 && o.wrapS);
      if (o.lite && !wrap) continue;
      const fz = zc + zi * (w / 2);
      for (let st = 0; st < stories; st++) {
        if (!wrap && (st + bi) % 2 === 0) continue; // sparser
        if (bite && st === stories - 1) continue; // top story is bays/core
        for (let c = 0; c < dCols; c++) {
          const wx = xc - dSpan / 2 + c * 2.6;
          const wy = st * 3 + 1.75;
          if (wrap && st === 0 && c === (bi % dCols)) { // corner doorway
            inst(glassInst, wx, 1.28, fz - zi * 0.02, 1.3, 2.56, 0.2);
            inst(trimInst, wx, 2.68, fz + zi * 0.04, 1.55, 0.18, 0.3);
            continue;
          }
          inst(glassInst, wx, wy, fz, 1.15, 1.55, 0.14);
          inst(trimInst, wx, wy + 0.86, fz + zi * 0.05, 1.42, 0.15, 0.24);
          if (wrap) inst(trimInst, wx, wy - 0.85, fz + zi * 0.06, 1.42, 0.1, 0.28);
        }
      }
    }

    // --- facade dressing: wall AC units + downpipes at irregular intervals
    const nWallAC = o.lite ? 0 : 1 + (bi % 3);
    for (let i = 0; i < nWallAC; i++) {
      const st = 1 + Math.floor(rand() * Math.max(1, stMax - 1));
      const c = Math.floor(rand() * Math.max(1, cols - 1));
      const wz = zc - span / 2 + (c + 0.5) * 2.2; // between window columns
      inst(metalInst, fx - side * 0.34, st * 3 + 2.3, wz,
        0.62, rr(0.42, 0.55), rr(0.75, 0.9), 0, 0, side * rr(-0.05, 0.02));
      inst(trimInst, fx - side * 0.15, st * 3 + 1.98, wz, 0.34, 0.08, 0.8); // bracket
    }
    for (const ze of bi % 2 ? [-1] : [-1, 1]) { // 1-2 downpipes at facade edges
      const pz = zc + ze * (w / 2 - rr(0.35, 0.7));
      inst(cylInst, fx - side * 0.14, bodyH / 2, pz, 0.17, bodyH - 0.4, 0.17);
      inst(cylInst, fx - side * 0.3, 0.35, pz, 0.15, 0.7, 0.15, 0, 0, side * 0.9); // shoe
    }

    // damage
    if (damage === 1) {
      const cz = bite ? THREE.MathUtils.clamp(biteMidZ, zc - w / 2 + 1.6, zc + w / 2 - 1.6) : zc + w / 2 - 1.2;
      if (o.tidy) {
        // facade-hugging debris only: this frontage carries a pedestrian
        // loop, so the sidewalk stays passable
        for (let i = 0; i < 16; i++) {
          const s = rr(0.12, 0.4);
          inst(i % 3 === 0 ? debrisInst : BAND.brick,
            fx - side * rr(0.08, 0.62), 0.07 + rr(0, 0.2), cz + rr(-1.6, 1.6),
            s, s * rr(0.5, 0.9), s * rr(0.7, 1.2), rr(0, Math.PI), 0, rr(-0.4, 0.4));
        }
        obbCollider(fx - side * 0.3, 0.22, cz, 0.38, 0.22, 1.5, 0);
      } else {
        // rubble mound spilled against the base
        rubbleMound(fx, side, cz, rr(1.8, 2.6));
        // leaning slab at base
        const slab = box(0.35, 4.4, 2.6, M.concB);
        slab.position.set(fx - side * 1.15, 1.9, cz);
        slab.rotation.z = side * 0.42;
        bakeMesh(slab, { collide: false });
        obbCollider(fx - side * 1.15, 1.4, cz, 1.15, 1.4, 1.35, 0);
      }
      scorch(fx - side * 0.02, bite ? H - 4.4 : H - 2.2, cz - 0.6, side > 0 ? -Math.PI / 2 : Math.PI / 2, 3.6, 4.4);
    } else if (damage === 2) {
      scorch(fx - side * 0.02, 4.6, zc - span / 2 + (bi % cols) * 2.2, side > 0 ? -Math.PI / 2 : Math.PI / 2);
      scorch(fx - side * 0.02, 7.4, zc + 1.1, side > 0 ? -Math.PI / 2 : Math.PI / 2, 2.2, 3.0);
      // lighter rubble scatter at scorched buildings
      const cz = zc + rr(-w / 4, w / 4);
      for (let i = 0; i < 14; i++) {
        const s = rr(0.1, 0.42);
        inst(i % 3 === 0 ? debrisInst : brickInst, fx - side * rr(0.15, 1.4), 0.08 + rr(0, 0.16), cz + rr(-1.8, 1.8),
          s, s * rr(0.5, 0.9), s * rr(0.7, 1.2), rr(0, Math.PI), 0, rr(-0.4, 0.4));
      }
    }
  }

  // [fx, dir, zc, w, d, stories, material, damage(0|1 corner|2 scorch), opts]
  // Rows: main street (fx ±10.5), avenue inner (±30.5), avenue outer (±45.5).
  // Gaps between lots fall on the cross streets (z≈50 / 21 / -18.5 / -48).
  const N = null;
  const B = [
    // -- main street, west row (0-6)
    [-10.5, -1, 39.25, 9.5, 12, 4, 'brickA', 0, { wrapN: 1, enter: 1 }], // sniper nest over the spawn block
    [-10.5, -1, 30.25, 7, 10, 3, 'plasterA', 1, { wrapS: 1 }],
    [-10.5, -1, 9, 12, 12, 5, 'concA', 2, { wrapN: 1 }],
    [-10.5, -1, -6, 13, 11, 3, 'brickB', 1, { wrapS: 1 }],
    [-10.5, -1, -29, 10, 12, 4, 'plasterB', 0, { wrapN: 1, enter: 1 }],
    [-10.5, -1, -39.5, 8, 10, 2, 'concB', 1, { wrapS: 1 }],
    [-10.5, -1, -55.5, 7, 10, 3, 'brickA', 2, { wrapN: 1 }],
    // -- main street, east row (7-11); the z -16..-6 lot is the parking lot
    [10.5, 1, 38.5, 11, 12, 3, 'plasterB', 2, { wrapN: 1 }],
    [10.5, 1, 29.5, 5.5, 10, 4, 'brickA', 1, { wrapS: 1 }],
    [10.5, 1, 6, 16, 13, 5, 'concB', 0, { enter: 1 }],
    [10.5, 1, -30.5, 14, 11, 4, 'plasterA', 2, { wrapN: 1 }],
    [10.5, 1, -48, 13, 10, 2, 'brickA', 1, N],
    // -- west avenue, inner row (12-17) — faces the avenue
    [-30.5, 1, 38.5, 9, 7, 5, 'concB', 2, { wrapN: 1 }],
    [-30.5, 1, 10, 10, 7, 6, 'concA', 0, { wrapN: 1, enter: 1 }],
    [-30.5, 1, -2, 11, 7, 4, 'brickB', 1, { tidy: 1 }],
    [-30.5, 1, -29.5, 9, 7, 5, 'brickA', 0, { wrapN: 1 }],
    [-30.5, 1, -39.9, 6.8, 7, 2, 'concB', 1, { wrapS: 1, tidy: 1 }],
    [-30.5, 1, -55.5, 8, 7, 4, 'plasterB', 2, { wrapN: 1 }],
    // -- east avenue, inner row (18-24)
    [30.5, -1, 38.75, 8.5, 7, 4, 'brickB', 1, { wrapN: 1, tidy: 1 }],
    [30.5, -1, 29.5, 5, 7, 2, 'plasterA', 0, { wrapS: 1 }],
    [30.5, -1, 9, 11, 6.5, 7, 'concB', 0, N],
    [30.5, -1, -5, 9, 7, 3, 'plasterB', 2, { wrapS: 1 }],
    [30.5, -1, -30, 12, 7, 5, 'concA', 1, { wrapN: 1, tidy: 1 }],
    [30.5, -1, -42, 8, 7, 3, 'brickB', 2, N],
    [30.5, -1, -55, 9, 7, 4, 'plasterA', 0, N],
    // -- west avenue, outer row (25-30) — lite: far from the spine
    [-45.5, -1, 35.5, 7, 9, 6, 'concB', 0, { lite: 1, wrapS: 1 }],
    [-45.5, -1, 7.5, 15, 10, 8, 'concA', 0, { lite: 1 }],
    [-45.5, -1, -6, 10, 9, 4, 'brickB', 1, { lite: 1, tidy: 1 }],
    [-45.5, -1, -30, 12, 9, 5, 'plasterA', 2, { lite: 1 }],
    [-45.5, -1, -39.9, 6.8, 9, 3, 'brickA', 1, { lite: 1, wrapS: 1, tidy: 1 }],
    [-45.5, -1, -55.65, 9, 9, 5, 'concB', 0, { lite: 1, wrapN: 1 }],
    // -- east avenue, outer row (31-35)
    [45.5, 1, 35, 12, 9, 5, 'brickA', 0, { lite: 1, wrapN: 1 }],
    [45.5, 1, 6, 14, 9, 7, 'concB', 2, { lite: 1 }],
    [45.5, 1, -8, 8, 9, 3, 'plasterA', 1, { lite: 1, tidy: 1 }],
    [45.5, 1, -31, 13, 9, 6, 'brickB', 0, { lite: 1, wrapN: 1 }],
    [45.5, 1, -55, 10, 9, 4, 'brickA', 2, { lite: 1, wrapN: 1 }],
  ];
  B.forEach((b, i) => building(i, b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8] || {}));

  // north-rim slabs (36-39): shallow buildings fronting North St from the
  // north — the backdrop that closes the spawn intersection
  function buildingZ(bi, xc, w, d, stories, matName) {
    setBand(xc);
    const fz = 56, zc = fz + d / 2, H = stories * 3;
    const texKey = matName.startsWith('brick') ? 'brick' : matName.startsWith('plaster') ? 'plaster' : 'concrete';
    const mat = wallMatFor(texKey, wallMats[matName].color.getHex(),
      Math.min(5, Math.max(2, Math.round(w / 3.4))), Math.min(7, Math.max(2, Math.round(H / 3.4))));
    const body = box(w, H, d, mat);
    body.position.set(xc, H / 2, zc);
    bakeMesh(body);
    parapets(xc, zc, w, d, H);
    inst(metalInst, xc + rr(-w / 4, w / 4), H + 0.3, zc, rr(0.9, 1.4), rr(0.5, 0.7), rr(0.7, 1), rr(0, Math.PI));
    const vh = rr(0.5, 1.0);
    inst(cylInst, xc + rr(-w / 3, w / 3), H + vh / 2, zc + rr(-d / 4, d / 4), rr(0.24, 0.38), vh, rr(0.24, 0.38));
    const cols = Math.max(2, Math.floor((w - 2.2) / 2.2));
    const span = (cols - 1) * 2.2;
    for (let st = 0; st < stories; st++) {
      for (let c = 0; c < cols; c++) {
        const wx = xc - span / 2 + c * 2.2;
        const wy = st * 3 + 1.75;
        if (st === 0 && c === bi % cols) {
          inst(glassInst, wx, 1.28, fz + 0.09, 1.3, 2.56, 0.2);
          inst(trimInst, wx, 2.68, fz - 0.02, 1.55, 0.18, 0.3);
          continue;
        }
        inst(glassInst, wx, wy, fz + 0.045, 1.15, 1.55, 0.16);
        inst(trimInst, wx, wy + 0.86, fz - 0.03, 1.42, 0.15, 0.24);
        inst(trimInst, wx, wy - 0.85, fz - 0.04, 1.42, 0.1, 0.28);
      }
    }
    if (bi % 2) scorch(xc + rr(-w / 4, w / 4), rr(4, H - 1.5), fz - 0.02, Math.PI, 2.6, 3.4);
  }
  buildingZ(36, -20, 16, 5.5, 5, 'concB');
  buildingZ(37, 19, 13, 5.5, 4, 'plasterB');
  buildingZ(38, -51, 11, 5, 3, 'brickA');
  buildingZ(39, 51, 11, 5, 4, 'concA');
  setBand(0); // restore center band for the street-level scatter below

  // ---------------------------------------------------------------- ruined far end
  {
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), M.dirt);
    mound.scale.set(10, 2.3, 5.6);
    mound.position.set(0, 0, -57.5);
    bakeMesh(mound, { collide: false, surface: 'dirt' });
    // climbable stepped colliders
    colliders.push(new THREE.Box3(V3(-8, 0, -56.6), V3(8, 0.7, -54.2)));
    colliders.push(new THREE.Box3(V3(-8.6, 0, -58.6), V3(8.6, 1.5, -56.2)));
    colliders.push(new THREE.Box3(V3(-9, 0, -61), V3(9, 2.3, -58.2)));
    // tilted slabs
    const slabDefs = [
      [-3.2, 1.5, -55.4, 0.4, 0.34, 4.6, 3.2], [2.6, 1.8, -56.6, -0.5, -0.2, 5.2, 3.6],
      [0.2, 1.1, -54.6, 0.24, 0.5, 3.8, 2.8],
    ];
    for (const s of slabDefs) {
      const slab = box(s[5], 0.42, s[6], M.concB);
      slab.position.set(s[0], s[1], s[2]);
      slab.rotation.set(s[3], s[4] * 2, s[4]);
      bakeMesh(slab, { collide: false });
    }
    // collapsed slab leaning from the west 2-story building
    const lean = box(7.6, 0.45, 3.6, M.concA);
    lean.position.set(-7.2, 2.7, -50);
    lean.rotation.z = -0.62;
    bakeMesh(lean, { collide: false });
    obbCollider(-7.2, 1.6, -50, 3.4, 1.6, 1.8, 0);
    // heavy debris field near the mound
    for (let i = 0; i < 26; i++) {
      inst(debrisInst, rr(-7, 7), rr(0.05, 0.5), rr(-56, -48),
        rr(0.2, 0.9), rr(0.15, 0.6), rr(0.2, 0.9), rr(0, Math.PI), rr(0, 1), rr(0, 1));
    }
    for (let i = 0; i < 16; i++) {
      inst(brickInst, rr(-6, 6), rr(0.08, 0.35), rr(-55, -49),
        rr(0.3, 0.7), rr(0.15, 0.3), rr(0.3, 0.6), rr(0, Math.PI), rr(-0.4, 0.4), rr(-0.4, 0.4));
    }
  }

  // ---------------------------------------------------------------- sandbag emplacements
  function sandbagWall(cx, cz, ry, len = 4.6, rows = 3) {
    const dx = Math.cos(ry), dz = -Math.sin(ry);
    for (let r = 0; r < rows; r++) {
      const y = 0.14 + r * 0.235;
      const n = Math.round(len / 0.6) - (r % 2);
      const start = -((n - 1) * 0.6) / 2;
      for (let i = 0; i < n; i++) {
        const t = start + i * 0.6;
        inst(bagInst, cx + dx * t + rr(-0.03, 0.03), y, cz + dz * t + rr(-0.03, 0.03),
          rr(0.58, 0.66), 0.3, rr(0.4, 0.46), ry + rr(-0.14, 0.14));
      }
    }
    obbCollider(cx, rows * 0.24 / 2 + 0.05, cz, len / 2, rows * 0.24 / 2 + 0.1, 0.34, ry);
  }
  sandbagWall(-4.5, 38, 0.06);
  sandbagWall(-6.6, 36.6, 1.45, 3.2);         // L-return
  sandbagWall(3.5, 10, -0.18);
  sandbagWall(-5, -14, 0.12);
  sandbagWall(5.5, -38, -0.1);
  sandbagWall(-8.9, 20, 1.57, 3.6);           // alley mouth

  // ---------------------------------------------------------------- jersey barriers
  const jbShape = new THREE.Shape();
  jbShape.moveTo(-0.4, 0); jbShape.lineTo(0.4, 0); jbShape.lineTo(0.33, 0.13);
  jbShape.lineTo(0.15, 0.56); jbShape.lineTo(0.11, 0.82); jbShape.lineTo(-0.11, 0.82);
  jbShape.lineTo(-0.15, 0.56); jbShape.lineTo(-0.33, 0.13); jbShape.closePath();
  const jbGeo = new THREE.ExtrudeGeometry(jbShape, { depth: 3, bevelEnabled: false });
  jbGeo.translate(0, 0, -1.5);
  const jbDefs = [
    [2.5, 24, 0.22], [-3.4, 20.4, -0.14], [1.2, -1.5, 0.1], [-2.8, -26, 0.04],
    [5.8, -20, 1.35], [-1.6, 44.8, 0.02], [2.2, 46.2, -0.05], [6.4, 2.5, 1.5],
    [-6.2, -46.5, 0.6],
  ];
  for (const jb of jbDefs) {
    const b = new THREE.Mesh(jbGeo, M.barrier);
    b.position.set(jb[0], 0.02, jb[1]);
    b.rotation.y = jb[2];
    bakeMesh(b, { collide: false });
    obbCollider(jb[0], 0.42, jb[1], 0.42, 0.42, 1.52, jb[2]);
  }

  // ---------------------------------------------------------------- burned-out car hulks
  // charred body + darker window band + deflated tires (body slumped low)
  const tireGeo = new THREE.CylinderGeometry(0.31, 0.31, 0.24, 12);
  tireGeo.rotateX(Math.PI / 2); // axis along local z (car lateral)
  function carHulk(x, z, ry) {
    const g = new THREE.Group();
    const body = box(4.35, 0.62, 1.82, M.carChar);
    body.position.y = 0.46; g.add(body);
    const hood = box(1.3, 0.16, 1.7, M.carChar);
    hood.position.set(1.62, 0.72, 0); hood.rotation.z = -0.06; g.add(hood);
    const cabin = box(2.15, 0.56, 1.62, M.carChar);
    cabin.position.set(-0.28, 0.98, 0); g.add(cabin);
    const winBand = box(2.17, 0.3, 1.66, M.carWin); // distinct dark glass band
    winBand.position.set(-0.28, 1.02, 0); g.add(winBand);
    const roofSag = box(1.9, 0.08, 1.5, M.carBurnt);
    roofSag.position.set(-0.28, 1.28, 0); roofSag.rotation.x = 0.05; g.add(roofSag);
    for (const wx of [1.45, -1.45]) for (const wz of [0.84, -0.84]) {
      const tire = new THREE.Mesh(tireGeo, M.tire);
      tire.scale.y = 0.62; // deflated squash
      tire.position.set(wx + rr(-0.05, 0.05), 0.19, wz);
      g.add(tire);
    }
    g.position.set(x, 0.04, z);   // slumped on deflated tires
    g.rotation.y = ry;
    bakeMesh(g, { collide: false, surface: 'metal' });
    obbCollider(x, 0.68, z, 2.2, 0.68, 0.95, ry);
    inst(patchInst, x, 0.056, z, 6.0, 1, 3.6, ry); // soot stain under/around
  }
  carHulk(-4.2, 30, 0.18);
  carHulk(4.8, -6, -2.95);
  carHulk(-3.5, -44, 2.55);

  // ---------------------------------------------------------------- drums, crates, pallets
  const drumDefs = [ // x, z, tipped(bool), ry
    [8.9, 16.4, 0, 0.4], [8.35, 17.1, 0, 1.9], [8.8, 17.7, 0, 3.4],
    [-9.2, -2, 0, 0.8], [-9.0, -2.8, 0, 2.2],
    [7.5, -30, 0, 0.5], [6.9, -30.6, 1, 1.2],
    [6.8, 15.2, 1, -0.7], [-8.6, 41, 0, 1.1],
  ];
  for (const d of drumDefs) {
    if (d[2]) inst(drumInst, d[0], 0.31, d[1], 1, 1, 1, d[3], Math.PI / 2, 0);
    else inst(drumInst, d[0], 0.44, d[1], 1, 1, 1, d[3]);
  }
  obbCollider(8.6, 0.45, 17, 0.75, 0.45, 0.95, 0);
  obbCollider(-9.1, 0.45, -2.4, 0.55, 0.45, 0.75, 0);
  obbCollider(7.2, 0.45, -30.3, 0.65, 0.45, 0.65, 0);

  function pallet(x, z, ry, lean) {
    inst(woodInst, x, 0.16, z, 1.2, 0.05, 1.0, ry, 0, lean ? 0.32 : 0);
    if (!lean) for (const o of [-0.44, 0, 0.44]) {
      const dx = Math.cos(ry) * o, dz = -Math.sin(ry) * o;
      inst(woodInst, x + dx, 0.065, z + dz, 0.1, 0.13, 1.0, ry);
    }
  }
  pallet(9.1, 26, 0.3);
  inst(woodInst, 9.12, 0.235, 26.03, 1.2, 0.05, 1.0, 0.42); // second pallet stacked on top
  pallet(-9.0, 8.4, 1.2);
  pallet(-8.6, 9.6, 0.9, true); // leaning against wall
  function crate(x, z, s, ry, y = 0) {
    inst(woodInst, x, y + s / 2, z, s, s, s, ry);
    obbCollider(x, y + s / 2, z, s / 2, s / 2, s / 2, ry);
  }
  crate(8.65, 25.1, 0.78, 0.2);
  crate(9.0, 24.55, 0.62, 0.9, 0.0);
  crate(8.7, 25.2, 0.55, 0.5, 0.78);
  crate(-8.8, 7.2, 0.7, 1.4);

  // ---------------------------------------------------------------- dumpsters
  const dumpsterMat = stdMat(T.metal, { rx: 2, ry: 1, color: 0x49524b, rough: 0.8, metal: 0.3 });
  function dumpsterAt(x, z, ry) {
    const d = new THREE.Group();
    const shell = box(2.3, 1.15, 1.15, dumpsterMat);
    shell.position.y = 0.68; d.add(shell);
    const lid = box(2.28, 0.06, 1.12, M.dark);
    lid.position.set(0, 1.3, -0.12); lid.rotation.x = -0.28; d.add(lid);
    d.position.set(x, 0.08, z); d.rotation.y = ry;
    bakeMesh(d, { collide: false, surface: 'metal' });
    obbCollider(x, 0.7, z, 1.16, 0.7, 0.6, ry);
  }
  dumpsterAt(-9.35, 42.5, 1.65);    // nosed out from the wall by the spawn intersection
  dumpsterAt(23.1, -7.1, 0.15);     // parking lot
  dumpsterAt(-33.8, -52.2, -0.12);  // alley mouth, south dirt edge
  dumpsterAt(-25, 34.3, 3.05);      // backyard behind the plaza

  // ---------------------------------------------------------------- streetlights
  // one instanced family (pole/arm/head); heads are softly emissive sodium.
  // Only TWO real PointLights in the whole set (spawn intersection + a
  // flickering half-dead lamp in the SW alley).
  function streetlight(x, z, ry) {
    const h = 5.6;
    inst(lampPoleInst, x, h / 2, z, 1, h, 1);
    const ax = Math.sin(ry), az = Math.cos(ry);
    inst(lampArmInst, x + ax * 0.62, h - 0.1, z + az * 0.62, 0.09, 0.09, 1.4, ry);
    inst(lampHeadInst, x + ax * 1.28, h - 0.16, z + az * 1.28, 0.24, 0.14, 0.66, ry);
    obbCollider(x, h / 2, z, 0.14, h / 2, 0.14, 0);
  }
  const HPI = Math.PI / 2;
  const lampDefs = [
    // main street (east walk, arm west / west walk, arm east)
    [10.2, 44.6, -HPI], [10.2, 27.6, -HPI], [10.2, -13.9, -HPI], [10.2, -50, -HPI],
    [-10.15, 55.0, HPI], [-10.15, 15.8, HPI], [-10.15, -24.3, HPI],
    // avenues (poles hug facades/curbs so walk loops stay clear)
    [-30.9, 34, -HPI], [-30.9, -8, -HPI], [-30.9, -34, -HPI],
    [30.9, 40, HPI], [30.9, 6, HPI], [30.9, -30, HPI], [30.9, -52, HPI],
    [-44.9, 40, HPI], [-44.9, 4, HPI], [-44.9, -27, HPI], [-44.9, -56, HPI],
    [44.9, 30, -HPI], [44.9, -6, -HPI], [44.9, -40, -HPI],
    // North St north walk (no pedestrian loop up there)
    [14, 55.3, Math.PI], [-26, 55.3, Math.PI],
    // alley + parking + plaza
    [-20, -45.6, 0], [17, -6.6, Math.PI], [-24.4, 26.9, -HPI],
  ];
  for (const l of lampDefs) streetlight(l[0], l[1], l[2]);
  // NOTE: zero real PointLights added for the lamps — the forward pass already
  // carries 6 (fires + accents) and every extra one taxes the whole frame;
  // the sodium heads read through emissive + bloom instead.

  // ---------------------------------------------------------------- bus stops
  function busStop(x, z, ry) {
    // frame posts + tinted glass roof/back + bench + stop sign, all instanced
    const ax = Math.sin(ry), az = Math.cos(ry);   // front normal (toward street)
    const lx = Math.cos(ry), lz = -Math.sin(ry);  // lateral
    for (const t of [-1.55, 1.55]) {
      for (const f of [0.42, -0.38]) {
        inst(metalInst, x + lx * t + ax * f, 1.22, z + lz * t + az * f, 0.07, 2.44, 0.07);
      }
    }
    // NOTE: instanced-box local +x maps to the lateral vector (lx,lz), local
    // +z to the front normal — long dimensions go in sx
    inst(glassInst, x, 2.5, z, 3.4, 0.07, 1.14, ry, 0, -0.06);          // roof
    inst(glassInst, x - ax * 0.42, 1.24, z - az * 0.42, 3.15, 1.9, 0.05, ry); // back pane
    inst(woodInst, x - ax * 0.14, 0.52, z - az * 0.14, 2.6, 0.06, 0.4, ry);   // bench
    inst(trimInst, x - ax * 0.14 + lx, 0.26, z - az * 0.14 + lz, 0.34, 0.46, 0.08, ry);
    inst(trimInst, x - ax * 0.14 - lx, 0.26, z - az * 0.14 - lz, 0.34, 0.46, 0.08, ry);
    inst(lampPoleInst, x + lx * 2.1 + ax * 0.4, 1.45, z + lz * 2.1 + az * 0.4, 0.55, 2.9, 0.55);
    inst(metalInst, x + lx * 2.1 + ax * 0.4, 2.72, z + lz * 2.1 + az * 0.4, 0.46, 0.5, 0.06, ry);
    obbCollider(x - ax * 0.2, 1.25, z - az * 0.2, 1.75, 1.25, 0.5, ry);
  }
  busStop(-9.85, -8.5, HPI);   // main street, west sidewalk
  busStop(45.02, 7.7, -HPI);   // east avenue, outer walk

  // ---------------------------------------------------------------- kiosks
  const awningTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 16;
    const g = c.getContext('2d');
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#6f6a58' : '#8d867020';
      g.fillStyle = i % 2 ? '#6f6a58' : '#918a74';
      g.fillRect(i * 8, 0, 8, 16);
    }
    g.fillStyle = 'rgba(30,26,20,0.35)'; // grime band at the hem
    g.fillRect(0, 11, 64, 5);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const awningMat = new THREE.MeshStandardMaterial({
    map: awningTex, roughness: 0.95, side: THREE.DoubleSide, color: 0xb9b2a0,
  });
  function kiosk(x, z, ry, matB) {
    const ax = Math.sin(ry), az = Math.cos(ry);
    const bodyM = matB ? M.kioskB : M.kioskA;
    const body = box(2.3, 2.35, 1.7, bodyM);
    body.position.set(x, 1.2, z); body.rotation.y = ry;
    bakeMesh(body, { collide: false, surface: 'metal' });
    obbCollider(x, 1.2, z, 1.15, 1.2, 0.85, ry);
    // rolled-down shutter + counter lip on the front face
    inst(metalInst, x + ax * 0.87, 1.35, z + az * 0.87, 1.86, 1.16, 0.07, ry);
    inst(trimInst, x + ax * 0.9, 0.72, z + az * 0.9, 1.95, 0.1, 0.16, ry);
    const awn = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.95), awningMat);
    awn.position.set(x + ax * 1.22, 2.32, z + az * 1.22);
    awn.rotation.set(0, ry + Math.PI, 0);
    awn.rotateX(0.62);
    bakeMesh(awn, { collide: false });
    // flat cap + little vent
    inst(trimInst, x, 2.42, z, 2.42, 0.12, 1.82, ry);
    inst(cylInst, x - ax * 0.4, 2.66, z - az * 0.4, 0.16, 0.36, 0.16);
  }
  kiosk(-27.5, 31.6, -HPI, 0);      // plaza, facing the west avenue
  kiosk(12.4, -7.1, -HPI, 1);       // parking lot corner, facing main street
  kiosk(-16, 55.15, Math.PI, 0);    // North St north walk (newsstand)

  // ---------------------------------------------------------------- plaza dressing
  function bench(x, z, ry) {
    const ax = Math.sin(ry), az = Math.cos(ry);
    const lx = Math.cos(ry), lz = -Math.sin(ry);
    inst(woodInst, x, 0.47, z, 1.55, 0.07, 0.44, ry);
    inst(woodInst, x - ax * 0.2, 0.78, z - az * 0.2, 1.55, 0.5, 0.07, ry, 0.16);
    inst(trimInst, x + lx * 0.6, 0.22, z + lz * 0.6, 0.09, 0.44, 0.4, ry);
    inst(trimInst, x - lx * 0.6, 0.22, z - lz * 0.6, 0.09, 0.44, 0.4, ry);
    obbCollider(x, 0.4, z, 0.8, 0.4, 0.45, ry);
  }
  function planter(x, z, ry = 0) {
    inst(trimInst, x, 0.3, z, 1.7, 0.6, 0.62, ry);
    inst(patchInst, x, 0.615, z, 1.45, 1, 0.42, ry);
    // dead shrub: a few dark tumbling chunks
    for (let i = 0; i < 3; i++) {
      inst(debrisInst, x + rr(-0.5, 0.5), 0.68, z + rr(-0.12, 0.12),
        rr(0.1, 0.2), rr(0.15, 0.34), rr(0.1, 0.18), rr(0, Math.PI), rr(-0.4, 0.4), rr(-0.4, 0.4));
    }
    obbCollider(x, 0.3, z, 0.85, 0.3, 0.31, ry);
  }
  bench(-25.5, 28.5, 2.35);
  bench(-28.5, 31.8, -0.85);
  planter(-24.3, 30.2, HPI);
  planter(-29.3, 33.0, 0.1);
  for (let i = 0; i < 9; i++) { // papers drifting across the pavers
    inst(paperInst, rr(-30, -23.5), 0.075, rr(27, 33.2),
      rr(0.18, 0.34), 1, rr(0.22, 0.38), rr(0, Math.PI * 2));
  }

  // ---------------------------------------------------------------- parking lot
  {
    for (const sx of [12, 14.7, 17.4, 20.1, 22.8]) {
      inst(trimInst, sx + 1.35, 0.1, -10.7, 1.7, 0.14, 0.24); // wheel stops
    }
    inst(patchInst, 14.2, 0.052, -8.6, 2.6, 1, 1.8, 0.3);     // oil stains
    inst(patchInst, 19.6, 0.052, -12.6, 2.2, 1, 1.5, 1.2);
    inst(patchInst, 16.4, 0.052, -11.4, 1.6, 1, 1.2, 2.2);
    crate(14.1, -13.6, 0.8, 0.9);
    crate(14.5, -13.2, 0.55, 0.4, 0.8);
    const jb = new THREE.Mesh(jbGeo, M.barrier);
    jb.position.set(13.5, 0.02, -12.6); jb.rotation.y = 0.5;
    bakeMesh(jb, { collide: false });
    obbCollider(13.5, 0.42, -12.6, 0.42, 0.42, 1.52, 0.5);
  }

  // ---------------------------------------------------------------- new-street wrecks & cover
  carHulk(-34.4, 34, 1.58);     // west avenue, curb lane
  carHulk(-41.5, -37, -1.52);
  carHulk(34.5, 12, 1.6);       // east avenue
  carHulk(41.6, -33, -1.55);
  carHulk(-19, 54.4, 1.62);     // North St, run up onto the north curb
  carHulk(15.7, -8.3, -1.65);   // parking stalls
  carHulk(21.3, -12.2, 1.42);
  const jbDefs2 = [
    [-40.9, 12, 1.62], [-35.2, -30.5, 1.5],       // west avenue
    [35.3, 28.5, 1.55], [40.8, -12, 1.6],         // east avenue
    [12, 46.6, 1.62], [-30, 52.9, 1.5],           // North St
    [-14.5, 17.8, 1.6], [26, 24.1, 1.55],         // Mid-North
    [18, -22.55, 1.57],                           // Mid-South walk edge
    [-58.5, -47.2, 0.1], [-58.2, -49.3, -0.15],   // alley dead-end cap
  ];
  for (const jb of jbDefs2) {
    const b = new THREE.Mesh(jbGeo, M.barrier);
    b.position.set(jb[0], 0.02, jb[1]);
    b.rotation.y = jb[2];
    bakeMesh(b, { collide: false });
    obbCollider(jb[0], 0.42, jb[1], 0.42, 0.42, 1.52, jb[2]);
  }
  sandbagWall(-26, 33.8, 0.1);          // backyard mouth NW block
  sandbagWall(24, -22.5, 0.05, 3.8);    // Mid-South south walk
  sandbagWall(47, 44.9, 0.03, 3.6);     // N x east-avenue corner
  // avenue dead-end rubble berms (the city continues beyond, but not for you)
  for (const [bx, bz] of [[-38, 57.2], [38, 57.2], [-38, -59.2], [38, -59.2]]) {
    for (let i = 0; i < 16; i++) {
      const s = rr(0.25, 0.85);
      inst(i % 3 ? brickInst : debrisInst, bx + rr(-4.4, 4.4), rr(0.1, 0.75), bz + rr(-1.2, 1.2),
        s, s * rr(0.5, 0.8), s * rr(0.7, 1.2), rr(0, Math.PI), rr(-0.4, 0.4), rr(-0.4, 0.4));
    }
    obbCollider(bx, 0.6, bz, 4.8, 0.6, 1.4, 0);
  }
  // alley drums + pallet clutter
  inst(drumInst, -24, 0.44, -51.8, 1, 1, 1, 0.7);
  inst(drumInst, -24.7, 0.44, -51.45, 1, 1, 1, 2.3);
  inst(drumInst, -23.25, 0.31, -52.0, 1, 1, 1, 1.1, Math.PI / 2, 0);
  obbCollider(-24.1, 0.45, -51.7, 0.85, 0.45, 0.6, 0);
  pallet(-31.5, -46.2, 1.4);
  pallet(-40.2, -44.1, 0.6, true);

  // ---------------------------------------------------------------- power poles + wires
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  function wire(a, b, sag) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y = Math.min(a.y, b.y) - sag;
    const curve = new THREE.CatmullRomCurve3([a, mid, b]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 22, 0.018, 5), wireMat);
    bakeMesh(tube, { collide: false, ray: false, cast: false, recv: false });
    return mid;
  }
  const poleDefs = [[62, 0], [36, 0], [6, 0], [-24, 0], [-54, -0.13]]; // [z, leanZ]
  const poleTops = [];
  for (const [pz, lean] of poleDefs) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 7.6, 8), M.pole);
    // lean rotates about pole center: top drifts toward the street
    const topX = -9.8 - Math.sin(lean) * 3.8;
    pole.position.set(-9.8, 3.75, pz);
    pole.rotation.z = lean;
    bakeMesh(pole, { collide: false });
    obbCollider(-9.8, 3.8, pz, 0.2, 3.8, 0.2, 0);
    const arm = box(1.7, 0.12, 0.12, M.pole);
    arm.position.set(topX, 6.9 * Math.cos(lean), pz);
    arm.rotation.z = lean;
    bakeMesh(arm, { collide: false });
    poleTops.push(V3(topX, 7.0 * Math.cos(lean), pz));
  }
  for (let i = 0; i < poleTops.length - 1; i++) {
    for (const off of [-0.7, 0.7]) {
      wire(V3(poleTops[i].x + off * 0.5, poleTops[i].y, poleTops[i].z + off * 0.06),
           V3(poleTops[i + 1].x + off * 0.5, poleTops[i + 1].y, poleTops[i + 1].z + off * 0.06), 0.95);
    }
  }
  // cross-street drop + hanging traffic light
  wire(V3(-9.8, 7.05, 6), V3(10.45, 8.1, 6), 1.5);
  const tl = new THREE.Group();
  {
    const housing = box(0.32, 0.8, 0.3, M.dark);
    tl.add(housing);
    const lensGeo = new THREE.CircleGeometry(0.07, 12);
    const lensCols = [0x2a0f0c, 0x2a1c08, 0x0c1a0e];
    for (let i = 0; i < 3; i++) {
      for (const s of [1, -1]) {
        const lens = new THREE.Mesh(lensGeo, new THREE.MeshStandardMaterial({
          color: 0x060606, emissive: lensCols[i], emissiveIntensity: i === 1 ? 0.9 : 0.35,
          roughness: 0.4,
        }));
        lens.position.set(0, 0.26 - i * 0.26, s * 0.16);
        if (s < 0) lens.rotation.y = Math.PI;
        tl.add(lens);
      }
    }
    tl.position.set(0.2, 4.85, 6);
    for (const m of tl.children) { m.castShadow = true; m.userData.surface = 'metal'; raycastMeshes.push(m); }
    root.add(tl);
    wire(V3(0.2, 5.56, 6), V3(0.2, 5.25, 6), 0.0); // short drop link off the span
  }
  updaters.push((dt) => { tl.rotation.z = Math.sin(time * 0.6) * 0.045; tl.rotation.x = Math.sin(time * 0.43 + 1.3) * 0.03; });

  // ---------------------------------------------------------------- burning barrel
  function makeFlameTex() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 64, 128);
    const grd = g.createRadialGradient(32, 100, 4, 32, 86, 60);
    grd.addColorStop(0, 'rgba(255,240,200,0.95)');
    grd.addColorStop(0.25, 'rgba(255,176,80,0.8)');
    grd.addColorStop(0.55, 'rgba(230,92,26,0.45)');
    grd.addColorStop(1, 'rgba(120,30,8,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 128);
    // taper the top into licks
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 14; i++) {
      const x = 4 + i * 4.4, w = 3 + (i % 3) * 2, h = 30 + ((i * 37) % 40);
      const lg = g.createLinearGradient(0, 20, 0, 20 + h);
      lg.addColorStop(0, 'rgba(0,0,0,0.95)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = lg;
      g.fillRect(x, 0, w, h + 20);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  // shared flame resources (pooled across all fire beats)
  const flameMat = new THREE.MeshBasicMaterial({
    map: makeFlameTex(), transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const flameGeo = new THREE.PlaneGeometry(0.72, 1.15);
  flameGeo.translate(0, 0.575, 0); // pivot at base
  const flames = [];
  const fireLights = [];
  const barrelShellMat = stdMat(T.rust, { rx: 2, ry: 1, color: 0x54473c });
  const emberMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xff5a14, emissiveIntensity: 2.2, roughness: 1,
  });
  const emberGeo = new THREE.CircleGeometry(0.26, 14);
  function fireBeat(x, z, o = {}) {
    // o.barrel: drum under the fire; o.scale: flame scale; o.i: light intensity
    const fy = o.y ?? (o.barrel ? 0.86 : 0.1);
    if (o.barrel) {
      const barrel = new THREE.Mesh(drumGeo, barrelShellMat);
      barrel.position.set(x, 0.44, z);
      bakeMesh(barrel, { surface: 'metal' });
    }
    const ember = new THREE.Mesh(emberGeo, emberMat);
    ember.rotation.x = -Math.PI / 2;
    ember.position.set(x, fy + 0.02, z);
    ember.scale.setScalar(o.scale ?? 1);
    bakeMesh(ember, { collide: false, ray: false, cast: false });
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Mesh(flameGeo, flameMat);
      f.position.set(x, fy, z);
      f.rotation.y = i * Math.PI / 2 + rr(0, 1);
      f.scale.setScalar(o.scale ?? 1);
      flames.push(f);
      root.add(f);
    }
    if (o.light !== false) {
      const li = new THREE.PointLight(0xff7a26, o.i ?? 12, o.range ?? 14, 2);
      li.position.set(x, fy + 0.65, z);
      li.userData.base = o.i ?? 12;
      fireLights.push(li);
      root.add(li);
    }
  }
  const barrelPos = V3(4.2, 0, 33);
  fireBeat(barrelPos.x, barrelPos.z, { barrel: true, i: 12 });
  // additional beats down the street: flames/embers only — every real
  // PointLight taxes ALL fragments in the forward pass, and the city already
  // fills far more screen than the old single street did (budget: 3 accents)
  fireBeat(-5.6, -11.2, { barrel: true, light: false });
  fireBeat(6.5, -33.5, { scale: 0.8, light: false });        // rubble embers by the drums
  fireBeat(-6.9, 12.6, { scale: 0.7, light: false });        // smoldering debris
  // charred debris under the open ember beds
  for (const [ex, ez] of [[6.5, -33.5], [-6.9, 12.6]]) {
    inst(patchInst, ex, 0.057, ez, 2.8, 1, 2.4, rr(0, Math.PI));
    for (let i = 0; i < 7; i++) {
      const s = rr(0.15, 0.4);
      inst(brickInst, ex + rr(-0.7, 0.7), 0.1, ez + rr(-0.6, 0.6),
        s, s * 0.6, s, rr(0, Math.PI), 0, rr(-0.3, 0.3));
    }
  }
  updaters.push(() => {
    const n = Math.sin(time * 23.0) * 0.5 + Math.sin(time * 71.7 + 2.1) * 0.3 + Math.sin(time * 9.2) * 0.4;
    for (let i = 0; i < fireLights.length; i++) {
      const li = fireLights[i];
      const nn = Math.sin(time * (21 + i * 3.7) + i * 2.3) * 0.5 + Math.sin(time * (60 + i * 9) + i) * 0.3;
      li.intensity = li.userData.base * (0.96 + nn * 0.22);
    }
    for (let i = 0; i < flames.length; i++) {
      const f = flames[i];
      const s = f.scale.z; // base scale stored on unanimated axis
      f.scale.y = s * (1 + 0.16 * Math.sin(time * 17 + i * 2.4) + 0.07 * Math.sin(time * 41 + i));
      f.scale.x = s * (1 + 0.08 * Math.sin(time * 13 + i * 1.7));
      f.rotation.z = 0.06 * Math.sin(time * 8.5 + i * 3.1);
    }
    flameMat.opacity = 0.82 + n * 0.1;
  });
  // couple of sandbags at the main barrel
  inst(bagInst, barrelPos.x - 0.9, 0.14, barrelPos.z + 0.4, 0.62, 0.3, 0.44, 0.7);
  inst(bagInst, barrelPos.x - 0.6, 0.14, barrelPos.z - 0.3, 0.6, 0.3, 0.42, 2.1);

  // accent: rubble fire glow at the ruined end. (The old cool interior-spill
  // PointLight became pure emissive flicker on its window — with the city's
  // fill, every forward-pass light is paid for by the whole frame.)
  const rubbleGlow = new THREE.PointLight(0xff6a1e, 7, 17, 2);
  rubbleGlow.position.set(1.5, 1.4, -54);
  root.add(rubbleGlow);
  updaters.push(() => {
    rubbleGlow.intensity = 6.5 + Math.sin(time * 15.2 + 4) * 1.6 + Math.sin(time * 5.7) * 1.1;
    for (const lm of litMeshes) {
      lm.material.emissiveIntensity = 0.92 + Math.sin(time * 2.1 + lm.position.z) * 0.08 +
        (lm.userData.tv ? Math.sin(time * 31.7) * Math.sin(time * 3.4) * 0.3 : 0);
    }
  });

  // ---------------------------------------------------------------- distant skyline + smoke
  // fog:false — at 150-250m FogExp2 would wash these to pure fog color; render
  // as pre-hazed silhouettes sampled slightly DARKER than the horizon sky,
  // arranged in 3 depth rows with progressively stronger baked fog blend so
  // they recede in layers. Facades carry an unlit window-grid texture.
  {
    const fogCol = new THREE.Color(0xc2bdb0);
    const silBase = new THREE.Color(0xc6bfae).multiplyScalar(0.7); // darker than uHorizon
    // box geometry with the top-face UVs collapsed onto a plain texture patch
    // so roofs read as solid silhouette from elevated views
    const towerGeo = unitBox.clone();
    {
      const uv = towerGeo.attributes.uv;
      for (let i = 8; i < 12; i++) uv.setXY(i, 0.02, 0.02); // py face verts
      uv.needsUpdate = true;
    }
    const rows = [ // ring pushed out beyond the full district (280-340m)
      { r0: 132, r1: 150, n: 14, h0: 12, h1: 30, blend: 0.34, tex: T.skylineWin[0] },
      { r0: 168, r1: 196, n: 18, h0: 18, h1: 54, blend: 0.55, tex: T.skylineWin[1] },
      { r0: 236, r1: 268, n: 18, h0: 26, h1: 74, blend: 0.72, tex: T.skylineWin[2] },
      { r0: 292, r1: 336, n: 16, h0: 34, h1: 92, blend: 0.85, tex: T.skylineWin[2] },
    ];
    const dressMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const dress = new THREE.InstancedMesh(unitBox, dressMat, 90); // masts + tanks
    dress.count = 0;
    dress.castShadow = false; dress.receiveShadow = false; dress.frustumCulled = false;
    const dc = new THREE.Color();
    const m = new THREE.Matrix4();
    for (const row of rows) {
      const col = silBase.clone().lerp(fogCol, row.blend);
      const rmat = new THREE.MeshBasicMaterial({ color: col, map: row.tex, fog: false });
      const im = new THREE.InstancedMesh(towerGeo, rmat, row.n);
      im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false;
      for (let i = 0; i < row.n; i++) {
        const a = (i / row.n) * Math.PI * 2 + rr(-0.09, 0.09);
        const r = rr(row.r0, row.r1);
        const w = rr(13, 30), h = rr(row.h0, row.h1), dd = rr(12, 24);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        m.makeRotationY(-a + rr(-0.15, 0.15));
        m.setPosition(x, h / 2 - 2, z);
        m.scale(_s.set(w, h, dd));
        im.setMatrixAt(i, m);
        // rooftop masts / water tanks on some towers break the flat tops
        if (rand() < 0.42) {
          const mh = rr(3, 8), mw = rr(0.35, 0.7);
          m.makeRotationY(-a);
          m.setPosition(x + rr(-w / 4, w / 4), h - 2 + mh / 2, z + rr(-dd / 5, dd / 5));
          m.scale(_s.set(mw, mh, mw));
          dress.setMatrixAt(dress.count, m);
          dress.setColorAt(dress.count++, dc.copy(col));
        }
        if (rand() < 0.3) {
          const th = rr(1.6, 2.6), tw = rr(2, 3.4);
          m.makeRotationY(-a + 0.3);
          m.setPosition(x + rr(-w / 4, w / 4), h - 2 + th / 2, z + rr(-dd / 5, dd / 5));
          m.scale(_s.set(tw, th, tw));
          dress.setMatrixAt(dress.count, m);
          dress.setColorAt(dress.count++, dc.copy(col).lerp(fogCol, 0.12));
        }
      }
      im.instanceMatrix.needsUpdate = true;
      root.add(im);
    }
    dress.instanceMatrix.needsUpdate = true;
    if (dress.instanceColor) dress.instanceColor.needsUpdate = true;
    root.add(dress);
  }

  function makeSmokeTex() {
    // narrow stem widening into a drifting, dissipating head: quadratic radius
    // growth + hard alpha falloff toward the top so the plume tapers instead of
    // reading as a vertical streak from elevation
    const c = document.createElement('canvas'); c.width = 160; c.height = 256;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 160, 256);
    for (let i = 0; i < 54; i++) {
      const t = i / 54;
      const y = 244 - t * 232;
      const x = 80 + Math.sin(t * 6.5 + 1.2) * (2 + t * 34) + t * t * 14;
      const rad = 6 + t * 14 + t * t * 46;
      const fadeTop = 1 - Math.pow(Math.max(0, (t - 0.55) / 0.45), 1.35) * 0.92;
      const a = 0.17 * (1 - t * 0.35) * fadeTop * (t < 0.05 ? t / 0.05 : 1);
      const grd = g.createRadialGradient(x, y, 1, x, y, rad);
      grd.addColorStop(0, `rgba(38,38,40,${a})`);
      grd.addColorStop(0.55, `rgba(40,40,42,${a * 0.55})`);
      grd.addColorStop(1, 'rgba(40,40,42,0)');
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const t = new THREE.CanvasTexture(c);
    return t;
  }
  const smokeCols = [];
  for (const def of [[-72, -102, 27, 58], [55, -122, 32, 66], [104, 48, 24, 52]]) {
    const smat = new THREE.MeshBasicMaterial({
      map: makeSmokeTex(), transparent: true, depthWrite: false, fog: true,
    });
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(def[2], def[3]), smat);
    sp.position.set(def[0], def[3] / 2 - 1, def[1]);
    root.add(sp);
    smokeCols.push(sp);
  }
  const _lastP = V3(0, 0, 52);
  updaters.push(() => {
    for (let i = 0; i < smokeCols.length; i++) {
      const sp = smokeCols[i];
      sp.lookAt(_lastP.x, sp.position.y, _lastP.z); // Y-billboard
      sp.rotation.z = Math.sin(time * 0.11 + i * 2.6) * 0.04;
      sp.material.map.offset.x = Math.sin(time * 0.05 + i) * 0.015;
    }
  });

  // ---------------------------------------------------------------- ground clutter
  for (let i = 0; i < 60; i++) { // papers
    const onWalk = rand() > 0.5;
    const x = onWalk ? rr(7.4, 10.2) * (rand() > 0.5 ? 1 : -1) : rr(-6.6, 6.6);
    inst(paperInst, x, onWalk ? 0.148 : 0.052, rr(-55, 55),
      rr(0.18, 0.36), 1, rr(0.24, 0.4), rr(0, Math.PI * 2));
  }
  for (let i = 0; i < 26; i++) { // dark stain patches
    const x = rr(-6.5, 6.5);
    inst(patchInst, x, 0.05, rr(-56, 52), rr(1.2, 4.2), 1, rr(1.0, 3.2), rr(0, Math.PI));
  }
  for (let i = 0; i < 70; i++) { // scattered debris chunks along edges
    const side = rand() > 0.5 ? 1 : -1;
    const nearWall = rand() > 0.45;
    const x = nearWall ? side * rr(8.6, 10.3) : side * rr(5.6, 7.2);
    inst(debrisInst, x, rr(0.02, 0.14), rr(-52, 52),
      rr(0.08, 0.4), rr(0.06, 0.25), rr(0.08, 0.4), rr(0, Math.PI), rr(0, 1), rr(0, 1));
  }
  // gutter debris strips: clusters every 3-6m hugging both curb lines
  for (const s of [-1, 1]) {
    let z = -58 + rr(0, 3);
    while (z < 58) {
      const n = 2 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const gx = s * rr(6.15, 6.85), gz = z + rr(-0.9, 0.9);
        const pick = rand();
        if (pick < 0.4) {
          const bs = rr(0.16, 0.34);
          inst(brickInst, gx, 0.06 + rr(0, 0.05), gz, bs, bs * 0.55, bs * rr(1.4, 2),
            rr(0, Math.PI), 0, rr(-0.3, 0.3));
        } else if (pick < 0.7) {
          const ds = rr(0.1, 0.32);
          inst(debrisInst, gx, 0.04 + rr(0, 0.06), gz, ds, ds * rr(0.5, 0.8), ds,
            rr(0, Math.PI), rr(0, 1), rr(0, 1));
        } else {
          inst(paperInst, gx, 0.062, gz, rr(0.18, 0.34), 1, rr(0.22, 0.38), rr(0, Math.PI * 2));
        }
      }
      z += rr(3, 6);
    }
  }
  // new-street clutter: papers/stains/debris on the avenues + cross streets
  for (const s of [-1, 1]) {
    for (let i = 0; i < 22; i++) { // avenue papers (roadway + walks)
      const onWalk = rand() > 0.55;
      const x = s * (onWalk ? (rand() > 0.5 ? rr(30.8, 32.8) : rr(43.2, 45.2)) : rr(33.6, 42.4));
      inst(paperInst, x, onWalk ? 0.148 : 0.05, rr(-56, 54),
        rr(0.18, 0.36), 1, rr(0.24, 0.4), rr(0, Math.PI * 2));
    }
    for (let i = 0; i < 9; i++) { // avenue stains
      inst(patchInst, s * rr(33.8, 42.2), 0.048, rr(-54, 52),
        rr(1.2, 3.8), 1, rr(1.0, 3.0), rr(0, Math.PI));
    }
    // avenue gutter strips along both curb lines
    for (const gx of [33.6, 42.4]) {
      let z = -56 + rr(0, 4);
      while (z < 53) {
        const n = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i++) {
          const px = s * (gx + rr(-0.35, 0.35)), pz = z + rr(-0.8, 0.8);
          const pick = rand();
          if (pick < 0.4) {
            const bs = rr(0.16, 0.32);
            inst(brickInst, px, 0.06 + rr(0, 0.05), pz, bs, bs * 0.55, bs * rr(1.4, 2),
              rr(0, Math.PI), 0, rr(-0.3, 0.3));
          } else if (pick < 0.7) {
            const ds = rr(0.1, 0.3);
            inst(debrisInst, px, 0.04 + rr(0, 0.06), pz, ds, ds * rr(0.5, 0.8), ds,
              rr(0, Math.PI), rr(0, 1), rr(0, 1));
          } else {
            inst(paperInst, px, 0.058, pz, rr(0.18, 0.32), 1, rr(0.2, 0.36), rr(0, Math.PI * 2));
          }
        }
        z += rr(4, 8);
      }
    }
  }
  for (const [cz, hw] of [[50, 3.6], [21, 3.1], [-18.5, 2.6]]) { // cross streets
    for (let i = 0; i < 16; i++) {
      const x = rr(-56, 56);
      if (Math.abs(x) < 7.4) continue; // main street already dressed
      const pick = rand();
      if (pick < 0.45) {
        inst(paperInst, x, 0.05, cz + rr(-hw, hw), rr(0.18, 0.34), 1, rr(0.22, 0.38), rr(0, Math.PI * 2));
      } else if (pick < 0.72) {
        const ds = rr(0.08, 0.3);
        inst(debrisInst, x, 0.04 + rr(0, 0.05), cz + rr(-hw, hw), ds, ds * 0.7, ds,
          rr(0, Math.PI), rr(0, 1), rr(0, 1));
      } else {
        inst(patchInst, x, 0.047, cz + rr(-hw * 0.8, hw * 0.8), rr(1.0, 2.8), 1, rr(0.8, 2.2), rr(0, Math.PI));
      }
    }
  }
  for (let i = 0; i < 14; i++) { // alley grime (dense, it's a service lane)
    const x = rr(-56, -12);
    inst(i % 2 ? paperInst : debrisInst, x, 0.05, rr(-50.6, -45.4),
      rr(0.12, 0.32), i % 2 ? 1 : rr(0.1, 0.24), rr(0.14, 0.34), rr(0, Math.PI), 0, 0);
  }
  // backyard rubble in the two empty lots (dropped buildings read as cleared)
  for (const [lx0, lx1, lz0, lz1] of [[-30.5, -24, -13, -9.5], [46, 54, 18.5, 27.5]]) {
    for (let i = 0; i < 18; i++) {
      const s = rr(0.15, 0.6);
      inst(i % 3 ? brickInst : debrisInst, rr(lx0, lx1), rr(0.05, 0.3), rr(lz0, lz1),
        s, s * rr(0.4, 0.8), s * rr(0.6, 1.1), rr(0, Math.PI), rr(-0.4, 0.4), rr(-0.4, 0.4));
    }
  }

  // per-bag tint jitter so stacks don't read as identical popcorn lumps
  // (local PRNG: keeps the shared rand() sequence untouched)
  {
    let bs = 4242;
    const br = () => { bs = (bs * 16807) % 2147483647; return (bs - 1) / 2147483646; };
    const c = new THREE.Color();
    for (let i = 0; i < bagInst.count; i++) {
      const v = 0.82 + br() * 0.22;
      c.setRGB(v, v * (0.95 + br() * 0.08), v * (0.9 + br() * 0.13));
      bagInst.setColorAt(i, c);
    }
    bagInst.instanceColor.needsUpdate = true;
  }
  // brick chunks: dusty desaturated tint jitter so rubble reads as mortar-caked
  // masonry debris, not fresh salmon brick
  {
    let bs = 9091;
    const br = () => { bs = (bs * 16807) % 2147483647; return (bs - 1) / 2147483646; };
    const c = new THREE.Color();
    for (const bInst of brickBand) {
      for (let i = 0; i < bInst.count; i++) {
        const v = 0.5 + br() * 0.45;           // darken spread
        const de = br() * 0.5;                 // desaturate toward grey dust
        c.setRGB(v, v * (0.86 + de * 0.14), v * (0.8 + de * 0.2));
        bInst.setColorAt(i, c);
      }
      if (bInst.instanceColor) bInst.instanceColor.needsUpdate = true;
    }
  }

  // bake every static plain mesh down to one mesh per material — the draw
  // count, not the polycount, is what the city would otherwise pay for
  finalizeBakes();

  // ---------------------------------------------------------------- finalize instances
  // instance-aware bounding spheres let the renderer frustum-cull whole
  // families and keep raycasts (LOS, bullets) district-local
  for (const im of [...glassBand, ...trimBand, ...brickBand, woodInst, metalInst,
                    drumInst, cylInst, bagInst, debrisInst, paperInst, patchInst,
                    lampPoleInst, lampArmInst, lampHeadInst]) {
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.frustumCulled = true;
  }

  // ---------------------------------------------------------------- squishy bins
  // Hideable soft-body cover: tall metal DUMPSTERS (>=1.35m -> a crouched
  // player at eye 1.15m is fully behind one, so enemy LOS rays hit the shell
  // and the sightline fails) plus shorter round/wheelie TRASH BINS in clusters.
  // Each bin is a live Group (NOT baked) so it can squash-and-stretch every
  // frame: a per-bin damped spring drives a vertical squash + horizontal bulge
  // (volume-ish), a softer tilt spring, and a constant micro-jiggle so they read
  // as rubber even at rest. Impulses come from (a) the player brushing past
  // [throttled by an enter-contact flag] and (b) world.squishAt(point,strength),
  // which main.js already wires to bullet impacts. Bodies sit in BOTH colliders
  // (Box3, so you can't walk through) AND raycastMeshes (userData.surface
  // 'metal', userData.squishy=true) so they block bullets and line of sight.
  const bins = [];
  const SQ_K = 670, SQ_C = 13;      // squash spring: ~4Hz, a couple of damped bounces over ~0.5s
  const TI_K = 130, TI_C = 6.5;     // tilt spring: softer/slower lean
  let binPhase = 0;
  // weathered painted-metal palette: muted dumpster green, grey, dark olive, rust
  const binGreen = stdMat(T.metal, { rx: 2, ry: 1, color: 0x47534a, rough: 0.82, metal: 0.3 });
  const binGrey = stdMat(T.metal, { rx: 2, ry: 1, color: 0x5b5f60, rough: 0.8, metal: 0.34 });
  const binOlive = stdMat(T.metal, { rx: 1, ry: 2, color: 0x3d4433, rough: 0.9, metal: 0.14 });
  const binLidMat = new THREE.MeshStandardMaterial({ color: 0x21231f, roughness: 0.85, metalness: 0.25 });

  function registerBin(group, x, z, ry, radius) {
    group.position.set(x, 0, z);
    group.rotation.set(0, ry, 0); // update() only touches .x/.z (tilt) — .y (yaw) persists
    root.add(group);
    bins.push({
      group, x, z, radius, contactR: radius + 0.5,
      sq: 0, sv: 0, tx: 0, tvx: 0, tz: 0, tvz: 0, contact: false,
      wf: 2.0 + (binPhase % 5) * 0.23, ph: binPhase * 1.7, // desynced idle jiggle
    });
    binPhase++;
  }
  function binBody(group, geo, mat, y) {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true; m.receiveShadow = true;
    m.userData.surface = 'metal';
    m.userData.squishy = true;
    group.add(m);
    raycastMeshes.push(m); // LOS + bullets resolve against the shell
    return m;
  }
  function binPart(group, geo, mat, y, rx = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y; if (rx) m.rotation.x = rx;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  }
  // tall industrial dumpster: L 1.95 x H 1.3 x D 1.02, top face 1.35m (hideable)
  function squishDumpster(x, z, ry, variant = 0) {
    const g = new THREE.Group();
    const L = 1.95, H = 1.3, D = 1.02, y0 = 0.05;
    const bodyMat = variant === 1 ? binGrey : variant === 2 ? binOlive : binGreen;
    binBody(g, new THREE.BoxGeometry(L, H, D), bodyMat, y0 + H / 2); // top = 1.35
    binPart(g, new THREE.BoxGeometry(L + 0.06, 0.08, D + 0.06), binLidMat, y0 + H + 0.03, -0.16); // slanted lid
    binPart(g, new THREE.BoxGeometry(L + 0.08, 0.1, D + 0.08), bodyMat, y0 + H - 0.06);           // top rim lip
    binPart(g, new THREE.BoxGeometry(L + 0.02, 0.15, D + 0.02), M.rust, y0 + H * 0.42);           // grimy ridge band
    for (const sx of [-L / 2 + 0.24, L / 2 - 0.24]) for (const sz of [-D / 2 + 0.18, D / 2 - 0.18]) {
      const f = binPart(g, new THREE.BoxGeometry(0.13, 0.1, 0.13), binLidMat, 0.05);
      f.position.set(sx, 0.05, sz); // little caster feet
    }
    registerBin(g, x, z, ry, Math.max(L, D) / 2);
    obbCollider(x, 0.675, z, L / 2, 0.675, D / 2, ry); // Box3 top = 1.35 (>= 1.25 hideable)
    return g;
  }
  // short round trash can: ~0.83m tall
  function squishBin(x, z, variant = 0) {
    const g = new THREE.Group();
    const R = 0.33, H = 0.72;
    const bodyMat = variant === 1 ? binGrey : variant === 2 ? M.rust : binOlive;
    binBody(g, new THREE.CylinderGeometry(R, R * 0.9, H, 14), bodyMat, H / 2);
    binPart(g, new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.06, 14), binLidMat, H - 0.02); // rim
    binPart(g, new THREE.CylinderGeometry(R * 0.55, R + 0.04, 0.12, 14), binLidMat, H + 0.05); // domed lid
    binPart(g, new THREE.CylinderGeometry(R + 0.02, R + 0.02, 0.05, 14), bodyMat, H * 0.4);    // band
    registerBin(g, x, z, 0, R);
    obbCollider(x, 0.44, z, R, 0.44, R, 0);
    return g;
  }
  // short rectangular wheelie bin: ~0.9m tall
  function squishWheelie(x, z, ry, variant = 0) {
    const g = new THREE.Group();
    const W = 0.5, H = 0.78, D = 0.56, y0 = 0.06;
    const bodyMat = variant === 1 ? binGrey : binOlive;
    binBody(g, new THREE.BoxGeometry(W, H, D), bodyMat, y0 + H / 2);
    binPart(g, new THREE.BoxGeometry(W + 0.05, 0.06, D + 0.09), binLidMat, y0 + H + 0.02, -0.07); // overhanging lid
    for (const sx of [-W / 2 + 0.09, W / 2 - 0.09]) {
      const wm = binPart(g, new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10), binLidMat, 0.07);
      wm.rotation.z = Math.PI / 2; wm.position.set(sx, 0.07, -D / 2 + 0.06); // rear wheels
    }
    registerBin(g, x, z, ry, Math.max(W, D) / 2);
    obbCollider(x, 0.45, z, W / 2, 0.45, D / 2, ry);
    return g;
  }

  // give a bin a squish impulse; leans its top AWAY from the impact point
  function binImpulse(b, strength, fromX, fromZ) {
    const s = Math.min(Math.max(strength, 0), 2);
    b.sq = Math.min(b.sq + 0.26 * s, 0.5); // instant vertical squash
    b.sv -= 1.4 * s;                        // extra downward velocity -> snappier hit
    let dx = b.x - (fromX ?? b.x), dz = b.z - (fromZ ?? b.z);
    const len = Math.hypot(dx, dz);
    if (len > 1e-3) { dx /= len; dz /= len; } else { dx = 0; dz = 1; }
    b.tvx += dz * 1.5 * s;
    b.tvz += -dx * 1.5 * s;
  }
  // nearest bin within ~1.2m of a world point (used by weapon on bullet impact)
  function squishAt(point, strength = 1) {
    if (!point) return false;
    let best = null, bestD = 1.2 * 1.2;
    for (let i = 0; i < bins.length; i++) {
      const b = bins[i];
      const dx = point.x - b.x, dz = point.z - b.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = b; }
    }
    if (!best) return false;
    binImpulse(best, strength, point.x, point.z);
    return true;
  }

  // ----- placements: 6 dumpsters (hideable) + 8 short bins in clusters -----
  squishDumpster(9.55, 12, HPI, 0);      // east sidewalk, mid-block cover
  squishDumpster(-9.55, 13, -HPI, 1);    // west sidewalk (alley scenario view)
  squishDumpster(9.55, 34, HPI, 2);      // east sidewalk near spawn
  squishDumpster(-9.55, 33, -HPI, 0);    // west sidewalk near spawn
  squishDumpster(9.6, -10, HPI, 1);      // east, parking-lot frontage
  squishDumpster(-20, -52.6, 0, 2);      // SW service area / alley mouth
  squishBin(9.62, 30, 0); squishWheelie(9.66, 30.95, HPI, 1);   // east cluster
  squishBin(-9.62, 37, 1); squishBin(-9.66, 37.9, 2);           // west cluster near spawn
  squishBin(-22.3, -52.8, 2); squishBin(-21.55, -53.15, 0);     // SW cluster by the alley dumpster
  squishBin(-24, 27.5, 1); squishWheelie(-23.4, 28.15, 0.5, 0); // plaza SE corner
  // FREE-STANDING curb-line dumpsters in the play area — proper "duck behind it"
  // cover, spaced down both curbs and clearly visible from spawn (kept clear of
  // the driving lane centre and the parked-vehicle spots)
  squishDumpster(6.9, 46, HPI, 1);      // right curb, right ahead of spawn
  squishDumpster(-6.9, 14, -HPI, 0);    // left curb, mid-street
  squishDumpster(6.9, 8, HPI, 2);       // right curb
  squishDumpster(-6.9, -2, -HPI, 1);    // left curb
  squishDumpster(6.9, -14, HPI, 0);     // right curb, lower street
  squishDumpster(-6.9, -38, -HPI, 2);   // left curb, far
  coverPoints.push(V3(5.7, 0, 46), V3(-5.7, 0, 14), V3(5.7, 0, 8), V3(-5.7, 0, -2), V3(5.7, 0, -14));

  // enemy AI also uses the dumpsters/bins as cover (street-side stand points)
  coverPoints.push(
    V3(8.1, 0, 12), V3(-8.1, 0, 13), V3(8.1, 0, 34), V3(-8.1, 0, 33),
    V3(8.2, 0, -10), V3(-21.4, 0, -52.6), V3(8.15, 0, 30.4), V3(-8.15, 0, 37.5),
  );

  // one allocation-free updater: player-bump detection + all bin springs/jiggle
  updaters.push((dt) => {
    const px = _lastP.x, pz = _lastP.z;
    for (let i = 0; i < bins.length; i++) {
      const b = bins[i];
      // player brush: fire once on entering contact, release with hysteresis
      const dx = px - b.x, dz = pz - b.z, d2 = dx * dx + dz * dz;
      const cr = b.contactR;
      if (d2 < cr * cr) {
        if (!b.contact) { b.contact = true; binImpulse(b, 0.75, px, pz); }
      } else if (d2 > (cr + 0.4) * (cr + 0.4)) {
        b.contact = false;
      }
      // squash spring (semi-implicit Euler — stable for dt <= 0.05)
      b.sv += (-SQ_K * b.sq - SQ_C * b.sv) * dt;
      b.sq += b.sv * dt;
      if (b.sq < -0.3) { b.sq = -0.3; if (b.sv < 0) b.sv = 0; }
      else if (b.sq > 0.5) { b.sq = 0.5; if (b.sv > 0) b.sv = 0; }
      // tilt springs
      b.tvx += (-TI_K * b.tx - TI_C * b.tvx) * dt; b.tx += b.tvx * dt;
      b.tvz += (-TI_K * b.tz - TI_C * b.tvz) * dt; b.tz += b.tvz * dt;
      // idle jiggle: tiny continuous soft shimmer so they read as rubber at rest
      const idle = 0.011 * Math.sin(time * b.wf + b.ph) + 0.006 * Math.sin(time * b.wf * 1.7 + b.ph * 2.3);
      const squash = b.sq + idle;      // >0 compresses height, bulges footprint
      const g = b.group;
      g.scale.y = 1 - squash;
      const bulge = 1 + squash * 0.55;
      g.scale.x = bulge; g.scale.z = bulge;
      g.rotation.x = b.tx + 0.006 * Math.sin(time * b.wf * 0.8 + b.ph);
      g.rotation.z = b.tz + 0.006 * Math.sin(time * b.wf * 1.15 + b.ph * 1.7);
    }
  });

  // ---------------------------------------------------------------- spawns + cover
  enemySpawns.push(
    // main street (original set)
    V3(-2.5, 0, -50), V3(4, 0, -46), V3(-8.6, 0, -18), V3(8.6, 0, -2),
    V3(-4, 0, -34), V3(6.3, 0, -24), V3(-8.8, 0, 6), V3(7, 0, -52),
    V3(-2, 0, -52), V3(7.4, 0, 34), V3(-8.5, 0, 36.5),
    // avenues + cross streets + lots (city blocks)
    V3(-38, 0, 30), V3(-38, 0, 0), V3(-37.5, 0, -34), V3(38, 0, 18),
    V3(38.5, 0, -20), V3(37.5, 0, -46), V3(-20, 0, 21), V3(24, 0, -19),
    V3(-50, 0, 50), V3(28, 0, 50.5), V3(16, 0, -11), V3(-25.6, 0, 30.6),
    V3(-24, 0, -48), V3(50, 0, -18.5),
  );
  coverPoints.push(
    // main street (original set)
    V3(-4.5, 0, 39.2), V3(3.5, 0, 11.3), V3(-5, 0, -12.8), V3(5.5, 0, -36.8),
    V3(-8.8, 0, 22.8), V3(-4.2, 0, 32.2), V3(4.8, 0, -8.2), V3(-3.5, 0, -41.2),
    V3(3.7, 0, 24), V3(-4.55, 0, 20.4), V3(2.4, 0, -1.5), V3(-2.8, 0, -23.9),
    V3(5.8, 0, -21.6), V3(-9.25, 0, 46.6), V3(8.9, 0, 18.6), V3(0, 0, -52.5),
    // city blocks: wrecks, barriers, sandbags, planters, furniture
    V3(-36.2, 0, 34), V3(-40.9, 0, 10.2), V3(-35.2, 0, -28.7), V3(-39.6, 0, -38),
    V3(36.4, 0, 12), V3(35.3, 0, 30.3), V3(40.8, 0, -13.8), V3(41.6, 0, -30.3),
    V3(-17, 0, 52.2), V3(12, 0, 48.4), V3(-30, 0, 51.1), V3(-14.5, 0, 19.8),
    V3(26, 0, 22.3), V3(18, 0, -20.8), V3(24, 0, -21.4), V3(15.7, 0, -11.2),
    V3(21.3, 0, -15.1), V3(-26.6, 0, 32.9), V3(-24.3, 0, 28.9), V3(47, 0, 43.6),
    V3(-24.1, 0, -50.3), V3(-9.9, 0, -6.5),
  );

  // ---------------------------------------------------------------- walk paths
  // Sidewalk loops for civilian pedestrians (y=0, on walkable pavement,
  // clear of colliders). Loops 0-4 ring the inner blocks — their east/west
  // edges run the main-street sidewalks so the spine stays populated;
  // 5-6 are long avenue circuits.
  const WP = (pts) => pts.map((p) => V3(p[0], 0, p[1]));
  const walkPaths = [
    WP([[-7.9, 45], [-7.9, 35.5], [-7.9, 25.5], [-20, 25.5], [-31.75, 25.5],
        [-31.75, 35.5], [-31.75, 45], [-20, 45]]),                    // NW block
    WP([[7.9, 45], [7.9, 35.5], [7.9, 25.9], [20, 25.9], [31.75, 25.5],
        [31.75, 35.5], [31.75, 45], [20, 45]]),                       // NE block
    WP([[-7.9, 16.5], [-7.9, 0], [-7.9, -14.5], [-20, -14.5], [-31.75, -14.5],
        [-31.75, 0], [-31.75, 16.5], [-20, 16.5]]),                   // mid-west block
    WP([[7.9, 15.7], [7.9, 4.2], [9.8, 2.5], [7.9, 0.8], [7.9, -15.1], [20, -15.1],
        [31.75, -15.1], [31.75, 0], [31.75, 15.7], [20, 15.7]]),      // mid-east block
    WP([[-7.9, -22.5], [-7.9, -33], [-7.9, -44.2], [-20, -44.2], [-31.75, -44.2],
        [-31.75, -33], [-31.75, -22.5], [-20, -22.5]]),               // SW block
    WP([[31.75, 40], [31.75, 12], [31.75, -12], [31.75, -40], [43.7, -40],
        [43.7, -12], [43.7, 12], [43.7, 40]]),                        // east avenue
    WP([[-31.75, 40], [-31.75, 10], [-31.75, -13], [-31.75, -40], [-43.7, -40],
        [-43.7, -13], [-43.7, 10], [-43.7, 40]]),                     // west avenue
  ];

  // ---------------------------------------------------------------- api
  const api = {
    colliders,
    raycastMeshes,
    enemySpawns,
    coverPoints,
    walkPaths,
    sunDir,
    playerSpawn: V3(0, 0, 52),
    playerSpawnYaw: 0, // yaw 0 faces -Z (three.js YXZ camera convention) — down the street
    // squishAt(worldPoint, strength = 1): impulse the nearest squishy trash bin
    // within ~1.2m of the point so it wobbles/squashes (returns true if one was
    // hit). Wired to bullet impacts by main.js; player bumps are auto-detected in
    // update(). `bins` exposes the live bin state (group/x/z/radius/spring vars).
    squishAt,
    bins,
    update(dt, playerPos) {
      time += dt;
      if (playerPos) {
        recenterSun(playerPos);
        _lastP.copy(playerPos);
        sky.position.set(playerPos.x, 0, playerPos.z); // keep the sky centered on
        // the camera so its 380m shell never clips against the far plane
      }
      for (let i = 0; i < updaters.length; i++) updaters[i](dt);
    },
  };
  api.enterables = enterables; // nav points of walk-in buildings (probe/debug)
  if (typeof window !== 'undefined' && window.__SHOT_MODE__) window.__world = api; // probe hook
  return api;
}
