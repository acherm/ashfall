# ASHFALL

A fully procedural first-person shooter for the browser, built with Three.js (r185).
No external assets: every texture, model, sound, and effect is generated in code.

## Play

```
npm install
npm run dev        # then open the printed URL and click to deploy
```

WASD/ZQSD or arrow keys move · Shift sprint · RMB aim · LMB fire · R reload ·
Ctrl crouch · Space jump · **1/2/3 select rifle / pistol / knife** · V SIUU
celebration · Y pick up dropped weapon · E enter/exit vehicle · H horn

**Switch controller** (USB or Bluetooth): left stick move · right stick look ·
**ZR fire · ZL aim** · B jump · A enter/exit vehicle · **Y pick up weapon** ·
X reload · **D-pad ↑ rifle / → pistol / ← knife** · L SIUU · R horn · click a
stick to sprint/crouch · +/Start to begin. (Face buttons are read by position,
so these are the physical A/B/X/Y on the pad.) Other standard USB/Bluetooth pads
work the same; old SNES-style pads without sticks get a reduced D-pad layout.
Note: browser audio unlocks on the first real mouse click.

## City

The map is a ruined **city district** (~240×240 m): a main street spine with a
parallel avenue and cross streets forming real blocks, 30-40 buildings (2-8
storeys), plazas, a fogged skyline ring, and street furniture. **18 civilian
pedestrians** walk the sidewalks and flee from gunfire, balls, and vehicles —
they're pure ambience and can't be hit. **4 buildings are enterable**: walk in
the doorway, take the stairs to the upper floor, and shoot down at the street
through the window openings (great with the LYNX-7).

## Combat

When you're killed, a **K.I.A. screen** lets you redeploy (click / R / Enter /
gamepad A·Start) — a fresh run starting at the level you died on. Dotted around
the city are **squishy trash bins and dumpsters**: duck behind a dumpster and
enemies lose line of sight (real cover), and they wobble like rubber when you
bump or shoot them.

**Difficulty levels:** clear waves to advance levels (RECRUIT → REGULAR →
HARDENED → VETERAN → ELITE → BRUTAL → SAVAGE → NIGHTMARE). Each level makes
enemies tankier, more accurate, more aggressive, more numerous, and hit harder,
and folds in tougher archetypes — **HEAVY** juggernauts (armored, headshots
matter) from level 3+ and fast **RUSHER** glass-cannons from level 2+. Pick a
starting difficulty on the menu (or `?level=N`); the current level shows top-left.

Enemies come in dense waves (12-18 alive, up to 22) carrying different weapons —
MK4 carbine, VULCAN-9 SMG, or LYNX-7 marksman rifle — and drop them on death
(glowing pickup, press Y to swap; your old weapon stays on the ground). You also
carry a **pistol** (semi-auto sidearm) and a **combat knife** (melee) — switch
with 1/2/3. Characters (enemies, civilians) and your own first-person body use
rounded anatomical proportions with faces; you cast a shadow and see your legs
when you look down.

## Vehicles

Parked along the street, each enter with **E**:

- **Sedans** ×3 — arcade handling, handbrake drifts
- **Ferrari F40** — red supercar, top ~30 m/s
- **Porsche 911** — silver sports coupe
- **Formula 1** — open-wheel, fastest & sharpest, brakes instead of drifting
- **Naked bikes** ×2, **Motocross 450**, **Superbike** — lean into turns, tucked rider
- **Missile Truck** — 6-wheel military launcher; while driving, **LMB fires missiles**
  that arc downrange and detonate in an area blast (kills everything in the radius)

Chase camera, km/h readout, horn (**H**), and roadkill all included.

### ⚽ CR7 mode

Click "CR7 mode" on the menu (or open `/?football=1`): you kick physics-simulated
footballs (gravity, bounces, Magnus curve) instead of firing bullets, and the enemies
are Ronaldo-style footballers (home red / away white kits, number 7) who kick balls
back at you. A direct hit knocks them down — "SIUUU!" in the killfeed. No blood,
pure dodgeball. A stadium scorebug tracks YOU vs CR7 goals, and when a Ronaldo
lands a ball on you he does the full SIUU celebration (jump, 360° spin, power
stance). Screenshot scenarios: `cr7`, `cr7close`, `cr7siuu`.

## What's inside

- **Renderer** (`src/core/renderer.js`) — EffectComposer pipeline: GTAO, bloom,
  filmic color grade (teal shadows / warm highlights, S-curve, vignette, animated
  grain), SMAA, ACES tone mapping.
- **World** (`src/world/`) — ruined urban block: 12 damaged buildings, sky shader
  with sun disc, texel-snapped cascading sun shadows, FogExp2, sandbag emplacements,
  burned-out cars, powerlines, burning barrels, distant skyline. All textures are
  canvas-procedural with Sobel-derived normal maps.
- **Weapon** (`src/weapons/weapon.js`) — procedural M4-class viewmodel with red-dot
  (mathematically centered at ADS), sway/bob/sprint poses, 720 rpm full-auto,
  recoil spring, 4-stage reload animation.
- **Enemies** (`src/enemies/enemies.js`) — articulated soldiers (two camo variants,
  vertex-baked AO, kit silhouette breaks), patrol/alert/combat AI with cover use,
  burst fire, wave spawning, weighted death animations.
- **FX** (`src/fx/particles.js`) — GPU-instanced pooled particles: muzzle flash,
  tracers, surface-typed impacts, bullet-hole decals, brass, smoke. Zero per-frame
  allocation.
- **HUD** (`src/ui/hud.js`) — DOM overlay: dynamic crosshair, hit/kill markers,
  sliding compass, segmented health, killfeed, directional damage arcs.
- **Audio** (`src/audio/audio.js`) — 100% WebAudio-synthesized: layered gunshots,
  distance/pan model, foley, ambience bed.

## Dev harness

```
npm run shoot                      # headless screenshots of staged scenarios → shots/
node shoot.mjs combat soldier      # subset; PORT=x SHOTDIR=y env overrides
```

Scenarios: `street ads combat overview alley soldier fxprobe`. In-page debug hooks
(`?shot=1`): `__tick(n)`, `__fx`, `__R`, `__player`, `__weapon`, `__mkv`.
`probe-*.mjs` scripts are standalone visual-debugging probes from development.
