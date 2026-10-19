/*
 * Input — one stream of actions from the keyboard and any standard gamepad
 * (Xbox, PlayStation, Switch Pro), via the browser Gamepad API.
 *
 * Emits:
 *   lane(lane, down, timeMs)   fret presses; timeMs is on the performance.now() clock
 *   action(name)               up/down/left/right, confirm, back, pause, overdrive
 *   device(info)               the active device changed (for on-screen button labels)
 */
'use strict';
(function (root) {
  const KEYS = ['a', 's', 'd', 'f', 'g'];
  // Keyboard lanes by lane count. Duo (2 lanes) uses one finger per hand.
  const KEY_LAYOUTS = { 2: ['f', 'j'], 3: ['a', 's', 'd'], 4: ['a', 's', 'd', 'f'], 5: KEYS };
  const keysFor = (lanes) => KEY_LAYOUTS[lanes] || KEYS;
  // Standard Gamepad mapping indices.
  const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  // Lane layouts: left hand on the shoulders, right thumb on the face button.
  const PAD_LANES = {
    2: [[B.LB, B.LT, B.LEFT], [B.RB, B.RT, B.RIGHT]],
    3: [[B.LB, B.LT], [B.A, B.X, B.B], [B.RB, B.RT]],
    4: [[B.LB, B.LT], [B.A, B.X, B.B], [B.RB], [B.RT]],
    5: [[B.LT], [B.LB], [B.A, B.X, B.B], [B.RB], [B.RT]],
  };
  const GLYPHS = {
    xbox: { LT: 'LT', LB: 'LB', A: 'A', RB: 'RB', RT: 'RT', Y: 'Y', B: 'B', START: 'MENU' },
    playstation: { LT: 'L2', LB: 'L1', A: '✕', RB: 'R1', RT: 'R2', Y: '△', B: '○', START: 'OPTIONS' },
    nintendo: { LT: 'ZL', LB: 'L', A: 'B', RB: 'R', RT: 'ZR', Y: 'X', B: 'A', START: '+' },
  };
  const LANE_BUTTON_NAMES = { 2: ['LB', 'RB'], 3: ['LB', 'A', 'RB'], 4: ['LB', 'A', 'RB', 'RT'], 5: ['LT', 'LB', 'A', 'RB', 'RT'] };

  const listeners = { lane: [], action: [], device: [] };
  const emit = (type, ...args) => listeners[type].forEach((fn) => fn(...args));

  let laneCount = 5;
  let gameplay = false;
  const TOUCH = { type: 'touch', family: null, name: 'Touch' };
  // Start in touch mode on phones and tablets (main pointer is a finger).
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  let device = coarse ? TOUCH : { type: 'keyboard', family: null, name: 'Keyboard' };
  const padState = new Map(); // index → { buttons: bool[], lanes: bool[], axes, repeatAt }

  function familyOf(id) {
    const s = id.toLowerCase();
    // Check Xbox first: Xbox pads also call themselves "Wireless Controller".
    if (/xbox|xinput|045e/.test(s)) return 'xbox';
    if (/054c|playstation|dualshock|dualsense|wireless controller/.test(s)) return 'playstation';
    if (/057e|nintendo|pro controller|joy-con/.test(s)) return 'nintendo';
    return 'xbox';
  }

  function setDevice(next) {
    if (next.type === device.type && next.family === device.family) return;
    device = next;
    emit('device', device);
  }

  // ---- keyboard -------------------------------------------------------------------

  function isTextField(el) {
    return el && (el.tagName === 'INPUT' && !['range', 'button', 'checkbox', 'file'].includes(el.type) || el.tagName === 'TEXTAREA');
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (gameplay) {
      const lane = keysFor(laneCount).indexOf(key);
      if (lane >= 0 && lane < laneCount) {
        e.preventDefault();
        if (!e.repeat) { setDevice({ type: 'keyboard', family: null, name: 'Keyboard' }); emit('lane', lane, true, e.timeStamp); }
        return;
      }
      if (key === ' ' || key === 'Enter') { e.preventDefault(); if (!e.repeat) emit('action', 'overdrive'); return; }
      if (key === 'Escape') { e.preventDefault(); emit('action', 'pause'); return; }
      if (key === 'r') { e.preventDefault(); if (!e.repeat) emit('action', 'restart-down'); return; }
      return;
    }
    if (isTextField(e.target)) return;
    const el = document.activeElement;
    const arrows = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (arrows[key]) {
      // Let sliders keep their native left/right behaviour.
      if (el && el.type === 'range' && (key === 'ArrowLeft' || key === 'ArrowRight')) return;
      e.preventDefault();
      setDevice({ type: 'keyboard', family: null, name: 'Keyboard' });
      emit('action', arrows[key]);
    } else if (key === 'Escape' || key === 'Backspace') {
      e.preventDefault();
      emit('action', 'back');
    }
  });

  window.addEventListener('keyup', (e) => {
    if (!gameplay) return;
    if (e.key === 'r' || e.key === 'R') { emit('action', 'restart-up'); return; }
    const lane = keysFor(laneCount).indexOf(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (lane >= 0 && lane < laneCount) emit('lane', lane, false, e.timeStamp);
  });

  // ---- gamepads ----------------------------------------------------------------------

  function pressed(btn, wasDown) {
    if (!btn) return false;
    // Hysteresis on analog triggers so a half-pressed trigger doesn't chatter.
    return btn.pressed || btn.value > (wasDown ? 0.35 : 0.55);
  }

  function pollPads() {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    const now = performance.now();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      let st = padState.get(pad.index);
      if (!st) {
        st = { buttons: [], lanes: [false, false, false, false, false], dir: null, repeatAt: 0 };
        padState.set(pad.index, st);
      }
      // Gamepad.timestamp is when the state last changed (performance clock).
      const ts = pad.timestamp && Math.abs(now - pad.timestamp) < 100 ? pad.timestamp : now;
      const down = pad.buttons.map((b, i) => pressed(b, st.buttons[i]));
      const edge = (i) => down[i] && !st.buttons[i];
      const any = down.some((d, i) => d && !st.buttons[i]);
      if (any) setDevice({ type: 'gamepad', family: familyOf(pad.id), name: pad.id });

      if (gameplay) {
        const map = PAD_LANES[laneCount] || PAD_LANES[5];
        map.forEach((buttons, lane) => {
          const isDown = buttons.some((i) => down[i]);
          if (isDown !== st.lanes[lane]) {
            st.lanes[lane] = isDown;
            emit('lane', lane, isDown, ts);
          }
        });
        if (edge(B.Y)) emit('action', 'overdrive');
        // Hold Back (View / Share / −) to restart.
        if (edge(B.BACK)) emit('action', 'restart-down');
        if (!down[B.BACK] && st.buttons[B.BACK]) emit('action', 'restart-up');
        if (edge(B.START)) emit('action', 'pause');
      } else {
        st.lanes.fill(false);
        if (edge(B.A)) emit('action', 'confirm');
        if (edge(B.B)) emit('action', 'back');
        if (edge(B.START)) emit('action', 'confirm');
        // D-pad or left stick, with key-repeat when held.
        const ax = pad.axes[0] || 0;
        const ay = pad.axes[1] || 0;
        const dir = down[B.UP] || ay < -0.6 ? 'up' : down[B.DOWN] || ay > 0.6 ? 'down'
          : down[B.LEFT] || ax < -0.6 ? 'left' : down[B.RIGHT] || ax > 0.6 ? 'right' : null;
        if (dir && dir !== st.dir) { emit('action', dir); st.repeatAt = now + 380; setDevice({ type: 'gamepad', family: familyOf(pad.id), name: pad.id }); }
        else if (dir && now >= st.repeatAt) { emit('action', dir); st.repeatAt = now + 110; }
        st.dir = dir;
      }
      st.buttons = down;
    }
  }
  // Poll every 4 ms rather than once per frame, so a quick press never falls
  // between two slow frames and input delay stays low.
  setInterval(pollPads, 4);

  window.addEventListener('gamepaddisconnected', (e) => {
    padState.delete(e.gamepad.index);
    if (device.type === 'gamepad') setDevice({ type: 'keyboard', family: null, name: 'Keyboard' });
  });

  // ---- touch ---------------------------------------------------------------------------

  // Any finger on the screen switches to touch; the last input used wins.
  window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') setDevice(TOUCH); }, true);

  /**
   * Play with fingers on `canvas`. `resolve(clientX, clientY)` says what a
   * touch means: { type: 'lane', lane } | { type: 'overdrive' } | { type: 'pause' } | null.
   * Each finger keeps the lane it landed on until it lifts, so holds work and
   * several fingers can press at once.
   */
  function attachTouch(canvas, resolve) {
    const fingers = new Map(); // pointerId → lane
    const pressedBy = (lane) => [...fingers.values()].filter((l) => l === lane).length;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || !gameplay) return;
      e.preventDefault();
      setDevice(TOUCH);
      const hit = resolve(e.clientX, e.clientY);
      if (!hit) return;
      if (hit.type === 'lane') {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
        const first = pressedBy(hit.lane) === 0;
        fingers.set(e.pointerId, hit.lane);
        if (first) emit('lane', hit.lane, true, e.timeStamp);
      } else emit('action', hit.type);
    });
    const lift = (e) => {
      if (!fingers.has(e.pointerId)) return;
      const lane = fingers.get(e.pointerId);
      fingers.delete(e.pointerId);
      if (pressedBy(lane) === 0) emit('lane', lane, false, e.timeStamp);
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
    return { release() { fingers.forEach((lane, id) => lift({ pointerId: id, timeStamp: performance.now() })); } };
  }

  /** Labels for each lane on the current device. */
  function laneLabels(lanes) {
    if (device.type === 'touch') return [];
    if (device.type !== 'gamepad') return keysFor(lanes).map((k) => k.toUpperCase());
    const g = GLYPHS[device.family] || GLYPHS.xbox;
    return LANE_BUTTON_NAMES[lanes].map((n) => g[n]);
  }

  function glyph(name) {
    if (device.type === 'touch') return { overdrive: 'TAP OD', pause: 'II', confirm: 'TAP', back: 'BACK' }[name];
    if (device.type !== 'gamepad') return { overdrive: 'SPACE', pause: 'ESC', confirm: 'ENTER', back: 'ESC' }[name];
    const g = GLYPHS[device.family] || GLYPHS.xbox;
    return { overdrive: g.Y, pause: g.START, confirm: g.A, back: g.B }[name];
  }

  root.Input = {
    on: (type, fn) => listeners[type].push(fn),
    /** Is any controller connected right now? */
    padConnected() {
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      return pads.some((p) => p && p.connected);
    },
    setGameplay(on, lanes) {
      gameplay = on;
      if (lanes) laneCount = lanes;
      padState.forEach((st) => st.lanes.fill(false));
    },
    get device() { return device; },
    get touch() { return device.type === 'touch'; },
    attachTouch,
    laneLabels,
    glyph,
    KEYS,
  };
})(window);
