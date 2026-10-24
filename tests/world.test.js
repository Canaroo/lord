'use strict';
const test = require('node:test');
const assert = require('node:assert');
const World = require('../js/world.js');

function rng(seed) {
  let x = seed;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
}

/** A song-like chart: bars that mostly repeat, with lanes that follow a melody. */
function chart(shift = 0, seed = 7) {
  const r = rng(seed);
  const notes = [];
  let t = 1.3;
  for (let i = 0; i < 160; i++) {
    t += [0.25, 0.5, 0.25, 0.5][i % 4] + (r() < 0.15 ? 0.25 : 0);
    const n = { t: +(t + shift).toFixed(4), lane: Math.floor(r() * 4) };
    if (i % 17 === 0) n.len = 0.8;
    if (i === 34) n.slide = [[0, n.lane], [0.25, n.lane], [0.7, 1], [1, 1]];
    notes.push(n);
  }
  return { difficulty: 'touch4:hard', lanes: 4, notes };
}

test('chart hash ignores where the song starts, not what the notes are', () => {
  assert.strictEqual(World.chartHash(chart()), World.chartHash(chart(2.345)));
  const other = chart();
  other.notes[50].lane = (other.notes[50].lane + 1) % 4;
  assert.notStrictEqual(World.chartHash(chart()), World.chartHash(other));
});

test('board ids: built-in songs by song, imported songs by chart', () => {
  assert.strictEqual(World.boardId('pack:neon-highway', 'touch4:hard'), 'pack-neon-highway__touch4-hard');
  assert.strictEqual(World.boardId('bonus:abc', 'hard'), 'bonus-abc__hard');
  const a = World.boardId('mp3:x1', 'hard', chart());
  const b = World.boardId('mp3:somebody-else', 'hard', chart(0.8));
  assert.strictEqual(a, b);
  assert.match(a, /^chart-[a-z0-9]+__hard$/);
});

test('charts pack small and come back the same', () => {
  const c = chart();
  const text = World.packChart(c);
  const back = World.unpackChart(text);
  assert.strictEqual(back.lanes, 4);
  assert.strictEqual(back.notes.length, c.notes.length);
  assert.strictEqual(World.chartHash(back), World.chartHash(c));
  assert.deepStrictEqual(back.notes[34].slide, c.notes[34].slide);
  assert.ok(text.length < c.notes.length * 20, 'about a dozen bytes a note');
});

test('alignment finds the offset between two copies of a song', () => {
  const their = chart();
  // My copy starts 3.27 s later and charts a little differently: some notes
  // missing, some in other lanes, some extra, all slightly jittered.
  const r = rng(99);
  const mine = { lanes: 4, notes: [] };
  their.notes.forEach((n, i) => {
    if (i % 9 === 0) return;
    mine.notes.push({ t: n.t + 3.27 + (r() - 0.5) * 0.008, lane: i % 7 === 0 ? (n.lane + 1) % 4 : n.lane });
  });
  for (let i = 0; i < 30; i++) mine.notes.push({ t: 2 + r() * 60, lane: Math.floor(r() * 4) });
  const fit = World.alignChart(their, mine);
  assert.ok(Math.abs(fit.shift - 3.27) < 0.006, `shift ${fit.shift}`);
  assert.ok(fit.good, `match ${fit.match}`);
  assert.ok(Math.abs(fit.chart.notes[0].t - (their.notes[0].t + 3.27)) < 0.006);
});

test('a different song does not align well', () => {
  const fit = World.alignChart(chart(), chart(0, 12345));
  assert.ok(!fit.good, `match ${fit.match}`);
});

test('submit keeps each player\'s best and reports the rank', async () => {
  const boards = new Map();
  const scores = new Map();
  globalThis.BeatFretsWorldBackend = {
    uid: 'dev1',
    async getBoard(id) { return boards.get(id) || null; },
    async createBoard(id, meta) { boards.set(id, meta); },
    async getScore(id, sid) { return scores.get(id + '/' + sid) || null; },
    async putScore(id, sid, e) { scores.set(id + '/' + sid, e); },
    async top(id, limit) {
      return [...scores].filter(([k]) => k.startsWith(id + '/')).map(([k, v]) => ({ id: k.split('/')[1], ...v }))
        .sort((a, b) => b.score - a.score).slice(0, limit);
    },
    async above(id, score) { return (await this.top(id, 1e9)).filter((r) => r.score > score).length; },
    async findBoards() { return []; },
  };
  try {
    assert.ok(World.available());
    const meta = { kind: 'pack', title: 'Neon', notes: 100 };
    scores.set('b1/other_p', { initials: 'ZZZ', score: 5000 });
    let pk = await World.peek({ id: 'b1', profileId: 'p1', score: 4000 });
    assert.deepStrictEqual(pk, { best: null, better: true, rank: 2 });
    assert.strictEqual(scores.size, 1, 'peeking posts nothing');
    let r = await World.submit({ id: 'b1', meta, profileId: 'p1', entry: { initials: 'AAA', score: 4000 } });
    assert.deepStrictEqual([r.rank, r.improved], [2, true]);
    assert.ok(boards.has('b1'));
    pk = await World.peek({ id: 'b1', profileId: 'p1', score: 3000 });
    assert.deepStrictEqual(pk, { best: 4000, better: false, rank: 2 });
    r = await World.submit({ id: 'b1', meta, profileId: 'p1', entry: { initials: 'AAA', score: 3000 } });
    assert.deepStrictEqual([r.rank, r.improved, r.best], [2, false, 4000]);
    r = await World.submit({ id: 'b1', meta, profileId: 'p1', entry: { initials: 'AAA', score: 6000 } });
    assert.deepStrictEqual([r.rank, r.improved], [1, true]);
    const rows = await World.top('b1');
    assert.deepStrictEqual(rows.map((x) => [x.initials, x.mine]), [['AAA', true], ['ZZZ', false]]);
  } finally {
    delete globalThis.BeatFretsWorldBackend;
  }
});
