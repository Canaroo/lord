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

    // ---- geometry ----------------------------------------------------------------------------

    geometry(lanes) {
      const halfW = lanes === 3 ? 60 : 82;
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

      this.drawBackdrop(v, bi, phase, pulse, hype);
      this.drawCrowd(bi, phase, hype, v.attract);
      this.drawHighway(v, geo, pulse);
      this.drawFrets(v, geo);
      this.drawNotes(v, geo);
      this.drawFlames(v, geo, nowMs);
      this.drawParticles(dt);
      if (v.hud) this.drawHud(v, nowMs);
      this.blit(dt);
    }

    drawBackdrop(v, bi, phase, pulse, hype) {
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
      // Stars.
      const r = seeded(7);
      for (let i = 0; i < 40; i++) {
        const x = Math.floor(r() * W), y = Math.floor(r() * (HORIZON - 20));
        const tw = Math.sin(v.t * 2 + i) > 0.6;
        this.rect(x, y, 1, 1, tw ? PAL.white : PAL.dim);
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
        const sway = Math.sin(v.t * 0.9 + i * 1.7) * 40;
        g.globalAlpha = (v.odActive ? 0.2 : 0.09) + 0.08 * pulse * hype;
        g.fillStyle = v.odActive ? PAL.cyan : color;
        for (let y = 12; y < HORIZON + 30; y += 1) {
          const k = (y - 12) / (HORIZON + 18);
          const cx = lx + sway * k;
          const w = 2 + k * 26;
          g.fillRect(Math.round(cx - w / 2), y, Math.round(w), 1);
        }
        g.globalAlpha = 1;
        this.rect(lx - 3, 11, 7, 4, '#3a3a58');
        this.rect(lx - 2, 15, 5, 2, v.odActive ? PAL.cyan : color);
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

    drawCrowd(bi, phase, hype, attract) {
      const jump = hype > 0.75 ? 2 : hype > 0.35 ? 1 : 0;
      for (const p of CROWD) {
        const offbeat = (bi + (p.ph > 0.5 ? 1 : 0)) % 2 === 0;
        const bob = jump && phase < 0.35 && (offbeat || jump === 2) ? -jump : 0;
        const y = p.y + bob;
        const dim = hype < 0.25 && !attract;
        // Arms up when the crowd is into it.
        if (hype > 0.6 && (p.ph * 10 + bi) % 3 < 1.2) {
          this.rect(p.x - 1, y - 6, 1, 6, p.skin);
          this.rect(p.x + 7, y - 6, 1, 6, p.skin);
        }
        this.rect(p.x, y + 3, 7, 10, dim ? '#202030' : p.shirt);
        this.rect(p.x + 1, y - 3, 5, 6, dim ? '#303040' : p.skin);
        this.rect(p.x + 1, y - 3, 5, 1, '#201810');
      }
    }

    drawHighway(v, geo, pulse) {
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
          g.fillStyle = b % 4 === 0 ? PAL.measure : PAL.beat;
          g.fillRect(x0, y, w, 1);
        }
        prevBeat = b;
        // Lane dividers and rails.
        g.fillStyle = PAL.divider;
        for (let i = 1; i < lanes; i++) g.fillRect(Math.round(x0 + (i * w) / lanes), y, 1, 1);
        g.fillStyle = od ? PAL.railOd : v.rock != null && v.rock < 0.25 && pulse > 0.5 ? PAL.red : PAL.rail;
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

    drawNotes(v, geo) {
      if (!v.notes) return;
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

    drawFlames(v, geo, nowMs) {
      this.flames = this.flames.filter((f) => nowMs - f.at < 220);
      const y = geo.yAt(0);
      for (const f of this.flames) {
        const k = (nowMs - f.at) / 220;
        const x = geo.cx + geo.laneX(f.lane);
        const h = 26 * (1 - k);
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
      // Streak.
      this.window(W - 110, 6, 104, 30);
      this.text('STREAK', W - 104, 11, PAL.grey);
      this.text(String(h.combo), W - 104, 23, h.combo >= 50 ? PAL.gold : PAL.white);
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
        const label = { perfect: 'PERFECT!', good: 'GOOD', ok: 'OK', miss: 'MISS' }[j.kind];
        const color = { perfect: PAL.cyan, good: PAL.green, ok: PAL.gold, miss: PAL.red }[j.kind];
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
