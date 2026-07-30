// ============================================================================
// ASHFALL — vehicles/cars.js
// Drivable vehicles parked along the main street: three procedural sedans
// (weathered paint, dark glass, wheels/mirrors/bumpers), two rideable naked
// motorcycles (frame tubes, tapered tank, forks/handlebar, twin exhaust,
// kickstand lean when parked, visual lean into turns, dark rider mannequin
// shown only while riding) — plus an exotic fleet: a glossy rosso wedge
// supercar ('super'), a silver rounded-fastback sports coupe ('coupe'), an
// open-wheel single-seater with wings/halo/exposed slicks ('formula', driver
// helmet visible only while driving, Space brakes instead of sliding), a
// knobby-tired motocross bike ('cross', bouncy pitch), a full-fairing
// superbike ('race', deeper lean, tucked rider), and a 6x6 military
// missile-launcher war truck ('truck'): armored cab, bed-mounted turreted
// rack of 4 finned rockets — LMB while driving lobs one on a gravity-lite
// arc toward the camera aim (~70m), tracer/flash trail, explosion + area
// missileStrike on impact, 1.6s cooldown, 4-round rack with staged 6s
// reload. Arcade driving model with drift + handbrake, per-kind
// physics/params table, chase camera with boom-clamp vs colliders (closer
// for bikes, low for the formula, high/far for the truck), enter/exit
// prompt (DRIVE/RIDE), managed world-space colliders (mutated in place as
// vehicles move), runover vs enemy capsules, per-kind engine rpm mapping
// (super/formula revvier), horn/crash/skid audio.
// Contract: createCars({ scene, world, input, player, hud, audio, camera,
//   fx, getEnemyVolumes, runover, missileStrike })
//   -> { update(dt), driving, stageDrive(kind?) }
// ============================================================================
import * as THREE from 'three';

const TOP = 21;            // m/s forward (sedan)
const TOP_R = 7;           // m/s reverse
const ACCEL = 9;
const BRAKE = 14;
const REV_ACCEL = 6;
const WHEELBASE = 2.76;
const MAX_STEER = 0.6;
const HX = 0.93, HZ = 2.21;   // sedan oriented footprint half extents
const COL_H = 1.42;           // sedan collider height
const BODY_PIV = 0.58;        // sedan body roll/pitch pivot height

const M_TOP = 26;             // m/s forward (moto)
const M_ACCEL = 11;
const M_HX = 0.35, M_HZ = 1.05; // moto footprint half extents (narrow)
const BIKE_PIV = 0.5;         // moto body pitch pivot height
const PARK_LEAN = 0.21;       // ~12° kickstand lean when parked
const MAX_LEAN = 0.49;        // ~28° cap for the riding lean

