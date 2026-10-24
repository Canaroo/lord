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
    // Never post test scores to the real world boards: they're off unless a test supplies its own backend.
    if (rel === 'js/firebase-config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.BEAT_FRETS_FIREBASE = null;'); return; }
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

// ---- phones: touch input, 4 lanes sideways / 2 upright, PWA ----------------------------------------------------

const LAND = { width: 844, height: 390 };
const PORT = { width: 390, height: 844 };

// Finger presses on the canvas, aimed with the stage's own lane and button positions.
const TOUCH_BOT = () => {
  const g = window.__touchGame = BeatFrets.game, st = BeatFrets.stage, cv = document.getElementById('stage');
  let i = 0, pid = 100;
  const send = (type, lane, id) => {
    const c = st.laneCenterClient(g.lanes, lane);
    cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: false, clientX: c.x, clientY: c.y, bubbles: true }));
  };
  const loop = () => {
    if (!g.running || g !== BeatFrets.game) return;
    const t = g.now();
    while (i < g.notes.length && g.notes[i].t <= t) {
      const n = g.notes[i++], id = pid++;
      send('pointerdown', n.lane, id);
      if (n.slide) {
        // Follow the slide with the thumb.
        const follow = () => {
          if (!g.running || g.now() > n.t + n.len) { send('pointerup', ChartGen.slideLaneAt(n, n.t + n.len), id); return; }
          send('pointermove', ChartGen.slideLaneAt(n, g.now()), id);
          requestAnimationFrame(follow);
        };
        requestAnimationFrame(follow);
      } else setTimeout(() => send('pointerup', n.lane, id), Math.max(40, (n.len || 0) * 1000 + 30));
    }
    requestAnimationFrame(loop);
  };
  loop();
};
// A quick upward flick starting on a fret.
const touchSwipe = (page, lane) => page.evaluate(async (l) => {
  const g = BeatFrets.game, cv = document.getElementById('stage');
  const c = BeatFrets.stage.laneCenterClient(g.lanes, l);
  const ev = (type, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 950, pointerType: 'touch', clientX: c.x, clientY: y, bubbles: true }));
  ev('pointerdown', c.y);
  for (let k = 1; k <= 4; k++) { await new Promise((r) => setTimeout(r, 16)); ev('pointermove', c.y - k * 25); }
  ev('pointerup', c.y - 100);
}, lane);
const touchZone = (page, zone) => page.evaluate((z) => {
  const c = BeatFrets.stage.zoneCenterClient(z), cv = document.getElementById('stage');
  for (const type of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(type, { pointerId: 900, pointerType: 'touch', clientX: c.x, clientY: c.y, bubbles: true }));
}, zone);

