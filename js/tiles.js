/*
 * Tiles mode — a Magic Tiles–style way to play any song.
 *
 * A flat board of four columns, played upright. Tiles fall straight down; tap a
 * tile's column as it reaches the line near the bottom (early is fine). Long
 * tiles are held. One heart: a tile that slips past, or a tap on an empty
 * column, ends the run. The song loops, faster every lap. Stars come during the
 * first lap, crowns for every lap after that.
 *
 * It reuses the 4-lane phone chart for the chosen tier, the Stage's pixel buffer
 * for drawing, and the shared sound effects.
 */
'use strict';
(function (root) {
  const COUNT_IN = 3;
  const RESUME_LEAD = 2.4;
  const RESUME_REWIND = 1; // song seconds
  const LIVES = 1;
  const SPEED_STEP = 0.22; // each lap plays 22% faster
  const SPEED_MAX = 2.5;
  // Real-time windows (seconds): tap up to EARLY before a tile's moment, LATE after.
  const EARLY = 0.5;
  const LATE = 0.2;
  const PERFECT = 0.07;
  const GREAT = 0.14;
  const POINTS = { perfect: 3, great: 2, cool: 1 };
  const HOLD_POINTS = 4; // per second held
  const STAR_AT = [1 / 3, 2 / 3, 1]; // share of the first lap
  const BOUNCE = 0.12; // a second tap this soon after a hit in the same column is ignored
  // Pixels per song-second on a 450-tall board, by tier.
  const SCROLL = { easy: 230, medium: 270, mediumplus: 290, hard: 310 };

  const COLORS = ['#38d838', '#f84848', '#f8d830', '#4878f8'];

  class TilesGame {
    /**
     * @param {object} o
     * @param {AudioContext} o.audioCtx
     * @param {AudioBuffer} o.buffer
     * @param {{notes:{t:number,lane:number,len?:number}[]}} o.chart  a 4-lane chart
     * @param {Stage} o.stage
     * @param {string} o.tier          easy / medium / mediumplus / hard
     * @param {number} o.speed         note speed setting
     * @param {number} o.calibration   seconds
     * @param {number} o.duration      song length (seconds)
     * @param {boolean} o.vibrate
     * @param {(res:object)=>void} o.onEnd
     * @param {(paused:boolean)=>void} o.onPauseChange
     */
    constructor(o) {
      this.ctx = o.audioCtx;
      this.buffer = o.buffer;
      this.stage = o.stage;
      this.chart = o.chart.notes.map((n) => ({ t: n.t, lane: n.lane, len: n.len || 0 }));
      this.duration = Math.max(o.duration, this.chart.length ? this.chart[this.chart.length - 1].t + 1 : 1);
      this.tier = o.tier;
      this.scroll = (SCROLL[o.tier] || 270) * (o.speed || 1);
      this.calibration = o.calibration || 0;
      this.vibrate = !!o.vibrate;
      this.onEnd = o.onEnd;
      this.onPauseChange = o.onPauseChange || (() => {});
      this.intro = o.intro || null;
      this.beats = o.beats || []; // one lap's beat times, for the board's pulse
      this.effects = []; // tap flourishes: { lane, at, kind }
      this.scoreBumpAt = 0;
      this.boardFlashAt = 0;
      this.lanes = 4;
      this.notes = []; // tiles of the laps loaded so far, on one timeline (P, song-seconds)
      this.lapsLoaded = 0;
      this._loadLap(0);
      this.lap = 0;
      this.rate = 1;
      this.lives = LIVES;
      this.score = 0;
      this.tiles = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.counts = { perfect: 0, great: 0, cool: 0, miss: 0, wrong: 0 };
      this.held = [false, false, false, false];
      this.holding = []; // long tiles being held
      this.lastHit = [-Infinity, -Infinity, -Infinity, -Infinity];
      this.flashes = []; // { lane, at, color } — red cells for wrong taps
      this.pops = []; // judgement words
      this.banner = null;
      this.restartProgress = 0;
      this.running = false;
      this.paused = false;
      this.failed = false;
      this.over = false;
      this.lastMs = performance.now();
      this._frame = this._frame.bind(this);
    }

    // ---- time ----------------------------------------------------------------------
    //
    // P is the position on the looping timeline in song-seconds: lap k covers
    // [k·D, (k+1)·D). It advances at `rate` song-seconds per real second.

    /** Timeline position the player is hearing right now. */
    now() {
      if (this.paused) return this.pausedP;
      const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
      return this.lapStartP + (this.ctx.currentTime - latency - this.lapStartCtx) * this.rate - this.calibration * this.rate;
    }

    timeAt(perfMs) {
      const ago = Math.max(0, Math.min(0.25, (performance.now() - perfMs) / 1000));
      return this.now() - ago * this.rate;
    }

    _loadLap(k) {
      const off = k * this.duration;
      for (const n of this.chart) this.notes.push({ t: n.t + off, lane: n.lane, len: n.len, lap: k, judged: null });
      this.lapsLoaded = k + 1;
    }

    /** Start the song for lap `k` at context time `when`, `offset` seconds in. */
    _play(when, k, offset) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.playbackRate.value = this.rate;
      src.connect(root.Sfx && Sfx.musicIn ? Sfx.musicIn : this.ctx.destination);
      src.start(when, Math.max(0, offset));
      this.sources.push(src);
      this.lapStartCtx = when - offset / this.rate;
      this.lapStartP = k * this.duration;
      this.lap = k;
      this.nextLapQueued = false;
    }

    _stopSources() {
      for (const s of this.sources || []) { try { s.stop(); } catch (e) { /* not started */ } s.disconnect(); }
      this.sources = [];
    }

    async start() {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      if (root.Sfx) Sfx.resetMusicFx();
      this.sources = [];
      const at = this.ctx.currentTime + COUNT_IN;
      this._play(at, 0, 0);
      for (let i = 3; i >= 1; i--) Sfx.countdown(at - i * 0.75 - 0.25);
      Sfx.go(at - 0.25);
      this.running = true;
      requestAnimationFrame(this._frame);
    }

    pause() {
      if (!this.running || this.paused || this.over) return;
      this.pausedP = this.now();
      this._stopSources();
      this.paused = true;
      this.held.fill(false);
      this.onPauseChange(true);
    }

    resume() {
      if (!this.running || !this.paused) return;
      const k = Math.floor(this.pausedP / this.duration);
      const inLap = Math.max(0, this.pausedP - k * this.duration - RESUME_REWIND);
      this.resumeAt = this.ctx.currentTime + RESUME_LEAD;
      this.paused = false;
      this._play(this.resumeAt, k, inLap);
      for (let i = 3; i >= 1; i--) Sfx.countdown(this.resumeAt - i * 0.6);
      this.onPauseChange(false);
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      this._stopSources();
      if (root.Sfx) Sfx.resetMusicFx();
    }

    activateOverdrive() { /* no overdrive in Tiles */ }

    // ---- input -----------------------------------------------------------------------

    /** Phones: which column a touch is in (the whole width is the board), or pause. */
    hitTest(clientX, clientY) {
      const p = this.stage.toBuffer(clientX, clientY);
      const W = this.stage.width;
      if (p.y < 26 && p.x > W - 44) return { type: 'pause' };
      return { type: 'lane', lane: Math.max(0, Math.min(3, Math.floor((p.x / W) * 4))) };
    }

    lane(lane, down, perfMs) {
      if (!this.running || this.paused || this.over || lane > 3) return;
      this.held[lane] = down;
      if (!down) return;
      const P = this.timeAt(perfMs);
      if (P < 0) return;
      // The next tile in this column, if it's close enough to tap.
      let best = null;
      for (const n of this.notes) {
        if (n.judged || n.lane !== lane) continue;
        const dt = (P - n.t) / this.rate; // real seconds; negative = early
        if (dt > LATE) continue;
        if (dt >= -EARLY) best = n;
        break;
      }
      if (best) { this._hit(best, (P - best.t) / this.rate); return; }
      if ((P - this.lastHit[lane]) / this.rate < BOUNCE) return; // a double tap
      // A tile still on its way down in this column: too early, but not a mistake.
      if (this.notes.some((n) => !n.judged && n.lane === lane && n.t > P && (n.t - P) / this.rate < EARLY + 0.6)) return;
      this.counts.wrong++;
      this.flashes.push({ lane, at: performance.now() });
      this._loseLife();
    }

    _hit(n, dt) {
      const a = Math.abs(dt);
      const kind = a <= PERFECT ? 'perfect' : a <= GREAT ? 'great' : 'cool';
      n.judged = kind;
      n.hitAt = performance.now();
      this.counts[kind]++;
      this.tiles++;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += POINTS[kind] * (n.lap + 1);
      this.lastHit[n.lane] = n.t;
      if (n.len > 0) { n.holdEnd = n.t + n.len; this.holding.push(n); }
      const now = performance.now();
      this.pops.push({ kind, at: now, lane: n.lane });
      this.effects.push({ lane: n.lane, at: now, kind });
      this.scoreBumpAt = now;
      // Make every tap feel like something: a chime, sparks, a tiny buzz.
      Sfx.tileTap(n.lane, kind === 'perfect');
      const W = this.stage.width;
      const cx = (n.lane + 0.5) * (W / 4);
      this.stage.burst(cx, this.lineY() - 6, COLORS[n.lane], 14, 110);
      if (kind === 'perfect') this.stage.burst(cx, this.lineY() - 6, '#ffffff', 6, 140);
      if (this.vibrate) { try { navigator.vibrate(8); } catch (e) { /* not allowed */ } }
      if (this.combo % 25 === 0) {
        this.boardFlashAt = now;
        this.stage.kick(1);
        if (this.combo % 50 === 0) { this.banner = { text: `${this.combo} IN A ROW!`, at: now }; Sfx.streak(this.combo); }
      }
    }

    _miss(n) {
      n.judged = 'miss';
      n.missAt = performance.now();
      this.counts.miss++;
      this._loseLife();
    }

    _loseLife() {
      this.combo = 0;
      this.lives--;
      Sfx.miss();
      this.stage.kick(3);
      this.stage.flashScreen(0.25);
      if (this.vibrate) { try { navigator.vibrate(this.lives > 0 ? 40 : 250); } catch (e) { /* not allowed */ } }
      if (this.lives <= 0) this._gameOver();
    }

    _gameOver() {
      this.over = true;
      this.overAt = performance.now();
      this.overP = this.now();
      this._stopSources();
      Sfx.fail();
      setTimeout(() => {
        if (!this.running) return;
        this.running = false;
        this.onEnd(this.results());
      }, 2200);
    }

    // ---- progress --------------------------------------------------------------------

    /** Stars (0–3) during the first lap, then crowns: one for each lap finished after it. */
    progress(P = this.now()) {
      const lapDone = P / this.duration;
      const stars = STAR_AT.filter((k) => lapDone >= k).length;
      const crowns = Math.max(0, Math.floor(lapDone) - 1);
      return { stars, crowns, starProgress: Math.min(1, lapDone) };
    }

    results() {
      const P = this.over ? this.overP : this.now();
      const { stars, crowns } = this.progress(P);
      const judged = this.counts.perfect + this.counts.great + this.counts.cool + this.counts.miss;
      const accuracy = judged ? ((this.counts.perfect * 100 + this.counts.great * 80 + this.counts.cool * 50) / judged) : 0;
      return {
        score: Math.round(this.score),
        tiles: this.tiles,
        counts: { ...this.counts },
        maxCombo: this.maxCombo,
        stars,
        crowns,
        laps: Math.floor(P / this.duration),
        topSpeed: this.rate,
        accuracy,
        grade: crowns ? `${crowns}C` : `${stars}★`,
      };
    }

    // ---- frame -----------------------------------------------------------------------

    lineY() { return Math.round(this.stage.height * 0.8); }

    _frame() {
      if (!this.running) return;
      const nowMs = performance.now();
      const dt = Math.min(0.05, (nowMs - this.lastMs) / 1000);
      this.lastMs = nowMs;
      if (!this.paused && !this.over) this._update();
      this._draw(nowMs, dt);
      requestAnimationFrame(this._frame);
    }

    _update() {
      const P = this.now();
      // Queue the next lap's music (and tiles) just before this lap ends, so it's seamless.
      const lapEnd = (this.lap + 1) * this.duration;
      if (this.lapsLoaded <= this.lap + 1 && P > lapEnd - 6) this._loadLap(this.lap + 1);
      if (!this.nextLapQueued && P > lapEnd - 0.5) {
        this.nextLapQueued = true;
        const whenCtx = this.lapStartCtx + (lapEnd - this.lapStartP) / this.rate;
        const next = this.lap + 1;
        this.queued = { whenCtx, next };
      }
      if (this.queued && this.ctx.currentTime >= this.queued.whenCtx - 0.12) {
        const { whenCtx, next } = this.queued;
        this.queued = null;
        this.rate = Math.min(SPEED_MAX, 1 + SPEED_STEP * next);
        this._play(whenCtx, next, 0);
        this.lives = Math.min(LIVES, this.lives + 1);
        this.banner = { text: `LAP ${next + 1}!`, sub: `FASTER! x${this.rate.toFixed(2)}`, at: performance.now() + Math.max(0, (whenCtx - this.ctx.currentTime) * 1000) };
        Sfx.levelUp(Math.min(4, next));
      }
      // Tiles that slipped past.
      for (const n of this.notes) {
        if (n.t > P) break;
        if (!n.judged && (P - n.t) / this.rate > LATE) { this._miss(n); if (this.over) return; }
      }
      // Long tiles being held score while held; letting go just ends them.
      for (const h of this.holding) {
        if (this.held[h.lane] && P < h.holdEnd) {
          const seg = Math.min(P, h.holdEnd) - Math.max(h.heldTo || h.t, h.t);
          if (seg > 0) this.score += HOLD_POINTS * seg * (h.lap + 1);
          h.heldTo = Math.min(P, h.holdEnd);
        } else if (!this.held[h.lane]) h.released = true;
      }
      this.holding = this.holding.filter((h) => !h.released && h.holdEnd > P);
      // Drop tiles well behind us.
      if (this.notes.length > 400) {
        const cut = this.notes.findIndex((n) => n.t > P - 3);
        if (cut > 100) this.notes.splice(0, cut);
      }
    }

    _draw(nowMs, dt) {
      const st = this.stage;
      const g = st.g;
      const W = st.width, H = st.height;
      const PAL = Stage.PAL;
      const P = this.over ? this.overP : this.now();
      const line = this.lineY();
      const px = this.scroll * (H / 450);
      const colW = W / 4;
      const tileH = Math.round(H * 0.15);

      // Board: bright blue columns, so the dark tiles stand out (like Magic Tiles).
      g.fillStyle = '#24347e';
      g.fillRect(0, 0, W, H);
      // The board breathes with the beat, and flashes on every 25 in a row.
      const inLap = ((P % this.duration) + this.duration) % this.duration;
      let lastBeat = -Infinity;
      for (const b of this.beats) { if (b > inLap) break; lastBeat = b; }
      const pulse = Math.max(0, 1 - (inLap - lastBeat) / 0.25);
      const flash = Math.max(0, 1 - (nowMs - this.boardFlashAt) / 400);
      for (let c = 0; c < 4; c++) {
        g.fillStyle = c % 2 ? '#2a3c8c' : '#26378a';
        g.fillRect(Math.round(c * colW), 0, Math.ceil(colW), H);
        // Light rising from the line: brighter toward the bottom, pulsing on the beat.
        g.globalAlpha = 0.1 + 0.12 * pulse + 0.35 * flash;
        g.fillStyle = flash > 0 ? COLORS[c] : '#6a88ff';
        g.fillRect(Math.round(c * colW), line - H * 0.35, Math.ceil(colW), H * 0.35);
        g.globalAlpha = 1;
        if (this.held[c]) {
          g.globalAlpha = 0.25;
          g.fillStyle = COLORS[c];
          g.fillRect(Math.round(c * colW), line - 40, Math.ceil(colW), H - line + 40);
          g.globalAlpha = 1;
        }
      }
      // Beat lines scroll with the music.
      g.fillStyle = '#3346a2';
      const beat = 60 / 120;
      for (let b = Math.ceil((P - 2) / beat) * beat; b < P + H / px; b += beat) {
        const y = Math.round(line - (b - P) * px);
        if (y > 0 && y < H) g.fillRect(0, y, W, 1);
      }
      for (let c = 1; c < 4; c++) st.rect(Math.round(c * colW), 0, 1, H, '#4a60c0');
      // The streak, behind the tiles.
      if (this.combo >= 10) st.text(`${this.combo}`, W / 2, Math.round(H * 0.5), '#5a70d0', 24, 'center');

      // Red cells where an empty column was tapped.
      this.flashes = this.flashes.filter((f) => nowMs - f.at < 500);
      for (const f of this.flashes) {
        g.globalAlpha = 0.6 * (1 - (nowMs - f.at) / 500);
        st.rect(Math.round(f.lane * colW), line - tileH, Math.ceil(colW), tileH * 1.4, PAL.red);
        g.globalAlpha = 1;
      }

      // Tiles: the tile's bottom edge reaches the line at its moment.
      for (const n of this.notes) {
        const yBot = line - (n.t - P) * px;
        const h = Math.max(tileH, n.len * px);
        const yTop = yBot - h;
        if (yTop > H) continue;
        if (yBot < -10) break;
        const x = Math.round(n.lane * colW) + 2;
        const w = Math.ceil(colW) - 4;
        if (n.judged && n.judged !== 'miss' && !n.len) {
          // Tapped: flashes white, lights up in its colour and bulges as it fades.
          const k = (nowMs - n.hitAt) / 260;
          if (k >= 1) continue;
          const grow = 1 + 0.18 * Math.sin(Math.min(1, k * 1.6) * Math.PI);
          const gw = w * grow, gh = h * (2 - grow);
          const gx = x + (w - gw) / 2, gy = yTop + (h - gh) / 2;
          g.globalAlpha = 1 - k * k;
          st.rect(gx, gy, gw, gh, k < 0.25 ? '#ffffff' : COLORS[n.lane]);
          st.rect(gx + 3, gy + 3, gw - 6, Math.max(2, gh * 0.25), '#ffffff');
          g.globalAlpha = 1;
          continue;
        }
        const missed = n.judged === 'miss';
        const blink = missed && Math.floor((nowMs - n.missAt) / 120) % 2 === 0;
        // A near-black tile with a bright outline in its column's colour.
        const edge = missed ? PAL.red : COLORS[n.lane];
        st.rect(x - 1, Math.round(yTop) - 1, w + 2, Math.round(h) + 2, PAL.ink);
        st.rect(x, Math.round(yTop), w, Math.round(h), edge);
        st.rect(x + 2, Math.round(yTop) + 2, w - 4, Math.round(h) - 4, missed ? (blink ? PAL.red : '#601020') : '#0a0a1c');
        if (!missed) {
          // Glossy body: a soft lift toward the bottom, a highlight band across the
          // top, and a shine that sweeps across every tile now and then.
          const yt = Math.round(yTop) + 2, hh = Math.round(h) - 4;
          g.globalAlpha = 0.35;
          st.rect(x + 2, yt + hh * 0.55, w - 4, hh * 0.45, '#20204a');
          g.globalAlpha = 0.22;
          st.rect(x + 4, yt + 2, w - 8, Math.max(3, hh * 0.18), '#9aa8ff');
          g.globalAlpha = 0.5;
          st.rect(x + 2, yt, 1, hh, edge);
          g.globalAlpha = 1;
          const sweep = ((nowMs / 1400 + n.lane * 0.17 + n.t * 0.37) % 1.6) - 0.3; // -0.3..1.3 across the tile
          if (sweep > -0.2 && sweep < 1.2) {
            g.globalAlpha = 0.28;
            g.fillStyle = '#ffffff';
            for (let r = 0; r < hh; r++) {
              const sx = x + 2 + (w - 4) * sweep + r * 0.45 - hh * 0.2;
              const a = Math.max(x + 2, sx), b = Math.min(x + w - 2, sx + 5);
              if (b > a) g.fillRect(Math.round(a), yt + r, Math.round(b - a), 1);
            }
            g.globalAlpha = 1;
          }
        }
        st.rect(x, Math.round(yBot) - 6, w, 6, edge);
        st.rect(x, Math.round(yBot) - 6, w, 1, '#ffffff');
        if (n.len) {
          // Long tile: a bar up the middle that fills as you hold.
          const cx = x + w / 2;
          st.rect(cx - 2, Math.round(yTop) + 10, 4, Math.round(h) - 18, '#2a2f6a');
          if (n.judged && n.judged !== 'miss') {
            const filled = Math.min(1, ((n.heldTo || n.t) - n.t) / n.len);
            const fh = (Math.round(h) - 14) * filled;
            st.rect(cx - 3, Math.round(yBot) - 6 - fh, 6, fh, COLORS[n.lane]);
            if (this.held[n.lane] && !n.released && fh > 0) {
              // Held: the fill glows and sparkles at its tip.
              g.globalAlpha = 0.3 + 0.2 * Math.sin(nowMs / 60);
              st.rect(x + 2, Math.round(yBot) - 6 - fh, w - 4, fh, COLORS[n.lane]);
              g.globalAlpha = 1;
              if (Math.random() < 0.4) st.burst(cx, Math.round(yBot) - 6 - fh, '#ffffff', 1, 40);
            }
          }
          st.rect(cx - 5, Math.round(yTop) + 4, 10, 4, COLORS[n.lane]);
        }
      }

      // Tap flourishes: a light beam up the column and a ring bursting from the line.
      this.effects = this.effects.filter((e) => nowMs - e.at < 360);
      for (const e of this.effects) {
        const k = (nowMs - e.at) / 360;
        const cx = (e.lane + 0.5) * colW;
        g.globalAlpha = 0.45 * (1 - k);
        st.rect(Math.round(e.lane * colW) + 4, 0, Math.ceil(colW) - 8, line, COLORS[e.lane]);
        g.globalAlpha = 0.8 * (1 - k);
        g.strokeStyle = e.kind === 'perfect' ? '#ffffff' : COLORS[e.lane];
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(cx, line, 8 + k * colW * 0.7, 4 + k * 18, 0, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }

      // The line: tap tiles as their coloured edge reaches it. It lights up where you hit.
      st.rect(0, line - 1, W, 4, PAL.ink);
      st.rect(0, line, W, 2, PAL.cyan);
      for (const e of this.effects) {
        const k = (nowMs - e.at) / 360;
        g.globalAlpha = 1 - k;
        st.rect(Math.round(e.lane * colW), line - 2, Math.ceil(colW), 6, '#ffffff');
        g.globalAlpha = 1;
      }
      st.drawParticles(dt);

      // Judgement words, just above the line.
      this.pops = this.pops.filter((p) => nowMs - p.at < 400);
      for (const p of this.pops) {
        const k = (nowMs - p.at) / 400;
        g.globalAlpha = 1 - k;
        const label = { perfect: 'PERFECT', great: 'GREAT', cool: 'COOL' }[p.kind];
        const color = { perfect: PAL.cyan, great: PAL.green, cool: PAL.gold }[p.kind];
        const big = p.kind === 'perfect' && k < 0.12;
        st.text(label, (p.lane + 0.5) * colW, line + 10 + k * 6, big ? '#ffffff' : color, 8, 'center');
        g.globalAlpha = 1;
      }

      // HUD: lives, score, stars / crowns, lap, pause.
      for (let i = 0; i < LIVES; i++) this._heart(6 + i * 18, 6, i < this.lives, nowMs);
      const prog = this.progress(P);
      const bump = Math.max(0, 1 - (nowMs - this.scoreBumpAt) / 140);
      st.text(Math.round(this.score).toLocaleString('en-US'), W / 2, 22 - Math.round(bump * 3), bump > 0.5 ? PAL.gold : PAL.white, 24, 'center');
      // Progress bar across the top with three star marks, then crowns.
      st.rect(0, 0, W, 3, '#20204a');
      st.rect(0, 0, W * ((P / this.duration) % 1 || (P >= this.duration ? 1 : 0)), 3, prog.crowns || P >= this.duration ? PAL.gold : PAL.cyan);
      if (P < this.duration) {
        for (let i = 0; i < 3; i++) st.star(W / 2 - 24 + i * 17, 50, prog.stars > i ? 1 : 0, 2);
      } else {
        const crowns = Math.max(1, prog.crowns + 1);
        st.text('LAP ' + (this.lap + 1), W / 2, 52, PAL.gold, 8, 'center');
        for (let i = 0; i < Math.min(5, crowns - 1); i++) this._crown(W / 2 - 22 + i * 12, 62);
      }
      // Pause button.
      st.window(W - 27, 4, 22, 18);
      st.rect(W - 20, 8, 3, 10, PAL.white);
      st.rect(W - 15, 8, 3, 10, PAL.white);

      // Banner (new lap, streaks).
      if (this.banner) {
        const age = (nowMs - this.banner.at) / 1000;
        if (age > 1.8) this.banner = null;
        else if (age >= 0) {
          const by = Math.round(H * 0.36);
          st.rect(0, by - 6, W, this.banner.sub ? 38 : 28, 'rgba(8,8,26,0.8)');
          st.rect(0, by - 6, W, 1, PAL.gold);
          st.rect(0, by + (this.banner.sub ? 31 : 21), W, 1, PAL.gold);
          st.text(this.banner.text, W / 2, by, PAL.gold, 16, 'center');
          if (this.banner.sub) st.text(this.banner.sub, W / 2, by + 20, PAL.white, 8, 'center');
        }
      }
      // Count-in.
      const lead = this.ctx.currentTime - (this.resumeAt || this.lapStartCtx);
      if (!this.paused && lead < 0 && lead > -3) st.text(String(Math.ceil(-lead / (this.resumeAt ? 0.6 : 0.75))), W / 2, H * 0.45, PAL.white, 24, 'center');
      if (this.intro && P < 1.5 && P > -3) {
        st.text(this.intro.title.slice(0, 24), W / 2, H * 0.3, PAL.white, 8, 'center');
        st.text(this.intro.sub, W / 2, H * 0.3 + 12, PAL.cyan, 8, 'center');
      }
      if (this.over) {
        st.rect(0, H * 0.42, W, 44, 'rgba(40,0,10,0.88)');
        st.text('GAME OVER', W / 2, H * 0.42 + 8, PAL.red, 16, 'center');
        st.text(`${this.tiles} TILES`, W / 2, H * 0.42 + 28, PAL.white, 8, 'center');
      }
      if (this.restartProgress > 0) {
        st.window(W / 2 - 74, 80, 148, 24);
        st.text('HOLD TO RESTART', W / 2, 85, PAL.white, 8, 'center');
        st.rect(W / 2 - 66, 96, 132 * Math.min(1, this.restartProgress), 3, PAL.gold);
      }
      st.blit(dt);
    }

    _heart(x, y, full, nowMs) {
      const SHAPE = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
      const beat = full && this.lives === 1 && Math.floor(nowMs / 250) % 2 === 0;
      SHAPE.forEach((row, r) => {
        for (let c = 0; c < 7; c++) {
          if (row[c] === '#') this.stage.rect(x + c * 2, y + r * 2, 2, 2, full ? (beat ? '#ffffff' : '#f84870') : '#3a3a6a');
        }
      });
    }

    _crown(x, y) {
      const SHAPE = ['#.#.#', '#####', '#####'];
      SHAPE.forEach((row, r) => {
        for (let c = 0; c < 5; c++) if (row[c] === '#') this.stage.rect(x + c * 2, y + r * 2, 2, 2, Stage.PAL.gold);
      });
    }
  }

  TilesGame.LIVES = LIVES;
  root.TilesGame = TilesGame;
})(window);
