// ============================================================================
// ASHFALL — ui/hud.js
// AAA-military minimal HUD. Pure DOM + injected CSS. No webfonts, no assets.
// Contract: createHUD() -> { setCrosshairSpread, setADS, setSprint, hitmarker,
//   setAmmo, setWeaponName, setMelee, setBallMode, setScoreboard, setHealth,
//   setCompassYaw, setScore, setObjective, setLevel, levelBanner, killfeed,
//   showDamageFrom, setPrompt, setSpeed, update }
// ============================================================================

export function createHUD() {
  const host = document.getElementById('hud') || (() => {
    const d = document.createElement('div');
    d.id = 'hud';
    document.body.appendChild(d);
    return d;
  })();

  // -------------------------------------------------------------- constants
  const SPREAD_BASE = 5;        // px, crosshair resting gap
  const PPD = 2.3;              // compass pixels per degree
  const COMP_W = 400;           // compass viewport width px
  const KF_MAX = 5;
  const ARC_POOL = 6;

  // ------------------------------------------------------------------ style
  const style = document.createElement('style');
  style.textContent = `
#hud, #hud * { box-sizing: border-box; margin: 0; padding: 0; }
.hf-root {
  position: absolute; inset: 0; overflow: hidden;
  pointer-events: none; user-select: none;
  font-family: "Helvetica Neue", "Segoe UI", Arial, sans-serif;
  color: rgba(255,255,255,0.88);
  text-shadow: 0 1px 3px rgba(0,0,0,0.85);
  -webkit-font-smoothing: antialiased;
}
.hf-fade { transition: opacity 1.1s ease; }
.hf-root.idle .hf-fade { opacity: 0.45; }

/* ---------------------------------------------------------- damage layers */
.hf-vig {
  position: absolute; inset: -2%; opacity: 0; will-change: opacity;
  background: radial-gradient(ellipse at 50% 50%,
    rgba(0,0,0,0) 38%, rgba(118,16,8,0.40) 70%,
    rgba(94,10,4,0.74) 90%, rgba(66,6,2,0.88) 100%);
}
.hf-arcs { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.hf-arc-rot { position: absolute; left: 0; top: 0; }
.hf-arc {
  position: absolute; left: -178px; top: -178px; width: 356px; height: 356px;
  opacity: 0; border-radius: 50%; filter: blur(0.4px);
  background: conic-gradient(from -30deg at 50% 50%,
    rgba(255,58,40,0) 0deg, rgba(255,58,40,0.12) 12deg,
    rgba(255,66,46,0.88) 25deg, rgba(255,66,46,0.88) 35deg,
    rgba(255,58,40,0.12) 48deg, rgba(255,58,40,0) 60deg,
    rgba(0,0,0,0) 60deg 360deg);
  -webkit-mask-image: radial-gradient(closest-side,
    transparent 59%, #000 70%, #000 80%, transparent 89%);
  mask-image: radial-gradient(closest-side,
    transparent 59%, #000 70%, #000 80%, transparent 89%);
}
.hf-arc.on { animation: hfArc 1s ease-out forwards; }
@keyframes hfArc {
  0%   { opacity: 0.95; transform: scale(0.90); }
  22%  { opacity: 0.88; transform: scale(1.00); }
  100% { opacity: 0;    transform: scale(1.06); }
}

/* --------------------------------------------------------------- crosshair */
.hf-ch {
  position: absolute; left: 50%; top: 50%; width: 0; height: 0;
  --gap: 5px; opacity: 0.95;
  transition: opacity 0.14s ease, transform 0.18s ease;
}
.hf-root.ads .hf-ch    { opacity: 0; transform: scale(0.8); }
.hf-root.sprint .hf-ch { opacity: 0.10; transform: rotate(9deg) scale(0.9); }
.hf-ch-dot {
  position: absolute; left: -1px; top: -1px; width: 2px; height: 2px;
  background: rgba(255,255,255,0.92);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.6);
}
.hf-ch-t {
  position: absolute; background: rgba(255,255,255,0.92);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.6);
}
.hf-ch-tt { left: -1px; top: calc(-1 * var(--gap) - 7px); width: 2px; height: 7px; }
.hf-ch-tb { left: -1px; top: var(--gap);                   width: 2px; height: 7px; }
.hf-ch-tl { top: -1px; left: calc(-1 * var(--gap) - 7px);  width: 7px; height: 2px; }
.hf-ch-tr { top: -1px; left: var(--gap);                   width: 7px; height: 2px; }

/* --------------------------------------------------------------- hitmarker */
.hf-hm {
  position: absolute; left: 50%; top: 50%; width: 0; height: 0;
  opacity: 0; color: rgba(255,255,255,0.95); --hgap: 5px; --hlen: 9px;
  filter: drop-shadow(0 0 2px rgba(0,0,0,0.7));
}
.hf-hm.kill { color: #ff4636; --hgap: 7px; --hlen: 11px;
  filter: drop-shadow(0 0 3px rgba(255,50,30,0.45)); }
.hf-hm span {
  position: absolute; left: -1px; top: calc(-1 * var(--hgap) - var(--hlen));
  width: 2px; height: var(--hlen); background: currentColor; border-radius: 1px;
  transform-origin: 1px calc(var(--hgap) + var(--hlen));
}
.hf-hm span:nth-child(1) { transform: rotate(45deg); }
.hf-hm span:nth-child(2) { transform: rotate(135deg); }
.hf-hm span:nth-child(3) { transform: rotate(225deg); }
.hf-hm span:nth-child(4) { transform: rotate(315deg); }
.hf-hm.show { animation: hfHm 0.12s linear forwards; }
.hf-hm.kill.show { animation: hfHmK 0.28s cubic-bezier(0.17,0.89,0.32,1.2) forwards; }
@keyframes hfHm  { 0% { opacity: 0.95; } 70% { opacity: 0.85; } 100% { opacity: 0; } }
@keyframes hfHmK {
  0%   { opacity: 1;   transform: scale(1.32); }
  30%  { opacity: 1;   transform: scale(1); }
  72%  { opacity: 0.9; transform: scale(1); }
  100% { opacity: 0;   transform: scale(1); }
}

/* -------------------------------------------------------------------- ammo */
.hf-ammo {
  position: absolute; right: 36px; bottom: 32px; text-align: right;
  text-shadow: 0 1px 3px rgba(0,0,0,0.85), 0 0 18px rgba(0,0,0,0.35);
}
.hf-ammo-name {
  font-size: 10.5px; font-weight: 600; letter-spacing: 3.5px;
  color: rgba(255,255,255,0.5); margin-bottom: 5px;
}
.hf-nade {
  position: absolute; right: 36px; bottom: 116px; text-align: right;
  display: flex; align-items: baseline; gap: 9px; justify-content: flex-end;
  text-shadow: 0 1px 3px rgba(0,0,0,0.85);
}
.hf-nade-lab { font-size: 10px; font-weight: 600; letter-spacing: 3px; color: rgba(255,255,255,0.5); }
.hf-nade-n { font-size: 22px; font-weight: 700; color: rgba(255,255,255,0.9); min-width: 16px; }
.hf-nade.empty .hf-nade-n { color: #c9564a; }
.hf-ammo-rule {
  height: 1px; margin: 0 0 6px auto; width: 118px;
  background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.22));
}
.hf-ammo-row {
  display: flex; align-items: baseline; justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}
.hf-ammo-mag {
  font-size: 31px; font-weight: 600; letter-spacing: 1px; line-height: 1;
  color: rgba(255,255,255,0.92); transition: color 0.15s ease;
}
.hf-ammo-mag.low { color: #ff5240; animation: hfPulse 0.85s ease-in-out infinite; }
.hf-ammo-sep {
  align-self: center; width: 1px; height: 20px; margin: 0 9px;
  background: rgba(255,255,255,0.28); transform: skewX(-14deg) translateY(2px);
}
.hf-ammo-res {
  font-size: 14px; font-weight: 400; letter-spacing: 1px;
  color: rgba(255,255,255,0.45);
}
.hf-ammo-mode {
  margin-top: 5px; font-size: 9px; font-weight: 500; letter-spacing: 2.5px;
  color: rgba(255,255,255,0.65);
}
@keyframes hfPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.42; } }

/* ------------------------------------------------------------------ health */
.hf-hp {
  position: absolute; left: 36px; bottom: 32px;
  display: flex; align-items: flex-end; gap: 12px;
  text-shadow: 0 1px 3px rgba(0,0,0,0.85), 0 0 18px rgba(0,0,0,0.35);
}
.hf-hp-num {
  font-size: 26px; font-weight: 300; letter-spacing: 1px; line-height: 0.9;
  min-width: 42px; text-align: right; color: rgba(255,255,255,0.9);
  font-variant-numeric: tabular-nums; transition: color 0.25s ease;
}
.hf-hp.low .hf-hp-num { color: #ff6450; }
.hf-hp-lab {
  font-size: 9px; font-weight: 600; letter-spacing: 3px;
  color: rgba(255,255,255,0.35); margin-bottom: 5px;
}
.hf-hp-bar { display: flex; gap: 2px; width: 216px; height: 4px; }
.hf-hp-seg {
  flex: 1; background: rgba(255,255,255,0.10); border-radius: 1px;
  overflow: hidden; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.3);
}
.hf-hp-fill {
  height: 100%; width: 100%; background: rgba(236,240,242,0.88);
  transition: background-color 0.18s ease;
}
.hf-hp.low .hf-hp-fill { background: #f0806c; }
.hf-hp-bar.dmg { filter: drop-shadow(0 0 6px rgba(255,60,40,0.55)); }
.hf-hp-bar.dmg .hf-hp-fill { background: #ff8b74; }
.hf-hp-bar.regen .hf-hp-fill {
  background-image: linear-gradient(105deg,
    rgba(255,255,255,0) 32%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0) 68%);
  background-size: 340% 100%;
  animation: hfShimmer 1.05s linear infinite;
}
@keyframes hfShimmer {
  0%   { background-position: 130% 0; }
  100% { background-position: -130% 0; }
}

/* ----------------------------------------------------------------- compass */
.hf-comp {
  position: absolute; top: 24px; left: 50%; transform: translateX(-50%);
  width: ${COMP_W}px; text-align: center;
  text-shadow: 0 1px 3px rgba(0,0,0,0.85);
}
.hf-comp-wrap {
  position: relative; height: 30px; overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
}
.hf-comp-strip { position: absolute; top: 0; left: 0; height: 100%; will-change: transform; }
.hf-tick {
  position: absolute; bottom: 2px; width: 1px;
  background: rgba(255,255,255,0.32); transform: translateX(-0.5px);
}
.hf-tick.min { height: 5px; }
.hf-tick.mid { height: 8px; background: rgba(255,255,255,0.5); }
.hf-lab {
  position: absolute; bottom: 11px; transform: translateX(-50%);
  font-size: 12px; font-weight: 500; letter-spacing: 1px;
  color: rgba(255,255,255,0.82); white-space: nowrap;
}
.hf-lab.card { font-size: 13px; font-weight: 600; }
.hf-lab.north { color: #dcbd85; }
.hf-lab.deg { font-size: 8.5px; bottom: 12px; font-weight: 500; color: rgba(255,255,255,0.65); }
.hf-comp-caret {
  position: absolute; left: 50%; bottom: 0; width: 1.5px; height: 10px;
  transform: translateX(-50%); background: rgba(255,255,255,0.9);
  box-shadow: 0 0 4px rgba(0,0,0,0.6);
}
.hf-comp-bearing {
  margin-top: 3px; font-size: 11px; font-weight: 500; letter-spacing: 3px;
  color: rgba(255,255,255,0.62); font-variant-numeric: tabular-nums;
}

/* ------------------------------------------------------- stadium scoreboard */
.hf-sb {
  position: absolute; top: 78px; left: 50%; transform: translateX(-50%);
  display: none; align-items: center; gap: 10px;
  padding: 7px 14px 8px;
  background: linear-gradient(180deg, rgba(13,15,18,0.78), rgba(5,7,9,0.70));
  border: 1px solid rgba(255,255,255,0.13); border-radius: 5px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05);
  text-shadow: none;
}
.hf-sb.on { display: flex; }
.hf-sb-side { display: flex; flex-direction: column; gap: 4px; min-width: 62px; }
.hf-sb-line { display: flex; align-items: center; justify-content: space-between; gap: 9px; }
.hf-sb-name {
  font-size: 9px; font-weight: 700; letter-spacing: 2.5px;
  color: rgba(255,255,255,0.62); text-shadow: 0 1px 2px rgba(0,0,0,0.8);
}
.hf-sb-num {
  display: inline-block; min-width: 14px; text-align: center;
  font-size: 22px; font-weight: 600; line-height: 1; letter-spacing: 0.5px;
  font-variant-numeric: tabular-nums;
  color: #ffc46a;
  text-shadow: 0 0 5px rgba(255,178,64,0.55), 0 0 14px rgba(255,150,40,0.30);
}
.hf-sb-sep {
  font-size: 14px; font-weight: 400; margin-top: -5px;
  color: rgba(255,255,255,0.5);
}
.hf-sb-bar { height: 2px; border-radius: 1px; }
.hf-sb-side.you .hf-sb-bar { background: rgba(96,156,255,0.85); box-shadow: 0 0 6px rgba(96,156,255,0.45); }
.hf-sb-side.cr7 .hf-sb-bar { background: rgba(255,84,62,0.85); box-shadow: 0 0 6px rgba(255,84,62,0.45); }
.hf-sb-num.pop { animation: hfSbPop 0.35s cubic-bezier(0.18,0.9,0.28,1.18); }
@keyframes hfSbPop {
  0%   { transform: scale(1.45); color: #ffe8c2;
         text-shadow: 0 0 9px rgba(255,206,110,0.95), 0 0 24px rgba(255,170,50,0.65); }
  55%  { transform: scale(1.05); }
  100% { transform: scale(1); }
}

/* --------------------------------------------------------------- objective */
.hf-obj {
  position: absolute; top: 26px; left: 36px; display: flex; gap: 11px;
  z-index: 0;
  text-shadow: 0 1px 3px rgba(0,0,0,0.85), 0 0 18px rgba(0,0,0,0.3);
}
.hf-obj::before {
  content: ''; position: absolute; z-index: -1;
  left: -36px; top: -16px; bottom: -16px; width: 140px;
  background: linear-gradient(90deg, rgba(0,0,0,0.35), rgba(0,0,0,0));
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 30%, #000 70%, transparent);
  mask-image: linear-gradient(180deg, transparent, #000 30%, #000 70%, transparent);
}
.hf-obj-bar { width: 2px; background: rgba(216,185,124,0.75); margin: 1px 0; }
.hf-obj-line {
  font-size: 12px; font-weight: 500; letter-spacing: 3px;
  text-transform: uppercase; color: rgba(255,255,255,0.88);
}
.hf-obj-score {
  margin-top: 5px; font-size: 10.5px; font-weight: 400; letter-spacing: 2.5px;
  color: rgba(255,255,255,0.65); font-variant-numeric: tabular-nums;
}

/* ----------------------------------------------------- level / difficulty */
/* small persistent indicator, top-left under the objective block */
.hf-lvl {
  position: absolute; top: 72px; left: 36px; display: none;
  align-items: center; gap: 8px;
  font-size: 11px; font-weight: 600; letter-spacing: 2.8px;
  text-transform: uppercase;
  text-shadow: 0 1px 3px rgba(0,0,0,0.85), 0 0 18px rgba(0,0,0,0.3);
}
.hf-lvl.on { display: flex; }
.hf-lvl-tag { color: #d8b97c; font-weight: 700; }
.hf-lvl-dot {
  width: 3px; height: 3px; border-radius: 50%;
  background: rgba(216,185,124,0.7);
}
.hf-lvl-name { color: rgba(255,255,255,0.6); font-weight: 500; }

/* transient centered banner on level-up: big LEVEL n + subtitle name */
.hf-lvlb {
  position: absolute; left: 50%; top: 38%;
  transform: translate(-50%,-50%); text-align: center;
  opacity: 0; will-change: transform, opacity;
}
.hf-lvlb-big {
  font-size: 46px; font-weight: 200; letter-spacing: 13px;
  text-transform: uppercase; color: rgba(255,255,255,0.95);
  text-shadow: 0 2px 14px rgba(0,0,0,0.82), 0 0 30px rgba(216,185,124,0.25);
}
.hf-lvlb-sub {
  margin-top: 9px; font-size: 15px; font-weight: 600; letter-spacing: 8px;
  text-transform: uppercase; color: #d8b97c;
  text-shadow: 0 1px 6px rgba(0,0,0,0.85);
}
.hf-lvlb.show { animation: hfLvlB 2.2s ease-out forwards; }
@keyframes hfLvlB {
  0%   { opacity: 0;    transform: translate(-50%,-50%) scale(0.92); }
  14%  { opacity: 1;    transform: translate(-50%,-50%) scale(1.03); }
  28%  { opacity: 1;    transform: translate(-50%,-50%) scale(1.00); }
  74%  { opacity: 1;    transform: translate(-50%,-50%) scale(1.00); }
  100% { opacity: 0;    transform: translate(-50%,-50%) scale(1.02); }
}

/* --------------------------------------------------- interact prompt (cars) */
.hf-prompt {
  position: absolute; left: 50%; top: 43.5%; transform: translateX(-50%);
  font-size: 12.5px; font-weight: 600; letter-spacing: 3.5px;
  text-transform: uppercase; color: rgba(255,255,255,0.9);
  text-shadow: 0 1px 3px rgba(0,0,0,0.85), 0 0 14px rgba(0,0,0,0.4);
  opacity: 0; transition: opacity 0.22s ease; white-space: nowrap;
}
.hf-prompt.on { opacity: 1; }

/* ------------------------------------------------------ speed readout (cars) */
.hf-speed {
  position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%);
  display: none; align-items: baseline; gap: 7px;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 3px rgba(0,0,0,0.85), 0 0 18px rgba(0,0,0,0.35);
}
.hf-speed.on { display: flex; }
.hf-speed-num {
  font-size: 30px; font-weight: 600; letter-spacing: 1px; line-height: 1;
  color: rgba(255,255,255,0.92); min-width: 46px; text-align: right;
}
.hf-speed-unit {
  font-size: 10.5px; font-weight: 600; letter-spacing: 3px;
  color: rgba(255,255,255,0.5);
}

/* ---------------------------------------------------------------- killfeed */
.hf-kf {
  position: absolute; right: 36px; top: 37%;
  display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
}
.hf-kf-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 10.5px; font-weight: 500; letter-spacing: 2px;
  text-transform: uppercase; color: rgba(240,238,232,0.85);
  text-shadow: 0 1px 3px rgba(0,0,0,0.85);
  opacity: 0; transform: translateX(10px);
  transition: opacity 0.18s ease, transform 0.28s ease;
}
.hf-kf-row.in  { opacity: 1; transform: none; }
.hf-kf-row.out { opacity: 0; transition: opacity 0.45s ease; }
.hf-kf-mark {
  width: 5px; height: 5px; background: #c2493c;
  box-shadow: 0 0 4px rgba(255,70,50,0.4);
}
`;
  document.head.appendChild(style);

  // ------------------------------------------------------------------ markup
  const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };

  function buildStrip() {
    let html = '';
    for (let c = 0; c < 3; c++) {
      for (let d = 0; d < 360; d += 5) {
        const x = ((c * 360 + d) * PPD).toFixed(1);
        if (d % 45 === 0) {
          html += `<div class="hf-lab card${d === 0 ? ' north' : ''}" style="left:${x}px">${CARDINALS[d]}</div>`;
          html += `<div class="hf-tick mid" style="left:${x}px"></div>`;
        } else if (d % 15 === 0) {
          html += `<div class="hf-tick mid" style="left:${x}px"></div>`;
          if (d % 30 === 0) {
            html += `<div class="hf-lab deg" style="left:${x}px">${String(d).padStart(3, '0')}</div>`;
          }
        } else {
          html += `<div class="hf-tick min" style="left:${x}px"></div>`;
        }
      }
    }
    return html;
  }

  let arcsHTML = '';
  for (let i = 0; i < ARC_POOL; i++) {
    arcsHTML += '<div class="hf-arc-rot"><div class="hf-arc"></div></div>';
  }

  let segsHTML = '';
  for (let i = 0; i < 10; i++) {
    segsHTML += '<div class="hf-hp-seg"><div class="hf-hp-fill"></div></div>';
  }

  const root = document.createElement('div');
  root.className = 'hf-root';
  root.innerHTML = `
<div class="hf-vig"></div>
<div class="hf-arcs">${arcsHTML}</div>
<div class="hf-comp hf-fade">
  <div class="hf-comp-wrap">
    <div class="hf-comp-strip" style="width:${(3 * 360 * PPD).toFixed(0)}px">${buildStrip()}</div>
    <div class="hf-comp-caret"></div>
  </div>
  <div class="hf-comp-bearing">000</div>
</div>
<div class="hf-sb">
  <div class="hf-sb-side you">
    <div class="hf-sb-line"><span class="hf-sb-name">YOU</span><span class="hf-sb-num hf-sb-nyou">0</span></div>
    <div class="hf-sb-bar"></div>
  </div>
  <div class="hf-sb-sep">&ndash;</div>
  <div class="hf-sb-side cr7">
    <div class="hf-sb-line"><span class="hf-sb-num hf-sb-ncr7">0</span><span class="hf-sb-name">CR7</span></div>
    <div class="hf-sb-bar"></div>
  </div>
</div>
<div class="hf-obj hf-fade">
  <div class="hf-obj-bar"></div>
  <div>
    <div class="hf-obj-line">EN ATTENTE</div>
    <div class="hf-obj-score">HOSTILES ÉLIMINÉS&ensp;00</div>
  </div>
</div>
<div class="hf-lvl">
  <span class="hf-lvl-tag">NIVEAU 1</span>
  <span class="hf-lvl-dot"></span>
  <span class="hf-lvl-name">RECRUE</span>
</div>
<div class="hf-lvlb">
  <div class="hf-lvlb-big">NIVEAU 1</div>
  <div class="hf-lvlb-sub">RECRUE</div>
</div>
<div class="hf-kf"></div>
<div class="hf-hp">
  <div class="hf-hp-num">100</div>
  <div>
    <div class="hf-hp-lab">INTÉGRITÉ</div>
    <div class="hf-hp-bar">${segsHTML}</div>
  </div>
</div>
<div class="hf-ammo">
  <div class="hf-ammo-name">CARABINE MK4</div>
  <div class="hf-ammo-rule"></div>
  <div class="hf-ammo-row">
    <div class="hf-ammo-mag">30</div>
    <div class="hf-ammo-sep"></div>
    <div class="hf-ammo-res">150</div>
  </div>
  <div class="hf-ammo-mode">5.56 MM &mdash; AUTO</div>
</div>
<div class="hf-nade"><span class="hf-nade-lab">GRENADES&ensp;G</span><span class="hf-nade-n">4</span></div>
<div class="hf-prompt"></div>
<div class="hf-speed">
  <span class="hf-speed-num">0</span><span class="hf-speed-unit">KM/H</span>
</div>
<div class="hf-ch">
  <div class="hf-ch-dot"></div>
  <div class="hf-ch-t hf-ch-tt"></div>
  <div class="hf-ch-t hf-ch-tb"></div>
  <div class="hf-ch-t hf-ch-tl"></div>
  <div class="hf-ch-t hf-ch-tr"></div>
</div>
<div class="hf-hm"><span></span><span></span><span></span><span></span></div>
`;
  host.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const vig = $('.hf-vig');
  const arcRots = Array.from(root.querySelectorAll('.hf-arc-rot'));
  const arcEls = arcRots.map((r) => r.firstElementChild);
  const strip = $('.hf-comp-strip');
  const bearingEl = $('.hf-comp-bearing');
  const objLine = $('.hf-obj-line');
  const objScore = $('.hf-obj-score');
  const kfBox = $('.hf-kf');
  const hpWrap = $('.hf-hp');
  const hpNum = $('.hf-hp-num');
  const hpBar = $('.hf-hp-bar');
  const hpFills = Array.from(root.querySelectorAll('.hf-hp-fill'));
  const magEl = $('.hf-ammo-mag');
  const resEl = $('.hf-ammo-res');
  const ammoNameEl = $('.hf-ammo-name');
  const ammoSepEl = $('.hf-ammo-sep');
  const ammoModeEl = $('.hf-ammo-mode');
  const nadeEl = $('.hf-nade');
  const nadeNEl = $('.hf-nade-n');
  const ch = $('.hf-ch');
  const hm = $('.hf-hm');
  const sbEl = $('.hf-sb');
  const sbYouEl = $('.hf-sb-nyou');
  const sbCr7El = $('.hf-sb-ncr7');
  const promptEl = $('.hf-prompt');
  const speedEl = $('.hf-speed');
  const speedNumEl = $('.hf-speed-num');
  const lvlEl = $('.hf-lvl');
  const lvlTagEl = $('.hf-lvl-tag');
  const lvlNameEl = $('.hf-lvl-name');
  const lvlbEl = $('.hf-lvlb');
  const lvlbBigEl = $('.hf-lvlb-big');
  const lvlbSubEl = $('.hf-lvlb-sub');

  // ------------------------------------------------------------------- state
  let spreadCur = SPREAD_BASE;
  let spreadTarget = SPREAD_BASE;
  let spreadApplied = -1;
  let health = 100;
  let hpFlashT = 0;
  let regenT = 0;
  let dmgPulse = 0;
  let hbPhase = 0;
  let vigApplied = -1;
  let lastBearing = -1;
  let arcIdx = 0;
  let idleT = 0;
  let isIdle = false;
  let ballMode = false;
  let meleeMode = false;                // ARSENAL: knife equipped → ammo = "—"
  let wpnName = 'CARABINE MK4';          // ARSENAL: current weapon block text
  let wpnMode = '5.56 MM — AUTO';
  let sbYou = null;   // null until setScoreboard first called (panel hidden)
  let sbCr7 = null;
  const kfRows = [];

  function wake() { idleT = 0; if (isIdle) { isIdle = false; root.classList.remove('idle'); } }

  // ----------------------------------------------------------------- methods
  function setCrosshairSpread(px) {
    if (!(px >= 0)) return;
    spreadTarget = Math.max(SPREAD_BASE, px);
    if (px > SPREAD_BASE + 2) wake();
  }

  function setADS(on) {
    root.classList.toggle('ads', !!on);
    if (on) wake();
  }

  function setSprint(on) {
    root.classList.toggle('sprint', !!on);
  }

  function hitmarker(isKill) {
    hm.classList.remove('show', 'kill');
    void hm.offsetWidth; // restart CSS animation
    if (isKill) hm.classList.add('kill');
    hm.classList.add('show');
    wake();
  }

  function setGrenades(n) {
    if (!nadeNEl) return;
    n = Math.max(0, n | 0);
    nadeNEl.textContent = String(n);
    nadeEl.classList.toggle('empty', n === 0);
    if (ballMode && nadeEl) nadeEl.style.display = 'none'; // no grenades in CR7 mode
    wake();
  }

  function setAmmo(mag, res) {
    if (ballMode || meleeMode) return; // pinned block: "BALLON ∞" or knife "—"
    magEl.textContent = String(Math.max(0, mag | 0));
    resEl.textContent = String(Math.max(0, res | 0));
    magEl.classList.toggle('low', mag <= 7);
  }

  // ARSENAL: knife equipped — ammo block shows a dash, no digits/low pulse.
  // Same styling as the rifle block otherwise; reversed cleanly on the next
  // gun equip (which calls setMelee(false) then setAmmo). Independent of ball
  // mode (never both on in a single session).
  function setMelee(on) {
    on = !!on;
    if (on === meleeMode) return;
    meleeMode = on;
    if (on) {
      magEl.textContent = '—';
      magEl.classList.remove('low');
      ammoSepEl.style.display = 'none';
      resEl.style.display = 'none';
    } else {
      ammoSepEl.style.display = '';
      resEl.style.display = '';
      // digits refreshed by the equip's following setAmmo call
    }
  }

  // ARSENAL: weapon block name line + optional caliber/mode subline
  // ('VULCAN-9', '9 MM — AUTO'). Stored while ball mode is on and reapplied
  // when it exits, so the two systems never fight over the block.
  function setWeaponName(name, mode) {
    if (name != null && name !== '') wpnName = String(name);
    if (mode != null && mode !== '') wpnMode = String(mode);
    if (ballMode) return;
    ammoNameEl.textContent = wpnName;
    ammoModeEl.textContent = wpnMode;
  }

  // FOOTBALL MODE: weapon block reads "BALLON  ∞" — same styling, digits and
  // low-mag pulse disabled while on.
  function setBallMode(on) {
    on = !!on;
    if (on === ballMode) return;
    ballMode = on;
    if (on) {
      ammoNameEl.textContent = 'BALLON';
      magEl.textContent = '∞';
      magEl.classList.remove('low');
      ammoSepEl.style.display = 'none';
      resEl.style.display = 'none';
      ammoModeEl.textContent = 'SIUUU — AUTO';
    } else {
      ammoNameEl.textContent = wpnName;
      ammoSepEl.style.display = '';
      resEl.style.display = '';
      ammoModeEl.textContent = wpnMode;
      magEl.textContent = '30';
      resEl.textContent = '150';
    }
  }

  // FOOTBALL MODE: stadium scorebug under the compass. Hidden until first call;
  // a changed digit does a quick pop/flash (restarted CSS animation). Caps at 99.
  function setScoreboard(you, cr7) {
    you = Math.max(0, Math.min(99, you | 0));
    cr7 = Math.max(0, Math.min(99, cr7 | 0));
    const first = sbYou === null;
    if (first) sbEl.classList.add('on');
    if (you !== sbYou) {
      sbYouEl.textContent = String(you);
      if (!first) {
        sbYouEl.classList.remove('pop');
        void sbYouEl.offsetWidth; // restart CSS animation
        sbYouEl.classList.add('pop');
      }
      sbYou = you;
    }
    if (cr7 !== sbCr7) {
      sbCr7El.textContent = String(cr7);
      if (!first) {
        sbCr7El.classList.remove('pop');
        void sbCr7El.offsetWidth;
        sbCr7El.classList.add('pop');
      }
      sbCr7 = cr7;
    }
    wake();
  }

  // CARS: interact prompt above the crosshair ('E — DRIVE'); null/'' hides it
  function setPrompt(text) {
    if (!text) {
      promptEl.classList.remove('on');
      return;
    }
    const t = String(text);
    if (promptEl.textContent !== t) promptEl.textContent = t;
    promptEl.classList.add('on');
    wake();
  }

  // CARS: bottom-center speed readout "84 KM/H"; null hides it
  let speedShown = false;
  let lastKmh = -1;
  function setSpeed(kmh) {
    if (kmh == null || !isFinite(kmh)) {
      if (speedShown) { speedShown = false; speedEl.classList.remove('on'); }
      return;
    }
    if (!speedShown) { speedShown = true; speedEl.classList.add('on'); wake(); }
    const v = Math.max(0, Math.round(kmh));
    if (v !== lastKmh) { lastKmh = v; speedNumEl.textContent = String(v); }
  }

  function setHealth(pct) {
    pct = Math.max(0, Math.min(100, +pct || 0));
    if (pct < health - 0.25) {
      hpFlashT = 0.22;
      hpBar.classList.add('dmg');
      hpBar.classList.remove('regen');
      dmgPulse = Math.min(1, dmgPulse + 0.25);
      wake();
    } else if (pct > health + 0.05 && pct < 100) {
      regenT = 0.7;
      hpBar.classList.add('regen');
    } else if (pct >= 100) {
      regenT = 0;
      hpBar.classList.remove('regen');
    }
    health = pct;
    hpNum.textContent = String(Math.round(pct));
    for (let i = 0; i < 10; i++) {
      const f = Math.max(0, Math.min(1, pct / 10 - i));
      hpFills[i].style.width = (f * 100).toFixed(1) + '%';
    }
    hpWrap.classList.toggle('low', pct < 35);
  }

  function setCompassYaw(rad) {
    if (typeof rad !== 'number' || !isFinite(rad)) return;
    // North = -Z (down the main street); yaw = PI faces -Z per SPEC.
    const deg = (((Math.PI - rad) * 180 / Math.PI) % 360 + 360) % 360;
    const x = (360 + deg) * PPD; // read from the middle copy of the strip
    strip.style.transform = 'translateX(' + (COMP_W / 2 - x).toFixed(2) + 'px)';
    const b = Math.round(deg) % 360;
    if (b !== lastBearing) {
      lastBearing = b;
      bearingEl.textContent = String(b).padStart(3, '0');
    }
  }

  function setScore(k) {
    objScore.innerHTML = 'HOSTILES ÉLIMINÉS&ensp;' + String(Math.max(0, k | 0)).padStart(2, '0');
    wake();
  }

  function setObjective(txt) {
    objLine.textContent = String(txt || '');
  }

  // LEVEL / DIFFICULTY: small persistent top-left indicator under the
  // objective, e.g. "LEVEL 3 · HARDENED". Hidden until the first call.
  function setLevel(n, name) {
    n = Math.max(1, n | 0);
    lvlTagEl.textContent = 'NIVEAU ' + n;
    lvlNameEl.textContent = String(name || '');
    if (!lvlEl.classList.contains('on')) lvlEl.classList.add('on');
    wake();
  }

  // LEVEL-UP: transient centered banner (big "LEVEL n" + subtitle name) that
  // fades in/out with a subtle scale pop over ~2.2s. Restarts if re-triggered.
  function levelBanner(n, name) {
    n = Math.max(1, n | 0);
    lvlbBigEl.textContent = 'NIVEAU ' + n;
    lvlbSubEl.textContent = String(name || '');
    lvlbEl.classList.remove('show');
    void lvlbEl.offsetWidth; // restart CSS animation
    lvlbEl.classList.add('show');
    wake();
  }

  function killfeed(text) {
    const row = document.createElement('div');
    row.className = 'hf-kf-row';
    const mark = document.createElement('div');
    mark.className = 'hf-kf-mark';
    const span = document.createElement('span');
    span.textContent = String(text || '');
    row.appendChild(mark);
    row.appendChild(span);
    kfBox.insertBefore(row, kfBox.firstChild);
    void row.offsetWidth;
    row.classList.add('in');
    kfRows.unshift({ el: row, t: 0 });
    while (kfRows.length > KF_MAX) {
      const old = kfRows.pop();
      if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }
    wake();
  }

  function showDamageFrom(angleRad) {
    if (typeof angleRad !== 'number' || !isFinite(angleRad)) angleRad = 0;
    const rot = arcRots[arcIdx % ARC_POOL];
    const el = arcEls[arcIdx % ARC_POOL];
    arcIdx++;
    rot.style.transform = 'rotate(' + (angleRad * 180 / Math.PI).toFixed(1) + 'deg)';
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    dmgPulse = Math.min(1, dmgPulse + 0.6);
    wake();
  }

  // ------------------------------------------------------------------ update
  function update(dt) {
    if (!(dt > 0)) dt = 0;

    // crosshair spread ease: snap out fast, relax back to base
    spreadCur += (spreadTarget - spreadCur) * Math.min(1, dt * 16);
    spreadTarget += (SPREAD_BASE - spreadTarget) * Math.min(1, dt * 7);
    if (Math.abs(spreadCur - spreadApplied) > 0.05) {
      spreadApplied = spreadCur;
      ch.style.setProperty('--gap', spreadCur.toFixed(2) + 'px');
    }

    // vignette: persistent missing-health base + damage pulse + heartbeat
    dmgPulse *= Math.exp(-2.4 * dt);
    const missing = Math.max(0, Math.min(1, ((100 - health) / 100 - 0.25) / 0.75));
    let o = missing * 0.38 + dmgPulse * 0.5;
    if (health < 35 && health > 0) {
      const amp = (35 - health) / 35;
      hbPhase += dt * (1.25 + amp * 1.0);
      const p = hbPhase % 1;
      const lub = Math.pow(Math.max(0, Math.sin(p * Math.PI * 2)), 4);
      const dub = Math.pow(Math.max(0, Math.sin((p - 0.16) * Math.PI * 2)), 4) * 0.55;
      o += amp * 0.30 * (lub + dub);
    }
    o = Math.min(0.95, o);
    if (Math.abs(o - vigApplied) > 0.004) {
      vigApplied = o;
      vig.style.opacity = o.toFixed(3);
    }

    // health bar timers
    if (hpFlashT > 0) {
      hpFlashT -= dt;
      if (hpFlashT <= 0) hpBar.classList.remove('dmg');
    }
    if (regenT > 0) {
      regenT -= dt;
      if (regenT <= 0) hpBar.classList.remove('regen');
    }

    // killfeed aging
    for (let i = kfRows.length - 1; i >= 0; i--) {
      const r = kfRows[i];
      r.t += dt;
      if (r.t > 4 && !r.dead) {
        r.dead = true;
        r.el.classList.add('out');
      }
      if (r.t > 4.6) {
        if (r.el.parentNode) r.el.parentNode.removeChild(r.el);
        kfRows.splice(i, 1);
      }
    }

    // idle fade for peripheral elements
    idleT += dt;
    if (idleT > 7 && !isIdle) { isIdle = true; root.classList.add('idle'); }
  }

  return {
    setCrosshairSpread,
    setADS,
    setSprint,
    hitmarker,
    setAmmo,
    setGrenades,
    setWeaponName,
    setMelee,
    setBallMode,
    setScoreboard,
    setHealth,
    setCompassYaw,
    setScore,
    setObjective,
    setLevel,
    levelBanner,
    killfeed,
    showDamageFrom,
    setPrompt,
    setSpeed,
    update,
  };
}
