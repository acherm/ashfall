# ASHFALL — browser FPS in Three.js. Module contracts (STRICT)

Every module is plain JavaScript (NO TypeScript), ES modules. Import three as
`import * as THREE from 'three'` and addons as `import { X } from 'three/addons/...'`.
three version: 0.185. Target: top-tier browser visuals — think modern military FPS:
grounded palette, volumetric-feeling haze, harsh sun + soft ambient, PBR materials,
readable silhouettes. NO cartoon colors. Everything procedural (no external asset files).

The game: urban-warfare block (ruined Eastern-European-style street), player with an
assault rifle fights AI soldiers. One map, wave combat.

## Coordinate/units
Meters. +Y up. Player eye height 1.68 standing. Map roughly 120x120 centered at origin,
main street along Z axis.

## src/main.js (ALREADY WRITTEN — do not modify) wires modules exactly like this:

```js
const R       = createRenderer({ canvas });                        // core/renderer.js
const input   = createInput(canvas);                               // core/input.js
const world   = createWorld(R.scene);                              // world/map.js
const fx      = createFX({ scene: R.scene, camera: R.camera });    // fx/particles.js
const hud     = createHUD();                                       // ui/hud.js
const audio   = createAudio();                                     // audio/audio.js
const player  = createPlayer({ camera: R.camera, input, world, hud, audio });
const enemies = createEnemyManager({ scene: R.scene, world, fx, audio, hud, player });
const weapon  = createWeapon({ camera: R.camera, scene: R.scene, input, fx, audio, hud,
                               player, getTargets: () => enemies.targets,
                               applyDamage: (o,d,p,n) => enemies.applyDamage(o,d,p,n),
                               worldMeshes: () => world.raycastMeshes });
```
Per frame (dt seconds, clamped ≤ 0.05):
`player.update(dt); world.update(dt, player.position); enemies.update(dt);
 weapon.update(dt); fx.update(dt); hud.update(dt);
 audio.update(player.getEyePos(), player.yaw); R.render(dt);`

## Contracts

### core/renderer.js — `createRenderer({ canvas }) ->`
- `.renderer` WebGLRenderer (antialias false — SMAA in composer; shadows PCFSoft;
  physicallyCorrectLights defaults of r185; outputColorSpace SRGB).
- `.scene` THREE.Scene (empty; world module fills it, sets fog/background).
- `.camera` PerspectiveCamera(74, aspect, 0.05, 400).
- `.render(dt)` renders via EffectComposer: RenderPass, GTAOPass (subtle AO), 
  UnrealBloomPass (threshold≈0.9, strength≈0.35, radius≈0.6), custom ShaderPass doing
  filmic color-grade: slight desaturation, lifted blacks teal, warm highlights, vignette,
  very fine film grain (animated by time), then SMAAPass + OutputPass
  (ACESFilmicToneMapping, exposure ≈ 1.1).
- `.setFov(deg)` sets camera fov + updateProjectionMatrix (called every frame by player).
- Handles window resize itself (composer + camera aspect + pixelRatio min(devicePixelRatio,2)).
- `.quality` — read `new URLSearchParams(location.search)`; if `lowfx` param present,
  skip GTAO (CI screenshots still use full quality; lowfx is a dev escape hatch).

### core/input.js — `createInput(canvas) ->`
- `.isDown(code)` KeyboardEvent.code held.
- `.pressed(code)` true exactly once per physical press (edge-triggered, consumed).
- `.takeMouseDelta()` -> `{dx, dy}` accumulated since last call, then zeroed.
- `.fireHeld` bool (mouse button 0), `.aimHeld` bool (button 2).
- `.firePressed()` edge-triggered once per click of button 0.
- `.requestLock()` requests pointer lock on canvas; `.locked` bool kept current.
- Ignores all input when `document.pointerLockElement` is null UNLESS
  `window.__SHOT_MODE__` is true (screenshot harness has no pointer lock).
- contextmenu prevented.

