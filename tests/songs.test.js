// Song pack: charts must be identical for every player and playable. Run: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const SongPack = require('../js/songs.js');
const ChartGen = require('../js/chartgen.js');

for (const song of SongPack.SONGS) {
  test(`${song.title}: deterministic, playable charts`, () => {
    const a1 = SongPack.toAnalysis(SongPack.build(song));
    const a2 = SongPack.toAnalysis(SongPack.build(song));
    for (const d of ['easy', 'hard']) {
      const c1 = ChartGen.generate(a1, d);
      const c2 = ChartGen.generate(a2, d);
      assert.deepStrictEqual(c1, c2, 'charts must be identical across builds');
      const nps = c1.notes.length / a1.duration;
      assert.ok(nps > (d === 'easy' ? 1 : 3) && nps < (d === 'easy' ? 3.5 : 8), `${d} density ${nps.toFixed(2)}/s`);
      // Every lane gets used for a meaningful share of notes.
      const counts = new Array(c1.lanes).fill(0);
      c1.notes.forEach((n) => counts[n.lane]++);
      for (const c of counts) assert.ok(c / c1.notes.length > 0.04, `lane share too low: ${counts}`);
    }
    // Beats are evenly spaced at the song's tempo.
    const gap = 60 / song.bpm;
    for (let i = 1; i < a1.beats.length; i++) assert.ok(Math.abs(a1.beats[i] - a1.beats[i - 1] - gap) < 0.001);
  });
}

test('malformed patterns are rejected', () => {
  const bad = { ...SongPack.SONGS[0], id: 'bad', bass: { verse: '0.0.' } };
  assert.throws(() => SongPack.build(bad), /16 steps/);
});
