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
    const RANGE = { easy: [1, 3.5], medium: [1.8, 5.5], hard: [3, 8], insane: [3.5, 8.6] };
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
    assert.ok(total.easy < total.medium && total.medium < total.hard && total.hard < total.insane, `difficulty should step up: ${JSON.stringify(total)}`);
    // Insane is a step up from Hard, on keys and on both phone layouts, but stays playable.
    for (const [h, i, cap] of [['hard', 'insane', 8.6], ['touch4:hard', 'touch4:insane', 8.1], ['touch2:hard', 'touch2:insane', 7.1]]) {
      const H = ChartGen.generateId(a1, h).notes.length, I = ChartGen.generateId(a1, i).notes.length;
      assert.ok(I > H * 1.04, `${i} should have more notes than ${h}: ${I} vs ${H}`);
      assert.ok(I / a1.duration <= cap, `${i} stays under ${cap}/s: ${(I / a1.duration).toFixed(2)}`);
    }
    // Beats are evenly spaced at the song's tempo (or a section's own, in a song that speeds up).
    const gaps = song.form.flatMap((sec) => Array(sec.bars * 4).fill(60 / (sec.bpm || song.bpm)));
    assert.strictEqual(a1.beats.length, gaps.length + 1);
    for (let i = 1; i < a1.beats.length; i++) assert.ok(Math.abs(a1.beats[i] - a1.beats[i - 1] - gaps[i - 1]) < 0.001);
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

test('touch slides: only on phone charts, and the lanes they move through stay clear', () => {
  let slides = 0, waves = 0;
  for (const song of SongPack.SONGS) {
    const a = SongPack.toAnalysis(SongPack.build(song));
    for (const id of ChartGen.ALL_IDS) {
      const c = ChartGen.generateId(a, id);
      if (!id.startsWith('touch')) {
        assert.ok(!c.notes.some((n) => n.slide), `${id} must not have slides`);
        continue;
      }
      for (const h of c.notes.filter((n) => n.slide)) {
        slides++;
        if (h.slide.length === 5) waves++;
        assert.ok(h.len >= 0.6, 'slides are long enough to follow');
        const target = h.slide.find(([, l]) => l !== h.lane)[1];
        assert.strictEqual(Math.abs(target - h.lane), 1, 'a slide moves one lane');
        assert.strictEqual(ChartGen.slideLaneAt(h, h.t), h.lane, 'starts in its lane');
        // Wherever the slide is, nothing else comes in that lane or (sideways) right beside it.
        for (const o of c.notes) {
          if (o === h || o.t <= h.t + 0.01 || o.t >= h.t + h.len) continue;
          const at = ChartGen.slideLaneAt(h, o.t);
          assert.ok(Math.abs(o.lane - at) >= (c.lanes === 4 ? 1.5 : 1), `${song.id} ${id}: note in lane ${o.lane} at ${o.t} collides with a slide at lane ${at.toFixed(2)}`);
        }
      }
    }
  }
  assert.ok(slides > 20 && waves > 3, `slides ${slides}, waves ${waves}`);
});