export function createCars({ scene, world, input, player, hud, audio, camera, getEnemyVolumes, runover, fx, missileStrike }) {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ------------------------------------------------------------- paint tex
  // weathered-but-intact paint: tonal blotches, dust speckle, rain streaks,
  // road grime creeping up from the rocker line. Deterministic per seed.
  // grime (0..1, default 1) scales the weathering — the exotics stay cleaner.
  function makePaintTex(hex, seed, grime = 1) {
    let s = seed;
    const pr = (a, b) => { s = (s * 16807) % 2147483647; return a + ((s - 1) / 2147483646) * (b - a); };
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#' + new THREE.Color(hex).getHexString();
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 26; i++) { // sun-bleach / faded repaint blotches
      const x = pr(0, 256), y = pr(0, 256), r = pr(18, 70);
      const light = pr(0, 1) > 0.5;
      const grd = g.createRadialGradient(x, y, 2, x, y, r);
      grd.addColorStop(0, light ? `rgba(245,242,232,${0.04 * grime})` : `rgba(12,12,10,${0.085 * grime})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 340; i++) { // dust speckle
      g.fillStyle = `rgba(${150 + (pr(0, 36) | 0)},${144 + (pr(0, 28) | 0)},${126 + (pr(0, 24) | 0)},${(pr(0.02, 0.07) * grime).toFixed(3)})`;
      g.fillRect(pr(0, 256), pr(0, 256), pr(0.5, 2.2), pr(0.5, 1.6));
    }
    for (let i = 0; i < 26; i++) { // faint vertical rain streaks
      const x = pr(0, 256), h = pr(30, 130), y = pr(0, 200);
      const lg = g.createLinearGradient(0, y, 0, y + h);
      lg.addColorStop(0, 'rgba(20,18,14,0)');
      lg.addColorStop(0.5, `rgba(20,18,14,${(pr(0.03, 0.08) * grime).toFixed(3)})`);
      lg.addColorStop(1, 'rgba(20,18,14,0)');
      g.fillStyle = lg; g.fillRect(x, y, pr(1, 2.6), h);
    }
    const grd = g.createLinearGradient(0, 150, 0, 256); // bottom grime (v=0)
    grd.addColorStop(0, 'rgba(28,24,18,0)');
    grd.addColorStop(1, `rgba(28,24,18,${0.5 * grime})`);
    g.fillStyle = grd; g.fillRect(0, 150, 256, 106);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    // roughness: worn clear-coat patchiness, rougher toward the grime line
    const rc = document.createElement('canvas'); rc.width = rc.height = 128;
    const rg = rc.getContext('2d');
    rg.fillStyle = 'rgb(174,174,174)'; rg.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 40; i++) {
      const v = (pr(0, 1) > 0.5 ? 190 : 116) | 0;
      const x = pr(0, 128), y = pr(0, 128), r = pr(6, 30);
      const rgrd = rg.createRadialGradient(x, y, 1, x, y, r);
      rgrd.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
      rgrd.addColorStop(1, `rgba(${v},${v},${v},0)`);
      rg.fillStyle = rgrd; rg.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const rg2 = rg.createLinearGradient(0, 80, 0, 128);
    rg2.addColorStop(0, 'rgba(205,205,205,0)');
    rg2.addColorStop(1, 'rgba(205,205,205,0.75)');
    rg.fillStyle = rg2; rg.fillRect(0, 80, 128, 48);
    return { map, rough: new THREE.CanvasTexture(rc) };
  }

  // ------------------------------------------------------------- materials
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1d1e1f, roughness: 0.92 });
  const seamM = new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.95 });
  const glassM = new THREE.MeshStandardMaterial({
    color: 0x141d28, roughness: 0.25, metalness: 0.55,
    emissive: 0x081018, emissiveIntensity: 0.4,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0x9aa0a3, roughness: 0.38, metalness: 0.85 });
  const lightM = new THREE.MeshStandardMaterial({ color: 0xc7cdc9, roughness: 0.28, metalness: 0.3 });
  const tailM = new THREE.MeshStandardMaterial({ color: 0x571913, roughness: 0.45 });
  const tireM = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.96 });
  const hubM = new THREE.MeshStandardMaterial({ color: 0x6a6e72, roughness: 0.45, metalness: 0.6 });
  const capM = new THREE.MeshStandardMaterial({ color: 0x2a2b2c, roughness: 0.7, metalness: 0.4 });
  // moto extras
  const frameM = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.55, metalness: 0.6 });
  const engineM = new THREE.MeshStandardMaterial({ color: 0x3d4045, roughness: 0.5, metalness: 0.75 });
  const seatM = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.93 });
  const riderM = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.94 });   // matte near-black
  const helmetM = new THREE.MeshStandardMaterial({ color: 0x0d0e11, roughness: 0.35, metalness: 0.25 });
  // exotic-fleet extras
  const carbonM = new THREE.MeshStandardMaterial({ color: 0x25272b, roughness: 0.85 });  // matte dark composite
  const slickM = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.55 });   // slick-look racing tire
  const knobM = new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.98, flatShading: true }); // knobby MX tire
  const tailRoundM = new THREE.MeshStandardMaterial({
    color: 0x8a1e12, roughness: 0.35, emissive: 0x3a0704, emissiveIntensity: 0.9,
  });
  const rimM = new THREE.MeshStandardMaterial({ color: 0x878c91, roughness: 0.35, metalness: 0.75 }); // silver alloys
  // missile-truck extras
  const mslBodyM = new THREE.MeshStandardMaterial({ color: 0x4f5540, roughness: 0.58, metalness: 0.3 });   // olive rocket
  const mslBandM = new THREE.MeshStandardMaterial({ color: 0x93251a, roughness: 0.5 });                    // red nose band
  const mslFinM = new THREE.MeshStandardMaterial({ color: 0x363b2c, roughness: 0.62, metalness: 0.35 });
  const mslBodyGeo = new THREE.CylinderGeometry(0.105, 0.105, 2.2, 10); mslBodyGeo.rotateX(Math.PI / 2);   // axis z
  const mslConeGeo = new THREE.ConeGeometry(0.107, 0.4, 10); mslConeGeo.rotateX(-Math.PI / 2);             // apex -Z
  const mslBandGeo = new THREE.CylinderGeometry(0.112, 0.112, 0.16, 10); mslBandGeo.rotateX(Math.PI / 2);
  const mslFinGeoV = new THREE.BoxGeometry(0.022, 0.52, 0.34);
  const mslFinGeoH = new THREE.BoxGeometry(0.52, 0.022, 0.34);
  const tTireGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.4, 16); tTireGeo.rotateZ(Math.PI / 2);         // chunky AT tire
  const tRimGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.41, 12); tRimGeo.rotateZ(Math.PI / 2);
  const tCapGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.43, 8); tCapGeo.rotateZ(Math.PI / 2);

  const tireGeo = new THREE.CylinderGeometry(0.335, 0.335, 0.235, 18); tireGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.165, 0.165, 0.245, 12); hubGeo.rotateZ(Math.PI / 2);
  const capGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.255, 8); capGeo.rotateZ(Math.PI / 2);
  // moto shared geometry
  const mTireF = new THREE.CylinderGeometry(0.315, 0.315, 0.095, 16); mTireF.rotateZ(Math.PI / 2);
  const mTireR = new THREE.CylinderGeometry(0.315, 0.315, 0.125, 16); mTireR.rotateZ(Math.PI / 2);
  const mHub = new THREE.CylinderGeometry(0.1, 0.1, 0.1, 10); mHub.rotateZ(Math.PI / 2);
  const mDisc = new THREE.CylinderGeometry(0.14, 0.14, 0.018, 14); mDisc.rotateZ(Math.PI / 2);
  const tankGeo = new THREE.CylinderGeometry(0.11, 0.16, 0.52, 10); tankGeo.rotateX(Math.PI / 2); // tapers to the seat
  const lampGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.09, 12); lampGeo.rotateX(Math.PI / 2);
  const helmGeo = new THREE.SphereGeometry(0.125, 12, 10);
  const UPV = new THREE.Vector3(0, 1, 0);

  const root = new THREE.Group();
  root.name = 'cars';
  scene.add(root);

  // ------------------------------------------------------------- car build
  // local space: nose at -Z (matches player yaw convention: yaw 0 faces -Z)
  function buildCar(hex, seed) {
    const tex = makePaintTex(hex, seed);
    const paint = new THREE.MeshStandardMaterial({
      map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0.16,
    });
    const paintLow = new THREE.MeshStandardMaterial({
      map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0.18, color: 0x8f8d88,
    });

    const group = new THREE.Group();
    const bodyG = new THREE.Group();
    bodyG.position.y = BODY_PIV;
    group.add(bodyG);
    const rayParts = [];

    function part(mat, w, h, d, x, y, z, rx = 0, o = {}) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y - BODY_PIV, z);
      if (rx) m.rotation.x = rx;
      m.castShadow = o.cast ?? true;
      m.receiveShadow = true;
      m.userData.surface = 'metal';
      bodyG.add(m);
      if (o.ray) rayParts.push(m);
      return m;
    }

    // hull
    part(paintLow, 1.84, 0.32, 4.44, 0, 0.36, 0, 0, { ray: true });      // rocker band
    part(paint, 1.82, 0.5, 4.42, 0, 0.72, 0, 0, { ray: true });          // main body
    part(plastic, 1.6, 0.14, 3.6, 0, 0.22, 0, 0, { cast: false });       // underbody
    part(paint, 1.72, 0.09, 1.58, 0, 0.975, -1.34, -0.045, { ray: true }); // hood
    part(plastic, 1.58, 0.045, 0.18, 0, 0.985, -0.5, 0, { cast: false }); // cowl strip
    part(paint, 1.72, 0.09, 1.04, 0, 0.985, 1.64, 0.035, { ray: true }); // trunk
    // greenhouse
    part(glassM, 1.5, 0.62, 0.07, 0, 1.19, -0.58, 0.62, { cast: false });   // windshield
    part(paint, 1.5, 0.07, 1.45, 0, 1.465, 0.32, 0, { ray: true });         // roof
    part(glassM, 1.48, 0.56, 0.07, 0, 1.2, 1.3, -0.55, { cast: false });    // rear glass
    part(glassM, 1.56, 0.36, 1.72, 0, 1.185, 0.34, 0, { cast: false });     // side band
    part(plastic, 1.58, 0.42, 0.07, 0, 1.17, 0.36);                          // B pillars
    for (const s of [-1, 1]) {
      part(plastic, 0.07, 0.62, 0.09, s * 0.72, 1.19, -0.58, 0.62);          // A pillar
      part(plastic, 0.07, 0.56, 0.09, s * 0.70, 1.2, 1.3, -0.55);            // C pillar
    }
    // bumpers, lights, grille
    part(plastic, 1.88, 0.22, 0.26, 0, 0.46, -2.2, 0, { ray: true });
    part(plastic, 1.88, 0.22, 0.26, 0, 0.46, 2.2, 0, { ray: true });
    part(plastic, 1.02, 0.16, 0.06, 0, 0.78, -2.235);
    for (const s of [-1, 1]) {
      part(lightM, 0.36, 0.13, 0.05, s * 0.62, 0.8, -2.225, 0, { cast: false });
      part(tailM, 0.36, 0.11, 0.05, s * 0.62, 0.8, 2.225, 0, { cast: false });
      // mirrors
      part(plastic, 0.14, 0.035, 0.05, s * 0.97, 1.03, -0.48);
      part(plastic, 0.05, 0.11, 0.16, s * 1.05, 1.03, -0.47);
      // door seams + handles
      for (const z of [-0.55, 0.38, 1.25]) part(seamM, 0.02, 0.44, 0.028, s * 0.912, 0.72, z, 0, { cast: false });
      for (const z of [0.02, 0.95]) part(chrome, 0.022, 0.04, 0.17, s * 0.915, 0.88, z, 0, { cast: false });
    }
    // wheels: pivot (steer) -> spin -> tire/hub/cap
    function wheel(x, z) {
      const piv = new THREE.Group();
      piv.position.set(x, 0.335, z);
      const spin = new THREE.Group();
      for (const geo of [tireGeo, hubGeo, capGeo]) {
        const m = new THREE.Mesh(geo, geo === tireGeo ? tireM : geo === hubGeo ? hubM : capM);
        m.castShadow = true; m.receiveShadow = true;
        spin.add(m);
      }
      piv.add(spin);
      group.add(piv);
      return { piv, spin };
    }
    // track slightly proud of the body (like the hulks) so tires stay visible
    const wheels = [wheel(-0.85, -1.38), wheel(0.85, -1.38), wheel(-0.85, 1.38), wheel(0.85, 1.38)];

    for (const m of rayParts) world.raycastMeshes.push(m);
    root.add(group);
    return { group, bodyG, wheels };
  }

  // ------------------------------------------------------------- bike build
  // standard/naked bike ~2.1m, nose at -Z. Hierarchy: group (pos+yaw) ->
  // leanG (roll: kickstand park lean / riding lean) -> bodyG (pitch pivot)
  // -> fr (ground-space authoring) with steerG (forks/bar/front wheel) and
  // riderG (mannequin, visible only while riding); rear wheel under leanG.
  function buildBike(hex, seed) {
    const tex = makePaintTex(hex, seed);
    const paint = new THREE.MeshStandardMaterial({
      map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0.3,
    });

    const group = new THREE.Group();
    const leanG = new THREE.Group();
    group.add(leanG);
    const bodyG = new THREE.Group();
    bodyG.position.y = BIKE_PIV;
    leanG.add(bodyG);
    const fr = new THREE.Group();
    fr.position.y = -BIKE_PIV;
    bodyG.add(fr);
    const rayParts = [];

    function box(parent, mat, w, h, d, x, y, z, rx = 0, ray = false) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx;
      m.castShadow = true; m.receiveShadow = true;
      m.userData.surface = 'metal';
      parent.add(m);
      if (ray) rayParts.push(m);
      return m;
    }
    const _ta = new THREE.Vector3(), _tb = new THREE.Vector3();
    function tube(parent, mat, a, b, r, ray = false) {
      _ta.set(a[0], a[1], a[2]); _tb.set(b[0], b[1], b[2]);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, _ta.distanceTo(_tb), 8), mat);
      m.position.copy(_ta).lerp(_tb, 0.5);
      m.quaternion.setFromUnitVectors(UPV, _tb.sub(_ta).normalize());
      m.castShadow = true; m.receiveShadow = true;
      m.userData.surface = 'metal';
      parent.add(m);
      if (ray) rayParts.push(m);
      return m;
    }

    // frame tubes
    tube(fr, frameM, [0, 0.97, -0.4], [0, 0.8, 0.22], 0.026, true);       // backbone
    tube(fr, frameM, [0, 0.91, -0.43], [0, 0.48, -0.2], 0.023);           // downtube
    for (const s of [-1, 1]) {
      tube(fr, frameM, [s * 0.05, 0.79, 0.14], [s * 0.05, 0.69, 0.62], 0.017);   // seat rail
      tube(fr, frameM, [s * 0.06, 0.44, 0.26], [s * 0.06, 0.315, 0.7], 0.023);   // swingarm
      tube(fr, chrome, [s * 0.11, 0.4, -0.06], [s * 0.135, 0.5, 0.62], 0.042);   // exhaust pipe
      tube(fr, chrome, [s * 0.135, 0.5, 0.55], [s * 0.15, 0.545, 0.88], 0.058);  // muffler
      box(fr, plastic, 0.1, 0.025, 0.07, s * 0.17, 0.44, 0.16);                  // peg
    }
    // engine block + head
    box(fr, engineM, 0.3, 0.28, 0.4, 0, 0.5, 0, 0, true);
    box(fr, engineM, 0.33, 0.11, 0.2, 0, 0.665, -0.1);
    // tank (tapers toward the seat)
    const tank = new THREE.Mesh(tankGeo, paint);
    tank.position.set(0, 0.88, -0.1);
    tank.scale.y = 0.85;
    tank.castShadow = true; tank.receiveShadow = true;
    tank.userData.surface = 'metal';
    fr.add(tank); rayParts.push(tank);
    // seat + kicked tail + taillight
    box(fr, seatM, 0.27, 0.06, 0.46, 0, 0.8, 0.32, 0, true);
    box(fr, paint, 0.24, 0.07, 0.2, 0, 0.845, 0.585, -0.18);
    box(fr, tailM, 0.1, 0.05, 0.03, 0, 0.72, 0.7);
    // kickstand (left side, visible only while parked)
    const stand = tube(fr, frameM, [-0.08, 0.36, 0.2], [-0.28, 0.06, 0.28], 0.016);

    // steering: triple clamp + fork tubes + handlebar + headlamp + front wheel
    const steerG = new THREE.Group();
    steerG.position.set(0, 1.0, -0.44);
    fr.add(steerG);
    box(steerG, frameM, 0.15, 0.09, 0.11, 0, 0, 0.01);
    for (const s of [-1, 1]) {
      tube(steerG, chrome, [s * 0.055, 0.02, 0.01], [s * 0.055, -0.685, -0.28], 0.021); // fork
      tube(steerG, plastic, [s * 0.2, 0.085, 0.03], [s * 0.33, 0.095, 0.045], 0.03);    // grip
    }
    tube(steerG, frameM, [-0.22, 0.085, 0.03], [0.22, 0.085, 0.03], 0.021);             // handlebar
    const lamp = new THREE.Mesh(lampGeo, lightM);
    lamp.position.set(0, -0.04, -0.12);
    lamp.castShadow = true; lamp.receiveShadow = true;
    steerG.add(lamp);
    box(steerG, plastic, 0.15, 0.15, 0.07, 0, -0.04, -0.06);                             // lamp housing

    function bikeWheel(parent, x, y, z, tGeo, disc) {
      const spin = new THREE.Group();
      spin.position.set(x, y, z);
      const geos = disc ? [tGeo, mHub, mDisc] : [tGeo, mHub];
      for (const geo of geos) {
        const m = new THREE.Mesh(geo, geo === tGeo ? tireM : geo === mHub ? hubM : chrome);
        if (geo === mDisc) m.position.x = 0.055;
        m.castShadow = true; m.receiveShadow = true;
        spin.add(m);
      }
      parent.add(spin);
      return spin;
    }
    const fSpin = bikeWheel(steerG, 0, -0.685, -0.28, mTireF, true);  // steers with forks
    const rSpin = bikeWheel(leanG, 0, 0.315, 0.7, mTireR, false);

    // rider mannequin — 12 matte near-black meshes, toggled while riding
    const riderG = new THREE.Group();
    riderG.visible = false;
    fr.add(riderG);
    box(riderG, riderM, 0.26, 0.15, 0.22, 0, 0.9, 0.32);            // hips on the seat
    box(riderG, riderM, 0.32, 0.44, 0.21, 0, 1.14, 0.2, -0.34);     // torso leaning to the bars
    const helm = new THREE.Mesh(helmGeo, helmetM);
    helm.position.set(0, 1.42, 0.06);
    helm.castShadow = true; helm.receiveShadow = true;
    riderG.add(helm);
    box(riderG, glassM, 0.15, 0.06, 0.02, 0, 1.42, -0.055);         // visor slit
    for (const s of [-1, 1]) {
      tube(riderG, riderM, [s * 0.19, 1.32, 0.16], [s * 0.24, 1.14, -0.12], 0.045);  // upper arm
      tube(riderG, riderM, [s * 0.24, 1.14, -0.12], [s * 0.28, 1.06, -0.37], 0.04);  // forearm to grip
      tube(riderG, riderM, [s * 0.11, 0.9, 0.34], [s * 0.17, 0.72, 0.02], 0.055);    // thigh
      tube(riderG, riderM, [s * 0.17, 0.72, 0.02], [s * 0.16, 0.47, 0.155], 0.046);  // shin to peg
    }

    for (const m of rayParts) world.raycastMeshes.push(m);
    root.add(group);
    return { group, bodyG, leanG, steerG, riderG, stand, fSpin, rSpin };
  }

  // --------------------------------------------------- exotic build helpers
  // generic parent-based mesh helpers for the exotic builders (the original
  // sedan/naked-bike builders keep their own closures untouched)
  const _ea = new THREE.Vector3(), _eb = new THREE.Vector3();
  function exoBox(parent, mat, w, h, d, x, y, z, o = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (o.rx) m.rotation.x = o.rx;
    if (o.ry) m.rotation.y = o.ry;
    if (o.rz) m.rotation.z = o.rz;
    m.castShadow = o.cast ?? true;
    m.receiveShadow = true;
    m.userData.surface = 'metal';
    parent.add(m);
    return m;
  }
  function exoCyl(parent, mat, r, len, x, y, z, o = {}) {
    const g = new THREE.CylinderGeometry(r, r, len, o.seg ?? 12);
    if (o.axis === 'x') g.rotateZ(Math.PI / 2);
    else if (o.axis !== 'y') g.rotateX(Math.PI / 2);  // default: axis along z
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    if (o.rx) m.rotation.x = o.rx;
    m.castShadow = o.cast ?? true;
    m.receiveShadow = true;
    m.userData.surface = 'metal';
    parent.add(m);
    return m;
  }
  function exoTube(parent, mat, a, b, r) {
    _ea.set(a[0], a[1], a[2]); _eb.set(b[0], b[1], b[2]);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, _ea.distanceTo(_eb), 8), mat);
    m.position.copy(_ea).lerp(_eb, 0.5);
    m.quaternion.setFromUnitVectors(UPV, _eb.sub(_ea).normalize());
    m.castShadow = true; m.receiveShadow = true;
    m.userData.surface = 'metal';
    parent.add(m);
    return m;
  }
  // car-style wheel (steer pivot -> spin) with visible rim + spoke bars
  function exoWheel(group, x, z, r, w, tMat, spokes = 0) {
    const piv = new THREE.Group();
    piv.position.set(x, r, z);
    const spin = new THREE.Group();
    const tg = new THREE.CylinderGeometry(r, r, w, 18); tg.rotateZ(Math.PI / 2);
    const rimR = r * 0.62;
    const hg = new THREE.CylinderGeometry(rimR, rimR, w * 0.6, 14); hg.rotateZ(Math.PI / 2);
    for (const [geo, mat] of [[tg, tMat], [hg, seamM]]) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      spin.add(m);
    }
    // full-diameter spoke bars across the dark rim well + center cap
    for (let i = 0; i < spokes; i++) {
      const sm = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, rimR * 1.92, 0.07), rimM);
      sm.rotation.x = (i / spokes) * Math.PI;
      sm.castShadow = false; sm.receiveShadow = true;
      spin.add(sm);
    }
    if (spokes) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.18, r * 0.18, w * 0.66, 10), rimM);
      cap.rotation.z = Math.PI / 2;
      cap.receiveShadow = true;
      spin.add(cap);
    }
    piv.add(spin);
    group.add(piv);
    return { piv, spin };
  }
  // bike-style wheel: bare spin group at a fixed hub
  function exoBikeWheel(parent, x, y, z, tGeo, tMat, disc) {
    const spin = new THREE.Group();
    spin.position.set(x, y, z);
    const parts = disc ? [[tGeo, tMat], [mHub, hubM], [mDisc, chrome]] : [[tGeo, tMat], [mHub, hubM]];
    for (const [geo, mat] of parts) {
      const m = new THREE.Mesh(geo, mat);
      if (geo === mDisc) m.position.x = 0.055;
      m.castShadow = true; m.receiveShadow = true;
      spin.add(m);
    }
    parent.add(spin);
    return spin;
  }

  // ------------------------------------------------------------- super build
  // Italian-style supercar: low wide wedge (~1.1m tall), pointed nose between
  // proud fender blades, carved side intakes, fastback engine cover with
  // louvres, quad round taillights, splitter + discreet wing, glossy
  // clearcoat rosso paint, wide rear tires. Nose at -Z.
  function buildSuper(hex, seed) {
    const tex = makePaintTex(hex, seed, 0.35);
    const paint = new THREE.MeshPhysicalMaterial({
      map: tex.map, roughnessMap: tex.rough, roughness: 0.5, metalness: 0.28,
      clearcoat: 0.55, clearcoatRoughness: 0.28,
    });
    const group = new THREE.Group();
    const bodyG = new THREE.Group(); bodyG.position.y = 0.42; group.add(bodyG);
    const hull = new THREE.Group(); hull.position.y = -0.42; bodyG.add(hull);
    const ray = [];
    const B = (mat, w, h, d, x, y, z, o) => exoBox(hull, mat, w, h, d, x, y, z, o);

    B(plastic, 1.66, 0.1, 3.8, 0, 0.15, 0.1, { cast: false });          // underbody
    B(seamM, 1.84, 0.1, 3.3, 0, 0.24, 0.3);                             // black sill band
    ray.push(B(seamM, 1.9, 0.055, 0.4, 0, 0.14, -2.2));                 // front splitter
    ray.push(B(paint, 1.88, 0.32, 3.3, 0, 0.42, 0.35));                 // main tub
    // pointed nose: three plan-tapered slabs stepping down toward the tip
    ray.push(B(paint, 1.72, 0.26, 0.62, 0, 0.4, -1.42));
    ray.push(B(paint, 1.34, 0.22, 0.52, 0, 0.365, -1.93, { rx: -0.06 }));
    ray.push(B(paint, 0.88, 0.17, 0.44, 0, 0.315, -2.28, { rx: -0.1 }));
    B(seamM, 0.6, 0.08, 0.06, 0, 0.26, -2.46);                          // tip intake slot
    ray.push(B(paint, 1.06, 0.05, 1.15, 0, 0.545, -1.32, { rx: -0.115 })); // hood center sweep
    B(paint, 1.3, 0.1, 0.5, 0, 0.62, -0.78, { rx: -0.22 });             // cowl ramp to glass
    for (const s of [-1, 1]) {
      B(paint, 0.42, 0.13, 1.3, s * 0.72, 0.6, -1.4);                   // proud fender blades
      B(lightM, 0.34, 0.045, 0.05, s * 0.47, 0.445, -2.16, { ry: -s * 0.12, cast: false }); // headlight slits
      // dark side intake carved ahead of the rear hip + NACA duct on the door
      B(seamM, 0.1, 0.24, 0.5, s * 0.88, 0.5, 0.44, { ry: s * 0.3 });
      B(seamM, 0.02, 0.13, 0.52, s * 0.945, 0.45, -0.2, { ry: s * 0.06 });
      // wide rear haunches over the rear wheels
      ray.push(B(paint, 0.44, 0.32, 1.6, s * 0.81, 0.56, 1.3));
      // A pillars + mirrors on stalks
      B(plastic, 0.06, 0.5, 0.08, s * 0.6, 0.9, -0.52, { rx: 0.82 });
      B(plastic, 0.03, 0.09, 0.03, s * 0.95, 0.85, -0.42);
      B(plastic, 0.16, 0.06, 0.05, s * 1.0, 0.92, -0.44);
    }
    // cabin: heavy-rake glass, low roof, fastback engine cover + louvres
    B(glassM, 1.22, 0.5, 0.06, 0, 0.9, -0.52, { rx: 0.82, cast: false });
    ray.push(B(paint, 1.18, 0.05, 0.9, 0, 1.075, 0.05));
    B(glassM, 1.3, 0.2, 1.0, 0, 0.93, 0.05, { cast: false });            // side glass band
    ray.push(B(paint, 1.3, 0.05, 1.2, 0, 0.955, 1.05, { rx: 0.2 }));     // engine cover
    for (const lz of [0.75, 0.95, 1.15, 1.35]) {                          // subtle louvres
      B(seamM, 1.0, 0.016, 0.055, 0, 1.079 - (lz - 1.05) * 0.203, lz, { rx: 0.2, cast: false });
    }
    // tail: panel, quad round lights, valance + diffuser fins, exhausts,
    // and the F40 tell — a full-width wing rising integral from the fenders
    ray.push(B(paint, 1.86, 0.34, 0.2, 0, 0.56, 2.16));
    B(plastic, 1.88, 0.16, 0.24, 0, 0.26, 2.12);
    for (const s of [-1, 1]) {
      for (const ox of [0.42, 0.68]) exoCyl(hull, tailRoundM, 0.085, 0.06, s * ox, 0.67, 2.27, { seg: 12, cast: false });
      ray.push(B(paint, 0.07, 0.3, 0.56, s * 0.855, 0.87, 1.98));        // wing side plates off the hips
      exoCyl(hull, chrome, 0.045, 0.1, s * 0.16, 0.36, 2.24, { seg: 10 });
    }
    for (const fx of [-0.5, -0.17, 0.17, 0.5]) B(seamM, 0.02, 0.14, 0.3, fx, 0.2, 2.16);
    ray.push(B(paint, 1.78, 0.07, 0.44, 0, 0.99, 2.0, { rx: -0.04 }));   // full-width wing blade

    const wheels = [
      exoWheel(group, -0.88, -1.42, 0.325, 0.26, tireM, 5),
      exoWheel(group, 0.88, -1.42, 0.325, 0.26, tireM, 5),
      exoWheel(group, -0.88, 1.42, 0.335, 0.35, tireM, 5),               // wide rears
      exoWheel(group, 0.88, 1.42, 0.335, 0.35, tireM, 5),
    ];
    for (const m of ray) world.raycastMeshes.push(m);
    root.add(group);
    return { group, bodyG, wheels };
  }

  // ------------------------------------------------------------- coupe build
  // 911-inspired GT coupe: rounded fastback silhouette (roofline arc from
  // three angled segments), round headlights on raised fenders, wide rear
  // hips, ducktail spoiler, full-width tail light bar. Nose at -Z.
  function buildCoupe(hex, seed) {
    const tex = makePaintTex(hex, seed, 0.55);
    const paint = new THREE.MeshStandardMaterial({
      map: tex.map, roughnessMap: tex.rough, roughness: 0.62, metalness: 0.4,
    });
    const group = new THREE.Group();
    const bodyG = new THREE.Group(); bodyG.position.y = 0.5; group.add(bodyG);
    const hull = new THREE.Group(); hull.position.y = -0.5; bodyG.add(hull);
    const ray = [];
    const B = (mat, w, h, d, x, y, z, o) => exoBox(hull, mat, w, h, d, x, y, z, o);

    B(plastic, 1.48, 0.12, 3.4, 0, 0.17, 0, { cast: false });            // underbody
    B(plastic, 1.7, 0.16, 3.9, 0, 0.28, 0);                              // rocker band
    ray.push(B(paint, 1.74, 0.4, 4.1, 0, 0.56, 0.05));                   // main body (low)
    ray.push(B(paint, 1.0, 0.07, 1.3, 0, 0.795, -1.38, { rx: -0.04 }));  // frunk lid dipped between fenders
    B(plastic, 1.76, 0.16, 0.2, 0, 0.4, -2.1);                           // bumpers
    B(plastic, 1.76, 0.16, 0.2, 0, 0.4, 2.1);
    for (const s of [-1, 1]) {
      // full-length raised fenders with round headlights set into their faces
      ray.push(B(paint, 0.4, 0.2, 1.5, s * 0.68, 0.86, -1.32));
      exoCyl(hull, lightM, 0.095, 0.09, s * 0.66, 0.88, -2.05, { seg: 14, cast: false });
      B(plastic, 0.06, 0.48, 0.08, s * 0.7, 1.06, -0.6, { rx: 0.66 });   // A pillars
      ray.push(B(paint, 0.38, 0.32, 1.6, s * 0.79, 0.66, 1.25));         // wide rear hips
      exoCyl(hull, chrome, 0.04, 0.09, s * 0.3, 0.26, 2.12, { seg: 10 }); // exhausts
      // mirrors + door handles + seams
      B(plastic, 0.05, 0.09, 0.13, s * 0.98, 0.94, -0.52);
      B(chrome, 0.022, 0.035, 0.16, s * 0.875, 0.8, 0.1, { cast: false });
      for (const dz of [-0.62, 0.55]) B(seamM, 0.02, 0.36, 0.026, s * 0.872, 0.62, dz, { cast: false });
    }
    // THE 911 tell: continuous round-shouldered arc — screen, crown, then
    // progressively steeper segments flowing into the fastback glass and deck
    B(glassM, 1.44, 0.48, 0.06, 0, 1.06, -0.6, { rx: 0.66, cast: false }); // raked windshield
    ray.push(B(paint, 1.34, 0.055, 0.62, 0, 1.272, -0.14, { rx: 0.04 })); // crown
    ray.push(B(paint, 1.3, 0.05, 0.5, 0, 1.235, 0.42, { rx: 0.17 }));     // arc segment 2
    ray.push(B(paint, 1.24, 0.05, 0.5, 0, 1.11, 0.89, { rx: 0.34 }));     // arc segment 3
    B(glassM, 1.2, 0.05, 0.6, 0, 0.95, 1.33, { rx: 0.5, cast: false });   // fastback glass
    B(glassM, 1.56, 0.24, 1.3, 0, 1.0, 0.05, { cast: false });            // side glass band
    B(plastic, 1.58, 0.24, 0.05, 0, 0.96, 0.56);                          // B pillar fill
    // rear deck sloping off the glass, ducktail lip, full-width light bar
    ray.push(B(paint, 1.5, 0.06, 0.85, 0, 0.85, 1.68, { rx: 0.1 }));
    ray.push(B(paint, 1.3, 0.05, 0.32, 0, 0.9, 2.02, { rx: -0.24 }));     // ducktail
    B(tailM, 1.34, 0.07, 0.04, 0, 0.72, 2.14, { cast: false });           // light bar

    const wheels = [
      exoWheel(group, -0.84, -1.33, 0.315, 0.235, tireM, 5),
      exoWheel(group, 0.84, -1.33, 0.315, 0.235, tireM, 5),
      exoWheel(group, -0.87, 1.33, 0.325, 0.28, tireM, 5),
      exoWheel(group, 0.87, 1.33, 0.325, 0.28, tireM, 5),
    ];
    for (const m of ray) world.raycastMeshes.push(m);
    root.add(group);
    return { group, bodyG, wheels };
  }

  // ----------------------------------------------------------- formula build
  // Open-wheel single-seater: raised nose + front wing, narrow monocoque,
  // dark halo hoop over an open cockpit, sidepods, airbox + tapering engine
  // spine, big rear wing, exposed slicks on wishbone tubes. Matte dark livery
  // with one accent stripe (hex). Driver helmet (riderG) only while driving.
  function buildFormula(hex, seed) {
    const accent = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55 });
    void seed;
    const group = new THREE.Group();
    const bodyG = new THREE.Group(); bodyG.position.y = 0.35; group.add(bodyG);
    const hull = new THREE.Group(); hull.position.y = -0.35; bodyG.add(hull);
    const ray = [];
    const B = (mat, w, h, d, x, y, z, o) => exoBox(hull, mat, w, h, d, x, y, z, o);

    B(seamM, 1.3, 0.035, 2.9, 0, 0.07, 0.35, { cast: false });           // floor
    // modern high thin nose dropping to a pylon on the wing + accent stripe
    ray.push(B(carbonM, 0.3, 0.14, 1.4, 0, 0.5, -1.82, { rx: -0.06 }));
    B(carbonM, 0.16, 0.24, 0.2, 0, 0.3, -2.4);                           // nose tip pylon
    B(accent, 0.31, 0.024, 1.15, 0, 0.578, -1.76, { rx: -0.06, cast: false });
    // big front wing: main plane, accent flap, endplates with accent tips
    ray.push(B(carbonM, 1.8, 0.035, 0.5, 0, 0.15, -2.32));
    B(accent, 1.66, 0.03, 0.26, 0, 0.24, -2.2, { rx: -0.3 });
    // monocoque + raised cockpit sides + dark opening
    ray.push(B(carbonM, 0.56, 0.3, 1.5, 0, 0.4, -0.5));
    B(carbonM, 0.62, 0.14, 0.9, 0, 0.6, -0.2);
    B(seatM, 0.34, 0.05, 0.62, 0, 0.62, 0.12, { cast: false });
    // halo hoop (dark): center pillar + horseshoe over the cockpit
    exoTube(hull, frameM, [0, 0.66, -0.62], [0, 0.88, -0.18], 0.028);
    exoTube(hull, frameM, [-0.19, 0.88, -0.16], [0.19, 0.88, -0.16], 0.026);
    // airbox behind the cockpit + tapering engine spine + coke-bottle rear
    ray.push(B(carbonM, 0.34, 0.3, 0.62, 0, 0.75, 0.62));
    B(seamM, 0.26, 0.15, 0.05, 0, 0.82, 0.32, { cast: false });          // intake mouth
    B(carbonM, 0.28, 0.2, 1.1, 0, 0.56, 1.35, { rx: 0.1 });
    B(carbonM, 0.4, 0.26, 1.2, 0, 0.36, 1.45);
    B(accent, 0.29, 0.02, 1.05, 0, 0.667, 1.33, { rx: 0.1, cast: false });
    // large rear wing + beam wing + rain light
    ray.push(B(carbonM, 1.03, 0.04, 0.36, 0, 0.88, 2.16, { rx: -0.14 }));
    B(accent, 1.03, 0.03, 0.2, 0, 0.97, 2.26, { rx: -0.34 });
    B(carbonM, 0.9, 0.03, 0.2, 0, 0.6, 2.3);
    B(tailM, 0.07, 0.14, 0.05, 0, 0.46, 2.42, { cast: false });
    for (const s of [-1, 1]) {
      B(carbonM, 0.03, 0.16, 0.56, s * 0.85, 0.18, -2.3);                // front endplates
      B(accent, 0.035, 0.05, 0.56, s * 0.85, 0.27, -2.3, { cast: false });
      B(carbonM, 0.03, 0.32, 0.52, s * 0.5, 0.8, 2.18);                  // rear endplates
      // sidepods with dark intake mouths + accent spines
      ray.push(B(carbonM, 0.46, 0.3, 1.35, s * 0.5, 0.4, 0.55));
      B(seamM, 0.42, 0.22, 0.06, s * 0.5, 0.44, -0.14, { cast: false });
      B(accent, 0.14, 0.022, 1.35, s * 0.56, 0.562, 0.55, { cast: false });
      // halo horseshoe sides
      exoTube(hull, frameM, [s * 0.3, 0.7, 0.32], [s * 0.19, 0.88, -0.16], 0.026);
      // suspension: wishbone tubes out to the exposed hubs
      exoTube(hull, frameM, [s * 0.26, 0.46, -1.3], [s * 0.72, 0.36, -1.52], 0.02);
      exoTube(hull, frameM, [s * 0.26, 0.2, -1.72], [s * 0.72, 0.3, -1.56], 0.02);
      exoTube(hull, frameM, [s * 0.26, 0.24, -1.42], [s * 0.72, 0.3, -1.5], 0.016);
      exoTube(hull, frameM, [s * 0.2, 0.46, 1.46], [s * 0.72, 0.37, 1.66], 0.02);
      exoTube(hull, frameM, [s * 0.2, 0.2, 1.84], [s * 0.72, 0.3, 1.7], 0.02);
    }
    // driver: helmet + shoulders in the cockpit, visible only while driving
    const riderG = new THREE.Group();
    riderG.visible = false;
    hull.add(riderG);
    const helm = new THREE.Mesh(helmGeo, helmetM);
    helm.scale.setScalar(0.92);
    helm.position.set(0, 0.74, 0.02);
    helm.castShadow = true; helm.receiveShadow = true;
    riderG.add(helm);
    exoBox(riderG, glassM, 0.14, 0.05, 0.02, 0, 0.73, -0.09, { cast: false }); // visor slit
    exoBox(riderG, accent, 0.05, 0.015, 0.2, 0, 0.845, 0.02, { cast: false }); // helmet stripe
    exoBox(riderG, riderM, 0.36, 0.1, 0.28, 0, 0.565, 0.18);                   // shoulders

    const wheels = [
      exoWheel(group, -0.8, -1.55, 0.325, 0.3, slickM),
      exoWheel(group, 0.8, -1.55, 0.325, 0.3, slickM),
      exoWheel(group, -0.8, 1.68, 0.335, 0.38, slickM),
      exoWheel(group, 0.8, 1.68, 0.335, 0.38, slickM),
    ];
    for (const m of ray) world.raycastMeshes.push(m);
    root.add(group);
    return { group, bodyG, wheels, riderG };
  }

  // ------------------------------------------------------------- cross build
  // Motocross bike: tall stance, long-travel forks with accent guards, HIGH
  // front fender at the triple clamp, knobby faceted-torus tires, radiator
  // shrouds + side number plates in accent plastic, flat narrow seat running
  // onto a kicked rear fender, high exhaust. Same hierarchy as the naked bike.
  function buildCross(hex, seed) {
    const acc = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7 });
    void seed;
    const group = new THREE.Group();
    const leanG = new THREE.Group(); group.add(leanG);
    const bodyG = new THREE.Group(); bodyG.position.y = BIKE_PIV; leanG.add(bodyG);
    const fr = new THREE.Group(); fr.position.y = -BIKE_PIV; bodyG.add(fr);
    const ray = [];
    // 450-class proportions: big-diameter THIN front knobby, beefier rear
    const knobF = new THREE.TorusGeometry(0.3, 0.055, 7, 18); knobF.rotateY(Math.PI / 2);
    const knobR = new THREE.TorusGeometry(0.26, 0.075, 7, 16); knobR.rotateY(Math.PI / 2);

    exoTube(fr, frameM, [0, 1.06, -0.34], [0, 0.86, 0.24], 0.026);       // backbone
    exoTube(fr, frameM, [0, 1.0, -0.36], [0, 0.5, -0.16], 0.024);        // downtube
    for (const s of [-1, 1]) {
      exoTube(fr, frameM, [s * 0.05, 0.86, 0.16], [s * 0.05, 0.95, 0.6], 0.016); // subframe
      exoTube(fr, frameM, [s * 0.06, 0.48, 0.2], [s * 0.06, 0.335, 0.68], 0.022); // swingarm
      exoBox(fr, plastic, 0.12, 0.025, 0.07, s * 0.18, 0.46, 0.1);       // pegs
      // radiator shrouds flaring off the tank + side number plates
      exoBox(fr, acc, 0.05, 0.22, 0.44, s * 0.15, 0.82, -0.16, { ry: -s * 0.28, rz: -s * 0.14 });
      exoBox(fr, acc, 0.025, 0.17, 0.24, s * 0.14, 0.68, 0.6, { ry: s * 0.15 });
    }
    ray.push(exoBox(fr, engineM, 0.26, 0.26, 0.34, 0, 0.52, -0.04));     // engine
    exoBox(fr, engineM, 0.15, 0.16, 0.16, 0, 0.72, -0.1);                // cylinder
    ray.push(exoBox(fr, acc, 0.22, 0.14, 0.34, 0, 0.9, -0.2));           // small tank
    ray.push(exoBox(fr, seatM, 0.17, 0.04, 0.7, 0, 0.945, 0.28, { rx: 0.05 })); // flat narrow seat
    exoBox(fr, acc, 0.16, 0.03, 0.42, 0, 0.985, 0.64, { rx: -0.18 });    // kicked rear fender
    // high exhaust: head pipe rising to a fat muffler under the tail
    exoTube(fr, chrome, [0.08, 0.6, -0.22], [0.16, 0.72, 0.3], 0.032);
    exoCyl(fr, engineM, 0.05, 0.4, 0.17, 0.8, 0.52, { rx: -0.12, seg: 10 });
    const stand = exoTube(fr, frameM, [-0.08, 0.38, 0.15], [-0.3, 0.05, 0.24], 0.016);

    // steering: tall clamp, long-travel forks + accent guards, HIGH fender,
    // wide bars, and the MX number-plate face (no headlight)
    const steerG = new THREE.Group();
    steerG.position.set(0, 1.14, -0.42);
    fr.add(steerG);
    exoBox(steerG, frameM, 0.16, 0.08, 0.12, 0, 0, 0.01);
    for (const s of [-1, 1]) {
      exoTube(steerG, chrome, [s * 0.055, 0.03, 0.01], [s * 0.055, -0.8, -0.32], 0.023);
      exoTube(steerG, acc, [s * 0.055, 0.03, 0.0], [s * 0.055, -0.44, -0.18], 0.03);
      exoTube(steerG, plastic, [s * 0.28, 0.14, 0.02], [s * 0.38, 0.13, 0.03], 0.028); // grips
      exoTube(steerG, frameM, [s * 0.125, 0.14, 0.01], [s * 0.115, 0.2, 0.0], 0.012);  // crossbar risers
    }
    exoBox(steerG, acc, 0.24, 0.03, 0.66, 0, -0.26, -0.26, { rx: 0.14 }); // high fender under the clamp
    exoTube(steerG, frameM, [-0.3, 0.14, 0.02], [0.3, 0.14, 0.02], 0.02); // wide bar
    exoTube(steerG, acc, [-0.115, 0.2, 0.0], [0.115, 0.2, 0.0], 0.016);  // crossbar pad
    exoBox(steerG, lightM, 0.2, 0.24, 0.03, 0, -0.04, -0.1, { rx: -0.08 }); // number plate

    const fSpin = exoBikeWheel(steerG, 0, -0.8, -0.32, knobF, knobM, false);
    const rSpin = exoBikeWheel(leanG, 0, 0.335, 0.68, knobR, knobM, false);

    // rider: upright MX stance, helmet with a small peak
    const riderG = new THREE.Group();
    riderG.visible = false;
    fr.add(riderG);
    exoBox(riderG, riderM, 0.26, 0.15, 0.22, 0, 1.0, 0.26);
    exoBox(riderG, riderM, 0.3, 0.42, 0.2, 0, 1.3, 0.18, { rx: -0.14 });
    const helm = new THREE.Mesh(helmGeo, helmetM);
    helm.position.set(0, 1.6, 0.1);
    helm.castShadow = true; helm.receiveShadow = true;
    riderG.add(helm);
    exoBox(riderG, glassM, 0.15, 0.06, 0.02, 0, 1.6, -0.02, { cast: false });
    exoBox(riderG, seamM, 0.18, 0.02, 0.12, 0, 1.68, 0.02, { rx: 0.15, cast: false }); // visor peak
    for (const s of [-1, 1]) {
      exoTube(riderG, riderM, [s * 0.18, 1.48, 0.14], [s * 0.26, 1.3, -0.1], 0.042);
      exoTube(riderG, riderM, [s * 0.26, 1.3, -0.1], [s * 0.3, 1.27, -0.32], 0.038);
      exoTube(riderG, riderM, [s * 0.1, 1.0, 0.28], [s * 0.17, 0.76, 0.05], 0.05);
      exoTube(riderG, riderM, [s * 0.17, 0.76, 0.05], [s * 0.17, 0.49, 0.12], 0.042);
    }

    for (const m of ray) world.raycastMeshes.push(m);
    root.add(group);
    return { group, bodyG, leanG, steerG, riderG, stand, fSpin, rSpin };
  }

  // ------------------------------------------------------------- race build
  // Full-fairing superbike: enveloping angled fairing panels + windscreen,
  // clip-on bars low on the forks, tank hump, kicked tail cowl, racing accent
  // stripe, rider mannequin TUCKED (chest on the tank, helmet behind the
  // screen). Same hierarchy as the naked bike.
  function buildRace(hex, seed) {
    const tex = makePaintTex(hex, seed, 0.5);
    const fair = new THREE.MeshStandardMaterial({
      map: tex.map, roughnessMap: tex.rough, roughness: 0.55, metalness: 0.3,
    });
    const stripe = new THREE.MeshStandardMaterial({ color: 0x9c3a2c, roughness: 0.5 });
    const group = new THREE.Group();
    const leanG = new THREE.Group(); group.add(leanG);
    const bodyG = new THREE.Group(); bodyG.position.y = BIKE_PIV; leanG.add(bodyG);
    const fr = new THREE.Group(); fr.position.y = -BIKE_PIV; bodyG.add(fr);
    const ray = [];
    const rTireF = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16); rTireF.rotateZ(Math.PI / 2);
    const rTireR = new THREE.CylinderGeometry(0.3, 0.3, 0.16, 16); rTireR.rotateZ(Math.PI / 2);

    ray.push(exoBox(fr, engineM, 0.24, 0.24, 0.4, 0, 0.52, 0.0));        // engine behind fairing
    for (const s of [-1, 1]) {
      exoTube(fr, frameM, [s * 0.06, 0.48, 0.18], [s * 0.06, 0.31, 0.66], 0.022); // swingarm
      exoBox(fr, plastic, 0.1, 0.025, 0.07, s * 0.17, 0.46, 0.18);       // rearset pegs
      // layered fairings: upper panel + lower panel tucking into the belly
      ray.push(exoBox(fr, fair, 0.06, 0.3, 0.85, s * 0.2, 0.62, -0.06, { rz: -s * 0.12, ry: s * 0.06 }));
      exoBox(fr, fair, 0.06, 0.26, 0.62, s * 0.14, 0.42, 0.02, { rz: s * 0.22 });
      exoBox(fr, stripe, 0.062, 0.07, 0.85, s * 0.205, 0.7, -0.06, { rz: -s * 0.12, ry: s * 0.06, cast: false });
      // nose cheek panels tying the nose into the flanks
      exoBox(fr, fair, 0.05, 0.26, 0.5, s * 0.155, 0.6, -0.5, { rz: -s * 0.1, rx: 0.3 });
      // twin headlight slits angled into the nose face
      exoBox(fr, lightM, 0.09, 0.035, 0.02, s * 0.07, 0.64, -0.85, { ry: -s * 0.25, cast: false });
    }
    // nose slopes as one plane down over the front wheel, screen continues it
    ray.push(exoBox(fr, fair, 0.34, 0.2, 0.72, 0, 0.72, -0.5, { rx: 0.32 }));
    exoBox(fr, fair, 0.3, 0.2, 0.45, 0, 0.58, -0.52, { rx: 0.1 });       // under-nose mass
    exoBox(fr, glassM, 0.34, 0.3, 0.04, 0, 0.98, -0.3, { rx: 0.62, cast: false }); // windscreen
    exoBox(fr, fair, 0.26, 0.14, 0.72, 0, 0.34, -0.02);                  // belly pan
    ray.push(exoBox(fr, fair, 0.3, 0.16, 0.46, 0, 0.94, -0.04, { rx: 0.08 })); // tank hump
    exoBox(fr, fair, 0.22, 0.09, 0.34, 0, 0.9, 0.3, { rx: -0.1 });       // seat/subframe wedge to the tail
    exoBox(fr, seatM, 0.2, 0.035, 0.26, 0, 0.945, 0.28);                 // seat pad
    ray.push(exoBox(fr, fair, 0.24, 0.12, 0.5, 0, 0.93, 0.57, { rx: -0.26 })); // tail UP over the wheel
    exoBox(fr, stripe, 0.242, 0.04, 0.5, 0, 0.975, 0.57, { rx: -0.26, cast: false });
    exoBox(fr, tailM, 0.08, 0.04, 0.03, 0, 0.88, 0.79);                  // taillight
    // underseat exhaust can rising into the tail void
    exoTube(fr, chrome, [0.08, 0.5, 0.15], [0.11, 0.68, 0.45], 0.028);
    exoCyl(fr, engineM, 0.052, 0.36, 0.11, 0.75, 0.6, { rx: -0.32, seg: 10 });
    const stand = exoTube(fr, frameM, [-0.08, 0.36, 0.18], [-0.28, 0.05, 0.26], 0.016);

    // steering: forks + clip-on bars LOW below the top clamp, hugging fender
    const steerG = new THREE.Group();
    steerG.position.set(0, 0.99, -0.44);
    fr.add(steerG);
    exoBox(steerG, frameM, 0.14, 0.07, 0.1, 0, 0, 0.01);
    for (const s of [-1, 1]) {
      exoTube(steerG, chrome, [s * 0.05, 0.02, 0.01], [s * 0.05, -0.66, -0.27], 0.021);
      exoTube(steerG, frameM, [s * 0.05, -0.3, -0.125], [s * 0.05, -0.67, -0.275], 0.033); // fork lowers
      exoTube(steerG, plastic, [s * 0.07, -0.04, 0.03], [s * 0.24, -0.08, 0.07], 0.026); // clip-ons
    }
    exoBox(steerG, fair, 0.2, 0.035, 0.52, 0, -0.44, -0.2, { rx: 0.14 }); // low front fender

    const fSpin = exoBikeWheel(steerG, 0, -0.68, -0.28, rTireF, slickM, true);
    const rSpin = exoBikeWheel(leanG, 0, 0.31, 0.66, rTireR, slickM, false);

    // rider: TUCKED — chest over the tank, helmet down behind the screen
    const riderG = new THREE.Group();
    riderG.visible = false;
    fr.add(riderG);
    exoBox(riderG, riderM, 0.26, 0.14, 0.22, 0, 0.96, 0.3);
    exoBox(riderG, riderM, 0.3, 0.44, 0.2, 0, 1.1, 0.0, { rx: -0.62 });
    const helm = new THREE.Mesh(helmGeo, helmetM);
    helm.position.set(0, 1.26, -0.22);
    helm.castShadow = true; helm.receiveShadow = true;
    riderG.add(helm);
    exoBox(riderG, glassM, 0.15, 0.06, 0.02, 0, 1.25, -0.34, { cast: false });
    for (const s of [-1, 1]) {
      exoTube(riderG, riderM, [s * 0.17, 1.2, -0.1], [s * 0.2, 1.02, -0.3], 0.042);
      exoTube(riderG, riderM, [s * 0.2, 1.02, -0.3], [s * 0.24, 0.92, -0.42], 0.038);
      exoTube(riderG, riderM, [s * 0.11, 0.94, 0.32], [s * 0.16, 0.74, 0.08], 0.05);
      exoTube(riderG, riderM, [s * 0.16, 0.74, 0.08], [s * 0.15, 0.48, 0.2], 0.042);
    }

    for (const m of ray) world.raycastMeshes.push(m);
    root.add(group);
    return { group, bodyG, leanG, steerG, riderG, stand, fSpin, rSpin };
  }

  // ---------------------------------------------------------- missile build
  // one finned rocket, nose at -Z: olive body cylinder, cone nose with a red
  // band behind it, crossed tail fins. Used 4x on the rack + a small pool of
  // in-flight projectiles at scene root.
  function buildMissileMesh(parent) {
    const g = new THREE.Group();
    const parts = [
      [mslBodyGeo, mslBodyM, 0.1],     // body -1.0 .. 1.2
      [mslConeGeo, mslBodyM, -1.2],    // nose cone, tip at -1.4
      [mslBandGeo, mslBandM, -0.85],   // red band behind the cone
      [mslFinGeoV, mslFinM, 1.05],
      [mslFinGeoH, mslFinM, 1.05],
    ];
    for (const [geo, mat, z] of parts) {
      const m = new THREE.Mesh(geo, mat);
      m.position.z = z;
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    parent.add(g);
    return g;
  }

  // ------------------------------------------------------------- truck build
  // 6x6 military missile-launcher war truck (~7m), nose at -Z: armored 2-seat
  // cab (small recessed windows, brush guard), hood over the engine, flat bed
  // carrying a turreted rack — angled launch ramp (~25°) with 4 rockets on
  // rails. Olive-drab weathered paint + big white stencil unit number on the
  // doors/tailgate plate, mud flaps, jerrycan, spare tire, exhaust stack,
  // chunky all-terrain wheels (front pair steers). rackG yaw is slaved softly
  // to the camera aim while driving.
  function buildTruck(hex, seed) {
    const tex = makePaintTex(hex, seed);
    const paint = new THREE.MeshStandardMaterial({
      map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0.22,
    });
    // stencil variant: same weathered paint with a big worn unit number
    const stex = makePaintTex(hex, seed + 17);
    {
      const cv = stex.map.image, g = cv.getContext('2d');
      g.save();
      g.translate(128, 122);
      g.rotate(-0.03);
      g.fillStyle = 'rgba(216,212,198,0.78)';
      g.font = '700 118px "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('77', 0, 6);
      g.fillStyle = '#' + new THREE.Color(hex).getHexString(); // stencil bridges
      g.fillRect(-80, -32, 160, 7);
      g.fillRect(-80, 28, 160, 7);
      g.restore();
      stex.map.needsUpdate = true;
    }
    const stencil = new THREE.MeshStandardMaterial({
      map: stex.map, roughnessMap: stex.rough, roughness: 1, metalness: 0.22,
    });

    const group = new THREE.Group();
    const bodyG = new THREE.Group(); bodyG.position.y = 0.85; group.add(bodyG);
    const hull = new THREE.Group(); hull.position.y = -0.85; bodyG.add(hull);
    const ray = [];
    const B = (mat, w, h, d, x, y, z, o) => exoBox(hull, mat, w, h, d, x, y, z, o);

    // ladder chassis + underbody + fuel tank
    for (const s of [-1, 1]) B(seamM, 0.14, 0.26, 6.7, s * 0.6, 0.6, 0.05);
    B(plastic, 1.9, 0.34, 5.2, 0, 0.7, 0.2, { cast: false });
    exoCyl(hull, engineM, 0.21, 1.1, -0.98, 0.62, 0.45, { seg: 10 });
    // heavy front bumper + tow hooks + brush guard bars
    ray.push(B(engineM, 2.5, 0.36, 0.3, 0, 0.68, -3.42));
    for (const s of [-1, 1]) B(seamM, 0.12, 0.12, 0.14, s * 0.7, 0.68, -3.58);
    for (const gx of [-0.72, -0.26, 0.26, 0.72]) {
      exoTube(hull, frameM, [gx, 0.58, -3.6], [gx, 1.7, -3.56], 0.028);
    }
    exoTube(hull, frameM, [-0.86, 1.04, -3.6], [0.86, 1.04, -3.6], 0.026);
    exoTube(hull, frameM, [-0.86, 1.48, -3.58], [0.86, 1.48, -3.58], 0.026);
    // hood + top plate + grille + headlights + front fenders/mud flaps
    ray.push(B(paint, 2.14, 0.52, 1.06, 0, 1.38, -2.86));
    B(paint, 2.0, 0.09, 1.0, 0, 1.68, -2.86, { rx: -0.02 });
    B(seamM, 1.66, 0.5, 0.07, 0, 1.08, -3.36);
    for (const s of [-1, 1]) {
      B(lightM, 0.2, 0.14, 0.05, s * 0.82, 1.34, -3.37, { cast: false });
      ray.push(B(paint, 0.34, 0.16, 1.6, s * 1.16, 1.18, -2.6));
      B(plastic, 0.36, 0.4, 0.04, s * 1.05, 0.4, -1.66, { cast: false });
    }
    // armored cab: slab sides, roof plate + hatch ring, split windshield in
    // an armored surround, small side windows, stencil door plates, mirrors
    ray.push(B(paint, 2.34, 1.24, 1.52, 0, 1.98, -1.56));
    B(paint, 2.4, 0.1, 1.6, 0, 2.62, -1.56);
    B(seamM, 0.42, 0.06, 0.42, 0, 2.69, -1.4);
    B(paint, 0.14, 0.44, 0.06, 0, 2.26, -2.35);                          // windshield center pillar
    B(paint, 1.96, 0.12, 0.06, 0, 2.51, -2.35);                          // armored brow
    B(paint, 1.96, 0.1, 0.06, 0, 2.02, -2.35);                           // sill strip
    for (const s of [-1, 1]) {
      B(glassM, 0.76, 0.32, 0.04, s * 0.5, 2.26, -2.34, { cast: false }); // small windshield pane
      B(glassM, 0.04, 0.26, 0.5, s * 1.18, 2.28, -1.72, { cast: false }); // small side window
      ray.push(B(stencil, 0.05, 0.66, 0.8, s * 1.185, 1.7, -1.35));       // door + unit number
      B(chrome, 0.03, 0.03, 0.16, s * 1.22, 1.92, -1.06, { cast: false });
      exoTube(hull, frameM, [s * 1.15, 2.35, -2.3], [s * 1.42, 2.42, -2.2], 0.018);
      B(plastic, 0.05, 0.26, 0.14, s * 1.44, 2.3, -2.18);                 // mirror plates
    }
    // exhaust stack (right, behind the cab) + jerrycan (left)
    exoCyl(hull, engineM, 0.055, 1.5, 1.14, 2.0, -0.72, { axis: 'y', seg: 10 });
    B(engineM, 0.16, 0.1, 0.16, 1.14, 2.78, -0.72);
    B(paint, 0.42, 0.52, 0.17, -0.9, 1.66, -0.72);                        // jerrycan
    B(seamM, 0.2, 0.07, 0.19, -0.9, 1.88, -0.72);
    // flat bed: deck, headboard, side rails, tailgate + stencil plate,
    // rear mud flaps, spare tire on the tailgate
    ray.push(B(paint, 2.42, 0.16, 4.3, 0, 1.06, 1.35));
    B(paint, 2.42, 0.5, 0.08, 0, 1.39, -0.76);
    for (const s of [-1, 1]) {
      ray.push(B(paint, 0.09, 0.36, 4.3, s * 1.185, 1.32, 1.35));
      B(plastic, 0.4, 0.5, 0.04, s * 1.02, 0.32, 3.12, { cast: false });
    }
    ray.push(B(paint, 2.3, 0.42, 0.07, 0, 1.35, 3.52));
    B(stencil, 0.72, 0.44, 0.05, -0.62, 1.35, 3.57);                      // tailgate unit number
    const spare = new THREE.Mesh(tTireGeo, knobM);
    spare.rotation.y = Math.PI / 2;
    spare.scale.setScalar(0.72);
    spare.position.set(0.68, 1.5, 3.6);
    spare.castShadow = true; spare.receiveShadow = true;
    spare.userData.surface = 'metal';
    hull.add(spare);

    // ----- turreted missile rack on the bed: pedestal -> rackG (yaw, slaved
    // to camera look while driving) -> rampG (fixed ~25° elevation) with 4
    // rails + 4 rockets
    exoCyl(hull, engineM, 0.5, 0.34, 0, 1.3, 1.5, { axis: 'y', seg: 14 });
    const rackG = new THREE.Group();
    rackG.position.set(0, 1.45, 1.5);
    hull.add(rackG);
    exoBox(rackG, carbonM, 1.6, 0.14, 1.8, 0, 0.07, 0);                   // turntable
    for (const s of [-1, 1]) {                                            // A-frame supports
      exoTube(rackG, frameM, [s * 0.62, 0.12, 0.8], [s * 0.4, 0.74, 0.4], 0.03);
      exoTube(rackG, frameM, [s * 0.55, 0.12, -0.35], [s * 0.36, 0.72, 0.05], 0.026);
    }
    const rampG = new THREE.Group();
    rampG.position.set(0, 0.78, 0.2);
    rampG.rotation.x = 0.44;                                              // ~25° elevation, nose up
    rackG.add(rampG);
    exoBox(rampG, carbonM, 1.44, 0.09, 3.1, 0, -0.08, 0);                 // ramp bed
    exoBox(rampG, seamM, 1.5, 0.5, 0.06, 0, 0.16, 1.57, { rx: -0.1 });    // blast shield
    const RAIL_X = [-0.54, -0.18, 0.18, 0.54];
    const rackMissiles = [];
    for (const rx of RAIL_X) {
      exoBox(rampG, frameM, 0.09, 0.08, 3.1, rx, 0.02, 0);                // launch rail
      const msl = buildMissileMesh(rampG);
      msl.position.set(rx, 0.18, 0.05);
      rackMissiles.push(msl);
    }

    // chunky all-terrain wheels: front axle steers, rear tandem
    function truckWheel(x, z) {
      const piv = new THREE.Group();
      piv.position.set(x, 0.52, z);
      const spin = new THREE.Group();
      for (const [geo, mat] of [[tTireGeo, knobM], [tRimGeo, engineM], [tCapGeo, capM]]) {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true; m.receiveShadow = true;
        spin.add(m);
      }
      piv.add(spin);
      group.add(piv);
      return { piv, spin };
    }
    const wheels = [
      truckWheel(-1.05, -2.45), truckWheel(1.05, -2.45),                  // steer axle
      truckWheel(-1.05, 1.35), truckWheel(1.05, 1.35),
      truckWheel(-1.05, 2.5), truckWheel(1.05, 2.5),
    ];

    for (const m of ray) world.raycastMeshes.push(m);
    root.add(group);
    return { group, bodyG, wheels, rackG, rackMissiles };
  }

  const BUILD = {
    car: buildCar, moto: buildBike,
    super: buildSuper, coupe: buildCoupe, formula: buildFormula,
    cross: buildCross, race: buildRace, truck: buildTruck,
  };

  // ------------------------------------------------------------- kind params
  // sedan numbers are the original constants — behavior is unchanged; moto is
  // the agile variant (fast, narrow, light handbrake slide, closer chase cam).
  // Shared fields: bike (two-wheeler: lean/kickstand/rider/RIDE prompt),
  // wheelR (visual spin radius), rpmRate/rpmOn/rpmOff (engine rpm mapping —
  // super/formula rev higher), leanMax (bike lean cap), noSlide (Space brakes
  // instead of sliding — formula), bouncy (underdamped MX pitch).
  const CORNERS = [[-0.52, -1.62], [0.52, -1.62], [-0.52, 1.62], [0.52, 1.62]];
  const M_CORNERS = [[0, -0.82], [0, 0.82]];
  const KINDP = {
    car: {
      top: TOP, topR: TOP_R, accel: ACCEL, brake: BRAKE, rev: REV_ACCEL,
      wb: WHEELBASE, maxSteer: MAX_STEER, steerFall: 0.16,
      hx: HX, hz: HZ, colH: COL_H, colR: 0.5, corners: CORNERS,
      grip: 8.5, gripHb: 1.6, hbYaw: 1.35, dragV: 0.0192, hbDrag: 2.6,
      axisHalf: 1.35, pad: 0.45,
      wheelR: 0.335, rpmRate: 0.82, rpmOn: 0.14, rpmOff: 0,
      cam: { back: 5.2, backV: 1.3, h: 2.1, hV: 0.008, anchorY: 1.65, lookY: 1.15, ahead: 2.3, aheadV: 0.13 },
    },
    moto: {
      bike: true,
      top: M_TOP, topR: 4.5, accel: M_ACCEL, brake: 16, rev: 5,
      wb: 1.42, maxSteer: 0.72, steerFall: 0.27,
      hx: M_HX, hz: M_HZ, colH: 1.12, colR: 0.42, corners: M_CORNERS,
      grip: 10, gripHb: 2.9, hbYaw: 1.18, dragV: 0.012, hbDrag: 2.2,
      axisHalf: 0.85, pad: 0.36,
      wheelR: 0.315, rpmRate: 0.9, rpmOn: 0.2, rpmOff: 0.06,
      cam: { back: 4.2, backV: 1.0, h: 1.8, hV: 0.007, anchorY: 1.45, lookY: 1.05, ahead: 2.1, aheadV: 0.11 },
    },
    // rosso wedge: fast + grippy, mild handbrake drift, revvy note
    super: {
      top: 30, topR: 7, accel: 13, brake: 18, rev: 6,
      wb: 2.7, maxSteer: 0.6, steerFall: 0.15,
      hx: 1.0, hz: 2.28, colH: 1.12, colR: 0.5,
      corners: [[-0.6, -1.7], [0.6, -1.7], [-0.6, 1.7], [0.6, 1.7]],
      grip: 10, gripHb: 2.0, hbYaw: 1.3, dragV: 0.0135, hbDrag: 2.6,
      axisHalf: 1.4, pad: 0.45,
      wheelR: 0.335, rpmRate: 0.94, rpmOn: 0.22, rpmOff: 0.05,
      cam: { back: 5.1, backV: 1.4, h: 1.85, hV: 0.008, anchorY: 1.25, lookY: 0.9, ahead: 2.4, aheadV: 0.13 },
    },
    // silver GT coupe: quick and planted (high base grip, tame slide)
    coupe: {
      top: 27, topR: 7, accel: 11.5, brake: 16, rev: 6,
      wb: 2.5, maxSteer: 0.6, steerFall: 0.16,
      hx: 0.93, hz: 2.16, colH: 1.34, colR: 0.5,
      corners: [[-0.55, -1.55], [0.55, -1.55], [-0.55, 1.55], [0.55, 1.55]],
      grip: 11, gripHb: 1.9, hbYaw: 1.2, dragV: 0.015, hbDrag: 2.6,
      axisHalf: 1.35, pad: 0.45,
      wheelR: 0.32, rpmRate: 0.86, rpmOn: 0.16, rpmOff: 0.02,
      cam: { back: 5.0, backV: 1.3, h: 1.95, hV: 0.008, anchorY: 1.45, lookY: 1.0, ahead: 2.3, aheadV: 0.13 },
    },
    // open-wheeler: fastest, razor steering that keeps authority at speed,
    // huge lateral grip, no handbrake slide (Space brakes), harsh crash shake
    formula: {
      top: 33, topR: 5, accel: 15, brake: 24, rev: 5,
      wb: 3.1, maxSteer: 0.55, steerFall: 0.09,
      hx: 0.97, hz: 2.55, colH: 0.95, colR: 0.38,
      corners: [[-0.78, -1.55], [0.78, -1.55], [-0.78, 1.68], [0.78, 1.68]],
      grip: 15, gripHb: 15, hbYaw: 1.0, dragV: 0.0128, hbDrag: 0,
      noSlide: true, axisHalf: 1.7, pad: 0.5,
      wheelR: 0.33, rpmRate: 1.0, rpmOn: 0.3, rpmOff: 0.08,
      cam: { back: 4.4, backV: 1.7, h: 1.5, hV: 0.006, anchorY: 0.85, lookY: 0.55, ahead: 2.6, aheadV: 0.15 },
    },
    // motocross: slower top, extra agile at low speed, bouncy pitch
    cross: {
      bike: true,
      top: 22, topR: 4.5, accel: 12, brake: 14, rev: 5,
      wb: 1.42, maxSteer: 0.8, steerFall: 0.34,
      hx: 0.35, hz: 1.12, colH: 1.28, colR: 0.42, corners: [[0, -0.85], [0, 0.85]],
      grip: 9.5, gripHb: 2.7, hbYaw: 1.2, dragV: 0.028, hbDrag: 2.2,
      bouncy: true, axisHalf: 0.9, pad: 0.36,
      wheelR: 0.35, rpmRate: 0.9, rpmOn: 0.22, rpmOff: 0.08,
      cam: { back: 4.2, backV: 1.0, h: 1.95, hV: 0.007, anchorY: 1.55, lookY: 1.1, ahead: 2.1, aheadV: 0.11 },
    },
    // superbike: fast, leans harder (~34°), tucked rider
    race: {
      bike: true,
      top: 30, topR: 4.5, accel: 13, brake: 18, rev: 5,
      wb: 1.38, maxSteer: 0.68, steerFall: 0.24,
      hx: 0.37, hz: 1.06, colH: 1.16, colR: 0.42, corners: [[0, -0.82], [0, 0.82]],
      grip: 11, gripHb: 3.1, hbYaw: 1.15, dragV: 0.0135, hbDrag: 2.2,
      leanMax: 0.593, axisHalf: 0.85, pad: 0.36,
      wheelR: 0.3, rpmRate: 0.96, rpmOn: 0.24, rpmOff: 0.06,
      cam: { back: 4.3, backV: 1.1, h: 1.75, hV: 0.007, anchorY: 1.4, lookY: 1.0, ahead: 2.2, aheadV: 0.12 },
    },
    // missile war truck: heavy and slow, long wheelbase turns wide, steering
    // keeps authority at speed (low steerFall), weak handbrake, strong but
    // slow/damped body roll, tall chase cam pulled way back
    truck: {
      top: 14, topR: 5, accel: 5, brake: 10, rev: 4,
      wb: 4.4, maxSteer: 0.46, steerFall: 0.12,
      hx: 1.25, hz: 3.4, colH: 2.6, colR: 0.6,
      corners: [[-0.65, -2.8], [0.65, -2.8], [-0.65, 2.8], [0.65, 2.8]],
      grip: 7, gripHb: 3.6, hbYaw: 1.06, dragV: 0.02, hbDrag: 1.1,
      axisHalf: 2.5, pad: 0.55,
      rollK: 0.011, rollCap: 0.12, rollEase: 3.6, pitchK: 0.0062,
      wheelR: 0.52, rpmRate: 0.72, rpmOn: 0.12, rpmOff: 0,
      cam: { back: 7.0, backV: 1.1, h: 3.0, hV: 0.007, anchorY: 2.3, lookY: 1.7, ahead: 2.8, aheadV: 0.11 },
    },
  };

  // ------------------------------------------------------------- placement
  // sedan spots are SPEC-guaranteed clear; every other spot is verified
  // against world.colliders at build time and nudged to the nearest clear
  // slot, so they stay safe as the map grows into a city.
  const SPECS = [
    { hex: 0x3f432e, seed: 1111, x: 2.45, z: 40.0, heading: 0.02 },     // olive drab — right lane short of the crosswalk near spawn
    { hex: 0x3e4a55, seed: 2222, x: -4.95, z: 16.0, heading: Math.PI - 0.04 }, // dusty blue-grey — left curb, facing uptown
    { hex: 0x542d27, seed: 3333, x: 4.75, z: -28.0, heading: 0.16 },    // faded burgundy — angled out of the right lane
    { kind: 'moto', hex: 0x39424d, seed: 7101, x: -2.8, z: 44.0, heading: 0.05 },         // slate-blue tank — left lane near spawn, facing downtown (stageDrive bike)
    { kind: 'moto', hex: 0x59321f, seed: 7207, x: -5.9, z: 44.0, heading: Math.PI - 0.08 }, // burnt copper tank — left curb by the sidewalk, facing uptown
    // exotic fleet — modeled on real machines (silhouette + name + color; no
    // logos), hugging the main-street curbs clear of the drive/moto stage lanes
    { kind: 'super', name: 'FERRARI F40', hex: 0x9e1a12, seed: 8001, x: 4.9, z: 33.0, heading: -0.07 },
    { kind: 'coupe', name: 'PORSCHE 911', hex: 0xb4b6ba, seed: 8102, x: -3.6, z: 28.0, heading: Math.PI + 0.05 },
    { kind: 'formula', name: 'F1', hex: 0x9c4a26, seed: 8203, x: 0.8, z: -6.0, heading: 0.45 },
    { kind: 'cross', name: 'MOTOCROSS 450', hex: 0xa8602c, seed: 8304, x: 5.8, z: 20.0, heading: -0.3 },
    { kind: 'race', name: 'SUPERBIKE', hex: 0x46586a, seed: 8405, x: -6.1, z: 36.0, heading: Math.PI - 0.06 },
    // missile war truck — parked angled at the lower end of the main street,
    // clear of the F1 (~-0.3,-8) and the burgundy sedan (4.75,-28)
    { kind: 'truck', name: 'MISSILE TRUCK', hex: 0x474c36, seed: 9007, x: 0.5, z: -38.0, heading: 0.3 },
  ];

  const NUDGES = [
    [0, 0], [0, 1.4], [0, -1.4], [0, 2.8], [0, -2.8], [0, 4.2], [0, -4.2],
    [1.1, 0], [-1.1, 0], [1.1, 2], [-1.1, 2], [1.1, -2], [-1.1, -2],
    // wider fallbacks for the big truck footprint (tried last — the earlier
    // entries keep every existing vehicle exactly where it was)
    [2.2, 0], [-2.2, 0], [0, 5.6], [0, -5.6], [2.2, 3], [-2.2, 3], [2.2, -3], [-2.2, -3],
  ];
  function footprintClear(x, z, ex, ez) {
    for (const b of world.colliders) {
      if (b.max.y < 0.15 || b.min.y > 1.6) continue;
      if (b.max.x - b.min.x > 60 || b.max.z - b.min.z > 60) continue; // ground/bounds
      if (x + ex > b.min.x - 0.35 && x - ex < b.max.x + 0.35 &&
          z + ez > b.min.z - 0.35 && z - ez < b.max.z + 0.35) return false;
    }
    return true;
  }
  function findClearSpot(x, z, heading, P) {
    const ch = Math.abs(Math.cos(heading)), sh = Math.abs(Math.sin(heading));
    const ex = P.hx * ch + P.hz * sh, ez = P.hx * sh + P.hz * ch;
    for (const n of NUDGES) {
      if (footprintClear(x + n[0], z + n[1], ex, ez)) return [x + n[0], z + n[1]];
    }
    return [x, z];
  }

  const carsArr = SPECS.map((sp) => {
    const kind = sp.kind ?? 'car';
    const P = KINDP[kind];
    let px = sp.x, pz = sp.z;
    if (kind !== 'car') { // sedans are SPEC-guaranteed; everything else scans
      const spot = findClearSpot(sp.x, sp.z, sp.heading, P);
      px = spot[0]; pz = spot[1];
    }
    const built = BUILD[kind](sp.hex, sp.seed);
    const c = {
      kind, P,
      name: sp.name ?? null,   // real-model flavor name (exotics only)
      group: built.group, bodyG: built.bodyG, wheels: built.wheels,
      leanG: built.leanG, steerG: built.steerG, riderG: built.riderG,
      stand: built.stand, fSpin: built.fSpin, rSpin: built.rSpin,
      rackG: built.rackG, rackMissiles: built.rackMissiles, rackYaw: 0,
      msl: built.rackMissiles ? { ammo: 4, cd: 0, reloadT: 0 } : null,
      pos: new THREE.Vector3(px, 0, pz),
      heading: sp.heading,
      vel: new THREE.Vector3(),
      speed: 0, steer: 0, slide: 0, latA: 0,
      rollS: 0, pitchS: 0, pitchV: 0, accel: 0,
      leanS: P.bike ? PARK_LEAN : 0,
      colBox: new THREE.Box3(),
      awake: false,
    };
    c.group.position.set(px, 0, pz);
    c.group.rotation.y = sp.heading;
    if (c.leanG) c.leanG.rotation.z = c.leanS;
    refreshCollider(c);
    world.colliders.push(c.colBox);
    return c;
  });

  // managed collider: conservative AABB of the oriented footprint, mutated
  // in place (world.colliders is read live by player/enemies each frame)
  function refreshCollider(c) {
    const ch = Math.abs(Math.cos(c.heading)), sh = Math.abs(Math.sin(c.heading));
    const ex = c.P.hx * ch + c.P.hz * sh, ez = c.P.hx * sh + c.P.hz * ch;
    c.colBox.min.set(c.pos.x - ex, 0.1, c.pos.z - ez);
    c.colBox.max.set(c.pos.x + ex, c.P.colH, c.pos.z + ez);
  }

  // ------------------------------------------------------------- state
  const api = { driving: false, update, stageDrive };
  let active = null;
  let autoThrottle = false;   // stageDrive / probe hook
  let autoSteer = 0;          // probe hook only (0 in normal play)
  let promptOn = false;
  let promptTxt = null;
  let nowT = 0;
  let crashCd = 0;
  let shake = 0;
  let orbit = 0;
  let camBlend = 1;
  const camFromP = new THREE.Vector3(), camFromQ = new THREE.Quaternion();
  const camPosSm = new THREE.Vector3(), lookSm = new THREE.Vector3();
  const ranOver = new Map();

  const _f = new THREE.Vector3(), _r = new THREE.Vector3();
  const _want = new THREE.Vector3(), _lookT = new THREE.Vector3();
  const _anchor = new THREE.Vector3(), _camP = new THREE.Vector3();
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);
  const _qr = new THREE.Quaternion(), _vz = new THREE.Vector3(0, 0, 1);

  const wrapAngle = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

  // ------------------------------------------------------------- physics
  function collideCar(c) {
    const P = c.P, R = P.colR;
    let impact = 0;
    for (const b of world.colliders) {
      if (b === c.colBox) continue;
      if (b.max.y < 0.18 || b.min.y > 1.25) continue;
      if (c.pos.x + 3 < b.min.x || c.pos.x - 3 > b.max.x ||
          c.pos.z + 3 < b.min.z || c.pos.z - 3 > b.max.z) continue;
      const ch = Math.cos(c.heading), sh = Math.sin(c.heading);
      for (let k = 0; k < P.corners.length; k++) {
        const lx = P.corners[k][0], lz = P.corners[k][1];
        const wx = c.pos.x + lx * ch + lz * sh;
        const wz = c.pos.z - lx * sh + lz * ch;
        const px = clamp(wx, b.min.x, b.max.x);
        const pz = clamp(wz, b.min.z, b.max.z);
        const dx = wx - px, dz = wz - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        let nx, nz, pen;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = dx / d; nz = dz / d; pen = R - d;
        } else { // corner center inside the box: shortest exit
          const exl = wx - (b.min.x - R), exr = (b.max.x + R) - wx;
          const ezl = wz - (b.min.z - R), ezr = (b.max.z + R) - wz;
          const m = Math.min(exl, exr, ezl, ezr);
          if (m === exl) { nx = -1; nz = 0; pen = exl; }
          else if (m === exr) { nx = 1; nz = 0; pen = exr; }
          else if (m === ezl) { nx = 0; nz = -1; pen = ezl; }
          else { nx = 0; nz = 1; pen = ezr; }
        }
        c.pos.x += nx * pen; c.pos.z += nz * pen;
        const vn = c.vel.x * nx + c.vel.z * nz;
        if (vn < 0) {
          impact = Math.max(impact, -vn);
          c.vel.x -= vn * nx * 1.15; // slight restitution
          c.vel.z -= vn * nz * 1.15;
        }
      }
    }
    if (impact > 0.5) {
      _f.set(-Math.sin(c.heading), 0, -Math.cos(c.heading));
      c.speed = c.vel.dot(_f);
    }
    if (impact > 6 && crashCd <= 0) {
      crashCd = 0.35;
      audio.crash?.(clamp(impact / 16, 0.3, 1));
      // bikes rattle the camera harder; the open-wheeler is harshest
      shake = c.kind === 'formula'
        ? Math.min(0.95, 0.2 + impact * 0.05)
        : c.P.bike
          ? Math.min(0.85, 0.16 + impact * 0.034)
          : Math.min(0.6, 0.12 + impact * 0.02);
    } else if (impact > 2.2 && crashCd <= 0) {
      crashCd = 0.25;
      audio.crash?.(0.18);
    }
  }

  function simCar(c, dt) {
    const drive = api.driving && c === active;
    if (!drive && !c.awake) {
      // a stopped bike settles back onto its kickstand
      if (c.P.bike && Math.abs(c.leanS - PARK_LEAN) > 0.0015) {
        c.leanS += (PARK_LEAN - c.leanS) * Math.min(1, 4 * dt);
        c.leanG.rotation.z = c.leanS;
      }
      // an abandoned truck's rack swings back to travel position
      if (c.rackG && Math.abs(c.rackYaw) > 0.002) {
        c.rackYaw += (0 - c.rackYaw) * Math.min(1, 2 * dt);
        c.rackG.rotation.y = c.rackYaw;
      }
      return;
    }
    const P = c.P;

    const thr = drive && (autoThrottle || input.isDown('KeyW')) ? 1 : 0;
    // noSlide (formula): Space is a second brake pedal, never a slide
    const brk = drive && (input.isDown('KeyS') || (P.noSlide && input.isDown('Space')));
    const hb = drive && input.isDown('Space') && !P.noSlide;
    const sIn = drive
      ? (autoSteer !== 0 ? autoSteer : (input.isDown('KeyA') ? 1 : 0) - (input.isDown('KeyD') ? 1 : 0))
      : 0;

    // steering: speed-scaled authority, springs back to center
    const sTarget = sIn * (P.maxSteer / (1 + Math.abs(c.speed) * P.steerFall));
    c.steer += (sTarget - c.steer) * Math.min(1, (sIn !== 0 ? 6 : 9) * dt);

    // bicycle-model yaw
    const yawRate = (c.speed / P.wb) * Math.tan(c.steer) * (hb ? P.hbYaw : 1);
    c.heading = wrapAngle(c.heading + yawRate * dt);
    c.latA = c.speed * yawRate;

    const f = _f.set(-Math.sin(c.heading), 0, -Math.cos(c.heading));
    const r = _r.set(-f.z, 0, f.x);
    let vf = c.vel.dot(f);
    let vl = c.vel.dot(r);

    // longitudinal: throttle, brake-then-reverse, drag
    if (thr && !hb) vf += P.accel * dt;
    if (brk) vf -= (vf > 0.35 ? P.brake : P.rev) * dt;
    const drag = ((drive ? 0.55 : 1.4) + P.dragV * vf * vf + (hb ? P.hbDrag : 0)) * dt;
    vf = vf > 0 ? Math.max(0, vf - drag) : Math.min(0, vf + drag);
    vf = clamp(vf, -P.topR, P.top);

    // lateral grip bleeds sideways velocity; handbrake cuts it for slides
    const grip = (hb ? P.gripHb : P.grip) / (1 + Math.abs(vf) * 0.02);
    vl *= Math.exp(-grip * dt);

    c.vel.copy(f).multiplyScalar(vf).addScaledVector(r, vl);
    c.pos.addScaledVector(c.vel, dt);
    c.accel = (vf - c.speed) / Math.max(dt, 1e-4);
    c.speed = vf;
    c.slide = Math.abs(vl);

    collideCar(c);

    c.awake = drive || Math.abs(c.speed) > 0.03 || c.slide > 0.03;
    if (!c.awake) { c.speed = 0; c.vel.set(0, 0, 0); }
    refreshCollider(c);

    // visuals: transform, roll/pitch (bikes: lean into turns), wheel spin
    c.group.position.set(c.pos.x, 0, c.pos.z);
    c.group.rotation.y = c.heading;
    if (c.P.bike) {
      const cap = P.leanMax ?? MAX_LEAN;                       // race leans deeper
      const leanT = clamp(c.latA * 0.03, -cap, cap);           // roll INTO the turn
      c.leanS += (leanT - c.leanS) * Math.min(1, 6 * dt);
      c.leanG.rotation.z = c.leanS;
      const tPitch = clamp(c.accel * 0.003, -0.06, 0.05);
      if (P.bouncy) {
        // motocross: underdamped pitch spring — throttle/brake steps bounce
        c.pitchV += ((tPitch * 1.6 - c.pitchS) * 46 - c.pitchV * 5.2) * dt;
        c.pitchS = clamp(c.pitchS + c.pitchV * dt, -0.1, 0.09);
      } else {
        c.pitchS += (tPitch - c.pitchS) * Math.min(1, 7 * dt);
      }
      c.bodyG.rotation.x = c.pitchS;
      c.steerG.rotation.y = c.steer * 0.8;   // visual fork steer
      const spin = (c.speed / (P.wheelR ?? 0.315)) * dt;
      c.fSpin.rotation.x -= spin;
      c.rSpin.rotation.x -= spin;
    } else {
      // truck overrides: stronger roll gain/cap eased slower (heavy, damped)
      const cap = P.rollCap ?? 0.075;
      const ease = Math.min(1, (P.rollEase ?? 7) * dt);
      const tRoll = clamp(-c.latA * (P.rollK ?? 0.0062), -cap, cap);
      const tPitch = clamp(c.accel * (P.pitchK ?? 0.0045), -0.05, 0.055);
      c.rollS += (tRoll - c.rollS) * ease;
      c.pitchS += (tPitch - c.pitchS) * ease;
      c.bodyG.rotation.z = c.rollS;
      c.bodyG.rotation.x = c.pitchS;
      const spin = (c.speed / (P.wheelR ?? 0.335)) * dt;
      for (let i = 0; i < c.wheels.length; i++) {
        c.wheels[i].spin.rotation.x -= spin;
        if (i < 2) c.wheels[i].piv.rotation.y = c.steer * 0.9;
      }
      // missile rack turret: slaved softly toward the camera aim while
      // driving (clamped ±0.3 rad), back to travel position otherwise
      if (c.rackG) {
        let ty = 0;
        if (drive) {
          camera.getWorldDirection(_aim);
          ty = clamp(wrapAngle(Math.atan2(-_aim.x, -_aim.z) - c.heading), -0.3, 0.3);
        }
        c.rackYaw += (ty - c.rackYaw) * Math.min(1, 3 * dt);
        c.rackG.rotation.y = c.rackYaw;
      }
    }
  }

  // ------------------------------------------------------------- runover
  function runoverCheck(c) {
    if (Math.abs(c.speed) <= 3) return;
    const vols = getEnemyVolumes ? getEnemyVolumes() : null;
    if (!vols || !vols.length) return;
    const ch = Math.cos(c.heading), sh = Math.sin(c.heading);
    for (const v of vols) {
      if (!v || !v.pos) continue;
      const dx = v.pos.x - c.pos.x, dz = v.pos.z - c.pos.z;
      const lx = dx * ch - dz * sh;   // world -> vehicle local
      const lz = dx * sh + dz * ch;
      const qx = Math.max(0, Math.abs(lx) - c.P.hx);
      const qz = Math.max(0, Math.abs(lz) - c.P.hz);
      const rr = (v.radius || 0.34) + c.P.pad;
      if (qx * qx + qz * qz > rr * rr) continue;
      const last = ranOver.get(v.ref) ?? -9;
      if (nowT - last < 1.2) continue;
      ranOver.set(v.ref, nowT);
      // degrades gracefully: enemies.runover may not exist yet — thud anyway
      if (runover) runover(v.ref, Math.abs(c.speed));
      audio.crash?.(0.4);
      shake = Math.max(shake, 0.18);
      c.speed *= 0.96;
      c.vel.multiplyScalar(0.96);
    }
  }

  // ------------------------------------------------------------- missiles
  // war-truck rack fire: LMB edge (weapon.update is skipped while driving)
  // launches one rack rocket on a gravity-lite ballistic arc toward the point
  // ~70m along the camera aim (clamped to y>=0). Trail = tracer chain + a
  // muzzle-flash/smoke puff every other frame. Contact with the ground or a
  // world collider: pooled explosion fx + dust ring + area missileStrike.
  const MSL_G = 7, MSL_SPEED = 46, MSL_CD = 1.6, MSL_RELOAD = 6, MSL_RADIUS = 7;
  const mslLive = [];
  const mslPool = [];
  let mslPrevFire = false;
  let forceFire = false;     // __cars probe hook
  let stageFireT = -1;       // stageDrive('truck'): timed launch for the shot
  let mslLastImpact = null;  // probe telemetry
  let mslLastKills = -1;
  const _aim = new THREE.Vector3(), _tgt = new THREE.Vector3();
  const _mv = new THREE.Vector3(), _NZ = new THREE.Vector3(0, 0, -1);

  // own pooled additive trail sprites — the tracer chain is foreshortened to
  // a dot when the rocket flies away from the chase cam, these stay readable
  const TRAIL_N = 64;
  const trailTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const trailPool = [];
  let trailIdx = 0;
  for (let i = 0; i < TRAIL_N; i++) {
    const mat = new THREE.SpriteMaterial({
      map: trailTex, color: 0xffb066, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.visible = false;
    root.add(s);
    trailPool.push({ s, t: 1, life: 0.6, hot: false });
  }
  function trailPuff(x, y, z, hot) {
    const p = trailPool[trailIdx++ % TRAIL_N];   // reuse-oldest
    p.s.position.set(x, y, z);
    p.t = 0;
    p.life = hot ? 0.14 : 0.62;
    p.hot = hot;
    p.s.visible = true;
  }
  function trailUpdate(dt) {
    for (const p of trailPool) {
      if (!p.s.visible) continue;
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { p.s.visible = false; p.s.material.opacity = 0; continue; }
      if (p.hot) {          // motor flame right at the nozzle
        p.s.material.color.setHex(0xffd9a0);
        p.s.material.opacity = 0.95 * (1 - k);
        const sc = 0.55 + k * 0.6;
        p.s.scale.set(sc, sc, 1);
      } else {              // glowing exhaust puffs swelling as they cool
        p.s.material.color.setHex(0xff9a52);
        p.s.material.opacity = 0.5 * (1 - k);
        const sc = 0.6 + k * 1.7;
        p.s.scale.set(sc, sc, 1);
      }
      p.s.position.y += dt * 0.4;
    }
  }

  function launchMissile(c) {
    if (!c.msl || c.msl.ammo <= 0 || c.msl.cd > 0 || c.msl.reloadT > 0) return false;
    const idx = 4 - c.msl.ammo;              // empty the rack tube by tube
    const rm = c.rackMissiles[idx];
    rm.getWorldPosition(_mv);
    rm.visible = false;                       // respawns during the reload
    c.msl.ammo--;
    c.msl.cd = MSL_CD;
    if (c.msl.ammo === 0) c.msl.reloadT = MSL_RELOAD;
    const m = mslPool.pop() ?? {
      g: buildMissileMesh(root), vel: new THREE.Vector3(),
      pos: new THREE.Vector3(), prev: new THREE.Vector3(), t: 0, flip: false, src: null,
    };
    camera.getWorldDirection(_aim);
    _tgt.copy(camera.position).addScaledVector(_aim, 70);
    if (_tgt.y < 0) _tgt.y = 0;
    const T = clamp(_tgt.distanceTo(_mv) / MSL_SPEED, 0.7, 2.4);
    m.vel.copy(_tgt).sub(_mv).divideScalar(T);
    m.vel.y += 0.5 * MSL_G * T;               // shallow lob that lands on target
    m.pos.copy(_mv);
    m.prev.copy(_mv);
    m.t = 0; m.flip = false; m.src = c;
    m.g.visible = true;
    m.g.position.copy(_mv);
    m.g.quaternion.setFromUnitVectors(_NZ, _aim.copy(m.vel).normalize());
    mslLive.push(m);
    fx?.muzzleFlash(_mv, _aim.multiplyScalar(-1));   // launch flash off the rail
    if (audio.kick) audio.kick(); else audio.crash?.(0.3);
    shake = Math.max(shake, 0.14);
    return true;
  }

  function detonateMissile(m) {
    const p = m.pos;
    p.y = Math.max(p.y, 0.05);
    if (fx) {
      fx.explosionAt(p);
      fx.debris(p, UPV);
      for (let k = 0; k < 3; k++) {           // dust bursts ringing the blast
        const a = k * 2.1 + m.t;
        _mv.set(p.x + Math.cos(a) * (1.1 + k * 0.5), 0.05, p.z + Math.sin(a) * (1.1 + k * 0.5));
        fx.impact(_mv, UPV, k === 1 ? 'concrete' : 'dirt');
      }
    }
    if (audio.explosion) audio.explosion(p); else audio.crash?.(0.9);
    shake = Math.max(shake, 0.55);
    const kills = missileStrike ? (missileStrike(p, MSL_RADIUS) | 0) : 0;
    mslLastKills = kills;
    mslLastImpact = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)];
    if (kills > 0) hud.killfeed?.(`MISSILE STRIKE — ${kills} down`);
    m.g.visible = false;
    mslPool.push(m);
  }

  function updateMissiles(dt) {
    for (let i = mslLive.length - 1; i >= 0; i--) {
      const m = mslLive[i];
      m.t += dt;
      m.prev.copy(m.pos);
      m.vel.y -= MSL_G * dt;
      m.pos.addScaledVector(m.vel, dt);
      m.g.position.copy(m.pos);
      m.g.quaternion.setFromUnitVectors(_NZ, _aim.copy(m.vel).normalize());
      fx?.tracer(m.prev, m.pos);              // glowing streak along the path
      _aim.copy(m.vel).normalize();
      _mv.copy(m.pos).addScaledVector(_aim, -1.35);
      trailPuff(_mv.x, _mv.y, _mv.z, true);   // motor flame at the nozzle
      m.flip = !m.flip;
      if (m.flip) {                           // cooling exhaust puffs behind
        trailPuff(_mv.x - _aim.x * 0.8, _mv.y - _aim.y * 0.8, _mv.z - _aim.z * 0.8, false);
        fx?.muzzleFlash(_mv, _aim.multiplyScalar(-1));
      }
      let boom = m.t > 7;                     // failsafe
      if (m.pos.y <= 0.02) {
        // walk back to the ground plane for a clean strike point
        const f = m.prev.y > m.pos.y ? m.prev.y / (m.prev.y - m.pos.y) : 1;
        m.pos.lerpVectors(m.prev, m.pos, clamp(f, 0, 1));
        boom = true;
      } else if (m.t > 0.12) {                // brief arming time clears the rack
        for (const b of world.colliders) {
          if (m.src && b === m.src.colBox) continue;
          if (b.max.x - b.min.x > 60 || b.max.z - b.min.z > 60) continue; // ground/bounds
          if (m.pos.x > b.min.x - 0.05 && m.pos.x < b.max.x + 0.05 &&
              m.pos.y > b.min.y - 0.05 && m.pos.y < b.max.y + 0.05 &&
              m.pos.z > b.min.z - 0.05 && m.pos.z < b.max.z + 0.05) { boom = true; break; }
        }
      }
      if (boom) {
        mslLive.splice(i, 1);
        detonateMissile(m);
      }
    }
  }

  // cooldown tick + staged reload: rockets visually reappear one by one
  function updateRack(c, dt) {
    const s = c.msl;
    if (s.cd > 0) s.cd -= dt;
    if (s.reloadT > 0) {
      s.reloadT -= dt;
      const back = clamp(Math.floor((MSL_RELOAD - s.reloadT) / (MSL_RELOAD / 4)), 0, 4);
      for (let i = 0; i < back; i++) c.rackMissiles[i].visible = true;
      if (s.reloadT <= 0) {
        s.reloadT = 0;
        s.ammo = 4;
        for (const rm of c.rackMissiles) rm.visible = true;
      }
    }
  }

  // ------------------------------------------------------------- camera
  function updateCamera(dt) {
    const c = active;
    const K = c.P.cam;
    // small mouse-X orbit that springs back
    const md = input.takeMouseDelta();
    orbit = clamp(orbit + md.dx * 0.0028, -1.15, 1.15);
    orbit += (0 - orbit) * Math.min(1, 2.6 * dt);

    const sp = Math.abs(c.speed);
    const phi = c.heading + orbit;
    const back = K.back + (sp / c.P.top) * K.backV;   // subtle speed pull-back
    _want.set(c.pos.x + Math.sin(phi) * back, K.h + sp * K.hV, c.pos.z + Math.cos(phi) * back);
    _f.set(-Math.sin(c.heading), 0, -Math.cos(c.heading));
    _lookT.set(c.pos.x, K.lookY, c.pos.z).addScaledVector(_f, K.ahead + sp * K.aheadV);

    camPosSm.lerp(_want, 1 - Math.exp(-7.5 * dt));
    lookSm.lerp(_lookT, 1 - Math.exp(-11 * dt));

    // boom clamp: shorten when a collider blocks the line vehicle -> camera
    _anchor.set(c.pos.x, K.anchorY, c.pos.z);
    const STEPS = 9, CR = 0.33;
    let tUse = 1;
    for (let i = 1; i <= STEPS; i++) {
      const t = i / STEPS;
      const px = _anchor.x + (camPosSm.x - _anchor.x) * t;
      const py = _anchor.y + (camPosSm.y - _anchor.y) * t;
      const pz = _anchor.z + (camPosSm.z - _anchor.z) * t;
      let hit = false;
      for (const b of world.colliders) {
        if (b === c.colBox) continue;
        if (b.max.y < py - CR || b.min.y > py + CR) continue;
        if (px > b.min.x - CR && px < b.max.x + CR && pz > b.min.z - CR && pz < b.max.z + CR) { hit = true; break; }
      }
      if (hit) { tUse = (i - 1) / STEPS; break; }
    }
    _camP.lerpVectors(_anchor, camPosSm, Math.max(tUse, 0.2));

    shake *= Math.exp(-5.5 * dt);
    if (shake > 0.002) {
      _camP.x += Math.sin(nowT * 51) * shake * 0.14;
      _camP.y += Math.sin(nowT * 67 + 1.7) * shake * 0.12;
    }
    _m4.lookAt(_camP, lookSm, _up);
    _q.setFromRotationMatrix(_m4);
    // subtle camera roll with the bike lean
    if (c.P.bike && Math.abs(c.leanS) > 0.002) {
      _q.multiply(_qr.setFromAxisAngle(_vz, c.leanS * 0.18));
    }

    if (camBlend < 1) { // ~0.35s eased transition from the on-foot view
      camBlend = Math.min(1, camBlend + dt / 0.35);
      const s = camBlend * camBlend * (3 - 2 * camBlend);
      camera.position.lerpVectors(camFromP, _camP, s);
      camera.quaternion.slerpQuaternions(camFromQ, _q, s);
    } else {
      camera.position.copy(_camP);
      camera.quaternion.copy(_q);
    }
  }

  // ------------------------------------------------------------- enter/exit
  function enterCar(c) {
    active = c;
    api.driving = true;
    camFromP.copy(camera.position);
    camFromQ.copy(camera.quaternion);
    camBlend = 0;
    orbit = 0;
    const K = c.P.cam;
    const phi = c.heading;
    camPosSm.set(c.pos.x + Math.sin(phi) * K.back, K.h, c.pos.z + Math.cos(phi) * K.back);
    lookSm.set(c.pos.x - Math.sin(phi) * K.ahead, K.lookY, c.pos.z - Math.cos(phi) * K.ahead);
    if (promptOn) { hud.setPrompt?.(null); promptOn = false; promptTxt = null; }
    if (c.name) hud.killfeed?.(c.name);      // flavor line naming the machine
    mslPrevFire = !!input.fireHeld;          // don't fire off a stale click
    if (c.riderG) c.riderG.visible = true;   // mannequin/helmet only while driving
    if (c.stand) c.stand.visible = false;    // kickstand up
    if (c.P.bike) (audio.engineStartBike ?? audio.engineStart)?.();
    else audio.engineStart?.();
  }

  function spotClear(x, z, self) {
    for (const b of world.colliders) {
      if (b === self.colBox) continue;
      if (b.max.y < 0.2 || b.min.y > 1.6) continue;
      if (x > b.min.x - 0.38 && x < b.max.x + 0.38 &&
          z > b.min.z - 0.38 && z < b.max.z + 0.38) return false;
    }
    return true;
  }

  function exitCar() {
    const c = active;
    const h = c.heading;
    const fx = -Math.sin(h), fz = -Math.cos(h);
    const lxv = -Math.cos(h), lzv = Math.sin(h); // driver-side (left) door
    // wide/long kinds (truck) step out further so the spot clears the hull
    const lat = Math.max(1.5, c.P.hx + 0.85);
    const back = Math.max(3.1, c.P.hz + 1.2);
    const spots = [
      [c.pos.x + lxv * lat, c.pos.z + lzv * lat],   // left door
      [c.pos.x - lxv * lat, c.pos.z - lzv * lat],   // right door
      [c.pos.x - fx * back, c.pos.z - fz * back],   // behind
    ];
    let sx = spots[0][0], sz = spots[0][1];
    for (const s of spots) {
      if (spotClear(s[0], s[1], c)) { sx = s[0]; sz = s[1]; break; }
    }
    player.position.set(sx, 0, sz);
    player.velocity.set(0, 0, 0);
    player.yaw = wrapAngle(h);  // FPS view matches vehicle heading — no snap
    if (c.riderG) c.riderG.visible = false;
    if (c.stand) c.stand.visible = true;   // kickstand down
    api.driving = false;
    active = null;
    hud.setSpeed?.(null);
    audio.skid?.(0);
    audio.engineStop?.();
  }

  // distance from a point to the vehicle's long-axis segment (enter proximity)
  function distToCarAxis(p, c) {
    const fx = -Math.sin(c.heading), fz = -Math.cos(c.heading);
    const dx = p.x - c.pos.x, dz = p.z - c.pos.z;
    const t = clamp(dx * fx + dz * fz, -c.P.axisHalf, c.P.axisHalf);
    return Math.hypot(dx - fx * t, dz - fz * t);
  }

  // ------------------------------------------------------------- update
  function update(dt) {
    nowT += dt;
    if (crashCd > 0) crashCd -= dt;
    const eP = input.pressed('KeyE');
    const hP = input.pressed('KeyH');
    if (api.driving) input.pressed('Space'); // eat stale jump before exit

    for (const c of carsArr) {
      simCar(c, dt);
      if (c.msl) updateRack(c, dt);
    }
    updateMissiles(dt);   // in-flight rockets keep flying even after exit
    trailUpdate(dt);
    if (stageFireT > 0) { // stageDrive('truck'): timed launch for the capture
      stageFireT -= dt;
      if (stageFireT <= 0 && active && active.kind === 'truck') launchMissile(active);
    }

    if (api.driving && active) {
      const c = active;
      // tether: enemies aim at the vehicle; listener/minimap follow
      player.position.set(c.pos.x, 0, c.pos.z);
      player.yaw = c.heading;
      player.velocity.copy(c.vel);
      runoverCheck(c);
      // war truck: LMB edge fires a rack rocket (weapon.update is skipped
      // while driving so button 0 belongs to the launcher)
      if (c.msl) {
        const f = input.fireHeld || forceFire;
        if (f && !mslPrevFire) launchMissile(c);
        mslPrevFire = f;
      }
      updateCamera(dt);
      hud.setSpeed?.(Math.abs(c.speed) * 3.6);
      // per-kind rpm mapping — super/formula rev higher into audio.engineRpm
      const rpm = Math.min(1, Math.abs(c.speed) / c.P.top);
      const thrOn = autoThrottle || input.isDown('KeyW');
      const rv = Math.min(1, rpm * c.P.rpmRate + (thrOn ? c.P.rpmOn : c.P.rpmOff));
      if (c.P.bike) (audio.engineRpmBike ?? audio.engineRpm)?.(rv);
      else audio.engineRpm?.(rv);
      audio.skid?.(input.isDown('Space') && Math.abs(c.speed) > 4
        ? Math.min(1, Math.abs(c.speed) / 14 + c.slide * 0.1) : 0);
      if (hP) {
        if (c.P.bike) (audio.hornBike ?? audio.horn)?.();
        else audio.horn?.();
      }
      if (eP || !player.alive) exitCar();
    } else {
      // on foot: prompt when near a vehicle and roughly facing it
      let best = null, bestD = 1e9;
      if (player.alive) {
        for (const c of carsArr) {
          const d = distToCarAxis(player.position, c);
          if (d < 2.6 && d < bestD) {
            const dx = c.pos.x - player.position.x, dz = c.pos.z - player.position.z;
            const dl = Math.hypot(dx, dz) || 1;
            const face = -Math.sin(player.yaw) * (dx / dl) - Math.cos(player.yaw) * (dz / dl);
            if (face > 0.35) { best = c; bestD = d; }
          }
        }
      }
      if (best) {
        // exotics carry their real-model name; the old fleet keeps the plain prompt
        const verb = best.P.bike ? 'E — RIDE' : 'E — DRIVE';
        const txt = best.name ? `${verb} · ${best.name}` : verb;
        if (!promptOn || promptTxt !== txt) { hud.setPrompt?.(txt); promptOn = true; promptTxt = txt; }
        if (eP) enterCar(best);
      } else if (promptOn) {
        hud.setPrompt?.(null);
        promptOn = false;
        promptTxt = null;
      }
    }
  }

  // ------------------------------------------------------------- stageDrive
  // 'drive' screenshot scenario (default/no-arg): player in the car nearest
  // spawn, rolling forward down the street (-Z) at ~9 m/s, chase cam settled.
  // 'moto': bike #1 rolling ~11 m/s down the main street, rider visible.
  // The bike is lined up on the nearest lane with a clear straight run —
  // the map is growing into a city, so the corridor is scanned live.
  function corridorClear(x, z0, self, w = 0.9) {
    for (const b of world.colliders) {
      if (b === self.colBox) continue;
      if (b.max.y < 0.18 || b.min.y > 1.25) continue;
      if (b.max.x - b.min.x > 60 || b.max.z - b.min.z > 60) continue; // ground/bounds
      if (x + w > b.min.x && x - w < b.max.x &&
          z0 + 1.2 > b.min.z && z0 - 26 < b.max.z) return false;
    }
    return true;
  }

  function stageDrive(kind) {
    const c = kind
      ? (carsArr.find((v) => v.kind === kind) ?? carsArr[0])
      : carsArr[0];
    enterCar(c);
    camBlend = 1;          // capture the settled chase view, not the blend
    autoThrottle = true;
    if (c.P.bike) {
      const lanes = [c.pos.x, 0.3, -0.6, 1.3, -1.6, 2.3, -2.6, 3.3, 4.1];
      for (const lx of lanes) {
        if (corridorClear(lx, c.pos.z, c)) { c.pos.x = lx; break; }
      }
      c.heading = 0.02;    // straight down -Z
      c.steer = 0;
      refreshCollider(c);
    } else if (c.kind === 'truck') {
      // stage on the open upper street (the truck parks by the rubble end,
      // which has no run-out), one rocket timed to be mid-flight — trail and
      // all — when the harness captures around frame 50
      c.pos.z = 30;
      const lanes = [0.5, -0.5, 1.5, -1.5, 2.5, -2.5, c.pos.x];
      for (const lx of lanes) {
        if (corridorClear(lx, c.pos.z, c, 1.5)) { c.pos.x = lx; break; }
      }
      c.heading = 0.02;
      c.steer = 0;
      refreshCollider(c);
      stageFireT = 0.5;    // launch at ~frame 30
    }
    const fx = -Math.sin(c.heading), fz = -Math.cos(c.heading);
    const v0 = c.kind === 'truck' ? 8 : c.P.bike ? 11 : 9;
    c.vel.set(fx * v0, 0, fz * v0);
    c.speed = v0;
    c.awake = true;
    if (c.P.bike) {
      c.leanS = 0;                      // rolling upright, off the stand
      c.leanG.rotation.z = 0;
      camPosSm.set(c.pos.x - fx * 4.62, 1.87, c.pos.z - fz * 4.62);
      lookSm.set(c.pos.x + fx * 3.3, 1.05, c.pos.z + fz * 3.3);
    } else if (c.kind === 'truck') {
      camPosSm.set(c.pos.x - fx * 7.6, 3.15, c.pos.z - fz * 7.6);
      lookSm.set(c.pos.x + fx * 3.6, 1.7, c.pos.z + fz * 3.6);
    } else {
      camPosSm.set(c.pos.x - fx * 5.75, 2.17, c.pos.z - fz * 5.75);
      lookSm.set(c.pos.x + fx * 3.5, 1.15, c.pos.z + fz * 3.5);
    }
    player.position.set(c.pos.x, 0, c.pos.z);
    player.yaw = c.heading;
    hud.setSpeed?.(v0 * 3.6);
  }

  // ------------------------------------------------------------- debug hook
  if (typeof window !== 'undefined' && window.__SHOT_MODE__) {
    window.__cars = {
      enter: (i) => { const c = carsArr[i | 0]; if (c && !api.driving) enterCar(c); },
      exit: () => { if (api.driving) exitCar(); },
      throttle: (v) => { autoThrottle = !!v; },
      steer: (v) => { autoSteer = clamp(+v || 0, -1, 1); },
      stage: (k) => stageDrive(k),
      fire: (v) => { forceFire = !!v; },      // LMB stand-in for probes
      missiles: () => {
        const t = carsArr.find((v) => v.kind === 'truck');
        return t ? {
          ammo: t.msl.ammo,
          cd: +t.msl.cd.toFixed(2),
          reload: +t.msl.reloadT.toFixed(2),
          live: mslLive.length,
          rack: t.rackMissiles.map((m) => m.visible),
          rackYaw: +t.rackYaw.toFixed(3),
          lastImpact: mslLastImpact,
          lastKills: mslLastKills,
        } : null;
      },
      // probe helper: teleport a vehicle to a clean start line
      place: (i, x, z, heading) => {
        const c = carsArr[i | 0]; if (!c) return;
        c.pos.set(x, 0, z);
        c.heading = heading || 0;
        c.vel.set(0, 0, 0);
        c.speed = 0; c.steer = 0; c.slide = 0; c.latA = 0;
        c.group.position.set(x, 0, z);
        c.group.rotation.y = c.heading;
        refreshCollider(c);
      },
      state: () => ({
        driving: api.driving,
        active: active ? carsArr.indexOf(active) : -1,
        prompt: promptOn,
        promptTxt,
        cars: carsArr.map((c) => ({
          kind: c.kind,
          name: c.name,
          x: +c.pos.x.toFixed(2), z: +c.pos.z.toFixed(2),
          heading: +c.heading.toFixed(3), speed: +c.speed.toFixed(2),
          lean: +c.leanS.toFixed(3),
          rider: c.riderG ? c.riderG.visible : null,
          stand: c.stand ? c.stand.visible : null,
          col: [c.colBox.min.x, c.colBox.min.z, c.colBox.max.x, c.colBox.max.z].map((v) => +v.toFixed(2)),
        })),
        cam: [camera.position.x, camera.position.y, camera.position.z].map((v) => +v.toFixed(2)),
        player: [player.position.x, player.position.z].map((v) => +v.toFixed(2)),
        yaw: +player.yaw.toFixed(3),
      }),
      // world collider dump for probes (region query, skips ground/bounds)
      worldBoxes: (x0, z0, x1, z1) => {
        const out = [];
        for (const b of world.colliders) {
          if (b.max.y < 0.1 || b.min.y > 1.6) continue;
          if (b.max.x - b.min.x > 60 || b.max.z - b.min.z > 60) continue;
          if (b.max.x < x0 || b.min.x > x1 || b.max.z < z0 || b.min.z > z1) continue;
          out.push([b.min.x, b.min.z, b.max.x, b.max.z].map((v) => +v.toFixed(2)));
        }
        return out;
      },
      // parked-spot sanity: vehicle boxes vs the rest of the world colliders
      overlaps: () => {
        const out = [];
        for (const c of carsArr) {
          for (const b of world.colliders) {
            if (carsArr.some((o) => o.colBox === b)) continue;
            if (b.max.y < 0.18) continue;
            if (b.max.x - b.min.x > 60 || b.max.z - b.min.z > 60) continue; // ground/bounds
            if (c.colBox.intersectsBox(b)) {
              out.push([carsArr.indexOf(c),
                +b.min.x.toFixed(1), +b.min.z.toFixed(1), +b.max.x.toFixed(1), +b.max.z.toFixed(1)]);
            }
          }
        }
        return out;
      },
    };
  }

  return api;
}
