// Unit tests for saves, leaderboards, share links and song matching. Run: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const SaveData = require('../js/save.js');
const BeatAnalyzer = require('../js/analyzer.js');
const { synthSong } = require('./synth.js');

class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

const run = (store, p, over = {}) => ({
  profileId: p.id, initials: p.initials, songKey: 'pack:x', title: 'X', difficulty: 'hard',
  score: 1000, grade: 'A', accuracy: 90, maxCombo: 50, fullCombo: false, hits: 100, failed: false, ...over,
});

test('profiles, runs and leaderboards persist and rank correctly', () => {
  const storage = new MemoryStorage();
  const s = new SaveData.Store(storage);
  const a = s.createProfile('jdt');
  const b = s.createProfile('ab!c');
  assert.strictEqual(a.initials, 'JDT');
  assert.strictEqual(b.initials, 'ABC');
  assert.strictEqual(s.active.id, b.id);
  s.addRun(run(s, a, { score: 5000 }));
  s.addRun(run(s, a, { score: 7000 }));
  const res = s.addRun(run(s, b, { score: 6000 }));
  assert.strictEqual(res.rank, 2);
  s.addRun(run(s, b, { score: 9999, failed: true }));
  const board = s.leaderboard('pack:x', 'hard');
  assert.deepStrictEqual(board.map((r) => [r.initials, r.score]), [['JDT', 7000], ['ABC', 6000]]);

  // Reloading from storage gives the same data.
  const again = new SaveData.Store(storage);
  assert.strictEqual(again.leaderboard('pack:x', 'hard')[0].score, 7000);
  assert.strictEqual(again.personalBest(a.id, 'pack:x', 'hard').score, 7000);
});

test('personal best is flagged only when beaten', () => {
  const s = new SaveData.Store(null);
  const p = s.createProfile('AAA');
  assert.ok(s.addRun(run(s, p, { score: 100 })).personalBest);
  assert.ok(!s.addRun(run(s, p, { score: 50 })).personalBest);
  assert.ok(s.addRun(run(s, p, { score: 150 })).personalBest);
});

test('no-fail practice runs never reach a leaderboard or a personal best', () => {
  const s = new SaveData.Store(null);
  const p = s.createProfile('AAA');
  s.addRun(run(s, p, { score: 500 }));
  s.addRun(run(s, p, { score: 9000, practice: true }));
  assert.deepStrictEqual(s.leaderboard('pack:x', 'hard').map((r) => r.score), [500]);
  assert.strictEqual(s.personalBest(p.id, 'pack:x', 'hard').score, 500);
});

test('share links round-trip and detect tampering', () => {
  const s = new SaveData.Store(null);
  const p = s.createProfile('ZED');
  const { entry } = s.addRun(run(s, p, { score: 12345, fullCombo: true }));
  const token = SaveData.encodeShare(entry);
  const back = SaveData.decodeShare(token);
  assert.strictEqual(back.verified, true);
  assert.strictEqual(back.initials, 'ZED');
  assert.strictEqual(back.score, 12345);
  assert.strictEqual(back.fullCombo, true);
  assert.strictEqual(back.difficulty, 'hard');

  const [payload, check] = token.split('.');
  const edited = Buffer.from(payload, 'base64url').toString().replace('12345', '99999');
  const forged = SaveData.decodeShare(Buffer.from(edited).toString('base64url') + '.' + check);
  assert.strictEqual(forged.score, 99999);
  assert.strictEqual(forged.verified, false);
  assert.strictEqual(SaveData.decodeShare('not-a-token'), null);
});

test('rival scores join the leaderboard once', () => {
  const s = new SaveData.Store(null);
  const p = s.createProfile('ME1');
  s.addRun(run(s, p, { score: 500 }));
  const shared = SaveData.decodeShare(SaveData.encodeShare({ ...run(s, { id: 'x', initials: 'BOB' }, { score: 800 }), date: '2026-10-16T00:00:00Z' }));
  s.addRival(shared);
  assert.ok(s.addRival(shared).duplicate);
  const board = s.leaderboard('pack:x', 'hard');
  assert.deepStrictEqual(board.map((r) => [r.initials, r.rival]), [['BOB', true], ['ME1', false]]);
});

