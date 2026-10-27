// Song of the Day: the same pick on every device, a weekly difficulty rhythm, streaks. Run: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Daily = require('../js/daily.js');
const SongPack = require('../js/songs.js');

test('the day changes at midnight US Eastern time', () => {
  // 03:59 UTC on Oct 27 is still 23:59 on Oct 26 in New York (EDT, UTC-4).
  assert.strictEqual(Daily.today(Date.UTC(2026, 9, 27, 3, 59)), '2026-10-26');
  assert.strictEqual(Daily.today(Date.UTC(2026, 9, 27, 4, 1)), '2026-10-27');
  // In winter (EST, UTC-5) midnight is 05:00 UTC.
  assert.strictEqual(Daily.today(Date.UTC(2026, 11, 15, 4, 59)), '2026-12-14');
  assert.strictEqual(Daily.today(Date.UTC(2026, 11, 15, 5, 1)), '2026-12-15');
});

test('a weekly rhythm: easy early in the week, a BOSS song on Medium+ on Sunday', () => {
  const week = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];
  const picks = week.map((d) => Daily.pick(SongPack.SONGS, d));
  assert.deepStrictEqual(picks.map((p) => p.base), ['mediumplus', 'easy', 'easy', 'medium', 'medium', 'hard', 'hard']);
  const tier = (id) => SongPack.SONGS.find((s) => s.id === id).tier;
  assert.strictEqual(tier(picks[0].songId), 'boss');
  for (const p of picks.slice(1)) assert.notStrictEqual(tier(p.songId), 'boss');
});

test('the same date always gives the same song, and songs come round before repeating', () => {
  assert.deepStrictEqual(Daily.pick(SongPack.SONGS, '2026-11-03'), Daily.pick(SongPack.SONGS, '2026-11-03'));
  const weekdaySongs = SongPack.SONGS.filter((s) => s.tier !== 'boss').length;
  const seen = [];
  for (let d = '2026-11-02'; seen.length < weekdaySongs; d = Daily.addDays(d, 1)) {
    if (Daily.weekday(d) !== 0) seen.push(Daily.pick(SongPack.SONGS, d).songId);
  }
  assert.strictEqual(new Set(seen).size, weekdaySongs, 'every ROOKIE and PRO song comes up once before any repeats');
});

test('each way of playing has its own daily board', () => {
  assert.strictEqual(Daily.tierFor('hard', 'touch4'), 'touch4:hard');
  assert.strictEqual(Daily.tierFor('mediumplus', 'tiles'), 'tiles:hard');
  assert.strictEqual(Daily.tierFor('easy', 'keys'), 'easy');
  assert.strictEqual(Daily.boardId('2026-10-27', 'touch4:hard', 'witching-hour'), 'daily-2026-10-27-witching-hour__touch4-hard');
});

test('streaks: the next day adds one, a missed day starts over', () => {
  let s = Daily.nextStreak(null, '2026-10-26');
  assert.deepStrictEqual(s, { last: '2026-10-26', count: 1 });
  s = Daily.nextStreak(s, '2026-10-26');
  assert.strictEqual(s.count, 1, 'playing twice in a day counts once');
  s = Daily.nextStreak(s, '2026-10-27');
  assert.strictEqual(s.count, 2);
  assert.strictEqual(Daily.streakNow(s, '2026-10-28'), 2, 'still alive the next day');
  assert.strictEqual(Daily.streakNow(s, '2026-10-29'), 0, 'gone after a missed day');
  assert.strictEqual(Daily.nextStreak(s, '2026-10-30').count, 1);
});
