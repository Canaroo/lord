/*
 * Game — one play of one chart: timing, judging, scoring, rock meter,
 * overdrive, long notes, stars and fail state. Drawing is done by Stage
 * (render.js); this file decides what happened and hands Stage a "view".
 *
 * All timing runs on the AudioContext clock, and every press is judged at the
 * moment it happened (event timestamp), not when the frame got around to it.
 */
'use strict';
(function (root) {
  const WINDOWS = { perfect: 0.05, good: 0.095, ok: 0.14 }; // seconds, either side
  const POINTS = { perfect: 100, good: 70, ok: 40 };
  // Long notes: points per second while held, and rock-meter drain per second
  // while let go. Re-pressing the key during the tail picks it back up.
  const HOLD_POINTS_PER_SEC = 60;
  const HOLD_DRAIN_PER_SEC = 0.12;
  const COUNT_IN = 3.2; // seconds before the song starts
  const RESUME_LEAD = 2.4; // count-in after unpausing
  const RESUME_REWIND = 1.0; // replay this much of the song before where you paused
  const OD_DRAIN = 1 / 16; // a full overdrive meter lasts 16 seconds
  const OD_PER_HIT = 0.011;
  const ROCK = { perfect: 0.022, good: 0.016, ok: 0.008, miss: -0.07 };
  // Stars: share of the best score possible without overdrive.
  const STAR_STEPS = [0.2, 0.4, 0.6, 0.8, 0.95];
  const PACE_STEP = 2; // seconds between pace samples
  const GRAPH_BUCKETS = 48;

  /** Highest score a chart allows without overdrive: every note perfect, every tail held. */
  function maxScore(notes) {
    let s = 0;
    notes.forEach((n, i) => {
      const mult = Math.min(4, 1 + Math.floor(i / 10));
      s += 100 * mult + (n.len || 0) * HOLD_POINTS_PER_SEC * 4;
    });
    return s;
  }

  function starsFor(score, max) {
    const r = max > 0 ? score / max : 0;
    let stars = 0;
    for (const s of STAR_STEPS) if (r >= s) stars++;
    const next = stars < STAR_STEPS.length ? Math.ceil(STAR_STEPS[stars] * max) : null;
    return { stars, next };
  }

  class Game {
    /**
     * @param {object} o
     * @param {AudioContext} o.audioCtx
     * @param {AudioBuffer} o.buffer
     * @param {{lanes:number,notes:{t:number,lane:number,len?:number}[]}} o.chart
     * @param {number[]} o.beats
     * @param {Stage} o.stage
     * @param {number} o.lookahead     seconds of notes visible on the highway
     * @param {number} o.calibration   input offset in seconds
     * @param {boolean} o.noFail
     * @param {boolean} o.antiMash     stray presses break the streak
     * @param {boolean} o.hitSounds    a soft tick on every hit
     * @param {string}  o.playerColor  the guitarist's colour
     * @param {{score:number, timeline:number[]}|null} o.best  personal best, for pace
     * @param {{title:string, sub:string}} o.intro
     * @param {(results:object)=>void} o.onEnd
     * @param {(paused:boolean)=>void} o.onPauseChange
     */
    constructor(o) {
      this.ctx = o.audioCtx;
      this.buffer = o.buffer;
      this.stage = o.stage;
      this.lanes = o.chart.lanes;
      this.notes = o.chart.notes.map((n) => ({ t: n.t, lane: n.lane, len: n.len || 0, judged: null }));
      this.beats = o.beats;
      this.lookahead = o.lookahead;
      this.calibration = o.calibration || 0;
      this.noFail = !!o.noFail;
      this.antiMash = !!o.antiMash;
      this.hitSounds = !!o.hitSounds;
      this.playerColor = o.playerColor || '#58f8f8';
      this.best = o.best && o.best.timeline && o.best.timeline.length ? o.best : null;
      this.intro = o.intro;
      this.onEnd = o.onEnd;
      this.onPauseChange = o.onPauseChange || (() => {});
      this.duration = o.buffer.duration;
      this.lastNoteT = this.notes.reduce((m, n) => Math.max(m, n.t + n.len), 0);
      this.maxScore = maxScore(this.notes);

      this.score = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.hits = 0;
      this.overhits = 0;
      this.holds = []; // long notes whose head was hit and whose tail is still running
      this.holdTotal = 0;
      this.holdHeld = 0;
      this.counts = { perfect: 0, good: 0, ok: 0, miss: 0 };
      this.offsets = []; // ms, + = late
      this.popups = [];
      this.timeline = []; // score every PACE_STEP seconds
      this.graph = Array.from({ length: GRAPH_BUCKETS }, () => ({ earned: 0, max: 0, miss: 0 }));
      this.rock = 0.5;
      this.od = 0;
      this.odActive = false;
      this.odReadyAnnounced = false;
      this.failed = false;
      this.nextIdx = 0;
      this.held = new Array(this.lanes).fill(false);
      this.judgement = null;
      this.banners = [];
      this.powerDownAt = 0;
      this.restartProgress = 0; // set by the menu code while restart is held
      this.running = false;
      this.paused = false;
      this.resumeAt = 0; // AudioContext time the song restarts after unpausing
      this.lastT = null;
      this.highT = -Infinity; // furthest song time already scored
      this.lastDanger = 0;
      this._frame = this._frame.bind(this);
    }

    static stars(score, max) { return starsFor(score, max); }

    /** Multiplier from the streak alone (1–4), before overdrive. */
    get level() { return Math.min(4, 1 + Math.floor(this.combo / 10)); }

    get multiplier() { return this.odActive ? this.level * 2 : this.level; }

    get fullComboAlive() {
      return this.hits > 0 && this.counts.miss === 0 && this.overhits === 0;
    }

    /** Song position (seconds) the player is hearing right now. */
    now() {
      if (this.paused) return this.pausedT;
      const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
      return this.ctx.currentTime - this.startAt - latency - this.calibration;
    }

    /** Song position at a past moment on the performance.now() clock. */
    timeAt(perfMs) {
      const ago = Math.max(0, Math.min(0.25, (performance.now() - perfMs) / 1000));
      return this.now() - ago;
    }

    _play(whenCtx, offset) {
      this.source = this.ctx.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.connect(Sfx.musicIn || this.ctx.destination);
      // A negative offset means "start the song this long after `whenCtx`".
      if (offset >= 0) this.source.start(whenCtx, offset);
      else this.source.start(whenCtx - offset, 0);
      this.startAt = whenCtx - offset;
    }

    async start() {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      Sfx.resetMusicFx();
      this._play(this.ctx.currentTime + COUNT_IN, 0);
      for (let i = 3; i >= 1; i--) Sfx.countdown(this.startAt - i * 0.75 - 0.25);
      Sfx.go(this.startAt - 0.25);
      this.running = true;
      requestAnimationFrame(this._frame);
    }

    pause() {
      if (!this.running || this.paused || this.failed) return;
      this.pausedT = this.now();
      this.pausedPos = this.ctx.currentTime - this.startAt;
      try { this.source.stop(); } catch (e) { /* not started yet */ }
      this.source.disconnect();
      this.paused = true;
      this.held.fill(false);
      this.onPauseChange(true);
    }

    /** Unpause: rewind a second and count back in, so you can catch the groove. */
    resume() {
      if (!this.running || !this.paused) return;
      const offset = this.pausedPos > 0 ? Math.max(0, this.pausedPos - RESUME_REWIND) : this.pausedPos;
      this.resumeAt = this.ctx.currentTime + RESUME_LEAD;
      this._play(this.resumeAt, offset);
      for (let i = 3; i >= 1; i--) Sfx.countdown(this.resumeAt - i * 0.6);
      this.paused = false;
      this.lastT = null;
      this.onPauseChange(false);
    }

    togglePause() {
      if (this.paused) this.resume(); else this.pause();
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      try { this.source.stop(); } catch (e) { /* already stopped */ }
      this.source.disconnect();
      Sfx.resetMusicFx();
    }

    results() {
      const total = this.notes.length || 1;
      const earned = this.counts.perfect * 100 + this.counts.good * 70 + this.counts.ok * 40;
      const accuracy = earned / total;
      const grade = this.failed ? 'F' : accuracy >= 95 ? 'S' : accuracy >= 88 ? 'A' : accuracy >= 75 ? 'B' : accuracy >= 60 ? 'C' : 'D';
      const score = Math.round(this.score);
      const fullCombo = !this.failed && this.fullComboAlive && this.hits === this.notes.length;
      const { stars } = starsFor(score, this.maxScore);
      const avgOffset = this.offsets.length ? this.offsets.reduce((a, b) => a + b, 0) / this.offsets.length : 0;
      return {
        score,
        maxCombo: this.maxCombo,
        hits: this.hits,
        counts: { ...this.counts },
        overhits: this.overhits,
        accuracy: Math.round(accuracy * 10) / 10,
        grade,
        total: this.notes.length,
        holdPct: this.holdTotal > 0 ? Math.round((1000 * this.holdHeld) / this.holdTotal) / 10 : null,
        failed: this.failed,
        fullCombo,
        stars: this.failed ? 0 : stars,
        goldStars: !this.failed && stars === 5 && fullCombo,
        maxScore: this.maxScore,
        avgOffset: Math.round(avgOffset),
        timingSamples: this.offsets.length,
        graph: this.graph.map((b) => ({ acc: b.max ? b.earned / b.max : null, miss: b.miss })),
        timeline: this.timeline.slice(),
      };
    }

    // ---- input -----------------------------------------------------------------------

    lane(lane, down, perfMs) {
      if (!this.running || this.paused || this.failed || lane >= this.lanes) return;
      this.held[lane] = down;
      if (down) this._judgePress(lane, this.timeAt(perfMs));
    }

    activateOverdrive() {
      if (!this.running || this.paused || this.failed || this.odActive || this.od < 0.5) return;
      this.odActive = true;
      Sfx.overdrive();
      Sfx.setOverdrive(true);
      this.stage.flashScreen(0.55);
      this.stage.kick(3);
      this._banner('OVERDRIVE!', '#58f8f8');
    }

    _banner(text, color) {
      this.banners = this.banners.filter((b) => performance.now() - b.at < 1600);
      this.banners.push({ text, color, at: performance.now(), y: 92 });
    }

    _judgePress(lane, t) {
      let best = null;
      let bestD = Infinity;
      for (let i = this.nextIdx; i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.t - t > WINDOWS.ok) break;
        if (n.judged || n.lane !== lane) continue;
        const d = Math.abs(n.t - t);
        if (d <= WINDOWS.ok && d < bestD) { best = n; bestD = d; }
      }
      if (best) { this._hit(best, bestD, t); return; }
      if (t < 0 || !this.antiMash) return;
      // Re-grabbing a long note you let go of is not a stray press.
      if (this.holds.some((h) => h.lane === lane)) return;
      // Nor is a quick double-press (key bounce) right after hitting a note.
      for (let i = this.nextIdx - 1; i >= 0 && this.notes[i].t > t - 0.25; i--) {
        const n = this.notes[i];
        if (n.lane === lane && n.judged && n.judged !== 'miss') return;
      }
      this._overhit();
    }

    /** A press with no note nearby: breaks the streak (Medium and up), costs no health. */
    _overhit() {
      this.overhits++;
      if (this.combo >= 10) { Sfx.miss(); this.powerDownAt = performance.now(); }
      if (this.combo > 0) this.combo = 0;
      this.judgement = { kind: 'over', at: performance.now() };
    }

    _graph(t, earned) {
      const span = Math.max(1, this.lastNoteT);
      const b = this.graph[Math.max(0, Math.min(GRAPH_BUCKETS - 1, Math.floor((t / span) * GRAPH_BUCKETS)))];
      b.max += 100;
      b.earned += earned;
      if (!earned) b.miss++;
    }

    _hit(best, bestD, t) {
      const lane = best.lane;
      const kind = bestD <= WINDOWS.perfect ? 'perfect' : bestD <= WINDOWS.good ? 'good' : 'ok';
      best.judged = kind;
      if (best.len > 0) {
        best.holdEnd = best.t + best.len;
        this.holds.push(best);
        this.holdTotal += best.len;
      }
      const offsetMs = Math.round((t - best.t) * 1000);
      this.offsets.push(offsetMs);
      this._graph(best.t, POINTS[kind]);

      this.counts[kind]++;
      this.hits++;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      const pts = POINTS[kind] * this.multiplier;
      this.score += pts;
      // One pop-up per lane: a new hit replaces the last, so fast runs stay readable.
      this.popups = this.popups.filter((p) => p.lane !== lane);
      this.popups.push({ lane, text: '+' + pts, at: performance.now(), mult: this.multiplier });
      this.rock = Math.min(1, this.rock + ROCK[kind] * (this.odActive ? 2 : 1));
      if (!this.odActive) this.od = Math.min(1, this.od + OD_PER_HIT);
      this.judgement = { kind, at: performance.now(), early: best.t > t };
      if (this.hitSounds) Sfx.hitTick();

      const pos = this.stage.fretPos(this.lanes, lane);
      this.stage.flame(lane);
      this.stage.burst(pos.x, pos.y - 4, Stage.LANES[lane], (kind === 'perfect' ? 8 : 4) + this.level * 2);

      if (this.combo % 10 === 0 && this.combo <= 30) {
        this.stage.levelUp(this.level);
        Sfx.levelUp(this.level);
      }
      if (this.combo % 50 === 0) {
        this._banner(`${this.combo} NOTE STREAK!`, '#f8d830');
        Sfx.streak(this.combo);
        this.stage.kick(2);
        this.stage.flashScreen(0.25);
        if (!this.odActive) this.od = Math.min(1, this.od + 0.1);
      }
      if (this.od >= 0.5 && !this.odActive && !this.odReadyAnnounced) {
        this.odReadyAnnounced = true;
        Sfx.overdriveReady();
      }
    }

    _miss(note) {
      this.counts.miss++;
      if (note) this._graph(note.t, 0);
      if (this.combo >= 10) {
        Sfx.miss();
        this.stage.kick(2.5);
        this.powerDownAt = performance.now();
      }
      Sfx.missDip();
      this.combo = 0;
      this.judgement = { kind: 'miss', at: performance.now() };
      const was = this.rock;
      this.rock = Math.max(0, this.rock + ROCK.miss);
      if (was >= 0.25 && this.rock < 0.25) Sfx.rockDanger();
      if (this.rock <= 0 && !this.noFail) this._fail();
    }

    _sweepMisses(t) {
      for (let i = this.nextIdx; i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.t >= t - WINDOWS.ok) break;
        if (!n.judged) {
          n.judged = 'miss';
          this._miss(n);
          if (this.failed) return;
        }
      }
      while (this.nextIdx < this.notes.length && this.notes[this.nextIdx].judged) this.nextIdx++;
    }

    _fail() {
      this.failed = true;
      // The classic power-down: the song winds to a stop.
      const now = this.ctx.currentTime;
      this.source.playbackRate.setValueAtTime(1, now);
      this.source.playbackRate.linearRampToValueAtTime(0.05, now + 1.2);
      Sfx.fail();
      this.stage.kick(5);
      setTimeout(() => {
        if (!this.running) return;
        const res = this.results();
        this.stop();
        this.onEnd(res);
      }, 2200);
    }

    /** Score held tails and drain the rock meter for released ones, over [from, to]. */
    _updateHolds(from, to) {
      if (!this.holds.length || to <= from) return;
      const now = performance.now();
      for (const h of this.holds) {
        const seg = Math.max(0, Math.min(to, h.holdEnd) - Math.max(from, h.t));
        if (!seg) continue;
        if (this.held[h.lane]) {
          this.score += HOLD_POINTS_PER_SEC * this.multiplier * seg;
          this.holdHeld += seg;
          if (!h.sparkAt || now - h.sparkAt > 70) {
            h.sparkAt = now;
            const pos = this.stage.fretPos(this.lanes, h.lane);
            this.stage.burst(pos.x, pos.y - 4, Stage.LANES[h.lane], 2, 45);
          }
        } else {
          this.rock = Math.max(0, this.rock - HOLD_DRAIN_PER_SEC * seg);
          if (this.rock <= 0 && !this.noFail) { this._fail(); return; }
        }
      }
      this.holds = this.holds.filter((h) => h.holdEnd > to);
    }

    /** Where the personal best stood at song time t (linear between samples). */
    _bestAt(t) {
      const tl = this.best.timeline;
      const x = t / PACE_STEP;
      const i = Math.floor(x);
      if (i >= tl.length - 1) return tl[tl.length - 1];
      if (i < 0) return 0;
      return tl[i] + (tl[i + 1] - tl[i]) * (x - i);
    }

    // ---- loop ------------------------------------------------------------------------

    _frame() {
      if (!this.running) return;
      const t = this.now();
      if (!this.paused && !this.failed) {
        this._sweepMisses(t);
        // Only score time once: after a resume the song rewinds a little.
        if (this.lastT != null && t > this.highT) {
          const from = Math.max(this.lastT, this.highT);
          this._updateHolds(from, t);
          if (this.odActive) {
            this.od = Math.max(0, this.od - OD_DRAIN * (t - from));
            if (this.od === 0) { this.odActive = false; this.odReadyAnnounced = false; Sfx.setOverdrive(false); }
          }
        }
        this.lastT = t;
        this.highT = Math.max(this.highT, t);
        while (t >= 0 && this.timeline.length <= Math.floor(t / PACE_STEP)) this.timeline.push(Math.round(this.score));
        const danger = this.rock < 0.3 ? (0.3 - this.rock) / 0.3 : 0;
        if (Math.abs(danger - this.lastDanger) > 0.04 || (danger === 0 && this.lastDanger !== 0)) {
          this.lastDanger = danger;
          Sfx.setDanger(danger);
        }
      }
      this.stage.shakeEnabled = this.shakeEnabled !== false;
      this.stage.draw(this._view(t));
      const done = t > Math.min(this.duration, this.lastNoteT + 3) && this.nextIdx >= this.notes.length;
      if (!this.paused && !this.failed && done) {
        const res = this.results();
        this.stop();
        this.onEnd(res);
        return;
      }
      requestAnimationFrame(this._frame);
    }

    _view(t) {
      let countdown = null;
      if (!this.paused && this.resumeAt && this.ctx.currentTime < this.resumeAt) {
        const left = this.resumeAt - this.ctx.currentTime;
        countdown = left > 1.8 ? null : left > 1.2 ? '3' : left > 0.6 ? '2' : '1';
      } else if (t < 0 && !this.resumeAt) {
        const left = -t;
        countdown = left > 2.5 ? null : left > 1.75 ? '3' : left > 1.0 ? '2' : left > 0.25 ? '1' : 'GO!';
      }
      const score = Math.floor(this.score);
      const st = starsFor(score, this.maxScore);
      return {
        t,
        beats: this.beats,
        lanes: this.lanes,
        notes: this.notes,
        holds: this.holds,
        nextIdx: this.nextIdx,
        lookahead: this.lookahead,
        held: this.held,
        labels: Input.laneLabels(this.lanes),
        rock: this.rock,
        odActive: this.odActive,
        level: this.level,
        powerDownAt: this.powerDownAt,
        fullCombo: this.fullComboAlive && t > 0,
        judgement: this.judgement,
        banners: this.banners,
        popups: this.popups,
        guitarist: { color: this.playerColor },
        countdown,
        failed: this.failed,
        restart: this.restartProgress,
        hud: {
          score,
          combo: this.combo,
          mult: this.multiplier,
          pips: this.level >= 4 ? 10 : this.combo % 10,
          rock: this.rock,
          od: this.od,
          odReady: this.od >= 0.5,
          odKey: Input.glyph('overdrive'),
          progress: Math.max(0, Math.min(1, t / this.duration)),
          intro: t < 1.5 && !this.resumeAt ? this.intro : null,
          stars: st.stars,
          starProgress: st.next ? Math.min(1, score / st.next) : 1,
          pace: this.best && t > PACE_STEP ? Math.round(score - this._bestAt(t)) : null,
        },
      };
    }
  }

  root.Game = Game;
})(window);
