/*
 * Tiles mode — a Magic Tiles–style way to play any song.
 *
 * A flat board of four columns, played upright. Tiles fall straight down; tap a
 * tile's column as it reaches the line near the bottom (early is fine). Long
 * tiles are held, and fill with colour while you hold them. Two hearts: a tile
 * that slips past, or a tap on an empty column, costs one, and each new lap
 * gives one back. The song loops, faster every lap. Stars come during the first
 * lap, crowns for every lap after that.
 *
 * It reuses the 4-lane phone chart for the chosen tier, the Stage's pixel buffer
 * for drawing, and the shared sound effects.
 */
'use strict';
(function (root) {
  const RESUME_LEAD = 2.4;
  const RESUME_REWIND = 1; // song seconds
  const LIVES = 2;
  const SPEED_STEP = 0.22; // each lap plays 22% faster
  const SPEED_MAX = 2.5;
  // Real-time windows (seconds): tap up to EARLY before a tile's moment, LATE after.
  const EARLY = 0.5;
  const LATE = 0.2;
  const START_LEAD = 1.2; // song-seconds between tapping START and the music starting
  const RUN_GAP = 0.32; // tiles closer than this in one column form a run (shown with dots)
  const SECOND_CHANCE_REWIND = 3; // song seconds
  // Where the line sits, in % of the board above the bottom edge (player's choice).
  const LINE_UP = { min: 15, max: 45, default: 30 };
  const PERFECT = 0.07;
  const GREAT = 0.14;
  const POINTS = { perfect: 3, great: 2, cool: 1 };
  const HOLD_POINTS = 4; // per second held
  const PACE_STEP = 2; // timeline samples, in song-seconds of the run
  const STAR_AT = [1 / 3, 2 / 3, 1]; // share of the first lap
  const BOUNCE = 0.12; // a second tap this soon after a hit in the same column is ignored
  // Pixels per song-second on a 450-tall board, by tier.
  const SCROLL = { easy: 230, medium: 270, mediumplus: 290, hard: 310 };

  const COLORS = ['#38d838', '#f84848', '#f8d830', '#4878f8'];
  const PAL_INK = '#08081a';

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
     * @param {{initials:string, score:number, timeline:number[]|null, laps:number}|null} o.rival
     *        a challenge: race this score, compared at the same point of the run
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
      this.rival = o.rival && typeof o.rival.score === 'number' ? o.rival : null;
      this.raceLead = null; // true while you're ahead of the rival
      this.timeline = []; // score every PACE_STEP of the run, for later challengers
      this.beats = o.beats || []; // one lap's beat times, for the board's pulse
      this.setLineUp(o.lineUp == null ? LINE_UP.default : o.lineUp);
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
      this.secondChance = true; // one rewind per run when the last heart goes
      this.secondChanceUsed = false;
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
      if (this.waiting) return -START_LEAD;
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
      const lap = this.chart.map((n) => ({ t: n.t + off, lane: n.lane, len: n.len, lap: k, judged: null }));
      // Tiles that arrive together are a linked pair (or more): tap them at once.
      for (let i = 0; i < lap.length; i++) {
        let j = i;
        while (j + 1 < lap.length && Math.abs(lap[j + 1].t - lap[i].t) < 0.005) j++;
        if (j > i) for (let m = i; m <= j; m++) lap[m].group = lap.slice(i, j + 1);
        i = j;
      }
      // Per column: how long until the next tile (so quick repeats fit without
      // overlapping) and runs of quick repeats, counted down with dots.
      for (let lane = 0; lane < 4; lane++) {
        const col = lap.filter((n) => n.lane === lane);
        for (let i = 0; i < col.length; i++) col[i].gapNext = i + 1 < col.length ? col[i + 1].t - col[i].t : Infinity;
        for (let i = 0; i < col.length;) {
          let j = i;
          while (j + 1 < col.length && !col[j].len && col[j + 1].t - col[j].t < RUN_GAP) j++;
          if (j - i >= 2) for (let m = i; m <= j; m++) col[m].runLeft = j - m + 1;
          i = j + 1;
        }
      }
      this.notes.push(...lap);
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

    /** Show the board with a START tile; the song begins when it's tapped. */
    async start() {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      if (root.Sfx) Sfx.resetMusicFx();
      this.sources = [];
      this.lapStartP = 0;
      this.waiting = true;
      this.running = true;
      requestAnimationFrame(this._frame);
    }

    _begin() {
      this.waiting = false;
      this.startedAt = performance.now();
      this._play(this.ctx.currentTime + START_LEAD, 0, 0);
      Sfx.go();
      const W = this.stage.width;
      this.stage.burst(W / 2, this.lineY() - 20, '#ffffff', 16, 140);
      this.stage.burst(W / 2, this.lineY() - 20, COLORS[1], 12, 120);
    }

    pause() {
      if (!this.running || this.paused || this.over) return;
      if (this.waiting) { this.paused = true; this.onPauseChange(true); return; }
      this.pausedP = this.now();
      this._stopSources();
      this.paused = true;
      this.held.fill(false);
      this.onPauseChange(true);
    }

    resume() {
      if (!this.running || !this.paused) return;
      if (this.waiting) { this.paused = false; this.onPauseChange(false); return; }
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
      if (this.waiting) {
        // Start on release, so a drag to move the line doesn't start the song.
        if (down) this.dragged = false;
        else if (!this.dragged) this._begin();
        return;
      }
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
      if (this.lives <= 0 && this.secondChance) { this._secondChance(); return; }
      if (this.lives <= 0) this._gameOver();
    }

    /**
     * Once per run, losing the last heart rewinds a few seconds instead of ending
     * the game: the tile you missed comes back, with a count-in.
     */
    _secondChance() {
      this.secondChance = false;
      this.secondChanceUsed = true;
      this.lives = 1;
      const P = this.now();
      this._stopSources();
      this.queued = null;
      for (const h of this.holding) { h.released = true; h.releasedAt = performance.now(); }
      this.holding = [];
      this.held.fill(false);
      for (const n of this.notes) {
        if (n.judged === 'miss' && n.t > P - SECOND_CHANCE_REWIND - 1) { n.judged = null; n.missAt = undefined; }
      }
      // resume() rewinds RESUME_REWIND more and counts in.
      this.pausedP = Math.max(this.lap * this.duration + RESUME_REWIND, P - (SECOND_CHANCE_REWIND - RESUME_REWIND));
      this.paused = true;
      this.banner = { text: 'SECOND CHANCE!', sub: 'ONE MORE TRY', at: performance.now() };
      this.resume();
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

    // ---- challenges --------------------------------------------------------------------
    //
    // Runs are compared at the same position P (laps speed up the same for everyone).

    /** Where the rival stood at P: their saved timeline, or an estimate from their laps. */
    _rivalAt(P) {
      const r = this.rival;
      const tl = r.timeline;
      if (tl && tl.length > 1) {
        const x = P / PACE_STEP;
        const i = Math.floor(x);
        if (i < 0) return 0;
        if (i >= tl.length - 1) return r.score; // their run ended here
        return tl[i] + (tl[i + 1] - tl[i]) * (x - i);
      }
      // Estimate: points come in proportion to the lap multiplier (lap k is worth k+1).
      const D = this.duration;
      const weight = (p) => { const k = Math.floor(p / D); return D * k * (k + 1) / 2 + (k + 1) * (p - k * D); };
      const end = ((r.laps || 0) + 0.5) * D;
      return P >= end ? r.score : r.score * weight(Math.max(0, P)) / weight(end);
    }

    _race(P) {
      if (!this.rival || P < 4) return;
      const ahead = this.score > this._rivalAt(P);
      if (this.raceLead === null) { this.raceLead = ahead; return; }
      if (ahead === this.raceLead) return;
      this.raceLead = ahead;
      this.banner = ahead
        ? { text: 'YOU TAKE THE LEAD!', sub: 'VS ' + this.rival.initials, at: performance.now() }
        : { text: `${this.rival.initials} LEADS`, sub: 'CATCH UP!', at: performance.now() };
      if (ahead) Sfx.takeLead(); else Sfx.loseLead();
    }

    raceView(P) {
      if (!this.rival || P < 1) return null;
      const them = this._rivalAt(P);
      return {
        name: this.rival.initials,
        gap: Math.round(this.score - them),
        youLead: this.raceLead === null ? this.score >= them : this.raceLead,
        estimate: !(this.rival.timeline && this.rival.timeline.length > 1),
      };
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
        timeline: this.timeline.slice(),
      };
    }

    // ---- frame -----------------------------------------------------------------------

    lineY() { return Math.round(this.stage.height * (1 - this.lineUp / 100)); }

    /** Move the line: `up` is % of the board above the bottom edge. */
    setLineUp(up) {
      this.lineUp = Math.max(LINE_UP.min, Math.min(LINE_UP.max, Math.round(up)));
      return this.lineUp;
    }

    /** START screen: drag the line up or down (a tap without dragging starts the song). */
    dragLine(clientY) {
      const y = this.stage.toBuffer(0, clientY).y;
      this.dragged = true;
      return this.setLineUp((1 - y / this.stage.height) * 100);
    }

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
      if (this.waiting) return;
      const P = this.now();
      while (P >= 0 && this.timeline.length <= Math.floor(P / PACE_STEP)) this.timeline.push(Math.round(this.score));
      this._race(P);
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
        if (!n.judged && (P - n.t) / this.rate > LATE) {
          const chance = this.secondChance;
          this._miss(n);
          if (this.over || chance !== this.secondChance) return; // game over, or rewound
        }
      }
      // Long tiles score while held and fill with colour; letting go ends them
      // (the colour drains away), holding to the end makes them burst.
      const nowMs = performance.now();
      for (const h of this.holding) {
        if (this.held[h.lane]) {
          const to = Math.min(P, h.holdEnd);
          const seg = to - Math.max(h.heldTo || h.t, h.t);
          if (seg > 0) this.score += HOLD_POINTS * seg * (h.lap + 1);
          h.heldTo = to;
          const step = Math.min(4, Math.floor(((to - h.t) / h.len) * 4));
          if (step > (h.step || 0)) { h.step = step; if (step < 4) Sfx.holdStep(h.lane, step); }
          if (P >= h.holdEnd) {
            h.doneAt = nowMs;
            this.scoreBumpAt = nowMs;
            this.effects.push({ lane: h.lane, at: nowMs, kind: 'perfect' });
            Sfx.tileTap(h.lane, true);
            const cx = (h.lane + 0.5) * (this.stage.width / 4);
            // The whole tile explodes: sparks from bottom to top.
            const top = h.pinTop != null ? h.pinTop : this.lineY() - 40;
            for (let y = this.lineY() - 6; y > top; y -= 14) {
              this.stage.burst(cx, y, COLORS[h.lane], 6, 120);
              this.stage.burst(cx, y, '#ffffff', 2, 150);
            }
            this.stage.kick(1);
          }
        } else {
          h.released = true;
          h.releasedAt = nowMs;
        }
      }
      this.holding = this.holding.filter((h) => !h.released && !h.doneAt);
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

      // Linked pairs: a glowing bridge between tiles you tap together (drawn first,
      // so the tiles sit on top of it).
      for (const n of this.notes) {
        const yBot = line - (n.t - P) * px;
        if (yBot < -10) break;
        if (yBot > H + 20 || !n.group || n.group[0] !== n || n.group.some((m) => m.judged)) continue;
        const lanes = n.group.map((m) => m.lane);
        const x0 = (Math.min(...lanes) + 0.5) * colW, x1 = (Math.max(...lanes) + 0.5) * colW;
        const yb = Math.round(yBot) - 12;
        st.rect(x0, yb - 3, x1 - x0, 8, PAL.ink);
        g.globalAlpha = 0.75 + 0.25 * Math.sin(nowMs / 90);
        st.rect(x0, yb - 2, x1 - x0, 6, '#ffffff');
        g.globalAlpha = 1;
        for (let x = x0 + 6; x < x1 - 4; x += 10) st.rect(x, yb, 4, 2, PAL.cyan);
      }

      // Tiles: the tile's bottom edge reaches the line at its moment. Quick repeats
      // in one column are shortened to fit, so they never overlap.
      for (const n of this.notes) {
        const yBot = line - (n.t - P) * px;
        const h = n.len ? Math.max(tileH, n.len * px) : Math.max(12, Math.min(tileH, (n.gapNext || Infinity) * px - 4));
        const yTop = yBot - h;
        const grabbed = n.len && n.judged && n.judged !== 'miss'; // pinned at the line
        if (yTop > H && !grabbed) continue;
        if (yBot < -10) break;
        const x = Math.round(n.lane * colW) + 2;
        const w = Math.ceil(colW) - 4;
        const yb = Math.round(yBot), yt = Math.round(yTop), hh = Math.round(h);
        const color = COLORS[n.lane];
        const missed = n.judged === 'miss';
        const hit = n.judged && !missed;
        if (hit && !n.len) {
          // Tapped: colour floods in from the border to the middle, the tile presses
          // down a touch, then fades.
          const ms = nowMs - n.hitAt;
          if (ms > 320) continue;
          const k = Math.min(1, ms / 90);
          const inset = 2 + (Math.min(w, hh) / 2) * (1 - (1 - k) * (1 - k));
          const dy = ms < 120 ? 2 : 0;
          g.globalAlpha = ms < 140 ? 1 : Math.max(0, 1 - (ms - 140) / 180);
          st.rect(x - 1, yt - 1 + dy, w + 2, hh + 2, PAL.ink);
          st.rect(x, yt + dy, w, hh, ms < 50 ? '#ffffff' : color);
          if (inset * 2 < Math.min(w, hh)) st.rect(x + inset, yt + inset + dy, w - inset * 2, hh - inset * 2, '#0a0a1c');
          if (k >= 1) {
            g.globalAlpha *= 0.6;
            st.rect(x + 3, yt + 3 + dy, w - 6, Math.max(3, hh * 0.22), '#ffffff');
          }
          g.globalAlpha = 1;
          continue;
        }
        if (hit && n.len) { this._drawHeld(n, x, w, hh, line, px, P, nowMs); continue; }
        const blink = missed && Math.floor((nowMs - n.missAt) / 120) % 2 === 0;
        // A near-black tile with a bright border in its column's colour.
        const edge = missed ? PAL.red : color;
        st.rect(x - 1, yt - 1, w + 2, hh + 2, PAL.ink);
        st.rect(x, yt, w, hh, edge);
        st.rect(x + 2, yt + 2, w - 4, hh - 4, missed ? (blink ? PAL.red : '#601020') : '#0a0a1c');
        if (!n.len) {
          // Single tile: a soft highlight across the top and a solid colour base.
          if (!missed) {
            g.globalAlpha = 0.2;
            st.rect(x + 4, yt + 4, w - 8, Math.max(3, hh * 0.16), '#9aa8ff');
            g.globalAlpha = 1;
          }
          st.rect(x, yb - 6, w, 6, edge);
          st.rect(x, yb - 6, w, 1, '#ffffff');
          if (n.group && !missed) {
            // Part of a pair: a white outline and "x2" so both read as one tap.
            const c = Math.floor(nowMs / 160) % 2 ? '#ffffff' : edge;
            st.rect(x + 2, yt + 2, w - 4, 1, c);
            st.rect(x + 2, yt + 2, 1, hh - 8, c);
            st.rect(x + w - 3, yt + 2, 1, hh - 8, c);
            if (hh >= 26) st.text('x' + n.group.length, x + w / 2, yt + hh / 2 - 6, '#ffffff', 8, 'center');
          }
          if (n.runLeft && !missed && hh >= 14) {
            // A quick run in this column: dots count the taps left in it.
            const dots = Math.min(5, n.runLeft);
            const dy = yt + Math.max(4, hh / 2 - 4);
            for (let d = 0; d < dots; d++) st.rect(x + w / 2 - (dots * 6) / 2 + d * 6 + 1, dy, 4, 4, '#ffffff');
          }
          continue;
        }
        // Long tile: looks different before you touch it, with coloured side rails,
        // a dashed track up the middle, a glowing start pad and an end cap.
        const cx = Math.round(x + w / 2);
        g.globalAlpha = 0.55;
        st.rect(x + 5, yt + 8, 2, hh - 24, edge);
        st.rect(x + w - 7, yt + 8, 2, hh - 24, edge);
        for (let y = yb - 22; y > yt + 10; y -= 8) st.rect(cx - 1, y - 4, 2, 4, edge);
        g.globalAlpha = 1;
        st.rect(x + 2, yt + 2, w - 4, 4, edge); // end cap
        // While held (or draining after a let-go), the tile fills with colour.
        let fill = 0;
        if (hit) {
          fill = Math.max(0, ((n.heldTo || n.t) - n.t) * px);
          if (n.released) fill *= Math.max(0, 1 - (nowMs - n.releasedAt) / 280);
          fill = Math.min(fill, hh - 2);
        }
        if (fill > 0) {
          const top = yb - fill;
          st.rect(x + 2, top, w - 4, fill, color);
          g.globalAlpha = 0.3;
          st.rect(x + Math.round(w * 0.22), top, Math.round(w * 0.14), fill, '#ffffff');
          g.globalAlpha = 1;
          if (!n.released) {
            // The leading edge glows and throws sparks.
            const glow = 0.6 + 0.4 * Math.sin(nowMs / 50);
            g.globalAlpha = glow;
            st.rect(x, top - 2, w, 3, '#ffffff');
            g.globalAlpha = 1;
            if (Math.random() < 0.5) st.burst(x + 4 + Math.random() * (w - 8), top, '#ffffff', 1, 50);
          }
        }
        // Start pad: a solid block with an up-arrow, so you know to press and hold.
        const padTop = yb - 14;
        st.rect(x, padTop, w, 14, edge);
        st.rect(x, padTop, w, 1, '#ffffff');
        for (let i = 0; i < 4; i++) st.rect(cx - i, padTop + 4 + i, 1 + i * 2, 1, PAL.ink);
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
      if (this.secondChance) st.text('+1', 6 + LIVES * 18 + 2, 8, PAL.gold, 8, 'left'); // a second chance left

      // Before the song: a big START tile across the middle columns.
      if (this.waiting || (this.startedAt && nowMs - this.startedAt < 300)) {
        const k = this.waiting ? 0 : (nowMs - this.startedAt) / 300;
        const sx = Math.round(colW) + 2, sw = Math.round(colW * 2) - 4, sh = Math.round(tileH * 1.2);
        const sy = line - sh - Math.round(k * 20);
        const pulse = 0.5 + 0.5 * Math.sin(nowMs / 180);
        g.globalAlpha = 1 - k;
        st.rect(sx - 1, sy - 1, sw + 2, sh + 2, PAL.ink);
        st.rect(sx, sy, sw, sh, k > 0 ? '#ffffff' : PAL.cyan);
        st.rect(sx + 3, sy + 3, sw - 6, sh - 6, '#0a0a1c');
        g.globalAlpha = (1 - k) * (0.25 + 0.25 * pulse);
        st.rect(sx + 3, sy + 3, sw - 6, sh - 6, PAL.cyan);
        g.globalAlpha = 1 - k;
        st.text('START', W / 2, sy + sh / 2 - 12, '#ffffff', 16, 'center');
        st.text('TAP TO PLAY', W / 2, sy + sh / 2 + 10, PAL.cyan, 8, 'center');
        g.globalAlpha = 1;
        if (this.waiting) {
          // Handles on the line: drag it to where your thumbs like it.
          const bob = Math.round(Math.sin(nowMs / 180) * 2);
          for (const hx of [14, W - 14]) {
            st.window(hx - 10, line - 16, 20, 32);
            for (let i = 0; i < 4; i++) {
              st.rect(hx - i, line - 10 + i - bob, 1 + i * 2, 1, PAL.cyan);
              st.rect(hx - i, line + 10 - i + bob, 1 + i * 2, 1, PAL.cyan);
            }
            st.rect(hx - 5, line - 1, 11, 3, PAL.white);
          }
          st.text('DRAG TO MOVE LINE', W / 2, Math.min(H - 12, line + 14), PAL.white, 8, 'center');
        }
      }
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
      // A challenge: who leads, and the gap.
      const race = !this.waiting && this.raceView(P);
      if (race) {
        const ry = P < this.duration ? 70 : 76;
        g.globalAlpha = 0.6; // a dark plate, so falling tiles don't hide it
        st.rect(Math.round(W / 2 - 74), ry - 4, 148, 25, PAL.ink);
        g.globalAlpha = 1;
        st.drawRace(race, W / 2, ry, 'center');
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
      const lead = this.resumeAt ? this.ctx.currentTime - this.resumeAt : 0;
      if (!this.paused && !this.waiting && lead < 0 && lead > -3) st.text(String(Math.ceil(-lead / 0.6)), W / 2, H * 0.45, PAL.white, 24, 'center');
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

    /**
     * A long tile you've grabbed stops at the line and fills with colour from the
     * bottom to the top as you hold it, reaching the top as the hold ends, then
     * explodes. Let go early and the colour drains out and the tile fades.
     */
    _drawHeld(n, x, w, hh, line, px, P, nowMs) {
      const st = this.stage, g = st.g;
      const color = COLORS[n.lane];
      const live = !n.released && !n.doneAt;
      if (live) {
        // Make room if the next tile in this column is arriving: shrink from the top.
        let top = line - hh;
        for (const o of this.notes) {
          if (o !== n && o.lane === n.lane && !o.judged && o.t > n.t) { top = Math.max(top, line - (o.t - P) * px + 3); break; }
        }
        n.pinTop = Math.min(line - 16, top);
      }
      const top = Math.round(n.pinTop);
      const h = line - top;
      const progress = Math.min(1, ((n.heldTo || n.t) - n.t) / n.len);
      if (n.doneAt) {
        // Completed: the tile flashes white, swells and bursts.
        const ms = nowMs - n.doneAt;
        if (ms > 380) return;
        const k = ms / 380;
        const grow = 1 + 0.25 * k;
        g.globalAlpha = 1 - k;
        st.rect(x + (w - w * grow) / 2, top - h * 0.1 * k, w * grow, h * (1 + 0.1 * k), ms < 90 ? '#ffffff' : color);
        g.globalAlpha = 1;
        return;
      }
      let fade = 1, drain = 1;
      if (n.released) {
        const k = (nowMs - n.releasedAt) / 300;
        if (k >= 1) return;
        drain = 1 - k;
        fade = 1 - k * k;
      }
      g.globalAlpha = fade;
      st.rect(x - 1, top - 1, w + 2, h + 2, PAL_INK);
      st.rect(x, top, w, h, color);
      st.rect(x + 2, top + 2, w - 4, h - 4, '#0a0a1c');
      // The colour rising from the bottom.
      const fh = Math.round((h - 4) * progress * drain);
      if (fh > 0) {
        st.rect(x + 2, line - 2 - fh, w - 4, fh, color);
        g.globalAlpha = fade * 0.35;
        st.rect(x + Math.round(w * 0.2), line - 2 - fh, Math.round(w * 0.12), fh, '#ffffff');
        g.globalAlpha = fade;
        if (live) {
          // A glowing, sparking surface on the rising colour.
          g.globalAlpha = fade * (0.7 + 0.3 * Math.sin(nowMs / 45));
          st.rect(x + 2, line - 4 - fh, w - 4, 3, '#ffffff');
          g.globalAlpha = fade;
          if (Math.random() < 0.6) st.burst(x + 4 + Math.random() * (w - 8), line - 3 - fh, '#ffffff', 1, 45);
        }
      }
      // Quarter marks: each one lights up as the colour passes it.
      for (let q = 1; q < 4; q++) {
        const y = Math.round(line - 2 - (h - 4) * q / 4);
        st.rect(x + 4, y, 5, 1, progress * drain >= q / 4 ? '#ffffff' : color);
        st.rect(x + w - 9, y, 5, 1, progress * drain >= q / 4 ? '#ffffff' : color);
      }
      if (live) {
        // The whole column glows while you hold.
        g.globalAlpha = 0.18 + 0.08 * Math.sin(nowMs / 80);
        st.rect(x - 2, 0, w + 4, line, color);
      }
      g.globalAlpha = 1;
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