test('the same song in different encodings is matched by sound', async () => {
  const loop = synthSong({ bpm: 126 });
  const a = await BeatAnalyzer.analyze([loop.samples], loop.sr);
  // A "different rip": quieter, with noise and 30 ms of extra encoder padding.
  const pad = Math.round(0.03 * loop.sr);
  const other = new Float32Array(loop.samples.length + pad);
  let seed = 3;
  for (let i = 0; i < loop.samples.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    other[i + pad] = loop.samples[i] * 0.7 + ((seed / 0x7fffffff) - 0.5) * 0.01;
  }
  const b = await BeatAnalyzer.analyze([other], loop.sr);
  const different = await BeatAnalyzer.analyze([synthSong({ bpm: 100 }).samples], loop.sr);
  const fa = SaveData.fingerprint(a);
  assert.ok(SaveData.similarity(fa, SaveData.fingerprint(b)) >= SaveData.MATCH_THRESHOLD);
  assert.strictEqual(SaveData.similarity(fa, SaveData.fingerprint(different)), 0);
  // Same tempo and length, different arrangement: must not match.
  const rearranged = await BeatAnalyzer.analyze([synthSong({ bpm: 126, sections: [['khs', 12], ['k', 6], ['khs', 8], ['h', 12]] }).samples], loop.sr);
  assert.ok(SaveData.similarity(fa, SaveData.fingerprint(rearranged)) < SaveData.MATCH_THRESHOLD);

  const s = new SaveData.Store(null);
  const first = s.registerSong('My Song', fa);
  const second = s.registerSong('my_song (1)', SaveData.fingerprint(b));
  assert.strictEqual(second.key, first.key);
  assert.ok(second.matched);
});

test('backups merge without duplicating', () => {
  const s1 = new SaveData.Store(null);
  const p = s1.createProfile('ONE');
  s1.addRun(run(s1, p));
  const json = s1.exportJSON();
  const s2 = new SaveData.Store(null);
  assert.deepStrictEqual(s2.importJSON(json), { profiles: 1, runs: 1, rivals: 0 });
  assert.deepStrictEqual(s2.importJSON(json), { profiles: 0, runs: 0, rivals: 0 });
  assert.throws(() => s2.importJSON('{"hello":1}'), /not a Beat Frets save/);
});

test('settings carry over from the first version', () => {
  const storage = new MemoryStorage();
  storage.setItem('beatfrets.speed', '1.4');
  storage.setItem('beatfrets.calibrationMs', '35');
  const s = new SaveData.Store(storage);
  assert.strictEqual(s.settings.speed, 1.4);
  assert.strictEqual(s.settings.calibrationMs, 35);
  assert.strictEqual(s.settings.crt, true);
});

test('scores that could not be posted wait on the device, the best per player per board', () => {
  const storage = new MemoryStorage();
  const s = new SaveData.Store(storage);
  const a = s.createProfile('AAA');
  const b = s.createProfile('BBB');
  const item = (profileId, board, score) => ({ board, meta: { title: 'Song', difficulty: 'hard', notes: 100 }, profileId, initials: 'AAA', entry: { initials: 'AAA', score, grade: 'A', accuracy: 90 } });
  assert.ok(s.queuePost(item(a.id, 'pack-x__hard', 5000)));
  assert.ok(!s.queuePost(item(a.id, 'pack-x__hard', 4000)), 'a lower score for the same board is not kept');
  assert.ok(s.queuePost(item(a.id, 'pack-x__hard', 6000)), 'a higher one replaces it');
  s.queuePost(item(a.id, 'pack-x__easy', 3000));
  s.queuePost(item(b.id, 'pack-x__hard', 2000));
  assert.deepStrictEqual(s.outbox.map((x) => [x.board, x.entry.score]), [['pack-x__hard', 6000], ['pack-x__easy', 3000], ['pack-x__hard', 2000]]);
  // Kept across restarts.
  const again = new SaveData.Store(storage);
  assert.strictEqual(again.outbox.length, 3);
  // Posted (or the world already has better): settled. A score above the world best stays.
  again.settlePost(a.id, 'pack-x__hard', 5500);
  assert.strictEqual(again.outbox.length, 3, '6000 is still better than the 5500 on the world board');
  again.settlePost(a.id, 'pack-x__hard', 6000);
  assert.deepStrictEqual(again.outbox.map((x) => x.board + ':' + x.profileId), ['pack-x__easy:' + a.id, 'pack-x__hard:' + b.id]);
  again.dropPost(again.outbox[0].id);
  again.deleteProfile(b.id);
  assert.strictEqual(again.outbox.length, 0, "a deleted player's waiting scores go with them");
});