async function touchTests(browser) {
  const context = await browser.newContext({ viewport: LAND, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  await screenIs(page, 'title');

  // Installable app: manifest, icons and an offline service worker.
  const pwa = await page.evaluate(async () => {
    const m = await (await fetch('manifest.webmanifest')).json();
    const icons = await Promise.all(m.icons.map((i) => fetch(i.src).then((r) => r.ok)));
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
    return { name: m.name, display: m.display, icons: icons.every(Boolean) && icons.length >= 2, sw: !!(reg && reg.active) };
  });
  check(pwa.name && pwa.display === 'fullscreen' && pwa.icons, 'web app manifest and icons load');
  check(pwa.sw, 'service worker installs for offline play');

  check(await page.evaluate(() => BeatFrets.Input.device.type === 'touch'), 'a phone starts on touch controls');
  check(await page.evaluate(() => BeatFrets.stage.layout === 'touch4'), 'sideways phone uses the 4-lane layout');

  await page.tap('#btn-start');
  await screenIs(page, 'initials');
  await page.keyboard.type('kid');
  await page.tap('#btn-initials-ok');
  await screenIs(page, 'main');

  // Top-level screens are tabs along the bottom; every screen below them has a back
  // button in the top bar; and the phone's own Back steps back one screen.
  for (const go of ['boards', 'players', 'options']) {
    await page.tap(`#tabbar [data-go="${go}"]`);
    await screenIs(page, go);
    check(await page.isVisible(`#tabbar [data-tab-btn="${go}"].on`) && !(await page.isVisible('#btn-back')), `${go} is a tab, lit in the tab bar`);
  }
  await page.tap('#screen-options [data-go="data"]');
  await screenIs(page, 'data');
  check(await page.isVisible('#btn-back') && !(await page.isVisible('#tabbar')), 'a screen below a tab has a back button instead of tabs');
  await page.tap('#btn-back');
  await screenIs(page, 'options');
  await page.tap('#tabbar [data-go="main"]');
  await screenIs(page, 'main');
  check(true, 'tabs and BACK buttons find their way home');
  await page.tap('#tabbar [data-go="options"]');
  await screenIs(page, 'options');
  await page.goBack();
  await screenIs(page, 'main');
  check(true, "the phone's Back button goes back one menu");
  await page.tap('#tabbar [data-go="boards"]');
  await screenIs(page, 'boards');
  await page.goBack();
  await screenIs(page, 'main');
  check(page.url().startsWith(url), "repeated phone Back stays in the game");
  // Home → BEAT FRETS → SIDEWAYS · 4 LANES → song list → a song.
  check(await page.isVisible('#btn-mode-frets') && await page.isVisible('#btn-mode-tiles'), 'home screen offers the two games');
  await page.tap('#btn-mode-frets');
  await screenIs(page, 'frets-setup');
  await page.tap('[data-orient="landscape"]');
  await screenIs(page, 'pack');
  const crumbs = await page.textContent('#crumbs-path');
  check(/BEAT FRETS · 4 LANES/.test(crumbs) && await page.isVisible('#btn-home'), `the top bar shows where you are (${crumbs})`);
  await page.tap('#screen-pack [data-songs="import"]');
  await screenIs(page, 'import');
  await page.tap('#screen-import [data-songs="pack"]');
  await screenIs(page, 'pack');
  check(true, 'Song pack / Your music tabs switch the song list');
  await page.tap('[data-pack="pixel-overture"]');
  await screenIs(page, 'song');
  const landIds = await page.evaluate(() => [...document.querySelectorAll('[data-diff]')].map((b) => b.dataset.diff));
  check(landIds.join() === 'touch4:easy,touch4:medium,touch4:mediumplus,touch4:hard', 'sideways: four touch tiers (' + landIds.join(' ') + ')');
  const charts = await page.evaluate(() => {
    const c = BeatFrets.current.charts;
    const lanesUsed = (id) => Math.max(...c[id].notes.map((n) => n.lane)) + 1;
    return { t4: lanesUsed('touch4:hard'), t2: lanesUsed('touch2:hard'), keys: lanesUsed('hard') };
  });
  check(charts.t4 === 4 && charts.t2 === 2 && charts.keys === 5, `touch charts use 4 and 2 lanes (${JSON.stringify(charts)})`);

  // The first touch game offers a quick timing check first.
  await page.tap('[data-diff="touch4:medium"]');
  // First, put the strike line where your thumbs rest: drag it on the stage.
  await screenIs(page, 'strike-setup');
  const before = await page.evaluate(() => BeatFrets.save.settings.strikeUp4);
  await page.evaluate(() => {
    const cv = document.getElementById('stage');
    const ev = (type, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: 'touch', clientX: innerWidth / 2, clientY: y, bubbles: true }));
    ev('pointerdown', innerHeight * 0.75);
    ev('pointermove', innerHeight * 0.65);
    ev('pointerup', innerHeight * 0.65);
  });
  const after = await page.evaluate(() => BeatFrets.save.settings.strikeUp4);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outDir, 'e2e-touch-strike.png') });
  check(before === 28 && after >= 33 && after <= 37, `dragging moves the strike line up (${before}% → ${after}%)`);
  await page.tap('#btn-strike-reset');
  check(await page.evaluate(() => BeatFrets.save.settings.strikeUp4 === 28), 'RESET puts the strike line back');
  await page.tap('#btn-strike-done');
  await screenIs(page, 'calib-offer');
  check(true, 'first touch game offers timing calibration');
  await page.tap('#btn-offer-play');
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running, null, { timeout: 30000 });
  const g1 = await page.evaluate(() => ({ lanes: BeatFrets.game.lanes, anti: BeatFrets.game.antiMash }));
  check(g1.lanes === 4 && !g1.anti, `touch game plays on 4 lanes (${JSON.stringify(g1)})`);

  await page.evaluate(TOUCH_BOT);
  await page.waitForTimeout(6000);
  // Overdrive: flick a thumb up off the frets.
  await page.evaluate(() => { const g = BeatFrets.game; g.od = Math.max(g.od, 0.6); g.odReadyAnnounced = false; });
  await page.waitForFunction(() => BeatFrets.game.odReadyAnnounced, null, { timeout: 5000 });
  await page.waitForTimeout(250);
  check(await page.evaluate(() => BeatFrets.game.banners.some((b) => b.text === 'SWIPE UP!')), 'a SWIPE UP banner shows on the highway when overdrive is ready');
  await page.screenshot({ path: path.join(outDir, 'e2e-touch-odready.png') });
  await touchSwipe(page, 1);
  check(await page.evaluate(() => BeatFrets.game.odActive), 'swiping up triggers overdrive');
  await page.screenshot({ path: path.join(outDir, 'e2e-touch-land.png') });
  await page.waitForFunction(() => BeatFrets.screen === 'results', null, { timeout: 120000 });
  const res1 = await page.evaluate(() => window.__touchGame.counts);
  check(res1.miss === 0 && res1.perfect > 50, `touch fingers hit every note (${JSON.stringify(res1)})`);
  const boards = await page.evaluate(() => ({
    touch: BeatFrets.save.leaderboard(BeatFrets.current.key, 'touch4:medium', 5).length,
    keys: BeatFrets.save.leaderboard(BeatFrets.current.key, 'medium', 5).length,
  }));
  check(boards.touch === 1 && boards.keys === 0, `touch scores go on their own leaderboard (${JSON.stringify(boards)})`);
  await page.tap('#btn-res-board');
  await screenIs(page, 'board');
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-board-family]')].map((b) => b.textContent).join('|'));
  check(/SIDEWAYS/.test(tabs) && /UPRIGHT/.test(tabs) && /KEYS/.test(tabs), `leaderboard has keys / sideways / upright filters (${tabs})`);

  // Upright: HOME → Beat Frets → UPRIGHT · 2 LANES. Chosen while the phone is
  // sideways, it asks to turn the phone until it is.
  await page.tap('#btn-home');
  await screenIs(page, 'main');
  await page.tap('#btn-mode-frets');
  await screenIs(page, 'frets-setup');
  await page.tap('[data-orient="portrait"]');
  await page.waitForTimeout(250);
  check(await page.isVisible('#rotate') && /UPRIGHT/.test(await page.textContent('#rotate-msg')), 'choosing upright while sideways shows "turn your phone"');
  await page.setViewportSize(PORT);
  await page.waitForTimeout(400);
  check(!(await page.isVisible('#rotate')) && await page.evaluate(() => BeatFrets.stage.layout === 'touch2'), 'turned upright: the prompt goes and the 2-lane layout is used');
  await screenIs(page, 'pack');
  await page.tap('[data-pack="pixel-overture"]');
  await screenIs(page, 'song');
  const portIds = await page.evaluate(() => [...document.querySelectorAll('[data-diff]')].map((b) => b.dataset.diff));
  check(portIds.length === 4 && portIds.every((d) => d.startsWith('touch2:')), 'upright: four 2-lane tiers');
  await page.tap('[data-diff="touch2:hard"]');
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running, null, { timeout: 30000 });
  check(await page.evaluate(() => BeatFrets.game.lanes === 2), 'upright game plays on 2 lanes');
  await page.evaluate(TOUCH_BOT);
  await page.waitForTimeout(10000);
  const res2 = await page.evaluate(() => BeatFrets.game.counts);
  check(res2.miss === 0 && res2.perfect > 10, `two thumbs hit every note (${JSON.stringify(res2)})`);
  await page.screenshot({ path: path.join(outDir, 'e2e-touch-port.png') });
  await page.evaluate(() => { const g = BeatFrets.game; g.od = Math.max(g.od, 0.6); g.odReadyAnnounced = false; });
  await page.waitForFunction(() => BeatFrets.game.odReadyAnnounced, null, { timeout: 5000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(outDir, 'e2e-touch-port-od.png') });

  // Turning the phone mid-song pauses until it's turned back.
  await page.setViewportSize(LAND);
  await page.waitForTimeout(500);
  const rot = await page.evaluate(() => ({ paused: BeatFrets.game.paused, msg: document.getElementById('pause-msg').textContent, resume: document.getElementById('btn-resume').disabled }));
  check(rot.paused && /upright/.test(rot.msg) && rot.resume && await page.isVisible('#rotate'), 'turning the phone mid-song pauses and asks to turn it back');
  await page.setViewportSize(PORT);
  await page.waitForTimeout(500);
  check(await page.evaluate(() => !document.getElementById('btn-resume').disabled && BeatFrets.stage.layout === 'touch2'), 'turning it back allows resuming');
  await page.tap('#btn-resume');
  await page.waitForFunction(() => !BeatFrets.game.paused, null, { timeout: 5000 });

  // The phone's Back button pauses mid-song.
  await page.waitForTimeout(2500);
  await page.goBack();
  await page.waitForTimeout(200);
  check(await page.evaluate(() => BeatFrets.game && BeatFrets.game.paused) && page.url().startsWith(url), "the phone's Back button pauses the song");
  await page.tap('#btn-resume');
  await page.waitForFunction(() => !BeatFrets.game.paused, null, { timeout: 5000 });

  // On-screen pause button.
  await page.waitForTimeout(3000);
  await touchZone(page, 'pause');
  await page.waitForTimeout(200);
  check(await page.evaluate(() => BeatFrets.game.paused) && await page.isVisible('#pause'), 'the on-screen II button pauses');

  // Long notes: the holding thumb can slide away (here: to the far corner) and keep
  // holding, and taps that land just inside the next lane still count (tap assist).
  await page.tap('#btn-quit').catch(() => {});
  await page.tap('#btn-home');
  await screenIs(page, 'main');
  await page.setViewportSize(LAND);
  await page.waitForTimeout(400);
  await page.tap('#btn-mode-frets');
  await page.tap('[data-orient="landscape"]');
  await screenIs(page, 'pack');
  await page.tap('[data-pack="pixel-overture"]');
  await screenIs(page, 'song');
  await page.tap('[data-diff="touch4:hard"]');
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running, null, { timeout: 30000 });
  await page.evaluate(() => {
    const g = window.__touchGame = BeatFrets.game, st = BeatFrets.stage, cv = document.getElementById('stage');
    window.__assisted = 0;
    let i = 0, pid = 2000;
    const send = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
    const lonely = (n) => !g.notes.some((m) => m !== n && Math.abs(m.t - n.t) < 0.3);
    const loop = () => {
      if (!g.running || g !== BeatFrets.game) return;
      const t = g.now();
      while (i < g.notes.length && g.notes[i].t <= t) {
        const n = g.notes[i++], id = pid++;
        const c = st.laneCenterClient(g.lanes, n.lane);
        let x = c.x;
        if (!n.len && n.lane > 0 && lonely(n)) {
          // Land 20% into the lane to the left, leaning toward the note's lane.
          const w = c.x - st.laneCenterClient(g.lanes, n.lane - 1).x;
          x = c.x - w * 0.7;
          window.__assisted++;
        }
        send('pointerdown', id, x, c.y);
        if (n.slide) {
          window.__slides = (window.__slides || 0) + 1;
          const startX = c.x;
          const follow = () => {
            const now = g.now();
            const p = st.laneCenterClient(g.lanes, ChartGen.slideLaneAt(n, Math.min(now, n.t + n.len)));
            // Staying put would not count once the slide has moved over.
            const k = (now - n.t) / n.len;
            if (k > 0.75 && k < 0.95 && n.slide.length === 4) {
              window.__stayWouldFail = Math.abs(st.lanePosAt(startX, p.y, g.lanes) - (ChartGen.slideLaneAt(n, now) + 0.5)) > 0.95;
            }
            if (!g.running || now > n.t + n.len) { send('pointerup', id, p.x, p.y); return; }
            send('pointermove', id, p.x, p.y);
            requestAnimationFrame(follow);
          };
          requestAnimationFrame(follow);
        } else if (n.len) {
          setTimeout(() => send('pointermove', id, 8, innerHeight - 8), 60);
          setTimeout(() => send('pointerup', id, 8, innerHeight - 8), n.len * 1000 + 40);
        } else setTimeout(() => send('pointerup', id, x, c.y), 40);
      }
      requestAnimationFrame(loop);
    };
    loop();
  });
  await page.waitForFunction(() => window.__touchGame.holds.length && BeatFrets.Input.touchPoints().some((f) => f.x < 20), null, { timeout: 20000 });
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(outDir, 'e2e-touch-grab.png') });
  await page.waitForFunction(() => window.__touchGame.holds.some((h) => h.slide && window.__touchGame.now() > h.t + h.len * 0.55), null, { timeout: 40000 });
  await page.screenshot({ path: path.join(outDir, 'e2e-touch-slide.png') });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, 'e2e-touch-hold.png') });
  const hold = await page.evaluate(() => {
    const g = window.__touchGame;
    const done = g.notes.filter((n) => n.judged);
    const now = g.now();
    const due = g.notes.filter((n) => n.len && n.judged).reduce((sum, n) => sum + Math.min(n.len, Math.max(0, now - n.t)), 0);
    return { counts: g.counts, held: +g.holdHeld.toFixed(2), due: +due.toFixed(2), started: g.holdsStarted, slides: g.slidesStarted || 0, stayWouldFail: window.__stayWouldFail, assisted: window.__assisted, judged: done.length };
  });
  check(hold.started > 0 && hold.counts.miss === 0 && hold.held > 0.85 * hold.due, `long notes keep holding while the thumb slides away (${JSON.stringify(hold)})`);
  check(hold.slides > 0 && hold.stayWouldFail === true, `slides are held by following them; staying put would drop them (${hold.slides} slides)`);
  check(hold.assisted > 3 && hold.counts.miss === 0, 'taps just inside the next lane count for its note (tap assist)');
  await touchZone(page, 'pause');
  await page.waitForTimeout(200);

  // ---- Tiles mode: upright board, tap the tiles, 3 lives, faster laps ----
  await page.tap('#btn-quit').catch(() => {});
  await page.tap('#btn-home');
  await screenIs(page, 'main');
  await page.setViewportSize(PORT);
  await page.waitForTimeout(400);
  await page.tap('#btn-mode-tiles');
  await screenIs(page, 'pack');
  check(/TILES/.test(await page.textContent('#crumbs-path')), 'Tiles mode goes straight to its song list');
  await page.tap('[data-pack="pixel-overture"]');
  await screenIs(page, 'song');
  const tilesIds = await page.evaluate(() => [...document.querySelectorAll('[data-diff]')].map((b) => b.dataset.diff).join(' '));
  check(tilesIds === 'tiles:easy tiles:medium tiles:hard', `song screen switches to Tiles tiers (${tilesIds})`);
  await page.tap('[data-diff="tiles:hard"]');
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running && BeatFrets.game instanceof TilesGame, null, { timeout: 30000 });
  // The song waits on a START tile until it's tapped.
  await page.waitForTimeout(600);
  const waiting = await page.evaluate(() => ({ waiting: BeatFrets.game.waiting, P: BeatFrets.game.now() }));
  await page.screenshot({ path: path.join(outDir, 'e2e-tiles-start.png') });
  // Drag the line higher on the START screen: it moves, and the song doesn't start.
  const lineDrag = await page.evaluate(() => {
    const cv = document.getElementById('stage'), r = cv.getBoundingClientRect();
    const ev = (type, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 4998, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height * y, bubbles: true }));
    const before = BeatFrets.save.settings.tilesLineUp;
    ev('pointerdown', 0.7); ev('pointermove', 0.62); ev('pointermove', 0.6); ev('pointerup', 0.6);
    return { before, after: BeatFrets.save.settings.tilesLineUp, waiting: BeatFrets.game.waiting };
  });
  check(lineDrag.before === 30 && lineDrag.after >= 38 && lineDrag.after <= 42 && lineDrag.waiting, `the Tiles line can be dragged higher before starting (${JSON.stringify(lineDrag)})`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, 'e2e-tiles-line.png') });
  await page.evaluate(() => {
    const cv = document.getElementById('stage'), r = cv.getBoundingClientRect();
    for (const type of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(type, { pointerId: 4999, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.7, bubbles: true }));
  });
  check(waiting.waiting && !(await page.evaluate(() => BeatFrets.game.waiting)), `Tiles waits for the START tile, then begins (${JSON.stringify(waiting)})`);
  check(await page.evaluate(() => BeatFrets.game.notes.some((n) => n.group) && BeatFrets.game.notes.some((n) => n.runLeft)), 'tiles that come together are linked, and quick runs are counted');
  // A thumb that taps each tile's column as it reaches the line.
  await page.evaluate(() => {
    const g = window.__tiles = BeatFrets.game, cv = document.getElementById('stage');
    let pid = 5000;
    const at = (lane) => { const r = cv.getBoundingClientRect(); return { x: r.left + r.width * (lane + 0.5) / 4, y: r.top + r.height * 0.85 }; };
    const send = (type, lane, id) => { const p = at(lane); cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: p.x, clientY: p.y, bubbles: true })); };
    window.__tilesBot = true;
    const loop = () => {
      if (!g.running || !window.__tilesBot) return;
      const P = g.now();
      for (const n of g.notes) {
        if (n.t > P) break;
        if (n.judged || n.botted) continue;
        n.botted = true;
        const id = pid++;
        send('pointerdown', n.lane, id);
        setTimeout(() => send('pointerup', n.lane, id), n.len ? (n.len / g.rate) * 1000 : 50);
      }
      requestAnimationFrame(loop);
    };
    loop();
  });
  await page.waitForFunction(() => { const g = window.__tiles, P = g.now(); return g.notes.some((n) => n.group && !n.judged && n.t - P < 0.35 && n.t - P > 0.15); }, null, { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: path.join(outDir, 'e2e-tiles-pair.png') });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(outDir, 'e2e-tiles.png') });
  const t1 = await page.evaluate(() => ({ counts: window.__tiles.counts, lives: window.__tiles.lives, score: window.__tiles.score }));
  check(t1.counts.perfect > 8 && t1.counts.miss === 0 && t1.counts.wrong === 0 && t1.lives === 2, `tapping tiles at the line scores (${JSON.stringify(t1)})`);
  // A long tile fills with colour while it's held.
  const filled = await page.waitForFunction(() => window.__tiles.holding.some((h) => h.heldTo > h.t + 0.15), null, { timeout: 20000 }).then(() => true, () => false);
  await page.screenshot({ path: path.join(outDir, 'e2e-tiles-hold.png') });
  check(filled, 'held long tiles fill up');
  // Jump to the end of the lap: the song loops, faster, and gives a heart back.
  await page.evaluate(() => {
    const g = window.__tiles;
    g.lives = 1;
    const jump = g.duration - 1.5 - g.now();
    g.notes.forEach((n) => { if (n.t < g.now() + jump + 0.6) n.judged = n.judged || 'cool'; });
    g.lapStartP += jump;
  });
  await page.waitForFunction(() => window.__tiles.lap === 1, null, { timeout: 8000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, 'e2e-tiles-lap.png') });
  const lap = await page.evaluate(() => ({ lap: window.__tiles.lap, rate: window.__tiles.rate, lives: window.__tiles.lives, prog: window.__tiles.progress() }));
  check(lap.rate >= 1.2 && lap.lives === 2 && lap.prog.stars === 3, `each lap is a lot faster and gives a heart back (${JSON.stringify(lap)})`);
  // Stop tapping: two slipped tiles end the run.
  await page.evaluate(() => { window.__tilesBot = false; });
  await screenIs(page, 'tiles-results');
  const tr = await page.evaluate(() => ({ score: document.getElementById('tr-score').textContent, run: BeatFrets.save.leaderboard(BeatFrets.current.key, 'tiles:hard', 5).length }));
  check(tr.run === 1 && tr.score !== '0', `losing all lives ends the run and saves the score (${JSON.stringify(tr)})`);
  check(await page.evaluate(() => window.__tiles.secondChanceUsed === true), 'losing the last heart gives one second chance before game over');
  await page.screenshot({ path: path.join(outDir, 'e2e-tiles-results.png') });
  await page.tap('#btn-tr-board');
  await screenIs(page, 'board');
  check(/TILES/.test(await page.textContent('#board-tabs')), 'Tiles scores have their own leaderboard tab');
  await page.goBack();
  await screenIs(page, 'tiles-results');
  await page.tap('#btn-back');
  await screenIs(page, 'song');

  // The keyboard takes over as soon as it's used.
  await page.keyboard.press('ArrowDown');
  check(await page.evaluate(() => BeatFrets.Input.device.type === 'keyboard'), 'using the keyboard switches to key controls');

  check(!errors.length, 'no page errors on the phone ' + errors.join(' | '));
  await context.close();
}