### core/player.js — `createPlayer({ camera, input, world, hud, audio }) ->`
- `.position` THREE.Vector3 — FEET position. `.getEyePos()` -> Vector3 (new each call ok).
- `.yaw`, `.pitch` radians. `.velocity` Vector3. `.isGrounded`, `.isSprinting` bools.
- `.health` 0..100, `.alive` bool.
- `.update(dt)`: mouse look (sensitivity ~0.0021 rad/px, pitch clamp ±1.45), WASD move
  relative to yaw. Walk 4.4 m/s, sprint (ShiftLeft, forward only) 6.7, crouch (ControlLeft
  or KeyC toggle... use HOLD) 2.2 with eye 1.15. Acceleration ~10/s ground, ~2 air.
  Jump (Space) 4.6 m/s when grounded. Gravity 13.5.
  Collision: capsule radius 0.38 vs `world.colliders` (Box3[]): resolve horizontal by
  axis-separated push-out, vertical land on top faces. Never fall through ground y=0.
  Head bob: subtle camera bob when moving grounded (freq ~ speed, amp 0.021 walk /
  0.032 sprint, dampened when ADS ×0.3); also small roll lean into strafe (~0.9°).
  Footstep audio timed to bob cycle; `audio.land()` on landing.
  FOV: base 74, sprint +6, ADS -> weapon calls `.setAdsLevel(t)` (0..1) and player fov
  target = lerp(base(+sprint), 46, t); smooth all fov changes (lerp ~12/s) via a callback
  set by main: `.onFov = (deg) => {}` — call `this.onFov(fov)` each frame.
- `.setAdsLevel(t)`, `.adsLevel` (0..1) — also scales move speed ×(1 - 0.45t) and
  mouse sens ×(1 - 0.45t).
- `.addViewKick(pitchRad, yawRad)` — recoil impulse, recovers smoothly (spring ~ 9/s
  return, so kicks accumulate during auto fire then settle).
- `.takeDamage(amount, fromPos)` — reduce health, `hud.showDamageFrom(angle)` where angle
  is direction of attacker relative to facing, `hud.setHealth`, `audio.hurt()`. Health
  regens +12/s after 4.5s without damage (hud updated). At 0: `.alive=false`, slump camera
  (drop eye to 0.4, roll 25°) and stop accepting move input.
- Applies camera transform every update: position=eye+bob, quaternion from yaw/pitch/roll
  (order YXZ) plus view-kick offsets.

### world/textures.js — export `makeTextures() ->` object of THREE.CanvasTexture sets:
`{ asphalt, concrete, brick, plaster, metal, rust, wood, sandbag, camo, dirt }` — each is
`{ map, normalMap, roughnessMap }` (2D canvas-generated, 512px, seamless-ish, colorSpace
SRGBColorSpace on .map only). Generate a heightfield per material (noise/patterns:
brick courses with mortar lines, asphalt speckle+cracks, concrete stains/streaks, plaster
chipped patches revealing brick tone, corrugated metal ridges, sandbag weave) then derive
normalMap from height gradients (Sobel). Grime: darken lower portion (AO-ish), water
streaks. Textures must tile (wrap repeat set by consumer). Muted, desaturated palette.

### world/map.js — `createWorld(scene) ->`
- Sets `scene.fog = new THREE.FogExp2(0xb9c0c4-ish, ~0.011)` and sky: large gradient dome
  (custom shader: warm horizon haze → steel-blue zenith, sun disc + glow at sun dir),
  low sun (elevation ~18°, azimuth pleasing 3/4 from behind-left of spawn view direction
  looking down +Z... put sun at direction roughly (-0.45, 0.34, -0.83) normalized, i.e.
  ahead-left of the main view so buildings rim-light and cast long diagonal shadows).
- Lights: DirectionalLight (warm 0xffe3c0, intensity ~3.2, castShadow, 2048 map,
  ortho frustum ~55m half-extent, bias tuned no acne) whose target/position recenters on
  player each `update(dt, playerPos)` (snap to shadow-texel grid to avoid shimmer);
  HemisphereLight (sky 0x9fb4c7 / ground 0x54504a, ~0.55). Plus 2-3 accent point lights
  (e.g. burning barrel flicker orange, cool blue interior spill) — animate flicker in update.
