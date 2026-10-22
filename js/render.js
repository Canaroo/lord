/*
 * Stage — draws the game at a 16-bit console resolution (400×225) into an
 * off-screen buffer, then scales it up with crisp, unsmoothed pixels.
 *
 * The highway is rasterised one scanline at a time with per-row perspective,
 * the same trick as SNES "Mode 7" racing floors. Every shape is built from
 * whole-pixel rectangles, so nothing is anti-aliased.
 */
'use strict';
(function (root) {
  // The buffer size and highway placement depend on the layout:
  //   keys   — desktop 400×225 (keyboard / controller)
  //   touch4 — phone sideways: as wide as the screen's shape, 4 big lanes
  //   touch2 — phone upright: as tall as the screen's shape, 2 big lanes
  let W = 400;
  let H = 225;
  let HORIZON = 64;
  let HIT_Y = 192;
  let LAYOUT = 'keys';
  // Strike line limits per phone layout (fraction of height from the top).
  const STRIKE_RANGE = { touch4: [0.6, 0.84], touch2: [0.68, 0.9] };
  const HUD_TOP = 26; // touch: taps above this line are the top strip (pause), below are lanes
  const PERSPECTIVE = 3;
  const FONT = '"Press Start 2P", monospace';

  const PAL = {
    ink: '#08081a',
    sky: ['#07071a', '#0b0b26', '#110f33', '#181342', '#201650', '#2a1a5c'],
    trackA: '#191c48',
    trackB: '#1f2358',
    trackOdA: '#0d2d58',
    trackOdB: '#123a70',
    divider: '#3a3f86',
    rail: '#8890e8',
    railOd: '#58f8f8',
    beat: '#5a62b8',
    measure: '#9aa2f0',
    white: '#f4f4ff',
    grey: '#9aa0d0',
    dim: '#5a5f96',
    cyan: '#58f8f8',
    magenta: '#f858c8',
    gold: '#f8d830',
    red: '#f84848',
    green: '#38d838',
    window: '#1a2378',
    windowEdge: '#c8ccf8',
  };
  const LANES = ['#38d838', '#f83838', '#f8d830', '#3878f8', '#f88820'];
  const LANES_DARK = ['#187818', '#901818', '#a08010', '#1840a0', '#a04808'];
  const LANES_LIGHT = ['#a8f8a8', '#f8a0a0', '#f8f0a0', '#a8c8f8', '#f8c890'];
  const SKIN = ['#f0c8a0', '#d8a070', '#a87048', '#704830'];
  const SHIRTS = ['#3878f8', '#f83838', '#38d838', '#f8d830', '#a878f8', '#f88820', '#e8e8f8', '#303048'];

  function seeded(seed) {
    let s = seed;
    return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  }

  // A fixed crowd on each side of the highway (desktop layout).
  let CROWD = [];
  const buildCrowd = () => {
    const r = seeded(42);
    const people = [];
    for (let row = 0; row < 5; row++) {
      const y = 168 + row * 12;
      for (let x = -4 + (row % 2) * 6; x < W; x += 11 + Math.floor(r() * 4)) {
        const edge = 100 + (y - 168) * 0.55;
        if (x > edge - 14 && x < W - edge + 4) continue;
        people.push({ x, y, skin: SKIN[Math.floor(r() * 4)], shirt: SHIRTS[Math.floor(r() * SHIRTS.length)], ph: r() });
      }
    }
    return people.sort((a, b) => a.y - b.y);
  };
  CROWD = buildCrowd();

  /** Darken (<1) or lighten (>1) a #rrggbb colour. */
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('');
  }

  function beatIndexAt(beats, t) {
    let lo = 0, hi = beats.length - 1;
    if (!beats.length || t < beats[0]) return -1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= t) lo = mid; else hi = mid;
    }
    return t >= beats[hi] ? hi : lo;
  }

  class Stage {
    constructor(canvas) {
      this.strike = { touch4: 0.72, touch2: 0.8 };
      this.setupMode = false;
      this.canvas = canvas;
      this.out = canvas.getContext('2d');
      this.buf = document.createElement('canvas');
      this.buf.width = W;
      this.buf.height = H;
      this.g = this.buf.getContext('2d');
      this.particles = [];
      this.flames = [];
      this.shake = 0;
      this.flash = 0;
      this.lastMs = performance.now();
      this.shakeEnabled = true;
      this.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // ---- pixel primitives --------------------------------------------------------

    rect(x, y, w, h, c) {
      this.g.fillStyle = c;
      this.g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    }

    ellipse(cx, cy, rx, ry, c) {
      if (rx < 0.5 || ry < 0.5) return;
      this.g.fillStyle = c;
      const r = Math.ceil(ry);
      for (let dy = -r; dy <= r; dy++) {
        const k = 1 - (dy * dy) / (ry * ry);
        if (k < 0) continue;
        const w = Math.round(rx * Math.sqrt(k));
        this.g.fillRect(Math.round(cx) - w, Math.round(cy) + dy, w * 2 + 1, 1);
      }
    }

    text(str, x, y, color, size = 8, align = 'left') {
      const g = this.g;
      g.font = `${size}px ${FONT}`;
      g.textBaseline = 'top';
      g.textAlign = align;
      g.fillStyle = PAL.ink;
      g.fillText(str, Math.round(x) + 1, Math.round(y) + 1);
      g.fillStyle = color;
      g.fillText(str, Math.round(x), Math.round(y));
    }

    window(x, y, w, h) {
      this.rect(x, y, w, h, PAL.ink);
      this.rect(x + 1, y + 1, w - 2, h - 2, PAL.windowEdge);
      this.rect(x + 2, y + 2, w - 4, h - 4, PAL.window);
      this.rect(x + 2, y + 2, w - 4, 1, '#3a48b8');
    }

    // ---- effects api (called by the game) -----------------------------------------------

    burst(x, y, color, n = 10, speed = 70) {
      if (this.reducedMotion) n = Math.ceil(n / 3);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI * (0.1 + 0.8 * Math.random());
        const v = speed * (0.4 + Math.random());
        this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.3, color });
      }
    }

    kick(amount) {
      if (this.shakeEnabled && !this.reducedMotion) this.shake = Math.max(this.shake, amount);
    }

    flashScreen(amount) {
      if (!this.reducedMotion) this.flash = Math.max(this.flash, amount);
    }

    flame(lane) {
      this.flames.push({ lane, at: performance.now() });
    }

    /** The multiplier just stepped up: a small flash and a badge pop. */
    levelUp(level) {
      this.levelUpAt = performance.now();
      this.levelUpTo = level;
      this.flashScreen(0.08 + level * 0.03);
    }

    // ---- geometry ----------------------------------------------------------------------------

    /**
     * Switch layout. `aspect` is the screen's width / height, so phone layouts
     * fill the screen instead of letterboxing. Returns true if anything changed.
     */
    /**
     * Phones: where the strike line sits, as a fraction of the screen height from
     * the top. Players can move it to suit how they hold the phone.
     */
    setStrike(mode, frac) {
      const [lo, hi] = STRIKE_RANGE[mode];
      this.strike[mode] = Math.max(lo, Math.min(hi, frac));
      if (LAYOUT === mode) this.setLayout(mode, this.aspect);
    }

    setLayout(mode, aspect = 16 / 9) {
      this.aspect = aspect;
      let w = 400, h = 225, hz = 64, hit = 192;
      if (mode === 'touch4') {
        w = Math.max(400, Math.min(488, Math.round(225 * aspect)));
        hz = 58;
        // The strike line sits at ~72% height; the lanes carry on below it as big
        // tap pads, so thumbs rest under the line and never hide incoming notes.
        hit = Math.round(h * this.strike.touch4);
      } else if (mode === 'tiles') {
        // Tiles mode: an upright board, whatever the screen.
        w = 225;
        h = Math.max(380, Math.min(500, Math.round(225 / Math.min(1, aspect))));
        hz = 0;
        hit = Math.round(h * 0.8);
      } else if (mode === 'touch2') {
        w = 225;
        h = Math.max(360, Math.min(500, Math.round(225 / Math.min(1, aspect))));
        hz = Math.round(h * 0.32);
        hit = Math.round(h * this.strike.touch2);
      }
      if (mode === LAYOUT && w === W && h === H && hit === HIT_Y) return false;
      LAYOUT = mode;
      W = w; H = h; HORIZON = hz; HIT_Y = hit;
      this.buf.width = W;
      this.buf.height = H;
      CROWD = buildCrowd();
      this.particles = [];
      return true;
    }

    get layout() { return LAYOUT; }
    get height() { return H; }
    get width() { return W; }

    geometry(lanes) {
      const halfW = LAYOUT === 'touch4' ? Math.min(W * 0.36, 150)
        : LAYOUT === 'touch2' ? Math.min(W * 0.42, 96)
        : { 2: 44, 3: 60, 4: 72 }[lanes] || 82;
      return {
        cx: W / 2,
        halfW,
        laneW: (2 * halfW) / lanes,
        scale: (z) => 1 / (1 + PERSPECTIVE * z),
        yAt(z) { return HORIZON + (HIT_Y - HORIZON) * this.scale(z); },
        laneX(lane) { return (lane - (lanes - 1) / 2) * this.laneW; },
      };
    }

    // ---- frame -----------------------------------------------------------------------------------

    /**
     * @param {object} v  view: { t, beats, lanes, notes, nextIdx, lookahead, held, labels,
     *                     hud?, judgement?, banners?, odActive, rock, countdown?, attract? }
     */
    draw(v) {
      const nowMs = performance.now();
      const dt = Math.min(0.05, (nowMs - this.lastMs) / 1000);
      this.lastMs = nowMs;
      const geo = this.geometry(v.lanes);
      const bi = beatIndexAt(v.beats, v.t);
      const b0 = bi >= 0 ? v.beats[bi] : 0;
      const b1 = bi >= 0 && bi + 1 < v.beats.length ? v.beats[bi + 1] : b0 + 0.5;
      const phase = bi >= 0 ? Math.min(1, (v.t - b0) / (b1 - b0 || 0.5)) : 0;
      const pulse = Math.max(0, 1 - phase * 3); // 1 on the beat, fading quickly
      const hype = v.rock == null ? 0.7 : v.rock;
      // Stage energy follows the streak: 0 at ×1 up to 3 at ×4 (or overdrive).
      // Losing a long streak "powers down" the stage for a moment.
      const powerDown = v.powerDownAt ? Math.max(0, 1 - (nowMs - v.powerDownAt) / 900) : 0;
      const level = v.attract ? 3 : v.level || 1;
      const energy = (v.odActive ? 3 : level - 1) * (1 - powerDown);

      this.drawBackdrop(v, bi, phase, pulse, energy, powerDown);
      this.drawGuitarist(v, bi, phase, energy, powerDown);
      if (LAYOUT === 'keys') this.drawCrowd(bi, phase, hype, energy, v.attract);
      this.drawHighway(v, geo, pulse, level, energy);
      if (v.hud && LAYOUT !== 'keys') this.drawTrackHud(v, geo, nowMs);
      this.drawFrets(v, geo);
      this.drawNotes(v, geo);
      this.drawFlames(v, geo, nowMs, energy);
      if (v.fingers) this.drawGrabs(v, geo, nowMs);
      this.drawParticles(dt);
      if (powerDown > 0) {
        this.g.fillStyle = `rgba(8,8,26,${0.45 * powerDown})`;
        this.g.fillRect(0, 0, W, H);
      }
      this.drawEdges(v, pulse, level, energy);
      if (v.hud) this.drawHud(v, nowMs);
      if (this.setupMode && LAYOUT !== 'keys') this.drawStrikeHandle(geo, nowMs);
      this.blit(dt);
    }

    drawBackdrop(v, bi, phase, pulse, energy, powerDown) {
      const g = this.g;
      // Sky in hard bands, like a limited palette.
      const bandH = Math.ceil(HORIZON / PAL.sky.length);
      PAL.sky.forEach((c, i) => this.rect(0, i * bandH, W, bandH, c));
      // Dither the band seams.
      for (let i = 1; i < PAL.sky.length; i++) {
        const y = i * bandH - 1;
        g.fillStyle = PAL.sky[i];
        for (let x = (i % 2); x < W; x += 2) g.fillRect(x, y, 1, 1);
      }
      // Stars; at full energy they streak past like a warp.
      const r = seeded(7);
      const warp = Math.max(0, energy - 2);
      for (let i = 0; i < 40; i++) {
        const x = Math.floor(r() * W);
        let y = Math.floor(r() * (HORIZON - 20));
        const tw = Math.sin(v.t * 2 + i) > 0.6;
        if (warp > 0) {
          y = (y + v.t * (30 + (i % 5) * 12)) % (HORIZON - 14);
          this.g.globalAlpha = 0.5 + 0.5 * warp;
          this.rect(x, y, 1, 2 + Math.round(3 * warp), tw ? PAL.white : PAL.dim);
          this.g.globalAlpha = 1;
        } else this.rect(x, y, 1, 1, tw ? PAL.white : PAL.dim);
      }
      // Lighting truss.
      this.rect(0, 6, W, 5, '#2a2a40');
      this.rect(0, 6, W, 1, '#4a4a68');
      for (let x = 3; x < W; x += 8) this.rect(x, 8, 2, 2, '#16162a');
      // Lamps and beams, colours cycling every beat.
      const beamColors = [PAL.magenta, PAL.cyan, PAL.gold, '#a878f8'];
      const lamps = 6;
      g.save();
      for (let i = 0; i < lamps; i++) {
        const lx = 34 + i * ((W - 68) / (lamps - 1));
        const color = beamColors[(Math.max(0, bi) + i) % beamColors.length];
        const sway = Math.sin(v.t * (0.5 + 0.35 * energy) + i * 1.7) * (25 + 10 * energy);
        g.globalAlpha = ((v.odActive ? 0.2 : 0.035 + 0.03 * energy) + (0.03 + 0.04 * energy) * pulse) * (1 - powerDown);
        g.fillStyle = v.odActive ? PAL.cyan : color;
        for (let y = 12; y < HORIZON + 30; y += 1) {
          const k = (y - 12) / (HORIZON + 18);
          const cx = lx + sway * k;
          const w = 2 + k * 26;
          g.fillRect(Math.round(cx - w / 2), y, Math.round(w), 1);
        }
        g.globalAlpha = 1;
        this.rect(lx - 3, 11, 7, 4, '#3a3a58');
        this.rect(lx - 2, 15, 5, 2, powerDown > 0.5 ? '#2a2a40' : v.odActive ? PAL.cyan : color);
      }
      // ×4 and overdrive: two lasers sweep across the stage.
      if (energy > 2.2) {
        g.globalAlpha = 0.35 * (energy - 2.2) / 0.8;
        for (const side of [0, 1]) {
          const x0 = side ? W - 4 : 4;
          const target = W / 2 + Math.sin(v.t * 1.3 + side * Math.PI) * 150;
          g.fillStyle = side ? PAL.magenta : PAL.cyan;
          for (let y = 12; y < HORIZON + 40; y += 1) {
            const k = (y - 12) / (HORIZON + 28);
            g.fillRect(Math.round(x0 + (target - x0) * k), y, 1, 1);
          }
        }
        g.globalAlpha = 1;
      }
      g.restore();
      // Floor.
      this.rect(0, HORIZON, W, H - HORIZON, '#0c0c22');
      this.rect(0, HORIZON, W, 1, v.odActive ? PAL.cyan : '#3a3070');
      // Speaker stacks, cones thump on the beat (desktop only: on a phone the
      // highway needs the room).
      for (const sx of LAYOUT === 'keys' ? [8, W - 50] : []) {
        for (let k = 0; k < 3; k++) {
          const sy = 70 + k * 32;
          this.rect(sx, sy, 42, 30, '#1a1a2a');
          this.rect(sx + 1, sy + 1, 40, 28, '#26263a');
          const cr = 9 + (k === 2 ? 1.5 : 0.5) * pulse;
          this.ellipse(sx + 21, sy + 15, cr + 1, cr + 1, '#0e0e18');
          this.ellipse(sx + 21, sy + 15, cr, cr, '#3a3a52');
          this.ellipse(sx + 21, sy + 15, cr * 0.35, cr * 0.35, '#5a5a78');
        }
      }
    }

    drawCrowd(bi, phase, hype, energy, attract) {
      // The crowd gets into it as the streak builds; it sulks when you're failing.
      const jump = hype < 0.25 && !attract ? 0 : energy >= 2.5 ? 2 : energy >= 0.8 ? 1 : 0;
      for (const p of CROWD) {
        const offbeat = (bi + (p.ph > 0.5 ? 1 : 0)) % 2 === 0;
        const bob = jump && phase < 0.35 && (offbeat || jump === 2) ? -jump : 0;
        const y = p.y + bob;
        const dim = hype < 0.25 && !attract;
        // Arms up when the crowd is into it.
        if (energy >= 1.8 && hype >= 0.25 && (p.ph * 10 + bi) % 3 < 1.2) {
          this.rect(p.x - 1, y - 6, 1, 6, p.skin);
          this.rect(p.x + 7, y - 6, 1, 6, p.skin);
        }
        this.rect(p.x, y + 3, 7, 10, dim ? '#202030' : p.shirt);
        this.rect(p.x + 1, y - 3, 5, 6, dim ? '#303040' : p.skin);
        this.rect(p.x + 1, y - 3, 5, 1, '#201810');
      }
    }

    drawHighway(v, geo, pulse, level, energy) {
      const railColor = [PAL.rail, PAL.green, PAL.gold, PAL.magenta][level - 1] || PAL.rail;
      const g = this.g;
      const { cx, halfW } = geo;
      const lanes = v.lanes;
      const od = v.odActive;
      let prevBeat = null;
      for (let y = HORIZON + 1; y < H; y++) {
        const s = (y - HORIZON) / (HIT_Y - HORIZON);
        const z = (1 / s - 1) / PERSPECTIVE;
        const half = halfW * s;
        if (half < 1) continue;
        const time = v.t + z * v.lookahead;
        const b = beatIndexAt(v.beats, time);
        const fade = Math.max(0, Math.min(1, (z - 0.9) / 1.6));
        g.globalAlpha = 1 - fade * 0.9;
        const even = (b & 1) === 0;
        g.fillStyle = od ? (even ? PAL.trackOdA : PAL.trackOdB) : even ? PAL.trackA : PAL.trackB;
        const x0 = Math.round(cx - half);
        const w = Math.round(half * 2);
        g.fillRect(x0, y, w, 1);
        // Held lanes glow near the frets.
        if (z < 0.5 && v.held) {
          for (let l = 0; l < lanes; l++) {
            if (!v.held[l]) continue;
            g.globalAlpha = (0.5 - z) * 0.5 * (1 - fade);
            g.fillStyle = LANES[l];
            g.fillRect(Math.round(x0 + (l * w) / lanes), y, Math.round(w / lanes), 1);
          }
          g.globalAlpha = 1 - fade * 0.9;
        }
        // Beat and bar lines.
        if (prevBeat !== null && b !== prevBeat && b >= 0) {
          g.fillStyle = b % 4 === 0 ? (energy >= 1.8 ? PAL.white : PAL.measure) : energy >= 1.8 ? PAL.measure : PAL.beat;
          g.fillRect(x0, y, w, 1);
        }
        prevBeat = b;
        // Lane dividers and rails.
        g.fillStyle = PAL.divider;
        for (let i = 1; i < lanes; i++) g.fillRect(Math.round(x0 + (i * w) / lanes), y, 1, 1);
        g.fillStyle = od ? PAL.railOd : v.rock != null && v.rock < 0.25 && pulse > 0.5 ? PAL.red : railColor;
        const railW = s > 0.6 ? 2 : 1;
        g.fillRect(x0 - railW, y, railW, 1);
        g.fillRect(x0 + w, y, railW, 1);
      }
      g.globalAlpha = 1;
      // Strike line.
      const hy = Math.round(geo.yAt(0));
      this.rect(cx - halfW - 2, hy - 1, halfW * 2 + 4, 3, PAL.ink);
      this.rect(cx - halfW - 2, hy, halfW * 2 + 4, 1, od ? PAL.cyan : PAL.white);
    }

    drawFrets(v, geo) {
      if (LAYOUT !== 'keys') { this.drawPads(v, geo); return; }
      const y = geo.yAt(0);
      const rx = geo.laneW * 0.36;
      for (let l = 0; l < v.lanes; l++) {
        const x = geo.cx + geo.laneX(l);
        const down = v.held && v.held[l];
        this.ellipse(x, y + 2, rx + 1, rx * 0.5 + 1, PAL.ink);
        this.ellipse(x, y + 2, rx, rx * 0.5, LANES_DARK[l]);
        const lift = down ? 0 : 3;
        this.ellipse(x, y + 2 - lift, rx, rx * 0.5, down ? LANES_LIGHT[l] : LANES[l]);
        this.ellipse(x, y + 2 - lift, rx * 0.55, rx * 0.26, down ? PAL.white : '#0e0e20');
        if (v.labels && v.labels[l]) this.text(v.labels[l], x, y + 12, down ? PAL.white : PAL.grey, 8, 'center');
      }
    }

    /**
     * Phones: each lane continues below the strike line to the bottom of the screen
     * as a big tap pad (it lights up while pressed), with a solid strike plate on
     * the line. The whole pad is the touch target, not just the plate.
     */
    drawPads(v, geo) {
      const g = this.g;
      const ready = v.hud && v.hud.odReady && !v.odActive;
      const hy = Math.round(geo.yAt(0));
      for (let l = 0; l < v.lanes; l++) {
        const down = v.held && v.held[l];
        for (let y = hy + 3; y < H; y++) {
          const sc = (y - HORIZON) / (HIT_Y - HORIZON);
          const x0 = geo.cx + (l - v.lanes / 2) * geo.laneW * sc;
          const w = geo.laneW * sc;
          const k = (y - hy) / (H - hy); // 0 at the line, 1 at the bottom
          g.globalAlpha = down ? 0.6 - 0.25 * k : 0.34 - 0.16 * k;
          g.fillStyle = down ? LANES_LIGHT[l] : ready && (y >> 2) % 2 ? PAL.cyan : LANES_DARK[l];
          g.fillRect(Math.round(x0 + 2 * sc), y, Math.round(w - 4 * sc), 1);
          // Pad edges.
          g.globalAlpha = down ? 0.9 : 0.45;
          g.fillStyle = LANES[l];
          g.fillRect(Math.round(x0 + 2 * sc), y, 1, 1);
          g.fillRect(Math.round(x0 + w - 2 * sc) - 1, y, 1, 1);
        }
        g.globalAlpha = 1;
        // Strike plate: a solid bar across the lane on the line.
        const x0 = geo.cx + (l - v.lanes / 2) * geo.laneW + 2;
        const w = geo.laneW - 4;
        this.rect(x0 - 1, hy - 4, w + 2, 9, PAL.ink);
        this.rect(x0, hy - 3, w, 7, down ? LANES_LIGHT[l] : LANES_DARK[l]);
        this.rect(x0, hy - 3, w, 2, down ? PAL.white : LANES[l]);
        this.rect(x0 + 3, hy + 1, w - 6, 1, down ? PAL.white : '#0e0e20');
      }
    }

    /** A long note's tail, from zFrom (nearer) to zTo (further), drawn scanline by scanline. */
    drawTail(geo, lane, zFrom, zTo, body, core, alpha, laneAtZ = null) {
      const a = Math.max(-0.08, zFrom);
      const b = Math.min(1.15, zTo);
      if (b <= a) return;
      const yNear = Math.round(geo.yAt(a));
      const yFar = Math.round(geo.yAt(b));
      const g = this.g;
      g.globalAlpha = alpha;
      for (let y = yFar; y <= yNear; y++) {
        const s = (y - HORIZON) / (HIT_Y - HORIZON);
        if (laneAtZ) {
          // Slide: the tail follows its path, edged in white with stripes running down it.
          const z = (1 / s - 1) / PERSPECTIVE;
          const x = geo.cx + geo.laneX(laneAtZ(z)) * s;
          const w = Math.max(1, geo.laneW * 0.3 * s);
          g.fillStyle = PAL.white;
          g.fillRect(Math.round(x - w) - 1, y, Math.round(w * 2) + 2, 1);
          g.fillStyle = body;
          g.fillRect(Math.round(x - w), y, Math.round(w * 2) || 1, 1);
          if (w > 2 && (y + Math.floor(performance.now() / 40)) % 9 < 3) {
            g.fillStyle = core;
            g.fillRect(Math.round(x - w * 0.6), y, Math.max(1, Math.round(w * 1.2)), 1);
          }
          continue;
        }
        const x = geo.cx + geo.laneX(lane) * s;
        const w = Math.max(1, geo.laneW * (LAYOUT === 'keys' ? 0.15 : 0.22) * s);
        g.fillStyle = body;
        g.fillRect(Math.round(x - w), y, Math.round(w * 2) || 1, 1);
        if (w > 2) {
          g.fillStyle = core;
          g.fillRect(Math.round(x - w * 0.35), y, Math.max(1, Math.round(w * 0.7)), 1);
        }
      }
      g.globalAlpha = 1;
    }

    drawTails(v, geo) {
      const zOf = (time) => (time - v.t) / v.lookahead;
      const path = (n) => (n.slide ? (z) => ChartGen.slideLaneAt(n, v.t + z * v.lookahead) : null);
      // Tails being held (or let go) right now run from the strike line.
      for (const h of v.holds || []) {
        const down = v.held && v.held[h.lane];
        this.drawTail(geo, h.lane, 0, zOf(h.holdEnd), down ? LANES_LIGHT[h.lane] : LANES_DARK[h.lane], down ? PAL.white : LANES[h.lane], down ? 1 : 0.55, path(h));
        if (h.slide) {
          // Where the thumb should be right now: a bracket on the strike line.
          const x = geo.cx + geo.laneX(ChartGen.slideLaneAt(h, v.t));
          const hy = Math.round(geo.yAt(0));
          const hw = Math.round(geo.laneW * 0.48);
          const c = Math.floor(performance.now() / 120) % 2 ? PAL.white : LANES_LIGHT[h.lane];
          this.rect(x - hw, hy - 9, hw * 2, 2, c);
          this.rect(x - hw, hy + 7, hw * 2, 2, c);
          this.rect(x - hw, hy - 9, 2, 18, c);
          this.rect(x + hw - 2, hy - 9, 2, 18, c);
        }
        if (down && LAYOUT === 'keys') {
          const y = geo.yAt(0);
          const x = geo.cx + geo.laneX(h.lane);
          const r = geo.laneW * 0.3;
          this.ellipse(x, y - 1, r, r * 0.5, LANES_LIGHT[h.lane]);
          this.ellipse(x, y - 1, r * 0.5, r * 0.25, PAL.white);
        }
      }
      // Tails of notes still coming, and grey tails of missed ones.
      for (let i = Math.max(0, (v.nextIdx || 0) - 30); i < v.notes.length; i++) {
        const n = v.notes[i];
        const z = zOf(n.t);
        if (z > 1.15) break;
        if (!n.len) continue;
        if (n.judged === 'miss') this.drawTail(geo, n.lane, z, zOf(n.t + n.len), '#3a3a50', '#4a4a60', 0.6, path(n));
        else if (!n.judged) this.drawTail(geo, n.lane, z, zOf(n.t + n.len), LANES_DARK[n.lane], LANES[n.lane], 0.95, path(n));
      }
    }

    drawNotes(v, geo) {
      if (!v.notes) return;
      this.drawTails(v, geo);
      const vis = [];
      for (let i = Math.max(0, (v.nextIdx || 0) - 12); i < v.notes.length; i++) {
        const n = v.notes[i];
        const z = (n.t - v.t) / v.lookahead;
        if (z > 1.15) break;
        if (z < -0.25) continue;
        if (n.judged && n.judged !== 'miss') continue;
        vis.push([n, z]);
      }
      // Notes that arrive together are joined by a bar, so chords read at a glance.
      const together = new Map();
      for (const [n, z] of vis) {
        if (n.judged) continue;
        if (!together.has(n.t)) together.set(n.t, []);
        together.get(n.t).push([n, z]);
      }
      for (const group of together.values()) {
        if (group.length < 2) continue;
        const z = group[0][1];
        const s = geo.scale(z);
        const y = Math.round(geo.yAt(z));
        const xs = group.map(([n]) => geo.cx + geo.laneX(n.lane) * s);
        const x0 = Math.round(Math.min(...xs)), x1 = Math.round(Math.max(...xs));
        const t = Math.max(1, Math.round(3 * s));
        this.g.globalAlpha = z > 0.95 ? Math.max(0, (1.15 - z) / 0.2) * 0.8 : 0.8;
        this.rect(x0, y - Math.ceil(t / 2) - 1, x1 - x0, t + 2, PAL.ink);
        this.rect(x0, y - Math.ceil(t / 2), x1 - x0, t, v.odActive ? PAL.cyan : PAL.white);
        this.g.globalAlpha = 1;
      }
      for (let i = vis.length - 1; i >= 0; i--) {
        const [n, z] = vis[i];
        const s = geo.scale(z);
        const x = geo.cx + geo.laneX(n.lane) * s;
        let y = geo.yAt(z);
        const rx = Math.max(1.5, geo.laneW * 0.36 * s);
        const ry = rx * 0.55;
        if (LAYOUT !== 'keys') { this.drawBar(n, x, y, s, geo, z, v.odActive); continue; }
        if (n.judged === 'miss') {
          this.g.globalAlpha = 0.5;
          this.ellipse(x, y, rx + 1, ry + 1, PAL.ink);
          this.ellipse(x, y, rx, ry, '#4a4a60');
          this.g.globalAlpha = 1;
          continue;
        }
        if (z > 0.95) this.g.globalAlpha = Math.max(0, (1.15 - z) / 0.2);
        this.ellipse(x, y + 1, rx + 1, ry + 1, v.odActive ? PAL.cyan : PAL.ink);
        this.ellipse(x, y, rx, ry, LANES_DARK[n.lane]);
        this.ellipse(x, y - ry * 0.25, rx, ry * 0.75, LANES[n.lane]);
        this.ellipse(x - rx * 0.25, y - ry * 0.45, rx * 0.35, ry * 0.25, v.odActive ? PAL.cyan : PAL.white);
        this.g.globalAlpha = 1;
      }
    }

    /** Strike line setup: a grab handle on the line, so it's obvious you can drag it. */
    drawStrikeHandle(geo, nowMs) {
      const hy = Math.round(geo.yAt(0));
      const bob = Math.round(Math.sin(nowMs / 180) * 2);
      const glow = 0.5 + 0.5 * Math.sin(nowMs / 140);
      this.g.globalAlpha = 0.35 + 0.4 * glow;
      this.rect(0, hy - 1, W, 3, PAL.cyan);
      this.g.globalAlpha = 1;
      for (const x of [14, W - 14]) {
        this.window(x - 10, hy - 16, 20, 32);
        for (let i = 0; i < 4; i++) {
          this.rect(x - i, hy - 10 + i - bob, 1 + i * 2, 1, PAL.cyan);
          this.rect(x - i, hy + 10 - i + bob, 1 + i * 2, 1, PAL.cyan);
        }
        this.rect(x - 5, hy - 1, 11, 3, PAL.white);
      }
      this.text('DRAG THE LINE', W / 2, Math.min(H - 10, hy + 14), PAL.white, 8, 'center');
    }

    /** Phones: a note is a flat bar almost as wide as its lane, like the pad it's aimed at. */
    drawBar(n, x, y, s, geo, z, od) {
      const w = Math.max(3, geo.laneW * 0.86 * s);
      const h = Math.max(3, Math.round(15 * s));
      const x0 = Math.round(x - w / 2);
      const y0 = Math.round(y - h / 2);
      const W2 = Math.round(w);
      if (n.judged === 'miss') {
        this.g.globalAlpha = 0.5;
        this.rect(x0, y0, W2, h, '#4a4a60');
        this.g.globalAlpha = 1;
        return;
      }
      if (z > 0.95) this.g.globalAlpha = Math.max(0, (1.15 - z) / 0.2);
      this.rect(x0 - 1, y0 - 1, W2 + 2, h + 2, od ? PAL.cyan : PAL.ink);
      this.rect(x0, y0, W2, h, LANES_DARK[n.lane]);
      this.rect(x0, y0, W2, Math.max(1, h - Math.ceil(h / 3)), LANES[n.lane]);
      if (h >= 4) this.rect(x0 + Math.round(w * 0.1), y0 + Math.max(1, Math.round(h / 6)), Math.round(w * 0.8), Math.max(1, Math.round(h / 4)), od ? PAL.cyan : PAL.white);
      this.g.globalAlpha = 1;
    }

    drawFlames(v, geo, nowMs, energy = 0) {
      this.flames = this.flames.filter((f) => nowMs - f.at < 220);
      const y = geo.yAt(0);
      for (const f of this.flames) {
        const k = (nowMs - f.at) / 220;
        const x = geo.cx + geo.laneX(f.lane);
        const h = (22 + 7 * energy) * (1 - k);
        const w = geo.laneW * 0.32 * (1 - k * 0.5);
        this.g.globalAlpha = 1 - k;
        this.ellipse(x, y - h * 0.5, w, h * 0.5, LANES[f.lane]);
        this.ellipse(x, y - h * 0.4, w * 0.6, h * 0.35, PAL.gold);
        this.ellipse(x, y - h * 0.3, w * 0.3, h * 0.2, PAL.white);
        this.g.globalAlpha = 1;
      }
    }

    drawParticles(dt) {
      this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
      for (const p of this.particles) {
        p.vy += 220 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        this.rect(p.x, p.y, p.life > 0.3 ? 2 : 1, p.life > 0.3 ? 2 : 1, p.color);
      }
    }

    drawHud(v, nowMs) {
      const h = v.hud;
      if (LAYOUT === 'keys') this.drawDesktopHud(v, h, nowMs);
      else this.drawTouchHud(v, h, nowMs);
      this.drawHudCommon(v, h, nowMs);
    }

    multColor(mult) {
      return mult >= 8 ? PAL.cyan : mult >= 4 ? PAL.magenta : mult >= 3 ? PAL.gold : mult >= 2 ? PAL.green : PAL.grey;
    }

    badge(x, y, h, nowMs) {
      const mc = this.multColor(h.mult);
      this.ellipse(x, y, 13, 13, PAL.ink);
      this.ellipse(x, y, 12, 12, mc);
      this.ellipse(x, y, 10, 10, PAL.window);
      this.text('x' + h.mult, x, y - 4, mc, 8, 'center');
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 10;
        this.rect(x + Math.cos(a) * 17 - 1, y + Math.sin(a) * 17 - 1, 2, 2, i < h.pips ? mc : '#2a2f6a');
      }
      if (this.levelUpAt && nowMs - this.levelUpAt < 700) {
        const k = (nowMs - this.levelUpAt) / 700;
        this.g.globalAlpha = 1 - k;
        this.text('x' + this.levelUpTo + '!', x, y + 19 - k * 8, PAL.gold, 8, 'center');
        this.g.globalAlpha = 1;
      }
    }

    /**
     * Phone HUD, top strip: only what's worth a glance between notes (score, stars,
     * personal-best pace) plus the pause button. Everything you need mid-song lives
     * on the highway itself (drawTrackHud).
     */
    drawTouchHud(v, h, nowMs) {
      this.rect(0, 0, W, 2, '#20204a');
      this.rect(0, 0, W * h.progress, 2, PAL.cyan);
      // Score: big and centred just above the highway, rolling up as points land.
      if (this.shownScore == null || h.score < this.shownScore) this.shownScore = h.score;
      if (h.score > this.shownScore) {
        this.shownScore = Math.min(h.score, this.shownScore + Math.max(1, (h.score - this.shownScore) * 0.25));
        this.scoreBumpAt = nowMs;
      }
      const shown = Math.round(this.shownScore).toLocaleString('en-US');
      const portrait = LAYOUT === 'touch2';
      const size = portrait && shown.length <= 8 ? 24 : 16;
      const bump = this.scoreBumpAt && nowMs - this.scoreBumpAt < 120;
      const sp = portrait ? 2 : 1; // star pixel size
      const block = size + 8 + 7 * sp + (h.pace != null ? 11 : 0); // score, stars, pace
      const sy = portrait ? Math.round(HUD_TOP + (HORIZON - HUD_TOP - block) * 0.65) : HUD_TOP + 1;
      this.text(shown, W / 2, sy, bump ? PAL.white : this.multColor(h.mult) === PAL.grey ? PAL.white : this.multColor(h.mult), size, 'center');
      const starsY = sy + size + 4;
      for (let i = 0; i < 5; i++) {
        const fill = i < h.stars ? 1 : i === h.stars ? h.starProgress : 0;
        this.star(W / 2 - (24 + 1) * sp + i * 10 * sp, starsY, fill, sp);
      }
      if (h.pace != null) {
        const ahead = h.pace >= 0;
        const paceText = `PB ${ahead ? '+' : '-'}${Math.abs(h.pace).toLocaleString('en-US')}`;
        if (portrait) this.text(paceText, W / 2, starsY + 7 * sp + 4, ahead ? PAL.green : PAL.red, 8, 'center');
        else this.text(paceText, W / 2 + 32, starsY, ahead ? PAL.green : PAL.red, 8, 'left');
      }
      // Pause button, top right: out of the way of the score.
      const px = W - 27;
      this.window(px, 4, 22, 18);
      this.rect(px + 7, 8, 3, 10, PAL.white);
      this.rect(px + 12, 8, 3, 10, PAL.white);
      this.touchZones = { pause: { x: px - 14, y: 0, w: W - px + 14, h: HUD_TOP + 4 } };
    }

    /**
     * Phone HUD, on the highway where your eyes already are: the left rail is the
     * overdrive meter, the right rail the rock meter, both filling up from the frets,
     * and the multiplier and streak are painted on the track just above the frets
     * (notes pass over them). When overdrive is ready the whole highway lights up.
     */
    drawTrackHud(v, geo, nowMs) {
      const h = v.hud;
      const ready = h.odReady && !v.odActive && !v.failed;
      const yBot = Math.round(geo.yAt(0)) - 2;
      const yTop = Math.round(HORIZON + (HIT_Y - HORIZON) * 0.3);
      const span = yBot - yTop;
      const danger = h.rock < 0.25 && Math.floor(nowMs / 180) % 2 === 0;
      const climb = Math.floor(nowMs / 28);
      const glow = ready ? 0.5 + 0.5 * Math.sin(nowMs / 110) : 0;

      // Overdrive ready: a cyan wash rising from the frets.
      if (ready) {
        for (let y = yTop; y <= yBot; y++) {
          const s = (y - HORIZON) / (HIT_Y - HORIZON);
          const k = (yBot - y) / span;
          this.g.globalAlpha = (0.05 + 0.13 * glow) * (1 - k);
          this.rect(geo.cx - geo.halfW * s, y, geo.halfW * s * 2, 1, PAL.cyan);
        }
        this.g.globalAlpha = 1;
      }

      // Rail meters.
      for (let y = yTop; y <= yBot; y++) {
        const s = (y - HORIZON) / (HIT_Y - HORIZON);
        const half = geo.halfW * s;
        const w = s > 0.7 ? 4 : 3;
        const d = yBot - y;
        const k = d / span; // 0 at the frets, 1 at the top
        const gap = d % 6 === 5;
        const xl = Math.round(geo.cx - half) - 4 - w;
        const xr = Math.round(geo.cx + half) + 4;
        this.rect(xl - 1, y, w + 2, 1, PAL.ink);
        this.rect(xr - 1, y, w + 2, 1, PAL.ink);
        if (gap) continue;
        let c = '#141c44';
        if (k <= h.od) {
          if (v.odActive) c = (d + climb) % 10 < 5 ? PAL.white : PAL.cyan;
          else if (ready) c = ((d - climb) % 14 + 14) % 14 < 5 ? PAL.white : PAL.cyan;
          else c = PAL.cyan;
        }
        this.rect(xl, y, w, 1, c);
        c = '#141c44';
        if (k <= h.rock) c = danger ? PAL.white : k < 0.25 ? PAL.red : k < 0.6 ? PAL.gold : PAL.green;
        this.rect(xr, y, w, 1, c);
      }
      const sTop = (yTop - HORIZON) / (HIT_Y - HORIZON);
      const lx = geo.cx - geo.halfW * sTop - 6;
      const rx = geo.cx + geo.halfW * sTop + 6;
      this.text('OD', lx, yTop - 11, ready && glow > 0.5 ? PAL.white : PAL.cyan, 8, 'center');
      this.text('ROCK', rx, yTop - 11, h.rock < 0.25 ? PAL.red : PAL.grey, 8, 'center');

      if (ready) this.drawSwipeArrows(geo, nowMs);

      // Ready: a halo pulses round the strike plates (and the pads turn cyan), so
      // it's seen without looking away.
      if (ready) {
        const hy = Math.round(geo.yAt(0));
        this.g.globalAlpha = 0.4 + 0.6 * glow;
        this.rect(geo.cx - geo.halfW - 4, hy - 8, geo.halfW * 2 + 8, 17, glow > 0.5 ? PAL.white : PAL.cyan);
        this.g.globalAlpha = 1;
      }

      this.drawSideHud(v, geo, nowMs);
      if (ready && glow > 0.3) this.text('SWIPE UP', geo.cx, Math.min(H - 10, HIT_Y + 22), PAL.cyan, 8, 'center');
    }

    /**
     * Phone HUD beside the far end of the highway, in the empty space either side,
     * so it's in view without ever covering a note: multiplier and streak on the
     * left, PERFECT / GOOD / MISS on the right.
     */
    drawSideHud(v, geo, nowMs) {
      const h = v.hud;
      const span = HIT_Y - HORIZON;
      const sideX = (side, y) => {
        const edge = geo.halfW * ((y - HORIZON) / span) + 12;
        return Math.round(geo.cx + side * (edge + (W / 2 - edge) / 2));
      };
      // Left: multiplier, progress pips, streak.
      const my = Math.round(HORIZON + span * (LAYOUT === 'touch2' ? 0.04 : 0.06));
      const lx = sideX(-1, my + 20);
      const mc = this.multColor(h.mult);
      this.text('x' + h.mult, lx, my, mc, 16, 'center');
      for (let i = 0; i < 10; i++) this.rect(lx - 25 + i * 5, my + 19, 4, 3, i < h.pips ? mc : '#2a2f6a');
      if (h.combo > 0) {
        this.text(String(h.combo), lx, my + 26, h.combo >= 50 ? PAL.gold : PAL.white, 16, 'center');
        this.text('STREAK', lx, my + 44, PAL.grey, 8, 'center');
      }
      if (this.levelUpAt && nowMs - this.levelUpAt < 700) {
        const k = (nowMs - this.levelUpAt) / 700;
        this.g.globalAlpha = 1 - k;
        this.text('LEVEL UP!', lx, my - 12 - k * 8, PAL.gold, 8, 'center');
        this.g.globalAlpha = 1;
      }
      // Right: the last judgement.
      const jd = v.judgement;
      if (jd && nowMs - jd.at < 450) {
        const k = (nowMs - jd.at) / 450;
        const label = { perfect: 'PERFECT!', good: 'GOOD', ok: 'OK', miss: 'MISS', over: 'OVERHIT' }[jd.kind];
        const color = { perfect: PAL.cyan, good: PAL.green, ok: PAL.gold, miss: PAL.red, over: PAL.red }[jd.kind];
        const jy = my + 4 - (k < 0.15 ? (0.15 - k) * 30 : 0);
        const rx = sideX(1, jy + 10);
        const big = LAYOUT === 'touch4';
        this.g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        this.text(label, rx, jy, color, big ? 16 : 8, 'center');
        if (jd.kind === 'good' || jd.kind === 'ok') this.text(jd.early ? 'EARLY' : 'LATE', rx, jy + (big ? 20 : 12), PAL.grey, 8, 'center');
        this.g.globalAlpha = 1;
      }
    }

    /**
     * A thumb holding a long note can slide anywhere and keep holding. Show that:
     * a glowing ring under the thumb, tied to its fret, plus a tip on the first few.
     */
    drawGrabs(v, geo, nowMs) {
      for (const f of v.fingers) {
        if (!v.holds.some((h) => h.lane === f.lane)) continue;
        const p = this.toBuffer(f.x, f.y);
        const fret = this.fretPos(v.lanes, f.lane);
        const color = LANES[f.lane];
        const dist = Math.hypot(p.x - fret.x, p.y - fret.y);
        if (dist > 10) {
          // Dotted tether from the fret to the thumb.
          const steps = Math.floor(dist / 5);
          for (let i = 1; i < steps; i++) {
            const k = i / steps;
            this.rect(fret.x + (p.x - fret.x) * k - 1, fret.y + (p.y - fret.y) * k - 1, 2, 2, color);
          }
        }
        const r = 9 + Math.sin(nowMs / 90) * 1.5;
        this.ellipse(p.x, p.y, r + 1, r * 0.6 + 1, PAL.ink);
        this.ellipse(p.x, p.y, r, r * 0.6, color);
        this.ellipse(p.x, p.y, r - 3, r * 0.6 - 3, PAL.white);
      }
      const h = v.holds[0];
      if (h && (h.slide ? v.slideTip : v.holdTip)) {
        const fret = this.fretPos(v.lanes, h.lane);
        const x = Math.max(44, Math.min(W - 44, fret.x));
        this.text(h.slide ? 'SLIDE!' : 'KEEP HOLDING', x, fret.y - 34, PAL.white, 8, 'center');
        this.text(h.slide ? 'FOLLOW IT' : 'SLIDE AWAY OK', x, fret.y - 24, PAL.cyan, 8, 'center');
      }
    }

    /**
     * Overdrive ready: big chevrons climbing up both sides of the highway, from
     * near the frets to mid-screen, in the open space beside the rails.
     */
    drawSwipeArrows(geo, nowMs) {
      const span = HIT_Y - HORIZON;
      const yLo = HORIZON + span * 0.95;
      const yHi = HORIZON + span * 0.5;
      const count = 4;
      const phase = (nowMs / 650) % 1;
      for (const side of [-1, 1]) {
        for (let k = 0; k < count; k++) {
          const f = (k + phase) / count; // 0 at the bottom, 1 at the top
          const y = Math.round(yLo - (yLo - yHi) * f);
          const sc = (y - HORIZON) / span;
          const edge = geo.halfW * sc + 12; // outside the rail meter
          const margin = W / 2 - edge;
          if (margin < 14) continue;
          const x = Math.round(geo.cx + side * (edge + margin / 2));
          const size = Math.max(6, Math.min(14, Math.floor(margin / 2) - 2));
          this.g.globalAlpha = Math.sin(f * Math.PI) * 0.95;
          const color = k === count - 1 || f > 0.6 ? PAL.white : PAL.cyan;
          for (let i = 0; i <= size; i++) {
            this.rect(x - i - 1, y + i - 1, 5, 5, PAL.ink);
            this.rect(x + i - 3, y + i - 1, 5, 5, PAL.ink);
          }
          for (let i = 0; i <= size; i++) {
            this.rect(x - i, y + i, 3, 3, color);
            this.rect(x + i - 2, y + i, 3, 3, color);
          }
        }
      }
      this.g.globalAlpha = 1;
    }

    drawDesktopHud(v, h, nowMs) {
      // Score.
      this.window(6, 6, 104, 30);
      this.text('SCORE', 12, 11, PAL.grey);
      this.text(h.score.toLocaleString('en-US'), 12, 23, PAL.white);
      // Multiplier badge.
      const mult = h.mult;
      const mc = mult >= 8 ? PAL.cyan : mult >= 4 ? PAL.magenta : mult >= 3 ? PAL.gold : mult >= 2 ? PAL.green : PAL.grey;
      this.ellipse(124, 21, 13, 13, PAL.ink);
      this.ellipse(124, 21, 12, 12, mc);
      this.ellipse(124, 21, 10, 10, PAL.window);
      this.text('x' + mult, 124, 17, mc, 8, 'center');
      // Ten pips around the badge fill toward the next multiplier.
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 10;
        this.rect(124 + Math.cos(a) * 17 - 1, 21 + Math.sin(a) * 17 - 1, 2, 2, i < h.pips ? mc : '#2a2f6a');
      }
      if (this.levelUpAt && nowMs - this.levelUpAt < 700) {
        const k = (nowMs - this.levelUpAt) / 700;
        this.g.globalAlpha = 1 - k;
        this.text('x' + this.levelUpTo + '!', 124, 40 - k * 8, PAL.gold, 8, 'center');
        this.g.globalAlpha = 1;
      }
      // Stars earned so far; the next one fills up as you approach it.
      for (let i = 0; i < 5; i++) {
        const fill = i < h.stars ? 1 : i === h.stars ? h.starProgress : 0;
        this.star(10 + i * 11, 40, fill);
      }
      // Streak.
      this.window(W - 110, 6, 104, 30);
      this.text('STREAK', W - 104, 11, PAL.grey);
      this.text(String(h.combo), W - 104, 23, h.combo >= 50 ? PAL.gold : PAL.white);
      // Pace against your personal best.
      if (h.pace != null) {
        const ahead = h.pace >= 0;
        this.text(`PB ${ahead ? '+' : '-'}${Math.abs(h.pace).toLocaleString('en-US')}`, W - 104, 40, ahead ? PAL.green : PAL.red);
      }
      // Song progress.
      this.rect(0, 0, W, 2, '#20204a');
      this.rect(0, 0, W * h.progress, 2, PAL.cyan);

      // Overdrive meter (left) and rock meter (right): 12 chunky segments each.
      const segs = 12;
      const mx = 64, rx = W - 72, my = 74, segH = 6;
      this.window(mx - 5, my - 18, 18, segs * segH + 24);
      this.window(rx - 5, my - 18, 18, segs * segH + 24);
      this.text('OD', mx + 4, my - 13, PAL.cyan, 8, 'center');
      const odBlink = h.odReady && !v.odActive && Math.floor(nowMs / 250) % 2 === 0;
      for (let i = 0; i < segs; i++) {
        const filled = h.od * segs > i;
        const y = my + (segs - 1 - i) * segH;
        this.rect(mx, y, 8, segH - 1, filled ? (v.odActive || odBlink ? PAL.white : PAL.cyan) : '#101838');
      }
      if (h.odReady && !v.odActive) this.text(h.odKey, mx + 4, my + segs * segH + 9, odBlink ? PAL.white : PAL.cyan, 8, 'center');
      this.text('RK', rx + 4, my - 13, PAL.grey, 8, 'center');
      const danger = h.rock < 0.25;
      for (let i = 0; i < segs; i++) {
        const y = my + (segs - 1 - i) * segH;
        const zone = i < 3 ? PAL.red : i < 7 ? PAL.gold : PAL.green;
        const lit = h.rock * segs > i;
        const blink = danger && Math.floor(nowMs / 180) % 2 === 0;
        this.rect(rx, y, 8, segH - 1, lit ? (blink ? PAL.white : zone) : '#101838');
      }
    }

    drawHudCommon(v, h, nowMs) {
      const touch = LAYOUT !== 'keys';
      // Judgement pop (phones show it beside the highway instead).
      const j = touch ? null : v.judgement;
      if (j && nowMs - j.at < 450) {
        const k = (nowMs - j.at) / 450;
        const label = { perfect: 'PERFECT!', good: 'GOOD', ok: 'OK', miss: 'MISS', over: 'OVERHIT' }[j.kind];
        const color = { perfect: PAL.cyan, good: PAL.green, ok: PAL.gold, miss: PAL.red, over: PAL.red }[j.kind];
        const jy = LAYOUT === 'touch2' ? HIT_Y - 106 : LAYOUT === 'touch4' ? HIT_Y - 86 : HIT_Y - 62;
        const y = jy - (k < 0.15 ? (0.15 - k) * 40 : 0);
        this.g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        this.text(label, W / 2, y, color, LAYOUT === 'touch2' ? 8 : 16, 'center');
        if (j.kind === 'good' || j.kind === 'ok') this.text(j.early ? 'EARLY' : 'LATE', W / 2, y + 20, PAL.grey, 8, 'center');
        this.g.globalAlpha = 1;
      }

      // Banners slide in from the right and out to the left.
      for (const b of v.banners || []) {
        // Phones: in the sky just above the highway, never over the notes.
        const by = touch ? Math.max(HUD_TOP + 2, HORIZON - (b.sub ? 32 : 22)) : b.y;
        const age = (nowMs - b.at) / 1000;
        if (age > 1.6) continue;
        const x = age < 0.2 ? W / 2 + (0.2 - age) * 1500 : age > 1.35 ? W / 2 - (age - 1.35) * 1600 : W / 2;
        const bh = b.sub ? 34 : 24;
        this.rect(0, by - 4, W, bh, 'rgba(8,8,26,0.75)');
        this.rect(0, by - 4, W, 1, b.color);
        this.rect(0, by + bh - 5, W, 1, b.color);
        this.text(b.text, x, by, b.color, LAYOUT === 'touch2' && b.text.length > 12 ? 8 : 16, 'center');
        if (b.sub) this.text(b.sub, x, by + 19, PAL.white, 8, 'center');
      }

      // Points float up from the fret, coloured by the multiplier.
      for (const p of touch ? [] : v.popups || []) {
        const age = nowMs - p.at;
        if (age > 650) continue;
        const pos = this.fretPos(v.lanes, p.lane);
        const c = p.mult >= 8 ? PAL.cyan : p.mult >= 4 ? PAL.magenta : p.mult >= 3 ? PAL.gold : p.mult >= 2 ? PAL.green : PAL.grey;
        this.g.globalAlpha = Math.min(1, (650 - age) / 250);
        this.text(p.text, pos.x, pos.y - 24 - (age / 650) * 16, c, 8, 'center');
        this.g.globalAlpha = 1;
      }

      if (v.restart > 0) {
        const ry = touch ? HUD_TOP + 6 : 44;
        this.window(W / 2 - 74, ry, 148, 24);
        this.text('HOLD TO RESTART', W / 2, ry + 5, PAL.white, 8, 'center');
        this.rect(W / 2 - 66, ry + 16, 132, 3, PAL.ink);
        this.rect(W / 2 - 66, ry + 16, 132 * Math.min(1, v.restart), 3, PAL.gold);
      }

      // Countdown.
      const mid = touch ? Math.round((HORIZON + HIT_Y) / 2) - 12 : 104;
      if (v.countdown) this.text(v.countdown, W / 2, mid, PAL.white, 24, 'center');
      if (h.intro) {
        const iy = touch ? HUD_TOP + 2 : 46;
        const title = LAYOUT === 'touch2' ? h.intro.title.slice(0, 24) : h.intro.title;
        this.text(title, W / 2, iy, PAL.white, 8, 'center');
        this.text(h.intro.sub, W / 2, iy + 12, PAL.cyan, 8, 'center');
      }
      if (v.failed) {
        this.rect(0, mid - 12, W, 40, 'rgba(40,0,10,0.85)');
        this.text('SONG FAILED', W / 2, mid, PAL.red, LAYOUT === 'touch2' ? 8 : 16, 'center');
      }
    }

    /** A 7×7 pixel star, filled from the bottom by `fill` (0–1). */
    star(x, y, fill, px = 1) {
      const SHAPE = ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '##...##'];
      SHAPE.forEach((row, r) => {
        for (let c = 0; c < 7; c++) {
          if (row[c] !== '#') continue;
          const lit = 6 - r < fill * 7;
          this.rect(x + c * px, y + r * px, px, px, lit ? PAL.gold : '#3a3a6a');
        }
      });
    }

    /** Glowing edges at full energy, and a gold frame while a full combo is alive. */
    drawEdges(v, pulse, level, energy) {
      if (energy > 2.2) {
        this.g.globalAlpha = (0.2 + 0.3 * pulse) * (energy - 2.2) / 0.8;
        const c = v.odActive ? PAL.cyan : PAL.magenta;
        this.rect(0, 2, 3, H - 2, c);
        this.rect(W - 3, 2, 3, H - 2, c);
        this.rect(0, H - 3, W, 3, c);
        this.g.globalAlpha = 1;
      }
      if (v.fullCombo) {
        this.g.globalAlpha = 0.55 + 0.25 * pulse;
        this.rect(0, 2, 1, H - 2, PAL.gold);
        this.rect(W - 1, 2, 1, H - 2, PAL.gold);
        this.rect(0, H - 1, W, 1, PAL.gold);
        this.rect(0, 2, W, 1, PAL.gold);
        this.g.globalAlpha = 1;
      }
    }

    /**
     * The guitarist, left of the highway, in the player's colour. Calm at ×1,
     * head-bobbing at ×2, head-banging at ×3, jumping at ×4 or in overdrive;
     * slumps when a streak breaks and sits down if the song fails.
     */
    drawGuitarist(v, bi, phase, energy, powerDown) {
      if (!v.guitarist && !v.attract) return;
      const color = v.guitarist ? v.guitarist.color : PAL.cyan;
      const dark = shade(color, 0.55);
      const SKIN = '#f0c8a0', HAIR = '#3a2214', PANTS = '#262648', BOOTS = '#0c0c18';
      const beat = phase < 0.3;
      const eighth = (phase * 2) % 1 < 0.5;
      const failed = v.failed;
      const sad = failed || powerDown > 0.3;
      const jump = !sad && energy > 2.2 && beat ? 2 : 0;
      const lean = !sad && energy > 1.4 && beat ? 1 : 0; // head-bang forward
      const bob = sad ? 1 : energy > 0.6 && beat ? 1 : 0;
      const spread = energy > 2.2 ? 1 : 0;
      const sit = failed ? 3 : 0;
      // Drawn on a 2× pixel grid so he reads clearly: (x, y) are art pixels
      // relative to his feet, which stand at (86, 160) on the stage.
      const S = 2;
      const [gx, gy0] = LAYOUT === 'touch4' ? [22, HORIZON] : LAYOUT === 'touch2' ? [14, HORIZON] : [80, 160];
      const ox = gx, oy = gy0 - jump * S;
      const R = (x, y, w, h, c) => this.rect(ox + x * S, oy + y * S, w * S, h * S, c);
      const E = (x, y, rx, ry, c) => this.ellipse(ox + x * S, oy + y * S, rx * S, ry * S, c);

      if (v.odActive) {
        this.g.globalAlpha = 0.22 + 0.15 * Math.sin(v.t * 12);
        E(8, -10 + sit, 11, 14, PAL.cyan);
        this.g.globalAlpha = 1;
      }
      // Legs and boots.
      R(3 - spread, -6 + sit, 2, 6 - sit, PANTS);
      R(8 + spread, -6 + sit, 2, 6 - sit, PANTS);
      R(2 - spread, -1, 4, 1, BOOTS);
      R(8 + spread, -1, 4, 1, BOOTS);
      // Torso with a highlight and belt.
      const ty = -13 + bob + sit;
      R(3, ty, 7, 7, color);
      R(3, ty, 7, 1, shade(color, 1.3));
      R(3, ty + 6, 7, 1, PANTS);
      // Head, hair (longer and flying when head-banging), eye.
      const hx = 4 + lean;
      const hy = ty - 6 + lean + (sad ? 1 : 0);
      R(6, ty - 1, 1, 1, SKIN);
      R(hx, hy, 5, 5, SKIN);
      R(hx, hy - 1, 5, 2, HAIR);
      R(hx - 1, hy, 1, 4 + (energy > 1.4 ? 2 : 0), HAIR);
      R(hx + 3, hy + (sad ? 3 : 2), 1, 1, '#101018');
      // Guitar: body on the hip, neck up to the left (drooping when sad).
      const gy = ty + 4 + (sad ? 2 : 0);
      E(7, gy, 3.5, 2.5, dark);
      E(7, gy, 2, 1.5, color);
      R(7, gy, 1, 1, PAL.white);
      for (let i = 0; i < 8; i++) R(4 - i, gy - 1 - Math.round(i * (sad ? 0.2 : 0.5)), 1, 1, '#c89058');
      R(-4, gy - 5 + (sad ? 3 : 0), 2, 1, SKIN); // fretting hand
      // Strumming arm, bouncing on the 8th notes.
      const strum = !sad && energy > 0.2 && eighth ? -1 : 0;
      R(9, ty + 1, 1, Math.max(1, gy + strum - ty - 1), color);
      R(9, gy + strum, 2, 2, SKIN);
    }

    blit(dt) {
      const c = this.canvas;
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.round(c.clientWidth * dpr);
      const ch = Math.round(c.clientHeight * dpr);
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const o = this.out;
      o.imageSmoothingEnabled = false;
      o.fillStyle = '#05050f';
      o.fillRect(0, 0, cw, ch);
      // Scale to fit; snap to a whole multiple when that wastes little space.
      let scale = Math.min(cw / W, ch / H);
      if (scale >= 1 && scale - Math.floor(scale) < 0.2) scale = Math.floor(scale);
      const dw = W * scale;
      const dh = H * scale;
      let dx = (cw - dw) / 2;
      let dy = (ch - dh) / 2;
      if (this.shake > 0.05) {
        dx += (Math.random() * 2 - 1) * this.shake * scale;
        dy += (Math.random() * 2 - 1) * this.shake * scale;
        this.shake *= Math.pow(0.0001, dt);
      } else this.shake = 0;
      o.drawImage(this.buf, Math.round(dx), Math.round(dy), Math.round(dw), Math.round(dh));
      this.xf = { dx: (cw - dw) / 2, dy: (ch - dh) / 2, scale, dpr };
      if (this.flash > 0.02) {
        o.fillStyle = `rgba(255,255,255,${this.flash})`;
        o.fillRect(0, 0, cw, ch);
        this.flash *= Math.pow(0.002, dt);
      } else this.flash = 0;
    }

    /** Idle "attract mode" scene behind the menus. */
    attract(timeSec) {
      const bpm = 112;
      const period = 60 / bpm;
      const beats = [];
      const first = Math.floor(timeSec / period) - 8;
      for (let i = 0; i < 40; i++) beats.push((first + i) * period);
      const lanes = LAYOUT === 'touch4' ? 4 : LAYOUT === 'touch2' ? 2 : 5;
      this.draw({ t: timeSec, beats, lanes, lookahead: 1.8, attract: true, rock: 0.8 });
    }

    /** Screen (CSS px) → buffer pixels. */
    toBuffer(clientX, clientY) {
      const r = this.canvas.getBoundingClientRect();
      const xf = this.xf || { dx: 0, dy: 0, scale: 1, dpr: 1 };
      return {
        x: ((clientX - r.left) * xf.dpr - xf.dx) / xf.scale,
        y: ((clientY - r.top) * xf.dpr - xf.dy) / xf.scale,
      };
    }

    /** Buffer pixels → screen (CSS px). */
    toClient(x, y) {
      const r = this.canvas.getBoundingClientRect();
      const xf = this.xf || { dx: 0, dy: 0, scale: 1, dpr: 1 };
      return { x: r.left + (x * xf.scale + xf.dx) / xf.dpr, y: r.top + (y * xf.scale + xf.dy) / xf.dpr };
    }

    /**
     * What a touch at (clientX, clientY) means in a phone layout: the OD or pause
     * button, or a lane. Lanes are full-height columns under the HUD, as wide as
     * the lanes at the strike line; touches beyond the highway go to the edge lane.
     */
    hitTest(clientX, clientY, lanes) {
      if (LAYOUT === 'keys') return null;
      const p = this.toBuffer(clientX, clientY);
      const inside = (z) => z && p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;
      const zones = this.touchZones || {};
      if (inside(zones.pause)) return { type: 'pause' };
      if (p.y < HUD_TOP) return null;
      const geo = this.geometry(lanes);
      const pos = this.lanePosAt(clientX, clientY, lanes);
      return { type: 'lane', lane: Math.max(0, Math.min(lanes - 1, Math.floor(pos))), pos };
    }

    /**
     * Where a point on screen is across the lanes: 1.8 = lane 1, near lane 2.
     * Lanes follow the highway's perspective: narrower up the screen, wider on the
     * pads below the line.
     */
    lanePosAt(clientX, clientY, lanes) {
      const p = this.toBuffer(clientX, clientY);
      const geo = this.geometry(lanes);
      const sc = Math.max(0.55, (p.y - HORIZON) / (HIT_Y - HORIZON));
      return (p.x - (geo.cx - geo.halfW * sc)) / (geo.laneW * sc);
    }

    /** Centre of a lane's touch column on screen (for tests and hints). */
    laneCenterClient(lanes, lane) {
      const geo = this.geometry(lanes);
      // Middle of the lane's pad, below the strike line, where a thumb rests.
      const y = HIT_Y + (H - HIT_Y) * 0.45;
      const sc = (y - HORIZON) / (HIT_Y - HORIZON);
      return this.toClient(geo.cx + geo.laneX(lane) * sc, y);
    }

    zoneCenterClient(name) {
      const z = (this.touchZones || {})[name];
      return z ? this.toClient(z.x + z.w / 2, z.y + z.h / 2) : null;
    }

    /** Where on screen (in buffer pixels) a lane's fret sits, for effects. */
    fretPos(lanes, lane) {
      const geo = this.geometry(lanes);
      return { x: geo.cx + geo.laneX(lane), y: geo.yAt(0) };
    }
  }

  Stage.W = W;
  Stage.H = H;
  Stage.PAL = PAL;
  Stage.LANES = LANES;
  root.Stage = Stage;
})(window);