// ---- World boards: an in-page stand-in for Firebase, two copies of one song ----

const MEMORY_WORLD = () => {
  const boards = new Map();
  const scores = new Map();
  window.__world = { boards, scores };
  window.BeatFretsWorldBackend = {
    uid: 'devA',
    async getBoard(id) { return boards.get(id) || null; },
    async createBoard(id, meta) { boards.set(id, meta); },
    async getScore(id, sid) { return scores.get(id + '/' + sid) || null; },
    async putScore(id, sid, e) { scores.set(id + '/' + sid, e); },
    async top(id, limit) {
      return [...scores].filter(([k]) => k.startsWith(id + '/')).map(([k, v]) => ({ id: k.split('/')[1], ...v }))
        .sort((a, b) => b.score - a.score).slice(0, limit);
    },
    async above(id, score) { return (await this.top(id, 1e9)).filter((r) => r.score > score).length; },
    async findBoards(difficulty, keys) { return [...boards].filter(([, b]) => b.difficulty === difficulty && keys.includes(b.bpmKey)).map(([id, b]) => ({ id, ...b })); },
  };
};

function wavBase64(samples, sr) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 30000))), 44 + i * 2);
  return buf.toString('base64');
}

// Hits every note through the game's own input call.
const LANE_BOT = () => {
  const g = BeatFrets.game;
  let i = 0;
  const loop = () => {
    if (!g.running) return;
    const t = g.now();
    while (i < g.notes.length && g.notes[i].t <= t) {
      const n = g.notes[i++];
      if (window.__skipEvery && i % window.__skipEvery === 0) continue; // a less-than-perfect player
      g.lane(n.lane, true, performance.now());
      setTimeout(() => g.lane(n.lane, false, performance.now()), n.len ? n.len * 1000 + 20 : 60);
    }
    requestAnimationFrame(loop);
  };
  loop();
};