- Geometry (ALL colliders pushed as world-space Box3 into `.colliders`; ALL visible meshes
  castShadow/receiveShadow appropriately, added to `.raycastMeshes`):
  - Asphalt main street (~14m wide) along Z from -60..60 with sidewalks + curbs (concrete),
    cracked/patched via texture. Road markings: faded dashed center line (thin emissive-less
    white strips y=0.005, roughness high, opacity worn look via vertexless simple planes).
  - 8-12 buildings lining both sides: 2-5 stories (3m/story), varied widths/depths/materials
    (brick/plaster/concrete), WINDOW GRIDS: recessed dark window planes (slightly emissive
    cool 0x0a0e14 or faintly lit warm in 2-3 windows) with concrete lintels/sills; some
    buildings damaged: top corner "collapsed" (stacked rubble boxes + exposed brick),
    scorch marks (dark decal planes). Flat parapet roofs with AC-unit boxes.
  - Ruined end of street: rubble mound + collapsed slab blocking far end (climbable low).
  - Props: sandbag emplacements (stacked rounded boxes w/ sandbag tex), concrete jersey
    barriers, burned-out car hulks (dark rusted box-composite silhouette, no wheels needed
    — melted look, matte), oil drums (some tipped), wooden pallets/crates, power poles
    with sagging wire (CatmullRom tube, thin), hanging traffic light (dark), scattered
    debris chunks, metal dumpster. A burning barrel with fx-independent built-in flame
    (small additive sprite animated in update + its flicker light).
  - Distant skyline: ring of dark low-poly building silhouettes at 150-250m (unlit dark
    blue-grey, in fog) so horizon isn't empty; 2 distant smoke columns (tall dark billboards
    with soft alpha, slow drift in update).
  - Ground clutter breaks up flatness: papers/rubble patches (small dark planes).
- `.playerSpawn` Vector3 (~(0, 0, 52), facing -Z down the street: main.js sets yaw=π).
  NOTE main.js sets player facing from spawn: expose `.playerSpawnYaw` (radians; π means
  look toward -Z).
- `.enemySpawns` Vector3[] (8+ points at windows/behind cover/down street),
  `.coverPoints` Vector3[] (12+ behind barriers/cars/sandbags).
- `.colliders` Box3[], `.raycastMeshes` (array of meshes for bullet impacts),
  `.sunDir` normalized Vector3 (pointing FROM sun TO scene), `.update(dt, playerPos)`.
- Budget: keep total meshes reasonable (merge where easy; instancing for repeated props
  like drums/crates/debris is encouraged — InstancedMesh). Target < 4ms CPU/frame.

### fx/particles.js — `createFX({ scene, camera }) ->`
All effects pooled & cheap. Additive where hot. `.update(dt)` ages everything.
- `.muzzleFlash(pos, dir)` — 2-3 frame star/disc additive sprite + brief PointLight
  (pooled, warm 0xffc36a, decay fast) + tiny smoke wisp.
- `.tracer(from, to)` — bright thin stretched quad/line, fades in ~70ms, slight glow color
  0xffd9a0.
- `.impact(point, normal, surface)` — surface 'concrete'|'metal'|'dirt'|'flesh':
  spark burst (metal), dust puff billboard + chips (concrete/dirt), red mist (flesh).
  Leaves small dark bullet-hole decal (circle sprite, lifetime ~20s, max 60 pooled) on
  non-flesh.
- `.casing(pos, rightDir)` — small brass box tumbling with gravity, bounce once, fade.
- `.smokeColumn(pos)` — persistent slow smoke for scene dressing.
- `.explosionAt(pos)` optional small (unused ok).
- `.debris(point, normal)` — a few gravity chunks.
Muzzle light must not exceed ~40 intensity or bloom blows out.

### enemies/enemies.js — `createEnemyManager({ scene, world, fx, audio, hud, player }) ->`
- Soldier model: procedural articulated humanoid ~1.8m — NOT capsule blobs. Build from
  boxes/cylinders with proper proportions: helmet (rounded), head w/ balaclava-dark face,
  torso with plate-carrier bulk (slightly different tone + pouches boxes), upper/lower
  arms, hands holding a simple dark rifle prop across chest, upper/lower legs, boots.
  Camo material from textures (use makeTextures().camo) + dark webbing. Two color
  variants. All parts under one Group with named pivots for animation.
- Animation (procedural): walk/run leg+arm swing, aim pose (rifle raised toward player),
  hit flinch, death: ragdoll-ish fall (tip over with joint slump, small bounce) then stays
  as corpse 15s, sinks away.
