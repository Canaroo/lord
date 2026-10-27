'use strict';
// Boss battles: which notes glow, and that the fight is winnable but not a given.
const test = require('node:test');
const assert = require('node:assert');
const Boss = require('../js/boss.js');
const SongPack = require('../js/songs.js');
const ChartGen = require('../js/chartgen.js');

test('every boss battle is a BOSS song in its category', () => {
  for (const [id, b] of Object.entries(Boss.BATTLES)) {
    const def = SongPack.SONGS.find((s) => s.id === id);
    assert.ok(def, id);
    assert.strictEqual(def.tier, 'boss');
    assert.strictEqual(def.theme, b.theme);
    assert.ok(Boss.SPRITES[b.id], `${b.id} has a sprite`);
  }
});

test('sprites are 16 pixels wide and every colour is in the palette', () => {
  for (const [id, art] of Object.entries(Boss.SPRITES)) {
    for (const row of art.rows) {
      assert.strictEqual(row.length, 16, `${id}: ${row}`);
      for (const k of row) assert.ok(k === '.' || art.palette[k], `${id}: ${k}`);
    }
  }
});

test('power notes: about one in twelve, spread through the song, whole Fireballs, never two at once', () => {
  for (const id of Object.keys(Boss.BATTLES)) {
    const def = SongPack.SONGS.find((s) => s.id === id);
    const analysis = SongPack.toAnalysis(SongPack.build(def));
    for (const tier of ['hard', 'touch4:hard', 'touch2:hard']) {
      const notes = ChartGen.generateId(analysis, tier).notes;
      const power = Boss.powerNotes(notes);
      assert.strictEqual(power.size % Boss.POWER_PER_FIREBALL, 0, `${id} ${tier}: ${power.size}`);
      assert.ok(power.size >= notes.length / 16 && power.size <= notes.length / 9, `${id} ${tier}: ${power.size} of ${notes.length}`);
      const times = [...power].map((i) => notes[i].t).sort((a, b) => a - b);
      assert.strictEqual(new Set(times).size, times.length, 'one power note per moment');
      // Spread out: no big stretch of the song without any.
      const span = notes[notes.length - 1].t - notes[0].t;
      for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] < (3 * span) / times.length, `${id} ${tier}: gap at ${times[i]}`);
      assert.deepStrictEqual([...Boss.powerNotes(notes)], [...power], 'the same every time');
    }
  }
});

test('the fight: a near-perfect run wins, hitting notes without Fireballs never does', () => {
  const notes = Array.from({ length: 600 }, (_, i) => ({ t: i * 0.15, lane: i % 4 }));
  const power = Boss.powerNotes(notes);
  const tune = Boss.tuning(notes, power);
  const fireballs = Math.floor(power.size / Boss.POWER_PER_FIREBALL);
  assert.ok(notes.length * tune.hit + fireballs * tune.fireball > tune.hp * 1.3, 'room to spare at the top');
  assert.ok(notes.length * tune.hit < tune.hp * 0.7, 'Fireballs are needed');
  // A B-ish run: 90% of notes hit at GOOD, 90% of power notes, the rest missed.
  const hit = 0.9;
  const dmg = notes.length * hit * tune.hit * Boss.JUDGE_DAMAGE.good + Math.floor(power.size * hit / Boss.POWER_PER_FIREBALL) * tune.fireball - power.size * (1 - hit) * tune.heal;
  assert.ok(dmg >= tune.hp, `a solid run wins (${dmg.toFixed(1)})`);
});