async function worldTests(browser) {
  const { synthSong } = require('./synth.js');
  const World = require('../js/world.js');
  const sections = [['k', 4], ['khs', 6], ['h', 3], ['khs', 5]];
  const song = synthSong({ bpm: 120, sr: 22050, sections });
  const pad = new Float32Array(Math.round(2.3 * 22050) + song.samples.length);
  pad.set(song.samples, Math.round(2.3 * 22050));
  const copyA = wavBase64(song.samples, 22050);
  const copyB = wavBase64(pad, 22050); // the same song, another rip: 2.3 s of silence first

  const { page, errors, context } = await newPage(browser);
  await page.addInitScript(MEMORY_WORLD);
  await page.goto(url);
  await screenIs(page, 'title');
  await page.click('#btn-start');
  await screenIs(page, 'initials');
  await page.keyboard.type('aaa');
  await page.keyboard.press('Enter');
  await screenIs(page, 'main');
  const importCopy = (b64, name) => page.evaluate(async ([b, n]) => {
    const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    await BeatFrets.importFile(new File([bytes], n + '.wav', { type: 'audio/wav' }));
  }, [b64, name]);

  // Player A: their copy, a perfect run, first on the world board.
  await importCopy(copyA, 'Drum Song');
  await screenIs(page, 'song');
  const idA = await page.evaluate(() => World.boardId(BeatFrets.current.key, 'medium', BeatFrets.current.charts.medium));
  await page.evaluate(() => BeatFrets.play('medium', {}));
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running);
  await page.evaluate(() => { window.__skipEvery = 6; });
  await page.evaluate(LANE_BOT);
  await page.waitForFunction(() => BeatFrets.screen === 'results', null, { timeout: 60000 });
  // Nothing is posted until the player chooses to.
  await page.waitForSelector('#res-post', { state: 'visible', timeout: 5000 }).catch(() => {});
  check(/would rank #1/.test(await page.textContent('#res-world')) && await page.evaluate(() => window.__world.scores.size === 0),
    `results ask before posting, and say where the run would rank ("${await page.textContent('#res-world')}")`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'e2e-results-ask.png') });
  await page.click('#res-post');
  await page.waitForFunction(() => /WORLD RANK #1/.test(document.querySelector('#res-world').textContent), null, { timeout: 5000 }).catch(() => {});
  check(/POSTED! WORLD RANK #1/.test(await page.textContent('#res-world')) && !(await page.isVisible('#res-post')), 'POST TO WORLD posts the score (rank #1)');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'e2e-results-new.png') });
  const boardA = await page.evaluate((id) => window.__world.boards.get(id), idA);
  check(boardA && boardA.kind === 'mp3' && typeof boardA.chart === 'string' && boardA.notes > 10, 'imported song\'s world board keeps its chart');

  // Player B (another device) has a rip with extra silence at the start. It charts a
  // little differently, so it gets its own board, and A's shows up as another version.
  await page.evaluate(() => { BeatFrets.save.createProfile('BBB'); window.BeatFretsWorldBackend.uid = 'devB'; });
  await importCopy(copyB, 'drum song (my rip)');
  await screenIs(page, 'song');
  const idB = await page.evaluate(() => World.boardId(BeatFrets.current.key, 'medium', BeatFrets.current.charts.medium));
  console.log('     world boards', idA, idB);
  await page.evaluate(() => BeatFrets.openBoard(BeatFrets.current.key, BeatFrets.current.title, 'medium', 'song'));
  await screenIs(page, 'board');
  await page.click('[data-board-scope="world"]');
  if (idA !== idB) {
    await page.waitForSelector('[data-version]', { timeout: 5000 });
    check((await page.textContent('#board-versions')).includes('DRUM SONG'), 'world board offers the other version of the song');
    await page.click('[data-version]');
  }
  await page.waitForSelector('[data-challenge="0"]', { timeout: 5000 });
  check((await page.textContent('#board-table')).includes('AAA') && /LEADER/.test(await page.textContent('#board-table .score-row')), 'world board lists player A, wearing the leader\'s crown');
  await page.screenshot({ path: path.join(outDir, 'e2e-world.png') });

  // B presses CHALLENGE on A's score: the versus pop-up, then FIGHT! plays A's exact notes, lined up to B's copy.
  await page.click('[data-challenge="0"]');
  await page.waitForSelector('#vs', { state: 'visible', timeout: 3000 });
  const vsText = await page.textContent('#vs');
  check(/NEW CHALLENGER/.test(vsText) && /BBB/.test(vsText) && /AAA/.test(vsText) && /take #1/.test(vsText), 'CHALLENGE opens the versus pop-up: you, them, and the score to beat');
  await page.waitForFunction(() => !document.querySelector('#btn-vs-fight').disabled, null, { timeout: 10000 });
  await page.screenshot({ path: path.join(outDir, 'e2e-versus.png') });
  await page.evaluate(() => { window.__skipEvery = 0; });
  await page.click('#btn-vs-fight');
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running, null, { timeout: 10000 });
  check(await page.evaluate(() => !!BeatFrets.game.rival && BeatFrets.game.rival.timeline && BeatFrets.game.rival.timeline.length > 3), 'the race uses A\'s saved score-over-time');
  const theirFirst = World.unpackChart(boardA.chart).notes[0].t;
  const ch = await page.evaluate(() => ({ first: BeatFrets.game.notes[0].t, n: BeatFrets.game.notes.length }));
  check(Math.abs(ch.first - (theirFirst + 2.3)) < 0.02 && ch.n === boardA.notes, `challenge plays their notes, moved onto this copy (${theirFirst.toFixed(3)} → ${ch.first.toFixed(3)})`);
  // The pause pop-up: dimmed game behind, a close button that resumes.
  await page.evaluate(() => BeatFrets.game.pause());
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, 'e2e-pause.png') });
  await page.click('#btn-pause-close');
  check(await page.evaluate(() => !BeatFrets.game.paused) && !(await page.isVisible('#pause')), 'the pause pop-up\'s close button resumes');
  await page.evaluate(LANE_BOT);
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.now() > 12, null, { timeout: 30000 });
  const race = await page.evaluate(() => BeatFrets.game._view(BeatFrets.game.now()).hud.race);
  await page.screenshot({ path: path.join(outDir, 'e2e-race.png') });
  check(race && race.name === 'AAA' && race.gap > 0 && race.youLead && !race.estimate, `the race shows you ahead of AAA, live (${JSON.stringify(race)})`);
  await page.waitForFunction(() => BeatFrets.screen === 'results', null, { timeout: 60000 });
  await page.waitForSelector('#outcome', { state: 'visible', timeout: 5000 });
  await page.waitForSelector('#oc-post', { state: 'visible', timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: path.join(outDir, 'e2e-victory.png') });
  check(/YOU BEAT AAA!/.test(await page.textContent('#oc-title')) && /take #1/.test(await page.textContent('#oc-world')), 'beating the challenger: the victory pop-up offers to post');
  await page.click('#oc-post');
  await page.waitForFunction(() => /CROWN IS YOURS/.test(document.querySelector('#oc-world').textContent), null, { timeout: 5000 }).catch(() => {});
  check(/CROWN IS YOURS/.test(await page.textContent('#oc-world')), 'posting the win takes the crown');
  await page.click('#oc-board');
  await screenIs(page, 'board');
  await page.waitForSelector('.score-row .beat-tag', { timeout: 5000 }).catch(() => {});
  const top = await page.evaluate(() => document.querySelector('#board-table .score-row').textContent.replace(/\s+/g, ' '));
  check(/BBB/.test(top) && /BEAT AAA/.test(top) && /LEADER/.test(top), `the board shows the new leader, with a BEAT AAA badge (${top.trim()})`);
  const rows = await page.evaluate((id) => [...window.__world.scores].filter(([k]) => k.startsWith(id + '/')).length, idA);
  check(rows === 2, 'challenge score lands on the same world board');

  // Tiles has world boards too. With auto-posting on (Options), a new best posts itself.
  await page.evaluate(() => BeatFrets.save.setSetting('autoPost', true));
  await page.evaluate(() => { BeatFrets.session.mode = 'tiles'; BeatFrets.play('tiles:easy', {}); });
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running && BeatFrets.game.waiting, null, { timeout: 15000 });
  await page.evaluate(() => { BeatFrets.game.lane(0, true, performance.now()); BeatFrets.game.lane(0, false, performance.now()); });
  await page.waitForFunction(() => BeatFrets.screen === 'tiles-results', null, { timeout: 60000 });
  await page.waitForFunction(() => /POSTED/.test(document.querySelector('#tr-world').textContent), null, { timeout: 5000 }).catch(() => {});
  const tw = await page.evaluate(() => {
    const b = [...window.__world.boards].find(([id]) => id.endsWith('__tiles-easy'));
    const sc = b && [...window.__world.scores].find(([k]) => k.startsWith(b[0] + '/'));
    return { text: document.querySelector('#tr-world').textContent, diff: b && b[1].difficulty, laps: sc && sc[1].laps };
  });
  check(/POSTED! WORLD RANK #1/.test(tw.text) && tw.diff === 'tiles:easy' && tw.laps === 0, `Tiles posts to its own world board (${JSON.stringify(tw)})`);
  check(!errors.length, 'no errors on world boards ' + errors.join(' | '));
  await context.close();
}

