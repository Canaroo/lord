/*
 * Game — one play of one chart: timing, judging, scoring, rock meter,
 * overdrive and fail state. Drawing is done by Stage (render.js).
 *
 * All timing runs on the AudioContext clock, and every press is judged at the
 * moment it happened (event timestamp), not when the frame got around to it.
 */
'use strict';
(function (root) {
  const WINDOWS = { perfect: 0.05, good: 0.095, ok: 0.14 }; // seconds, either side
  const POINTS = { perfect: 100, good: 70, ok: 40 };
  const COUNT_IN = 3.2; // seconds before the song starts
  const OD_DRAIN = 1 / 16; // a full overdrive meter lasts 16 seconds
  const OD_PER_HIT = 0.011;
  const ROCK = { perfect: 0.022, good: 0.016, ok: 0.008, miss: -0.07 };

  class Game {
    /**
     * @param {object} o
     * @param {AudioContext} o.audioCtx
     * @param {AudioBuffer} o.buffer
     * @param {{lanes:number,notes:{t:number,lane:number}[]}} o.chart
     * @param {number[]} o.beats
     * @param {Stage} o.stage
     * @param {number} o.lookahead     seconds of notes visible on the highway
     * @param {number} o.calibration   input offset in seconds
     * @param {boolean} o.noFail
     * @param {{title:string, sub:string}} o.intro
     * @param {(results:object)=>void} o.onEnd
     * @param {(paused:boolean)=>void} o.onPauseChange
     */
    constructor(o) {
      this.ctx = o.audioCtx;
      this.buffer = o.buffer;
      this.stage = o.stage;
      this.lanes = o.chart.lanes;
      this.notes = o.chart.notes.map((n) => ({ t: n.t, lane: n.lane, judged: null }));
      this.beats = o.beats;
      this.lookahead = o.lookahead;
      this.calibration = o.calibration || 0;
      this.noFail = !!o.noFail;
      this.intro = o.intro;
      this.onEnd = o.onEnd;
      this.onPauseChange = o.onPauseChange || (() => {});
      this.duration = o.buffer.duration;
      this.lastNoteT = this.notes.length ? this.notes[this.notes.length - 1].t : 0;

      this.score = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.hits = 0;
      this.counts = { perfect: 0, good: 0, ok: 0, miss: 0 };
      this.rock = 0.5;
      this.od = 0;
      this.odActive = false;
      this.odReadyAnnounced = false;
      this.failed = false;
      this.nextIdx = 0;
      this.held = new Array(this.lanes).fill(false);
      this.judgement = null;
      this.banners = [];
      this.running = false;
      this.paused = false;
      this.lastT = null;
      this._frame = this._frame.bind(this);
    }

    get multiplier() {
      const base = Math.min(4, 1 + Math.floor(this.combo / 10));
      return this.odActive ? base * 2 : base;
    }

    /** Song position (seconds) the player is hearing right now. */
    now() {
      const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
      return this.ctx.currentTime - this.startAt - latency - this.calibration;
    }

    /** Song position at a past moment on the performance.now() clock. */
    timeAt(perfMs) {
      const ago = Math.max(0, Math.min(0.25, (performance.now() - perfMs) / 1000));
      return this.now() - ago;
    }

    async start() {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      this.source = this.ctx.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.connect(Sfx.musicBus || this.ctx.destination);
      this.startAt = this.ctx.currentTime + COUNT_IN;
      this.source.start(this.startAt);
      for (let i = 3; i >= 1; i--) Sfx.countdown(this.startAt - i * 0.75 - 0.25);
      Sfx.go(this.startAt - 0.25);
      this.running = true;
      requestAnimationFrame(this._frame);
    }

    pause() {
      if (!this.running || this.paused || this.failed) return;
      this.paused = true;
      this.ctx.suspend();
      this.held.fill(false);
      this.onPauseChange(true);
    }

    async resume() {
      if (!this.running || !this.paused) return;
      await this.ctx.resume();
      this.paused = false;
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
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    results() {
      const total = this.notes.length || 1;
      const earned = this.counts.perfect * 100 + this.counts.good * 70 + this.counts.ok * 40;
      const accuracy = earned / total;
      const grade = this.failed ? 'F' : accuracy >= 95 ? 'S' : accuracy >= 88 ? 'A' : accuracy >= 75 ? 'B' : accuracy >= 60 ? 'C' : 'D';
      return {
        score: this.score,
        maxCombo: this.maxCombo,
        hits: this.hits,
        counts: { ...this.counts },
        accuracy: Math.round(accuracy * 10) / 10,
        grade,
        total: this.notes.length,
        failed: this.failed,
        fullCombo: !this.failed && this.counts.miss === 0 && this.hits === this.notes.length && this.notes.length > 0,
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
      if (!best) return; // stray presses aren't punished
      this._hit(best, bestD, t);
    }

    _hit(best, bestD, t) {
      const lane = best.lane;
      const kind = bestD <= WINDOWS.perfect ? 'perfect' : bestD <= WINDOWS.good ? 'good' : 'ok';
      best.judged = kind;
      this.counts[kind]++;
      this.hits++;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += POINTS[kind] * this.multiplier;
      this.rock = Math.min(1, this.rock + ROCK[kind] * (this.odActive ? 2 : 1));
      if (!this.odActive) this.od = Math.min(1, this.od + OD_PER_HIT);
      this.judgement = { kind, at: performance.now(), early: best.t > t };

      const pos = this.stage.fretPos(this.lanes, lane);
      this.stage.flame(lane);
      this.stage.burst(pos.x, pos.y - 4, Stage.LANES[lane], kind === 'perfect' ? 10 : 5);

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

    _miss() {
      this.counts.miss++;
      if (this.combo >= 10) {
        Sfx.miss();
        this.stage.kick(2.5);
      }
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
          this._miss();
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

    // ---- loop ------------------------------------------------------------------------

    _frame() {
      if (!this.running) return;
      const t = this.now();
      if (!this.paused && !this.failed) {
        this._sweepMisses(t);
        if (this.lastT != null && this.odActive) {
          this.od = Math.max(0, this.od - OD_DRAIN * Math.max(0, t - this.lastT));
          if (this.od === 0) { this.odActive = false; this.odReadyAnnounced = false; }
        }
        this.lastT = t;
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
      if (t < 0) {
        const left = -t;
        countdown = left > 2.5 ? null : left > 1.75 ? '3' : left > 1.0 ? '2' : left > 0.25 ? '1' : 'GO!';
      }
      return {
        t,
        beats: this.beats,
        lanes: this.lanes,
        notes: this.notes,
        nextIdx: this.nextIdx,
        lookahead: this.lookahead,
        held: this.held,
        labels: Input.laneLabels(this.lanes),
        rock: this.rock,
        odActive: this.odActive,
        judgement: this.judgement,
        banners: this.banners,
        countdown,
        failed: this.failed,
        hud: {
          score: this.score,
          combo: this.combo,
          mult: this.multiplier,
          rock: this.rock,
          od: this.od,
          odReady: this.od >= 0.5,
          odKey: Input.glyph('overdrive'),
          progress: Math.max(0, Math.min(1, t / this.duration)),
          intro: t < 1.5 ? this.intro : null,
        },
      };
    }
  }

  root.Game = Game;
})(window);
