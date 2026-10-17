/*
 * BeatAnalyzer — turns raw audio samples into rhythm data:
 *   - per-band onset detection (spectral flux in 5 frequency bands)
 *   - tempo estimation (autocorrelation of the onset envelope)
 *   - beat tracking (dynamic programming, after Ellis 2007)
 *
 * Pure JS, no dependencies. Works in the browser (window.BeatAnalyzer)
 * and in Node (module.exports) so it can be unit tested.
 */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BeatAnalyzer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const VERSION = 2; // 2: onsets carry a sustain length (d)
  const FFT_SIZE = 1024;
  const HOP = 256;
  // 5 bands, low → high. Lane 0 follows the kick/bass, lane 4 the hats/cymbals.
  const BAND_EDGES = [30, 150, 400, 1500, 4500, 11000];
  const NUM_BANDS = BAND_EDGES.length - 1;
  // Spectral-flux peaks land slightly before the true attack; measured with
  // synthetic click tracks (see tests/analyzer.test.js).
  const TIME_OFFSET = 0.012;

  function makeFFT(n) {
    const levels = Math.log2(n);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < levels; b++) r = (r << 1) | ((i >>> b) & 1);
      rev[i] = r;
    }
    const cos = new Float32Array(n / 2);
    const sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    return function fft(re, im) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >>> 1;
        const step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const a = i + j;
            const b = a + half;
            const tr = re[b] * cos[k] + im[b] * sin[k];
            const ti = im[b] * cos[k] - re[b] * sin[k];
            re[b] = re[a] - tr;
            im[b] = im[a] - ti;
            re[a] += tr;
            im[a] += ti;
          }
        }
      }
    };
  }

  /** Mix to mono and halve the sample rate for speed (onsets don't need 44.1 kHz). */
  function prepareSignal(channels, sampleRate) {
    const len = channels[0].length;
    const factor = sampleRate >= 32000 ? 2 : 1;
    const outLen = Math.floor(len / factor);
    const out = new Float32Array(outLen);
    const nc = channels.length;
    const scale = 1 / (factor * nc);
    for (let i = 0; i < outLen; i++) {
      let s = 0;
      for (let f = 0; f < factor; f++) {
        const idx = i * factor + f;
        for (let c = 0; c < nc; c++) s += channels[c][idx];
      }
      out[i] = s * scale;
    }
    return { signal: out, sampleRate: sampleRate / factor };
  }

  function prefixSums(arr) {
    const p = new Float64Array(arr.length + 1);
    for (let i = 0; i < arr.length; i++) p[i + 1] = p[i] + arr[i];
    return p;
  }

  function windowMean(prefix, i, before, after) {
    const n = prefix.length - 1;
    const lo = Math.max(0, i - before);
    const hi = Math.min(n, i + after + 1);
    return (prefix[hi] - prefix[lo]) / (hi - lo);
  }

  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = Array.from(values).sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
    return sorted[idx];
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  /**
   * @param {Float32Array[]} channels  PCM channels (e.g. from AudioBuffer.getChannelData)
   * @param {number} sampleRate
   * @param {(fraction:number)=>void} [onProgress]
   */
  async function analyze(channels, sampleRate, onProgress) {
    const progress = onProgress || (() => {});
    const duration = channels[0].length / sampleRate;
    const { signal, sampleRate: sr } = prepareSignal(channels, sampleRate);
    const frameRate = sr / HOP;
    const nFrames = Math.max(1, Math.floor((signal.length - FFT_SIZE) / HOP) + 1);
    const frameTime = (f) => (f * HOP + FFT_SIZE / 2) / sr + TIME_OFFSET;

    // ---- 1. Short-time spectrum → per-band spectral flux -------------------
    const binHz = sr / FFT_SIZE;
    const bandBins = [];
    for (let b = 0; b < NUM_BANDS; b++) {
      const lo = Math.max(1, Math.floor(BAND_EDGES[b] / binHz));
      const hi = Math.min(FFT_SIZE / 2, Math.ceil(BAND_EDGES[b + 1] / binHz));
      bandBins.push([lo, Math.max(lo + 1, hi)]);
    }
    const win = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);

    const fft = makeFFT(FFT_SIZE);
    const re = new Float32Array(FFT_SIZE);
    const im = new Float32Array(FFT_SIZE);
    let prev = new Float32Array(FFT_SIZE / 2 + 1);
    let cur = new Float32Array(FFT_SIZE / 2 + 1);
    const flux = [];
    for (let b = 0; b < NUM_BANDS; b++) flux.push(new Float32Array(nFrames));
    const rms = new Float32Array(nFrames);
    // Per-band loudness (mean log magnitude), used to measure how long a sound rings.
    const level = [];
    for (let b = 0; b < NUM_BANDS; b++) level.push(new Float32Array(nFrames));

    for (let f = 0; f < nFrames; f++) {
      const off = f * HOP;
      let energy = 0;
      for (let i = 0; i < FFT_SIZE; i++) {
        const v = signal[off + i] || 0;
        energy += v * v;
        re[i] = v * win[i];
        im[i] = 0;
      }
      rms[f] = Math.sqrt(energy / FFT_SIZE);
      fft(re, im);
      for (let k = 0; k <= FFT_SIZE / 2; k++) {
        cur[k] = Math.log1p(100 * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
      }
      for (let b = 0; b < NUM_BANDS; b++) {
        const [lo, hi] = bandBins[b];
        let e = 0;
        for (let k = lo; k < hi; k++) e += cur[k];
        level[b][f] = e / (hi - lo);
      }
      if (f > 0) {
        for (let b = 0; b < NUM_BANDS; b++) {
          const [lo, hi] = bandBins[b];
          let s = 0;
          for (let k = lo; k < hi; k++) {
            const d = cur[k] - prev[k];
            if (d > 0) s += d;
          }
          flux[b][f] = s / (hi - lo);
        }
      }
      const t = prev; prev = cur; cur = t;
      if (f % 1500 === 0) {
        progress((0.75 * f) / nFrames);
        await tick();
      }
    }

    // ---- 2. Normalise bands so each one gets a fair share of lanes ---------
    const bandMeans = flux.map((arr) => {
      let s = 0;
      for (let i = 0; i < arr.length; i++) s += arr[i];
      return s / arr.length;
    });
    const meanOfMeans = bandMeans.reduce((a, b) => a + b, 0) / NUM_BANDS;
    const norm = flux.map((arr, b) => {
      // A floor stops near-silent bands (e.g. no sub-bass) from amplifying noise.
      const d = Math.max(bandMeans[b], 0.25 * meanOfMeans) || 1;
      const out = new Float32Array(arr.length);
      for (let i = 0; i < arr.length; i++) out[i] = arr[i] / d;
      return out;
    });

    const env = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f++) {
      let s = 0;
      for (let b = 0; b < NUM_BANDS; b++) s += norm[b][f];
      env[f] = s / NUM_BANDS;
    }
    progress(0.8);
    await tick();

    // ---- 3. Onset peak picking (adaptive threshold) -------------------------
    const envPrefix = prefixSums(env);
    const preW = Math.round(0.1 * frameRate);
    const postW = Math.round(0.07 * frameRate);
    const maxW = Math.max(1, Math.round(0.03 * frameRate));
    const globalMean = envPrefix[nFrames] / nFrames;
    const delta = 0.3 * globalMean;
    const quiet = 0.04 * percentile(rms, 0.95);

    const rawOnsets = [];
    for (let f = 1; f < nFrames - 1; f++) {
      const v = env[f];
      let isMax = true;
      for (let k = Math.max(0, f - maxW); k <= Math.min(nFrames - 1, f + maxW); k++) {
        if (env[k] > v || (env[k] === v && k < f)) { isMax = false; break; }
      }
      if (!isMax) continue;
      const mean = windowMean(envPrefix, f, preW, postW);
      if (v < mean + delta) continue;
      if (rms[Math.min(nFrames - 1, f + 1)] < quiet) continue;
      const bands = new Array(NUM_BANDS);
      for (let b = 0; b < NUM_BANDS; b++) {
        bands[b] = Math.max(norm[b][f - 1], norm[b][f], norm[b][f + 1]);
      }
      rawOnsets.push({ f, strength: v - mean, bands });
    }
    const strengthRef = percentile(rawOnsets.map((o) => o.strength), 0.95) || 1;

    // Sustain: how long a sound rings after it's hit. For each band the hit
    // touched, measure how long that band stays above 30% of the way from its
    // pre-hit level to its peak (log scale, so the hit's spike doesn't hide a
    // steady tone underneath), and keep the longest. Drums die away in ~0.1–0.2 s; held synths, vocals and chords
    // ring on. The top band (cymbals, hats) is left out: crashes ring but aren't
    // something you'd hold.
    const maxSustain = Math.round(4 * frameRate);
    const SUSTAIN_BANDS = NUM_BANDS - 1;
    const sustain = rawOnsets.map((o) => {
      const bandMax = Math.max(...o.bands) || 1;
      let best = 0;
      for (let b = 0; b < SUSTAIN_BANDS; b++) {
        if (o.bands[b] < 0.35 * bandMax) continue;
        const L = level[b];
        let floor = Infinity;
        for (let k = Math.max(0, o.f - 8); k < o.f; k++) floor = Math.min(floor, L[k]);
        if (!Number.isFinite(floor)) floor = 0;
        let peak = 0;
        for (let k = o.f; k < Math.min(nFrames, o.f + 4); k++) peak = Math.max(peak, L[k]);
        if (peak - floor < 0.05) continue;
        const cut = floor + 0.3 * (peak - floor);
        const end = Math.min(nFrames, o.f + maxSustain);
        let k = o.f + 1;
        while (k < end && L[k] >= cut) k++;
        best = Math.max(best, (k - o.f) / frameRate);
      }
      return best;
    });

    const onsets = rawOnsets.map((o, i) => {
      const bandMax = Math.max(...o.bands) || 1;
      return {
        t: +frameTime(o.f).toFixed(4),
        s: +Math.min(1, o.strength / strengthRef).toFixed(3),
        b: o.bands.map((x) => +(x / bandMax).toFixed(2)),
        d: +sustain[i].toFixed(2),
      };
    });
    progress(0.85);
    await tick();

    // ---- 4. Tempo: autocorrelation of the novelty curve ----------------------
    const longW = Math.round(0.3 * frameRate);
    const novelty = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f++) {
      novelty[f] = Math.max(0, env[f] - windowMean(envPrefix, f, longW, longW));
    }
    const minLag = Math.max(2, Math.floor((frameRate * 60) / 200));
    const maxLag = Math.ceil((frameRate * 60) / 60);
    const acLen = Math.min(nFrames - 1, 2 * maxLag + 2);
    const ac = new Float64Array(acLen + 1);
    for (let lag = 1; lag <= acLen; lag++) {
      let s = 0;
      for (let i = 0; i + lag < nFrames; i++) s += novelty[i] * novelty[i + lag];
      ac[lag] = s / (nFrames - lag);
    }
    let bestLag = Math.round((frameRate * 60) / 120);
    let bestScore = -Infinity;
    const scoreAt = (lag) => {
      const bpm = (60 * frameRate) / lag;
      const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
      const harmonic = 2 * lag <= acLen ? 0.5 * ac[2 * lag] : 0;
      return w * (ac[lag] + harmonic);
    };
    const scores = new Float64Array(acLen + 1);
    for (let lag = minLag; lag <= Math.min(maxLag, acLen); lag++) {
      scores[lag] = scoreAt(lag);
      if (scores[lag] > bestScore) { bestScore = scores[lag]; bestLag = lag; }
    }
    // Parabolic interpolation for a sub-frame period.
    let period = bestLag;
    if (bestLag > minLag && bestLag < Math.min(maxLag, acLen)) {
      const a = scores[bestLag - 1], b = scores[bestLag], c = scores[bestLag + 1];
      const denom = a - 2 * b + c;
      if (denom < 0) period = bestLag + (0.5 * (a - c)) / denom;
    }
    const bpm = (60 * frameRate) / period;
    progress(0.9);
    await tick();

    // ---- 5. Beat tracking: dynamic programming ------------------------------
    let mean = 0;
    for (let f = 0; f < nFrames; f++) mean += novelty[f];
    mean /= nFrames;
    let variance = 0;
    for (let f = 0; f < nFrames; f++) variance += (novelty[f] - mean) ** 2;
    const std = Math.sqrt(variance / nFrames) || 1;
    const tightness = 100;
    const cum = new Float64Array(nFrames);
    const back = new Int32Array(nFrames).fill(-1);
    const lo = Math.round(period / 2);
    const hi = Math.round(period * 2);
    for (let t = 0; t < nFrames; t++) {
      const local = novelty[t] / std;
      let best = -Infinity;
      let arg = -1;
      for (let p = t - hi; p <= t - lo; p++) {
        if (p < 0) continue;
        const r = Math.log((t - p) / period);
        const v = cum[p] - tightness * r * r;
        if (v > best) { best = v; arg = p; }
      }
      // Starting a new beat chain is free; extending one only when it pays off.
      if (arg >= 0 && best > 0) { cum[t] = local + best; back[t] = arg; }
      else cum[t] = local;
    }
    // Last beat: the final local maximum of the cumulative score that is reasonably strong.
    const peaks = [];
    for (let t = 1; t < nFrames - 1; t++) {
      if (cum[t] >= cum[t - 1] && cum[t] > cum[t + 1]) peaks.push(t);
    }
    let last = nFrames - 1;
    if (peaks.length) {
      const med = percentile(peaks.map((t) => cum[t]), 0.5);
      for (let i = peaks.length - 1; i >= 0; i--) {
        if (cum[peaks[i]] >= 0.5 * med) { last = peaks[i]; break; }
      }
    }
    const beatFrames = [];
    for (let t = last; t >= 0; t = back[t]) beatFrames.push(t);
    beatFrames.reverse();

    // Trim beats in leading/trailing silence.
    const firstOnset = onsets.length ? onsets[0].t : 0;
    const lastOnset = onsets.length ? onsets[onsets.length - 1].t : duration;
    const periodSec = period / frameRate;
    const beats = beatFrames
      .map((f) => +frameTime(f).toFixed(4))
      .filter((t) => t >= firstOnset - periodSec * 0.25 && t <= lastOnset + periodSec * 0.25);

    progress(1);
    return {
      version: VERSION,
      duration: +duration.toFixed(3),
      bpm: +bpm.toFixed(1),
      beats,
      onsets,
    };
  }

  return { analyze, VERSION, NUM_BANDS };
});
