// Synthetic drum loop for tests: kick on beats, hat on off-beats, snare on 2 & 4.
'use strict';
function synthLoop({ bpm = 120, seconds = 20, sr = 44100, startAt = 0.5, seed = 1, parts = 'khs' } = {}) {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const beat = 60 / bpm;
  const kicks = [], hats = [], snares = [];
  for (let t = startAt, i = 0; t < seconds - 0.5; t += beat, i++) {
    kicks.push(t);
    hats.push(t + beat / 2);
    if (i % 2 === 1) snares.push(t);
  }
  const add = (t0, len, fn) => {
    const a = Math.floor(t0 * sr);
    for (let i = 0; i < len * sr && a + i < n; i++) out[a + i] += fn(i / sr);
  };
  if (parts.includes('k')) for (const t of kicks) add(t, 0.6, (x) => 0.9 * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-x * 30)) * x) * Math.exp(-x * 12));
  if (parts.includes('s')) for (const t of snares) add(t, 0.4, (x) => 0.4 * rand() * Math.exp(-x * 25));
  if (parts.includes('h')) for (const t of hats) add(t, 0.04, (x) => 0.2 * rand() * Math.exp(-x * 90) * (x > 0 ? 1 : 0));
  return { samples: out, sr, kicks, hats, snares, beat };
}
/** A song with sections: intro (kick), verse (full kit), break (hats), chorus (full kit). */
function synthSong({ bpm = 120, sr = 44100, sections = [['k', 8], ['khs', 12], ['h', 6], ['khs', 12]] } = {}) {
  const pieces = sections.map(([parts, seconds]) => synthLoop({ bpm, sr, seconds, parts, startAt: 0 }).samples);
  const out = new Float32Array(pieces.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of pieces) { out.set(p, o); o += p.length; }
  return { samples: out, sr };
}
module.exports = { synthLoop, synthSong };
