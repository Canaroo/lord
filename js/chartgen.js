/*
 * ChartGen — turns BeatAnalyzer output into a playable note chart.
 *
 *   1. Build a rhythmic grid from the tracked beats (beats, 8ths, 16ths).
 *   2. Snap each detected onset to its nearest grid slot.
 *   3. Keep slots whose onset is strong enough for the difficulty, favouring
 *      beats over off-beats, and enforce a minimum gap between notes.
 *   4. Pick a lane from the onset's frequency content (low → left, high → right),
 *      with a few rules so patterns stay playable.
 */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChartGen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DIFFICULTIES = {
    easy: {
      label: 'Easy',
      lanes: 3,
      // Minimum onset strength for a beat, an 8th note. No 16ths on Easy.
      thresholds: [0.2, 0.55],
      minGap: 0.3,
      maxRun: 3,
      jackGap: 0,
      chordThreshold: Infinity,
    },
    hard: {
      label: 'Hard',
      lanes: 5,
      thresholds: [0.08, 0.16, 0.32],
      minGap: 0.1,
      maxRun: 4,
      jackGap: 0.2,
      chordThreshold: 0.8,
    },
  };

  function median(values) {
    const s = values.slice().sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : 0;
  }

  function buildGrid(beats, duration) {
    if (beats.length < 2) return [];
    const diffs = [];
    for (let i = 1; i < beats.length; i++) diffs.push(beats[i] - beats[i - 1]);
    const period = median(diffs);
    const all = beats.slice();
    while (all[0] - period > 0) all.unshift(all[0] - period);
    while (all[all.length - 1] + period < duration) all.push(all[all.length - 1] + period);

    const grid = [];
    for (let i = 0; i < all.length - 1; i++) {
      const d = all[i + 1] - all[i];
      for (let k = 0; k < 4; k++) {
        grid.push({ t: all[i] + (k * d) / 4, level: k === 0 ? 0 : k === 2 ? 1 : 2, onset: null });
      }
    }
    grid.push({ t: all[all.length - 1], level: 0, onset: null });
    return grid;
  }

  function nearestIndex(grid, t) {
    let lo = 0, hi = grid.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (grid[mid].t < t) lo = mid; else hi = mid;
    }
    return Math.abs(grid[lo].t - t) <= Math.abs(grid[hi].t - t) ? lo : hi;
  }

  function laneScores(bands, lanes) {
    if (lanes === 5) return bands.slice(0, 5);
    if (lanes === 3) return [(bands[0] + bands[1]) / 2, bands[2], (bands[3] + bands[4]) / 2];
    // Generic fallback: spread 5 bands over N lanes.
    const out = new Array(lanes).fill(0);
    bands.forEach((v, b) => { out[Math.min(lanes - 1, Math.floor((b * lanes) / bands.length))] += v; });
    return out;
  }

  function rank(scores) {
    return scores.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  }

  /**
   * @param {{duration:number,beats:number[],onsets:{t:number,s:number,b:number[]}[]}} analysis
   * @param {'easy'|'hard'} difficulty
   */
  function generate(analysis, difficulty) {
    const cfg = DIFFICULTIES[difficulty];
    if (!cfg) throw new Error('Unknown difficulty: ' + difficulty);
    const grid = buildGrid(analysis.beats, analysis.duration);
    if (!grid.length) return { difficulty, lanes: cfg.lanes, notes: [] };

    // Snap onsets to grid slots; a slot keeps its strongest onset.
    for (const o of analysis.onsets) {
      const slot = grid[nearestIndex(grid, o.t)];
      if (!slot.onset || o.s > slot.onset.s) slot.onset = o;
    }

    // Candidates in priority order: beats first, then 8ths, then 16ths; strongest first.
    const candidates = grid.filter(
      (g) => g.onset && g.level < cfg.thresholds.length && g.onset.s >= cfg.thresholds[g.level]
    );
    candidates.sort((a, b) => a.level - b.level || b.onset.s - a.onset.s);

    const chosen = []; // kept sorted by time
    for (const c of candidates) {
      // Use the onset's real time: it's what the player actually hears.
      const t = c.onset.t;
      let lo = 0, hi = chosen.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (chosen[mid].t < t) lo = mid + 1; else hi = mid;
      }
      const before = chosen[lo - 1];
      const after = chosen[lo];
      if (before && t - before.t < cfg.minGap) continue;
      if (after && after.t - t < cfg.minGap) continue;
      chosen.splice(lo, 0, { t, level: c.level, s: c.onset.s, b: c.onset.b });
    }

    // Lane assignment.
    const notes = [];
    let prevLane = -1, prevT = -Infinity, run = 0, lastChordT = -Infinity;
    const recent = [];
    for (const c of chosen) {
      // Gently discourage lanes that dominate the last dozen notes, so close
      // calls spread across the frets instead of piling onto one.
      const scores = laneScores(c.b, cfg.lanes).map((v, l) => {
        const share = recent.filter((x) => x === l).length / Math.max(1, recent.length);
        return v * (1 - 0.6 * Math.max(0, share - 1 / cfg.lanes));
      });
      const order = rank(scores);
      let lane = order[0];
      if (lane === prevLane && (run >= cfg.maxRun || c.t - prevT < cfg.jackGap)) lane = order[1];
      run = lane === prevLane ? run + 1 : 1;
      recent.push(lane);
      if (recent.length > 12) recent.shift();
      notes.push({ t: +c.t.toFixed(4), lane });

      if (c.level === 0 && c.s >= cfg.chordThreshold && c.t - lastChordT > 1.0) {
        const second = order.find((l) => l !== lane);
        notes.push({ t: +c.t.toFixed(4), lane: second });
        lastChordT = c.t;
      }
      prevLane = lane;
      prevT = c.t;
    }
    notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
    return { difficulty, lanes: cfg.lanes, notes };
  }

  return { generate, DIFFICULTIES };
});
