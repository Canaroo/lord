/*
 * BeatGame — the playable part: scrolling highway, input, judging, scoring.
 * Timing is driven by the AudioContext clock so notes stay locked to the music.
 */
'use strict';
(function (root) {
  const LANE_COLORS = ['#3ddc68', '#ff4d5e', '#ffd23f', '#3fa9ff', '#ff9a3c'];
  const KEYS = ['a', 's', 'd', 'f', 'g'];
  const WINDOWS = { perfect: 0.05, good: 0.095, ok: 0.14 }; // seconds, either side
  const POINTS = { perfect: 100, good: 70, ok: 40 };
  const LEAD_IN = 2.5; // seconds of countdown before the song starts
  const PERSPECTIVE = 3; // larger = steeper highway

  class BeatGame {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {object} o
     * @param {AudioContext} o.audioCtx
     * @param {AudioBuffer} o.buffer
     * @param {{lanes:number,notes:{t:number,lane:number}[]}} o.chart
     * @param {number[]} o.beats
     * @param {number} o.lookahead     seconds of notes visible on the highway
     * @param {number} o.calibration   user input offset, seconds
     * @param {(results:object)=>void} o.onEnd
     * @param {(paused:boolean)=>void} o.onPauseChange
     */
    constructor(canvas, o) {
      this.canvas = canvas;
      this.g = canvas.getContext('2d');
      this.ctx = o.audioCtx;
      this.buffer = o.buffer;
      this.lanes = o.chart.lanes;
      this.notes = o.chart.notes.map((n) => ({ t: n.t, lane: n.lane, judged: null }));
      this.beats = o.beats;
      this.lookahead = o.lookahead;
      this.calibration = o.calibration || 0;
      this.onEnd = o.onEnd;
      this.onPauseChange = o.onPauseChange || (() => {});
      this.duration = o.buffer.duration;

      this.score = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.counts = { perfect: 0, good: 0, ok: 0, miss: 0 };
      this.nextIdx = 0;
      this.held = new Array(this.lanes).fill(false);
      this.effects = [];
      this.judgement = null;
      this.running = false;
      this.paused = false;

      this._onKeyDown = this._onKeyDown.bind(this);
      this._onKeyUp = this._onKeyUp.bind(this);
      this._onBlur = () => this.pause();
      this._frame = this._frame.bind(this);
    }

    get multiplier() {
      return Math.min(4, 1 + Math.floor(this.combo / 10));
    }

    /** Song position in seconds, as heard by the player. */
    now() {
      const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
      return this.ctx.currentTime - this.startAt - latency - this.calibration;
    }

    async start() {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      this.source = this.ctx.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.connect(this.ctx.destination);
      this.startAt = this.ctx.currentTime + LEAD_IN;
      this.source.start(this.startAt);
      this.running = true;
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
      window.addEventListener('blur', this._onBlur);
      requestAnimationFrame(this._frame);
    }

    pause() {
      if (!this.running || this.paused) return;
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

    stop() {
      if (!this.running) return;
      this.running = false;
      try { this.source.stop(); } catch (e) { /* already stopped */ }
      this.source.disconnect();
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
      window.removeEventListener('blur', this._onBlur);
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    results() {
      const total = this.notes.length || 1;
      const earned = this.counts.perfect * 100 + this.counts.good * 70 + this.counts.ok * 40;
      const accuracy = earned / total;
      const grade = accuracy >= 95 ? 'S' : accuracy >= 88 ? 'A' : accuracy >= 75 ? 'B' : accuracy >= 60 ? 'C' : 'D';
      return {
        score: this.score,
        maxCombo: this.maxCombo,
        counts: { ...this.counts },
        accuracy: Math.round(accuracy * 10) / 10,
        grade,
        total: this.notes.length,
      };
    }

    // ---- input & judging ---------------------------------------------------

    _onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.paused) this.resume(); else this.pause();
        return;
      }
      if (this.paused || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const lane = KEYS.indexOf(e.key.toLowerCase());
      if (lane < 0 || lane >= this.lanes) return;
      e.preventDefault();
      this.held[lane] = true;
      this._judgePress(lane, this.now());
    }

    _onKeyUp(e) {
      const lane = KEYS.indexOf(e.key.toLowerCase());
      if (lane >= 0 && lane < this.lanes) this.held[lane] = false;
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
      const kind = bestD <= WINDOWS.perfect ? 'perfect' : bestD <= WINDOWS.good ? 'good' : 'ok';
      best.judged = kind;
      this.counts[kind]++;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += POINTS[kind] * this.multiplier;
      this.judgement = { kind, at: performance.now(), early: best.t > t };
      this.effects.push({ lane, at: performance.now(), kind });
    }

    _sweepMisses(t) {
      for (let i = this.nextIdx; i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.t >= t - WINDOWS.ok) break;
        if (!n.judged) {
          n.judged = 'miss';
          this.counts.miss++;
          this.combo = 0;
          this.judgement = { kind: 'miss', at: performance.now() };
        }
      }
      while (this.nextIdx < this.notes.length && this.notes[this.nextIdx].judged) this.nextIdx++;
    }

    // ---- main loop -----------------------------------------------------------

    _frame() {
      if (!this.running) return;
      const t = this.now();
      if (!this.paused) this._sweepMisses(t);
      this._draw(t);
      if (!this.paused && t > this.duration + 0.5 && this.nextIdx >= this.notes.length) {
        const res = this.results();
        this.stop();
        this.onEnd(res);
        return;
      }
      requestAnimationFrame(this._frame);
    }

    _draw(t) {
      const c = this.canvas;
      const dpr = window.devicePixelRatio || 1;
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      const g = this.g;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);

      const cx = W / 2;
      const hitY = H * 0.84;
      const horizonY = H * 0.06;
      const halfW = Math.min(W * 0.42, this.lanes * 62);
      const laneW = (2 * halfW) / this.lanes;
      const scale = (z) => 1 / (1 + PERSPECTIVE * z);
      const yAt = (z) => horizonY + (hitY - horizonY) * scale(z);
      const xAt = (laneOffset, z) => cx + laneOffset * scale(z);
      const laneX = (lane) => (lane - (this.lanes - 1) / 2) * laneW;
      const zOf = (time) => (time - t) / this.lookahead;
      const zNear = -0.08;

      // Highway.
      g.beginPath();
      g.moveTo(xAt(-halfW, 1), yAt(1));
      g.lineTo(xAt(halfW, 1), yAt(1));
      g.lineTo(xAt(halfW, zNear), yAt(zNear));
      g.lineTo(xAt(-halfW, zNear), yAt(zNear));
      g.closePath();
      const grad = g.createLinearGradient(0, yAt(1), 0, yAt(zNear));
      grad.addColorStop(0, 'rgba(20,22,40,0)');
      grad.addColorStop(0.35, 'rgba(26,28,52,0.9)');
      grad.addColorStop(1, 'rgba(34,36,66,1)');
      g.fillStyle = grad;
      g.fill();

      // Lane dividers.
      g.lineWidth = 1;
      for (let i = 0; i <= this.lanes; i++) {
        const off = -halfW + i * laneW;
        g.strokeStyle = i === 0 || i === this.lanes ? 'rgba(160,170,255,0.45)' : 'rgba(160,170,255,0.12)';
        g.beginPath();
        g.moveTo(xAt(off, 1), yAt(1));
        g.lineTo(xAt(off, zNear), yAt(zNear));
        g.stroke();
      }

      // Beat lines — every 4th one brighter.
      for (let i = 0; i < this.beats.length; i++) {
        const z = zOf(this.beats[i]);
        if (z < zNear || z > 1) continue;
        const fade = 1 - Math.max(0, z);
        g.strokeStyle = `rgba(200,210,255,${(i % 4 === 0 ? 0.35 : 0.13) * fade})`;
        g.lineWidth = i % 4 === 0 ? 2 : 1;
        g.beginPath();
        g.moveTo(xAt(-halfW, z), yAt(z));
        g.lineTo(xAt(halfW, z), yAt(z));
        g.stroke();
      }

      // Frets at the hit line.
      for (let l = 0; l < this.lanes; l++) {
        const x = xAt(laneX(l), 0);
        const r = laneW * 0.36;
        g.beginPath();
        g.ellipse(x, hitY, r, r * 0.5, 0, 0, Math.PI * 2);
        g.fillStyle = this.held[l] ? LANE_COLORS[l] : 'rgba(10,10,20,0.85)';
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = LANE_COLORS[l];
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.font = '600 14px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText(KEYS[l].toUpperCase(), x, hitY + r * 0.5 + 22);
      }

      // Notes (draw far → near so near ones overlap).
      const visible = [];
      for (let i = this.nextIdx > 8 ? this.nextIdx - 8 : 0; i < this.notes.length; i++) {
        const n = this.notes[i];
        const z = zOf(n.t);
        if (z > 1) break;
        if (z < zNear - 0.05) continue;
        if (n.judged && n.judged !== 'miss') continue;
        visible.push([n, z]);
      }
      for (let i = visible.length - 1; i >= 0; i--) {
        const [n, z] = visible[i];
        const s = scale(z);
        const x = xAt(laneX(n.lane), z);
        const y = yAt(z);
        const r = laneW * 0.34 * s;
        const alpha = n.judged === 'miss' ? 0.25 : Math.min(1, (1 - z) * 3);
        g.globalAlpha = alpha;
        g.beginPath();
        g.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2);
        g.fillStyle = n.judged === 'miss' ? '#666' : LANE_COLORS[n.lane];
        g.fill();
        g.beginPath();
        g.ellipse(x, y - r * 0.1, r * 0.55, r * 0.25, 0, 0, Math.PI * 2);
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.fill();
        g.globalAlpha = 1;
      }

      // Hit effects.
      const nowMs = performance.now();
      this.effects = this.effects.filter((e) => nowMs - e.at < 300);
      for (const e of this.effects) {
        const k = (nowMs - e.at) / 300;
        const x = xAt(laneX(e.lane), 0);
        g.globalAlpha = 1 - k;
        g.strokeStyle = LANE_COLORS[e.lane];
        g.lineWidth = 4;
        g.beginPath();
        g.ellipse(x, hitY, laneW * (0.4 + k * 0.5), laneW * (0.2 + k * 0.25), 0, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = LANE_COLORS[e.lane];
        for (let p = 0; p < 6; p++) {
          const a = (p / 6) * Math.PI - Math.PI;
          g.fillRect(x + Math.cos(a) * k * laneW * 0.8, hitY + Math.sin(a) * k * laneW * 0.9, 3, 3);
        }
        g.globalAlpha = 1;
      }

      // Judgement text.
      if (this.judgement && nowMs - this.judgement.at < 500) {
        const k = (nowMs - this.judgement.at) / 500;
        const j = this.judgement;
        const label = { perfect: 'PERFECT', good: 'GOOD', ok: 'OK', miss: 'MISS' }[j.kind];
        const color = { perfect: '#7cf7ff', good: '#9dff8a', ok: '#ffd23f', miss: '#ff5c6c' }[j.kind];
        g.globalAlpha = 1 - k;
        g.fillStyle = color;
        g.textAlign = 'center';
        g.font = `800 ${Math.round(30 + 6 * (1 - k))}px system-ui, sans-serif`;
        g.fillText(label, cx, hitY - H * 0.2 - k * 12);
        if (j.kind !== 'perfect' && j.kind !== 'miss') {
          g.font = '600 13px system-ui, sans-serif';
          g.fillText(j.early ? 'early' : 'late', cx, hitY - H * 0.2 + 20 - k * 12);
        }
        g.globalAlpha = 1;
      }

      // HUD.
      g.textAlign = 'left';
      g.fillStyle = '#fff';
      g.font = '800 30px system-ui, sans-serif';
      g.fillText(this.score.toLocaleString(), 24, 46);
      g.font = '600 14px system-ui, sans-serif';
      g.fillStyle = '#aab';
      g.fillText('SCORE', 24, 66);

      g.textAlign = 'right';
      g.font = '800 30px system-ui, sans-serif';
      g.fillStyle = this.multiplier > 1 ? LANE_COLORS[(this.multiplier + 1) % 5] : '#fff';
      g.fillText(`${this.combo}  ×${this.multiplier}`, W - 24, 46);
      g.font = '600 14px system-ui, sans-serif';
      g.fillStyle = '#aab';
      g.fillText('COMBO', W - 24, 66);

      // Progress bar.
      const prog = Math.max(0, Math.min(1, t / this.duration));
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(0, 0, W, 4);
      g.fillStyle = '#7cf7ff';
      g.fillRect(0, 0, W * prog, 4);

      // Countdown.
      if (t < 0) {
        const n = Math.ceil(-t);
        g.textAlign = 'center';
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.font = '800 72px system-ui, sans-serif';
        g.fillText(n > 3 ? '' : String(n), cx, H * 0.45);
      }
    }
  }

  BeatGame.KEYS = KEYS;
  BeatGame.LANE_COLORS = LANE_COLORS;
  root.BeatGame = BeatGame;
})(window);
