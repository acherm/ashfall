// ============================================================================
// ASHFALL — audio/audio.js
// 100% WebAudio-synthesized. No files, no fetches.
// Contract: createAudio() -> { unlock, gunshot, enemyGunshot, reload, dryFire,
//   footstep, land, hurt, hitConfirm, ricochet, ambience, bodyFall, update }
// CARS additions: engineStart, engineStop, engineRpm(t 0..1), crash(intensity),
//   skid(level 0..1), horn.
// All methods no-throw when the context is suspended or unavailable.
// ============================================================================

export function createAudio() {
  const AC = typeof window !== 'undefined'
    ? (window.AudioContext || window.webkitAudioContext)
    : null;

  let ctx = null;
  try { if (AC) ctx = new AC(); } catch (e) { ctx = null; }

  const noop = () => {};
  if (!ctx) {
    return {
      unlock: noop, gunshot: noop, enemyGunshot: noop, reload: noop,
      dryFire: noop, footstep: noop, land: noop, hurt: noop, hitConfirm: noop,
      ricochet: noop, ambience: noop, bodyFall: noop, update: noop,
      pistolShot: noop, knifeSwing: noop, knifeStab: noop,
      kick: noop, kickAt: noop, bounce: noop,
      engineStart: noop, engineStop: noop, engineRpm: noop,
      crash: noop, skid: noop, horn: noop,
    };
  }

  // ----------------------------------------------------------------- routing
  // sfx/amb buses -> compressor -> output trim -> destination
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 18;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.22;

  const out = ctx.createGain();
  out.gain.value = 0.85;
  comp.connect(out);
  out.connect(ctx.destination);

  const sfx = ctx.createGain();
  sfx.gain.value = 1.0;
  sfx.connect(comp);

  const amb = ctx.createGain();
  amb.gain.value = 0.55; // quiet bed, ~ -28 dB net with layer gains
  amb.connect(comp);

  // ----------------------------------------------------------------- buffers
  const SR = ctx.sampleRate;

  function makeWhite(seconds) {
    const n = Math.floor(SR * seconds);
    const b = ctx.createBuffer(1, n, SR);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function makeBrown(seconds) {
    const n = Math.floor(SR * seconds);
    const b = ctx.createBuffer(1, n, SR);
    const d = b.getChannelData(0);
    let v = 0;
    for (let i = 0; i < n; i++) {
      v += (Math.random() * 2 - 1) * 0.02;
      v *= 0.998;
      d[i] = v * 3.2;
    }
    // remove linear drift so the loop seam is silent
    const drift = d[n - 1] - d[0];
    for (let i = 0; i < n; i++) d[i] -= (i / n) * drift;
    return b;
  }

  function makeClick() {
    const n = 512;
    const b = ctx.createBuffer(1, n, SR);
    const d = b.getChannelData(0);
    d[0] = 1;
    for (let i = 1; i < n; i++) {
      const k = 1 - i / n;
      d[i] = (Math.random() * 2 - 1) * k * k * k;
    }
    return b;
  }

  const white = makeWhite(1.6);
  const brown = makeBrown(3.0);
  const click = makeClick();

  // ----------------------------------------------------------------- helpers
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const now = () => ctx.currentTime;
  const running = () => ctx.state === 'running';

  // listener state (fed by .update)
  const eye = { x: 0, y: 1.68, z: 52 };
  let listenerYaw = Math.PI;

  function adsr(t0, peak, a, d) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    return g;
  }

  function panNode(p) {
    if (ctx.createStereoPanner) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = clamp(p, -1, 1);
      return sp;
    }
    return ctx.createGain(); // mono fallback
  }

  // filtered noise burst; f1 sweeps the filter over the envelope
  function burst(dest, t0, o) {
    const buf = o.buf || white;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = o.rate || 1;
    if (o.loop) s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.Q != null ? o.Q : 1;
    f.frequency.setValueAtTime(Math.max(20, o.f0 || 1000), t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + (o.a || 0.002) + (o.d || 0.08));
    const g = adsr(t0, o.peak != null ? o.peak : 0.3, o.a || 0.002, o.d || 0.08);
    s.connect(f); f.connect(g); g.connect(dest);
    const off = Math.random() * Math.max(0.05, buf.duration - 0.6);
    s.start(t0, o.loop ? 0 : off);
    s.stop(t0 + (o.a || 0.002) + (o.d || 0.08) + 0.08);
  }

  function tone(dest, t0, o) {
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(10, o.f0 || 440), t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t0 + (o.a || 0.002) + (o.d || 0.15));
    const g = adsr(t0, o.peak != null ? o.peak : 0.3, o.a || 0.002, o.d || 0.15);
    osc.connect(g); g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + (o.a || 0.002) + (o.d || 0.15) + 0.08);
  }

  // sharp resonant mechanical tick (excites a hi-Q bandpass with a click)
  function tick(dest, t0, f, peak, d) {
    const s = ctx.createBufferSource();
    s.buffer = click;
    s.playbackRate.value = rnd(0.92, 1.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 9;
    const g = adsr(t0, peak, 0.001, d || 0.03);
    s.connect(bp); bp.connect(g); g.connect(dest);
    s.start(t0);
  }

  // equal-power pan value for a world position, from stored listener
  // (yaw convention per SPEC: yaw = PI faces -Z, so forward = (sin yaw, cos yaw))
  function panFor(pos) {
    const dx = pos.x - eye.x;
    const dz = pos.z - eye.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return 0;
    const rx = -Math.cos(listenerYaw);
    const rz = Math.sin(listenerYaw);
    return clamp(((dx * rx + dz * rz) / len) * 0.9, -1, 1);
  }

  function distTo(pos) {
    return Math.hypot(pos.x - eye.x, (pos.y || 0) - eye.y, pos.z - eye.z);
  }

  // ------------------------------------------------------------ gunshot core
  // Layered: click transient + supersonic snap + bandpass-swept body +
  // mid growl + sub thump + 2-tap slap echo. Random detune per shot.
  function shotLayers(dest, t0, o) {
    o = o || {};
    const det = rnd(0.94, 1.06);
    const crack = o.crack != null ? o.crack : 1;
    const body = o.body != null ? o.body : 1;
    const sub = o.sub != null ? o.sub : 1;
    const echo = o.echo != null ? o.echo : 1;

    // 4ms click transient
    const c = ctx.createBufferSource();
    c.buffer = click;
    c.playbackRate.value = rnd(0.9, 1.15);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.8 * crack, t0);
    c.connect(cg); cg.connect(dest);
    c.start(t0);

    // supersonic snap
    burst(dest, t0, { peak: 0.32 * crack, a: 0.001, d: 0.028, type: 'highpass', f0: 4200, Q: 0.7 });
    // main body: shaped noise, bandpass sweep 3k -> 400 over ~90ms
    burst(dest, t0, { peak: 0.75 * body, a: 0.002, d: 0.09 * det, type: 'bandpass', f0: (o.f0 || 3000) * det, f1: 400, Q: 0.9 });
    // mid growl tail
    burst(dest, t0, { peak: 0.30 * body, a: 0.004, d: 0.14, type: 'lowpass', f0: 900, Q: 0.6 });
    // sub thump, pitch drop
    tone(dest, t0, { type: 'sine', f0: 112 * det, f1: 45, peak: 0.5 * sub, a: 0.004, d: 0.13 });

    // tight slap echo, 2 taps off-axis
    if (echo > 0.01) {
      const e1 = panNode(rnd(-0.35, 0.35)); e1.connect(dest);
      burst(e1, t0 + 0.068, { peak: 0.13 * echo, a: 0.004, d: 0.07, type: 'lowpass', f0: 1500, Q: 0.6 });
      const e2 = panNode(rnd(-0.5, 0.5)); e2.connect(dest);
      burst(e2, t0 + 0.131, { peak: 0.07 * echo, a: 0.006, d: 0.09, type: 'lowpass', f0: 1000, Q: 0.6 });
    }
  }

  // wraps one-shots: silently skip when suspended, never throw
  function guard(fn) {
    return function () {
      try {
        if (!running()) return;
        fn.apply(null, arguments);
      } catch (e) { /* no-throw */ }
    };
  }

  // ------------------------------------------------------------- public sfx
  const gunshot = guard(() => {
    const t0 = now();
    const g = ctx.createGain();
    g.gain.value = 0.58; // peak ~ -6 dB into compressor
    g.connect(sfx);
    shotLayers(g, t0, {});
  });

  const enemyGunshot = guard((pos) => {
    if (!pos) return;
    const d = distTo(pos);
    const gv = Math.min(1, 9 / (3 + d)) * 0.8;
    if (gv < 0.02) return;
    const t0 = now();
    const g = ctx.createGain();
    g.gain.value = gv;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(500, 12000 * Math.exp(-d / 34));
    lp.Q.value = 0.5;
    const sp = panNode(panFor(pos));
    g.connect(lp); lp.connect(sp); sp.connect(sfx);
    // distance shapes the mix: less crack, more boom far away; no propagation delay
    shotLayers(g, t0, {
      f0: 2400,
      crack: clamp(1 - d / 60, 0.15, 1),
      sub: clamp(0.7 + d / 45, 0.7, 1.5),
      echo: d < 25 ? 0.8 : 0.4,
    });
  });

  const reload = guard(() => {
    const t = now();
    // stage 1 — mag release + slide out
    tick(sfx, t + 0.10, 1400, 0.18, 0.03);
    burst(sfx, t + 0.13, { peak: 0.12, a: 0.008, d: 0.07, type: 'bandpass', f0: 820, f1: 500, Q: 1.4 });
    // stage 2 — fresh mag seats
    tone(sfx, t + 0.92, { type: 'sine', f0: 240, f1: 120, peak: 0.28, a: 0.002, d: 0.06 });
    tick(sfx, t + 0.94, 1050, 0.15, 0.035);
    burst(sfx, t + 0.95, { peak: 0.07, a: 0.004, d: 0.05, type: 'bandpass', f0: 600, Q: 1.2 });
    // stage 3 — bolt release: double click + spring + slam
    tick(sfx, t + 1.55, 2300, 0.16, 0.025);
    tick(sfx, t + 1.60, 1750, 0.20, 0.03);
    burst(sfx, t + 1.60, { peak: 0.10, a: 0.006, d: 0.05, type: 'bandpass', f0: 900, f1: 2200, Q: 2 });
    tone(sfx, t + 1.66, { type: 'sine', f0: 190, f1: 110, peak: 0.20, a: 0.002, d: 0.05 });
  });

  const dryFire = guard(() => {
    const t = now();
    tick(sfx, t, 1900, 0.22, 0.022);
    tick(sfx, t + 0.006, 700, 0.12, 0.04);
  });

  let stepSide = false;
  const footstep = guard(() => {
    const t = now();
    stepSide = !stepSide;
    const sp = panNode(stepSide ? 0.12 : -0.12);
    sp.connect(sfx);
    burst(sp, t, {
      peak: rnd(0.10, 0.16), a: 0.003, d: rnd(0.05, 0.08),
      type: 'bandpass', f0: rnd(240, 520), Q: 1.1, rate: rnd(0.85, 1.15),
    });
    if (Math.random() < 0.4) {
      burst(sp, t + 0.012, { peak: 0.03, a: 0.002, d: 0.03, type: 'highpass', f0: 2200, Q: 0.7 });
    }
  });

  const land = guard(() => {
    const t = now();
    burst(sfx, t, { peak: 0.34, a: 0.003, d: 0.12, type: 'lowpass', f0: 260, Q: 0.7 });
    tone(sfx, t, { type: 'sine', f0: 75, f1: 42, peak: 0.30, a: 0.004, d: 0.11 });
    burst(sfx, t + 0.02, { peak: 0.05, a: 0.003, d: 0.05, type: 'bandpass', f0: 700, Q: 1.5 });
  });

  const hurt = guard(() => {
    const t = now();
    tone(sfx, t, { type: 'sine', f0: 95, f1: 48, peak: 0.45, a: 0.004, d: 0.20 });
    burst(sfx, t, { peak: 0.22, a: 0.006, d: 0.16, type: 'lowpass', f0: 300, Q: 0.6 });
    tone(sfx, t + 0.01, { type: 'sine', f0: 640, f1: 590, peak: 0.045, a: 0.005, d: 0.30 });
  });

  const hitConfirm = guard(() => {
    const t = now();
    tone(sfx, t, { type: 'sine', f0: 2350, f1: 2650, peak: 0.30, a: 0.001, d: 0.028 });
    tone(sfx, t, { type: 'sine', f0: 4700, f1: 5300, peak: 0.08, a: 0.001, d: 0.02 });
  });

  // ------------------------------------------------------- SIDEARM / MELEE sfx
  // Pistol: same shot family as the rifle but lighter — snappier crack, less
  // body/sub, quieter overall. Reads as a 9mm handgun, not a carbine.
  const pistolShot = guard(() => {
    const t0 = now();
    const g = ctx.createGain();
    g.gain.value = 0.46;
    g.connect(sfx);
    shotLayers(g, t0, { f0: 2650, crack: 0.9, body: 0.66, sub: 0.5, echo: 0.7 });
  });

  // Knife swing: airy noise whoosh, bandpass sweeping up then trailing down.
  const knifeSwing = guard(() => {
    const t0 = now();
    const s = ctx.createBufferSource();
    s.buffer = white;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(760, t0);
    bp.frequency.exponentialRampToValueAtTime(3200, t0 + 0.09);
    bp.frequency.exponentialRampToValueAtTime(620, t0 + 0.20);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.15, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    s.connect(bp); bp.connect(g); g.connect(sfx);
    s.start(t0, Math.random() * 0.5);
    s.stop(t0 + 0.26);
  });

  // Knife hit: meaty stab — low thud + squelchy bandpass body.
  const knifeStab = guard(() => {
    const t0 = now();
    tone(sfx, t0, { type: 'sine', f0: 90, f1: 42, peak: 0.34, a: 0.003, d: 0.12 });
    burst(sfx, t0, { peak: 0.26, a: 0.003, d: 0.10, type: 'lowpass', f0: 480, f1: 180, Q: 0.8 });
    burst(sfx, t0 + 0.01, { peak: 0.12, a: 0.004, d: 0.08, type: 'bandpass', f0: 1600, f1: 500, Q: 1.4 });
  });

  const ricochet = guard((pos) => {
    const t = now();
    const p = pos ? panFor(pos) : rnd(-0.6, 0.6);
    const g = pos ? clamp(9 / (3 + distTo(pos)), 0.05, 0.9) : 0.6;
    const sp = panNode(p);
    sp.connect(sfx);
    tone(sp, t, { type: 'sine', f0: 2600, f1: 650, peak: 0.11 * g, a: 0.005, d: 0.30 });
    burst(sp, t, { peak: 0.09 * g, a: 0.004, d: 0.22, type: 'bandpass', f0: 3000, f1: 900, Q: 2 });
  });

  // ------------------------------------------------------- FOOTBALL MODE sfx
  // Ball strike: leather slap transient + punchy pitch-dropping low thump +
  // lowpassed body thud + a short bandpass whoosh trailing the contact.
  function kickLayers(dest, t0) {
    const det = rnd(0.92, 1.08);
    const c = ctx.createBufferSource();
    c.buffer = click;
    c.playbackRate.value = 0.52 * det;    // pitched way down: leather, not metal
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.5, t0);
    c.connect(cg); cg.connect(dest);
    c.start(t0);
    tone(dest, t0, { type: 'sine', f0: 155 * det, f1: 50, peak: 0.6, a: 0.003, d: 0.12 });
    burst(dest, t0, { peak: 0.30, a: 0.003, d: 0.07, type: 'lowpass', f0: 520, f1: 210, Q: 0.8 });
    burst(dest, t0 + 0.012, { peak: 0.10, a: 0.035, d: 0.11, type: 'bandpass', f0: 420 * det, f1: 1500, Q: 1.5 });
  }

  const kick = guard(() => {
    const t0 = now();
    const g = ctx.createGain();
    g.gain.value = 0.62;
    g.connect(sfx);
    kickLayers(g, t0);
  });

  const kickAt = guard((pos) => {
    if (!pos) return;
    const d = distTo(pos);
    const gv = Math.min(1, 9 / (3 + d)) * 0.75;
    if (gv < 0.02) return;
    const t0 = now();
    const g = ctx.createGain();
    g.gain.value = gv;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(400, 9000 * Math.exp(-d / 30));
    lp.Q.value = 0.5;
    const sp = panNode(panFor(pos));
    g.connect(lp); lp.connect(sp); sp.connect(sfx);
    kickLayers(g, t0);
  });

  // soft quiet thud for ball bounces (strength 0..1 from impact speed)
  const bounce = guard((pos, strength) => {
    const s = clamp(typeof strength === 'number' ? strength : 0.5, 0, 1);
    const d = pos ? distTo(pos) : 4;
    const g0 = Math.min(1, 7 / (2 + d)) * (0.08 + 0.30 * s);
    if (g0 < 0.015) return;
    const t0 = now();
    const sp = panNode(pos ? panFor(pos) : 0);
    sp.connect(sfx);
    tone(sp, t0, { type: 'sine', f0: rnd(120, 150), f1: 58, peak: 0.5 * g0, a: 0.003, d: 0.07 });
    burst(sp, t0, { peak: 0.55 * g0, a: 0.002, d: 0.045, type: 'lowpass', f0: 420, Q: 0.8, rate: rnd(0.9, 1.1) });
  });

  // ------------------------------------------------------------- CARS sfx
  // Engine loop: layered saw/square/sub through a lowpass, rpm-scaled pitch
  // (idle grumble -> higher whine). Nodes may be created while suspended —
  // they sound on resume, and state stays consistent (like ambience()).
  let eng = null;
  function engineStart() {
    try {
      if (eng) return;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 1.1;
      const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 55;
      const sq = ctx.createOscillator(); sq.type = 'square'; sq.frequency.value = 27.5;
      const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 41;
      const sawG = ctx.createGain(); sawG.gain.value = 0.42;
      const sqG = ctx.createGain(); sqG.gain.value = 0.26;
      const subG = ctx.createGain(); subG.gain.value = 0.5;
      saw.connect(sawG); sq.connect(sqG); sub.connect(subG);
      sawG.connect(lp); sqG.connect(lp); subG.connect(lp);
      lp.connect(g); g.connect(sfx);
      // idle wobble: slow LFO on detune + cutoff so idle reads as a grumble
      const lfo = ctx.createOscillator(); lfo.frequency.value = 6.1;
      const lfoDet = ctx.createGain(); lfoDet.gain.value = 14;
      const lfoCut = ctx.createGain(); lfoCut.gain.value = 26;
      lfo.connect(lfoDet); lfoDet.connect(saw.detune);
      lfo.connect(lfoCut); lfoCut.connect(lp.frequency);
      saw.start(); sq.start(); sub.start(); lfo.start();
      g.gain.setTargetAtTime(0.062, now(), 0.09);
      eng = { g, lp, saw, sq, sub, lfo };
      // starter chug
      burst(sfx, now(), { peak: 0.08, a: 0.01, d: 0.26, type: 'bandpass', f0: 210, f1: 95, Q: 2, rate: 0.7 });
    } catch (e) { /* no-throw */ }
  }

  function engineStop() {
    try {
      if (!eng) return;
      const e = eng; eng = null;
      e.g.gain.setTargetAtTime(0.0001, now(), 0.07);
      setTimeout(() => {
        try { e.saw.stop(); e.sq.stop(); e.sub.stop(); e.lfo.stop(); } catch (_) { /* ignore */ }
      }, 420);
    } catch (e) { /* no-throw */ }
  }

  function engineRpm(t) {
    try {
      if (!eng) return;
      t = clamp(+t || 0, 0, 1);
      const k = 1 + t * 2.6;
      const tc = 0.09;
      eng.saw.frequency.setTargetAtTime(55 * k, now(), tc);
      eng.sq.frequency.setTargetAtTime(27.5 * k, now(), tc);
      eng.sub.frequency.setTargetAtTime(41 * (1 + t * 1.9), now(), tc);
      eng.lp.frequency.setTargetAtTime(260 + t * 1250, now(), tc);
      eng.g.gain.setTargetAtTime(0.058 + t * 0.05, now(), tc);
    } catch (e) { /* no-throw */ }
  }

  // impact: filtered noise burst + low thump, metal clatter when hard
  const crash = guard((intensity) => {
    const i = clamp(typeof intensity === 'number' ? intensity : 0.6, 0, 1);
    const t0 = now();
    tone(sfx, t0, { type: 'sine', f0: 68 + 40 * i, f1: 30, peak: 0.38 + 0.3 * i, a: 0.004, d: 0.16 + 0.1 * i });
    burst(sfx, t0, { peak: 0.28 + 0.4 * i, a: 0.003, d: 0.12 + 0.12 * i, type: 'lowpass', f0: 700 + 900 * i, f1: 180, Q: 0.7 });
    if (i > 0.45) {
      tick(sfx, t0 + 0.03, 1900, 0.1 * i, 0.05);
      tick(sfx, t0 + 0.09, 1300, 0.08 * i, 0.06);
      burst(sfx, t0 + 0.05, { peak: 0.1 * i, a: 0.004, d: 0.1, type: 'bandpass', f0: 2400, f1: 900, Q: 2 });
    }
  });

  // tire squeal loop; call each frame with level 0..1 (0 fades it out)
  let skidN = null;
  function skid(level) {
    try {
      const l = clamp(+level || 0, 0, 1);
      if (l < 0.02) {
        if (skidN) skidN.g.gain.setTargetAtTime(0.0001, now(), 0.06);
        return;
      }
      if (!skidN) {
        const s = ctx.createBufferSource(); s.buffer = white; s.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 2300; bp.Q.value = 1.4;
        const g = ctx.createGain(); g.gain.value = 0.0001;
        s.connect(bp); bp.connect(g); g.connect(sfx);
        s.start();
        skidN = { s, bp, g };
      }
      skidN.g.gain.setTargetAtTime(0.045 + 0.085 * l, now(), 0.05);
      skidN.bp.frequency.setTargetAtTime(1900 + 900 * l, now(), 0.1);
    } catch (e) { /* no-throw */ }
  }

  // classic dual-tone quick honk
  const horn = guard(() => {
    const t0 = now();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.13, t0 + 0.015);
    g.gain.setValueAtTime(0.13, t0 + 0.24);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.31);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1600; lp.Q.value = 0.7;
    g.connect(lp); lp.connect(sfx);
    for (const f of [349, 440]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = 0.5;
      o.connect(og); og.connect(g);
      o.start(t0);
      o.stop(t0 + 0.36);
    }
  });

  const bodyFall = guard(() => {
    const t = now();
    burst(sfx, t, { peak: 0.30, a: 0.004, d: 0.16, type: 'lowpass', f0: 200, Q: 0.7 });
    tone(sfx, t, { type: 'sine', f0: 58, f1: 38, peak: 0.22, a: 0.005, d: 0.13 });
    // trailing gear rustle
    burst(sfx, t + 0.10, { peak: 0.10, a: 0.004, d: 0.08, type: 'lowpass', f0: 350, Q: 0.8 });
    burst(sfx, t + 0.11, { peak: 0.03, a: 0.003, d: 0.04, type: 'bandpass', f0: 1400, Q: 1.5 });
  });

  // ---------------------------------------------------------------- ambience
  let ambStarted = false;

  function startWind() {
    // low wind bed
    const w = ctx.createBufferSource();
    w.buffer = brown; w.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 0.5;
    const wg = ctx.createGain(); wg.gain.value = 0.09;
    w.connect(lp); lp.connect(wg); wg.connect(amb);
    // slow cutoff LFO — gusts
    const lfo1 = ctx.createOscillator(); lfo1.frequency.value = 0.07;
    const l1g = ctx.createGain(); l1g.gain.value = 130;
    lfo1.connect(l1g); l1g.connect(lp.frequency);
    // slow amplitude LFO
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.043;
    const l2g = ctx.createGain(); l2g.gain.value = 0.032;
    lfo2.connect(l2g); l2g.connect(wg.gain);
    w.start(); lfo1.start(); lfo2.start();

    // faint whistle through wreckage
    const w2 = ctx.createBufferSource();
    w2.buffer = white; w2.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 3.5;
    const w2g = ctx.createGain(); w2g.gain.value = 0.006;
    w2.connect(bp); bp.connect(w2g); w2g.connect(amb);
    const lfo3 = ctx.createOscillator(); lfo3.frequency.value = 0.11;
    const l3g = ctx.createGain(); l3g.gain.value = 380;
    lfo3.connect(l3g); l3g.connect(bp.frequency);
    const lfo4 = ctx.createOscillator(); lfo4.frequency.value = 0.09;
    const l4g = ctx.createGain(); l4g.gain.value = 0.0045;
    lfo4.connect(l4g); l4g.connect(w2g.gain);
    w2.start(); lfo3.start(); lfo4.start();

    // muffled city tone
    const cty = ctx.createBufferSource();
    cty.buffer = brown; cty.loop = true;
    cty.playbackRate.value = 0.62;
    const clp = ctx.createBiquadFilter();
    clp.type = 'lowpass'; clp.frequency.value = 115; clp.Q.value = 0.4;
    const cg = ctx.createGain(); cg.gain.value = 0.055;
    cty.connect(clp); clp.connect(cg); cg.connect(amb);
    cty.start();
  }

  function distantRumble() {
    const t0 = now();
    const a = rnd(0.8, 1.6);
    const d = rnd(2.0, 3.5);
    const sp = panNode(rnd(-0.5, 0.5));
    sp.connect(amb);
    burst(sp, t0, {
      buf: brown, loop: true, peak: rnd(0.05, 0.10), a, d,
      type: 'lowpass', f0: rnd(90, 180), Q: 0.5, rate: rnd(0.7, 1),
    });
  }

  function distantGunfire() {
    const t0 = now();
    const sp = panNode(rnd(-0.75, 0.75));
    sp.connect(amb);
    const n = 3 + Math.floor(Math.random() * 5);
    const fc = rnd(400, 750);
    let tt = t0;
    for (let i = 0; i < n; i++) {
      burst(sp, tt, { peak: rnd(0.014, 0.028), a: 0.002, d: 0.05, type: 'lowpass', f0: fc * rnd(0.9, 1.1), Q: 0.7 });
      tone(sp, tt, { type: 'sine', f0: 90, f1: 55, peak: 0.012, a: 0.002, d: 0.06 });
      tt += rnd(0.07, 0.16);
    }
    // occasional answering burst
    if (Math.random() < 0.35) {
      const sp2 = panNode(rnd(-0.75, 0.75));
      sp2.connect(amb);
      let t2 = t0 + rnd(0.5, 0.9);
      const m = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < m; i++) {
        burst(sp2, t2, { peak: rnd(0.01, 0.02), a: 0.002, d: 0.05, type: 'lowpass', f0: rnd(350, 600), Q: 0.7 });
        t2 += rnd(0.08, 0.15);
      }
    }
  }

  function scheduleRumble() {
    setTimeout(() => {
      try { if (running()) distantRumble(); } catch (e) { /* ignore */ }
      scheduleRumble();
    }, rnd(8000, 20000));
  }

  function scheduleGunfire() {
    setTimeout(() => {
      try { if (running()) distantGunfire(); } catch (e) { /* ignore */ }
      scheduleGunfire();
    }, rnd(10000, 30000));
  }

  function ambience() {
    try {
      if (ambStarted) return;
      ambStarted = true;
      // sources may be started while suspended; they sound on resume
      startWind();
      scheduleRumble();
      scheduleGunfire();
    } catch (e) { /* no-throw */ }
  }

  // ------------------------------------------------------------------- misc
  function unlock() {
    try { if (ctx.state !== 'running') ctx.resume().catch(() => {}); } catch (e) { /* ignore */ }
  }

  function update(eyePos, yaw) {
    try {
      if (eyePos) { eye.x = eyePos.x; eye.y = eyePos.y; eye.z = eyePos.z; }
      if (typeof yaw === 'number' && isFinite(yaw)) listenerYaw = yaw;
    } catch (e) { /* ignore */ }
  }

  return {
    unlock,
    gunshot,
    enemyGunshot,
    reload,
    dryFire,
    footstep,
    land,
    hurt,
    hitConfirm,
    ricochet,
    ambience,
    bodyFall,
    pistolShot,
    knifeSwing,
    knifeStab,
    kick,
    kickAt,
    bounce,
    engineStart,
    engineStop,
    engineRpm,
    crash,
    skid,
    horn,
    update,
  };
}
