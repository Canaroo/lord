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
    insane: {
      label: 'Insane',
      lanes: 5,
      // Unlocked by a B on Hard. Nearly every 8th and 16th the music offers, more
      // two-key chords, quicker repeats; the game also plays it faster, with a
      // tighter timing window and a hungrier rock meter.
      thresholds: [0.05, 0.1, 0.2],
      minGap: 0.085,
      maxRun: 5,
      jackGap: 0.17,
      chordThreshold: 0.45,
      chordGap: 0.5,
      holds: { share: 0.18, concurrent: 2, maxLen: 3 },
      // Never more than this many notes a second (the gap between notes widens until
      // it fits), so the busiest songs stay humanly playable.
      maxNps: 8.5,
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
   * @param {'easy'|'medium'|'hard'|'insane'} difficulty
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
    if (!cfg.maxNps) return generateWith(analysis, difficulty, cfg, touch);
    // A density cap: leave out more of the weakest in-between notes until the chart fits.
    let chart = null;
    for (let keep = 1, i = 0; i < 20; i++, keep *= 0.95) {
      chart = generateWith(analysis, difficulty, { ...cfg, keep }, touch);
      if (chart.notes.length / Math.max(1, analysis.duration) <= cfg.maxNps) break;
    }
    return chart;
  }

  function generateWith(analysis, difficulty, cfg, touch) {
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
    // Capped tiers: drop the weakest off-beat notes (16ths first, then 8ths) down to `keep`.
    if (cfg.keep != null && cfg.keep < 1) {
      const target = Math.round(chosen.length * cfg.keep);
      const order = chosen.filter((c) => c.level > 0).sort((a, b) => b.level - a.level || a.s - b.s || a.t - b.t);
      const drop = new Set(order.slice(0, Math.max(0, chosen.length - target)));
      for (let i = chosen.length - 1; i >= 0; i--) if (drop.has(chosen[i])) chosen.splice(i, 1);
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
    let slideRoom = 0; // touch: every other long hold leaves room for it to become a slide
    let roomUntil = -Infinity; // upright: both thumbs' lanes kept clear for a slide until then
    for (const c of chosen) {
      if (c.t < roomUntil) continue;
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
      const active = reservedUntil.filter((u) => u > c.t).length;
      const willHold = cfg.holds && c.d >= HOLD_MIN_SUSTAIN && reservations < holdBudget && active < cfg.holds.concurrent && cfg.lanes - active > 1;
      // Touch, 4 lanes: a long note goes on its thumb's outer lane, so the held
      // thumb sits at the edge and the other thumb has room beside it.
      if (willHold && touch && cfg.lanes === 4) {
        const outer = hand(lane, 4) === 0 ? 0 : 3;
        if (reservedUntil[outer] <= c.t && !(outer === prevLane && c.t - prevT < cfg.jackGap)) lane = outer;
      }
      run = lane === prevLane ? run + 1 : 1;
      recent.push(lane);
      if (recent.length > 12) recent.shift();
      notes.push({ t: +c.t.toFixed(4), lane, d: c.d });
      if (willHold) {
        const until = c.t + Math.min(c.d, cfg.holds.maxLen) + HOLD_GAP;
        // On touch the whole thumb is busy holding, not just the lane, and on
        // 4 lanes the lane right beside it stays clear so thumbs don't collide.
        // Every other long hold keeps the lanes a slide would move through clear too.
        const outer = cfg.lanes === 2 || lane === 0 || lane === cfg.lanes - 1;
        const room = touch && outer && Math.min(c.d, cfg.holds.maxLen) >= SLIDE_MIN_LEN && slideRoom++ % 2 === 0;
        for (let l = 0; l < cfg.lanes; l++) {
          const sameHand = touch && hand(l, cfg.lanes) === hand(lane, cfg.lanes);
          const beside = touch && cfg.lanes === 4 && Math.abs(l - lane) <= (room ? 2 : 1);
          if (l === lane || sameHand || beside || (room && cfg.lanes === 2)) reservedUntil[l] = until;
        }
        if (room && cfg.lanes === 2) roomUntil = until;
        reservations++;
      }

      if (c.level === 0 && c.s >= cfg.chordThreshold && c.t - lastChordT > (cfg.chordGap || 1.0)) {
        let second = order.find((l) => l !== lane && (!touch || hand(l, cfg.lanes) !== hand(lane, cfg.lanes)));
        // Insane: a chord can also use a free lane for the other thumb.
        if (second == null && cfg.chordGap) second = ranked.find((l) => l !== lane && reservedUntil[l] <= c.t && (!touch || hand(l, cfg.lanes) !== hand(lane, cfg.lanes)));
        if (second == null) continue;
        notes.push({ t: +c.t.toFixed(4), lane: second, d: 0 });
        lastChordT = c.t;
      }
      prevLane = lane;
      prevT = c.t;
    }
    notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
    if (cfg.holds) addHolds(notes, cfg.holds, beatPeriod(analysis.beats), touch ? cfg.lanes : 0);
    if (touch && cfg.holds) addSlides(notes, cfg.lanes);
    return {
      difficulty,
      lanes: cfg.lanes,
      notes: notes.map(({ t, lane, len, slide }) => (slide ? { t, lane, len, slide } : len ? { t, lane, len } : { t, lane })),
    };
  }

  /** Which thumb plays a lane: left half of the lanes or right half. */
  function hand(lane, lanes) { return lane < lanes / 2 ? 0 : 1; }

  /** A tier adapted for touch: same density, 2 or 4 lanes, thumb-friendly rules. */
  function touchConfig(base, lanes) {
    return {
      ...base,
      lanes,
      handGap: lanes === 2 ? 0.3 : 0.22,
      maxRun: lanes === 2 ? 2 : base.maxRun,
      jackGap: Math.max(base.jackGap, lanes === 2 ? 0.3 : 0.22),
      holds: base.holds ? { ...base.holds, concurrent: 1, maxLen: Math.min(base.holds.maxLen, 2) } : null,
      // Thumbs: a lower ceiling than keys, lower still on two lanes.
      maxNps: base.maxNps ? (lanes === 2 ? 7 : 8) : 0,
    };
  }

  // Every way of playing has the same four tiers. (Medium+ and Duo were retired in
  // 1.44; their old scores stay saved but aren't shown.)
  const TOUCH_TIERS = ['easy', 'medium', 'hard', 'insane'];

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
  function addHolds(notes, { share, concurrent, maxLen }, period, touchLanes = 0) {
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
      if (touchLanes && thumbBusy(notes, n, len, touchLanes)) continue;
      n.len = +len.toFixed(3);
      holds.push(n);
    }
  }

  /**
   * Touch: while a thumb holds a long note, nothing else may come for that thumb,
   * and on 4 lanes nothing in the lane right beside it (thumbs would collide).
   */
  function thumbBusy(notes, n, len, lanes) {
    const until = n.t + len + HOLD_GAP;
    return notes.some((o) => o !== n && o.t > n.t + 0.01 && o.t < until &&
      (hand(o.lane, lanes) === hand(n.lane, lanes) || (lanes === 4 && Math.abs(o.lane - n.lane) === 1)));
  }

  // ---- slides (touch) ----------------------------------------------------------------------
  //
  // A slide is a long note whose tail curves into the neighbouring lane (and
  // sometimes back): the thumb follows it, CHUNITHM/Arcaea style. Its path is a
  // list of [fraction of the hold, lane] points, eased between.

  const SLIDE_MIN_LEN = 0.6; // seconds
  const SLIDE_SHAPES = {
    move: [[0, 0], [0.25, 0], [0.7, 1], [1, 1]], // 0 = start lane, 1 = target lane
    wave: [[0, 0], [0.2, 0], [0.5, 1], [0.8, 0], [1, 0]],
  };

  /** Lane a slide is in at time t (fractional while it moves). */
  function slideLaneAt(n, t) {
    const k = Math.max(0, Math.min(1, (t - n.t) / n.len));
    const p = n.slide;
    for (let i = 1; i < p.length; i++) {
      if (k <= p[i][0]) {
        const [a0, l0] = p[i - 1];
        const [a1, l1] = p[i];
        const u = a1 > a0 ? (k - a0) / (a1 - a0) : 1;
        return l0 + (l1 - l0) * u * u * (3 - 2 * u);
      }
    }
    return p[p.length - 1][1];
  }

  /**
   * Turn some long notes into slides. Sideways (4 lanes) a slide stays in its
   * thumb's half: outer lane → inner lane. Upright (2 lanes) it crosses to the
   * other lane, so that thumb must be free. Either way, the lanes the slide moves
   * into (and, sideways, the other thumb's lane right beside it) stay clear while
   * it's there.
   */
  function addSlides(notes, lanes) {
    let count = 0;
    for (const h of notes) {
      if (!h.len || h.len < SLIDE_MIN_LEN) continue;
      const target = lanes === 4 ? (h.lane === 0 ? 1 : h.lane === 3 ? 2 : null) : 1 - h.lane;
      if (target == null) continue;
      const guard = lanes === 4 ? [target, target === 1 ? 2 : 1] : [target];
      const tries = h.len >= 1 && count % 2 === 1 ? ['wave', 'move'] : ['move'];
      for (const shape of tries) {
        const pts = SLIDE_SHAPES[shape];
        const away = pts.filter(([, l]) => l > 0).map(([a]) => a);
        // From when it starts leaving the lane to when it's back (or the end).
        const from = h.t + pts[pts.findIndex(([, l]) => l > 0) - 1][0] * h.len - 0.05;
        const to = h.t + Math.max(...away, shape === 'move' ? 1 : 0) * h.len + HOLD_GAP;
        if (notes.some((o) => o !== h && guard.includes(o.lane) && o.t > from && o.t < to)) continue;
        h.slide = pts.map(([a, l]) => [a, l ? target : h.lane]);
        count++;
        break;
      }
    }
  }

  const ALL_IDS = [...Object.keys(DIFFICULTIES), ...TOUCH_TIERS.map((d) => 'touch4:' + d), ...TOUCH_TIERS.map((d) => 'touch2:' + d)];

  // Bump when charts change shape, so pre-built bonus charts get rebuilt.
  const VERSION = 3; // 2: slides on touch charts; 3: Insane

  return { generate, generateId, parseId, slideLaneAt, DIFFICULTIES, TOUCH_TIERS, ALL_IDS, VERSION };
});
