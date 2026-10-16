// End-to-end test in headless Chromium (needs Playwright):
//   npm run e2e -- [path/to/song.mp3]
//
// Drives the whole game with a simulated Xbox controller: initials, menus,
// a full song played on controller buttons (with overdrive), saving the score,
// sharing it, a friend opening the challenge link in a separate browser, a
// deliberately failed song, and (optionally) importing an MP3.
'use strict';
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Playwright not found. Install it with: npm i -D playwright'); process.exit(1); }

const mp3 = process.argv[2];
const outDir = process.env.SHOT_DIR || __dirname;
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
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
      setTimeout(() => window.__pad.set(b, false), 45);
      i++;
    }
    if (!odDone && g.od >= 0.5) { odDone = true; window.__pad.tap(3); }
    requestAnimationFrame(loop);
  };
  loop();
};

(async () => {
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

  // D-pad right to Hard, A to start.
  await tap(page, 15);
  check(await page.evaluate(() => document.activeElement.dataset.diff) === 'hard', 'D-pad moves the menu cursor');
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

  if (mp3) {
    await page.setInputFiles('#file', mp3);
    await screenIs(page, 'song');
    const info = await page.evaluate(() => ({ key: BeatFrets.current.key, notes: BeatFrets.current.charts.hard.notes.length }));
    check(info.key.startsWith('mp3:') && info.notes > 10, `MP3 imported and charted (${info.notes} hard notes)`);
  }

  check(!errors.length, 'no page errors ' + errors.join(' | '));
  await browser.close();
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
  console.log('\nPASS');
})().catch((e) => { console.error(e); process.exit(1); });
