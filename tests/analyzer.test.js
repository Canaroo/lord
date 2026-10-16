// Unit tests for the analyzer and chart generator. Run: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const BeatAnalyzer = require('../js/analyzer.js');
const ChartGen = require('../js/chartgen.js');
const { synthLoop } = require('./synth.js');

const nearest = (list, t) => list.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), Infinity);

for (const bpm of [90, 120, 140, 174]) {
  test(`detects tempo, beats and onsets at ${bpm} BPM`, async () => {
    const loop = synthLoop({ bpm });
    const a = await BeatAnalyzer.analyze([loop.samples], loop.sr);
    assert.ok(Math.abs(a.bpm - bpm) / bpm < 0.02, `bpm ${a.bpm} vs ${bpm}`);
    // Every beat lands on a kick drum.
    for (const b of a.beats) assert.ok(Math.abs(nearest(loop.kicks, b) - b) < 0.02, `beat ${b} off-grid`);
    assert.ok(a.beats.length >= loop.kicks.length - 1);
    // Onsets match the drum hits closely.
    const hits = [...loop.kicks, ...loop.hats];
    const within = a.onsets.filter((o) => Math.abs(nearest(hits, o.t) - o.t) < 0.02).length;
    assert.ok(within / hits.length > 0.95, `only ${within}/${hits.length} hits found`);
    assert.ok(a.onsets.length <= hits.length * 1.05, 'too many spurious onsets');
  });
}

test('stereo input gives the same result as mono', async () => {
  const loop = synthLoop({ bpm: 120, seconds: 10 });
  const mono = await BeatAnalyzer.analyze([loop.samples], loop.sr);
  const stereo = await BeatAnalyzer.analyze([loop.samples, loop.samples], loop.sr);
  assert.deepStrictEqual(stereo.beats, mono.beats);
});

test('silence produces no notes', async () => {
  const a = await BeatAnalyzer.analyze([new Float32Array(44100 * 5)], 44100);
  assert.strictEqual(a.onsets.length, 0);
  assert.strictEqual(ChartGen.generate(a, 'hard').notes.length, 0);
});

test('charts respect lane counts, gaps and difficulty ordering', async () => {
  const loop = synthLoop({ bpm: 128, seconds: 20 });
  const a = await BeatAnalyzer.analyze([loop.samples], loop.sr);
  const easy = ChartGen.generate(a, 'easy');
  const hard = ChartGen.generate(a, 'hard');
  assert.strictEqual(easy.lanes, 3);
  assert.strictEqual(hard.lanes, 5);
  assert.ok(easy.notes.every((n) => n.lane >= 0 && n.lane < 3));
  assert.ok(hard.notes.every((n) => n.lane >= 0 && n.lane < 5));
  assert.ok(hard.notes.length > easy.notes.length, 'hard should have more notes');
  const gaps = (notes, min) => {
    const times = [...new Set(notes.map((n) => n.t))];
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= min - 1e-6, `gap ${times[i] - times[i - 1]}`);
  };
  gaps(easy.notes, ChartGen.DIFFICULTIES.easy.minGap);
  gaps(hard.notes, ChartGen.DIFFICULTIES.hard.minGap);
  // Easy never has two notes at once.
  assert.strictEqual(new Set(easy.notes.map((n) => n.t)).size, easy.notes.length);
  // Kicks (low) should mostly map to the left lane on Easy.
  const onKick = easy.notes.filter((n) => Math.abs(nearest(loop.kicks, n.t) - n.t) < 0.02);
  assert.ok(onKick.filter((n) => n.lane === 0).length / onKick.length > 0.5);
});
