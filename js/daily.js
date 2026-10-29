/*
 * Song of the Day: one song-pack song and difficulty for everyone, changing at
 * midnight US Eastern time, with its own world board for each way of playing
 * (keys, sideways, upright, Tiles). The pick comes from the date alone, so every
 * device agrees without asking a server.
 *
 * Pure and runs in Node for tests.
 */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Daily = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ZONE = 'America/New_York';
  const DAY = 864e5;

  /** Today's date in US Eastern time, as 'YYYY-MM-DD'. */
  function today(now = Date.now()) {
    // en-CA formats dates as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  }

  /** Days since 1970-01-01 for a 'YYYY-MM-DD' date (calendar days, no time zone). */
  const dayNumber = (date) => Math.round(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY);
  const fromDayNumber = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const addDays = (date, n) => fromDayNumber(dayNumber(date) + n);
  /** 0 = Sunday … 6 = Saturday. */
  const weekday = (date) => new Date(dayNumber(date) * DAY).getUTCDay();

  // The week builds up: easy early on, harder toward the weekend, an ELITE song on Sunday.
  const RHYTHM = ['hard', 'easy', 'easy', 'medium', 'medium', 'hard', 'hard'];

  /** A fixed shuffle of a list (same order on every device), so songs don't repeat until all have come up. */
  function shuffled(list, seed) {
    const out = list.slice();
    let s = seed >>> 0;
    for (let i = out.length - 1; i > 0; i--) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      const j = s % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /**
   * The pick for a date: { date, songId, base } where base is the difficulty
   * ('easy' | 'medium' | 'hard'). `songs` is the song pack
   * (objects with id and tier). Weekdays cycle through the ROOKIE and PRO songs,
   * Sundays through the ELITE songs.
   */
  function pick(songs, date = today()) {
    const wd = weekday(date);
    const boss = wd === 0;
    const pool = songs.filter((s) => (boss ? s.tier === 'boss' : s.tier !== 'boss')).map((s) => s.id).sort();
    const n = dayNumber(date);
    const index = boss ? Math.floor(n / 7) : n - Math.floor((n + 4) / 7); // weeks for Sundays, other days counted
    const order = shuffled(pool, 20261027 + (boss ? 7 : 0));
    return { date, songId: order[((index % order.length) + order.length) % order.length], base: RHYTHM[wd] };
  }

  /** The daily difficulty for a way of playing. */
  function tierFor(base, family) {
    if (family === 'tiles') return 'tiles:' + base;
    if (family === 'keys') return base;
    return family + ':' + base; // touch4 / touch2
  }

  /**
   * The world board for a day, its song and a tier: 'daily-2026-10-27-witching-hour__touch4-hard'.
   * The song is in the id so an older copy of the game (which may pick another song after
   * new songs are added) never mixes its scores in.
   */
  const boardId = (date, tier, songId) => `daily-${date}${songId ? '-' + songId : ''}__${String(tier).replace(/[^a-z0-9]/gi, '-')}`;

  /**
   * The streak after playing on `date`: `prev` is { last, count } (or null).
   * Playing again the same day keeps it; the next day adds one; a gap starts over.
   */
  function nextStreak(prev, date) {
    if (prev && prev.last === date) return prev;
    if (prev && prev.last === addDays(date, -1)) return { last: date, count: prev.count + 1 };
    return { last: date, count: 1 };
  }
  /** The streak as of `date`: still alive if played today or yesterday. */
  const streakNow = (s, date = today()) => (s && (s.last === date || s.last === addDays(date, -1)) ? s.count : 0);

  return { today, pick, tierFor, boardId, nextStreak, streakNow, addDays, weekday, ZONE };
});
