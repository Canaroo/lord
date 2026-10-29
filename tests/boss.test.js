'use strict';
// Boss battles: which notes glow, and that the fight is winnable but not a given.
const test = require('node:test');
const assert = require('node:assert');
const Boss = require('../js/boss.js');
const SongPack = require('../js/songs.js');
const ChartGen = require('../js/chartgen.js');

test('every boss battle is on an ELITE song in its category', () => {
  for (const [id, b] of Object.entries(Boss.BATTLES)) {
    const def = SongPack.SONGS.find((s) => s.id === id);
    assert.ok(def, id);
    assert.strictEqual(def.tier, 'boss');
    assert.strictEqual(def.theme || 'classic', b.theme);
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

test('power notes: enough for 9 Fireballs on every song, spread through it, never two at once', () => {
  for (const id of Object.keys(Boss.BATTLES)) {
    const def = SongPack.SONGS.find((s) => s.id === id);
    const analysis = SongPack.toAnalysis(SongPack.build(def));
    for (const tier of ['hard', 'touch4:hard', 'touch2:hard']) {
      const notes = ChartGen.generateId(analysis, tier).notes;
      const power = Boss.powerNotes(notes);
      assert.strictEqual(power.size, Boss.FIREBALLS * Boss.POWER_PER_FIREBALL, `${id} ${tier}: ${power.size}`);
      const times = [...power].map((i) => notes[i].t).sort((a, b) => a - b);
      assert.strictEqual(new Set(times).size, times.length, 'one power note per moment');
      const span = notes[notes.length - 1].t - notes[0].t;
      for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] < (3 * span) / times.length, `${id} ${tier}: gap at ${times[i]}`);
      assert.deepStrictEqual([...Boss.powerNotes(notes)], [...power], 'the same every time');
      // Every fight is a proper battle: even a perfect run (every Fireball launched the
      // moment it's charged) takes most of the song to bring the boss down.
      const tune = Boss.tuning(notes, power);
      let hp = tune.hp, charge = 0, downAt = null;
      notes.forEach((n, i) => {
        if (downAt != null) return;
        hp -= tune.hit;
        if (power.has(i) && ++charge === Boss.POWER_PER_FIREBALL) { charge = 0; hp -= tune.fireball; }
        if (hp <= 0) downAt = n.t;
      });
      const at = (downAt - notes[0].t) / span;
      assert.ok(downAt != null && at > 0.6 && at < 0.95, `${id} ${tier}: a perfect run wins ${(at * 100).toFixed(0)}% of the way through`);
    }
  }
});

test('the fight: a strong run wins, hitting notes without Fireballs never does', () => {
  const notes = Array.from({ length: 600 }, (_, i) => ({ t: i * 0.15, lane: i % 4 }));
  const power = Boss.powerNotes(notes);
  const tune = Boss.tuning(notes, power);
  assert.strictEqual(tune.fireball, 10, 'a Fireball takes 10% of the boss');
  assert.strictEqual(tune.fireballs, 9);
  assert.ok(notes.length * tune.hit < tune.hp, 'Fireballs are needed');
  const run = (hit, judge) => notes.length * hit * tune.hit * judge + Math.floor(power.size * hit / Boss.POWER_PER_FIREBALL) * tune.fireball
    - power.size * (1 - hit) * tune.heal - notes.length * (1 - hit) * tune.missHeal;
  assert.ok(run(0.93, 0.85) >= tune.hp, `a strong run (93% of notes) wins (${run(0.93, 0.85).toFixed(1)})`);
  assert.ok(run(0.85, 0.75) < tune.hp, `a shaky run (85% of notes) doesn't (${run(0.85, 0.75).toFixed(1)})`);
  assert.strictEqual(tune.missMul, 2, 'misses cost twice the rock meter');
});

test('the boss attacks: all four hazards, spaced out, the same every time, over before the end', () => {
  for (const [id, battle] of Object.entries(Boss.BATTLES)) {
    const def = SongPack.SONGS.find((s) => s.id === id);
    const analysis = SongPack.toAnalysis(SongPack.build(def));
    for (const tier of ['hard', 'touch4:hard', 'touch2:hard']) {
      const notes = ChartGen.generateId(analysis, tier).notes;
      const touch = tier !== 'hard';
      const lanes = tier === 'hard' ? 5 : +tier[5];
      const list = Boss.attacks(notes, battle.id, { touch, lanes });
      assert.deepStrictEqual(Boss.attacks(notes, battle.id, { touch, lanes }), list, 'deterministic');
      assert.ok(list.length >= 4, `${id} ${tier}: ${list.length} attacks`);
      const kinds = new Set(list.map((a) => a.kind));
      for (const k of lanes === 2 ? ['blackout', 'surge'] : touch ? ['blackout', 'trap', 'surge'] : ['blackout', 'trap', 'surge', 'scramble']) assert.ok(kinds.has(k), `${id} ${tier} has ${k}`);
      if (lanes === 2) assert.ok(!kinds.has('trap'), 'no trap notes on two lanes');
      if (touch) assert.ok(!kinds.has('scramble'), 'no lane scramble on a phone');
      for (let i = 1; i < list.length; i++) assert.ok(list[i].t0 - list[i - 1].t1 >= 5, 'a breather between attacks');
      assert.ok(list[0].t0 >= notes[0].t + 8, 'a calm start');
      assert.ok(list[list.length - 1].t1 <= notes[notes.length - 1].t - 3, 'over before the end');
      // Trap notes only come during trap attacks, never near a real note in their lane.
      const traps = Boss.traps(notes, list, lanes, 60 / def.bpm);
      if (lanes > 2) assert.ok(traps.length >= 8, `${id} ${tier}: ${traps.length} traps`);
      for (const tr of traps) {
        assert.ok(list.some((a) => a.kind === 'trap' && tr.t >= a.t0 && tr.t < a.t1));
        assert.ok(tr.lane >= 0 && tr.lane < lanes);
        assert.ok(!notes.some((n) => n.lane === tr.lane && Math.abs(n.t - tr.t) < 0.25), `${id} ${tier}: trap at ${tr.t} is clear of real notes`);
      }
    }
  }
});
