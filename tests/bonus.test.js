// Bonus tracks: pre-built charts must line up with however the browser decoded the MP3. Run: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const BeatAnalyzer = require('../js/analyzer.js');
const ChartGen = require('../js/chartgen.js');
const BonusPack = require('../js/bonus.js');
const { synthSong } = require('./synth.js');

test('finds the decoder offset between reference and local audio', async () => {
  const song = synthSong({ bpm: 132 });
  const reference = BonusPack.referenceOnsets(await BeatAnalyzer.analyze([song.samples], song.sr));
  for (const ms of [-47, 0, 26, 61]) {
    // Simulate a browser whose decoder adds (or trims) `ms` of padding.
    const pad = Math.round((Math.abs(ms) / 1000) * song.sr);
    const shifted = ms >= 0
      ? Float32Array.from([...new Float32Array(pad), ...song.samples.subarray(0, 30 * song.sr)])
      : song.samples.slice(pad, 30 * song.sr + pad);
    const local = BonusPack.referenceOnsets(await BeatAnalyzer.analyze([shifted], song.sr));
    const sh = BonusPack.bestShift(reference, local);
    assert.ok(Math.abs(sh * 1000 - ms) <= 4, `expected ~${ms} ms, got ${(sh * 1000).toFixed(1)} ms`);
  }
});

test('shifting a chart moves every note and nothing else', () => {
  const chart = { difficulty: 'hard', lanes: 5, notes: [{ t: 1, lane: 0 }, { t: 2.5, lane: 4 }] };
  const out = BonusPack.shiftChart(chart, 0.03);
  assert.deepStrictEqual(out.notes, [{ t: 1.03, lane: 0 }, { t: 2.53, lane: 4 }]);
  assert.strictEqual(out.lanes, 5);
  assert.strictEqual(chart.notes[0].t, 1, 'original chart untouched');
});

test('all three difficulties are generated and ordered', async () => {
  const song = synthSong({ bpm: 120 });
  const a = await BeatAnalyzer.analyze([song.samples], song.sr);
  const n = Object.fromEntries(['easy', 'medium', 'hard'].map((d) => [d, ChartGen.generate(a, d)]));
  assert.deepStrictEqual([n.easy.lanes, n.medium.lanes, n.hard.lanes], [3, 4, 5]);
  assert.ok(n.medium.notes.every((x) => x.lane < 4));
  assert.ok(n.easy.notes.length <= n.medium.notes.length && n.medium.notes.length <= n.hard.notes.length);
});
