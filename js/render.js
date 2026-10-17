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
  const W = 400;
  const H = 225;
  const HORIZON = 64;
  const HIT_Y = 192;
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

  // A fixed crowd on each side of the highway.
  const CROWD = (() => {
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
  })();

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

    geometry(lanes) {
      const halfW = { 2: 44, 3: 60, 4: 72 }[lanes] || 82;
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
      this.drawCrowd(bi, phase, hype, energy, v.attract);
      this.drawHighway(v, geo, pulse, level, energy);
      this.drawFrets(v, geo);
      this.drawNotes(v, geo);
      this.drawFlames(v, geo, nowMs, energy);
      this.drawParticles(dt);
      if (powerDown > 0) {
        this.g.fillStyle = `rgba(8,8,26,${0.45 * powerDown})`;
        this.g.fillRect(0, 0, W, H);
      }
      this.drawEdges(v, pulse, level, energy);
      if (v.hud) this.drawHud(v, nowMs);
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
      // Speaker stacks, cones thump on the beat.
      for (const sx of [8, W - 50]) {
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
        if (v.labels) this.text(v.labels[l], x, y + 12, down ? PAL.white : PAL.grey, 8, 'center');
      }
    }

    /** A long note's tail, from zFrom (nearer) to zTo (further), drawn scanline by scanline. */
    drawTail(geo, lane, zFrom, zTo, body, core, alpha) {
      const a = Math.max(-0.08, zFrom);
      const b = Math.min(1.15, zTo);
      if (b <= a) return;
      const yNear = Math.round(geo.yAt(a));
      const yFar = Math.round(geo.yAt(b));
      const g = this.g;
      g.globalAlpha = alpha;
      for (let y = yFar; y <= yNear; y++) {
        const s = (y - HORIZON) / (HIT_Y - HORIZON);
        const x = geo.cx + geo.laneX(lane) * s;
        const w = Math.max(1, geo.laneW * 0.15 * s);
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
      // Tails being held (or let go) right now run from the strike line.
      for (const h of v.holds || []) {
        const down = v.held && v.held[h.lane];
        this.drawTail(geo, h.lane, 0, zOf(h.holdEnd), down ? LANES_LIGHT[h.lane] : LANES_DARK[h.lane], down ? PAL.white : LANES[h.lane], down ? 1 : 0.55);
        if (down) {
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
        if (n.judged === 'miss') this.drawTail(geo, n.lane, z, zOf(n.t + n.len), '#3a3a50', '#4a4a60', 0.6);
        else if (!n.judged) this.drawTail(geo, n.lane, z, zOf(n.t + n.len), LANES_DARK[n.lane], LANES[n.lane], 0.95);
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
      for (let i = vis.length - 1; i >= 0; i--) {
        const [n, z] = vis[i];
        const s = geo.scale(z);
        const x = geo.cx + geo.laneX(n.lane) * s;
        let y = geo.yAt(z);
        const rx = Math.max(1.5, geo.laneW * 0.36 * s);
        const ry = rx * 0.55;
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

      // Judgement pop.
      const j = v.judgement;
      if (j && nowMs - j.at < 450) {
        const k = (nowMs - j.at) / 450;
        const label = { perfect: 'PERFECT!', good: 'GOOD', ok: 'OK', miss: 'MISS', over: 'OVERHIT' }[j.kind];
        const color = { perfect: PAL.cyan, good: PAL.green, ok: PAL.gold, miss: PAL.red, over: PAL.red }[j.kind];
        const y = HIT_Y - 62 - (k < 0.15 ? (0.15 - k) * 40 : 0);
        this.g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        this.text(label, W / 2, y, color, 16, 'center');
        if (j.kind === 'good' || j.kind === 'ok') this.text(j.early ? 'EARLY' : 'LATE', W / 2, y + 20, PAL.grey, 8, 'center');
        this.g.globalAlpha = 1;
      }

      // Banners slide in from the right and out to the left.
      for (const b of v.banners || []) {
        const age = (nowMs - b.at) / 1000;
        if (age > 1.6) continue;
        const x = age < 0.2 ? W / 2 + (0.2 - age) * 1500 : age > 1.35 ? W / 2 - (age - 1.35) * 1600 : W / 2;
        this.rect(0, b.y - 4, W, 24, 'rgba(8,8,26,0.75)');
        this.rect(0, b.y - 4, W, 1, b.color);
        this.rect(0, b.y + 19, W, 1, b.color);
        this.text(b.text, x, b.y, b.color, 16, 'center');
      }

      // Points float up from the fret, coloured by the multiplier.
      for (const p of v.popups || []) {
        const age = nowMs - p.at;
        if (age > 650) continue;
        const pos = this.fretPos(v.lanes, p.lane);
        const c = p.mult >= 8 ? PAL.cyan : p.mult >= 4 ? PAL.magenta : p.mult >= 3 ? PAL.gold : p.mult >= 2 ? PAL.green : PAL.grey;
        this.g.globalAlpha = Math.min(1, (650 - age) / 250);
        this.text(p.text, pos.x, pos.y - 24 - (age / 650) * 16, c, 8, 'center');
        this.g.globalAlpha = 1;
      }

      if (v.timing) this.drawTimingMeter(v.timing, nowMs);

      if (v.restart > 0) {
        this.window(W / 2 - 74, 44, 148, 24);
        this.text('HOLD TO RESTART', W / 2, 49, PAL.white, 8, 'center');
        this.rect(W / 2 - 66, 60, 132, 3, PAL.ink);
        this.rect(W / 2 - 66, 60, 132 * Math.min(1, v.restart), 3, PAL.gold);
      }

      // Countdown.
      if (v.countdown) this.text(v.countdown, W / 2, 104, PAL.white, 24, 'center');
      if (h.intro) {
        this.text(h.intro.title, W / 2, 46, PAL.white, 8, 'center');
        this.text(h.intro.sub, W / 2, 58, PAL.cyan, 8, 'center');
      }
      if (v.failed) {
        this.rect(0, 92, W, 40, 'rgba(40,0,10,0.85)');
        this.text('SONG FAILED', W / 2, 104, PAL.red, 16, 'center');
      }
    }

    /** A 7×7 pixel star, filled from the bottom by `fill` (0–1). */
    star(x, y, fill) {
      const SHAPE = ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '##...##'];
      SHAPE.forEach((row, r) => {
        for (let c = 0; c < 7; c++) {
          if (row[c] !== '#') continue;
          const lit = 6 - r < fill * 7;
          this.rect(x + c, y + r, 1, 1, lit ? PAL.gold : '#3a3a6a');
        }
      });
    }

    /** Hit-error bar under the frets: where each recent hit landed, early ← → late. */
    drawTimingMeter(timing, nowMs) {
      const cx = W / 2;
      const y = 216;
      const half = 48;
      const px = (ms) => cx + (Math.max(-140, Math.min(140, ms)) / 140) * half;
      this.rect(cx - half - 1, y - 1, half * 2 + 3, 7, PAL.ink);
      this.rect(cx - half, y, half * 2 + 1, 5, '#3a3010');
      this.rect(px(-95), y, px(95) - px(-95) + 1, 5, '#123a16');
      this.rect(px(-50), y, px(50) - px(-50) + 1, 5, '#0e3a40');
      for (const hit of timing.recent) {
        const age = nowMs - hit.at;
        if (age > 2500) continue;
        this.g.globalAlpha = 1 - age / 2500;
        this.rect(px(hit.off), y, 1, 5, hit.kind === 'perfect' ? PAL.cyan : hit.kind === 'good' ? PAL.green : PAL.gold);
      }
      this.g.globalAlpha = 1;
      this.rect(cx, y - 1, 1, 7, PAL.white);
      if (timing.recent.length) {
        const ax = Math.round(px(timing.avg));
        this.rect(ax - 1, y - 3, 3, 1, PAL.white);
        this.rect(ax, y - 2, 1, 1, PAL.white);
      }
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
      const S = 2, ox = 80, oy = 160 - jump * S;
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
      this.draw({ t: timeSec, beats, lanes: 5, lookahead: 1.8, attract: true, rock: 0.8 });
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
