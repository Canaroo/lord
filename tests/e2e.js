// End-to-end smoke test in headless Chromium (needs Playwright):
//   node tests/e2e.js [path/to/song.mp3]
// Loads the page, imports a song (or the demo), lets a bot play Hard mode,
// and checks the bot's hits are judged accurately. Saves a screenshot.
'use strict';
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Playwright not found. Install it with: npm i -D playwright'); process.exit(1); }

const mp3 = process.argv[2];
const shot = process.env.SCREENSHOT || path.join(__dirname, 'e2e-screenshot.png');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));

  if (mp3) await page.setInputFiles('#file', mp3);
  else await page.click('#btn-demo');
  await page.waitForSelector('#screen-song.active', { timeout: 60000 });
  const info = await page.evaluate(() => ({
    name: BeatFrets.song.name,
    bpm: BeatFrets.song.analysis.bpm,
    easy: BeatFrets.song.charts.easy.notes.length,
    hard: BeatFrets.song.charts.hard.notes.length,
    maxLaneEasy: Math.max(...BeatFrets.song.charts.easy.notes.map((n) => n.lane)),
  }));
  console.log('loaded', info);
  await page.screenshot({ path: shot.replace(/\.png$/, '-song.png') });

  await page.click('[data-diff="hard"]');
  // Bot: press each note's key right on time for ~8 seconds of play.
  await page.evaluate(() => {
    const keys = ['a', 's', 'd', 'f', 'g'];
    const game = BeatFrets.game;
    let i = 0;
    const loop = () => {
      if (!game.running) return;
      const t = game.now();
      while (i < game.notes.length && game.notes[i].t <= t) {
        const key = keys[game.notes[i].lane];
        window.dispatchEvent(new KeyboardEvent('keydown', { key }));
        setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { key })), 60);
        i++;
      }
      requestAnimationFrame(loop);
    };
    loop();
  });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: shot });
  const stats = await page.evaluate(() => {
    const g = BeatFrets.game;
    return { t: g.now(), score: g.score, combo: g.combo, counts: g.counts };
  });
  console.log('after 9s of hard mode', stats);

  // Pause & quit flow.
  await page.keyboard.press('Escape');
  const paused = await page.isVisible('#pause');
  await page.click('#btn-quit');
  const backOnSong = await page.isVisible('#screen-song.active');
  await browser.close();

  const judged = stats.counts.perfect + stats.counts.good + stats.counts.ok + stats.counts.miss;
  const failures = [];
  if (errors.length) failures.push('page errors: ' + errors.join(' | '));
  if (info.maxLaneEasy > 2) failures.push('easy chart uses more than 3 lanes');
  if (judged < 5) failures.push('too few notes judged');
  if (stats.counts.perfect < judged * 0.8) failures.push('bot was not judged accurately');
  if (!paused) failures.push('pause overlay did not show');
  if (!backOnSong) failures.push('quit did not return to song screen');
  if (failures.length) { console.error('FAIL\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('PASS');
})();
