/*
 * ChartGen — turns BeatAnalyzer output into a playable note chart.
 *
 *   1. Build a rhythmic grid from the tracked beats (beats, 8ths, 16ths).
 *   2. Snap each detected onset to its nearest grid slot.
 *   3. Keep slots whose onset is strong enough for the difficulty, favouring
 *      beats over off-beats, and enforce a minimum gap between notes.
 *   4. Pick a lane from the onset's frequency content (low → left, high → right),
 *      with a few rules so patterns stay playable.
 *   5. Turn notes on sounds that ring on (held synths, vocals, chords) into
 *      long notes, from Medium up.
 */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChartGen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Listed easiest first; the menus show them in this order.
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
      holds: null,
    },
    medium: {
      label: 'Medium',
      lanes: 4,
      thresholds: [0.14, 0.5, 0.9],
      minGap: 0.165,
      maxRun: 4,
      jackGap: 0.25,
      chordThreshold: Infinity,
      holds: { share: 0.12, concurrent: 1, maxLen: 2.5 },
    },
    mediumplus: {
      label: 'Medium+',
      lanes: 4,
      // Close to Hard's density and speed, still on four keys and no chords.
      thresholds: [0.08, 0.16, 0.36],
      minGap: 0.105,
      maxRun: 4,
      jackGap: 0.2,
      chordThreshold: Infinity,
      holds: { share: 0.15, concurrent: 1, maxLen: 2.5 },
    },
    hard: {
      label: 'Hard',
      lanes: 5,
      thresholds: [0.08, 0.16, 0.32],
      minGap: 0.1,
      maxRun: 4,
      jackGap: 0.2,
      chordThreshold: 0.8,
      holds: { share: 0.15, concurrent: 2, maxLen: 3 },
    },
    duo: {
      label: 'Duo',
      lanes: 2,
      // Hard's density on two keys: quick notes alternate left and right.
      thresholds: [0.08, 0.16, 0.32],
      minGap: 0.1,
      maxRun: 2,
      jackGap: 0.3,
      chordThreshold: 0.9,
      holds: { share: 0.12, concurrent: 1, maxLen: 1.2 },
    },
  };
  const HOLD_MIN_SUSTAIN = 0.5; // seconds a sound must ring to become a long note
  const HOLD_MIN_LEN = 0.35;
  const HOLD_GAP = 0.15; // free time before the next note in the same lane

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
    if (lanes === 4) return [bands[0], Math.max(bands[1], bands[2]), bands[3], bands[4]];
    if (lanes === 2) return [bands[0] + bands[1] + 0.5 * bands[2], bands[3] + bands[4] + 0.5 * bands[2]];
    // Generic fallback: spread 5 bands over N lanes.
    const out = new Array(lanes).fill(0);
    bands.forEach((v, b) => { out[Math.min(lanes - 1, Math.floor((b * lanes) / bands.length))] += v; });
    return out;
  }

  function rank(scores) {
    return scores.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  }

  /**
   * @param {{duration:number,beats:number[],onsets:{t:number,s:number,b:number[],d?:number}[]}} analysis
   * @param {'easy'|'medium'|'mediumplus'|'hard'|'duo'} difficulty
   * @param {{lanes?:number, touch?:boolean}} [opts]  touch: a phone layout (2 or 4 lanes)
   *   played with two thumbs, so charts follow hand rules: chords only across
   *   hands, quick notes switch hands, and a long note keeps its hand busy.
   * @returns {{difficulty:string, lanes:number, notes:{t:number,lane:number,len?:number}[]}}
   */
  function generate(analysis, difficulty, opts = {}) {
    const base = DIFFICULTIES[difficulty];
    if (!base) throw new Error('Unknown difficulty: ' + difficulty);
    const touch = !!opts.touch;
    const cfg = touch ? touchConfig(base, opts.lanes || 4) : base;
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
      chosen.splice(lo, 0, { t, level: c.level, s: c.onset.s, b: c.onset.b, d: c.onset.d || 0 });
    }

    // Lane assignment. A note on a ringing sound reserves its lane for as long
    // as it rings, so the notes that follow go to other lanes and it can become
    // a long note held while you keep playing.
    const notes = [];
    let prevLane = -1, prevT = -Infinity, run = 0, lastChordT = -Infinity;
    const recent = [];
    const reservedUntil = new Array(cfg.lanes).fill(-Infinity);
    const holdBudget = cfg.holds ? Math.floor(chosen.length * cfg.holds.share) : 0;
    let reservations = 0;
    for (const c of chosen) {
      // Gently discourage lanes that dominate the last dozen notes, so close
      // calls spread across the frets instead of piling onto one.
      const scores = laneScores(c.b, cfg.lanes).map((v, l) => {
        const share = recent.filter((x) => x === l).length / Math.max(1, recent.length);
        return v * (1 - 0.6 * Math.max(0, share - 1 / cfg.lanes));
      });
      const ranked = rank(scores);
      const free = ranked.filter((l) => reservedUntil[l] <= c.t);
      let order = free.length ? free : ranked;
      // Touch: a quick note goes to the other thumb.
      if (touch && prevLane >= 0 && c.t - prevT < cfg.handGap) {
        const other = order.filter((l) => hand(l, cfg.lanes) !== hand(prevLane, cfg.lanes));
        if (other.length) order = other;
      }
      let lane = order[0];
      if (lane === prevLane && order.length > 1 && (run >= cfg.maxRun || c.t - prevT < cfg.jackGap)) lane = order[1];
      run = lane === prevLane ? run + 1 : 1;
      recent.push(lane);
      if (recent.length > 12) recent.shift();
      notes.push({ t: +c.t.toFixed(4), lane, d: c.d });
      const active = reservedUntil.filter((u) => u > c.t).length;
      if (cfg.holds && c.d >= HOLD_MIN_SUSTAIN && reservations < holdBudget && active < cfg.holds.concurrent && cfg.lanes - active > 1) {
        const until = c.t + Math.min(c.d, cfg.holds.maxLen) + HOLD_GAP;
        // On touch the whole thumb is busy holding, not just the lane.
        for (let l = 0; l < cfg.lanes; l++) {
          if (l === lane || (touch && hand(l, cfg.lanes) === hand(lane, cfg.lanes))) reservedUntil[l] = until;
        }
        reservations++;
      }

      if (c.level === 0 && c.s >= cfg.chordThreshold && c.t - lastChordT > 1.0) {
        const second = order.find((l) => l !== lane && (!touch || hand(l, cfg.lanes) !== hand(lane, cfg.lanes)));
        if (second == null) continue;
        notes.push({ t: +c.t.toFixed(4), lane: second, d: 0 });
        lastChordT = c.t;
      }
      prevLane = lane;
      prevT = c.t;
    }
    notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
    if (cfg.holds) addHolds(notes, cfg.holds, beatPeriod(analysis.beats));
    return { difficulty, lanes: cfg.lanes, notes: notes.map(({ t, lane, len }) => (len ? { t, lane, len } : { t, lane })) };
  }

  /** Which thumb plays a lane: left half of the lanes or right half. */
  function hand(lane, lanes) { return lane < lanes / 2 ? 0 : 1; }

  /** A tier adapted for touch: same density, 2 or 4 lanes, thumb-friendly rules. */
  function touchConfig(base, lanes) {
    // On thumbs Medium+ and Hard would otherwise play alike (no 5th key), so
    // Medium+ is eased a little to keep a clear step up to Hard.
    const eased = base === DIFFICULTIES.mediumplus ? { thresholds: [0.1, 0.24, 0.6], minGap: 0.105 } : {};
    return {
      ...base,
      ...eased,
      lanes,
      handGap: lanes === 2 ? 0.3 : 0.22,
      maxRun: lanes === 2 ? 2 : base.maxRun,
      jackGap: Math.max(base.jackGap, lanes === 2 ? 0.3 : 0.22),
      holds: base.holds ? { ...base.holds, concurrent: 1, maxLen: Math.min(base.holds.maxLen, 2) } : null,
    };
  }

  // Touch tiers (Duo is left out: upright Hard already is two-lane Hard).
  const TOUCH_TIERS = ['easy', 'medium', 'mediumplus', 'hard'];

  /** Chart ids: 'hard' (keys) or 'touch4:hard' / 'touch2:hard' (phone sideways / upright). */
  function parseId(id) {
    const m = /^touch([24]):(\w+)$/.exec(id);
    return m ? { difficulty: m[2], lanes: +m[1], touch: true } : { difficulty: id, touch: false };
  }

  function generateId(analysis, id) {
    const p = parseId(id);
    const chart = generate(analysis, p.difficulty, p.touch ? { lanes: p.lanes, touch: true } : {});
    chart.difficulty = id;
    return chart;
  }

  function beatPeriod(beats) {
    const diffs = [];
    for (let i = 1; i < beats.length; i++) diffs.push(beats[i] - beats[i - 1]);
    return median(diffs) || 0.5;
  }

  /**
   * Give long tails to notes on sounds that ring on. Longest-ringing first, up
   * to a share of all notes. A tail stops short of the next note in its lane,
   * is rounded down to the 16th note, and only `concurrent` tails may overlap.
   */
  function addHolds(notes, { share, concurrent, maxLen }, period) {
    const step = period / 4;
    const limit = Math.floor(notes.length * share);
    const nextInLane = new Map();
    for (let i = notes.length - 1; i >= 0; i--) {
      notes[i].next = nextInLane.get(notes[i].lane);
      nextInLane.set(notes[i].lane, notes[i].t);
    }
    const holds = [];
    const candidates = notes.filter((n) => n.d >= HOLD_MIN_SUSTAIN).sort((a, b) => b.d - a.d);
    for (const n of candidates) {
      if (holds.length >= limit) break;
      let end = n.t + Math.min(n.d, maxLen);
      if (n.next != null) end = Math.min(end, n.next - HOLD_GAP);
      const len = Math.floor((end - n.t) / step + 1e-6) * step;
      if (len < HOLD_MIN_LEN) continue;
      const overlapping = holds.filter((h) => h.t < n.t + len && n.t < h.t + h.len).length;
      if (overlapping >= concurrent) continue;
      n.len = +len.toFixed(3);
      holds.push(n);
    }
  }

  const ALL_IDS = [...Object.keys(DIFFICULTIES), ...TOUCH_TIERS.map((d) => 'touch4:' + d), ...TOUCH_TIERS.map((d) => 'touch2:' + d)];

  return { generate, generateId, parseId, DIFFICULTIES, TOUCH_TIERS, ALL_IDS };
});
