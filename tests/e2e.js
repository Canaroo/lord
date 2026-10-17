// End-to-end test in headless Chromium (needs Playwright):
//   npm run e2e -- [path/to/song.mp3]
//   SONGS_DIR=dir/with/index.json npm run e2e     # also test bonus tracks from that folder
//
// Drives the whole game with a simulated Xbox controller: initials, menus,
// a full song played on controller buttons (with overdrive), saving the score,
// sharing it, a friend opening the challenge link in a separate browser, a
// deliberately failed song, Medium, Medium+ and Duo, long notes (hold,
// let go, re-grab), bonus tracks, and (optionally) importing an MP3.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Playwright not found. Install it with: npm i -D playwright'); process.exit(1); }

const mp3 = process.argv[2];
const outDir = process.env.SHOT_DIR || __dirname;
const ROOT = path.resolve(__dirname, '..');
const SONGS_DIR = process.env.SONGS_DIR ? path.resolve(process.env.SONGS_DIR) : path.join(ROOT, 'songs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png' };

// A tiny static server, so the page can fetch songs/ like it does on GitHub Pages.
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = rel.startsWith('songs/') ? path.join(SONGS_DIR, rel.slice(6)) : path.join(ROOT, rel);
    if (!file.startsWith(ROOT) && !file.startsWith(SONGS_DIR)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': data.length });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
let url;
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log((ok ? 'ok   ' : 'FAIL ') + msg); };

// A fake standard-mapping gamepad the page can't tell from a real one.
const FAKE_PAD = () => {
  const pad = {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
    index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  navigator.getGamepads = () => [pad];
  window.__pad = {
    set(i, down) { pad.buttons[i] = { pressed: down, touched: down, value: down ? 1 : 0 }; pad.timestamp = performance.now(); },
    async tap(i) { this.set(i, true); await new Promise((r) => setTimeout(r, 70)); this.set(i, false); await new Promise((r) => setTimeout(r, 70)); },
  };
};

async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 680 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()); });
  page.on('requestfailed', () => {});
  await page.addInitScript(FAKE_PAD);
  return { page, errors, context };
}

const tap = (page, button) => page.evaluate((b) => window.__pad.tap(b), button);
const screenIs = (page, name) => page.waitForFunction((n) => window.BeatFrets && BeatFrets.screen === n, name, { timeout: 30000 });

// Plays the current game with controller buttons, hitting every note on time.
const BOT = (laneButtons) => {
  const g = BeatFrets.game;
  let i = 0;
  let odDone = false;
  const loop = () => {
    if (!g.running) return;
    const t = g.now();
    while (i < g.notes.length && g.notes[i].t <= t) {
      const b = laneButtons[g.notes[i].lane];
      window.__pad.set(b, true);
      // Hold long notes to the end of their tail.
      setTimeout(() => window.__pad.set(b, false), Math.max(45, g.notes[i].len * 1000 + 30));
      i++;
    }
    if (!odDone && g.od >= 0.5) { odDone = true; window.__pad.tap(3); }
    requestAnimationFrame(loop);
  };
  loop();
};

