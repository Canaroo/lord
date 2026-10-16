/*
 * BonusPack — recorded songs shipped with the game in songs/.
 *
 * songs/index.json lists them; each has an MP3 and a pre-built chart file
 * (made by tools/build-charts.js) so every player gets identical notes. Songs
 * download only when picked.
 *
 * MP3 decoders in different browsers trim the encoder's start-up padding
 * differently, which can shift the audio by a few dozen milliseconds. On load
 * we listen to the first 30 seconds and slide the chart to line up with what
 * this browser actually decoded.
 */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BonusPack = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ALIGN_SECONDS = 30;
  const MAX_SHIFT = 0.09;

  /**
   * Best time shift (seconds) to apply to `reference` onset times so they line
   * up with `local` onset times. Scores each 1 ms step by how many onsets land
   * within 12 ms of each other.
   */
  function bestShift(reference, local) {
    if (reference.length < 8 || local.length < 8) return 0;
    const loc = local.slice().sort((a, b) => a - b);
    const near = (t) => {
      let lo = 0, hi = loc.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (loc[mid] < t) lo = mid; else hi = mid;
      }
      return Math.min(Math.abs(loc[lo] - t), Math.abs(loc[hi] - t));
    };
    let best = 0;
    let bestScore = -1;
    for (let ms = -MAX_SHIFT * 1000; ms <= MAX_SHIFT * 1000; ms++) {
      const sh = ms / 1000;
      let score = 0;
      for (const t of reference) {
        const d = near(t + sh);
        if (d < 0.012) score += 1 - d / 0.012;
      }
      // Prefer the smallest shift among near-ties.
      if (score > bestScore + 1e-6 || (Math.abs(score - bestScore) < 1e-6 && Math.abs(sh) < Math.abs(best))) {
        bestScore = score;
        best = sh;
      }
    }
    return best;
  }

  function shiftChart(chart, sh) {
    return { ...chart, notes: chart.notes.map((n) => ({ ...n, t: +(n.t + sh).toFixed(4) })) };
  }

  /** Strong onsets from the first stretch of a song, used as the alignment reference. */
  function referenceOnsets(analysis) {
    return analysis.onsets.filter((o) => o.t < ALIGN_SECONDS && o.s >= 0.25).map((o) => o.t);
  }

  return { bestShift, shiftChart, referenceOnsets, ALIGN_SECONDS, keyFor: (id) => 'bonus:' + id };
});