- AI states: patrol (between coverPoints), alert (heard shot ≤ 35m or LOS ≤ 45m within
  ~100° cone), combat: advance cover-to-cover toward player, peek & fire 3-5 round bursts
  (spread grows with distance; each round: fx.tracer from muzzle, fx.muzzleFlash,
  audio.enemyGunshot(pos); hit chance ~18%/round scaled by player sprint/ADS/crouch and
  distance; on hit player.takeDamage(9±3, enemyPos)). Reload pauses 2.2s. Strafe
  occasionally. LOS via raycast against world.raycastMeshes.
- `.targets` — flat array of hittable body-part meshes; each has
  `.userData.enemy` (ref) and `.userData.part` ('head'|'torso'|'limb').
- `.applyDamage(mesh, dmg, point, normal)` -> `{ killed, headshot }` or null if not enemy
  mesh. Head ×2.2 damage. On damage: fx.impact(point, normal, 'flesh'), flinch. On kill:
  death anim, `hud.killfeed('Hostile down' … vary)`, `hud.hitmarker(true)` handled by
  weapon (NOT here), audio handled by weapon hitConfirm; here play a body-fall thud via
  audio.bodyFall?.() if exists (optional chain).
- `.spawnWave(n)` spawns n at enemySpawns far from player; auto-called: keep 4-6 alive,
  new wave when cleared (escalate +1 each wave, cap 8). Kill count -> `hud.setScore(k)`.
- `.update(dt)` runs AI. Keep raycasts ≤ ~2/enemy/frame.

