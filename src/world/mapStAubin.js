// CallOfAcher — world/mapStAubin.js
// "Saint-Aubin-du-Cormier" (Ille-et-Vilaine, Bretagne). A granite Breton bourg
// on a flat green playfield running along Z: a big calm POND with a jetty at the
// south/spawn end, the BOURG in the middle (narrow cobbled streets, massive
// granite houses with dark-slate roofs, the Place with its covered HALLES +
// CALVAIRE, and the parish CHURCH with its tall clocher), rising north onto a
// rocky spur crowned by the medieval CASTLE RUINS — the iconic half-standing
// cylindrical KEEP (donjon), curtain-wall stubs and round tower bases.
// Fully procedural; same createWorld(scene) contract as world/map.js so the
// player / enemies / weapons / civilians / vehicles all run unchanged.
//
// Engine note honoured throughout: the enemy AI pins itself to y=0 and only
// collides with boxes spanning ~0.4..1.6m, so the whole NAVIGABLE playfield is
// kept flat at y=0. Verticality is delivered by tall structures (keep, clocher,
// houses), a boulder-skirted spur + backdrop cliffs, and a PLAYER-climbable
// stone rampart used as the overwatch position.
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
  const rand = (() => { let s = 14880508; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
  const rr = (a, b) => a + rand() * (b - a);
  const _lastP = new THREE.Vector3(0, 0, 50);

  // gentle organic meander of the main "grande rue" — tiny amplitude so the
  // central corridor (where the scripted screenshot enemies stand) stays clear
  const STREET = (z) => 2.2 * Math.sin(z * 0.026) + 0.9 * Math.sin(z * 0.08 + 0.6);

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
  // mesh per material (draw count is the budget). Colliders pushed separately.
  const mergeBins = new Map();
  function bake(mesh, o = {}) {
    mesh.updateMatrixWorld(true);
    const mat = mesh.material;
    let bin = mergeBins.get(mat);
    if (!bin) {
      bin = { mat, geos: [], surface: o.surface ?? 'concrete', cast: o.cast ?? true, recv: o.recv ?? true, ray: o.ray ?? true };
      mergeBins.set(mat, bin);
    }
    // normalize to non-indexed so Box/Cone/Cylinder (indexed) and ExtrudeGeometry
    // roofs (non-indexed) can share one merged mesh per material
    let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    bin.geos.push(g);
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
  // conservative AABB collider for a Y-rotated box
  function obbCollider(cx, cy, cz, hx, hy, hz, ry = 0) {
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    const ex = hx * c + hz * s, ez = hx * s + hz * c;
    colliders.push(new THREE.Box3(V3(cx - ex, cy - hy, cz - ez), V3(cx + ex, cy + hy, cz + ez)));
  }
  function invisibleWall(cx, cz, hx, hz, h = 24) {
    colliders.push(new THREE.Box3(V3(cx - hx, -2, cz - hz), V3(cx + hx, h, cz + hz)));
  }

  // ------------------------------------------------------------- materials
  const M = {
    grass: stdMat(T.dirt, { rx: 150, ry: 150, ns: 1.3, color: 0x74805a }),       // green bocage sward
    gravel: stdMat(T.dirt, { rx: 3.2, ry: 3.2, ns: 1.3, color: 0xb0a892 }),       // promenade gravel
    cobble: stdMat(T.paver, { rx: 4, ry: 4, ns: 1.2, color: 0x9a978d }),          // cobbled street / square
    bed: stdMat(T.dirt, { rx: 5, ry: 5, ns: 1.4, color: 0x4c5346 }),              // pond bed
    granite1: stdMat(T.concrete, { rx: 2.4, ry: 2.4, ns: 1.55, color: 0xa8a49a, rough: 0.98 }), // weathered grey granite
    granite2: stdMat(T.concrete, { rx: 2.4, ry: 2.4, ns: 1.55, color: 0x928d83, rough: 1.0 }),  // darker course
    granite3: stdMat(T.concrete, { rx: 1.8, ry: 1.8, ns: 1.7, color: 0x807b71, rough: 1.0 }),   // damp/lichened ruin stone
    graniteWarm: stdMat(T.concrete, { rx: 2.2, ry: 2.2, ns: 1.5, color: 0xb2ab99, rough: 0.97 }), // sunlit render
    slate: stdMat(T.concrete, { rx: 3, ry: 3, ns: 0.7, color: 0x3b434e, rough: 0.62, metal: 0.0 }),  // ardoise roof
    slate2: stdMat(T.concrete, { rx: 3, ry: 3, ns: 0.7, color: 0x333a45, rough: 0.6 }),               // darker slate
    wood: stdMat(T.wood, { rx: 1, ry: 1, ns: 1.1, color: 0x7c6a4f }),
    woodDk: stdMat(T.wood, { rx: 1, ry: 2, ns: 1.2, color: 0x5a4a36 }),
    jetty: stdMat(T.wood, { rx: 1, ry: 3, ns: 1.1, color: 0x877258 }),
    metal: stdMat(T.metal, { rx: 2, ry: 1, rough: 0.7, metal: 0.35, color: 0x3c4046 }),
    door: stdMat(T.wood, { rx: 1, ry: 1, ns: 1.1, color: 0x4b3f30 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x14202a, roughness: 0.3, metalness: 0.35, emissive: 0x0a1016, emissiveIntensity: 0.3 }),
    litGlass: new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 1, emissive: 0xffb463, emissiveIntensity: 0.75 }),
    shutter: stdMat(T.wood, { rx: 1, ry: 1, ns: 1.0, color: 0x5f6f5a }),          // faded green-grey shutters
    foliage: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: true }),
    willow: new THREE.MeshStandardMaterial({ color: 0x7f8a52, roughness: 1, metalness: 0, flatShading: true }),
    hedge: new THREE.MeshStandardMaterial({ color: 0x596b3c, roughness: 1, metalness: 0, flatShading: true }),
    hydra: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: true }),
    reed: new THREE.MeshStandardMaterial({ color: 0x8f9457, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
    // near-unlit hazy backdrop rock / treeline so the promontory reads as one
    // shoulder of a larger landscape; fog blends the far ring to the horizon
    backdrop: new THREE.MeshStandardMaterial({ color: 0x3a4448, emissive: 0x59707a, roughness: 1, metalness: 0, fog: true }),
    treeline: new THREE.MeshStandardMaterial({ color: 0x2f3a2c, emissive: 0x46583f, roughness: 1, metalness: 0, fog: true }),
  };

  // ------------------------------------------------------------- fog + sky
  // cool blue-grey Breton haze (moderate — the keep must still read at ~120m)
  const HAZE = 0xb7c1c3;
  const FOG = 0.006; // moderate Breton haze — thin enough that the keep reads far
  scene.fog = new THREE.FogExp2(HAZE, FOG);
  scene.background = new THREE.Color(HAZE);

  const sunDir = V3(-0.44, -0.30, -0.80).normalize(); // FROM sun TO scene — low, ahead-left
  const sunPosDir = sunDir.clone().negate();

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uSun: { value: sunPosDir },
      uZenith: { value: new THREE.Color(0x7d93a2) },   // soft blue-grey
      uMid: { value: new THREE.Color(0x9fb0b8) },
      uHorizon: { value: new THREE.Color(0xc3cac8) },  // pale overcast-bright band
      uWarm: { value: new THREE.Color(0xd7cfbd) },     // diffuse, faintly warm low sun
      uGround: { value: new THREE.Color(0xb7c1c3) },
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
      float cfbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*vnoise(p); p=p*2.03+17.17; a*=0.5; } return v; }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.13, h));
        col = mix(col, uZenith, smoothstep(0.10, 0.60, h));
        // faint warm bias toward the low sun
        vec3 sunFlat = normalize(vec3(uSun.x, 0.0, uSun.z));
        vec3 dFlat = normalize(vec3(d.x, 0.001, d.z));
        float az = dot(dFlat, sunFlat)*0.5+0.5;
        float low = 1.0 - smoothstep(0.0, 0.30, abs(h));
        col = mix(col, uWarm, az*az*low*0.30);
        // broad, fairly heavy overcast cloud sheet
        vec2 cp = d.xz / max(d.y, 0.09);
        float cl = cfbm(cp*0.85 + vec2(3.0,7.0))*0.65 + cfbm(cp*2.2 + vec2(9.0,1.0))*0.35;
        float cmask = smoothstep(0.02, 0.14, h) * (1.0 - smoothstep(0.42, 0.62, h));
        float ca = smoothstep(0.42, 0.66, cl) * cmask * 0.5;
        col = mix(col, mix(vec3(0.92,0.94,0.95), uWarm*1.02, az*0.4), ca);
        // diffuse veiled sun — bright soft patch, no hard disc
        float sd = dot(d, uSun);
        col += uWarm * pow(max(sd,0.0), 5.0) * 0.16;
        col += vec3(1.0,0.98,0.92) * pow(max(sd,0.0), 42.0) * 0.28;
        col = mix(col, uGround, smoothstep(-0.02, -0.22, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 40, 24), skyMat);
  sky.frustumCulled = false;
  root.add(sky);

  // ------------------------------------------------------------- lights
  const sun = new THREE.DirectionalLight(0xf1f4f6, 2.55); // cool overcast-white
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const HALF = 58;
  sun.shadow.camera.left = -HALF; sun.shadow.camera.right = HALF;
  sun.shadow.camera.top = HALF; sun.shadow.camera.bottom = -HALF;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 250;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  root.add(sun); root.add(sun.target);

  const SUN_DIST = 120;
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
  recenterSun(V3(0, 0, 20));

  // green-tinted hemisphere fill (bocage bounce) + dim cool sky fill
  const hemi = new THREE.HemisphereLight(0x9fb4bc, 0x50603e, 1.35);
  root.add(hemi);
  const skyFill = new THREE.DirectionalLight(0x9fb0bd, 0.3);
  skyFill.castShadow = false;
  skyFill.position.set(0.44, 0.42, 0.80).multiplyScalar(60);
  root.add(skyFill); root.add(skyFill.target);

  const updaters = [];

  // ------------------------------------------------------------- ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(760, 760), M.grass);
  ground.rotation.x = -HPI;
  ground.castShadow = false; ground.receiveShadow = true;
  ground.userData.surface = 'dirt';
  root.add(ground);
  raycastMeshes.push(ground);
  colliders.push(new THREE.Box3(V3(-380, -3, -380), V3(380, 0, 380))); // floor y<=0

  // flat textured pad (street / square / gravel / parvis). Slightly proud of the
  // sward to kill z-fight; receive-only, raycast for bullet dust.
  function pad(cx, cz, w, d, mat, surface, y = 0.02, ry = 0) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-HPI);
    if (ry) g.rotateY(ry);
    g.translate(cx, y, cz);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = false; m.receiveShadow = true;
    m.userData.surface = surface;
    root.add(m); raycastMeshes.push(m);
    return m;
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
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const boulderInst = makeInst(rockGeo, M.granite3, 260, { surface: 'concrete' });
  const rubbleInst = makeInst(rockGeo, M.granite2, 420, { surface: 'concrete', cast: false, ray: false });
  const cobbleWinInst = makeInst(unitBox, M.glass, 520, { surface: 'concrete', cast: false });     // window glass
  const shutterInst = makeInst(unitBox, M.shutter, 520, { surface: 'wood', ray: false });           // shutters
  const sillInst = makeInst(unitBox, M.granite2, 640, { surface: 'concrete', ray: false, cast: false }); // lintels/sills
  const chimneyInst = makeInst(unitBox, M.granite2, 60, { surface: 'concrete' });
  const stubInst = makeInst(new THREE.CylinderGeometry(1, 1.06, 1, 12, 1, true), M.granite3, 40, { surface: 'concrete' }); // tower-base rings
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1, 6);
  const trunkInst = makeInst(trunkGeo, M.woodDk, 120, { surface: 'wood' });
  const canopyGeo = new THREE.IcosahedronGeometry(1, 0);
  const canopyInst = makeInst(canopyGeo, M.foliage, 260, { surface: 'dirt' });
  const hydraInst = makeInst(canopyGeo, M.hydra, 260, { surface: 'dirt', cast: true });             // hydrangea bushes
  const hedgeInst = makeInst(unitBox, M.hedge, 60, { surface: 'dirt' });
  const reedGeo = new THREE.ConeGeometry(1, 1, 4, 1, true);
  const reedInst = makeInst(reedGeo, M.reed, 900, { surface: 'dirt', cast: false, ray: false });
  const grassGeo = new THREE.ConeGeometry(1, 1, 4, 1, true);
  const grassInst = makeInst(grassGeo, M.foliage, 900, { surface: 'dirt', cast: false, ray: false });

  const _greens = [0x5f6c3b, 0x6b7844, 0x54622f, 0x748150, 0x616e3e];
  const greenPick = () => _greens[(rand() * _greens.length) | 0];
  const _hydras = [0x7fa0d6, 0x6f8fce, 0xcf8fc0, 0xc57fb0, 0x9a86cf]; // blue / pink / mauve
  const hydraPick = () => _hydras[(rand() * _hydras.length) | 0];

  // =============================================================== POND (south)
  const PCX = 0, PCZ = 66, PHW = 21, PHD = 13; // centre + half-extents
  // pond bed
  {
    const g = new THREE.PlaneGeometry(PHW * 2 + 3, PHD * 2 + 3);
    g.rotateX(-HPI); g.translate(PCX, 0.03, PCZ);
    const m = new THREE.Mesh(g, M.bed);
    m.receiveShadow = true; m.castShadow = false; m.userData.surface = 'concrete';
    root.add(m); raycastMeshes.push(m);
  }
  // water shader (translucent blue-green, animated ripple + fresnel)
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: true, side: THREE.DoubleSide, fog: false,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x2b4f52) },
      uShallow: { value: new THREE.Color(0x5f9091) },
      uHaze: { value: new THREE.Color(HAZE) },
      uToSun: { value: sunPosDir },
      uFog: { value: FOG },
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
        rp.x += sin(uv.x*0.7 + t*0.9)*0.5 + (n(uv*0.5 + vec2(t*0.08,0.0))-0.5);
        rp.y += cos(uv.y*0.8 - t*0.7)*0.5 + (n(uv*0.6 - vec2(0.0,t*0.06))-0.5);
        vec3 N = normalize(vec3(rp.x*0.16, 1.0, rp.y*0.16));
        vec3 Vv = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N,Vv),0.0), 3.0);
        vec3 dsun = normalize(uToSun);
        vec3 Hh = normalize(dsun + Vv);
        float spec = pow(max(dot(N,Hh),0.0), 80.0);
        vec3 col = mix(uDeep, uShallow, clamp(N.y*0.5+0.4,0.0,1.0));
        col = mix(col, uHaze*1.05, fres*0.6);
        col += spec * vec3(1.0,0.98,0.9) * 0.5;
        float dist = length(cameraPosition - vWorld);
        float fog = 1.0 - exp(-uFog*uFog*dist*dist);
        col = mix(col, uHaze, clamp(fog,0.0,1.0));
        gl_FragColor = vec4(col, mix(0.78, 0.95, fres));
      }`,
  });
  {
    const g = new THREE.PlaneGeometry(PHW * 2, PHD * 2, 24, 16);
    g.rotateX(-HPI); g.translate(PCX, 0.13, PCZ);
    const water = new THREE.Mesh(g, waterMat);
    water.renderOrder = 2; water.castShadow = false; water.receiveShadow = false;
    root.add(water); // not raycast / not collider — bullets pass to the bed
  }
  // pond perimeter invisible walls (keep player + enemies out of the water),
  // broken at the jetty mouth (x -10..-6 on the north shore)
  invisibleWall(PCX, PCZ + PHD + 0.4, PHW + 1.5, 0.6, 3);            // south shore
  invisibleWall(PCX + PHW + 0.4, PCZ, 0.6, PHD + 1.5, 3);           // east shore
  invisibleWall(PCX - PHW - 0.4, PCZ, 0.6, PHD + 1.5, 3);           // west shore
  for (const [x0, x1] of [[-PHW - 1.5, -10], [-6, PHW + 1.5]])      // north shore (gap = jetty)
    invisibleWall((x0 + x1) / 2, PCZ - PHD - 0.4, (x1 - x0) / 2, 0.6, 3);

  // gravel promenade ringing the town (north) + east/west shores
  pad(PCX, PCZ - PHD - 2.0, PHW * 2 + 6, 3.4, M.gravel, 'dirt');    // north promenade
  pad(PCX + PHW + 2.2, PCZ, 3.2, PHD * 2 + 2, M.gravel, 'dirt');    // east
  pad(PCX - PHW - 2.2, PCZ, 3.2, PHD * 2 + 2, M.gravel, 'dirt');    // west

  // wooden JETTY / pontoon out over the water from the north shore
  {
    const jx = -8, z0 = PCZ - PHD + 0.5, z1 = PCZ - PHD - 8; // extends south into pond
    const cz = (z0 + z1) / 2, len = z0 - z1;
    const deck = box(3.0, 0.28, len, M.jetty);
    deck.position.set(jx, 0.42, cz);
    bake(deck, { surface: 'wood' });
    boxCollider(jx, 0.26, cz, 1.5, 0.5, len / 2);            // walkable deck top ~0.56
    invisibleWall(jx, z1 - 0.3, 1.6, 0.4, 1.4);              // end rail so you don't walk off
    for (const s of [-1, 1]) {                                // side rails + posts
      const rail = box(0.1, 0.5, len, M.jetty);
      rail.position.set(jx + s * 1.45, 0.9, cz);
      bake(rail, { surface: 'wood' });
      boxCollider(jx + s * 1.45, 0.7, cz, 0.12, 0.7, len / 2);
      for (let i = 0; i <= 4; i++) {
        const pz = z0 - (i / 4) * len;
        const post = box(0.18, 1.2, 0.18, M.jetty);
        post.position.set(jx + s * 1.45, 0.6, pz);
        bake(post, { surface: 'wood' });
        // support piles down into the water
        const pile = box(0.16, 0.9, 0.16, M.woodDk);
        pile.position.set(jx + s * 1.45, -0.05, pz);
        bake(pile, { surface: 'wood', cast: false });
      }
    }
    coverPoints.push(V3(jx - 2.4, 0, PCZ - PHD - 1.5), V3(jx + 2.4, 0, PCZ - PHD - 1.5));
  }

  // reeds / cattails around the pond edge
  for (let i = 0; i < 260; i++) {
    const a = rand() * Math.PI * 2;
    const ex = Math.cos(a), ez = Math.sin(a);
    const rx = PHW + rr(-0.6, 1.6), rz = PHD + rr(-0.6, 1.6);
    const x = PCX + ex * rx, z = PCZ + ez * rz;
    if (x > -10.5 && x < -5.5 && z > PCZ - PHD - 1) continue; // keep jetty mouth clear
    const hgt = rr(0.5, 1.25), w = rr(0.05, 0.1);
    inst(reedInst, x, hgt * 0.5, z, w, hgt, w, rr(0, Math.PI), 0, 0, rr(0, 1) < 0.5 ? 0x8f9457 : 0x7c8a4a);
  }

  // picnic benches + tables on the north promenade
  function picnicTable(x, z, ry) {
    const top = box(2.0, 0.1, 0.9, M.wood); top.position.set(x, 0.72, z); top.rotation.y = ry; bake(top, { surface: 'wood' });
    for (const s of [-1, 1]) {
      const bench = box(2.0, 0.08, 0.32, M.wood);
      const bx = Math.sin(ry + HPI) * s * 0.62, bz = Math.cos(ry + HPI) * s * 0.62;
      bench.position.set(x + bx, 0.44, z + bz); bench.rotation.y = ry; bake(bench, { surface: 'wood' });
    }
    for (const cx of [-0.8, 0.8]) for (const cz of [-0.35, 0.35]) {
      const leg = box(0.1, 0.7, 0.1, M.woodDk);
      const lx = Math.cos(ry) * cx - Math.sin(ry) * cz, lz = Math.sin(ry) * cx + Math.cos(ry) * cz;
      leg.position.set(x + lx, 0.35, z + lz); bake(leg, { surface: 'wood', cast: false });
    }
    obbCollider(x, 0.4, z, 1.0, 0.4, 0.85, ry);
    coverPoints.push(V3(x, 0, z + 1.4));
  }
  picnicTable(11, PCZ - PHD - 2.4, 0.15);
  picnicTable(-16, PCZ - PHD - 2.2, -0.2);
  picnicTable(3, PCZ - PHD - 2.6, 0.05);

  // =============================================================== houses
  const litWindows = []; // emissive panels animated in update
  // A massive granite house: granite body, slate gable/hip roof, small shuttered
  // windows, door, chimney. Baked. dir/ry orient the frontage.
  function graniteHouse(cx, cz, w, d, stories, ry, o = {}) {
    const H = stories * 3 + 0.4;
    const bodyMat = o.warm ? M.graniteWarm : (o.dark ? M.granite2 : M.granite1);
    const roofMat = o.dark ? M.slate2 : M.slate;
    const body = box(w, H, d, bodyMat);
    body.position.set(cx, H / 2, cz); body.rotation.y = ry;
    bake(body, { surface: 'concrete' });
    obbCollider(cx, H / 2, cz, w / 2, H / 2, d / 2, ry);

    // roof: gable (ridge along the LONG axis = w) unless hip requested
    const rh = o.hip ? Math.min(w, d) * 0.42 : Math.min(2.6, d * 0.42);
    if (o.hip) {
      const g = new THREE.ConeGeometry(0.5, 1, 4); g.rotateY(Math.PI / 4);
      const rf = new THREE.Mesh(g, roofMat);
      rf.scale.set((w + 0.8) / 0.707, rh, (d + 0.8) / 0.707);
      rf.position.set(cx, H + rh / 2, cz); rf.rotation.y = ry;
      bake(rf, { surface: 'concrete' });
    } else {
      // gable prism: triangle cross-section in XZ-ish, ridge along w
      const s = new THREE.Shape();
      s.moveTo(-d / 2 - 0.5, 0); s.lineTo(d / 2 + 0.5, 0); s.lineTo(0, rh); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: w + 0.8, bevelEnabled: false });
      g.translate(0, 0, -(w / 2 + 0.4));
      g.rotateY(HPI); // ridge now along local X (w axis)
      const rf = new THREE.Mesh(g, roofMat);
      rf.position.set(cx, H, cz); rf.rotation.y = ry;
      bake(rf, { surface: 'concrete' });
      // gable-end stone triangles (fill the ExtrudeGeometry ends look) via thin caps
      for (const s2 of [-1, 1]) {
        const capS = new THREE.Shape();
        capS.moveTo(-d / 2, 0); capS.lineTo(d / 2, 0); capS.lineTo(0, rh); capS.closePath();
        const cg = new THREE.ExtrudeGeometry(capS, { depth: 0.3, bevelEnabled: false });
        const cap = new THREE.Mesh(cg, bodyMat);
        cap.position.set(cx, H, cz);
        cap.rotation.y = ry;
        // move to the gable end along local X
        cap.position.x += Math.cos(ry) * s2 * (w / 2);
        cap.position.z += -Math.sin(ry) * s2 * (w / 2);
        cap.rotation.y = ry + HPI;
        bake(cap, { surface: 'concrete', cast: false });
      }
    }

    // chimney
    const chBase = o.hip ? H + rh * 0.4 : H + rh * 0.5;
    const chx = cx + Math.cos(ry) * (w * 0.32), chz = cz - Math.sin(ry) * (w * 0.32);
    inst(chimneyInst, chx, chBase, chz, 0.7, 1.6, 0.7);
    if (o.smoke) o.smoke.push(V3(chx, chBase + 0.9, chz));

    // frontage windows + shutters + a door (front face normal = +ux)
    const ux = Math.sin(ry), uz = Math.cos(ry); // frontage outward (local +Z rotated)
    // we treat the "front" as the +z local face (depth d). Build a window grid.
    const cols = Math.max(2, Math.floor((w - 1.6) / 2.2));
    const span = (cols - 1) * 2.2;
    const nz = uz, nx = ux; // outward normal of front face
    const front = 0.02;
    for (let st = 0; st < stories; st++) {
      for (let c = 0; c < cols; c++) {
        const along = -span / 2 + c * 2.2; // position along the wall (local x)
        const wx = cx + Math.cos(ry) * along + nx * (d / 2 + front);
        const wz = cz - Math.sin(ry) * along + nz * (d / 2 + front);
        const wy = st * 3 + 1.8;
        if (st === 0 && c === (o.doorCol ?? 0)) {
          // wooden door
          const door = box(1.1, 2.2, 0.12, M.door);
          door.position.set(cx + Math.cos(ry) * along + nx * (d / 2 + 0.06),
            1.1, cz - Math.sin(ry) * along + nz * (d / 2 + 0.06));
          door.rotation.y = ry;
          bake(door, { surface: 'wood' });
          inst(sillInst, wx, 2.32, wz, 1.5, 0.16, 0.3, ry);
          continue;
        }
        // small recessed window
        inst(cobbleWinInst, wx, wy, wz, 0.95, 1.25, 0.1, ry);
        inst(sillInst, wx, wy - 0.72, wz, 1.35, 0.14, 0.28, ry);  // sill
        inst(sillInst, wx, wy + 0.72, wz, 1.35, 0.16, 0.3, ry);   // lintel
        // shutters (two leaves)
        for (const sdir of [-1, 1]) {
          const sax = Math.cos(ry) * sdir * 0.62;
          const saz = -Math.sin(ry) * sdir * 0.62;
          inst(shutterInst, wx + sax, wy, wz - nx * 0.01, 0.55, 1.25, 0.06, ry);
        }
        // a couple of lit windows for warmth
        if ((st === 1 && c === 1 && (cx + cz) % 2 < 1) || (o.lit && st === 0 && c === cols - 1)) {
          const lm = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.15), M.litGlass.clone());
          lm.position.set(wx + nx * 0.02, wy, wz + nz * 0.02);
          lm.rotation.y = ry + (nz >= 0 ? 0 : Math.PI);
          lm.userData.surface = 'concrete';
          root.add(lm); litWindows.push(lm);
        }
      }
    }
    // simple windows on the two side faces (sparse)
    for (const zi of [-1, 1]) {
      const dcols = Math.max(1, Math.floor((d - 1.8) / 2.4));
      for (let st = 0; st < stories; st++) {
        if ((st + c0hash(cx)) % 2 === 0) continue;
        for (let c = 0; c < dcols; c++) {
          const along = -((dcols - 1) * 2.4) / 2 + c * 2.4;
          const sideNx = Math.cos(ry) * zi, sideNz = -Math.sin(ry) * zi;
          const wx = cx + sideNx * (w / 2 + front) + (-Math.sin(ry)) * along;
          const wz = cz + sideNz * (w / 2 + front) + (-Math.cos(ry)) * along;
          const wy = st * 3 + 1.8;
          inst(cobbleWinInst, wx, wy, wz, 0.1, 1.15, 0.85, ry);
          inst(sillInst, wx, wy + 0.7, wz, 0.28, 0.15, 1.3, ry);
        }
      }
    }
  }
  const c0hash = (v) => Math.abs(Math.round(v)) % 2;

  const chimneySmoke = [];
  // [cx, cz, w, d, stories, ry, opts]. Front faces the street/square.
  const houseDefs = [
    // west row along the street (front faces +X → east)
    [-12, 44, 8, 8, 2, HPI, { doorCol: 1, lit: 1 }],
    [-13, -3, 9, 8, 2, HPI, { dark: 1, doorCol: 1 }],
    [-13, -16, 8, 9, 2, HPI, { warm: 1, doorCol: 0, lit: 1 }],
    [-12, -29, 8, 8, 2, HPI, { doorCol: 1 }],
    [-15, -40, 8, 7, 2, HPI, { dark: 1 }],
    // west, framing the Place (front faces +X / +Z)
    [-24, 22, 8, 8, 2, HPI, { warm: 1, doorCol: 0 }],
    [-25, 33, 9, 7, 3, 0, { doorCol: 1, lit: 1, hip: 1 }],   // taller corner maison de maître
    [-17, 40, 7, 7, 2, 0, { dark: 1 }],
    // east row (front faces -X → west)
    [11, 30, 8, 8, 2, -HPI, { doorCol: 1, lit: 1 }],
    [12, -3, 9, 9, 3, -HPI, { warm: 1, doorCol: 0, hip: 1 }],
    [11, -18, 8, 8, 2, -HPI, { dark: 1, doorCol: 1 }],
    [12, -31, 8, 8, 2, -HPI, { doorCol: 0, lit: 1 }],
    [14, 44, 7, 7, 2, -HPI, { warm: 1 }],
    // a back lane pair (front faces +Z), makes a narrow alley behind the east row
    [19, 34, 8, 6, 2, Math.PI, { dark: 1, doorCol: 1 }],
    [24, 24, 7, 6, 2, Math.PI, { doorCol: 0, lit: 1 }],
  ];
  for (const h of houseDefs) graniteHouse(h[0], h[1], h[2], h[3], h[4], h[5], { ...(h[6] || {}), smoke: chimneySmoke });

  // cobbled main street + a couple of narrow side rues
  {
    // stitch the grande rue as overlapping cobble pads following STREET(z)
    for (let z = 50; z >= -46; z -= 6) {
      const cx = STREET(z);
      pad(cx, z - 3, 9, 6.6, M.cobble, 'concrete', 0.02);
    }
    // east–west alley behind the east row (z≈27) and a rue by the pond (z≈46)
    pad(17, 27, 14, 3.4, M.cobble, 'concrete', 0.021, 0);
    pad(-3, 47, 22, 4.5, M.cobble, 'concrete', 0.021, 0);
  }

  // =============================================================== the Place (square)
  const SQX = -12, SQZ = 26;
  pad(SQX, SQZ, 22, 20, M.cobble, 'concrete', 0.025);
  // parvis in front of the church (east)
  pad(6.5, 10, 5, 12, M.cobble, 'concrete', 0.024);

  // --- the HALLES: open-sided covered market. Granite/timber posts + big slate hip
  {
    const hx = SQX + 2, hz = SQZ - 1, HW = 9, HD = 6, postH = 3.0;
    // posts (4 x 3 grid, granite plinth + timber post)
    for (let ix = 0; ix < 4; ix++) {
      for (let iz = 0; iz < 3; iz++) {
        const px = hx - HW / 2 + (ix / 3) * HW;
        const pz = hz - HD / 2 + (iz / 2) * HD;
        const plinth = box(0.5, 0.5, 0.5, M.granite2); plinth.position.set(px, 0.25, pz); bake(plinth, { surface: 'concrete' });
        const post = box(0.32, postH, 0.32, M.woodDk); post.position.set(px, 0.5 + postH / 2, pz); bake(post, { surface: 'wood' });
        obbCollider(px, 1.4, pz, 0.28, 1.4, 0.28, 0);
        // brace
        const brace = box(0.2, 0.2, HD * 0.9, M.woodDk); brace.position.set(px, 0.5 + postH - 0.2, pz); bake(brace, { surface: 'wood', cast: false });
      }
      const spine = box(HW * 0.34, 0.22, 0.24, M.woodDk);
      spine.position.set(hx - HW / 2 + (ix / 3) * HW, 0.5 + postH - 0.1, hz);
    }
    // longitudinal beams
    for (const pz of [hz - HD / 2, hz, hz + HD / 2]) {
      const beam = box(HW + 0.6, 0.22, 0.26, M.woodDk); beam.position.set(hx, 0.5 + postH - 0.11, pz); bake(beam, { surface: 'wood', cast: false });
    }
    // big slate hipped roof
    const rh = 2.6;
    const g = new THREE.ConeGeometry(0.5, 1, 4); g.rotateY(Math.PI / 4);
    const rf = new THREE.Mesh(g, M.slate2);
    rf.scale.set((HW + 2.4) / 0.707, rh, (HD + 2.4) / 0.707);
    rf.position.set(hx, 0.5 + postH + rh / 2, hz);
    bake(rf, { surface: 'concrete' });
    // a few market trestle tables under it
    for (const [tx, tz, tr] of [[hx - 2.6, hz - 1, 0.2], [hx + 2.2, hz + 1.2, -0.3], [hx - 0.5, hz + 1.8, 0.1]]) {
      const top = box(1.8, 0.08, 0.8, M.wood); top.position.set(tx, 0.78, tz); top.rotation.y = tr; bake(top, { surface: 'wood' });
      obbCollider(tx, 0.42, tz, 0.9, 0.42, 0.45, tr);
    }
    coverPoints.push(V3(hx - HW / 2, 0, hz), V3(hx + HW / 2, 0, hz), V3(hx, 0, hz - HD / 2 - 0.8), V3(hx, 0, hz + HD / 2 + 0.8));
    enemySpawns.push(V3(hx + 1, 0, hz));
  }

  // --- the CALVAIRE: Breton granite cross on a stepped base (square centrepiece)
  {
    const kx = SQX - 6, kz = SQZ + 5;
    for (let i = 0; i < 3; i++) {
      const s = 2.4 - i * 0.6;
      const step = box(s, 0.32, s, M.granite2); step.position.set(kx, 0.16 + i * 0.32, kz); bake(step, { surface: 'concrete' });
    }
    const socle = box(0.7, 1.0, 0.7, M.granite1); socle.position.set(kx, 1.46, kz); bake(socle, { surface: 'concrete' });
    const shaft = box(0.28, 2.6, 0.28, M.granite1); shaft.position.set(kx, 3.2, kz); bake(shaft, { surface: 'concrete' });
    const armH = box(1.3, 0.28, 0.26, M.granite1); armH.position.set(kx, 4.1, kz); bake(armH, { surface: 'concrete' });
    const armTop = box(0.28, 0.5, 0.26, M.granite1); armTop.position.set(kx, 4.55, kz); bake(armTop, { surface: 'concrete' });
    obbCollider(kx, 0.8, kz, 1.2, 0.8, 1.2, 0);
    coverPoints.push(V3(kx + 1.8, 0, kz), V3(kx - 1.8, 0, kz));
  }

  // --- stone well on the square edge
  {
    const wx = SQX + 8, wz = SQZ + 6;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.75, 0.9, 12), M.granite2);
    ring.position.set(wx, 0.45, wz); bake(ring, { surface: 'concrete' });
    for (const s of [-1, 1]) { const post = box(0.14, 1.5, 0.14, M.woodDk); post.position.set(wx + s * 0.6, 1.2, wz); bake(post, { surface: 'wood' }); }
    const roof = box(1.8, 0.14, 1.0, M.slate2); roof.position.set(wx, 2.0, wz); bake(roof, { surface: 'concrete' });
    obbCollider(wx, 0.6, wz, 0.8, 0.6, 0.8, 0);
    coverPoints.push(V3(wx, 0, wz + 1.3));
  }

  // café terrace: parasols + bistro tables/chairs along the street edge of the Place
  const parasolMat = new THREE.MeshStandardMaterial({ color: 0x9c5a4a, roughness: 1, side: THREE.DoubleSide });
  function terraceSet(x, z) {
    const tt = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 12), M.metal); tt.position.set(x, 0.72, z); bake(tt, { surface: 'metal' });
    const leg = box(0.1, 0.72, 0.1, M.metal); leg.position.set(x, 0.36, z); bake(leg, { surface: 'metal', cast: false });
    for (let i = 0; i < 3; i++) { const a = i * 2.1; const ch = box(0.4, 0.5, 0.4, M.metal); ch.position.set(x + Math.cos(a) * 0.9, 0.4, z + Math.sin(a) * 0.9); bake(ch, { surface: 'metal', cast: false }); }
    const pole = box(0.08, 2.2, 0.08, M.woodDk); pole.position.set(x, 1.1, z); bake(pole, { surface: 'wood' });
    const g = new THREE.ConeGeometry(0.5, 1, 8); const um = new THREE.Mesh(g, parasolMat); um.scale.set(3.4, 0.7, 3.4); um.position.set(x, 2.35, z); bake(um, { surface: 'concrete', cast: true });
    obbCollider(x, 0.5, z, 0.6, 0.5, 0.6, 0);
    coverPoints.push(V3(x, 0, z + 1.4));
  }
  terraceSet(-3.2, 20);
  terraceSet(-3.6, 26);
  terraceSet(-5.5, 32);

  // =============================================================== the CHURCH (Église Saint-Aubin)
  {
    const nx = 13.5, nz = 9, NW = 8, ND = 13, NH = 8; // nave
    const nave = box(NW, NH, ND, M.granite1); nave.position.set(nx, NH / 2, nz); bake(nave, { surface: 'concrete' });
    obbCollider(nx, NH / 2, nz, NW / 2, NH / 2, ND / 2, 0);
    // steep gabled slate roof over the nave (ridge along Z)
    {
      const rh = 3.4;
      const s = new THREE.Shape(); s.moveTo(-NW / 2 - 0.5, 0); s.lineTo(NW / 2 + 0.5, 0); s.lineTo(0, rh); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: ND + 0.8, bevelEnabled: false }); g.translate(0, 0, -(ND / 2 + 0.4));
      const rf = new THREE.Mesh(g, M.slate2); rf.position.set(nx, NH, nz); bake(rf, { surface: 'concrete' });
      for (const s2 of [-1, 1]) { // gable end stone
        const cs = new THREE.Shape(); cs.moveTo(-NW / 2, 0); cs.lineTo(NW / 2, 0); cs.lineTo(0, rh); cs.closePath();
        const cg = new THREE.ExtrudeGeometry(cs, { depth: 0.3, bevelEnabled: false });
        const cap = new THREE.Mesh(cg, M.granite1); cap.position.set(nx, NH, nz + s2 * (ND / 2)); bake(cap, { surface: 'concrete', cast: false });
      }
    }
    // tall bell TOWER / clocher at the south front (town-facing) — the landmark
    const tx = nx, tz = nz + ND / 2 + 1.8, TW = 4.2, TH = 15;
    const tower = box(TW, TH, TW, M.granite1); tower.position.set(tx, TH / 2, tz); bake(tower, { surface: 'concrete' });
    obbCollider(tx, TH / 2, tz, TW / 2, TH / 2, TW / 2, 0);
    // belfry openings (dark recesses on each face near the top)
    for (const [ox, oz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const rec = box(oz ? 1.4 : 0.1, 2.2, oz ? 0.1 : 1.4, M.glass);
      rec.position.set(tx + ox * (TW / 2 + 0.02), TH - 3, tz + oz * (TW / 2 + 0.02)); bake(rec, { surface: 'concrete', cast: false });
      // louvre lintel
      const lin = box(oz ? 1.8 : 0.35, 0.3, oz ? 0.35 : 1.8, M.granite2);
      lin.position.set(tx + ox * (TW / 2 + 0.05), TH - 1.7, tz + oz * (TW / 2 + 0.05)); bake(lin, { surface: 'concrete', cast: false });
    }
    // octagonal slate spire
    const spire = new THREE.Mesh(new THREE.ConeGeometry(TW * 0.62, 6.5, 8), M.slate2);
    spire.position.set(tx, TH + 3.2, tz); bake(spire, { surface: 'concrete' });
    // little corner pinnacles
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pin = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 6), M.granite2);
      pin.position.set(tx + sx * TW / 2, TH + 0.7, tz + sz * TW / 2); bake(pin, { surface: 'concrete', cast: false });
    }
    // a small apse at the north end
    const apse = new THREE.Mesh(new THREE.CylinderGeometry(NW / 2, NW / 2, NH * 0.8, 10, 1, false, -HPI, Math.PI), M.granite1);
    apse.position.set(nx, NH * 0.4, nz - ND / 2); apse.rotation.y = 0; bake(apse, { surface: 'concrete' });
    // arched windows down the nave sides (tall recesses)
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const wz = nz - 4 + i * 4;
      const rec = box(0.1, 3.2, 1.2, M.glass); rec.position.set(nx + s * (NW / 2 + 0.02), 3.6, wz); bake(rec, { surface: 'concrete', cast: false });
      const arch = box(0.3, 0.5, 1.5, M.granite2); arch.position.set(nx + s * (NW / 2 + 0.05), 5.4, wz); bake(arch, { surface: 'concrete', cast: false });
    }
    // main door on the parvis (south front, west of tower base)
    const door = box(2.0, 3.0, 0.2, M.door); door.position.set(nx - 0.2, 1.5, nz + ND / 2 + 0.05); bake(door, { surface: 'wood' });
    coverPoints.push(V3(nx - NW / 2 - 1.3, 0, nz), V3(nx + NW / 2 + 1.3, 0, nz), V3(tx - TW / 2 - 1.3, 0, tz));
    enemySpawns.push(V3(nx - NW / 2 - 2, 0, nz + 4), V3(nx + NW / 2 + 2, 0, nz - 3));
  }

  // =============================================================== the SPUR + castle ruins (north)
  // Keep the playfield flat (enemies pin to y=0). The "éperon rocheux" is sold
  // with a granite base-skirt of boulders, backdrop cliffs + a ravine drop, and
  // a PLAYER-climbable rampart. Ruins/tower-stubs are y=0 combat cover.

  // --- THE BROKEN KEEP (donjon) — the hero. A ~13m granite cylinder cut in half
  // in plan AND height: only the NORTH arc survives as a tall jagged sliver, so
  // the sliced thick cross-section faces the town (south) — the town's landmark.
  const KX = -1, KZ = -66, KRO = 6.6, KRI = 3.1, KH = 14.0;   // outer/inner radius, height
  const bannerAnchor = V3(KX, KH + 0.4, KZ - (KRO + KRI) / 2);
  const keepStone = stdMat(T.concrete, { rx: 2.4, ry: 3.2, ns: 1.7, color: 0x9c968b, rough: 1.0 });
  keepStone.side = THREE.DoubleSide; // player sees the concave inner face

  // rugged granite spur: boulder skirt rising behind/around the keep (a clear
  // zone is kept around the tower so it reads proud; front bailey stays open)
  for (let i = 0; i < 70; i++) {
    const z = rr(-90, -48);
    const t = (z + 48) / -42;                          // 0 near town → 1 far north
    const x = rr(-36, 36);
    const dk = Math.hypot(x - KX, (z - KZ) * 1.15);
    if (dk < 12.5) continue;                            // keep the tower proud
    if (Math.abs(x) < 18 && z > -58) continue;         // open front bailey
    const s = rr(0.9, 2.1) * (0.7 + t * 0.8);
    inst(boulderInst, x, s * 0.3, z, s * rr(1.0, 1.5), s * rr(0.7, 1.15), s * rr(1.0, 1.5), rr(0, Math.PI), rr(-0.14, 0.14), rr(-0.14, 0.14));
  }
  // low hazy rock backdrop + ravine drop far to the north (unreachable)
  for (let i = 0; i < 22; i++) {
    const x = rr(-46, 46), z = rr(-102, -88);
    const h = rr(4, 12);
    const m = box(rr(5, 11), h, rr(5, 10), M.granite3);
    m.position.set(x, h * 0.5 - 1.6, z); m.rotation.y = rr(0, Math.PI); m.rotation.z = rr(-0.1, 0.1);
    bake(m, { surface: 'concrete', cast: true });
  }
  { const rav = box(96, 6, 8, M.granite3); rav.position.set(0, -3.4, -92); bake(rav, { surface: 'concrete', cast: false }); }

  {
    const Rc = (KRO + KRI) / 2;
    // curved thick wall shell over an arc: outer + inner cylinder skins + the two
    // sliced end-caps (the exposed 3.5m-thick cross-section)
    function curvedWall(r0, r1, y0, y1, aStart, aLen) {
      const seg = Math.max(6, Math.round((aLen / Math.PI) * 22));
      const hgt = y1 - y0, cy = (y0 + y1) / 2;
      let m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r1, hgt, seg, 1, true, aStart, aLen), keepStone);
      m.position.set(KX, cy, KZ); bake(m, { surface: 'concrete' });
      m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, hgt, seg, 1, true, aStart, aLen), keepStone);
      m.position.set(KX, cy, KZ); bake(m, { surface: 'concrete', cast: false });
      for (const a of [aStart, aStart + aLen]) {
        const ex = Math.sin(a), ez = Math.cos(a);
        const cap = box(r1 - r0, hgt, 0.5, keepStone);
        cap.position.set(KX + ex * Rc, cy, KZ + ez * Rc); cap.rotation.y = a - HPI;
        bake(cap, { surface: 'concrete' });
      }
    }
    // arc convention: theta from +Z(0) → +X(π/2); the NORTH half is π/2..3π/2
    const A0 = HPI, ALEN = Math.PI;                 // lower drum: full north half
    const UA0 = Math.PI - 0.30 * Math.PI, UALEN = 0.60 * Math.PI; // tall central sliver
    curvedWall(KRI, KRO, 0, 6.4, A0, ALEN);
    curvedWall(KRI, KRO, 6.1, KH, UA0, UALEN);

    // toothed / jagged crenellation along the exposed top rims
    function merlons(y, aStart, aLen, n) {
      for (let i = 0; i < n; i++) {
        const a = aStart + ((i + 0.5) / n) * aLen;
        const ex = Math.sin(a), ez = Math.cos(a);
        const th = box(KRO - KRI, rr(0.5, 1.3), 1.05, keepStone);
        th.position.set(KX + ex * Rc, y + 0.35, KZ + ez * Rc); th.rotation.y = a - HPI;
        bake(th, { surface: 'concrete', cast: false });
      }
    }
    merlons(KH, UA0, UALEN, 5);                     // crown teeth
    merlons(6.4, A0, 0.30 * Math.PI, 2);            // west shoulder
    merlons(6.4, A0 + 0.70 * Math.PI, 0.30 * Math.PI, 2); // east shoulder

    // inner-face detailing (all read from the town side): two tall arched
    // openings, rows of floor-joist holes, a fireplace recess + latrine chute
    function innerBox(a, y, w, h, dep, mat) {
      const ex = Math.sin(a), ez = Math.cos(a);
      const b = box(dep, h, w, mat); // dep = radial, w = tangent
      b.position.set(KX + ex * (KRI - 0.08), y, KZ + ez * (KRI - 0.08)); b.rotation.y = a - HPI;
      bake(b, { surface: 'concrete', cast: false });
    }
    innerBox(Math.PI - 0.16, 6.4, 1.5, 3.0, 0.4, M.glass);   // arched opening (upper)
    innerBox(Math.PI + 0.16, 6.4, 1.5, 3.0, 0.4, M.glass);
    for (const yy of [3.4, 8.4, 11.2]) for (let i = 0; i < 6; i++) {
      const a = HPI + 0.12 + (i / 5) * (Math.PI - 0.24);
      if (yy > 6.4 && (a < UA0 || a > UA0 + UALEN)) continue; // sliver only up high
      innerBox(a, yy, 0.4, 0.4, 0.3, M.glass);               // beam sockets
    }
    innerBox(Math.PI, 1.3, 1.8, 2.4, 0.5, M.glass);          // fireplace
    { const chute = box(0.5, 9.5, 0.5, keepStone); const a = Math.PI + 0.4; chute.position.set(KX + Math.sin(a) * (KRI + 0.2), 4.75, KZ + Math.cos(a) * (KRI + 0.2)); chute.rotation.y = a; bake(chute, { surface: 'concrete' }); }

    // wall-ring colliders (player walks around it + into the open concave side)
    for (let i = 0; i < 8; i++) {
      const a = A0 + ((i + 0.5) / 8) * ALEN;
      const ex = Math.sin(a), ez = Math.cos(a);
      const chord = (ALEN * Rc / 8) / 2 + 0.2;
      obbCollider(KX + ex * Rc, 4, KZ + ez * Rc, (KRO - KRI) / 2 + 0.25, 4, chord, a - HPI);
    }
    // fallen rubble spilling from the cut ends into the bailey (south)
    for (let i = 0; i < 30; i++) {
      const s = rr(0.35, 1.15);
      inst(rubbleInst, KX + rr(-KRO - 1, KRO + 1), s * 0.3, KZ + rr(0.5, KRO + 4),
        s * rr(1, 1.5), s * rr(0.6, 1), s * rr(1, 1.5), rr(0, Math.PI), rr(-0.3, 0.3), rr(-0.3, 0.3));
    }
    // banner pole + pennon at the crown (waves in update)
    const pole = box(0.14, 3.2, 0.14, M.woodDk); pole.position.set(bannerAnchor.x, KH + 1.6, bannerAnchor.z); bake(pole, { surface: 'wood' });
    coverPoints.push(V3(KX - KRO - 1.3, 0, KZ + 1), V3(KX + KRO + 1.3, 0, KZ + 1), V3(KX, 0, KZ - KRI - 0.6));
    enemySpawns.push(V3(KX - KRO - 2.4, 0, KZ + 2), V3(KX + KRO + 2.4, 0, KZ + 2), V3(KX, 0, KZ + KRO + 3));
  }

  // Gwenn-ha-du-style abstract pennon (black/white bands, NO logos)
  const pennonMat = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 40;
    const g = c.getContext('2d');
    g.fillStyle = '#e9ecee'; g.fillRect(0, 0, 64, 40);
    for (let i = 0; i < 4; i++) { g.fillStyle = '#20242a'; g.fillRect(0, i * 10, 64, 5); }
    g.fillStyle = '#20242a'; g.fillRect(0, 0, 22, 20);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 1, side: THREE.DoubleSide });
  })();
  const pennon = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3, 8, 1), pennonMat);
  pennon.position.set(bannerAnchor.x + 1.1, KH + 2.2, bannerAnchor.z);
  pennon.castShadow = true; pennon.userData.surface = 'wood';
  root.add(pennon);
  const _pennonBase = pennon.geometry.attributes.position.array.slice();

  // --- ENCLOSURE: curtain-wall stubs + round tower BASES on a ~90x30 footprint
  function curtainStub(x0, z0, x1, z1, h) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0);
    // broken run: a few boxes with jittered heights + gaps
    const n = Math.max(2, Math.round(len / 3));
    for (let i = 0; i < n; i++) {
      if (rand() < 0.16) continue; // gap
      const t = (i + 0.5) / n;
      const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
      const hh = h * rr(0.7, 1.1);
      const seg = box(len / n * 0.96, hh, 1.4, i % 2 ? M.granite3 : M.granite2);
      seg.position.set(px, hh / 2, pz); seg.rotation.y = ry; bake(seg, { surface: 'concrete' });
      obbCollider(px, hh / 2, pz, len / n / 2, hh / 2, 0.75, ry);
    }
    coverPoints.push(V3(cx + Math.cos(ry) * 1.4, 0, cz - Math.sin(ry) * 1.4));
  }
  function towerBase(x, z, r, h) {
    inst(stubInst, x, h / 2, z, r, h, r);                 // ruined ring wall
    // a couple of merlon teeth
    for (let k = 0; k < 5; k++) { const a = rand() * Math.PI * 2; const tth = box(0.6, rr(0.3, 0.8), 0.6, M.granite2); tth.position.set(x + Math.cos(a) * r * 0.92, h + 0.2, z + Math.sin(a) * r * 0.92); bake(tth, { surface: 'concrete', cast: false }); }
    boxCollider(x, h / 2, z, r * 0.95, h / 2, r * 0.95);
    coverPoints.push(V3(x, 0, z + r + 0.8), V3(x, 0, z - r - 0.8));
  }
  // quadrilateral enclosure around the keep (footprint ~ x -28..28, z -78..-50)
  curtainStub(-28, -52, -6, -50, 1.5);
  curtainStub(6, -50, 28, -53, 1.4);
  curtainStub(28, -53, 26, -74, 1.6);
  curtainStub(-28, -52, -27, -76, 1.5);
  curtainStub(-27, -76, 26, -77, 1.3);
  towerBase(-27, -52, 2.4, 1.9);
  towerBase(27, -52, 2.3, 1.8);
  towerBase(27, -75, 2.5, 2.0);
  towerBase(-27, -76, 2.4, 1.9);
  towerBase(-14, -74, 1.9, 1.6);

  // medieval garden (jardin médiéval): low hedges + flower beds in the SW enclosure
  for (let i = 0; i < 5; i++) {
    const gx = -22 + i * 2.6, gz = -60;
    inst(hedgeInst, gx, 0.45, gz, 0.8, 0.9, 5.5, 0, 0, 0, greenPick());
  }
  for (let i = 0; i < 40; i++) {
    inst(hydraInst, rr(-24, -12), rr(0.2, 0.4), rr(-64, -56), rr(0.3, 0.55), rr(0.3, 0.5), rr(0.3, 0.55), rr(0, Math.PI), 0, 0, hydraPick());
  }

  // battle STELE (1488) near the enclosure entrance
  {
    const sx = 10, sz = -50;
    const base = box(1.6, 0.4, 1.2, M.granite2); base.position.set(sx, 0.2, sz); bake(base, { surface: 'concrete' });
    const stele = box(0.9, 2.4, 0.35, M.granite1); stele.position.set(sx, 1.4, sz); stele.rotation.y = 0.1; bake(stele, { surface: 'concrete' });
    obbCollider(sx, 1.0, sz, 0.6, 1.0, 0.6, 0);
    coverPoints.push(V3(sx + 1.4, 0, sz));
  }

  // --- PLAYER-climbable RAMPART (overwatch) on the east curtain, facing town
  {
    const rx = 20, rz = -49, wallH = 4.0, runLen = 9;
    // the wall (faces south/town)
    const wall = box(2.0, wallH, runLen, M.granite2); wall.position.set(rx, wallH / 2, rz); bake(wall, { surface: 'concrete' });
    obbCollider(rx, wallH / 2, rz, 1.0, wallH / 2, runLen / 2, 0);
    // low parapet on top
    const par = box(0.5, 0.7, runLen, M.granite3); par.position.set(rx - 0.75, wallH + 0.35, rz); bake(par, { surface: 'concrete' });
    obbCollider(rx - 0.75, wallH + 0.35, rz, 0.25, 0.35, runLen / 2, 0);
    // walkable wall-top platform collider (top at wallH)
    boxCollider(rx, wallH / 2 - 0.1, rz, 1.0, wallH / 2, runLen / 2);
    // stone stair up the BACK (north) side — 8 steps of 0.5
    for (let i = 0; i < 8; i++) {
      const topY = 0.5 * (i + 1);
      const st = box(1.9, topY, 0.7, M.granite3);
      const sz = rz + runLen / 2 - 0.4 - i * 0.7;
      st.position.set(rx + 1.5, topY / 2, sz); bake(st, { surface: 'concrete' });
      boxCollider(rx + 1.5, topY / 2 - 0.1, sz, 0.95, topY / 2, 0.36);
    }
    coverPoints.push(V3(rx - 0.5, 4.0, rz)); // atop the rampart (player vantage)
  }

  // =============================================================== vegetation
  // bocage trees (rounded canopy) + weeping willows near the pond (hero, sway)
  function tree(x, z, scale) {
    const th = 3.0 * scale;
    inst(trunkInst, x, th * 0.5, z, 1, th, 1, 0, rr(-0.05, 0.05), rr(-0.05, 0.05));
    const n = 2 + (rand() < 0.6 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const r = rr(1.8, 2.7) * scale;
      inst(canopyInst, x + rr(-0.7, 0.7), th + rr(-0.2, 0.7) * scale, z + rr(-0.7, 0.7),
        r, r * rr(0.8, 1.0), r, rr(0, Math.PI), rr(-0.15, 0.15), rr(-0.15, 0.15), greenPick());
    }
    boxCollider(x, 1.2, z, 0.35, 1.2, 0.35);
  }
  // scatter bocage on the green fringes (avoid streets/square/pond/enclosure)
  let placed = 0;
  for (let i = 0; i < 260 && placed < 70; i++) {
    const z = rr(-46, 84);
    const x = rr(-42, 42);
    if (Math.abs(x) < 26 && z > -46 && z < 50) continue;         // town core
    if (x > PCX - PHW - 5 && x < PCX + PHW + 5 && z > PCZ - PHD - 5 && z < PCZ + PHD + 5) continue; // pond
    tree(x, z, rr(0.8, 1.35)); placed++;
  }
  // hydrangea bushes against house walls + square edges
  const hydraSpots = [
    [-8.4, 44], [-8.6, -3], [-8.4, -16], [7.4, 30], [8.0, -3], [7.4, -18],
    [-3, 18], [-3.4, 30], [SQX - 10.4, 22], [SQX + 5, 33], [6, 6], [10, 44],
  ];
  for (const [hx, hz] of hydraSpots) {
    for (let k = 0; k < 4; k++) {
      const r = rr(0.5, 0.9);
      inst(hydraInst, hx + rr(-1, 1), r * 0.6, hz + rr(-1.4, 1.4), r, r * rr(0.7, 0.9), r, rr(0, Math.PI), 0, 0, hydraPick());
    }
  }
  // dry grass tufts across the green
  for (let i = 0; i < 700; i++) {
    const z = rr(-48, 84), x = rr(-44, 44);
    if (Math.abs(x) < 8 && z > -46 && z < 50) continue;
    if (x > PCX - PHW && x < PCX + PHW && z > PCZ - PHD && z < PCZ + PHD) continue;
    const hgt = rr(0.2, 0.4), w = rr(0.06, 0.11);
    inst(grassInst, x, hgt * 0.5, z, w, hgt, w, rr(0, Math.PI), 0, 0, rr(0, 1) < 0.5 ? 0x6f7c46 : 0x5e6b3a);
  }

  // hero weeping willows by the pond (individually modelled, sway)
  const heroTrees = [];
  function heroWillow(x, z, scale) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const th = 3.4 * scale;
    const trunk = new THREE.Mesh(trunkGeo, M.woodDk);
    trunk.scale.set(1.4, th, 1.4); trunk.position.y = th * 0.5;
    trunk.castShadow = true; trunk.receiveShadow = true; trunk.userData.surface = 'wood';
    g.add(trunk); raycastMeshes.push(trunk);
    const canopy = new THREE.Group(); canopy.position.y = th * 0.9;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const drape = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 5), M.willow);
      drape.scale.set(1.6 * scale, 3.2 * scale, 1.6 * scale);
      drape.position.set(Math.cos(a) * 1.6 * scale, -0.6 * scale, Math.sin(a) * 1.6 * scale);
      drape.userData.surface = 'dirt'; drape.castShadow = true;
      canopy.add(drape); raycastMeshes.push(drape);
    }
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2 * scale, 0), M.willow);
    crown.position.y = 0.4; crown.userData.surface = 'dirt'; crown.castShadow = true;
    canopy.add(crown); raycastMeshes.push(crown);
    g.add(canopy); root.add(g);
    heroTrees.push({ canopy, ph: rand() * 6.28, amp: rr(0.02, 0.05), f: rr(0.5, 0.9) });
    boxCollider(x, 1.2, z, 0.4, 1.2, 0.4);
  }
  heroWillow(PCX - PHW - 1.5, PCZ - 5, 1.15);
  heroWillow(PCX + PHW + 1.0, PCZ + 4, 1.05);
  heroWillow(PCX - 15, PCZ - PHD - 2.6, 1.1);

  // =============================================================== ducks
  const ducks = [];
  const duckBodyMat = new THREE.MeshStandardMaterial({ color: 0x8a8073, roughness: 1 });
  const duckHeadMat = new THREE.MeshStandardMaterial({ color: 0x2f4a35, roughness: 0.9 });
  function makeDuck(cx, cz, r, ph) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), duckBodyMat);
    body.scale.set(1.4, 0.8, 1); body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), duckHeadMat);
    head.position.set(0.24, 0.16, 0); head.castShadow = true; g.add(head);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 6), duckBodyMat);
    tail.rotation.z = HPI; tail.position.set(-0.28, 0.06, 0); g.add(tail);
    g.position.set(cx, 0.18, cz);
    root.add(g);
    ducks.push({ g, cx, cz, r, ph, sp: rr(0.15, 0.3) * (rand() < 0.5 ? 1 : -1) });
  }
  makeDuck(PCX - 5, PCZ + 2, 3.0, 0);
  makeDuck(PCX + 4, PCZ - 3, 2.2, 2.1);
  makeDuck(PCX + 8, PCZ + 5, 2.6, 4.0);

  // =============================================================== chimney smoke
  function makeSmokeTex() {
    const c = document.createElement('canvas'); c.width = 96; c.height = 160;
    const g = c.getContext('2d'); g.clearRect(0, 0, 96, 160);
    for (let i = 0; i < 40; i++) {
      const t = i / 40, y = 152 - t * 146, x = 48 + Math.sin(t * 6 + 1) * (2 + t * 20);
      const rad = 5 + t * 10 + t * t * 30;
      const a = 0.14 * (1 - t * 0.4) * (t < 0.06 ? t / 0.06 : 1);
      const grd = g.createRadialGradient(x, y, 1, x, y, rad);
      grd.addColorStop(0, `rgba(210,212,214,${a})`); grd.addColorStop(1, 'rgba(210,212,214,0)');
      g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    return new THREE.CanvasTexture(c);
  }
  const smokeTex = makeSmokeTex();
  const smokeSprites = [];
  for (let i = 0; i < Math.min(4, chimneySmoke.length); i++) {
    const p = chimneySmoke[i * 2 % chimneySmoke.length];
    const sm = new THREE.MeshBasicMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.7, fog: true });
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 7.5), sm);
    sp.position.set(p.x, p.y + 3, p.z);
    root.add(sp); smokeSprites.push({ sp, base: p.clone() });
  }

  // =============================================================== backdrop
  // low hazy bocage hills + treeline ring so the horizon isn't empty and the
  // town reads as sat in a wooded Breton basin. Unreachable, merged, no colliders.
  {
    const geos = [];
    const ring = (count, r0, r1, h0, h1, wide, sink) => {
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + rr(-0.14, 0.14);
        const r = rr(r0, r1);
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        const w = rr(wide * 0.9, wide * 1.5), h = rr(h0, h1);
        const g = new THREE.ConeGeometry(w * 0.5, h, 5); g.scale(1, 1, 0.5); g.rotateY(rr(0, Math.PI)); g.translate(x, h * 0.5 - sink, z);
        geos.push(g);
      }
    };
    ring(40, 150, 190, 14, 26, 120, 10);
    const hills = new THREE.Mesh(mergeGeometries(geos, false), M.backdrop);
    hills.castShadow = false; hills.receiveShadow = false; hills.frustumCulled = false;
    root.add(hills);
    // nearer treeline band (green, softer)
    const tgeos = [];
    for (let i = 0; i < 70; i++) {
      const ang = (i / 70) * Math.PI * 2 + rr(-0.1, 0.1);
      const r = rr(95, 130);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const h = rr(8, 16);
      const g = new THREE.ConeGeometry(rr(4, 8), h, 5); g.translate(x, h * 0.5 - 2, z);
      tgeos.push(g);
    }
    const tline = new THREE.Mesh(mergeGeometries(tgeos, false), M.treeline);
    tline.castShadow = false; tline.receiveShadow = false; tline.frustumCulled = false;
    root.add(tline);
  }

  // =============================================================== map bounds
  invisibleWall(0, 86, 60, 2);
  invisibleWall(0, -90, 60, 2);
  invisibleWall(46, -4, 2, 96);
  invisibleWall(-46, -4, 2, 96);

  // =============================================================== finalize
  finalizeBakes();
  for (const im of [boulderInst, rubbleInst, cobbleWinInst, shutterInst, sillInst,
                    chimneyInst, stubInst, trunkInst, canopyInst, hydraInst, hedgeInst,
                    reedInst, grassInst]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.frustumCulled = true;
  }

  // =============================================================== spawns / cover
  enemySpawns.push(
    // main street + town core (all y=0, on walkable ground)
    V3(0, 0, -32), V3(-5, 0, -22), V3(5, 0, -12), V3(-4, 0, -4), V3(6, 0, 4),
    V3(-6, 0, 12), V3(4, 0, 22), V3(-3, 0, 40), V3(9, 0, -14), V3(-9, 0, 30),
    // the Place
    V3(SQX - 2, 0, SQZ + 3), V3(SQX + 6, 0, SQZ - 4),
    // spur / enclosure bailey
    V3(-2, 0, -58), V3(8, 0, -62), V3(-12, 0, -60), V3(14, 0, -70), V3(-16, 0, -70),
    // near the pond
    V3(14, 0, 48), V3(-14, 0, 46),
  );
  coverPoints.push(
    // street house corners
    V3(-7.5, 0, 40), V3(-8, 0, -8), V3(-8, 0, -20), V3(7.5, 0, 26), V3(7.5, 0, -6),
    V3(7.5, 0, -22), V3(-8, 0, -34), V3(7.5, 0, -35), V3(3, 0, 0), V3(-3, 0, -14),
    // square / church approach
    V3(SQX + 9, 0, SQZ - 8), V3(SQX - 9, 0, SQZ + 8), V3(4, 0, 14), V3(9, 0, 16),
    // spur bailey firing lines
    V3(-6, 0, -54), V3(6, 0, -54), V3(-18, 0, -62), V3(18, 0, -62), V3(0, 0, -74),
    V3(10, 0, -50), V3(-10, 0, -50),
  );

  // =============================================================== walk paths
  const WP = (pts) => pts.map((p) => V3(p[0], 0, p[1]));
  const walkPaths = [
    // grande rue loop (down west verge, back up east verge)
    WP([[-6, 46], [-6, 34], [-6, 18], [-6, 2], [-6, -14], [-6, -30],
        [6, -30], [6, -14], [6, 2], [6, 18], [6, 34], [6, 46]]),
    // pond promenade (round the land side)
    WP([[PCX - 10, PCZ - PHD - 2], [PCX + 10, PCZ - PHD - 2], [PCX + PHW + 2, PCZ - 6],
        [PCX + PHW + 2, PCZ + 6], [PCX + 6, PCZ + PHD + 2], [PCX - 6, PCZ + PHD + 2],
        [PCX - PHW - 2, PCZ + 6], [PCX - PHW - 2, PCZ - 6]]),
    // the Place circuit
    WP([[SQX - 8, SQZ - 7], [SQX + 8, SQZ - 7], [SQX + 8, SQZ + 7], [SQX - 8, SQZ + 7]]),
  ];

  // nudge every spawn/cover/walk point OUT of solid prop colliders (houses,
  // ruins, keep, halles posts...) so nobody navigates inside geometry.
  const solidC = colliders.filter((b) => b.max.y > 0.4 && b.min.y < 2.2 &&
    (b.max.x - b.min.x) < 60 && (b.max.z - b.min.z) < 60);
  function nudgeOut(p, margin) {
    for (let it = 0; it < 6; it++) {
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
    return p;
  }
  enemySpawns.forEach((p) => { if (p.y < 0.5) nudgeOut(p, 0.6); });
  coverPoints.forEach((p) => { if (p.y < 0.5) nudgeOut(p, 0.4); });
  walkPaths.forEach((path) => path.forEach((p) => nudgeOut(p, 0.4)));

  // =============================================================== api
  const playerSpawn = V3(2, 0, 50); // north of the pond, on the square/promenade
  const api = {
    colliders,
    raycastMeshes,
    enemySpawns,
    coverPoints,
    walkPaths,
    sunDir,
    playerSpawn,
    playerSpawnYaw: 0, // yaw 0 faces -Z — spawn looks toward the church + broken keep
    bins: [],          // no squishy cover here; keeps the weapon squish wire safe
    squishAt() {},
    update(dt, playerPos) {
      time += dt;
      if (playerPos) {
        recenterSun(playerPos);
        _lastP.copy(playerPos);
        sky.position.set(playerPos.x, 0, playerPos.z); // sky follows camera (far-plane clip)
      }
      waterMat.uniforms.uTime.value = time;
      // pennon wave
      {
        const pos = pennon.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const bx = _pennonBase[i * 3], by = _pennonBase[i * 3 + 1];
          const k = (bx + 1.1) / 2.2; // 0 at pole → 1 at fly end
          pos.setZ(i, Math.sin(time * 4 + k * 6) * 0.35 * k);
          pos.setY(i, by + Math.sin(time * 3.4 + k * 5) * 0.08 * k);
        }
        pos.needsUpdate = true;
      }
      // hero willow sway
      for (let i = 0; i < heroTrees.length; i++) {
        const h = heroTrees[i];
        h.canopy.rotation.z = h.amp * Math.sin(time * h.f + h.ph);
        h.canopy.rotation.x = h.amp * 0.7 * Math.cos(time * h.f * 0.8 + h.ph);
      }
      // ducks paddle in slow arcs + bob
      for (let i = 0; i < ducks.length; i++) {
        const d = ducks[i];
        const a = d.ph + time * d.sp;
        d.g.position.x = d.cx + Math.cos(a) * d.r;
        d.g.position.z = d.cz + Math.sin(a) * d.r;
        d.g.position.y = 0.18 + Math.sin(time * 1.6 + d.ph) * 0.03;
        d.g.rotation.y = -a + (d.sp > 0 ? -HPI : HPI);
      }
      // chimney smoke: y-billboard + drift
      for (let i = 0; i < smokeSprites.length; i++) {
        const s = smokeSprites[i];
        s.sp.lookAt(_lastP.x, s.sp.position.y, _lastP.z);
        s.sp.rotation.z = Math.sin(time * 0.13 + i * 2.3) * 0.05;
        s.sp.material.map.offset.x = Math.sin(time * 0.05 + i) * 0.02;
      }
      // lit windows flicker faintly
      for (let i = 0; i < litWindows.length; i++) {
        litWindows[i].material.emissiveIntensity = 0.72 + Math.sin(time * 1.7 + i) * 0.08;
      }
      for (let i = 0; i < updaters.length; i++) updaters[i](dt, _lastP.x, _lastP.z);
    },
  };
  if (typeof window !== 'undefined' && window.__SHOT_MODE__) window.__world = api; // probe hook
  return api;
}