(async () => {
  const server = await serve();
  url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  if (process.env.E2E_ONLY === 'world') {
    await worldTests(browser);
    await browser.close();
    server.close();
    if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
    console.log('\nPASS');
    return;
  }
  if (process.env.E2E_ONLY === 'touch') {
    await touchTests(browser);
    await browser.close();
    server.close();
    if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
    console.log('\nPASS');
    return;
  }
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
  // Enter during the score count-up skips it (and doesn't press PLAY AGAIN).
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  const skipped = await page.evaluate(() => ({ screen: BeatFrets.screen, shown: document.querySelector('#res-score').textContent, grade: document.querySelector('#res-grade').textContent }));
  check(skipped.screen === 'results' && skipped.grade !== '', 'Enter skips the results count-up');
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
  const extras = await page.evaluate(() => {
    const c = document.querySelector('#res-graph');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 200) lit++;
    return { stars: document.querySelectorAll('#res-stars b').length && document.querySelector('#res-stars b').textContent.length, next: document.querySelector('#res-next').textContent, lit, timing: document.querySelector('#res-timing').textContent };
  });
  console.log('     results', JSON.stringify(extras));
  check(extras.stars === 5, 'a perfect run earns 5 stars');
  check(extras.lit > 200, 'results graph is drawn');
  check(/right on|ms/.test(extras.timing), 'results show average timing');

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

  // Pace against your best: replay Pixel Overture on Hard; the HUD compares.
  await page.evaluate(() => BeatFrets.loadPack('pixel-overture'));
  await screenIs(page, 'song');
  await page.evaluate(() => BeatFrets.play('hard'));
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running);
  await page.evaluate(BOT, [6, 4, 0, 5, 7]);
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.now() > 4.5, null, { timeout: 20000 });
  const pace = await page.evaluate(() => BeatFrets.game._view(BeatFrets.game.now()).hud.pace);
  check(typeof pace === 'number', `pace against your best shows while playing (${pace})`);

  // Anti-mash: on Hard, a press with no note nearby breaks the streak.
  const stray = await page.evaluate(async () => {
    const g = BeatFrets.game;
    for (let k = 0; k < 400; k++) {
      const t = g.now();
      if (!g.notes.some((n) => n.lane === 2 && Math.abs(n.t - t) < 0.35)) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    window.__pad.set(0, true); // lane 2 (A), the quietest lane in this chart
    await new Promise((r) => setTimeout(r, 40));
    window.__pad.set(0, false);
    await new Promise((r) => setTimeout(r, 30));
    return { overhits: g.overhits, kind: g.judgement && g.judgement.kind };
  });
  check(stray.overhits === 1 && stray.kind === 'over', 'a stray press on Hard breaks the streak');

  // Pause, then resume: the song rewinds a second and counts back in.
  const resume = await page.evaluate(async () => {
    const g = BeatFrets.game;
    g.pause();
    const pausedT = g.now();
    await new Promise((r) => setTimeout(r, 300));
    const frozen = Math.abs(g.now() - pausedT) < 1e-6;
    g.resume();
    await new Promise((r) => setTimeout(r, 120));
    const view = g._view(g.now());
    return { frozen, rewound: pausedT - g.now(), countdown: view.countdown };
  });
  check(resume.frozen, 'the song stops while paused');
  check(resume.rewound > 1 && resume.rewound < 4 && resume.countdown === null, `resuming rewinds and counts back in (${resume.rewound.toFixed(2)}s back)`);
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => BeatFrets.game._view(BeatFrets.game.now()).countdown) !== null, 'the resume count-in shows 3-2-1');

  // Hold R for a second to restart instantly.
  const before = await page.evaluate(() => { window.__g = BeatFrets.game; return BeatFrets.game.now(); });
  await page.keyboard.down('r');
  await page.waitForTimeout(500);
  check(await page.evaluate(() => BeatFrets.game === window.__g && BeatFrets.game.restartProgress > 0.3), 'holding R shows the restart ring');
  await page.waitForTimeout(800);
  await page.keyboard.up('r');
  const restarted = await page.evaluate(() => BeatFrets.game !== window.__g && BeatFrets.game.now() < 0);
  check(restarted && before > 0, 'holding R for a second restarts the song');
  await page.keyboard.press('Escape');
  await page.click('#btn-quit');
  await screenIs(page, 'song');

  // Easy stays forgiving: stray presses don't count.
  await page.evaluate(() => BeatFrets.play('easy'));
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running && BeatFrets.game.now() > 0.2, null, { timeout: 20000 });
  await page.evaluate(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })); await new Promise((r) => setTimeout(r, 40)); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' })); });
  check(await page.evaluate(() => BeatFrets.game.overhits === 0), 'stray presses are ignored on Easy');
  await page.keyboard.press('Escape');
  await page.click('#btn-quit');
  await screenIs(page, 'song');

  // The Overhit penalty option: turned off, stray presses are ignored even on Hard.
  await page.evaluate(() => { document.querySelector('[data-go="options"]').click(); });
  await screenIs(page, 'options');
  check((await page.textContent('#opt-overhit span')) === 'ON', 'Overhit penalty is on by default');
  await page.click('#opt-overhit');
  check((await page.textContent('#opt-overhit span')) === 'OFF', 'Overhit penalty can be switched off');
  await page.evaluate(() => BeatFrets.loadPack('pixel-overture'));
  await screenIs(page, 'song');
  await page.evaluate(() => BeatFrets.play('hard'));
  await page.waitForFunction(() => BeatFrets.game && BeatFrets.game.running && BeatFrets.game.now() > 0.2, null, { timeout: 20000 });
  await page.evaluate(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' })); await new Promise((r) => setTimeout(r, 40)); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' })); });
  check(await page.evaluate(() => BeatFrets.game.overhits === 0), 'with the option off, stray presses are ignored on Hard');
  await page.keyboard.press('Escape');
  await page.click('#btn-quit');
  await screenIs(page, 'song');
  await page.evaluate(() => BeatFrets.save.setSetting('overhit', true));

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
    await page.evaluate(() => { document.querySelector('[data-songs="import"]').click(); });
    await page.setInputFiles('#file', mp3);
    await screenIs(page, 'song');
    const info = await page.evaluate(() => ({ key: BeatFrets.current.key, notes: BeatFrets.current.charts.hard.notes.length }));
    check(info.key.startsWith('mp3:') && info.notes > 10, `MP3 imported and charted (${info.notes} hard notes)`);
    // It's saved in the browser: the Your Music screen lists it, one click to play.
    await page.click('#btn-back');
    await screenIs(page, 'import');
    await page.waitForSelector('[data-saved]', { timeout: 5000 });
    check((await page.textContent('#recent-list')).includes('TEST LOOP'), 'imported song is saved for next time');
    await page.click('[data-saved]');
    await screenIs(page, 'song');
    check(await page.evaluate((k) => BeatFrets.current.key === k, info.key), 'a saved song opens with one click');
  }

  check(!errors.length, 'no page errors ' + errors.join(' | '));

  await touchTests(browser);
  await worldTests(browser);

  await browser.close();
  server.close();
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
  console.log('\nPASS');
})().catch((e) => { console.error(e); process.exit(1); });
