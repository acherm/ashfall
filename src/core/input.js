// ============================================================================
// ASHFALL — core/input.js
// Keyboard + mouse state for the FPS loop. All input is gated on pointer lock
// (document.pointerLockElement) unless window.__SHOT_MODE__ is set by the
// screenshot harness. fireHeld / aimHeld / locked are plain writable data
// properties (main.js force-sets fireHeld/aimHeld in shot scenarios).
// ============================================================================

export function createInput(canvas) {
  const down = new Set();        // codes currently held
  const pressedOnce = new Set(); // codes pressed since last consumed
  let accDx = 0;
  let accDy = 0;
  let firePressedFlag = false;

  const active = () =>
    document.pointerLockElement !== null || window.__SHOT_MODE__ === true;

  const input = {
    fireHeld: false,
    aimHeld: false,
    locked: false,
    // analog move vector from a gamepad left stick (0,0 when keyboard-driven);
    // player.js prefers it over digital keys when its magnitude is real
    moveX: 0,
    moveY: 0,
    gamepad: false,           // a pad sent input recently
    update: pollGamepad,      // main.js calls once per frame (dt seconds)

    isDown(code) {
      return down.has(code);
    },

    // true exactly once per physical press, then consumed
    pressed(code) {
      if (pressedOnce.has(code)) {
        pressedOnce.delete(code);
        return true;
      }
      return false;
    },

    takeMouseDelta() {
      const d = { dx: accDx, dy: accDy };
      accDx = 0;
      accDy = 0;
      return d;
    },

    // true exactly once per click of button 0, then consumed
    firePressed() {
      if (firePressedFlag) {
        firePressedFlag = false;
        return true;
      }
      return false;
    },

    requestLock() {
      try {
        // Prefer raw (unadjusted) mouse input where supported.
        const p = canvas.requestPointerLock({ unadjustedMovement: true });
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            try {
              canvas.requestPointerLock();
            } catch (e) {
              /* pointer lock unavailable */
            }
          });
        }
      } catch (e) {
        try {
          canvas.requestPointerLock();
        } catch (e2) {
          /* pointer lock unavailable */
        }
      }
    },
  };

  function clearAll() {
    down.clear();
    pressedOnce.clear();
    input.fireHeld = false;
    input.aimHeld = false;
    firePressedFlag = false;
    accDx = 0;
    accDy = 0;
  }

  // --- gamepad ---------------------------------------------------------------
  // Standard-mapping pads (Switch Pro & most USB pads): sticks + triggers.
  // Non-standard Nintendo-style pads (SNES/NES USB clones, mapping "") have no
  // sticks — their d-pad shows up on axes 0/1 — and few buttons, so they get a
  // reduced layout: d-pad move, face buttons fire/aim/jump/reload.
  // Gamepad input intentionally bypasses the pointer-lock gate: holding a pad
  // is unambiguous play intent, and the menu can be entered pad-only.
  const DEAD = 0.22;
  const LOOK_SPEED = 620;     // px-equivalent per second at full stick
  const padHeld = new Set();  // synthetic codes currently held by the pad
  let padFire = false, padAim = false;
  let menuPressedFlag = false;

  function padKey(code, held) {
    if (held) {
      if (!padHeld.has(code)) { padHeld.add(code); down.add(code); pressedOnce.add(code); }
    } else if (padHeld.has(code)) {
      padHeld.delete(code);
      down.delete(code);
    }
  }
  const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));
  const curve = (v) => v * Math.abs(v); // finer aim near center

  function pollGamepad(dt = 1 / 60) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) {
      if (input.gamepad) { // pad unplugged: release everything it held
        for (const c of [...padHeld]) padKey(c, false);
        padFire = padAim = false;
        input.moveX = input.moveY = 0;
        input.gamepad = false;
      }
      return;
    }
    const std = gp.mapping === 'standard';
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const ax = (i) => gp.axes[i] || 0;

    // movement: left stick (standard) or d-pad axes (SNES-style). On standard
    // pads the d-pad is reserved for weapon select, so movement is stick-only.
    let mx = dz(ax(0)), my = dz(ax(1));
    input.moveX = mx;
    input.moveY = my;
    // synthetic digital movement for consumers that only read keys (vehicles)
    padKey('KeyW', my < -0.4);
    padKey('KeyS', my > 0.4);
    padKey('KeyA', mx < -0.4);
    padKey('KeyD', mx > 0.4);

    // look: right stick (standard only)
    if (std) {
      const lx = curve(dz(ax(2))), ly = curve(dz(ax(3)));
      accDx += lx * LOOK_SPEED * dt;
      accDy += ly * LOOK_SPEED * dt;
    }

    // buttons — standard: ZR fire, ZL aim, bottom jump, left-face reload,
    // right-face interact (E), top-face pickup (Y), sticks sprint/crouch,
    // bumpers celebration/horn. Reduced pads: 0 fire, 1 jump, 2 aim, 3 reload,
    // 4/5 (if present) interact / sprint.
    const fire = std ? b(7) : b(0);
    const aim = std ? b(6) : b(2);
    // drive fireHeld/aimHeld only on pad transitions so the mouse keeps working
    if (fire !== padFire) { input.fireHeld = fire; if (fire) firePressedFlag = true; }
    if (aim !== padAim) input.aimHeld = aim;
    padFire = fire; padAim = aim;
    if (std) {
      // Switch face buttons by POSITION (W3C standard indices): index 0 = the
      // BOTTOM button (labelled B on a Switch pad), 1 = RIGHT (A), 2 = LEFT (Y),
      // 3 = TOP (X). ZR(7)=fire, ZL(6)=aim handled above.
      padKey('Space', b(0));        // B (bottom)  — jump
      padKey('KeyE', b(1));         // A (right)   — enter / exit vehicle
      padKey('KeyY', b(2));         // Y (left)    — pick up weapon
      padKey('KeyR', b(3));         // X (top)     — reload
      padKey('ShiftLeft', b(10));   // L-stick click — sprint
      padKey('ControlLeft', b(11)); // R-stick click — crouch
      padKey('KeyV', b(4));         // L bumper — SIUU celebration
      padKey('KeyH', b(5));         // R bumper — horn (in a vehicle)
      // D-pad — weapon select: up = primary, right = pistol, left = knife
      padKey('Digit1', b(12));
      padKey('Digit2', b(15));
      padKey('Digit3', b(14));
    } else {
      padKey('Space', b(1));
      padKey('KeyR', b(3));
      padKey('KeyE', b(4));
      padKey('ShiftLeft', b(5));
    }
    // start/+ (or any face button) while the menu is up → main.js starts the game
    if (std ? (b(9) || b(0)) : (b(0) || b(1))) {
      if (!input._menuHeld) { menuPressedFlag = true; input._menuHeld = true; }
    } else input._menuHeld = false;

    input.gamepad = true;
  }
  input.menuPressed = () => {
    if (menuPressedFlag) { menuPressedFlag = false; return true; }
    return false;
  };

  window.addEventListener('gamepadconnected', (e) => {
    console.log('[gamepad] connected:', e.gamepad.id, 'mapping:', e.gamepad.mapping || 'non-standard');
  });

  // --- keyboard --------------------------------------------------------------
  // Arrow keys mirror WASD so every consumer (player, vehicles) gets them free.
  const ALIAS = { ArrowUp: 'KeyW', ArrowDown: 'KeyS', ArrowLeft: 'KeyA', ArrowRight: 'KeyD' };
  window.addEventListener('keydown', (e) => {
    if (!active()) return;
    if (!e.repeat) {
      down.add(e.code);
      pressedOnce.add(e.code);
      const a = ALIAS[e.code];
      if (a) { down.add(a); pressedOnce.add(a); }
    }
    // While locked, keep game keys from scrolling / tabbing the page.
    if (document.pointerLockElement !== null) e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    // Always release, even when inactive, so keys never stick.
    down.delete(e.code);
    const a = ALIAS[e.code];
    if (a) down.delete(a);
  });

  // --- mouse -----------------------------------------------------------------
  window.addEventListener('mousemove', (e) => {
    if (!active()) return;
    // Guard against pointer-lock re-entry spikes on some browsers.
    const mx = Math.max(-500, Math.min(500, e.movementX || 0));
    const my = Math.max(-500, Math.min(500, e.movementY || 0));
    accDx += mx;
    accDy += my;
  });

  window.addEventListener('mousedown', (e) => {
    if (!active()) return;
    if (e.button === 0) {
      input.fireHeld = true;
      firePressedFlag = true;
    } else if (e.button === 2) {
      input.aimHeld = true;
    }
  });

  window.addEventListener('mouseup', (e) => {
    // Always release buttons, even when inactive.
    if (e.button === 0) input.fireHeld = false;
    else if (e.button === 2) input.aimHeld = false;
  });

  // --- pointer lock / focus ----------------------------------------------------
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) clearAll();
  });

  document.addEventListener('pointerlockerror', () => {
    input.locked = false;
  });

  window.addEventListener('blur', clearAll);

  // --- context menu (right mouse = ADS, never a menu) ----------------------------
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => {
    if (document.pointerLockElement !== null || e.target === canvas) {
      e.preventDefault();
    }
  });

  return input;
}
