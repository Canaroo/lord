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
    const RANGE = { easy: [1, 3.5], medium: [1.8, 5.5], mediumplus: [2.8, 7], hard: [3, 8], duo: [2.8, 7.5] };
    const total = {};
    for (const d of Object.keys(ChartGen.DIFFICULTIES)) {
      const c1 = ChartGen.generate(a1, d);
      const c2 = ChartGen.generate(a2, d);
      assert.deepStrictEqual(c1, c2, 'charts must be identical across builds');
      total[d] = c1.notes.length;
      const nps = c1.notes.length / a1.duration;
      assert.ok(nps > RANGE[d][0] && nps < RANGE[d][1], `${d} density ${nps.toFixed(2)}/s`);
      // Every lane gets used for a meaningful share of notes.
      const counts = new Array(c1.lanes).fill(0);
      c1.notes.forEach((n) => counts[n.lane]++);
      for (const c of counts) assert.ok(c / c1.notes.length > 0.04, `lane share too low: ${counts}`);
    }
    assert.ok(total.easy < total.medium && total.medium < total.mediumplus && total.mediumplus <= total.hard, `difficulty should step up: ${JSON.stringify(total)}`);
    assert.ok(total.mediumplus >= 0.75 * total.hard, `Medium+ should be close to Hard: ${JSON.stringify(total)}`);
    assert.ok(total.duo >= 0.75 * total.hard, `Duo should be close to Hard's density: ${JSON.stringify(total)}`);
    // Beats are evenly spaced at the song's tempo.
    const gap = 60 / song.bpm;
    for (let i = 1; i < a1.beats.length; i++) assert.ok(Math.abs(a1.beats[i] - a1.beats[i - 1] - gap) < 0.001);
  });
}

test('malformed patterns are rejected', () => {
  const bad = { ...SongPack.SONGS[0], id: 'bad', bass: { verse: '0.0.' } };
  assert.throws(() => SongPack.build(bad), /16 steps/);
});

test('long notes: none on Easy, never overlap a note in their lane, respect concurrency', () => {
  for (const song of SongPack.SONGS) {
    const a = SongPack.toAnalysis(SongPack.build(song));
    for (const [d, cfg] of Object.entries(ChartGen.DIFFICULTIES)) {
      const c = ChartGen.generate(a, d);
      const holds = c.notes.filter((n) => n.len);
      if (!cfg.holds) { assert.strictEqual(holds.length, 0, `${d} should have no long notes`); continue; }
      assert.ok(holds.length > 0, `${song.id} ${d} should have long notes`);
      for (const h of holds) {
        assert.ok(h.len >= 0.35, `tail too short: ${h.len}`);
        const clash = c.notes.find((n) => n !== h && n.lane === h.lane && n.t > h.t && n.t < h.t + h.len + 0.1);
        assert.ok(!clash, `${song.id} ${d}: note at ${clash && clash.t} inside a long note's tail`);
        const overlapping = holds.filter((o) => o !== h && o.t < h.t + h.len && h.t < o.t + o.len);
        assert.ok(overlapping.length < cfg.holds.concurrent, `${song.id} ${d}: too many long notes at once`);
      }
    }
  }
});

test('Duo alternates quick notes between its two keys', () => {
  for (const song of SongPack.SONGS) {
    const c = ChartGen.generate(SongPack.toAnalysis(SongPack.build(song)), 'duo');
    assert.strictEqual(c.lanes, 2);
    // Notes played while the other key holds a long note repeat on purpose.
    const underHold = (n) => c.notes.some((h) => h.len && h.lane !== n.lane && n.t > h.t && n.t <= h.t + h.len);
    const singles = c.notes.filter((n, i, arr) => !arr.some((m) => m !== n && m.t === n.t) && !underHold(n));
    let quick = 0, alternating = 0;
    for (let i = 1; i < singles.length; i++) {
      if (singles[i].t - singles[i - 1].t < 0.3) {
        quick++;
        if (singles[i].lane !== singles[i - 1].lane) alternating++;
      }
    }
    assert.ok(quick > 20 && alternating / quick > 0.85, `${song.id}: ${alternating}/${quick} quick notes alternate`);
  }
});

test('touch: a held long note never has notes for the same thumb, or right beside it', () => {
  let holdsTotal = 0, outer = 0;
  for (const song of SongPack.SONGS) {
    const a = SongPack.toAnalysis(SongPack.build(song));
    for (const id of ChartGen.ALL_IDS.filter((x) => x.startsWith('touch'))) {
      const c = ChartGen.generateId(a, id);
      const hand = (l) => (l < c.lanes / 2 ? 0 : 1);
      for (const h of c.notes.filter((n) => n.len)) {
        holdsTotal++;
        if (c.lanes === 4 && (h.lane === 0 || h.lane === 3)) outer++;
        const clash = c.notes.find((n) => n !== h && n.t > h.t + 0.01 && n.t < h.t + h.len + 0.1 &&
          (hand(n.lane) === hand(h.lane) || (c.lanes === 4 && Math.abs(n.lane - h.lane) === 1)));
        assert.ok(!clash, `${song.id} ${id}: note in lane ${clash && clash.lane} at ${clash && clash.t} while lane ${h.lane} is held`);
      }
      if (id.endsWith(':medium') || id.endsWith(':hard')) {
        assert.ok(c.notes.some((n) => n.len), `${song.id} ${id} should still have long notes`);
      }
    }
  }
  assert.ok(holdsTotal > 0);
});