(async () => {
  const server = await serve();
  url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const { page, errors } = await newPage(browser);
  await page.goto(url);
  await screenIs(page, 'title');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'e2e-title.png') });

  // Title → initials (keyboard) → main menu.
  await page.click('#btn-start');
  await screenIs(page, 'initials');
  await page.keyboard.type('jdt');
  await page.keyboard.press('Enter');
  await screenIs(page, 'main');
  check(await page.evaluate(() => BeatFrets.save.active.initials) === 'JDT', 'profile created from initials');

  // Controller takes over: A on "Song pack", A on the first song.
  await tap(page, 0);
  await screenIs(page, 'pack');
  check((await page.textContent('#hints')).includes('XBOX'), 'controller detected and hints switched');
  await tap(page, 0);
  await screenIs(page, 'song');
  check((await page.textContent('[data-keys="5"]')).replace(/\s/g, '') === 'LTLBARBRT', 'lane labels show controller buttons');
  await page.screenshot({ path: path.join(outDir, 'e2e-song.png') });

  // D-pad right twice (Easy → Medium → Medium+), then pick Hard, A to start.
  check(await page.evaluate(() => [...document.querySelectorAll('[data-diff]')].map((b) => b.dataset.diff).join()) === 'easy,medium,mediumplus,hard,duo', 'all five tiers offered');
  await tap(page, 15);
  check(await page.evaluate(() => document.activeElement.dataset.diff) === 'medium', 'D-pad reaches Medium');
  await tap(page, 15);
  check(await page.evaluate(() => document.activeElement.dataset.diff) === 'mediumplus', 'D-pad moves the menu cursor to Medium+');
  await page.focus('[data-diff="hard"]');
  await tap(page, 0);
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running);
  await page.evaluate(BOT, [6, 4, 0, 5, 7]);
  await page.waitForTimeout(16000);
  await page.screenshot({ path: path.join(outDir, 'e2e-play.png') });
  const mid = await page.evaluate(() => ({ counts: BeatFrets.game.counts, od: BeatFrets.game.odActive, rock: BeatFrets.game.rock, mult: BeatFrets.game.multiplier }));
  console.log('     mid-song', JSON.stringify(mid));
  const judged = mid.counts.perfect + mid.counts.good + mid.counts.ok + mid.counts.miss;
  check(judged > 30 && mid.counts.perfect / judged > 0.9, 'controller presses judged accurately');

  // Let the song finish.
  await page.waitForFunction(() => BeatFrets.screen === 'results', null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, 'e2e-results.png') });
  const res = await page.evaluate(() => ({
    grade: document.querySelector('#res-grade').textContent,
    board: BeatFrets.save.leaderboard('pack:pixel-overture', 'hard'),
  }));
  check(res.board.length === 1 && res.board[0].initials === 'JDT', 'score saved to the leaderboard');
  check(['S', 'A'].includes(res.grade), `grade for a perfect bot is high (got ${res.grade})`);
  const held = await page.evaluate(() => !document.querySelector('#res-hold-row').hidden && parseFloat(document.querySelector('#res-hold').textContent));
  check(held >= 95, `long notes held to the end are counted (${held}%)`);

  // Share.
  await page.click('#btn-share');
  await screenIs(page, 'share');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, 'e2e-share.png') });
  const link = await page.inputValue('#share-link');
  check(/#c=[\w-]+\.[a-z0-9]+$/.test(link), 'share link created');

  // A friend opens the link in their own browser.
  const friend = await newPage(browser);
  await friend.page.goto(url + link.slice(link.indexOf('#')));
  await screenIs(friend.page, 'challenge');
  check((await friend.page.textContent('#ch-head')).includes('JDT scored'), 'friend sees the challenge');
  await friend.page.click('#btn-ch-accept');
  const fb = await friend.page.evaluate(() => BeatFrets.save.leaderboard('pack:pixel-overture', 'hard'));
  check(fb.length === 1 && fb[0].rival && fb[0].initials === 'JDT', 'rival score added to friend\'s leaderboard');
  check(!friend.errors.length, 'no errors in friend page ' + friend.errors.join(' | '));
  await friend.context.close();

  // Fail a song on purpose: no input until the rock meter empties.
  await page.evaluate(() => BeatFrets.loadPack('castle-overdrive'));
  await screenIs(page, 'song');
  await page.evaluate(() => BeatFrets.play('hard'));
  await page.waitForFunction(() => BeatFrets.screen === 'results', null, { timeout: 60000 });
  await page.waitForTimeout(1800);
  check(await page.textContent('#res-grade') === 'F', 'song fails when the rock meter empties');
  check(await page.evaluate(() => BeatFrets.save.leaderboard('pack:castle-overdrive', 'hard').length) === 0, 'failed runs stay off the leaderboard');

  // Pause via controller Start, quit.
  await page.evaluate(() => BeatFrets.play('easy'));
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running);
  await page.waitForTimeout(500);
  await tap(page, 9);
  check(await page.isVisible('#pause'), 'Start pauses the game');
  await page.click('#btn-quit');
  await screenIs(page, 'song');

  // Medium: 4 lanes, keyboard bot for a few seconds.
  check((await page.textContent('[data-keys="4"]')).replace(/\s/g, '') === 'LBARBRT', 'Medium shows four controller lanes');
  await page.evaluate(() => BeatFrets.play('medium'));
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running);
  check(await page.evaluate(() => BeatFrets.game.lanes) === 4, 'Medium plays on four lanes');
  await page.keyboard.press('Escape');
  await page.click('#btn-quit');
  await screenIs(page, 'song');

  // Duo: two keys (LB/RB, or F/J), Hard-level density; play it on the keyboard.
  check((await page.textContent('[data-keys="2"]')).replace(/\s/g, '') === 'LBRB', 'Duo shows two controller lanes');
  await page.keyboard.press('ArrowDown'); // back to keyboard labels
  await page.evaluate(() => BeatFrets.play('duo'));
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running);
  await page.evaluate(() => {
    const g = BeatFrets.game;
    const keys = ['f', 'j'];
    let i = 0;
    const loop = () => {
      if (!g.running) return;
      const t = g.now();
      while (i < g.notes.length && g.notes[i].t <= t) {
        const key = keys[g.notes[i].lane];
        window.dispatchEvent(new KeyboardEvent('keydown', { key }));
        setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { key })), Math.max(40, g.notes[i].len * 1000 + 30));
        i++;
      }
      requestAnimationFrame(loop);
    };
    loop();
  });
  await page.waitForTimeout(12000);
  await page.screenshot({ path: path.join(outDir, 'e2e-duo.png') });
  const duo = await page.evaluate(() => ({ lanes: BeatFrets.game.lanes, counts: BeatFrets.game.counts, labels: Input.laneLabels(2).join('') }));
  console.log('     duo', JSON.stringify(duo));
  const dj = duo.counts.perfect + duo.counts.good + duo.counts.ok + duo.counts.miss;
  check(duo.lanes === 2 && duo.labels === 'FJ' && dj > 30 && duo.counts.perfect / dj > 0.9, 'Duo plays on F and J');
  await page.keyboard.press('Escape');
  await page.click('#btn-quit');
  await screenIs(page, 'song');

  // Long notes, exactly: one 2-second note. Hold it, let go (the rock meter drains
  // and no points), press again (points resume), and the streak survives.
  await page.evaluate(() => { BeatFrets.current.charts.medium = { difficulty: 'medium', lanes: 4, notes: [{ t: 1, lane: 0, len: 2 }] }; });
  await page.evaluate(() => BeatFrets.play('medium'));
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running);
  const hold = await page.evaluate(() => new Promise((resolve) => {
    const g = BeatFrets.game;
    const key = (type) => window.dispatchEvent(new KeyboardEvent(type, { key: 'a' }));
    const marks = {};
    const snap = () => ({ score: g.score, rock: g.rock, combo: g.combo });
    let stage = 0;
    const loop = () => {
      const t = g.now();
      if (stage === 0 && t >= 1.0) { key('keydown'); stage = 1; }
      if (stage === 1 && t >= 1.5) { marks.beforeRelease = snap(); key('keyup'); stage = 2; }
      if (stage === 2 && t >= 2.0) { marks.beforeRegrab = snap(); key('keydown'); stage = 3; }
      if (stage === 3 && t >= 2.8) { marks.afterRegrab = snap(); stage = 4; }
      if (stage === 4 && t >= 3.2) { key('keyup'); marks.end = snap(); marks.holdHeld = g.holdHeld; resolve(marks); return; }
      requestAnimationFrame(loop);
    };
    loop();
  }));
  console.log('     hold', JSON.stringify(hold));
  check(hold.beforeRelease.combo === 1 && hold.beforeRelease.score > 100, 'hitting a long note counts and holding scores');
  check(hold.beforeRegrab.rock < hold.beforeRelease.rock - 0.04 && Math.abs(hold.beforeRegrab.score - hold.beforeRelease.score) < 1, 'letting go drains the rock meter and stops points');
  check(hold.afterRegrab.score > hold.beforeRegrab.score + 30, 'pressing again picks the long note back up');
  check(hold.end.combo === 1, 'letting go of a long note does not break the streak');
  check(Math.abs(hold.holdHeld - 1.5) < 0.12, `held time is counted (${hold.holdHeld.toFixed(2)}s of 2s)`);
  await page.keyboard.press('Escape');
  await page.click('#btn-quit');
  await screenIs(page, 'song');

  // Bonus tracks from songs/ (pre-built charts, aligned to this browser's decode).
  const index = JSON.parse(fs.readFileSync(path.join(SONGS_DIR, 'index.json'), 'utf8'));
  if (index.songs.length) {
    const id = index.songs[0].id;
    await page.goto(url);
    await screenIs(page, 'title');
    await page.click('#btn-start');
    await screenIs(page, 'main');
    await page.click('[data-go="pack"]');
    await page.waitForSelector(`[data-bonus="${id}"]`);
    check(true, 'bonus tracks listed in the song pack');
    await page.click(`[data-bonus="${id}"]`);
    await screenIs(page, 'song');
    const bi = await page.evaluate(() => ({ key: BeatFrets.current.key, shift: BeatFrets.current.shift, note: BeatFrets.current.matchNote, n: BeatFrets.current.charts.medium.notes.length }));
    console.log('     bonus', JSON.stringify(bi));
    check(bi.key === 'bonus:' + id && bi.n > 0 && !bi.note, 'bonus track loads its pre-built chart');
    check(Math.abs(bi.shift) < 0.06, `chart aligned to this browser's audio (shift ${(bi.shift * 1000).toFixed(0)} ms)`);
  } else {
    console.log('     (no bonus tracks in songs/; set SONGS_DIR to test them)');
  }

  if (mp3) {
    await page.evaluate(() => { document.querySelector('[data-go="import"]').click(); });
    await page.setInputFiles('#file', mp3);
    await screenIs(page, 'song');
    const info = await page.evaluate(() => ({ key: BeatFrets.current.key, notes: BeatFrets.current.charts.hard.notes.length }));
    check(info.key.startsWith('mp3:') && info.notes > 10, `MP3 imported and charted (${info.notes} hard notes)`);
  }

  check(!errors.length, 'no page errors ' + errors.join(' | '));
  await browser.close();
  server.close();
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
  console.log('\nPASS');
})().catch((e) => { console.error(e); process.exit(1); });