### weapons/weapon.js — `createWeapon({ camera, scene, input, fx, audio, hud, player, getTargets, applyDamage, worldMeshes }) ->`
- Viewmodel: procedural modern assault rifle (M4-class silhouette): receiver w/ picatinny
  rail (notched box strip), 14" handguard with M-LOK slots (dark), barrel + muzzle device,
  red-dot sight: torus housing + INNER GLOWING RED DOT (small emissive sprite visible only
  near-ADS), telescoping stock, pistol grip, curved magazine, charging handle, folded
  front sight. Materials: near-black metal (roughness ~.45, slight anisotropic feel via
  subtle roughnessMap), FDE polymer furniture option — pick all-black w/ worn edges
  (edge-lightening via texture). Two-tone + worn look. Gloved hands NOT required (rifle
  only is fine, framed so absence isn't obvious: stock toward bottom-right off-screen).
- Attach group to camera. Hip pose: right-lowered classic FPS framing (pos ≈ (0.16,-0.155,-0.34),
  slight inward yaw). ADS pose: sight centered on screen axis, pos ≈ (0,-0.0525,-0.22)
  tune so red dot sits at crosshair; lerp pose/pos with adsLevel (smooth ~14/s), tell
  player via `player.setAdsLevel(t)`; `hud.setADS(t>0.5)`.
- Sway: viewmodel lags mouse (rotational drag, spring back), move bob synced to player
  motion (use player.velocity magnitude & grounded), sprint pose: rifle angled up-left
  relaxed (lerp when player.isSprinting && !ads), jump/land dip.
- Fire: full-auto 720rpm while `input.fireHeld` && !sprinting && alive && mag>0.
  Raycast from camera center (spread: hip ~1.4°, ads 0.12°, +bloom 0.35°/shot decaying):
  first vs getTargets() then worldMeshes() — nearest hit wins. On enemy hit:
  applyDamage(mesh, 26 base, point, normal) → hud.hitmarker(res.killed),
  audio.hitConfirm(). On world hit: fx.impact(point, normal, guessSurface(mesh)) — mesh
  .userData.surface if set else 'concrete'. Always: fx.muzzleFlash at muzzle world pos,
  fx.tracer(muzzle→hit or 200m), fx.casing, audio.gunshot(), recoil:
  player.addViewKick(~0.0072 + rand, lateral rand ±0.0028) (ADS ×0.55), viewmodel kick
  back+up rotational, hud.setCrosshairSpread(px), muzzle flash light. Mag 30, reserve 150.
  Reload: KeyR or auto on empty w/ fireHeld release; 2.1s anim (mag-drop tilt sequence:
  tilt right+down, sleight down-up, back), audio.reload(), hud.setAmmo throughout.
  Dry fire click on empty press: audio.dryFire().
- muzzle world position: keep a small Object3D at barrel tip, getWorldPosition each shot.
- `.update(dt)` drives all animation; `.viewmodel` the group.
- Weapon must look correct at 74 fov WITHOUT separate-camera trick (keep simple; near
  plane 0.05 avoids clipping; scale model so it never clips walls badly: also lerp the
  viewmodel slightly back when a wall is < 0.5m ahead — raycast forward cheap 1/frame).

### ui/hud.js — `createHUD() ->` (DOM inside `#hud` div; it exists in index.html)
AAA military minimal style: 'Rajdhani'?? NO webfonts (offline) — use system stack
`"Helvetica Neue", Arial` with letter-spacing; thin weights, white 88% opacity, subtle
text-shadow, elements fade when idle. All positioned via CSS (inject a <style> tag).
- Crosshair: center, 4 thin ticks + dot, gap = spread px (`.setCrosshairSpread(px)`
  eases back), hidden when ADS (`.setADS(bool)`), expands on fire.
- Hitmarker: 4 diagonal ticks flash 120ms; kill variant red + slightly larger + tiny
  scale pop. `.hitmarker(isKill)`.
- Bottom-right: ammo `30 | 150` big mono-ish digits (mag bold 28px, reserve dim), weapon
  name "MK4 CARBINE" small caps above. `.setAmmo(mag, res)`; low-mag (≤7) turns mag red +
  pulse.
- Bottom-left: health as slim segmented bar (10 segments) + numeric; damage flash;
  regen shimmer. `.setHealth(pct)`.
- Top-center: compass strip (N NE E … ticks sliding, bearing readout) `.setCompassYaw(rad)`.
- Top-left: objective line "ELIMINATE HOSTILE FORCES" + wave/kills `.setScore(k)`,
  `.setObjective(txt)`.
- Right-mid: killfeed `.killfeed(text)` — rows fade after 4s, max 5.
- Damage: `.showDamageFrom(angleRad)` — red directional arc ring segment at screen center
  edge pointing to threat, fades 1s; plus red vignette pulse scaled by missing health
  (persistent < 35 hp heartbeat pulse). Use a full-screen radial-gradient div.
- `.update(dt)` for eases/fades. Everything pointer-events:none.
- Also a sprint indicator? No. Keep clean. `.setSprint(bool)` may slightly tilt/hide
  crosshair (accept and use for crosshair fade).

### audio/audio.js — `createAudio() ->` — 100% WebAudio-synthesized, no files.
Master: compressor → destination; SFX bus + ambience bus. `.unlock()` resumes context on
first user gesture (main calls it).
- `.gunshot()` — layered: 4ms click transient + shaped noise burst (bandpass sweep
  3k→400Hz, 90ms) + low thump (55Hz sine pitch-drop 120ms) + tight slap echo (2 taps).
  Subtle random detune per shot. Punchy, not clippy (peak ~ -6dB).
- `.enemyGunshot(worldPos)` — same family, more muffled lowpass w/ distance, stereo pan
  from listener yaw (`.update(eyePos, yaw)` stores listener), delay-by-distance skip.
- `.reload()` — 3-stage clicks/slides (noise ticks + resonant filter), `.dryFire()` click.
- `.footstep()` — short filtered noise tap, random pitch, alternate L/R slight;
  `.land()` heavier; `.hurt()` low whoomp + slight ring; `.hitConfirm()` crisp tick
  (2.4kHz, 30ms, slight pitch-up for satisfaction); `.ricochet(pos)` whizz (sine gliss
  down + noise), panned.
- `.ambience()` — start once: low wind (filtered noise, slow LFO), distant rumble every
  8-20s (low noise swell), sparse distant gunfire pops (very quiet, random 10-30s),
  muffled city tone. Keep -28dB-ish, it's a bed.
- `.update(eyePos, yaw)` — store for panning (equal-power pan from relative angle).
- `.bodyFall()` soft thud. All methods no-throw if context suspended.

## Screenshot/shot mode (main.js implements — for the record)
`?shot=1&scenario=NAME` → no menu, no pointer lock needed, `window.__SHOT_MODE__=true`,
deterministic staging, after 40 rendered frames sets `window.__shotReady=true`.
Scenarios: street (POV at spawn hip), ads (aiming at enemy mid-street), combat (3 enemies
engaging, muzzle flash moment, tracers), overview (high 3/4 aerial, viewmodel hidden),
alley (looking at building detail + props up close).

## Style bible (ALL modules)
Palette: concrete greys, dust tan, olive drab, gunmetal; sun warm gold, sky steel.
Nothing saturated except muzzle flash / red dot / hitmarker red. Fog is atmosphere: use it.
Contrast comes from lighting (sun vs shadow), not from albedo. Roughness high everywhere
except glass/metal wear. NO stock three.js look: no default cube colors, no pure #fff
lights at intensity 1, no unfogged horizon. If it would look at home in a 2015 asset flip,
redo it.

## FOOTBALL MODE — "CR7 MODE" (addendum, contracts STRICT)

Activated when URL has `?football=1`. main.js sets `window.__FOOTBALL__ = true` BEFORE
creating any module; modules read that global at construction time. Normal mode must be
100% unchanged. No blood anywhere in this mode — comedic dodgeball tone.

### src/fx/footballs.js — `createFootballs({ scene, world }) ->`
- `.kick(from: Vector3, dir: Vector3 normalized, speed: m/s, curve = 0)` — launch a
  pooled football (radius 0.11, procedural white+black pentagon panel texture,
  castShadow). Physics: gravity 9.8, restitution ~0.55 vs ground and world.colliders
  (sphere-vs-AABB, push out + reflect), rolling friction, angular velocity/visual spin,
  optional slight curve (Magnus-ish lateral accel). Sleeps when slow, fades+recycles
  after ~7s. Pool 16, allocation-free per frame.
- `.setEnemyProvider(fn)` — fn() returns array of `{ ref, pos (feet Vector3), radius,
  height }` capsules to test hits against (only balls kicked by the PLAYER hit enemies).
- `.setPlayerProvider(fn)` — fn() returns `{ pos (feet), radius, height }` (only balls
  kicked by ENEMIES hit the player).
- `.onEnemyHit = (ref, point, ballVel) => {}` fired once per enemy hit (ball bounces off).
- `.onPlayerHit = (fromPos) => {}` fired once when an enemy ball reaches the player.
- `.update(dt)`, `.count` live balls.
- Owner tag per ball: kicks from weapon are 'player', from enemies 'enemy' —
  `.kick(...)` returns the ball; enemies module calls `.kickAs('enemy', ...)` variant OR
  `.kick(from, dir, speed, curve, owner='player')` 5th arg. Use the 5th-arg form.

### weapon.js football branch (construction-time: if window.__FOOTBALL__)
- Rifle viewmodel hidden entirely. Instead: held-football viewmodel — the ball resting
  low-center-right (like carried in hand), subtle bob/sway/breathing reusing the pose
  system where practical. LMB = kick: 0.6s cooldown; ball launches from just below
  camera center toward the crosshair ray at ~24 m/s (+1.2 m/s vertical bias, slight
  random curve); viewmodel ball pops away then scales back in during cooldown (resupply).
  ADS (RMB) = fov -8 zoom only, no sight. No muzzle flash, no tracer, no casing, no
  raycast damage, no reload, no dry fire. Ammo HUD: `hud.setAmmo('∞'-mode)` — call
  `hud.setBallMode?.(true)` once (hud shows "BALLON  ∞" instead of digits; hud.js change
  is part of this work package). Audio: `audio.kick?.()` on kick.
- Wiring hooks (main.js provides): `weapon.setFootballs(fb)` post-construction; weapon
  calls fb.kick(...) with owner 'player'.

### enemies.js football branch (construction-time: if window.__FOOTBALL__)
- Same rig/animation/AI skeleton, reskinned as Cristiano-Ronaldo-style footballers
  (playful parody): athletic build, dark slicked hair (NO helmet), Portugal-red jersey
  with white collar/trim and a white canvas-drawn "7" on the back, white shorts stripe
  or red shorts + red socks, bright boots, skin-tone arms; NO plate carrier, NO pouches,
  NO rifle. Both former camo variants become kit variants (home red / white away with
  red trim "7"). Score label + killfeed handled here as in normal mode but with
  football lines: 'SIUUU!', 'GOOOAL!', 'CR7 down — SIUUU!', varied.
- Attack behavior: instead of burst gunfire — kicks a football at the player: wind-up
  pose (leg swing if cheap, else torso lean), then `fb.kick(chestPos, leadDir, ~18,
  smallCurve, 'enemy')`, cooldown 2.2-3.5s, only with LOS ≤ 40m. No muzzle flash, no
  tracer, no enemyGunshot — use `audio.kickAt?.(pos)`. Damage resolution comes from
  fb.onPlayerHit (main wires player.takeDamage(6, fromPos)) — remove the probabilistic
  instant-hit path in this mode.
- New API (both modes, used by football wiring): `.hitVolumes()` -> array of
  `{ ref, pos, radius: 0.34, height: 1.8 }` for living enemies;
  `.knockdown(ref, point)` -> comedic no-blood fall (reuse death anim), counts as a
  kill/goal (score + killfeed), corpse recycles as usual. Returns true if it landed.
- `.setFootballs(fb)` post-construction setter (main.js calls it).

### hud.js addition
- `.setBallMode(on)` — when on: weapon block reads "BALLON" + "∞" (mag digits replaced),
  low-ammo pulse disabled. Keep style identical otherwise.

### audio.js additions
- `.kick()` — punchy short low thump + tiny whoosh (ball strike); `.kickAt(worldPos)`
  same, panned/attenuated via listener; `.bounce(worldPos, strength 0..1)` — soft thud,
  used by footballs.js on bounces (guard availability with optional chaining).

### main.js wiring (already planned, for the record)
- Parses `football` param → window.__FOOTBALL__ before module creation; creates
  footballs after world; wires providers + callbacks (onEnemyHit → enemies.knockdown +
  hud.hitmarker(true) + audio.hitConfirm; onPlayerHit → player.takeDamage(6, fromPos));
  menu gains a second button toggling the mode via page reload; objective text
  "SCORE GOALS ON THE RONALDOS"; scenarios `cr7` and `cr7close` (shoot.mjs appends
  &football=1 for scenarios starting with 'cr7').

## ARSENAL & POPULATION (addendum 2, contracts STRICT)

### Enemy weapon variety + drops (src/enemies/enemies.js)
- Normal mode: each soldier spawns with a weapon TYPE: 'mk4' | 'smg' | 'dmr' (weighted
  50/30/20). Visually distinct rifle props (smg: stubby + big suppressor; dmr: long
  barrel + scope box). AI tuning per type: smg = shorter bursts more often, closer
  engage; dmr = single shots, slower, more damage per hit.
- On death (normal mode only): drop a pickup at the corpse — small weapon prop lying
  on the ground + subtle slow pulse glow, exposed in `.drops` array:
  `{ type, pos: Vector3, take() }` — take() removes it (mesh + entry). Max 6 drops
  alive (oldest fades). Football mode: no drops.
- Waves: keep 6-8 alive (was 4-6), escalate +1 per wave, cap 12. Use all enemySpawns.
  A third visual variant per mode (normal: dark-urban camo; football: Portugal teal
  third-kit) so crowds read varied.

### Player weapon pickup (src/weapons/weapon.js)
- Weapon definitions table: mk4 (current), smg 'VULCAN-9' (950rpm, dmg 17, spread
  hip 1.9°/ads 0.3°, mag 36/180), dmr 'LYNX-7' (semi-auto: one shot per click,
  dmg 55, spread 0.05° ads / 0.9° hip, mag 12/48, heavier recoil). Viewmodel built
  per-type by parameterizing the existing builder (barrel length, handguard, mag
  shape, optic; smg gets suppressor, dmr gets a scope housing — reuse materials).
- Near a drop (< 2.2m): hud.setPrompt?.('Y — PICK UP <NAME>'); KeyY swaps: current
  weapon becomes a drop at the same spot (enemies.addDrop?.(type, pos) — implement
  in enemies.js as part of the drops system), new weapon equips with its own
  ammo (fresh mag + half reserve), hud.setWeaponName?.(name) — add that hud method
  (weapon block name line updates; keep style).
- main.js passes `getDrops: () => enemies.drops ?? []` and weapon polls proximity
  (cheap, 1/frame distance check). Pickup disabled while driving or in football mode.

## CITY, MOTORCYCLES & CIVILIANS (addendum 3, contracts STRICT)

### City expansion (src/world/map.js + textures.js)
- Grow the map to ~240x240: keep the existing main street along Z EXACTLY as the
  spine (same playerSpawn (0,0,52), same view down -Z, same landmark props near it),
  add a parallel avenue around x≈±38 and 2-3 cross streets (z≈±22, ±48) forming
  real blocks; alleys welcome. 30-40 buildings total, height variety 2-8 stories,
  a couple of squares/plazas or parking lots; densify props (streetlight poles with
  cool lamps for variety, bus stop, kiosks, more barriers/wrecks) via InstancedMesh
  families. Extend ground/sidewalks/markings to the new streets. Bigger skyline ring
  pushed further out. Fog may drop slightly (0.011 → ~0.009) so cross streets read.
- MUST keep clear (parked vehicles live there): (2.45, 40) (-4.95, 16) (4.75, -28)
  on the main street, plus keep lanes drivable (≥6m clear width) on all new streets.
- Contracts unchanged: colliders/raycastMeshes/playerSpawn/playerSpawnYaw/sunDir/
  update(dt, playerPos). GROW: enemySpawns to 20+ (spread across blocks),
  coverPoints to 30+. NEW: `.walkPaths` — 4+ arrays of Vector3 waypoints forming
  sidewalk loops (y=0, ≥6 points each, on walkable sidewalk, collision-free) for
  civilian pedestrians.
- Perf budget: measured — world.update + render of the empty city must stay within
  ~1.5x the current street scene (verify with a headless timing probe).

### Motorcycles (src/vehicles/cars.js)
- Add 2 parked motorcycles (kind 'moto') alongside the 3 sedans: procedural naked/
  standard bike (~2.1m long): frame tubes, tank, seat, twin cylinder wheels with
  forks, handlebar, exhaust pipes, small headlamp; kickstand lean ~12° when parked.
- Riding: same E flow ('E — RIDE'); physics variant: top 26 m/s, accel 11, agile
  speed-scaled steering, VISUAL LEAN into turns (roll up to ~28° with lateral
  accel), narrower footprint (HX~0.35), light handbrake slide. A simple dark rider
  mannequin (helmet, torso, arms to bars, legs to pegs) appears on the bike only
  while riding (the player has no body otherwise). Chase cam closer (~4.2m back,
  1.8m up). Crash >7 m/s: dismount NOT required — keep simple, same crash audio +
  bigger shake. Horn = higher-pitch beep variant (audio.horn with a pitch arg or
  audio.hornBike?. — optional chain).
- `stageDrive(kind)` — existing default 'car' behavior unchanged; 'moto' stages the
  bike rolling ~11 m/s down the main street for the 'moto' screenshot scenario
  (main.js wires it).

### Civilians (NEW src/world/civilians.js)
- `createCivilians({ scene, world, player }) -> { update(dt), list }`
- 12-18 pedestrians on sidewalks: procedural civilian rig reusing the humanoid
  proportions (NO military/football gear): jackets/hoodies/coats in muted city
  colors (grey/navy/brown/olive), varied heights ±5%, simple walk cycle, occasional
  idle stops (phone-look pose, window-look).
- Behavior: follow world.walkPaths loops (fallback if absent: two rectangle loops
  along the main-street sidewalks x≈±8.5, z -50..50); FLEE when: gunfire/balls land
  within 18m, a vehicle comes within 6m at speed, or an enemy fires nearby — run
  (5.5 m/s) away from danger to the nearest path point ≥25m away, then resume.
  Near-miss by a vehicle: stumble sidestep animation, never ragdoll/death — they
  are NOT hittable: not in enemies.targets, not raycast targets, balls pass through.
  Player bullets: no impact (excluded from raycast lists) — civilians are ambience.
- Danger signaling: poll-based, zero coupling — read positions of fast vehicles via
  player.position when driving (player tethers to the vehicle) and listen to a tiny
  global event bus: `window.__cityNoise = { pos: Vector3|null, t: 0 }` that weapon/
  footballs COULD set — do NOT modify other modules: instead detect gunfire via
  hud-free heuristic: track player shooting through... keep it SIMPLE: flee when
  (a) distance to player < 14m AND player is in combat (any enemy within 30m of
  player), or (b) a vehicle (player driving) within 8m, or (c) any enemy within 12m
  of the civilian. That needs enemy positions: accept an optional
  `getThreats: () => Vector3[]` param (main wires enemies.hitVolumes → positions).
- Perf: shared geometries/materials, ≤2 draw-call-heavy features, no per-frame
  allocation; stagger path/flee decisions.
- Both modes. Killfeed/score untouched.

### main.js wiring (orchestrator)
- `const civ = createCivilians({ scene, world, player, getThreats })` + update each
  tick; scenario 'moto' → cars.stageDrive?.('moto'); overview camera may be raised
  by the city agent (only those numbers). shoot.mjs gains 'moto'.
