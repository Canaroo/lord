/*
 * main — screens and flow: title → main menu → song → play → results → share,
 * plus leaderboards, players, options, save data and incoming challenges.
 * Every menu works with mouse, keyboard or gamepad.
 */
'use strict';
(function () {
  // The version shown on the title screen and in Options. Bump it with every
  // update you publish (and the cache name in sw.js) so you can tell which one
  // a phone is running.
  const VERSION = '1.54';
  // A page and code from different versions (an update half-loaded on a slow
  // connection) can break in odd ways, so reload once to get a matching set.
  if (document.documentElement.dataset.v && document.documentElement.dataset.v !== VERSION) {
    let tried = false;
    try { tried = sessionStorage.getItem('bf-reload') === VERSION; sessionStorage.setItem('bf-reload', VERSION); } catch (e) { tried = true; }
    if (!tried) { location.reload(); return; }
  }
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const fmtDate = (iso) => (iso ? iso.slice(0, 10) : '');
  const DIFFS = Object.keys(ChartGen.DIFFICULTIES); // easy, medium, hard, insane
  /** 'hard', 'touch4:hard', 'touch2:hard', or a Tiles mode tier 'tiles:hard'. */
  const parseId = (id) => {
    const m = /^tiles:(\w+)$/.exec(id);
    return m ? { difficulty: m[1], lanes: 4, touch: false, tiles: true } : ChartGen.parseId(id);
  };
  const TILES_IDS = ['tiles:easy', 'tiles:medium', 'tiles:hard', 'tiles:insane'];
  /** The chart a tier plays: Tiles mode uses the 4-lane phone chart. */
  // A boss battle plays the Hard chart of its way of playing: 'touch4:boss' → 'touch4:hard'.
  const hardOf = (id) => id.replace(/boss$/, 'hard');
  const chartFor = (id) => (parseId(id).tiles ? current.charts['touch4:' + parseId(id).difficulty] : current.charts[parseId(id).difficulty === 'boss' ? hardOf(id) : id]);
  const BASE_LABEL = (d) => (d === 'boss' ? 'BOSS BATTLE' : (ChartGen.DIFFICULTIES[d] ? ChartGen.DIFFICULTIES[d].label : d).toUpperCase());
  /** 'hard' → HARD; 'touch4:hard' → HARD · TOUCH 4 */
  const LABEL = (id) => {
    const p = parseId(id);
    return BASE_LABEL(p.difficulty) + (p.tiles ? ' · TILES' : p.touch ? ` · TOUCH ${p.lanes}` : '');
  };
  const SHORT_BASE = { easy: 'E', medium: 'M', hard: 'H', insane: 'INS', boss: 'BOSS' };
  /** Medium+ and Duo were retired in 1.44: their old scores stay saved, but they're not offered or shown. */
  const RETIRED = (id) => /(^|:)(mediumplus|duo)$/.test(String(id));
  const SHORT = new Proxy({}, { get: (_, id) => { const p = parseId(String(id)); return (p.tiles ? 'T' : '') + (SHORT_BASE[p.difficulty] || id) + (p.touch ? p.lanes : ''); } });
  // Tiles is switched off (1.46): the game is about Beat Frets. Its code stays, and old
  // Tiles scores stay saved; this switch brings it back (localStorage 'beatfrets.tiles' = 'on').
  const TILES_ON = (() => { try { return localStorage.getItem('beatfrets.tiles') === 'on'; } catch (e) { return false; } })();
  const FAMILIES = { keys: 'KEYS', touch4: 'SIDEWAYS', touch2: 'UPRIGHT', ...(TILES_ON ? { tiles: 'TILES' } : {}) };
  const familyOf = (id) => { const p = parseId(id); return p.tiles ? 'tiles' : p.touch ? 'touch' + p.lanes : 'keys'; };
  const idsFor = (family) => (family === 'keys' ? DIFFS : family === 'tiles' ? TILES_IDS : ChartGen.TOUCH_TIERS.map((d) => family + ':' + d));
  /** The boss battle on a song (key 'pack:witching-hour'), or null. */
  const battleOf = (key) => (key && key.startsWith('pack:') ? Boss.battleFor(key.slice(5)) : null);
  /** A way of playing's tiers for a song: a boss battle song adds its battle (not in Tiles). */
  const tiersFor = (family, key) => idsFor(family).concat(battleOf(key) && family !== 'tiles' ? [family === 'keys' ? 'boss' : family + ':boss'] : []);

  // Which game the player picked on the home screen, and for Beat Frets on a
  // phone, which way up (sideways = 4 lanes, upright = 2 lanes).
  const session = { mode: null, orient: null };
  let vs = null; // the versus pop-up while it's open (challenges)

  /** keys on desktop; on touch, the chosen orientation (or however the phone is held). */
  function layoutMode() {
    if (!Input.touch) return 'keys';
    if (session.mode === 'frets' && session.orient) return session.orient === 'landscape' ? 'touch4' : 'touch2';
    return window.innerHeight > window.innerWidth ? 'touch2' : 'touch4';
  }

  // ---- orientation: lock it where we can, otherwise ask the player to turn the phone ----

  const isInstalled = () => (window.matchMedia && (matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches)) || navigator.standalone === true;
  const orientation = {
    wanted: null,
    want(o) {
      this.wanted = o || null;
      this.locked = false;
      if (o && Input.touch && screen.orientation && screen.orientation.lock) {
        screen.orientation.lock(o).then(() => { if (this.wanted === o) this.locked = true; }).catch(() => { /* not allowed here: the prompt covers it */ });
      }
      checkOrientation();
    },
    release() {
      this.wanted = null;
      this.locked = false;
      try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* nothing locked */ }
      checkOrientation();
    },
  };
  // Menus work either way up; only a song in progress needs the phone held its way.
  function wantedOrientation() {
    if (!Input.touch || !game || !game.running || gameLayout === 'keys') return null;
    return gameLayout === 'touch4' ? 'landscape' : 'portrait';
  }
  /** Show the "turn your phone" prompt (and pause a song) while it's held the wrong way. */
  function checkOrientation() {
    const want = wantedOrientation();
    const wrong = !!want && (want === 'landscape') !== (window.innerWidth > window.innerHeight);
    $('#rotate').hidden = !wrong || !!vs; // the versus pop-up shows its own "turn your phone"
    $('#rotate-msg').textContent = want === 'landscape' ? 'TURN YOUR PHONE SIDEWAYS' : 'TURN YOUR PHONE UPRIGHT';
    // Beat Frets can carry on the way the phone is held: 2 lanes upright, 4 sideways.
    const swap = $('#btn-rotate-swap');
    swap.hidden = gameLayout === 'tiles';
    swap.textContent = want === 'landscape' ? 'PLAY UPRIGHT INSTEAD' : 'PLAY SIDEWAYS INSTEAD';
    if (game) {
      if (wrong) {
        if (!game.paused) game.pause();
        $('#pause-msg').textContent = want === 'landscape' ? 'Turn your phone sideways to keep playing.' : 'Turn your phone upright to keep playing.';
        $('#btn-resume').disabled = true;
      } else if ($('#btn-resume').disabled) {
        $('#pause-msg').textContent = '';
        $('#btn-resume').disabled = false;
      }
    }
    if (vs) updateVersus();
    return wrong;
  }
  const tilesMode = () => session.mode === 'tiles';
  const tierIds = () => (tilesMode() ? TILES_IDS : idsFor(layoutMode()));
  /** The chart id for a tier in the current layout ('hard' → 'touch4:hard' when sideways). */
  function idFor(base) {
    if (tilesMode()) return 'tiles:' + (base === 'easy' ? 'easy' : base === 'medium' ? 'medium' : base === 'insane' ? 'insane' : 'hard');
    const m = layoutMode();
    return m === 'keys' ? base : m + ':' + base;
  }
  const WHAT = {
    easy: 'Strong beats only',
    medium: 'Off-beats and long notes',
    hard: 'Everything, with chords',
    insane: 'Faster, tighter, chords everywhere',
  };
  const WHAT_TOUCH = {
    easy: 'Strong beats only',
    medium: 'Off-beats and long notes',
    hard: 'Everything, with two-thumb chords',
    insane: 'Faster, tighter, chords everywhere',
  };
  const WHAT_TILES = {
    easy: 'Strong beats, gentle speed',
    medium: 'More tiles, long tiles',
    hard: 'Every tile, with doubles',
    insane: 'Fastest, every tile',
  };
  const LOOKAHEAD = { easy: 2.0, medium: 1.75, hard: 1.5, insane: 1.25 };

  /**
   * INSANE unlocks per song and way of playing, for the player: a B or better on
   * that song's Hard (Tiles: lap 1 cleared at 75% or better). Practice and failed
   * runs don't count.
   */
  function insaneUnlocked(key, id) {
    const p = save.active;
    if (!p) return false;
    const t = parseId(id);
    const hardId = t.tiles ? 'tiles:hard' : t.touch ? `touch${t.lanes}:hard` : 'hard';
    return save.data.runs.some((r) => r.profileId === p.id && r.songKey === key && r.difficulty === hardId && !r.failed && !r.practice &&
      (t.tiles ? (r.stars || 0) >= 3 && (r.accuracy || 0) >= 75 : /^[SAB]/.test(String(r.grade))));
  }
  const insaneLocked = (id) => parseId(id).difficulty === 'insane' && !(current && insaneUnlocked(current.key, id));

  /**
   * A boss battle unlocks for the player with a B or better on Easy, Medium and Hard of
   * each of its category's three songs (9 in all), played any way (keys, sideways or
   * upright). Returns each song with the levels done, and whether it's done.
   */
  const BOSS_LEVELS = ['easy', 'medium', 'hard'];
  function bossProgress(songId) {
    const battle = Boss.battleFor(songId);
    const p = save.active;
    return SongPack.SONGS.filter((d) => (d.theme || 'classic') === battle.theme).map((d) => {
      const levels = Object.fromEntries(BOSS_LEVELS.map((lv) => [lv, !!p && save.data.runs.some((r) => r.profileId === p.id && r.songKey === SongPack.keyFor(d)
        && !r.failed && !r.practice && /^[SAB]/.test(String(r.grade)) && !parseId(r.difficulty).tiles && parseId(r.difficulty).difficulty === lv)]));
      return { title: d.title, tier: d.tier, levels, count: BOSS_LEVELS.filter((lv) => levels[lv]).length, done: BOSS_LEVELS.every((lv) => levels[lv]) };
    });
  }
  /** What's left for a song: ✓ E · ✓ M · 🔒 H. */
  const bossNeedHtml = (prog) => `<span class="boss-need">${prog.map((x) => `<span class="${x.done ? 'done' : ''}">` +
    `<b>${esc(x.title)}</b><span class="lv">${BOSS_LEVELS.map((lv) => `<i class="${x.levels[lv] ? 'ok' : ''}" title="${x.levels[lv] ? 'Done' : 'Needs a B'}">${x.levels[lv] ? '✓' : '🔒'}${{ easy: 'E', medium: 'M', hard: 'H' }[lv]}</i>`).join('')}</span></span>`).join('')}</span>`;
  const bossCount = (prog) => prog.reduce((n, x) => n + x.count, 0);

  /** The active player's best win over a boss (any way of playing), or null if not beaten yet. */
  function bossBeaten(songId, profileId = save.active && save.active.id) {
    if (!profileId) return null;
    const key = 'pack:' + songId;
    let best = null;
    for (const r of save.data.runs) {
      if (r.profileId === profileId && r.songKey === key && parseId(r.difficulty).difficulty === 'boss' && !r.failed && !r.practice && (!best || r.score > best.score)) best = r;
    }
    return best;
  }
  const bossIdFor = (fam) => (fam === 'keys' ? 'boss' : fam + ':boss');

  /**
   * Who holds a boss battle's record, for the way of playing `fam`: filled into each
   * [data-boss-lead] in `root` (the world record, or this device's when offline).
   */
  function fillBossLeaders(root, fam) {
    const d = bossIdFor(fam);
    for (const el of $$('[data-boss-lead]', root)) {
      const key = 'pack:' + el.dataset.bossLead;
      const show = (r, world) => {
        if (!el.isConnected) return;
        const mine = r && (world ? r.mine : save.active && !r.rival && r.profileId === save.active.id);
        el.classList.toggle('mine', !!mine);
        el.innerHTML = !r ? `<span class="bl-none">NO ONE HAS ${world ? 'POSTED A WIN' : 'BEATEN IT HERE'} YET</span>`
          : `<svg><use href="#i-crown"/></svg>${mine ? 'YOU HOLD THE RECORD' : esc(String(r.initials || '???').toUpperCase()) + ' HOLDS THE RECORD'} · ${Number(r.score).toLocaleString('en-US')}`;
      };
      const local = () => show(save.leaderboard(key, d, 1)[0] || null, false);
      if (!World.available()) { local(); continue; }
      worldRecordOr(World.boardId(key, d)).then((r) => show(r, true)).catch(local);
    }
  }
  const bossLocked = (id) => parseId(id).difficulty === 'boss' && !(current && current.kind === 'pack' && bossProgress(current.packId).every((x) => x.done));
  const UNLOCK_HINT = (id) => (parseId(id).tiles ? 'Clear lap 1 on Hard at 75%+ to unlock' : 'Get a B or better on Hard to unlock');

  function safeStorage() {
    try {
      localStorage.setItem('beatfrets.probe', '1');
      localStorage.removeItem('beatfrets.probe');
      return localStorage;
    } catch (e) { return null; }
  }
  const storage = safeStorage();
  const save = new SaveData.Store(storage);
  const settings = save.settings;
  const stage = new Stage($('#stage'));

  let audioCtx = null;
  let game = null;
  let current = null; // the loaded song
  let songOrigin = 'pack';
  let lastDifficulty = 'easy';
  let focusBoss = false; // open the next song at its boss battle card
  let lastRun = null;
  let screen = null;
  const bufferCache = new Map();

  // ---- audio --------------------------------------------------------------------------

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      Sfx.init(audioCtx);
      Sfx.setVolumes(settings.music, settings.sfx);
    }
    if (audioCtx.state === 'suspended' && !(game && game.paused)) audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  window.addEventListener('pointerdown', () => ensureAudio(), true);
  window.addEventListener('keydown', () => ensureAudio(), true);

  // ---- screens & navigation ---------------------------------------------------------------

  function focusables(root) {
    return $$('button, input[type="range"], [tabindex="0"]', root).filter(
      (el) => !el.disabled && !el.hidden && el.offsetParent !== null
    );
  }

  let updateWaiting = false; // a new version is installed; load it at the next quiet moment
  function show(name, { focus } = {}) {
    // Unsaved option changes: ask before leaving (calibration and the strike-line
    // setup are part of Options, so the draft waits for you there).
    if (screen === 'options' && name !== 'options' && hasDraft() && !['calib', 'strike-setup'].includes(name)) {
      askKeep(() => show(name, { focus }));
      return;
    }
    if (updateWaiting && !game && (name === 'title' || name === 'main')) { location.reload(); return; }
    stopPreview();
    stage.setupMode = name === 'strike-setup';
    if (pendingRemote && !['import', 'loading'].includes(name)) pendingRemote = null;
    if (name === 'main' || name === 'title') leaveMode();
    screen = name;
    renderCrumbs(name);
    $('#panel').classList.toggle('hidden', !name);
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    $('#hints').hidden = !name;
    document.body.classList.toggle('has-hints', !!name);
    if (name && name !== 'title') guardHistory();
    if (!name) return;
    const el = $('#screen-' + name);
    el.scrollTop = 0;
    requestAnimationFrame(() => {
      const target = (focus && $(focus)) || $('[data-autofocus]:not([hidden])', el) || focusables(el)[0];
      if (target) target.focus({ preventScroll: true });
    });
  }

  function activeRoot() {
    if (!$('#keep-pop').hidden) return $('#keep-pop');
    if (!$('#inbox').hidden) return $('#inbox');
    if (!$('#outbox').hidden) return $('#outbox');
    if (!$('#name-pop').hidden) return $('#name-pop');
    if (!$('#vs').hidden) return $('#vs');
    if (!$('#outcome').hidden) return $('#outcome');
    if (!$('#pause').hidden) return $('#pause');
    return screen ? $('#screen-' + screen) : null;
  }

  function moveFocus(dir) {
    const root = activeRoot();
    if (!root) return;
    // The tab bar is part of every top-level screen.
    const items = focusables(root).concat(root.classList.contains('screen') && !$('#tabbar').hidden ? focusables($('#tabbar')) : []);
    if (!items.length) return;
    const cur = document.activeElement;
    if (!items.includes(cur)) { items[0].focus(); Sfx.move(); return; }
    if (cur.type === 'range' && (dir === 'left' || dir === 'right')) {
      if (dir === 'left') cur.stepDown(); else cur.stepUp();
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      Sfx.move();
      return;
    }
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const ex = b.left + b.width / 2;
      const ey = b.top + b.height / 2;
      const dx = ex - cx;
      const dy = ey - cy;
      let primary, secondary;
      if (dir === 'up') { primary = -dy; secondary = Math.abs(dx); }
      else if (dir === 'down') { primary = dy; secondary = Math.abs(dx); }
      else if (dir === 'left') { primary = -dx; secondary = Math.abs(dy); }
      else { primary = dx; secondary = Math.abs(dy); }
      if (primary <= 4) continue;
      const score = primary + secondary * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best && (dir === 'up' || dir === 'down')) {
      // Wrap around, like a classic menu.
      best = dir === 'down' ? items[0] : items[items.length - 1];
      if (best === cur) best = null;
    }
    if (best) {
      best.focus({ preventScroll: false });
      best.scrollIntoView({ block: 'nearest' });
      Sfx.move();
    }
  }

  function goBack() {
    if (!$('#keep-pop').hidden) { if (askKeep.cancel) askKeep.cancel(); return; }
    if (!$('#inbox').hidden) { closeInbox(); return; }
    if (!$('#outbox').hidden) { closeOutbox(); return; }
    if (!$('#name-pop').hidden) { if (askSongName.cancel) askSongName.cancel(); return; }
    if (!$('#vs').hidden) { closeVersus(true); return; }
    if (!$('#outcome').hidden) { $('#outcome').hidden = true; return; }
    if (!$('#pause').hidden) { if (game) game.resume(); return; }
    if (screen === 'initials') { initials.cancel(); return; }
    if (screen === 'calib') { leaveCalib(); return; }
    if (screen === 'strike-setup') {
      pendingPlay = null;
      Sfx.back();
      if (strikeReturn === 'options') { renderOptions(); show('options'); } else showSong();
      return;
    }
    if (screen === 'song') {
      Sfx.back();
      if (songOrigin === 'import') renderImport();
      if (songOrigin === 'boards') renderBoards();
      if (songOrigin === 'pack') refreshBossRows();
      show(songOrigin);
      return;
    }
    const el = screen && $('#screen-' + screen);
    const target = el && el.dataset.back;
    if (target) {
      Sfx.back();
      if (target === 'song') { showSong(); return; }
      if (target === 'main') renderMain();
      if (target === 'boards') renderBoards();
      show(target);
    }
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 5000);
  }

  // Generic data-go buttons.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || game) return;
    if (btn.hasAttribute('data-back-btn')) { goBack(); return; }
    if (btn.dataset.go) {
      const to = btn.dataset.go;
      if (to === 'main') renderMain();
      if (to === 'pack') renderPack();
      if (to === 'import') renderImport();
      if (to === 'boards') renderBoards();
      if (to === 'players') renderPlayers();
      if (to === 'options') renderOptions();
      if (to === 'title') renderTitle();
      if (to === 'calib' || btn.closest('#screen-calib')) calibrate.cancel();
      show(to);
    }
    Sfx.select();
  });

  document.addEventListener('mousemove', () => document.body.classList.remove('nav'), { passive: true });

  // ---- input routing ------------------------------------------------------------------------

  Input.on('lane', (lane, down, ts) => { if (game) game.lane(lane, down, ts); });

  Input.on('action', (a) => {
    document.body.classList.add('nav');
    if (game && !game.paused) {
      if (a === 'pause') { restartHold.cancel(); game.pause(); }
      if (a === 'overdrive') game.activateOverdrive();
      if (a === 'restart-down') restartHold.start();
      if (a === 'restart-up') restartHold.cancel();
      return;
    }
    if (screen === 'results' && resultsAnim && (a === 'confirm' || a === 'back')) { resultsAnim(); return; }
    if (screen === 'initials' && initials.handle(a)) return;
    if (screen === 'calib' && a === 'confirm') { calibrate.tap(performance.now()); return; }
    if (a === 'back') { goBack(); return; }
    if (a === 'confirm') {
      ensureAudio();
      let el = document.activeElement;
      const root = activeRoot();
      // Nothing focused yet (the screen just opened): act on its first item.
      if (root && (!el || !root.contains(el))) el = focusables(root)[0];
      if (el && el.matches('button, label, [tabindex="0"]')) el.click();
      return;
    }
    if (['up', 'down', 'left', 'right'].includes(a)) moveFocus(a);
  });

  Input.on('device', updateDeviceUI);

  function updateDeviceUI() {
    renderModes();
    const pad = Input.device.type === 'gamepad';
    const fam = { xbox: 'XBOX-STYLE PAD', playstation: 'PLAYSTATION PAD', nintendo: 'SWITCH PRO PAD' }[Input.device.family];
    $('#hints').innerHTML = pad
      ? `<span><b>D-PAD</b> MOVE &nbsp; <b>${esc(Input.glyph('confirm'))}</b> SELECT &nbsp; <b>${esc(Input.glyph('back'))}</b> BACK</span><span>${fam}</span>`
      : `<span><b>↑↓</b> MOVE &nbsp; <b>ENTER</b> SELECT &nbsp; <b>ESC</b> BACK</span><span>KEYBOARD</span>`;
    $$('[data-glyph]').forEach((el) => { el.textContent = Input.glyph(el.dataset.glyph); });
    $$('[data-keys]').forEach((el) => {
      if (Input.touch) return; // touch cards show a lane count instead
      const n = +el.dataset.keys;
      el.innerHTML = Input.laneLabels(n).map((k, i) => `<kbd class="k${i}">${esc(k)}</kbd>`).join('');
    });
    const st = $('#pad-status');
    if (st) {
      st.textContent = pad
        ? `Controller connected: ${Input.device.name.slice(0, 60)}. Hard: ${Input.laneLabels(5).join(' ')}. Easy: ${Input.laneLabels(3).join(' ')}. Overdrive: ${Input.glyph('overdrive')}.`
        : 'No controller in use. Press any button on a connected controller and it takes over automatically.';
    }
  }

  // ---- title, initials, main menu --------------------------------------------------------------

  function renderTitle() {
    const p = save.active;
    $('#title-player').textContent = p ? `PLAYER ${p.initials}` : '';
  }

  $('#btn-start').addEventListener('click', () => {
    ensureAudio();
    // In a browser tab, go full screen. The installed app already is, and asking
    // again makes Android show its "full screen" notice every time.
    if (Input.touch && !isInstalled() && document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
    if (!save.active) initials.open(null, (txt) => { save.createProfile(txt); renderMain(); show('main'); });
    else { renderMain(); show('main'); }
  });

  /**
   * Phones: upright offers Beat Frets on 2 lanes and Tiles; sideways offers only Beat Frets,
   * on 4 lanes (Tiles is played upright).
   */
  function renderModes() {
    const side = Input.touch && window.innerWidth > window.innerHeight;
    $('#btn-mode-tiles').hidden = side || !TILES_ON;
    $('#tiles-hint').hidden = !side || !TILES_ON;
    $('.modes').classList.toggle('single', side || !TILES_ON);
    $('#modes-head').textContent = TILES_ON ? 'CHOOSE A GAME' : 'READY TO ROCK?';
    $('#frets-lanes').innerHTML = !Input.touch ? ''
      : side ? '<b>SIDEWAYS · 4 LANES</b>'
        : '<b>UPRIGHT · 2 LANES</b><span>Turn your phone sideways for 4 lanes</span>';
    $('#tiles-lanes').innerHTML = Input.touch ? '<b>UPRIGHT ONLY</b>' : '';
  }

  // ---- Song of the Day ----------------------------------------------------------------------------

  /** Today's pick, and the tier for a way of playing ('keys', 'touch4', 'touch2', 'tiles'). */
  const dailyPick = () => Daily.pick(SongPack.SONGS);
  const dailyTier = (family, pk = dailyPick()) => Daily.tierFor(pk.base, family);
  /** Is this run (song + tier, today) the Song of the Day? */
  function isDailyRun(difficulty) {
    if (!current || current.kind !== 'pack') return false;
    const pk = dailyPick();
    return current.packId === pk.songId && difficulty === dailyTier(familyOf(difficulty), pk);
  }
  function dailyStreak(p = save.active) { return p ? Daily.streakNow(p.daily) : 0; }
  /** After a daily run: keep the player's streak going. */
  function markDaily(p) {
    if (!p) return;
    p.daily = Daily.nextStreak(p.daily || null, Daily.today());
    save.save();
  }
  /** How you'd play the daily right now: keys, sideways (4 lanes) or upright (2 lanes). */
  const dailyFamily = () => (Input.touch ? (window.innerWidth > window.innerHeight ? 'touch4' : 'touch2') : 'keys');

  let dailySeq = 0;
  function renderDaily() {
    const card = $('#daily-card');
    const pk = dailyPick();
    const def = SongPack.SONGS.find((x) => x.id === pk.songId);
    if (!def) { card.hidden = true; return; }
    const fam = dailyFamily();
    const tier = dailyTier(fam, pk);
    const streak = dailyStreak();
    const playedToday = save.active && save.active.daily && save.active.daily.last === pk.date;
    const day = new Date(pk.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();
    const sideways = Input.touch && fam === 'touch4';
    card.hidden = false;
    card.innerHTML = `<div class="daily-top"><span><svg><use href="#i-trophy"/></svg>SONG OF THE DAY</span><span>${esc(day)}</span></div>
      <div class="daily-body">
        <b>${tierBadge(def.tier)}${esc(def.title.toUpperCase())}</b>
        <span class="daily-how"><span class="board-now-tier" data-base="${pk.base}">${BASE_LABEL(pk.base)}</span> · ${FAMILIES[fam]}${sideways || !TILES_ON ? '' : ` <i>(TILES: ${BASE_LABEL(parseId(dailyTier('tiles', pk)).difficulty)})</i>`}</span>
        <span class="daily-lead" id="daily-lead">${World.available() ? 'CHECKING TODAY\'S BOARD…' : ''}</span>
        <span class="daily-streak${streak ? ' on' : ''}">${streak ? `🔥 ${streak}-DAY STREAK${playedToday ? ' · PLAYED TODAY' : ' · PLAY TODAY TO KEEP IT'}` : 'PLAY TODAY TO START A 🔥 STREAK'}</span>
      </div>
      <div class="daily-acts">
        <button class="btn primary" data-daily-play="frets">PLAY <svg><use href="#i-play"/></svg></button>
        ${sideways || !TILES_ON ? '' : '<button class="btn" data-daily-play="tiles">TILES</button>'}
        ${World.available() ? '<button class="btn" data-daily-board>TODAY\'S BOARD</button>' : ''}
      </div>`;
    if (!World.available()) return;
    const seq = ++dailySeq;
    const myId = save.active ? '_' + String(save.active.id).replace(/[^a-z0-9]/gi, '').slice(0, 24) : null;
    World.top(Daily.boardId(pk.date, tier, pk.songId), 50).then((rows) => {
      const el = $('#daily-lead');
      if (seq !== dailySeq || !el) return;
      const fmt = (n) => Number(n).toLocaleString('en-US');
      const mine = myId ? rows.findIndex((r) => r.mine && r.id.endsWith(myId)) : -1;
      el.innerHTML = !rows.length ? 'NO ONE YET TODAY · BE THE FIRST'
        : `<svg><use href="#i-crown"/></svg>${esc(rows[0].initials)} ${fmt(rows[0].score)}` + (mine === 0 ? ' · THAT\'S YOU!' : mine > 0 ? ` · YOU'RE #${mine + 1}` : ` · ${rows.length} PLAYED`);
    }).catch(() => { const el = $('#daily-lead'); if (el && seq === dailySeq) el.textContent = ''; });
  }

  /** Play the Song of the Day: Beat Frets (the way the phone is held, or keys) or Tiles. */
  async function startDaily(mode) {
    const pk = dailyPick();
    session.mode = mode;
    session.orient = null;
    save.setSetting('playMode', mode);
    if (mode === 'tiles') { session.orient = Input.touch ? 'portrait' : null; orientation.want(session.orient); }
    applyLayout();
    songOrigin = 'pack';
    $('#screen-pack').dataset.back = 'main';
    await loadPack(pk.songId);
    if (screen === 'song' && current && current.packId === pk.songId) play(dailyTier(mode === 'tiles' ? 'tiles' : layoutMode(), pk), {});
  }

  /** Today's board for a way of playing. */
  function openDailyBoard(family = dailyFamily()) {
    const pk = dailyPick();
    const def = SongPack.SONGS.find((x) => x.id === pk.songId);
    openBoard(SongPack.keyFor(def), def.title, dailyTier(family, pk), screen || 'main', 'world', null, pk.date);
  }

  $('#daily-card').addEventListener('click', (e) => {
    const b = e.target.closest('[data-daily-play]');
    if (b) { startDaily(b.dataset.dailyPlay); return; }
    if (e.target.closest('[data-daily-board]')) openDailyBoard();
  });

  function renderMain() {
    renderModes();
    renderDaily();
    const p = save.active;
    $('#main-player').textContent = p ? p.initials : '---';
    updateOutboxUI();
    setTimeout(maybePromptOutbox, 400);
    setTimeout(checkInbox, 600);
  }

  const initials = (() => {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let chars = ['A', 'A', 'A'];
    let cur = 0;
    let onDone = null;
    let returnTo = 'title';

    function paint() {
      $$('#initials .slot').forEach((slot, i) => {
        slot.classList.toggle('cur', i === cur);
        $('b', slot).textContent = chars[i];
      });
    }
    function cycle(d) {
      const i = CHARS.indexOf(chars[cur]);
      chars[cur] = CHARS[(i + d + CHARS.length) % CHARS.length];
      Sfx.move();
      paint();
    }
    function done() {
      const txt = chars.join('');
      const fn = onDone;
      onDone = null;
      if (fn) fn(txt);
    }
    $$('#initials .slot').forEach((slot, i) => {
      $('.up', slot).addEventListener('click', () => { cur = i; cycle(-1); });
      $('.dn', slot).addEventListener('click', () => { cur = i; cycle(1); });
      $('b', slot).addEventListener('click', () => { cur = i; paint(); });
    });
    $('#btn-initials-ok').addEventListener('click', done);
    // Phones: an arcade-style grid of big letters. Each fills the lit box and moves on;
    // ⌫ goes back one.
    let full = false;
    $('#letter-grid').innerHTML = [...CHARS].map((c) => `<button data-ch="${c}">${c}</button>`).join('') +
      '<button data-ch="del" class="del" aria-label="Back one letter">⌫</button>';
    $('#letter-grid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ch]');
      if (!b) return;
      if (b.dataset.ch === 'del') {
        if (!full) cur = Math.max(0, cur - 1);
        chars[cur] = 'A';
        full = false;
      } else {
        chars[cur] = b.dataset.ch;
        full = cur === 2;
        cur = Math.min(2, cur + 1);
      }
      Sfx.move();
      paint();
    });
    window.addEventListener('keydown', (e) => {
      if (screen !== 'initials' || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (k.length === 1 && CHARS.includes(k)) {
        e.preventDefault();
        chars[cur] = k;
        cur = Math.min(2, cur + 1);
        Sfx.move();
        paint();
      }
    });
    return {
      open(start, cb, back = screen || 'title') {
        chars = (start || 'AAA').padEnd(3, 'A').slice(0, 3).split('').map((c) => (CHARS.includes(c) ? c : 'A'));
        cur = 0;
        full = false;
        onDone = cb;
        returnTo = back;
        paint();
        show('initials', { focus: '#btn-initials-ok' });
      },
      cancel() { Sfx.back(); onDone = null; show(returnTo); },
      handle(a) {
        if (a === 'up') { cycle(-1); return true; }
        if (a === 'down') { cycle(1); return true; }
        if (a === 'left') { cur = Math.max(0, cur - 1); Sfx.move(); paint(); return true; }
        if (a === 'right') { cur = Math.min(2, cur + 1); Sfx.move(); paint(); return true; }
        if (a === 'confirm') {
          if (cur < 2) { cur++; Sfx.move(); paint(); } else { Sfx.select(); done(); }
          return true;
        }
        return false;
      },
    };
  })();

  // ---- song pack & import ------------------------------------------------------------------------

  function bestLine(key) {
    const p = save.active;
    if (!p) return '';
    const parts = tierIds().map((d) => {
      const b = save.bestStars(p.id, key, d);
      return b.stars ? `${SHORT[d] || d} ${b.stars}★` : null;
    }).filter(Boolean);
    return parts.length ? 'STARS ' + parts.join(' · ') : 'Not played yet';
  }

  /** A song as a list row: title and details on the left, your best stars and a › on the right. */
  /**
   * ROOKIE · PRO · ELITE: how naturally hard a pack song is, whatever the difficulty. (The
   * hardest tier's id stays 'boss' in the song data; it's shown as ELITE so it isn't mixed up
   * with the BOSS BATTLE.)
   */
  const TIERS = { rookie: 'ROOKIE', pro: 'PRO', boss: 'ELITE' };
  const tierBadge = (tier) => (TIERS[tier] ? `<span class="tier tier-${tier}">${TIERS[tier]}</span>` : '');

  function songRow(title, detail, key, tier) {
    const p = save.active;
    let best = 0;
    if (p) for (const d of tierIds()) best = Math.max(best, d.startsWith('tiles:') ? 0 : save.bestStars(p.id, key, d).stars);
    const stars = p && !tilesMode() ? `<span class="row-stars">${'★'.repeat(best)}<span class="off">${'★'.repeat(5 - best)}</span></span>` : '';
    return `<span class="row-main"><b>${tierBadge(tier)}${esc(title.toUpperCase())}</b><small>${esc(detail)}</small><span class="leaders"></span></span>` +
      `<span class="row-side">${stars}</span><svg class="chev"><use href="#i-chev"/></svg>`;
  }

  // Song-list categories (each theme, bonus tracks): collapsed, one open at a time,
  // remembered per screen; the heading sums up who holds the records inside.
  /** A pack song's tempo for the list: '126→208' for a song that speeds up. */
  const bpmLabel = (s) => { const top = Math.max(s.bpm, ...s.form.map((f) => f.bpm || 0)); return top > s.bpm ? `${s.bpm}→${top}` : String(s.bpm); };
  const THEMES = [['classic', 'CHIPTUNE CLASSICS'], ['spooky', 'SPOOKY'], ['rock', 'ROCK'], ['epic', 'EPIC ADVENTURE'], ['space', 'SPACE'], ['carnival', 'CARNIVAL'], ['salsa', 'SALSA'], ['hiphop', 'HIP HOP'], ['classical', 'CLASSICAL REMIX']];
  // Every category's name, by key: the themes, bonus tracks, and songs players imported.
  const CAT_NAME = { ...Object.fromEntries(THEMES), bonus: 'BONUS TRACKS', players: 'PLAYERS\' MUSIC' };
  const CAT_KEYS = [...THEMES.map(([k]) => k), 'bonus', 'players'];
  const openCat = (where) => { try { return (storage && storage.getItem('beatfrets.cat.' + where)) || ''; } catch (e) { return ''; } };
  function setOpenCat(where, cat) { try { if (storage) storage.setItem('beatfrets.cat.' + where, cat); } catch (e) { /* not kept */ } }

  /** A collapsible category: a heading button with a summary line, and its rows. */
  function catBlock(where, cat, heading, count, rows, { noun = 'SONG', summary = true } = {}) {
    const open = openCat(where) === cat;
    return `<div class="cat theme-${cat}${open ? ' open' : ''}" data-cat="${cat}">` +
      `<button class="cat-head" data-cat-toggle="${cat}" aria-expanded="${open}">` +
      `<span class="cat-arrow" aria-hidden="true"><svg><use href="#i-chev"/></svg></span>` +
      `<span class="cat-main"><b>${heading}</b>` +
      (summary ? '<small class="cat-sum"><span class="wr-wait">CHECKING RECORDS…</span></small>' : '') + '</span>' +
      `<span class="cat-side"><span class="cat-count">${typeof count === 'number' ? `${count} ${noun}${count === 1 ? '' : 'S'}` : count}</span><span class="cat-tap">${open ? 'TAP TO CLOSE' : 'TAP TO OPEN'}</span></span>` +
      `</button><div class="list cat-body"${open ? '' : ' hidden'}>${rows}</div></div>`;
  }

  function toggleCat(where, head) {
    const box = head.closest('.cat');
    const opening = !box.classList.contains('open');
    for (const c of $$('.cat', box.closest('.screen'))) {
      const on = c === box && opening;
      c.classList.toggle('open', on);
      $('.cat-body', c).hidden = !on;
      $('.cat-head', c).setAttribute('aria-expanded', on);
      $('.cat-tap', c).textContent = on ? 'TAP TO CLOSE' : 'TAP TO OPEN';
    }
    setOpenCat(where, opening ? box.dataset.cat : '');
    if (!opening) return;
    // With keys or a controller, the cursor moves onto the first song.
    const first = document.body.classList.contains('nav') && ($('.cat-body [data-key]', box) || $('.cat-body button', box));
    if (first) first.focus({ preventScroll: true });
    requestAnimationFrame(() => head.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  function renderPack() {
    const where = 'pack';
    $('#pack-list').innerHTML = THEMES.map(([theme, heading]) => {
      const songs = SongPack.SONGS.filter((s) => (s.theme || 'classic') === theme);
      if (!songs.length) return '';
      const boss = tilesMode() ? null : songs.find((s) => Boss.battleFor(s.id));
      return catBlock(where, theme, heading, boss ? `${songs.length} SONGS + BOSS` : songs.length, songs.map((s) =>
        `<div class="song-line"><button data-pack="${esc(s.id)}" data-key="${esc(SongPack.keyFor(s))}">${songRow(s.title, `${bpmLabel(s)} BPM · ${s.blurb}`, SongPack.keyFor(s), s.tier)}</button>` +
        previewButton('pack:' + s.id, s.title) + '</div>').join('') + (boss ? bossRow(boss) : ''));
    }).join('');
    autofocusCat($('#pack-list'));
    fillBossLeaders($('#pack-list'), layoutMode());
    markRecords();
    fillCatSummaries($('#pack-list'));
    fetchBonusIndex().then((list) => {
      $('#bonus-section').hidden = !list.length;
      $('#bonus-section').innerHTML = list.length ? catBlock(where, 'bonus', 'BONUS TRACKS', list.length, list.map((s) =>
        `<div class="song-line"><button data-bonus="${esc(s.id)}" data-key="${esc(BonusPack.keyFor(s.id))}">${songRow(s.title.slice(0, 40), s.artist || 'Bonus track', BonusPack.keyFor(s.id))}</button>` +
        previewButton('bonus:' + s.id, s.title) + '</div>'
      ).join('')) : '';
      markRecords();
      fillCatSummaries($('#bonus-section'));
    });
  }

  /**
   * A category's boss battle, last in its list: locked (and saying what's left to do)
   * until the player has a B or better on each of the category's three songs.
   */
  function bossRow(def) {
    const battle = Boss.battleFor(def.id);
    const prog = bossProgress(def.id);
    const locked = !prog.every((x) => x.done);
    const beaten = !locked && bossBeaten(def.id);
    const detail = locked
      ? `Get a B or better on Easy, Medium and Hard of all three songs to unlock (${bossCount(prog)} of 9 done)`
      : beaten ? `Defeated! Your best: ${Number(beaten.score).toLocaleString('en-US')}. Rematch any time for a better score.`
        : `${def.title} on Hard: beat the boss before the song ends!`;
    return `<div class="song-line"><button class="boss-row${locked ? ' locked' : ''}${beaten ? ' beaten' : ''}" data-boss="${esc(def.id)}" style="--boss:${battle.color}">` +
      `<span class="row-main"><b><span class="tier tier-battle"><svg><use href="#i-skull"/></svg>BOSS BATTLE</span>${esc(battle.name)}${beaten ? '<span class="defeated-tag">✓ DEFEATED</span>' : ''}</b><small>${esc(detail)}</small>` +
      (locked ? bossNeedHtml(prog) : `<span class="boss-lead" data-boss-lead="${esc(def.id)}"></span>`) + '</span>' +
      `<span class="row-side">${locked ? '<span class="lock-big">🔒<span class="lock-word"> LOCKED</span></span>' : `<span class="fight">${beaten ? 'REMATCH' : 'FIGHT'}</span>`}</span><svg class="chev"><use href="#i-chev"/></svg></button></div>`;
  }

  /** Back on the song list after playing: a boss battle may have just unlocked. */
  function refreshBossRows() {
    for (const b of $$('#pack-list [data-boss]')) {
      const def = SongPack.SONGS.find((x) => x.id === b.dataset.boss);
      b.closest('.song-line').outerHTML = bossRow(def);
    }
    fillBossLeaders($('#pack-list'), layoutMode());
  }

  /** Focus lands on the open category's first song, or on the first heading. */
  function autofocusCat(list) {
    for (const el of $$('[data-autofocus]', list)) el.removeAttribute('data-autofocus');
    const open = $('.cat.open .cat-body [data-key]', list) || $('.cat.open .cat-body button', list);
    const target = open || $('.cat-head', list);
    if (target) target.setAttribute('data-autofocus', '');
  }

  $('#pack-list').addEventListener('click', (e) => {
    const h = e.target.closest('[data-cat-toggle]');
    if (h) { toggleCat('pack', h); return; }
    const boss = e.target.closest('[data-boss]');
    if (boss) {
      if (boss.classList.contains('locked')) { toast('Locked: get a B or better on Easy, Medium and Hard of all three of this category\'s songs to fight the boss.'); return; }
      songOrigin = 'pack';
      focusBoss = true;
      loadPack(boss.dataset.boss);
      return;
    }
    const b = e.target.closest('[data-pack]');
    if (b) { songOrigin = 'pack'; loadPack(b.dataset.pack); }
  });
  $('#bonus-section').addEventListener('click', (e) => {
    const h = e.target.closest('[data-cat-toggle]');
    if (h) { toggleCat('pack', h); return; }
    const b = e.target.closest('[data-bonus]');
    if (b) { songOrigin = 'pack'; loadBonus(b.dataset.bonus); }
  });

  // ---- bonus tracks (recorded songs in songs/) -------------------------------------------------

  let bonusIndex = null;
  const bonusCache = new Map();

  async function fetchBonusIndex() {
    if (bonusIndex) return bonusIndex;
    try {
      const r = await fetch('songs/index.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      bonusIndex = Array.isArray(j.songs) ? j.songs.filter((x) => x && x.id && x.file) : [];
    } catch (e) {
      bonusIndex = []; // opened from disk, or no songs folder
    }
    return bonusIndex;
  }

  async function fetchWithProgress(url, onProgress) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`download failed (${r.status})`);
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !total) return r.arrayBuffer();
    const reader = r.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(Math.min(1, got / total));
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out.buffer;
  }

  async function analyseInBrowser(buffer, from, to) {
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    return BeatAnalyzer.analyze(channels, buffer.sampleRate, (p) => setProgress(from + p * (to - from), 'Building the charts on this device…'));
  }

  async function loadBonus(id) {
    const list = await fetchBonusIndex();
    const def = list.find((s) => s.id === id);
    if (!def) { if (quietLoad) quietDone(new Error('That bonus track is not on this site.')); else toast('That bonus track is not on this site.'); return; }
    ensureAudio();
    if (!quietLoad) show('loading');
    $('#loading-title').textContent = 'LOADING ' + def.title.toUpperCase().slice(0, 40);
    setProgress(0.03, 'Downloading…');
    try {
      let entry = bonusCache.get(id);
      if (!entry) {
        const [bytes, chart] = await Promise.all([
          fetchWithProgress('songs/' + encodeURIComponent(def.file), (p) => setProgress(0.03 + 0.6 * p, `Downloading… ${Math.round(p * 100)}%`)),
          def.chart ? fetch('songs/' + encodeURIComponent(def.chart)).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
        ]);
        setProgress(0.66, 'Decoding audio…');
        const buffer = await audioCtx.decodeAudioData(bytes);
        let analysis;
        let charts;
        // A chart file from an older version of the game lacks newer tiers or long
        // notes; rebuild in the browser rather than play an incomplete set.
        const upToDate = chart && chart.charts && chart.analyzer === BeatAnalyzer.VERSION && chart.chartgen === ChartGen.VERSION && ChartGen.ALL_IDS.every((id) => chart.charts[id]);
        if (upToDate) {
          setProgress(0.75, 'Lining the chart up with the audio…');
          const n = Math.min(buffer.length, Math.floor(BonusPack.ALIGN_SECONDS * buffer.sampleRate));
          const head = [];
          for (let c = 0; c < buffer.numberOfChannels; c++) head.push(buffer.getChannelData(c).subarray(0, n));
          const local = await BeatAnalyzer.analyze(head, buffer.sampleRate);
          const shift = BonusPack.bestShift(chart.reference || [], BonusPack.referenceOnsets(local));
          charts = {};
          for (const [d, c] of Object.entries(chart.charts)) charts[d] = BonusPack.shiftChart(c, shift);
          analysis = { duration: buffer.duration, bpm: chart.bpm, beats: chart.beats.map((b) => +(b + shift).toFixed(4)), onsets: [] };
          entry = { buffer, analysis, charts, prebuilt: true, shift };
        } else {
          analysis = await analyseInBrowser(buffer, 0.7, 0.98);
          charts = {};
          for (const id of ChartGen.ALL_IDS) charts[id] = ChartGen.generateId(analysis, id);
          entry = { buffer, analysis, charts, prebuilt: false, shift: 0 };
        }
        bonusCache.set(id, entry);
      }
      setProgress(1, 'Ready');
      current = {
        key: BonusPack.keyFor(id), title: def.title, artist: def.artist || '', credit: def.credit || '', kind: 'bonus', bonusId: id,
        buffer: entry.buffer, analysis: entry.analysis, charts: entry.charts, fp: null, shift: entry.shift,
        matchNote: entry.prebuilt ? null : "This song's chart hasn't been pre-built for this version of the game, so this device made one. Other players' notes may differ slightly.",
      };
      if (quietLoad) quietDone(); else showSong();
    } catch (err) {
      console.error(err);
      if (quietLoad) { quietDone(err); return; }
      renderPack();
      show('pack');
      toast(`"${def.title}" could not be loaded: ${err.message || err}`);
    }
  }

  function fmtSize(bytes) { return bytes > 1e6 ? (bytes / 1e6).toFixed(1) + ' MB' : Math.round(bytes / 1e3) + ' KB'; }

  function renderImport(note) {
    const box = $('#recent-list');
    box.innerHTML = note ? `<p class="match">${esc(note)}</p>` : '';
    Library.list().then((songs) => {
      if (!songs.length) return;
      box.innerHTML = (note ? `<p class="match">${esc(note)}</p>` : '') + '<p class="label">YOUR SAVED SONGS</p>' +
        songs.map((m) => `<div class="lib-row">
          <button data-saved="${esc(m.key)}">${songRow(m.title.slice(0, 36), fmtSize(m.size), m.key)}</button>
          ${previewButton('saved:' + m.key, m.title)}
          <button class="del" data-del="${esc(m.key)}" aria-label="Delete ${esc(m.title)}">DELETE</button>
        </div>`).join('');
      markRecords();
    });
  }

  $('#recent-list').addEventListener('click', async (e) => {
    const play = e.target.closest('[data-saved]');
    if (play) { songOrigin = 'import'; loadSaved(play.dataset.saved); return; }
    const del = e.target.closest('[data-del]');
    if (!del) return;
    if (!del.classList.contains('armed')) {
      $$('#recent-list .del.armed').forEach((b) => { b.classList.remove('armed'); b.textContent = 'DELETE'; });
      del.classList.add('armed');
      del.textContent = 'SURE?';
      return;
    }
    await Library.remove(del.dataset.del).catch(() => {});
    toast('Song removed from this browser. Its scores are kept.');
    renderImport();
    requestAnimationFrame(() => { const first = $('#drop'); if (first) first.focus(); });
  });

  $('#drop').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file').click(); }
  });
  $('#file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) { songOrigin = 'import'; importFile(f); }
  });

  function setProgress(fraction, detail) {
    $('#loading-bar').style.width = Math.round(fraction * 100) + '%';
    if (detail) $('#loading-detail').textContent = detail;
    if (vs && !vs.loaded && quietLoad) { vs.status = `Loading the stage… ${Math.round(fraction * 100)}%`; updateVersus(); }
  }

  async function loadPack(id) {
    const def = SongPack.SONGS.find((s) => s.id === id);
    if (!def) { if (quietLoad) quietDone(new Error('That song is not in the pack.')); return; }
    ensureAudio();
    if (!quietLoad) show('loading');
    $('#loading-title').textContent = 'LOADING ' + def.title.toUpperCase();
    setProgress(0.2, 'Writing the charts…');
    const built = SongPack.build(def);
    const analysis = SongPack.toAnalysis(built);
    const charts = {};
    for (const id of ChartGen.ALL_IDS) charts[id] = ChartGen.generateId(analysis, id);
    setProgress(0.45, 'Tuning the sound chip…');
    try {
      const buffer = await packBuffer(id, (k) => setProgress(0.45 + 0.5 * k, `Playing the sound chip… ${Math.round(k * 100)}%`));
      setProgress(1, 'Ready');
      current = { key: SongPack.keyFor(def), title: def.title, kind: 'pack', packId: id, buffer, analysis, charts, fp: null, matchNote: null };
      if (quietLoad) quietDone(); else showSong();
    } catch (err) {
      console.error(err);
      if (quietLoad) { quietDone(err); return; }
      show('pack');
      toast('That song could not be loaded: ' + (err.message || err));
    }
  }

  function hashBytes(buf) {
    const bytes = new Uint8Array(buf);
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16) + '-' + bytes.length.toString(16);
  }

  async function importFile(file) {
    const name = file.name.replace(/\.[^.]+$/, '');
    ensureAudio();
    show('loading');
    $('#loading-title').textContent = 'LISTENING TO ' + name.toUpperCase().slice(0, 40);
    setProgress(0.02, 'Reading the file…');
    try {
      const bytes = await file.arrayBuffer();
      await loadBytes(name, bytes, { store: true });
    } catch (err) {
      loadFailed(err);
    }
  }

  async function loadSaved(key) {
    ensureAudio();
    if (!quietLoad) show('loading');
    setProgress(0.02, 'Opening your saved song…');
    try {
      const [bytes, list] = await Promise.all([Library.get(key), Library.list()]);
      const meta = list.find((m) => m.key === key);
      if (!bytes || !meta) throw new Error('that song is no longer saved in this browser.');
      $('#loading-title').textContent = 'LOADING ' + meta.title.toUpperCase().slice(0, 40);
      Library.touch(key);
      await loadBytes(meta.title, bytes, { store: false });
    } catch (err) {
      loadFailed(err);
    }
  }

  function loadFailed(err) {
    console.error(err);
    if (quietLoad) { quietDone(err); return; }
    renderImport();
    show('import');
    toast("That song couldn't be used: " + (err && err.message ? err.message : err));
  }

  /** Decode, analyse (or reuse the cached analysis), chart, and open the song screen. */
  async function loadBytes(name, bytes, { store }) {
    const id = hashBytes(bytes);
    // decodeAudioData takes ownership of the buffer, so keep a copy to save.
    const keep = store ? bytes.slice(0) : null;
    setProgress(0.04, 'Decoding audio…');
    const buffer = await audioCtx.decodeAudioData(bytes);
    const cacheKey = `beatfrets.analysis.${BeatAnalyzer.VERSION}.${id}`;
    let analysis = null;
    try { analysis = storage && JSON.parse(storage.getItem(cacheKey)); } catch (e) { analysis = null; }
    if (!analysis) {
      const channels = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
      analysis = await BeatAnalyzer.analyze(channels, buffer.sampleRate, (p) =>
        setProgress(0.05 + p * 0.9, p < 0.8 ? 'Finding hits in each frequency band…' : 'Tracking the beat…'));
      try { if (storage) storage.setItem(cacheKey, JSON.stringify(analysis)); } catch (e) { /* cache is optional */ }
    }
    const charts = {};
    for (const id of ChartGen.ALL_IDS) charts[id] = ChartGen.generateId(analysis, id);
    if (!charts.easy.notes.length) throw new Error('No beat could be found in this audio.');
    const fp = SaveData.fingerprint(analysis);
    const reg = save.registerSong(name, fp);
    if (keep) {
      Library.put(reg.key, name, keep).catch(() => toast("Your browser's storage is full, so this song wasn't saved for next time."));
    }
    current = {
      key: reg.key, title: name, kind: 'mp3', buffer, analysis, charts, fp,
      matchNote: reg.matched && reg.title !== name
        ? `Matched to "${reg.title}" by sound (${Math.round(reg.similarity * 100)}% alike), so you share its leaderboard.`
        : null,
    };
    keepPreview('mp3:' + reg.key, buffer);
    if (quietLoad) quietDone();
    else if (pendingRemote) resumeRemote();
    else showSong();
  }

  // ---- song previews ------------------------------------------------------------------------------

  // Every song row has a ▶ button. Built-in songs are synthesised the first time
  // (10–60 s): the button fills up as the song is made, blinks READY, then plays a
  // 15-second clip from the chorus. Builds queue up and run one at a time.
  const previewBuffers = new Map();
  /** Decoded songs for previews: only the last two stay in memory (a long MP3 is big). */
  function keepPreview(k, buf) {
    previewBuffers.delete(k);
    previewBuffers.set(k, buf);
    while (previewBuffers.size > 2) previewBuffers.delete(previewBuffers.keys().next().value);
  }
  const preview = { key: null, timer: 0, src: null, gain: null };
  const pvState = new Map(); // 'pack:id' | 'bonus:id' | 'saved:key' → { state, p, fresh }
  const PREVIEW_LEN = 15;
  let buildQueue = Promise.resolve();

  function stopPreview() {
    clearTimeout(preview.timer);
    const was = preview.key;
    preview.key = null;
    if (preview.src) {
      const { src, gain } = preview;
      const t = audioCtx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.15);
      setTimeout(() => { try { src.stop(); } catch (e) { /* already stopped */ } }, 200);
      preview.src = null;
    }
    if (was && pvStateFor(was).state === 'playing') setPv(was, 'ready');
  }

  /** Where a preview starts: a pack song's first chorus, otherwise a third of the way in. */
  function previewStart(key, buf) {
    if (key.startsWith('pack:')) {
      const def = SongPack.SONGS.find((s) => s.id === key.slice(5));
      let t = 1;
      for (const sec of def.form) {
        if (sec.lead === 'chorus') return t;
        t += sec.bars * 16 * (60 / (sec.bpm || def.bpm) / 4);
      }
    }
    return buf.duration * 0.3;
  }

  function pvStateFor(key) {
    if (pvState.has(key)) return pvState.get(key);
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const ready = kind === 'saved' || (kind === 'pack' && (bufferCache.has(id) || packBuilt(id))) || previewBuffers.has(key);
    return { state: ready ? 'ready' : 'idle', p: ready ? 1 : 0 };
  }

  const pvLabel = (st) => (st.state === 'playing' ? 'STOP' : st.state === 'queued' ? 'WAITING' : st.state === 'building' ? `${Math.round(st.p * 100)}%`
    : st.state === 'ready' ? (st.fresh ? 'READY!' : 'PREVIEW') : 'PREVIEW');

  function previewButton(key, title) {
    const st = pvStateFor(key);
    return `<button class="pv${st.fresh ? ' fresh' : ''}" data-preview="${esc(key)}" data-state="${st.state}" style="--p:${st.p || 0}" aria-label="Preview ${esc(title)}">` +
      '<span class="pv-fill"></span><span class="pv-icon"><svg class="pv-play"><use href="#i-play"/></svg><i class="pv-stop"></i></span>' +
      `<small class="pv-txt">${pvLabel(st)}</small></button>`;
  }

  function setPv(key, state, p = state === 'ready' || state === 'playing' ? 1 : 0, fresh = false) {
    const st = { state, p, fresh };
    pvState.set(key, st);
    for (const b of $$(`[data-preview="${CSS.escape(key)}"]`)) {
      b.dataset.state = state;
      b.style.setProperty('--p', p);
      b.classList.toggle('fresh', fresh);
      $('.pv-txt', b).textContent = pvLabel(st);
    }
    if (fresh) setTimeout(() => { const now = pvState.get(key); if (now && now.fresh) setPv(key, now.state, now.p); }, 2600);
  }

  /** Get a song ready to preview (in the queue for built-in songs), showing progress on its button. */
  function preparePreview(key) {
    const id = key.slice(key.indexOf(':') + 1);
    setPv(key, 'queued');
    const job = key.startsWith('pack:')
      ? () => { setPv(key, 'building', 0); return packBuffer(id, (k) => { if (pvStateFor(key).state === 'building') setPv(key, 'building', Math.min(0.99, k)); }); }
      : () => { setPv(key, 'building', 0); return bonusBuffer(id, (k) => setPv(key, 'building', Math.min(0.99, k))); };
    buildQueue = buildQueue.then(job).then(
      () => { if (pvStateFor(key).state !== 'playing') setPv(key, 'ready', 1, true); },
      (err) => { console.warn(err); setPv(key, 'idle'); toast('That preview could not be made: ' + (err.message || err)); });
  }

  async function previewBufferFor(key) {
    const id = key.slice(key.indexOf(':') + 1);
    if (key.startsWith('pack:')) return packBuffer(id);
    if (key.startsWith('bonus:')) return bonusBuffer(id);
    return savedBuffer(id);
  }

  async function playPreview(key) {
    stopPreview();
    preview.key = key;
    setPv(key, 'playing');
    let buf = null;
    try { buf = await previewBufferFor(key); } catch (e) { buf = null; }
    if (preview.key !== key || game) return;
    if (!buf) { setPv(key, 'idle'); preview.key = null; return; }
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const gain = audioCtx.createGain();
    const t = audioCtx.currentTime;
    const from = Math.max(0, Math.min(previewStart(key, buf), buf.duration - PREVIEW_LEN));
    const len = Math.min(PREVIEW_LEN, buf.duration - from);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.3);
    gain.gain.setValueAtTime(1, t + len - 1.5);
    gain.gain.linearRampToValueAtTime(0, t + len);
    src.connect(gain).connect(Sfx.previewBus || audioCtx.destination);
    src.start(t, from, len);
    preview.src = src;
    preview.gain = gain;
    preview.timer = setTimeout(() => { if (preview.key === key) { preview.src = null; stopPreview(); } }, len * 1000);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-preview]');
    if (!b) return;
    e.preventDefault();
    ensureAudio();
    const key = b.dataset.preview;
    const st = pvStateFor(key).state;
    if (st === 'playing') stopPreview();
    else if (st === 'idle') preparePreview(key);
    else if (st === 'ready') playPreview(key);
  });

  /**
   * A song-pack song's audio. Synthesised once per device and kept in the browser
   * (as 16-bit samples), so later loads are instant; rebuilt if the song changes.
   */
  const packPending = new Map(); // id → render in progress (a preview and a load share one)
  const packListeners = new Map(); // id → progress callbacks of everyone waiting on it
  function packBuffer(id, onProgress) {
    if (bufferCache.has(id)) return Promise.resolve(bufferCache.get(id));
    if (onProgress) {
      if (!packListeners.has(id)) packListeners.set(id, new Set());
      packListeners.get(id).add(onProgress);
    }
    if (!packPending.has(id)) {
      const tell = (k) => { for (const f of packListeners.get(id) || []) f(k); };
      packPending.set(id, makePackBuffer(id, tell).finally(() => { packPending.delete(id); packListeners.delete(id); }));
    }
    return packPending.get(id);
  }

  /** The cache stamp of a pack song: changes whenever its composition does. */
  const packStamp = (def) => 'r3:' + hashBytes(new TextEncoder().encode(JSON.stringify(def)).buffer);
  /** Whether this device has a pack song built (a small note beside the big cached audio). */
  function packBuilt(id) {
    try { return !!storage && storage.getItem('beatfrets.built.' + id) === packStamp(SongPack.SONGS.find((s) => s.id === id)); } catch (e) { return false; }
  }
  // Built songs are kept (IndexedDB) so they start instantly next time. To keep that
  // small, the mix is stored as mid (left+right, full quality) plus side (the small
  // left/right difference from gentle panning) at a quarter of the sample rate and
  // 8 bits: about 45% smaller than plain stereo, and it sounds the same.
  const SIDE_STEP = 4;

  function packPcm(buffer) {
    const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
    const n = L.length;
    const mid = new Int16Array(n);
    let sideMax = 1e-6;
    for (let i = 0; i < n; i++) {
      mid[i] = Math.max(-32767, Math.min(32767, Math.round((L[i] + R[i]) * 0.5 * 32767)));
      sideMax = Math.max(sideMax, Math.abs(L[i] - R[i]) * 0.5);
    }
    const side = new Int8Array(Math.ceil(n / SIDE_STEP));
    for (let j = 0; j < side.length; j++) {
      let sum = 0, cnt = 0;
      for (let i = j * SIDE_STEP; i < Math.min(n, (j + 1) * SIDE_STEP); i++) { sum += (L[i] - R[i]) * 0.5; cnt++; }
      side[j] = Math.max(-127, Math.min(127, Math.round((sum / cnt / sideMax) * 127)));
    }
    return { mid, side, sideMax };
  }

  function unpackPcm(cached) {
    const n = cached.mid.length;
    const buffer = audioCtx.createBuffer(2, n, cached.sr);
    const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
    const { side, sideMax } = cached;
    const k = sideMax / 127;
    for (let i = 0; i < n; i++) {
      // Side between its samples, so the stereo spread glides rather than steps.
      const x = i / SIDE_STEP - 0.5;
      const j = Math.max(0, Math.min(side.length - 1, Math.floor(x)));
      const j2 = Math.min(side.length - 1, j + 1);
      const f = Math.max(0, Math.min(1, x - j));
      const sd = (side[j] + (side[j2] - side[j]) * f) * k;
      const m = cached.mid[i] / 32767;
      L[i] = m + sd;
      R[i] = m - sd;
    }
    return buffer;
  }

  async function makePackBuffer(id, onProgress) {
    let buffer;
    const def = SongPack.SONGS.find((s) => s.id === id);
    const stamp = packStamp(def);
    const cached = await Library.cacheGet('pack:' + id);
    if (cached && cached.stamp === stamp && cached.mid) {
      buffer = unpackPcm(cached);
    } else {
      buffer = await SongPack.render(SongPack.build(def), onProgress);
      const pcm = packPcm(buffer);
      Library.cachePut('pack:' + id, { stamp, sr: buffer.sampleRate, ...pcm });
    }
    try { if (storage) storage.setItem('beatfrets.built.' + id, stamp); } catch (e) { /* only a hint */ }
    // Each song is about 25 MB in memory, so only the last few stay; the rest reload from storage.
    bufferCache.delete(id);
    bufferCache.set(id, buffer);
    while (bufferCache.size > 3) bufferCache.delete(bufferCache.keys().next().value);
    const k = 'pack:' + id;
    if (['idle', 'queued', 'building'].includes(pvStateFor(k).state)) setPv(k, 'ready', 1, pvStateFor(k).state !== 'idle');
    return buffer;
  }

  async function savedBuffer(key) {
    const k = 'mp3:' + key;
    if (previewBuffers.has(k)) return previewBuffers.get(k);
    const bytes = await Library.get(key);
    if (!bytes) return null;
    const buf = await audioCtx.decodeAudioData(bytes);
    keepPreview(k, buf);
    return buf;
  }

  /** A bonus track's audio, downloaded and decoded (for a preview). */
  async function bonusBuffer(id, onProgress) {
    const k = 'bonus:' + id;
    if (bonusCache.has(id)) return bonusCache.get(id).buffer;
    if (previewBuffers.has(k)) return previewBuffers.get(k);
    const def = (await fetchBonusIndex()).find((s) => s.id === id);
    if (!def) throw new Error('that bonus track is not on this site.');
    const bytes = await fetchWithProgress('songs/' + encodeURIComponent(def.file), (p) => onProgress && onProgress(p * 0.9));
    const buf = await ensureAudio().decodeAudioData(bytes);
    keepPreview(k, buf);
    return buf;
  }

  // ---- song screen ------------------------------------------------------------------------------

  function miniBoard(key, diff) {
    const rows = save.leaderboard(key, diff, 3);
    const me = save.active;
    if (!rows.length) return '<li class="empty">No scores yet</li>';
    return rows.map((r, i) =>
      `<li class="${!r.rival && me && r.profileId === me.id ? 'me' : ''}"><span>#${i + 1}</span><span>${esc(r.initials)}</span><span class="sc">${r.score.toLocaleString('en-US')}</span><span>${esc(r.grade)}${r.rival ? ' <span class="tag">RIVAL</span>' : ''}</span></li>`
    ).join('');
  }

  function cardStars(d) {
    const p = save.active;
    if (!p) return '';
    const b = save.bestStars(p.id, current.key, d);
    return `<span class="card-stars${b.gold ? ' gold' : ''}">${starsHtml(b.stars)}</span>`;
  }

  function showSong() {
    $('#song-name').textContent = current.title;
    const def = current.kind === 'pack' && SongPack.SONGS.find((x) => x.id === current.packId);
    $('#song-tier').innerHTML = def && def.tier ? tierBadge(def.tier) + `<span>${{ rookie: 'A gentle start, even on Hard.', pro: 'A step up, whatever the difficulty.', boss: 'A tough one, even on Easy.' }[def.tier]}</span>` : '';
    const kind = { pack: 'Chiptune pack: identical charts for everyone', bonus: 'Bonus track: identical charts for everyone', mp3: 'Imported song' }[current.kind];
    $('#song-meta').textContent = `${fmtTime(current.analysis.duration)} · ~${Math.round(current.analysis.bpm)} BPM · ${kind}`;
    const credit = [current.artist, current.credit].filter(Boolean).join(' · ');
    $('#song-credit').hidden = !credit;
    $('#song-credit').textContent = credit;
    const mode = layoutMode();
    if (mode !== 'keys') $('#song-meta').textContent = `${fmtTime(current.analysis.duration)} · ~${Math.round(current.analysis.bpm)} BPM`;
    // Sideways (4 lanes) or upright (2): lit for how the phone is held; tap the other to switch.
    $('#lane-switch').hidden = mode === 'keys' || tilesMode();
    for (const b of $$('#lane-switch [data-lanes]')) b.classList.toggle('on', (b.dataset.lanes === 'landscape') === (mode === 'touch4'));
    const turned = mode !== 'keys' && !tilesMode() && (mode === 'touch4') !== (window.innerWidth > window.innerHeight);
    $('#lane-hint').hidden = !turned;
    $('#lane-hint').textContent = turned ? (mode === 'touch4' ? 'Turn your phone sideways to play on 4 lanes.' : 'Turn your phone upright to play on 2 lanes.') : '';
    $('#screen-song').classList.toggle('tiles', tilesMode());
    if (tilesMode()) $('#song-meta').textContent = `${fmtTime(current.analysis.duration)} · Tap each tile as it reaches the line. Two hearts, and every lap gets faster.`;
    // No-fail is practice: say so before playing, since those runs aren't posted anywhere.
    $('#song-nofail').hidden = !settings.noFail || tilesMode();
    $('#song-match').hidden = !current.matchNote;
    $('#song-match').textContent = current.matchNote || '';
    const todays = current.kind === 'pack' && current.packId === dailyPick().songId;
    const ribbon = (d) => (todays && d === dailyTier(familyOf(d)) ? '<span class="daily-ribbon">★ SONG OF THE DAY</span>' : '');
    $('#diffs').innerHTML = tierIds().map((d) => {
      const c = chartFor(d);
      if (tilesMode()) {
        const base = parseId(d).difficulty;
        return `<div class="diff-col">
          <button class="diff${ribbon(d) ? ' daily' : ''}${insaneLocked(d) ? ' locked' : ''}" data-diff="${d}">${ribbon(d)}<span class="diff-top"><strong>${BASE_LABEL(base)}</strong>${insaneLocked(d) ? '<span class="play-tag lock-tag">🔒 LOCKED</span>' : '<span class="play-tag">PLAY <svg><use href="#i-play"/></svg></span>'}</span>
            <span class="what">${esc(insaneLocked(d) ? UNLOCK_HINT(d) : WHAT_TILES[base])}</span>
            <span class="keys" data-keys="4">${Input.touch ? '<span class="lanes-tag">4 COLUMNS</span>' : ''}</span>
            <span class="stats">${c.notes.length} tiles a lap</span>
            ${tilesBest(d)}
            <span class="wr" data-wr="${d}"></span>
          </button>
          <ol class="mini-board">${miniBoard(current.key, d)}</ol>
        </div>`;
      }
      const n = c.notes.length;
      const holds = c.notes.filter((x) => x.len).length;
      return `<div class="diff-col">
        <button class="diff${ribbon(d) ? ' daily' : ''}${insaneLocked(d) ? ' locked' : ''}" data-diff="${d}">${ribbon(d)}<span class="diff-top"><strong>${BASE_LABEL(parseId(d).difficulty)}</strong>${insaneLocked(d) ? '<span class="play-tag lock-tag">🔒 LOCKED</span>' : '<span class="play-tag">PLAY <svg><use href="#i-play"/></svg></span>'}</span>
          <span class="what">${esc(insaneLocked(d) ? UNLOCK_HINT(d) : (mode === 'keys' ? WHAT : WHAT_TOUCH)[parseId(d).difficulty] || '')}</span>
          <span class="keys" data-keys="${c.lanes}">${mode === 'keys' ? '' : `<span class="lanes-tag">${c.lanes} LANES</span>`}</span>
          <span class="stats">${n} notes · ${(n / Math.max(1, current.analysis.duration)).toFixed(1)}/sec${holds ? ` · ${holds} long` : ''}</span>
          ${cardStars(d)}
          <span class="wr" data-wr="${d}"></span>
        </button>
        <ol class="mini-board">${miniBoard(current.key, d)}</ol>
      </div>`;
    }).join('');
    renderBossBattle(def);
    updateDeviceUI();
    // From the boss battle's row on the song list: straight to its card.
    const toBoss = focusBoss && !$('#boss-battle').hidden;
    focusBoss = false;
    show('song', { focus: toBoss ? '#boss-battle .boss-card' : `[data-diff="${idFor(parseId(lastDifficulty).difficulty)}"]` });
    if (toBoss) requestAnimationFrame(() => $('#boss-battle').scrollIntoView({ block: 'center' }));
    fillRecords();
  }

  /** The BOSS BATTLE card under the difficulties, on a song that has one (not in Tiles). */
  function renderBossBattle(def) {
    const box = $('#boss-battle');
    const battle = def && Boss.battleFor(def.id);
    box.hidden = !battle || tilesMode();
    if (box.hidden) { box.innerHTML = ''; return; }
    const id = idFor('boss');
    const locked = bossLocked(id);
    const prog = bossProgress(def.id);
    const c = chartFor(id);
    const beaten = !locked && bossBeaten(def.id);
    box.innerHTML = `<button class="boss-card${locked ? ' locked' : ''}${beaten ? ' beaten' : ''}" data-diff="${id}" style="--boss:${battle.color}">
        <canvas class="boss-art" width="16" height="20" aria-hidden="true"></canvas>
        <span class="boss-main">
          <span class="boss-top"><strong>☠ BOSS BATTLE</strong>${locked ? '<span class="play-tag lock-tag">🔒 LOCKED</span>' : `<span class="play-tag">${beaten ? 'REMATCH' : 'FIGHT'} <svg><use href="#i-play"/></svg></span>`}</span>
          <span class="boss-name">${esc(battle.name)}${beaten ? '<span class="defeated-tag">✓ DEFEATED</span>' : ''}</span>
          ${beaten ? `<span class="beaten-note">You've beaten this boss! Your best: ${Number(beaten.score).toLocaleString('en-US')}. Rematch any time for a better score.</span>` : ''}
          <span class="what">${locked ? `Get a B or better on Easy, Medium and Hard of all three songs to unlock (${bossCount(prog)} of 9 done):` : 'Hard notes, and the boss fights back: blackouts, skull trap notes (don\'t hit them!), speed surges' + (layoutMode() === 'keys' ? ' and swapped lanes' : '') + '. Misses hurt twice as much and heal it. Hit the glowing notes to charge a Fireball, then ' + (layoutMode() === 'keys' ? `press ${esc(Input.glyph('overdrive'))}` : 'swipe up') + ' to launch it. Beat the boss before the song ends!'}</span>
          ${locked ? bossNeedHtml(prog) : `<span class="stats">${c.notes.length} notes · ${Math.floor(Boss.powerNotes(c.notes).size)} power notes</span>`}
          ${cardStars(id)}
          <span class="wr" data-wr="${id}"></span>
        </span>
      </button>
      <ol class="mini-board">${miniBoard(current.key, id)}</ol>`;
    // The boss's portrait, from its sprite.
    const art = Boss.SPRITES[battle.id];
    const cv = $('.boss-art', box);
    cv.height = art.rows.length;
    const g = cv.getContext('2d');
    art.rows.forEach((row, y) => [...row].forEach((k, x) => { if (k !== '.') { g.fillStyle = art.palette[k]; g.fillRect(x, y, 1, 1); } }));
  }
  $('#boss-battle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-diff]');
    if (b) play(b.dataset.diff, {});
  });

  // ---- world records on the song list and difficulty cards ---------------------------------------------

  /**
   * The #1 world score on a board (cached for a couple of minutes), or null when
   * nobody has one. worldRecordOr fails (rather than saying "nobody") when the
   * world boards can't be reached, so callers can fall back to this device.
   */
  const recordCache = new Map();
  function worldRecordOr(id) {
    const hit = recordCache.get(id);
    if (hit && Date.now() - hit.at < 120000) return hit.p;
    const p = Promise.race([
      World.top(id, 1).then((rows) => rows[0] || null),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]);
    recordCache.set(id, { p, at: Date.now() });
    p.catch(() => recordCache.delete(id));
    return p;
  }
  const worldRecord = (id) => worldRecordOr(id).catch(() => null);

  /** The world boards of a song, per tier of the current mode (imported songs: the ones you've played). */
  function songBoards(key, chartOf, tiers = tierIds()) {
    const out = {};
    for (const d of tiers) {
      let id = null;
      if (/^(pack|bonus):/.test(key)) id = World.boardId(key, d);
      else if (chartOf && chartOf(d)) id = World.boardId(key, d, chartOf(d));
      else {
        const run = save.data.runs.slice().reverse().find((r) => r.songKey === key && r.difficulty === d && r.world);
        if (run) id = run.world;
      }
      if (id) out[d] = id;
    }
    return out;
  }

  /** Your best on a tier on this device (0 if never played). */
  function myBest(key, d) {
    const p = save.active;
    const b = p && save.personalBest(p.id, key, d);
    return b ? b.score : 0;
  }

  /** The best score on this device for a tier (players here and shared rivals), or null. */
  function localRecord(key, d) {
    const r = save.leaderboard(key, d, 1)[0];
    if (!r) return null;
    return { initials: r.initials, score: r.score, mine: !r.rival && !!save.active && r.profileId === save.active.id, local: true };
  }

  /**
   * Who holds each tier's record on a song, for the current mode: the world
   * record when the world boards answer, otherwise the best on this device.
   * Resolves to { tier: record | null }.
   */
  async function songRecords(key, tiers = tierIds()) {
    const boards = World.available() ? songBoards(key, null, tiers) : {};
    const out = {};
    await Promise.all(tiers.map(async (d) => {
      if (!boards[d]) { out[d] = localRecord(key, d); return; }
      try { out[d] = await worldRecordOr(boards[d]); } catch (e) { out[d] = localRecord(key, d); }
    }));
    return out;
  }

  /** Tiers of a song where someone else holds a better record than yours. */
  async function recordsToBeat(key) {
    const recs = await songRecords(key);
    return Object.entries(recs).filter(([d, r]) => r && !r.mine && Number(r.score) > myBest(key, d)).length;
  }

  const holderName = (r) => (r.mine ? 'YOU' : String(r.initials || '???').toUpperCase());

  /** A song row's leader tags: one per tier, "E ZED", "M YOU", "H —". */
  function leaderTags(recs, tiers = tierIds()) {
    const ds = tiers.filter((d) => d in recs);
    if (!ds.some((d) => recs[d])) return '<span class="ldr none">NO LEADER YET</span>';
    // One difficulty picked (Boards): just its leader and score.
    if (ds.length === 1) {
      const r = recs[ds[0]];
      return `<svg class="ldr-crown"><use href="#i-crown"/></svg><span class="ldr${r.mine ? ' you' : ''}">${esc(holderName(r))}</span><span class="ldr-score">${Number(r.score).toLocaleString('en-US')}</span>`;
    }
    return '<svg class="ldr-crown"><use href="#i-crown"/></svg>' + ds.map((d) => {
      const r = recs[d];
      return `<span class="ldr${r ? (r.mine ? ' you' : '') : ' open'}"><i>${SHORT_BASE[parseId(d).difficulty] || SHORT[d]}</i>${r ? esc(holderName(r)) : '—'}</span>`;
    }).join('');
  }

  /** A category's summary: "7 OF 12 CLAIMED · YOU 2 · ZED 4", or that none are. */
  function catSummary(all) {
    const total = all.reduce((n, recs) => n + Object.keys(recs).length, 0);
    const holders = new Map();
    let claimed = 0;
    for (const recs of all) for (const r of Object.values(recs)) {
      if (!r) continue;
      claimed++;
      const k = holderName(r);
      holders.set(k, (holders.get(k) || 0) + 1);
    }
    if (!claimed) return '<span class="cat-none">NO RECORDS YET · BE THE FIRST</span>';
    const list = [...holders.entries()].sort((a, b) => (b[0] === 'YOU') - (a[0] === 'YOU') || b[1] - a[1]);
    const shown = list.slice(0, 3).map(([k, n]) => `<span class="ldr${k === 'YOU' ? ' you' : ''}">${esc(k)} <i>${n}</i></span>`).join('');
    const more = list.length > 3 ? `<span class="ldr more">+${list.length - 3}</span>` : '';
    return `<span class="cat-claimed"><svg><use href="#i-crown"/></svg>${claimed} OF ${total} CLAIMED</span>${shown}${more}`;
  }

  /** Fill in every category summary and song-row leader tags under `root`. */
  function fillCatSummaries(root, tiers = tierIds()) {
    if (!root) return;
    for (const cat of $$('.cat', root)) {
      const rows = $$('[data-key]', $('.cat-body', cat));
      const sum = $('.cat-sum', cat);
      Promise.all(rows.map((row) => songRecords(row.dataset.key, tiers).then((recs) => {
        const el = $('.leaders', row);
        if (el) el.innerHTML = leaderTags(recs, tiers);
        row.classList.toggle('led', Object.values(recs).some(Boolean));
        return recs;
      }))).then((all) => { if (sum && sum.isConnected) sum.innerHTML = catSummary(all); });
    }
  }

  /** Song list rows: a red ⚔ badge when there are records to beat. */
  function markRecords() {
    if (!save.active) return;
    for (const row of $$('[data-pack], [data-bonus], [data-saved]')) {
      const key = row.dataset.pack ? SongPack.keyFor(SongPack.SONGS.find((x) => x.id === row.dataset.pack))
        : row.dataset.bonus ? BonusPack.keyFor(row.dataset.bonus) : row.dataset.saved;
      recordsToBeat(key).then((n) => {
        const side = $('.row-side', row);
        if (!n || !side || $('.rec-tag', side)) return;
        side.insertAdjacentHTML('afterbegin', `<span class="rec-tag"><svg><use href="#i-sword"/></svg>${n} TO BEAT</span>`);
      });
    }
  }

  /**
   * Difficulty cards: the world record on each tier, and how far you are from it
   * (red and negative when behind, counting a tier you've never played as 0;
   * green when the record is yours).
   */
  function fillRecords() {
    if (!World.available() || !current) return;
    const key = current.key;
    const fmt = (n) => Number(n).toLocaleString('en-US');
    const boards = songBoards(key, chartFor, tilesMode() ? tierIds() : tiersFor(layoutMode(), key));
    for (const el of $$('#screen-song [data-wr]')) {
      const d = el.dataset.wr;
      if (!boards[d]) continue;
      el.innerHTML = '<span class="wr-wait">WORLD RECORD…</span>';
      worldRecord(boards[d]).then((r) => {
        if (!current || current.key !== key || !el.isConnected) return;
        if (!r) { el.innerHTML = '<span class="wr-none">NO WORLD RECORD YET</span>'; return; }
        const mine = myBest(key, d);
        const gap = mine - Number(r.score);
        el.innerHTML = `<span class="wr-who"><svg><use href="#i-crown"/></svg>${esc(r.initials)} ${fmt(r.score)}</span>` +
          (r.mine ? '<span class="wr-gap ahead word">YOU HOLD THE RECORD</span>'
            : gap > 0 ? `<span class="wr-gap ahead">+${fmt(gap)}</span><span class="wr-note">POST YOUR BEST TO TAKE IT</span>`
              : gap === 0 ? '<span class="wr-gap ahead word">TIED WITH THE RECORD</span>'
                : `<span class="wr-gap behind">-${fmt(-gap)}</span><span class="wr-note">${mine ? 'TO BEAT THE RECORD' : 'NOT PLAYED YET'}</span>`);
      });
    }
  }

  $('#lane-switch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lanes]');
    if (!b || b.classList.contains('on')) return;
    // Lock the screen that way where the phone allows it (an installed app); otherwise
    // the hint asks the player to turn it, and the game follows when they do.
    session.orient = b.dataset.lanes;
    orientation.want(session.orient);
    applyLayout();
    showSong();
    renderCrumbs(screen);
  });

  $('#diffs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-diff]');
    if (b) play(b.dataset.diff, {});
  });

  // ---- playing --------------------------------------------------------------------------------------

  let gameLayout = 'keys';
  let pendingPlay = null;
  // Set by a world-board challenge: { key, chart, boardId, target:{initials, score} }.
  // Kept for PLAY AGAIN; picking a tier on the song screen clears it.
  let playOpts = {};

  async function play(difficulty, opts) {
    if (!current) return;
    if (opts) playOpts = opts;
    if (playOpts.key && playOpts.key !== current.key) playOpts = {};
    const tier = parseId(difficulty);
    if (insaneLocked(difficulty)) { toast(`INSANE is locked: ${UNLOCK_HINT(difficulty)}.`); return; }
    if (bossLocked(difficulty)) { toast('The boss battle is locked: get a B or better on Easy, Medium and Hard of all three of its category\'s songs.'); return; }
    const battle = tier.difficulty === 'boss' ? battleOf(current.key) : null;
    if (tier.tiles) { playTiles(difficulty); return; }
    // The first game starts straight away; moving the strike line and the timing test are
    // offered on the results screen when they'd help.
    lastDifficulty = difficulty;
    stopPreview();
    restartHold.cancel();
    resultsAnim = null;
    if (game) game.stop();
    ensureAudio();
    await document.fonts.load('8px "Press Start 2P"').catch(() => {});
    show(null);
    $('#pause').hidden = true;
    $('#pause-msg').textContent = '';
    $('#btn-resume').disabled = false;
    gameLayout = tier.touch ? 'touch' + tier.lanes : 'keys';
    stage.setLayout(gameLayout, window.innerWidth / window.innerHeight);
    wakeLock.acquire();
    const chart = playOpts.chart || chartFor(difficulty);
    Input.setGameplay(true, chart.lanes);
    game = new Game({
      audioCtx,
      buffer: current.buffer,
      chart,
      beats: current.analysis.beats,
      stage,
      lookahead: (LOOKAHEAD[tier.difficulty] || 1.5) / settings.speed,
      calibration: (tier.touch ? settings.calibrationTouchMs : settings.calibrationMs) / 1000,
      noFail: settings.noFail,
      // Insane: a tighter timing window, and misses drain the rock meter faster.
      windowScale: (tier.touch ? 1.15 : 1) * (tier.difficulty === 'insane' ? 0.85 : 1),
      missMul: tier.difficulty === 'insane' ? 1.3 : 1,
      holdGrace: tier.touch ? 0.12 : 0,
      vibrate: tier.touch && settings.vibrate,
      hitSounds: settings.hitSounds,
      playerColor: save.active ? save.active.color : '#58f8f8',
      best: !playOpts.chart && save.active ? save.pace(save.active.id, current.key, difficulty) : null,
      rival: playOpts.target ? { initials: playOpts.target.initials, score: playOpts.target.score, timeline: playOpts.target.timeline || null } : null,
      boss: battle,
      touch: !!tier.touch,
      intro: { title: current.title.toUpperCase().slice(0, 40), sub: (playOpts.target ? `BEAT ${playOpts.target.initials}: ${playOpts.target.score.toLocaleString('en-US')}` : battle ? 'BOSS BATTLE: ' + battle.name : LABEL(difficulty)) + (settings.noFail ? ' · NO-FAIL PRACTICE' : '') },
      onEnd: (res) => {
        game = null;
        wakeLock.release();
        Input.setGameplay(false);
        applyLayout();
        showResults(difficulty, res, chart);
      },
      onPauseChange: (paused) => {
        $('#pause').hidden = !paused;
        Input.setGameplay(!paused, chart.lanes);
        if (paused) requestAnimationFrame(() => $('#btn-resume').focus());
      },
    });
    game.shakeEnabled = settings.shake;
    await game.start();
  }

  // ---- Tiles mode ------------------------------------------------------------------------------------

  async function playTiles(id) {
    const tier = parseId(id);
    lastDifficulty = id;
    stopPreview();
    restartHold.cancel();
    resultsAnim = null;
    if (game) game.stop();
    ensureAudio();
    await document.fonts.load('8px "Press Start 2P"').catch(() => {});
    show(null);
    $('#pause').hidden = true;
    $('#pause-msg').textContent = '';
    $('#btn-resume').disabled = false;
    gameLayout = 'tiles';
    stage.setLayout('tiles', window.innerWidth / window.innerHeight);
    wakeLock.acquire();
    Input.setGameplay(true, 4);
    game = new TilesGame({
      audioCtx,
      buffer: current.buffer,
      chart: playOpts.chart || chartFor(id),
      stage,
      tier: tier.difficulty,
      rival: playOpts.target ? { initials: playOpts.target.initials, score: playOpts.target.score, timeline: playOpts.target.timeline || null, laps: playOpts.target.laps || 0 } : null,
      speed: settings.speed,
      duration: current.analysis.duration,
      beats: current.analysis.beats,
      lineUp: settings.tilesLineUp,
      calibration: (Input.touch ? settings.calibrationTouchMs : settings.calibrationMs) / 1000,
      vibrate: Input.touch && settings.vibrate,
      intro: { title: current.title.toUpperCase().slice(0, 40), sub: playOpts.target ? `BEAT ${playOpts.target.initials}: ${playOpts.target.score.toLocaleString('en-US')}` : LABEL(id) },
      onEnd: (res) => {
        game = null;
        wakeLock.release();
        Input.setGameplay(false);
        applyLayout();
        showTilesResults(id, res);
      },
      onPauseChange: (paused) => {
        $('#pause').hidden = !paused;
        Input.setGameplay(!paused, 4);
        if (paused) requestAnimationFrame(() => $('#btn-resume').focus());
      },
    });
    await game.start();
  }

  /** Best Tiles result on this song and tier: stars, or crowns once you've looped. */
  function bestTiles(songKey, id) {
    const p = save.active;
    let best = null;
    for (const r of save.data.runs) {
      if (!p || r.profileId !== p.id || r.songKey !== songKey || r.difficulty !== id) continue;
      if (!best || (r.crowns || 0) * 10 + (r.stars || 0) > (best.crowns || 0) * 10 + (best.stars || 0)) best = r;
    }
    return best;
  }
  function tilesBadge(stars, crowns) {
    return crowns ? `<b>${'♛'.repeat(Math.min(5, crowns))}</b>` : `<b>${'★'.repeat(stars)}</b>${'★'.repeat(3 - stars)}`;
  }
  function tilesBest(id) {
    const b = bestTiles(current.key, id);
    return `<span class="card-stars">${tilesBadge(b ? b.stars || 0 : 0, b ? b.crowns || 0 : 0)}</span>`;
  }

  function showTilesResults(id, res) {
    const p = save.active;
    const before = bestTiles(current.key, id);
    const run = {
      profileId: p ? p.id : null,
      initials: p ? p.initials : '---',
      songKey: current.key,
      title: current.title,
      difficulty: id,
      score: res.score,
      grade: res.grade,
      accuracy: res.accuracy,
      maxCombo: res.maxCombo,
      fullCombo: false,
      hits: res.tiles,
      failed: false,
      stars: res.stars,
      crowns: res.crowns,
      fp: current.kind === 'mp3' ? current.fp : undefined,
      world: World.boardId(current.key, id, chartFor(id)),
    };
    // A challenge on someone else's notes goes on their world board only.
    const outcome = p && !playOpts.chart ? save.addRun(run) : null;
    lastRun = outcome ? outcome.entry : { ...run, date: new Date().toISOString() };
    $('#tr-title').textContent = `${current.title.toUpperCase().slice(0, 40)} · ${LABEL(id)}`;
    $('#tr-score').textContent = res.score.toLocaleString('en-US');
    $('#tr-stars').innerHTML = tilesBadge(res.stars, res.crowns) + (res.crowns ? ` <span class="hint">${res.crowns} CROWN${res.crowns > 1 ? 'S' : ''}</span>` : '');
    const target = playOpts.target;
    const won = !!target && res.score > target.score;
    $('#tr-flag').textContent = target
      ? (won ? `YOU BEAT ${target.initials}!` : res.score === target.score ? `TIED WITH ${target.initials}!` : `${target.initials} LEADS BY ${(target.score - res.score).toLocaleString('en-US')}`)
      : outcome && outcome.personalBest ? (before ? 'NEW PERSONAL BEST!' : 'FIRST CLEAR!') : '';
    $('#tr-tiles').textContent = res.tiles;
    $('#tr-perfect').textContent = res.counts.perfect;
    $('#tr-great').textContent = res.counts.great;
    $('#tr-cool').textContent = res.counts.cool;
    $('#tr-miss').textContent = res.counts.miss + res.counts.wrong;
    $('#tr-combo').textContent = res.maxCombo;
    $('#tr-laps').textContent = `${res.laps} · TOP SPEED x${res.topSpeed.toFixed(2)}`;
    const panel = worldPanel('tr', worldFor(id, playOpts.chart || chartFor(id)), p ? {
      initials: p.initials, score: Math.round(res.score), grade: res.grade, accuracy: +res.accuracy.toFixed(2),
      maxCombo: res.maxCombo, fullCombo: false, stars: res.stars || 0, crowns: res.crowns || 0,
      laps: res.laps, topSpeed: +res.topSpeed.toFixed(2),
      date: new Date().toISOString().slice(0, 10), ver: VERSION,
      tl: (res.timeline || []).slice(0, 400).map((x) => Math.round(x)),
      ...(won ? { beat: target.initials } : {}),
    } : null);
    if (won) tellBeaten(panel, worldFor(id, playOpts.chart || chartFor(id)), target, Math.round(res.score), id);
    dailyPanel('trd', id, worldFor(id, playOpts.chart || chartFor(id)), p && !playOpts.chart ? {
      initials: p.initials, score: Math.round(res.score), grade: res.grade, accuracy: +res.accuracy.toFixed(2),
      maxCombo: res.maxCombo, fullCombo: false, stars: res.stars || 0, crowns: res.crowns || 0,
      laps: res.laps, topSpeed: +res.topSpeed.toFixed(2),
      date: new Date().toISOString().slice(0, 10), ver: VERSION,
      tl: (res.timeline || []).slice(0, 400).map((x) => Math.round(x)),
    } : null);
    show('tiles-results');
    if (target) setTimeout(() => { if (screen === 'tiles-results') openOutcome(res, target, panel); }, 900);
  }
  $('#btn-tr-retry').addEventListener('click', () => play(lastDifficulty));
  // Tiles START screen: drag the line up or down (a tap starts the song).
  let tilesDrag = null;
  $('#stage').addEventListener('pointerdown', (e) => {
    if (game instanceof TilesGame && game.waiting) tilesDrag = { id: e.pointerId, y: e.clientY };
  });
  $('#stage').addEventListener('pointermove', (e) => {
    if (!tilesDrag || tilesDrag.id !== e.pointerId || !(game instanceof TilesGame) || !game.waiting) return;
    if (!game.dragged && Math.abs(e.clientY - tilesDrag.y) < 8) return;
    save.setSetting('tilesLineUp', game.dragLine(e.clientY));
  });
  window.addEventListener('pointerup', () => { tilesDrag = null; });
  $('#btn-tr-board').addEventListener('click', () => openBoard(current.key, current.title, lastDifficulty, 'tiles-results'));
  // ---- home: pick a game, then (Beat Frets on a phone) which way up, then a song ----

  const MODE_LABEL = { frets: 'BEAT FRETS', tiles: 'TILES' };
  function enterMode(mode) {
    session.mode = mode;
    session.orient = null;
    save.setSetting('playMode', mode);
    if (mode === 'tiles') {
      // Tiles is played upright only (locked that way where the phone allows).
      session.orient = Input.touch ? 'portrait' : null;
      orientation.want(session.orient);
      goSongs();
      return;
    }
    // Beat Frets on a phone follows how it's held: sideways is 4 lanes, upright 2.
    applyLayout();
    goSongs();
  }
  function goSongs(which = 'pack') {
    $('#screen-pack').dataset.back = 'main';
    $('#screen-import').dataset.back = 'main';
    if (which === 'import') renderImport(); else renderPack();
    show(which);
  }
  /** Leaving a mode (back to the home screen): unlock the orientation. */
  function leaveMode() {
    if (!session.mode && !orientation.wanted) return;
    session.mode = null;
    session.orient = null;
    orientation.release();
    applyLayout();
  }
  function goHome() {
    if (game) {
      game.stop();
      game = null;
      wakeLock.release();
      Input.setGameplay(false);
      $('#pause').hidden = true;
    }
    Sfx.back();
    renderMain();
    show('main');
  }
  /** The marquee bar: back, what this screen is and where you are, then home or your player. */
  function renderCrumbs(name) {
    const el = name && $('#screen-' + name);
    const title = el && el.dataset.title;
    const bar = $('#crumbs');
    bar.hidden = !title;
    const tab = el && el.dataset.tab;
    $('#tabbar').hidden = !tab;
    $$('#tabbar [data-tab-btn]').forEach((b) => b.classList.toggle('on', b.dataset.tabBtn === tab));
    document.body.classList.toggle('has-top', !!title);
    document.body.classList.toggle('has-tabs', !!tab);
    if (!title) return;
    bar.classList.toggle('home', name === 'main');
    $('#btn-back').hidden = !!tab;
    $('#btn-home').hidden = !!tab;
    $('#btn-player-chip').hidden = !tab;
    $('#topbar-title').textContent = name === 'main' ? 'BEAT FRETS' : title;
    const IN_MODE = ['frets-setup', 'pack', 'import', 'song', 'results', 'tiles-results', 'board', 'share', 'calib-offer'];
    const parts = [];
    if (session.mode && IN_MODE.includes(name)) {
      const lm = layoutMode();
      parts.push(MODE_LABEL[session.mode] + (session.mode === 'frets' && lm !== 'keys' ? (lm === 'touch4' ? ' · 4 LANES' : ' · 2 LANES') : ''));
      if (current && !['frets-setup', 'pack', 'import'].includes(name)) parts.push(current.title.toUpperCase().slice(0, 28));
    } else if (name === 'board' && boardState.title) parts.push(boardState.title.toUpperCase().slice(0, 28));
    else if (name === 'license') { const lp = worldPlayers.find((x) => x.sid === licenseSid); if (lp) parts.push(lp.initials); }
    $('#crumbs-path').textContent = parts.join(' › ');
  }
  $('#btn-mode-frets').addEventListener('click', () => enterMode('frets'));
  $('#btn-mode-tiles').addEventListener('click', () => enterMode('tiles'));
  $('#screen-frets-setup').addEventListener('click', (e) => {
    const b = e.target.closest('[data-orient]');
    if (!b) return;
    session.orient = b.dataset.orient;
    orientation.want(session.orient);
    applyLayout();
    goSongs();
  });
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-songs]');
    if (tab) { goSongs(tab.dataset.songs); return; }
    if (e.target.closest('[data-go-songs]')) goSongs(songOrigin === 'import' ? 'import' : 'pack');
  });
  $('#btn-home').addEventListener('click', goHome);
  /** Stop the song in progress and go back to the song screen. */
  function quitToSong() {
    if (game) game.stop();
    game = null;
    wakeLock.release();
    Input.setGameplay(false);
    applyLayout();
    $('#pause').hidden = true;
    showSong();
  }
  $('#btn-rotate-back').addEventListener('click', quitToSong);
  // Held the other way mid-song: start it again on the lanes for how the phone is held now.
  $('#btn-rotate-swap').addEventListener('click', () => {
    const base = parseId(lastDifficulty).difficulty;
    if (game) game.stop();
    game = null;
    session.orient = null;
    orientation.release();
    applyLayout();
    const id = idFor(base);
    play(tierIds().includes(id) || base === 'boss' ? id : idFor('medium'), {});
  });

  $('#btn-resume').addEventListener('click', () => game && game.resume());
  $('#btn-pause-close').addEventListener('click', () => game && game.resume());
  $('#btn-restart').addEventListener('click', () => { $('#pause').hidden = true; play(lastDifficulty); });
  $('#btn-quit').addEventListener('click', quitToSong);

  // ---- hold to restart ------------------------------------------------------------------------------

  const restartHold = (() => {
    let started = 0;
    let raf = 0;
    const tick = () => {
      if (!started || !game) return;
      const k = (performance.now() - started) / 1000;
      game.restartProgress = k;
      if (k >= 1) { started = 0; play(lastDifficulty); return; }
      raf = requestAnimationFrame(tick);
    };
    return {
      start() { if (started) return; started = performance.now(); raf = requestAnimationFrame(tick); },
      cancel() { started = 0; cancelAnimationFrame(raf); if (game) game.restartProgress = 0; },
    };
  })();

  // ---- results -------------------------------------------------------------------------------------

  let resultsAnim = null; // finishes the count-up early when set

  const NEXT_TIER = { easy: 'medium', medium: 'hard' };
  const PREV_TIER = { medium: 'easy', hard: 'medium', insane: 'hard' };

  function starsHtml(n, gold) {
    return `<b>${'★'.repeat(n)}</b>${'★'.repeat(5 - n)}${gold ? '' : ''}`;
  }

  function drawGraph(canvas, graph) {
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    g.fillStyle = '#08081a';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1a1d48';
    for (const y of [H * 0.25, H * 0.5, H * 0.75]) g.fillRect(0, Math.round(y), W, 1);
    const bw = W / graph.length;
    graph.forEach((b, i) => {
      if (b.acc == null) return;
      const h = Math.max(1, Math.round((H - 6) * b.acc));
      g.fillStyle = b.acc >= 0.95 ? '#58f8f8' : b.acc >= 0.8 ? '#38d838' : b.acc >= 0.6 ? '#f8d830' : '#f84848';
      g.fillRect(Math.round(i * bw) + 1, H - h, Math.max(1, Math.round(bw) - 2), h);
      if (b.miss) { g.fillStyle = '#f84848'; g.fillRect(Math.round(i * bw) + 1, 1, Math.max(1, Math.round(bw) - 2), 2); }
    });
  }

  function showResults(difficulty, res, chart) {
    const p = save.active;
    const world = worldFor(difficulty, chart);
    const run = {
      profileId: p ? p.id : null,
      initials: p ? p.initials : '---',
      songKey: current.key,
      title: current.title,
      difficulty,
      score: res.score,
      grade: res.grade,
      accuracy: res.accuracy,
      maxCombo: res.maxCombo,
      fullCombo: res.fullCombo,
      hits: res.hits,
      failed: res.failed,
      practice: !!res.practice,
      stars: res.stars,
      goldStars: res.goldStars,
      timeline: res.timeline,
      fp: current.kind === 'mp3' ? current.fp : undefined,
      world: world.id,
    };
    // A challenge is someone else's chart, so it goes on their world board only.
    const outcome = p && !playOpts.chart ? save.addRun(run) : null;
    lastRun = outcome ? outcome.entry : { ...run, date: new Date().toISOString() };

    $('#res-title').textContent = `${current.title.toUpperCase().slice(0, 40)} · ${LABEL(difficulty)}`;
    $('#res-hold-row').hidden = res.holdPct == null;
    $('#res-hold').textContent = res.holdPct == null ? '' : res.holdPct.toFixed(0) + '%';
    const gradeEl = $('#res-grade');
    gradeEl.textContent = '';
    gradeEl.className = 'grade';
    $('#res-acc').textContent = res.accuracy.toFixed(1) + '%';
    $('#res-perfect').textContent = res.counts.perfect;
    $('#res-good').textContent = res.counts.good;
    $('#res-ok').textContent = res.counts.ok;
    $('#res-miss').textContent = res.counts.miss;
    $('#res-combo').textContent = `${res.maxCombo} / ${res.total}`;
    $('#btn-share').disabled = res.failed || !!res.practice;

    // Stars and the next target.
    const starsEl = $('#res-stars');
    starsEl.innerHTML = starsHtml(0);
    starsEl.classList.toggle('gold', res.goldStars);
    const st = Game.stars(res.score, res.maxScore);
    $('#res-next').textContent = res.failed ? '' : res.goldStars ? 'GOLD STARS: perfect run!'
      : st.next ? `Next star at ${st.next.toLocaleString('en-US')}` : 'Full combo for gold stars';

    drawGraph($('#res-graph'), res.graph);
    renderBossResult(res.boss);

    // Timing advice: suggest a calibration change when hits lean one way.
    const avg = res.avgOffset;
    const applyBtn = $('#btn-apply-offset');
    applyBtn.hidden = true;
    if (res.timingSamples >= 20 && Math.abs(avg) >= 15) {
      $('#res-timing').textContent = `Your hits landed ${Math.abs(avg)} ms ${avg > 0 ? 'late' : 'early'} on average. If that felt on time, adjust the timing.`;
      const calKey = parseId(difficulty).touch ? 'calibrationTouchMs' : 'calibrationMs';
      const next = Math.max(-200, Math.min(200, settings[calKey] + avg));
      applyBtn.textContent = `ADJUST TIMING (${avg > 0 ? '+' : ''}${avg} MS)`;
      applyBtn.hidden = false;
      applyBtn.onclick = () => {
        save.setSetting(calKey, next);
        delete draft[calKey];
        renderOptions();
        applyBtn.hidden = true;
        $('#res-timing').textContent = `Timing adjusted to ${next} ms. Change it any time in Options.`;
      };
    } else {
      $('#res-timing').textContent = res.timingSamples ? `Timing: right on (${Math.abs(avg)} ms ${avg >= 0 ? 'late' : 'early'} on average).` : '';
    }

    // Phones: after the first game, or one where hits went astray, offer to move the strike
    // line or run the timing test.
    const touchGame = parseId(difficulty).touch;
    const setupTip = touchGame && !res.failed && (!settings.touchSetupTip || res.accuracy < 70 || (res.timingSamples >= 20 && Math.abs(avg) >= 15));
    $('#res-setup').hidden = !setupTip;
    if (setupTip) {
      $('#res-setup-msg').textContent = !settings.touchSetupTip
        ? 'First game on this phone? If notes felt early or late, take the 10-second timing test. If the line felt too high or low for your thumbs, move it.'
        : 'Hits going astray? The 10-second timing test lines the notes up with what you hear, and the line can move to where your thumbs rest.';
      save.setSetting('touchSetupTip', true);
    }

    // What to try next.
    let suggest = '';
    const base = parseId(difficulty).difficulty;
    const tierLabel = (b) => LABEL(idFor(b));
    if (res.boss && !res.boss.defeated) {
      suggest = res.boss.bossWon ? `${res.boss.name} had ${res.boss.hp}% health left. Hit the glowing notes to charge Fireballs, and launch each one as soon as it's ready.`
        : 'Tough one. Hit the glowing notes to charge Fireballs, and launch each one as soon as it\'s ready.';
    } else if (res.failed) {
      suggest = PREV_TIER[base] ? `Tough one. Try ${tierLabel(PREV_TIER[base])}, or turn on No-fail in Options.` : 'Tough one. Turn on No-fail in Options to play it through.';
    } else if ((res.grade === 'S' || res.stars >= 4) && NEXT_TIER[base]) {
      suggest = `Ready for ${tierLabel(NEXT_TIER[base])}?`;
    } else if (/^[SAB]/.test(res.grade) && base === 'hard' && !res.practice) {
      suggest = 'INSANE is unlocked for this song: faster, tighter, chords everywhere.';
    }
    $('#res-suggest').textContent = suggest;

    let flag = '';
    let celebrate = false;
    if (res.boss && res.boss.bossWon) flag = 'BOSS WINS: TRY AGAIN';
    else if (res.failed) flag = 'SONG FAILED. TRY NO-FAIL MODE IN OPTIONS.';
    else if (res.practice) flag = 'NO-FAIL PRACTICE RUN · NOT ON LEADERBOARDS';
    else if (outcome) {
      const board = save.leaderboard(current.key, difficulty, 100);
      if (outcome.personalBest && outcome.previousBest) { flag = 'NEW PERSONAL BEST!'; celebrate = true; }
      else if (outcome.rank === 1 && board.length > 1) { flag = '#1 ON THIS BOARD!'; celebrate = true; }
      else if (outcome.rank) flag = `RANK #${outcome.rank} ON THIS BOARD`;
      if (res.fullCombo) flag += (flag ? ' · ' : '') + 'FULL COMBO!';
      if (res.boss && res.boss.defeated) { flag = 'BOSS DEFEATED!' + (flag ? ' · ' + flag : ''); celebrate = true; }
    }
    if (res.boss && res.boss.defeated && res.practice) flag = 'BOSS DEFEATED (NO-FAIL PRACTICE: NOT ON LEADERBOARDS)';
    const target = res.practice ? null : playOpts.target;
    if (playOpts.target && res.practice) flag = 'NO-FAIL PRACTICE: TURN IT OFF IN OPTIONS TO TAKE ON THE CHALLENGE';
    if (target && !res.failed) {
      flag = res.score > target.score ? `YOU BEAT ${target.initials}!`
        : res.score === target.score ? `TIED WITH ${target.initials}!`
          : `${target.initials} LEADS BY ${(target.score - res.score).toLocaleString('en-US')}`;
      celebrate = res.score > target.score;
      if (res.fullCombo) flag += ' · FULL COMBO!';
    }
    const flagEl = $('#res-flag');
    flagEl.textContent = '';
    flagEl.className = 'flag';
    const won = !!target && !res.failed && res.score > target.score;
    const panel = worldPanel('res', world, p && !res.failed && !res.practice ? {
      initials: p.initials, score: Math.round(res.score), grade: res.grade, accuracy: +res.accuracy.toFixed(2),
      maxCombo: res.maxCombo, fullCombo: !!res.fullCombo, stars: res.stars || 0,
      date: new Date().toISOString().slice(0, 10), ver: VERSION,
      // The score through the song, so later challengers can race it.
      tl: (res.timeline || []).slice(0, 400).map((x) => Math.round(x)),
      ...(won ? { beat: target.initials } : {}),
    } : null);
    if (won) tellBeaten(panel, world, target, Math.round(res.score), difficulty);
    dailyPanel('resd', difficulty, world, p && !res.failed && !res.practice && !playOpts.chart ? {
      initials: p.initials, score: Math.round(res.score), grade: res.grade, accuracy: +res.accuracy.toFixed(2),
      maxCombo: res.maxCombo, fullCombo: !!res.fullCombo, stars: res.stars || 0,
      date: new Date().toISOString().slice(0, 10), ver: VERSION,
      tl: (res.timeline || []).slice(0, 400).map((x) => Math.round(x)),
    } : null);
    show('results');

    // Count the score up, then stamp the grade. Any key or button skips ahead.
    const scoreEl = $('#res-score');
    const t0 = performance.now();
    const dur = Math.min(1400, 400 + res.score / 50);
    let lastTick = 0;
    let skip = false;
    resultsAnim = () => { skip = true; };
    const step = (now) => {
      const k = skip ? 1 : Math.min(1, (now - t0) / dur);
      scoreEl.textContent = Math.round(res.score * k).toLocaleString('en-US');
      if (now - lastTick > 60 && k < 1) { Sfx.tick(); lastTick = now; }
      if (k < 1) { requestAnimationFrame(step); return; }
      resultsAnim = null;
      gradeEl.textContent = res.grade;
      gradeEl.className = `grade stamp ${res.grade}`;
      starsEl.innerHTML = starsHtml(res.stars);
      Sfx.stamp();
      setTimeout(() => {
        flagEl.textContent = flag;
        if (celebrate) { flagEl.classList.add('new'); Sfx.record(); }
        if (res.grade === 'S') Sfx.fanfare();
      }, 300);
      if (target) setTimeout(() => { if (screen === 'results') openOutcome(res, target, panel); }, 900);
    };
    requestAnimationFrame(step);
  }

  /**
   * A boss battle's end card: the boss's health bar as it ended, then what you did to it
   * (Fireballs landed out of those the song offers, power notes caught, damage) and what
   * it got back (healing from misses, trap notes hit).
   */
  function renderBossResult(b) {
    const box = $('#res-boss');
    box.hidden = !b;
    if (!b) { box.innerHTML = ''; return; }
    const left = b.defeated ? 0 : Math.max(1, b.hp);
    const art = Boss.SPRITES[b.id];
    const headline = b.defeated
      ? `DEFEATED${b.spare ? ` WITH ${b.spare} SECOND${b.spare === 1 ? '' : 'S'} TO SPARE` : ' AT THE VERY END'}!`
      : left <= 10 ? `SO CLOSE! ${left}% HEALTH LEFT` : `${left}% HEALTH LEFT`;
    const r1 = (x) => Math.round(x);
    box.style.setProperty('--boss', b.color || 'var(--red)');
    box.innerHTML = `<div class="rb-top"><canvas class="boss-art" width="16" height="${art ? art.rows.length : 20}" aria-hidden="true"></canvas>
        <div class="rb-main"><p class="rb-name">${esc(b.name)}</p><p class="rb-head ${b.defeated ? 'won' : 'lost'}">${headline}</p>
        <div class="rb-bar" role="img" aria-label="Boss health left: ${left}%"><span style="width:${left}%"></span>${'<i></i>'.repeat(10)}</div></div></div>
      <table class="res rb-stats">
        <tr><td>🔥 FIREBALLS LANDED</td><td>${b.landed} of ${b.fireballsPossible}</td></tr>
        <tr><td>POWER NOTES CAUGHT</td><td>${b.powerCaught} of ${b.powerTotal}</td></tr>
        <tr><td>DAMAGE: NOTES · FIREBALLS</td><td>${r1(b.dmgNotes)} · ${r1(b.dmgFireballs)}</td></tr>
        <tr><td class="miss">HEALED BY YOUR MISSES</td><td>${r1(b.healed)}</td></tr>
        ${b.trapsTotal ? `<tr><td class="miss">TRAP NOTES HIT</td><td>${b.trapsHit} of ${b.trapsTotal}</td></tr>` : ''}
      </table>`;
    if (art) {
      const g = $('.boss-art', box).getContext('2d');
      art.rows.forEach((row, y) => [...row].forEach((k, x) => { if (k !== '.') { g.fillStyle = art.palette[k]; g.fillRect(x, y, 1, 1); } }));
    }
  }

  // Keyboard and mouse can skip the count-up too (without also pressing a button).
  window.addEventListener('keydown', (e) => {
    if (screen === 'results' && resultsAnim && ['Enter', ' ', 'Escape'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      resultsAnim();
    }
  }, true);
  window.addEventListener('pointerdown', () => { if (screen === 'results' && resultsAnim) resultsAnim(); }, true);

  $('#btn-retry').addEventListener('click', () => play(lastDifficulty));
  $('#btn-res-board').addEventListener('click', () => openBoard(current.key, current.title, lastDifficulty, 'results'));

  // ---- share ----------------------------------------------------------------------------------------

  let shareCanvas = null;
  $('#btn-share').addEventListener('click', async () => {
    if (!lastRun) return;
    await document.fonts.load('8px "Press Start 2P"').catch(() => {});
    shareCanvas = ShareCard.draw(lastRun);
    $('#share-img').src = shareCanvas.toDataURL('image/png');
    $('#share-link').value = ShareCard.link(lastRun);
    $('#share-status').textContent = '';
    $('#btn-native-share').hidden = !(navigator.share && navigator.canShare);
    show('share');
  });

  $('#btn-copy').addEventListener('click', async () => {
    const box = $('#share-link');
    try {
      await navigator.clipboard.writeText(box.value);
      $('#share-status').textContent = 'Link copied. Paste it to a friend.';
    } catch (e) {
      box.focus();
      box.select();
      $('#share-status').textContent = 'Press Ctrl+C (or Cmd+C) to copy the selected link.';
    }
  });

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'song';

  $('#btn-save-img').addEventListener('click', () => {
    if (!shareCanvas) return;
    shareCanvas.toBlob((blob) => {
      download(blob, `beat-frets-${slug(lastRun.title)}-${lastRun.score}.png`);
      $('#share-status').textContent = 'Image saved to your downloads.';
    });
  });

  $('#btn-native-share').addEventListener('click', () => {
    if (!shareCanvas) return;
    shareCanvas.toBlob(async (blob) => {
      const file = new File([blob], 'beat-frets-score.png', { type: 'image/png' });
      const data = {
        title: 'Beat Frets',
        text: `I scored ${lastRun.score.toLocaleString('en-US')} on ${lastRun.title} (${lastRun.difficulty}). Can you beat it?`,
        url: $('#share-link').value,
      };
      if (navigator.canShare({ ...data, files: [file] })) data.files = [file];
      try { await navigator.share(data); } catch (e) { /* cancelled */ }
    });
  });

  // ---- incoming challenges ---------------------------------------------------------------------------

  let challenge = null;

  function openChallenge(shared) {
    if (RETIRED(shared.difficulty)) { toast('That challenge was on Medium+ or Duo, which are no longer in the game.'); return; }
    challenge = shared;
    $('#ch-head').textContent = `${shared.initials} scored ${shared.score.toLocaleString('en-US')} on ${shared.title}`;
    $('#ch-detail').textContent = `${LABEL(shared.difficulty)} · grade ${shared.grade} · ${shared.accuracy.toFixed(1)}% · ${shared.maxCombo} streak${shared.fullCombo ? ' · FULL COMBO' : ''}${shared.date ? ' · ' + shared.date : ''}`;
    $('#ch-warn').hidden = shared.verified;
    $('#ch-warn').textContent = 'This link was changed after it was made, so this score will be marked unverified.';
    const pack = shared.songKey.startsWith('pack:') && SongPack.SONGS.find((s) => 'pack:' + s.id === shared.songKey);
    const bonus = shared.songKey.startsWith('bonus:');
    const playBtn = $('#btn-ch-play');
    playBtn.textContent = shared.world && World.available() ? `⚔ CHALLENGE ${shared.initials}`
      : pack ? `PLAY ${pack.title.toUpperCase()}` : bonus ? `PLAY ${shared.title.toUpperCase().slice(0, 30)}` : 'IMPORT YOUR COPY OF THE SONG';
    $('#btn-ch-accept').disabled = false;
    $('#ch-status').textContent = '';
    show('challenge');
  }

  $('#btn-ch-accept').addEventListener('click', () => {
    if (!challenge) return;
    const r = save.addRival(challenge);
    $('#btn-ch-accept').disabled = true;
    $('#ch-status').textContent = r.duplicate
      ? 'That score is already on your leaderboard.'
      : `Added ${r.initials} to your ${r.difficulty} leaderboard as a rival.`;
    requestAnimationFrame(() => $('#btn-ch-play').focus());
  });

  $('#btn-ch-play').addEventListener('click', () => {
    if (!challenge) return;
    ensureAudio();
    if (challenge.world && World.available()) { goWorldChallenge(challenge); return; }
    lastDifficulty = challenge.difficulty;
    if (challenge.songKey.startsWith('pack:')) {
      songOrigin = 'pack';
      renderPack();
      loadPack(challenge.songKey.slice(5));
    } else if (challenge.songKey.startsWith('bonus:')) {
      songOrigin = 'pack';
      renderPack();
      loadBonus(challenge.songKey.slice(6));
    } else {
      songOrigin = 'import';
      renderImport(`Import your copy of "${challenge.title}". It doesn't have to be the same file: the game matches songs by how they sound.`);
      show('import');
    }
  });

  /** A link to a score on a world board: open that board and challenge it. */
  async function goWorldChallenge(sh) {
    const btn = $('#btn-ch-play');
    btn.disabled = true;
    $('#ch-status').textContent = 'Finding the world board…';
    try {
      await openWorldChallenge(sh);
    } catch (e) {
      console.warn(e);
      $('#ch-status').textContent = e.message || String(e);
    } finally {
      btn.disabled = false;
    }
  }

  /** Open a world board ({ world, initials, score, sid, songKey, title }) and challenge that player's score. */
  async function openWorldChallenge(sh, back = 'main') {
    const meta = await World.board(sh.world);
    if (!meta) throw new Error("That score isn't on the world board any more.");
    if (RETIRED(meta.difficulty)) throw new Error('That score was on Medium+ or Duo, which are no longer in the game.');
    const remote = meta.kind === 'mp3' ? { key: meta.songKey, title: meta.title, fp: meta.fp || null, boards: { [meta.difficulty]: sh.world } } : null;
    await openBoard(meta.songKey || sh.songKey, meta.title || sh.title, meta.difficulty, back, 'world', remote);
    const row = worldRows.find((r) => (sh.sid && r.id === sh.sid) || r.initials === sh.initials) || { initials: sh.initials, score: sh.score };
    if (canChallenge(meta.difficulty) === true && !row.mine) openVersus(row);
  }

  function checkHash() {
    const m = location.hash.match(/^#c=([A-Za-z0-9_\-.]+)$/);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    const shared = SaveData.decodeShare(m[1]);
    if (!shared) { toast('That challenge link is damaged or incomplete.'); return false; }
    openChallenge(shared);
    return true;
  }
  window.addEventListener('hashchange', checkHash);

  // ---- world boards ------------------------------------------------------------------------------------

  /** The world board a run belongs on, and what's stored with the board the first time. */
  function worldFor(difficulty, chart) {
    const id = (playOpts.boardId && playOpts.diff === difficulty && playOpts.boardId) || World.boardId(current.key, difficulty, chart);
    const meta = {
      kind: current.kind, title: current.title.slice(0, 80), songKey: current.key.slice(0, 80), difficulty,
      lanes: chart.lanes, notes: chart.notes.length,
      bpm: Math.round(current.analysis.bpm * 10) / 10, bpmKey: Math.round(current.analysis.bpm),
      duration: Math.round(current.analysis.duration),
    };
    // Imported songs keep their chart, so anyone with a copy can play these exact notes.
    if (current.kind === 'mp3') { meta.chart = World.packChart(chart); meta.fp = current.fp; }
    return { id, meta };
  }

  /**
   * Results of the Song of the Day: the streak goes on, and the run can go on
   * today's board for this way of playing (as well as the song's own board).
   */
  function dailyPanel(prefix, difficulty, world, entry) {
    if (!entry || !isDailyRun(difficulty)) { $(`#${prefix}-world-box`).hidden = true; postSeqs[prefix] = (postSeqs[prefix] || 0) + 1; return; }
    markDaily(save.active);
    const pk = dailyPick();
    worldPanel(prefix, { id: Daily.boardId(pk.date, difficulty, pk.songId), meta: { ...world.meta, kind: 'daily', title: `Song of the Day ${pk.date}: ${current.title}`.slice(0, 80) } }, entry);
    const tag = $(`#${prefix}-world-box .daily-tag`);
    if (tag) tag.textContent = `★ SONG OF THE DAY · 🔥 ${dailyStreak()}-DAY STREAK`;
    // Offline (or no world boards): the streak still counts.
    if ($(`#${prefix}-world-box`).hidden) { $(`#${prefix}-world-box`).hidden = false; $(`#${prefix}-world`).textContent = ''; }
  }

  /**
   * Results: how this run compares on the world board, and a button to post it.
   * Nothing is posted unless the player taps POST (or turned on auto-posting),
   * and only a first score or a new best can be posted.
   */
  const postSeqs = {}; // per panel: a newer results screen makes an older one's answers stale
  function worldPanel(prefix, world, entry) {
    const box = $(`#${prefix}-world-box`);
    const line = $(`#${prefix}-world`);
    const btn = $(`#${prefix}-post`);
    const seq = postSeqs[prefix] = (postSeqs[prefix] || 0) + 1;
    const live = () => postSeqs[prefix] === seq;
    const p = save.active;
    btn.hidden = true;
    btn.disabled = false;
    line.textContent = '';
    box.hidden = !(p && entry && World.available());
    const ctl = { peek: Promise.resolve(null), post: null, onPosted: [] };
    if (box.hidden) return ctl;
    const fmt = (n) => Number(n).toLocaleString('en-US');
    let posting = null;
    let peeked = null;
    // No connection: the score waits on this device, to be posted when it's back.
    const keep = () => {
      save.queuePost({ board: world.id, meta: world.meta, profileId: p.id, initials: p.initials, entry });
      updateOutboxUI();
    };
    const SAVED_MSG = "No connection to the world board. Your score is saved here: we'll offer to post it when you're back online.";
    ctl.post = () => {
      if (posting) return posting;
      btn.disabled = true;
      posting = (async () => {
        // An imported song's first world post: everyone will see its name, so ask for one.
        if (world.meta.kind === 'mp3' && peeked && !peeked.exists && !world.named) {
          const name = await askSongName(world.meta.title);
          if (name == null) throw Object.assign(new Error('cancelled'), { cancelled: true });
          world.meta.title = name;
          world.named = true;
          renameSong(current && current.key, name);
        }
        line.textContent = 'Posting…';
        return World.submit({ id: world.id, meta: world.meta, profileId: p.id, entry });
      })().then((r) => {
        recordCache.delete(world.id);
        World.forgetPlayers();
        save.settlePost(p.id, world.id, r.best);
        updateOutboxUI();
        if (live()) {
          btn.hidden = true;
          line.textContent = `POSTED! WORLD RANK #${r.rank}`;
          Sfx.select();
          ctl.onPosted.forEach((f) => f(r));
        }
        return r;
      }).catch((e) => {
        posting = null;
        if (live()) {
          btn.disabled = false;
          btn.hidden = false;
          if (!e.cancelled) { console.warn(e); line.textContent = SAVED_MSG + ' Or try again now:'; }
        }
        if (!e.cancelled) keep();
        throw e;
      });
      return posting;
    };
    btn.onclick = () => ctl.post().catch(() => {});
    line.textContent = 'Checking the world board…';
    ctl.peek = World.peek({ id: world.id, profileId: p.id, score: entry.score }).then((r) => {
      peeked = r;
      if (!r.better) save.settlePost(p.id, world.id, r.best);
      if (!live()) return r;
      if (!r.better) { line.textContent = `Your world best is still ${fmt(r.best)} (#${r.rank}).`; return r; }
      if (settings.autoPost) { ctl.post().catch(() => {}); return r; }
      line.textContent = r.best == null
        ? `Not on the world board yet. This run would rank #${r.rank}.`
        : `Beats your world best of ${fmt(r.best)}. This run would rank #${r.rank}.`;
      btn.hidden = false;
      return r;
    }).catch((e) => {
      console.warn(e);
      keep();
      if (live()) line.textContent = SAVED_MSG;
      return null;
    });
    return ctl;
  }

  /** WHAT'S THIS SONG CALLED? Resolves to the name, or null if cancelled. */
  function askSongName(suggested) {
    return new Promise((resolve) => {
      const box = $('#name-pop');
      const input = $('#name-input');
      input.value = String(suggested || '').replace(/[_]+/g, ' ').trim().slice(0, 40);
      box.hidden = false;
      const done = (v) => {
        box.hidden = true;
        $('#name-ok').onclick = $('#name-cancel').onclick = input.onkeydown = null;
        askSongName.cancel = null;
        resolve(v);
      };
      const ok = () => { const v = input.value.trim().replace(/\s+/g, ' ').slice(0, 40); if (v) done(v); else input.focus(); };
      $('#name-ok').onclick = ok;
      $('#name-cancel').onclick = () => done(null);
      input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } if (e.key === 'Escape') done(null); };
      askSongName.cancel = () => done(null);
      requestAnimationFrame(() => { input.focus(); input.select(); });
    });
  }

  /** Use the name a player gave a song in Your music too. */
  function renameSong(key, name) {
    const s = key && save.data.library.find((x) => x.key === key);
    if (s) { s.title = name; save.save(); }
    if (current && current.key === key) current.title = name;
  }

  /** Once a challenge win is posted, leave a message for the player who was beaten. */
  function tellBeaten(panel, world, target, score, difficulty) {
    const p = save.active;
    if (!panel.post || !target.sid || !p) return;
    panel.onPosted.push((r) => {
      World.notify({
        toSid: target.sid, toInitials: target.initials, from: p.initials, fromSid: r.sid,
        fromScore: score, theirScore: target.score, board: world.id, title: current.title, difficulty,
      }).catch((e) => console.warn('notice not sent', e));
    });
  }

  // ---- "you've been beaten" --------------------------------------------------------------------------

  /**
   * On the home screen, now and then: messages from players who beat one of
   * this device's scores in a challenge, each with a REMATCH.
   */
  let inboxAt = 0;
  let inboxItems = [];
  async function checkInbox() {
    if (!World.available() || Date.now() - inboxAt < 60000) return;
    inboxAt = Date.now();
    let list;
    try { list = await World.inbox(); } catch (e) { console.warn(e); return; }
    if (!list.length || screen !== 'main' || !$('#vs').hidden || !$('#outcome').hidden) return;
    inboxItems = list.slice(0, 4);
    const fmt = (n) => Number(n).toLocaleString('en-US');
    $('#inbox-list').innerHTML = inboxItems.map((n, i) => `<button data-notice="${i}" style="--acc:var(--red)">
      <svg class="ico"><use href="#i-sword"/></svg>
      <span class="row-main"><b>${esc(n.from)} BEAT ${esc(n.toInitials || 'YOU')}</b>
      <small>${esc(n.title)} · ${esc(LABEL(n.difficulty))}<br>${fmt(n.fromScore)} vs ${fmt(n.theirScore)}</small></span>
      <span class="rematch-tag">REMATCH</span></button>`).join('');
    $('#inbox-more').textContent = list.length > inboxItems.length ? `…and ${list.length - inboxItems.length} more.` : '';
    $('#inbox').hidden = false;
    Sfx.challenger();
    requestAnimationFrame(() => { const b = $('#inbox-list button'); if (b) b.focus(); });
  }

  /** Seen: the messages are cleared (from the world board too). */
  function closeInbox() {
    $('#inbox').hidden = true;
    for (const n of inboxItems) World.dismiss(n.id).catch(() => {});
    inboxItems = [];
  }

  $('#inbox-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-notice]');
    const n = b && inboxItems[+b.dataset.notice];
    if (!n) return;
    closeInbox();
    // Rematch as the player who was beaten.
    if (n.toProfile && save.profiles.some((x) => x.id === n.toProfile)) { save.setActive(n.toProfile); renderMain(); }
    ensureAudio();
    openWorldChallenge({ world: n.board, initials: n.from, score: n.fromScore, sid: n.fromSid, title: n.title }, 'main')
      .catch((err) => toast(err.message || String(err)));
  });
  $('#btn-inbox-close').addEventListener('click', closeInbox);
  $('#btn-inbox-ok').addEventListener('click', closeInbox);

  // ---- scores waiting to be posted (saved while offline) ---------------------------------------------

  /**
   * Scores that couldn't reach the world boards wait on this device (save.outbox).
   * When the phone is back online the player is asked to post them, one by one or
   * all at once; the home screen shows how many are waiting until they're done.
   */
  // A Song of the Day board only takes scores on its day: older ones are dropped
  // (the same run waits for the song's own board as well).
  const outboxLive = () => {
    const today = Daily.today();
    for (const x of save.outbox.slice()) {
      const m = /^daily-(\d{4}-\d\d-\d\d)/.exec(x.board);
      if (m && m[1] < today) save.dropPost(x.id);
    }
    return save.outbox.filter((x) => save.profiles.some((p) => p.id === x.profileId));
  };
  const outboxState = new Map(); // id → { state: 'posting' | 'done' | 'failed', text }

  function updateOutboxUI() {
    const n = World.available() ? outboxLive().length : 0;
    const card = $('#outbox-card');
    card.hidden = !n;
    if (n) {
      card.innerHTML = `<svg class="ico"><use href="#i-upload"/></svg><span class="row-main"><b>${n} SCORE${n === 1 ? '' : 'S'} WAITING TO POST</b>` +
        `<small>Saved on this ${Input.touch ? 'phone' : 'device'} while the world boards couldn't be reached.</small></span><span class="rematch-tag">POST</span>`;
    }
    if (!$('#outbox').hidden) renderOutbox();
  }

  function renderOutbox() {
    const items = outboxLive();
    const fmt = (n) => Number(n).toLocaleString('en-US');
    const name = (x) => { const p = save.profiles.find((q) => q.id === x.profileId); return p ? p.initials : x.initials; };
    const label = (x) => (x.meta.kind === 'daily' ? '★ SONG OF THE DAY · ' : '') + LABEL(x.meta.difficulty || '');
    $('#outbox-list').innerHTML = items.length ? items.map((x) => {
      const st = outboxState.get(x.id) || {};
      return `<div class="ob-row${st.state ? ' ' + st.state : ''}" data-ob="${esc(x.id)}">
        <span class="row-main"><b>${esc(name(x))} · ${fmt(x.entry.score)} <span class="ob-grade">${esc(x.entry.grade || '')}</span></b>
        <small>${esc(String(x.meta.title || '').replace(/^Song of the Day [\d-]+: /, ''))} · ${esc(label(x))} · ${esc(fmtDate(x.entry.date || x.queued))}</small>
        ${st.text ? `<small class="ob-state">${esc(st.text)}</small>` : ''}</span>
        <span class="ob-acts"><button class="btn small primary" data-ob-post="${esc(x.id)}"${st.state === 'posting' ? ' disabled' : ''}>POST</button>` +
        `<button class="btn small" data-ob-drop="${esc(x.id)}" aria-label="Don't post this score">✕</button></span>
      </div>`;
    }).join('') : '<p class="hint">All caught up: every score is on the world boards.</p>';
    $('#btn-outbox-all').hidden = items.length < 2;
    $('#outbox-msg').textContent = items.length ? (navigator.onLine === false ? "This device still looks offline. They'll keep until you're connected." : '') : '';
  }

  function openOutbox() {
    if (!World.available()) return;
    outboxPrompted = true;
    renderOutbox();
    $('#outbox').hidden = false;
    requestAnimationFrame(() => { const b = $('#outbox [data-ob-post]') || $('#btn-outbox-later'); if (b) b.focus(); });
  }
  function closeOutbox() {
    $('#outbox').hidden = true;
    for (const [id, st] of outboxState) if (st.state !== 'posting') outboxState.delete(id);
    updateOutboxUI();
  }

  /** Post one waiting score. Resolves true when it's settled (posted, or the world already has better). */
  async function postWaiting(id) {
    const x = save.outbox.find((y) => y.id === id);
    if (!x || (outboxState.get(id) || {}).state === 'posting') return false;
    outboxState.set(id, { state: 'posting', text: 'Posting…' });
    renderOutbox();
    try {
      const r = await World.submit({ id: x.board, meta: x.meta, profileId: x.profileId, entry: x.entry });
      save.settlePost(x.profileId, x.board, r.best);
      recordCache.delete(x.board);
      World.forgetPlayers();
      outboxState.delete(id);
      toast(r.improved ? `Posted ${Number(x.entry.score).toLocaleString('en-US')}: world rank #${r.rank}.` : `Your world best there is already higher (${Number(r.best).toLocaleString('en-US')}, #${r.rank}).`);
      Sfx.select();
      updateOutboxUI();
      return true;
    } catch (e) {
      console.warn(e);
      outboxState.set(id, { state: 'failed', text: "Still can't reach the world board. It stays saved here." });
      renderOutbox();
      return false;
    }
  }

  // Asked once per return of the connection (and once when the game opens with scores waiting).
  let outboxPrompted = false;
  const menuScreen = () => !game && ['main', 'pack', 'import', 'boards', 'song', 'results', 'tiles-results', 'options', 'license'].includes(screen);
  function maybePromptOutbox() {
    if (outboxPrompted || !World.available() || navigator.onLine === false || !outboxLive().length) return;
    if (!menuScreen() || !$('#inbox').hidden || !$('#vs').hidden || !$('#outcome').hidden || !$('#name-pop').hidden || !$('#keep-pop').hidden || !$('#outbox').hidden) return;
    openOutbox();
  }
  window.addEventListener('online', () => { outboxPrompted = false; updateOutboxUI(); setTimeout(maybePromptOutbox, 800); });
  window.addEventListener('offline', () => updateOutboxUI());

  $('#outbox-card').addEventListener('click', openOutbox);
  $('#outbox-list').addEventListener('click', (e) => {
    const post = e.target.closest('[data-ob-post]');
    if (post) { postWaiting(post.dataset.obPost); return; }
    const drop = e.target.closest('[data-ob-drop]');
    if (drop) {
      const row = drop.closest('.ob-row');
      if (!row.classList.contains('confirm')) {
        // Ask once: the score itself stays in this device's records either way.
        row.classList.add('confirm');
        outboxState.set(drop.dataset.obDrop, { state: 'confirm', text: "Tap ✕ again to not post this one. It stays in this device's records." });
        const st = $('.ob-state', row) || row.querySelector('.row-main').appendChild(Object.assign(document.createElement('small'), { className: 'ob-state' }));
        st.textContent = outboxState.get(drop.dataset.obDrop).text;
        return;
      }
      outboxState.delete(drop.dataset.obDrop);
      save.dropPost(drop.dataset.obDrop);
      updateOutboxUI();
    }
  });
  $('#btn-outbox-all').addEventListener('click', async () => {
    const btn = $('#btn-outbox-all');
    btn.disabled = true;
    for (const x of outboxLive().slice()) await postWaiting(x.id);
    btn.disabled = false;
    if (!outboxLive().length) closeOutbox();
  });
  $('#btn-outbox-later').addEventListener('click', closeOutbox);
  $('#btn-outbox-close').addEventListener('click', closeOutbox);

  /** The world board id for a board screen, if we can tell (imported songs need their chart). */
  function worldBoardFor(key, diff) {
    if (boardState.daily) return Daily.boardId(boardState.daily, diff, Daily.pick(SongPack.SONGS, boardState.daily).songId);
    if (boardState.worldId) return boardState.worldId;
    if (boardState.remote) return boardState.remote.boards[diff] || null;
    if (/^(pack|bonus):/.test(key)) return World.boardId(key, diff);
    if (current && current.key === key && chartFor(diff)) return World.boardId(key, diff, chartFor(diff));
    const run = save.data.runs.slice().reverse().find((r) => r.songKey === key && r.difficulty === diff && r.world);
    return run ? run.world : null;
  }

  const boardMsg = (html) => `<div class="score-row empty">${html}</div>`;
  let worldSeq = 0;
  let worldRows = [];

  async function renderWorldBoard() {
    const { key, diff } = boardState;
    const seq = ++worldSeq;
    const table = $('#board-table');
    worldRows = [];
    if (!World.available()) { table.innerHTML = boardMsg("World boards aren't switched on for this copy of the game yet."); return; }
    const id = worldBoardFor(key, diff);
    if (!id) {
      table.innerHTML = boardMsg(boardState.remote ? `No one has posted ${esc(LABEL(diff))} for this song yet.` : `Play ${esc(LABEL(diff))} once to find this song's world board.`);
      return;
    }
    table.innerHTML = boardMsg('Loading…');
    try {
      const rows = await World.top(id, 25);
      if (seq !== worldSeq) return;
      worldRows = rows;
      const tiles = parseId(diff).tiles;
      const can = canChallenge(diff);
      table.innerHTML = rows.length ? rows.map((r, i) => scoreCard(r, i, { mine: r.mine, crown: i === 0, challenge: can === true && !r.mine })).join('')
        : boardMsg(`No world scores for ${esc(LABEL(diff))} yet. Be the first.`);
      pinYou(rows, (r) => r.mine, true);
      if (rows.length) $('#board-note').textContent = can === true ? 'Press CHALLENGE on any score to race it, live.' : can;
      // Imported songs: other people's versions of the same song have boards of their own.
      if (!tiles && !boardState.remote && !/^(pack|bonus):/.test(key) && current && current.kind === 'mp3') {
        const list = await World.versions({ difficulty: diff, bpm: current.analysis.bpm, fp: current.fp, title: current.title, exclude: id });
        if (seq !== worldSeq || !list.length) return;
        $('#board-versions').innerHTML = '<p class="label">OTHER VERSIONS OF THIS SONG</p>' +
          '<p class="hint">Play their notes over your copy, so your scores compare fairly.</p>' +
          list.map((v) => `<button data-version="${esc(v.id)}" data-title="${esc(v.title)}" style="--acc:var(--magenta)"><span class="row-main"><b>${esc(v.title.toUpperCase().slice(0, 32))}</b><small>${fmtTime(v.duration || 0)} · ${v.notes} notes</small></span><svg class="chev"><use href="#i-chev"/></svg></button>`).join('');
      }
    } catch (e) {
      console.warn(e);
      if (seq === worldSeq) table.innerHTML = boardMsg("Couldn't reach the world board (no internet?). Scores on this phone are under THIS DEVICE.");
    }
  }

  $('#board-scope').addEventListener('click', (e) => {
    const b = e.target.closest('[data-board-scope]');
    if (!b) return;
    boardState.scope = b.dataset.boardScope;
    boardState.worldId = null;
    boardState.title = boardState.songTitle;
    renderBoard();
    requestAnimationFrame(() => { const el = $(`[data-board-scope="${boardState.scope}"]`); if (el) el.focus(); });
  });

  $('#board-versions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-version]');
    if (!b) return;
    boardState.worldId = b.dataset.version;
    boardState.title = b.dataset.title;
    renderBoard();
    requestAnimationFrame(() => $('#btn-board-play').focus());
  });

  $('#board-table').addEventListener('click', (e) => {
    const b = e.target.closest('[data-challenge]');
    if (b && worldRows[+b.dataset.challenge]) openVersus(worldRows[+b.dataset.challenge]);
  });

  /**
   * Whether this device can challenge scores on a tier: true, or why not.
   * Races are only fair on the same controls: keyboard scores from a computer,
   * touch scores from a phone (Sideways or Upright). Tiles is the same everywhere.
   */
  function canChallenge(diff) {
    const t = parseId(diff);
    if (t.tiles) return true; // the same four columns on every device
    if (Input.touch && !t.touch) return 'These scores were played on a keyboard. Play on a computer to challenge them.';
    if (!Input.touch && t.touch) return 'These scores were played on a phone. Play on a phone to challenge them.';
    return true;
  }

  // ---- challenges: the versus pop-up -------------------------------------------------------------------

  /**
   * HERE COMES A NEW CHALLENGER! Shows you against them, loads the song (and,
   * for imported songs, lines their notes up with your copy) behind the pop-up,
   * waits for the phone to be turned the right way, then FIGHT! starts the race.
   */
  function openVersus(r) {
    const { key, diff } = boardState;
    const t = parseId(diff);
    const me = save.active;
    const mine = worldRows.find((x) => x.mine);
    const rank = r ? (worldRows.findIndex((x) => x === r || (r.id && x.id === r.id)) + 1 || r.rank || 0) : 0;
    const fmt = (n) => Number(n).toLocaleString('en-US');
    vs = {
      key, diff,
      id: worldBoardFor(key, diff),
      want: Input.touch ? (t.tiles ? 'portrait' : t.touch ? (t.lanes === 4 ? 'landscape' : 'portrait') : null) : null,
      tiles: !!t.tiles,
      prevWant: orientation.wanted,
      target: r ? { initials: r.initials, score: Number(r.score), timeline: Array.isArray(r.tl) && r.tl.length > 1 ? r.tl : null, laps: Number(r.laps) || 0, rank, sid: r.id || null } : null,
      loaded: false, error: null, status: 'Loading the stage…', opts: null, match: null, needCopy: null, row: r,
    };
    $('#vs-you-ini').textContent = me ? me.initials : '---';
    $('#vs-you-line').textContent = mine ? `#${worldRows.indexOf(mine) + 1} · ${fmt(mine.score)}` : 'NOT RANKED YET';
    $('#vs-them-ini').textContent = r ? r.initials : '???';
    $('#vs-them').classList.toggle('leads', rank === 1);
    $('#vs-them-line').textContent = r ? `${rank ? '#' + rank + ' · ' : ''}${fmt(r.score)}` : 'EMPTY BOARD';
    const layout = t.tiles ? 'Tiles' : t.touch ? (t.lanes === 4 ? 'Sideways · 4 lanes' : 'Upright · 2 lanes') : 'Keys';
    $('#vs-song').textContent = `${boardState.title} · ${BASE_LABEL(t.difficulty)} · ${layout}`;
    $('#vs-goal').textContent = !r ? 'Set the first score on this board!'
      : mine && Number(mine.score) > Number(r.score) ? `You're already ahead of ${r.initials}. Friendly rematch!`
        : rank ? `Beat ${fmt(r.score)} to take #${rank}${rank === 1 ? ' and the crown' : ''}!` : `Beat ${fmt(r.score)}!`;
    $('#vs-est').hidden = !(r && !vs.target.timeline);
    $('#vs').hidden = false;
    ensureAudio();
    Sfx.challenger();
    if (vs.want) orientation.want(vs.want);
    updateVersus();
    requestAnimationFrame(() => $('#btn-vs-cancel').focus());
    prepareVersus(vs);
  }

  async function prepareVersus(v) {
    try {
      if (/^(pack|bonus):/.test(v.key)) {
        if (!current || current.key !== v.key) await loadQuietly(v.key);
        v.opts = { key: v.key, diff: v.diff, target: v.target };
      } else {
        v.status = 'Getting their notes…';
        updateVersus();
        const b = await World.board(v.id);
        if (!b || !b.chart) throw new Error('This board has no notes saved.');
        const copy = await findCopy(b.fp, b.title || boardState.title, b.songKey || v.key);
        if (!copy) {
          v.needCopy = { title: b.title || boardState.title };
          if (vs === v) updateVersus();
          return;
        }
        if (!copy.current) {
          v.status = 'Opening your copy of the song…';
          updateVersus();
          await loadQuietly(copy.key);
        }
        v.status = v.target ? `Lining up ${v.target.initials}'s notes with your copy…` : 'Lining up their notes with your copy…';
        updateVersus();
        const fit = World.alignChart(World.unpackChart(b.chart), chartFor(v.diff) || current.charts[ChartGen.ALL_IDS[0]]);
        v.match = fit;
        v.opts = { key: current.key, diff: v.diff, chart: fit.chart, boardId: v.id, target: v.target };
      }
      v.loaded = true;
    } catch (e) {
      console.warn(e);
      v.error = e.message || String(e);
    }
    if (vs === v) updateVersus();
  }

  /** A challenge waiting for you to import your copy of the song. */
  let pendingRemote = null;
  async function resumeRemote() {
    const pr = pendingRemote;
    pendingRemote = null;
    songOrigin = 'boards';
    boardState = pr.state;
    $('#screen-board').dataset.back = boardState.back;
    const ready = renderBoard();
    show('board');
    await ready;
    const r = pr.row && (worldRows.find((x) => x.id && x.id === pr.row.id) || pr.row);
    openVersus(r || worldRows[0] || null);
  }

  /** Song loading behind the versus pop-up: no loading screen, progress shown in the pop-up. */
  let quietLoad = null;
  function loadQuietly(key) {
    return new Promise((resolve, reject) => {
      quietLoad = { resolve, reject };
      if (key.startsWith('pack:')) loadPack(key.slice(5));
      else if (key.startsWith('bonus:')) loadBonus(key.slice(6));
      else loadSaved(key);
    });
  }
  function quietDone(err) {
    const q = quietLoad;
    quietLoad = null;
    if (err) q.reject(err); else q.resolve();
  }

  function updateVersus() {
    const v = vs;
    if (!v) return;
    const turned = !v.want || (v.want === 'landscape') === (window.innerWidth > window.innerHeight);
    let html;
    const fight = $('#btn-vs-fight');
    fight.textContent = v.needCopy ? 'IMPORT YOUR COPY' : 'FIGHT!';
    if (v.needCopy) {
      $('#vs-status').innerHTML = `<p class="vs-warn">You don't have "${esc(v.needCopy.title)}" yet. Import your own copy (any version) and the game lines their notes up with it.</p>`;
      fight.disabled = false;
      return;
    }
    if (v.error) html = `<p class="vs-warn">${esc(v.error)}</p>`;
    else if (!v.loaded) html = `<p class="vs-wait">${esc(v.status)}</p>`;
    else if (!turned) html = `<div class="vs-turn"><div class="rotate-phone small" aria-hidden="true"><i></i></div><p>TURN YOUR PHONE ${v.want === 'landscape' ? 'SIDEWAYS' : 'UPRIGHT'}</p></div>`;
    else {
      html = v.match && !v.match.good ? `<p class="vs-warn">Their notes only match ${Math.round(v.match.match * 100)}% of your copy. It may be a different version.</p>` : '';
      html += '<p class="vs-ready">READY? PRESS FIGHT!</p>';
    }
    $('#vs-status').innerHTML = html;
    const ok = v.loaded && turned && !v.error;
    $('#btn-vs-fight').disabled = !ok;
    if (ok && document.activeElement === $('#btn-vs-cancel')) $('#btn-vs-fight').focus();
  }

  function closeVersus(cancelled) {
    const v = vs;
    vs = null;
    $('#vs').hidden = true;
    if (!v) return;
    if (cancelled) {
      Sfx.back();
      if (v.prevWant) orientation.want(v.prevWant); else orientation.release();
    }
  }

  $('#btn-vs-cancel').addEventListener('click', () => closeVersus(true));
  $('#btn-vs-close').addEventListener('click', () => closeVersus(true));
  $('#btn-vs-fight').addEventListener('click', () => {
    const v = vs;
    if (v && v.needCopy) {
      // Off to Your music; once a copy is imported, straight back into this challenge.
      closeVersus(true);
      pendingRemote = { state: { ...boardState }, row: v.row };
      songOrigin = 'import';
      renderImport(`Import your copy of "${v.needCopy.title}" to challenge ${v.target ? v.target.initials : 'this board'}. Any version works: the game lines their notes up with it.`);
      show('import');
      return;
    }
    if (!v || !v.loaded) return;
    closeVersus(false);
    if (v.tiles) {
      session.mode = 'tiles';
      session.orient = v.want;
      if (v.want) orientation.want(v.want);
      applyLayout();
    } else if (v.want) {
      session.mode = 'frets';
      session.orient = v.want;
      orientation.want(v.want);
      applyLayout();
    }
    songOrigin = 'boards';
    lastDifficulty = v.diff;
    play(v.diff, v.opts);
  });

  // ---- challenges: how it ended --------------------------------------------------------------------------

  /** After a challenge: YOU BEAT AAA! (with POST), a tie, or a rematch offer. */
  function openOutcome(res, target, panel) {
    const fmt = (n) => Number(n).toLocaleString('en-US');
    const won = !res.failed && res.score > target.score;
    const tie = !res.failed && res.score === target.score;
    const box = $('#outcome');
    box.classList.toggle('won', won);
    $('#oc-title').textContent = won ? `YOU BEAT ${target.initials}!` : tie ? `TIED WITH ${target.initials}!` : `${target.initials} STILL LEADS`;
    $('#oc-line').textContent = res.failed ? 'The song ended early. Try again!'
      : won ? `${fmt(res.score)} vs ${fmt(target.score)}: you won by ${fmt(res.score - target.score)}.`
        : tie ? `Both ${fmt(res.score)}. Beat it to take the lead!`
          : `${fmt(target.score)} vs your ${fmt(res.score)}: ${fmt(target.score - res.score)} to go.`;
    const post = $('#oc-post');
    const line = $('#oc-world');
    post.hidden = true;
    line.textContent = '';
    $('#oc-rematch').hidden = won;
    const posted = (r) => {
      post.hidden = true;
      line.textContent = r.rank === 1 ? "POSTED! YOU'RE #1. THE CROWN IS YOURS!" : `POSTED! YOU'RE #${r.rank} IN THE WORLD.`;
      if (r.rank === 1) Sfx.fanfare();
    };
    if (won && panel.post) {
      line.textContent = 'Checking the world board…';
      panel.onPosted.push(posted);
      panel.peek.then((r) => {
        if ($('#outcome').hidden || !r) { if (!r) line.textContent = ''; return; }
        if (!r.better) { line.textContent = `Your world best is still ${fmt(r.best)}.`; return; }
        if (settings.autoPost) { line.textContent = 'Posting…'; return; }
        line.textContent = `Post now to take #${r.rank}${r.rank === 1 ? ' and the crown' : ''}!`;
        post.hidden = false;
        post.focus();
      });
      post.onclick = () => { line.textContent = 'Posting…'; post.hidden = true; panel.post().catch((e) => { line.textContent = e.cancelled ? '' : "Couldn't reach the world board. Try again?"; post.hidden = false; }); };
    }
    box.hidden = false;
    if (won) Sfx.record();
    requestAnimationFrame(() => (won && !post.hidden ? post : won ? $('#oc-close') : $('#oc-rematch')).focus());
  }
  const closeOutcome = () => { $('#outcome').hidden = true; };
  $('#oc-close').addEventListener('click', closeOutcome);
  $('#oc-rematch').addEventListener('click', () => { closeOutcome(); play(lastDifficulty); });
  $('#oc-board').addEventListener('click', () => {
    closeOutcome();
    const board = playOpts.boardId;
    openBoard(current.key, current.title, lastDifficulty, screen === 'tiles-results' ? 'tiles-results' : 'results', 'world');
    if (board && board !== World.boardId(current.key, lastDifficulty, chartFor(lastDifficulty))) { boardState.worldId = board; renderBoard(); }
  });

  // ---- leaderboards ------------------------------------------------------------------------------------

  let boardState = { key: null, title: '', songTitle: '', diff: 'easy', back: 'boards', scope: World.available() ? 'world' : 'local', worldId: null };

  // The Boards screen starts with a difficulty picker (and how it was played), so every
  // category and song shows who leads that difficulty before anything is opened.
  function defaultBoardsPick() {
    const p = save.active;
    const run = save.data.runs.slice().reverse().find((r) => !p || r.profileId === p.id);
    const fam = run ? familyOf(run.difficulty) : layoutMode();
    return { fam, base: 'easy' };
  }
  let boardsPick = (() => {
    try {
      const v = JSON.parse((storage && storage.getItem('beatfrets.boardsPick')) || 'null');
      if (v && FAMILIES[v.fam]) return v;
    } catch (e) { /* use the default */ }
    return null;
  })();
  function boardsTier() {
    if (!boardsPick) boardsPick = defaultBoardsPick();
    const ids = idsFor(boardsPick.fam);
    return ids.find((d) => parseId(d).difficulty === boardsPick.base) || ids[0];
  }
  function setBoardsPick(fam, base) {
    boardsPick = { fam, base };
    try { if (storage) storage.setItem('beatfrets.boardsPick', JSON.stringify(boardsPick)); } catch (e) { /* not kept */ }
  }

  function boardsPicker() {
    const tier = boardsTier();
    const fam = boardsPick.fam;
    return '<div class="boards-pick">' +
      '<div class="chips">' + Object.entries(FAMILIES).map(([f, label]) => `<button data-pick-family="${f}" class="${f === fam ? 'on' : ''}">${label}</button>`).join('') + '</div>' +
      `<div class="diff-tabs" role="tablist" aria-label="Difficulty">${idsFor(fam).map((d) =>
        `<button role="tab" data-pick-tier="${d}" data-base="${parseId(d).difficulty}" class="${d === tier ? 'on' : ''}" aria-selected="${d === tier}">` +
        `<b>${BASE_LABEL(parseId(d).difficulty)}</b><small class="tab-lead">…</small></button>`).join('')}</div>` +
      `<p class="board-now"><span class="board-now-tier" data-base="${parseId(tier).difficulty}">${BASE_LABEL(parseId(tier).difficulty)}</span> LEADERS · ${FAMILIES[fam]}</p></div>`;
  }

  /** Each difficulty tab on the Boards screen: how many songs have a leader there. */
  function fillPickCounts(keys) {
    for (const tab of $$('#boards-pick [data-pick-tier]')) {
      const d = tab.dataset.pickTier;
      const el = $('.tab-lead', tab);
      Promise.all(keys.map((k) => songRecords(k, [d]).then((r) => (r[d] ? 1 : 0)))).then((n) => {
        if (!el.isConnected) return;
        const led = n.reduce((a, b) => a + b, 0);
        tab.classList.toggle('led', led > 0);
        el.innerHTML = led ? `<svg><use href="#i-crown"/></svg>${led} SONG${led === 1 ? '' : 'S'}` : 'NO ONE YET';
      });
    }
  }

  // Boards shows songs, or players: everyone who has posted a world score.
  let boardsView = 'songs';
  $('#boards-view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-boards-view]');
    if (!b || b.dataset.boardsView === boardsView) return;
    boardsView = b.dataset.boardsView;
    renderBoards();
    requestAnimationFrame(() => { const el = $(`[data-boards-view="${boardsView}"]`); if (el) el.focus({ preventScroll: true }); });
  });

  function renderBoards() {
    for (const b of $$('#boards-view [data-boards-view]')) b.classList.toggle('on', b.dataset.boardsView === boardsView);
    $('#boards-pick').hidden = boardsView !== 'songs';
    $('#boards-list').hidden = boardsView !== 'songs';
    $('#players-list').hidden = boardsView !== 'players';
    if (boardsView === 'players') { renderPlayersBoard(); return; }
    const where = 'boards';
    const tier = boardsTier();
    const bonus = (bonusIndex || []).map((s) => ({ key: BonusPack.keyFor(s.id), title: s.title }));
    if (!bonusIndex) fetchBonusIndex().then((l) => { if (l.length && screen === 'boards') renderBoards(); });
    const played = save.playedSongs().filter((s) => s.key.startsWith('mp3:'))
      .map((s) => ({ key: s.key, title: save.songTitle(s.key) || s.title }));
    const row = (b) => `<button data-board-key="${esc(b.key)}" data-key="${esc(b.key)}" data-title="${esc(b.title)}">` +
      `<svg class="ico"><use href="#i-trophy"/></svg><span class="row-main"><b>${tierBadge(b.tier)}${esc(b.title.toUpperCase().slice(0, 40))}</b><span class="leaders"></span></span><svg class="chev"><use href="#i-chev"/></svg></button>`;
    // A category's boss battle has its own board, for the way of playing picked above.
    const bossBoardRow = (s) => {
      const b = Boss.battleFor(s.id);
      return `<button class="boss-board-row" data-boss-board="${esc(s.id)}" style="--boss:${b.color}"><svg class="ico"><use href="#i-skull"/></svg>` +
        `<span class="row-main"><b><span class="tier tier-battle">BOSS BATTLE</span>${esc(b.name)}</b>${bossBeaten(s.id) ? '<span class="defeated-tag">✓ YOU BEAT IT</span>' : ''}<span class="boss-lead" data-boss-lead="${esc(s.id)}"></span></span><svg class="chev"><use href="#i-chev"/></svg></button>`;
    };
    const themes = THEMES.map(([theme, heading]) => {
      const songs = SongPack.SONGS.filter((s) => (s.theme || 'classic') === theme);
      const boss = songs.find((s) => Boss.battleFor(s.id));
      return songs.length ? catBlock(where, theme, heading, boss ? `${songs.length} SONGS + BOSS` : songs.length,
        songs.map((s) => row({ key: SongPack.keyFor(s), title: s.title, tier: s.tier })).join('') + (boss ? bossBoardRow(boss) : '')) : '';
    }).join('');
    $('#boards-pick').innerHTML = boardsPicker();
    $('#boards-list').innerHTML = themes +
      (bonus.length ? catBlock(where, 'bonus', 'BONUS TRACKS', bonus.length, bonus.map(row).join('')) : '') +
      (played.length ? catBlock(where, 'yours', 'YOUR MUSIC', played.length, played.map(row).join('')) : '') +
      (World.available() ? catBlock(where, 'players', 'PLAYERS\' MUSIC', '…', '<div id="remote-songs"><p class="hint">Loading songs other players posted…</p></div>', { summary: false }) : '');
    autofocusCat($('#boards-list'));
    fillCatSummaries($('#boards-list'), [tier]);
    fillBossLeaders($('#boards-list'), boardsPick.fam === 'tiles' ? 'keys' : boardsPick.fam);
    fillPickCounts([...SongPack.SONGS.map((x) => SongPack.keyFor(x)), ...bonus.map((x) => x.key), ...played.map((x) => x.key)]);
    if (World.available()) renderRemoteSongs();
  }

  // ---- players: who holds which trophies ----------------------------------------------------------------

  /** What a world board is: its song, how it was played and the difficulty. Null if unknown. */
  let remoteIndex = new Map(); // board id → imported-song group (from World.songs)
  function boardInfo(boardId) {
    const cut = boardId.lastIndexOf('__');
    if (cut < 0) return null;
    const head = boardId.slice(0, cut), tail = boardId.slice(cut + 2);
    const all = Object.keys(FAMILIES).flatMap((f) => idsFor(f)).concat(['boss', 'touch4:boss', 'touch2:boss']);
    const diff = all.find((d) => d.replace(/[^a-z0-9]/gi, '-') === tail);
    if (!diff) return null;
    if (head.startsWith('pack-')) {
      const def = SongPack.SONGS.find((s) => s.id === head.slice(5));
      return def ? { key: SongPack.keyFor(def), title: def.title, tier: def.tier, diff, cat: def.theme || 'classic' } : null;
    }
    if (head.startsWith('bonus-')) {
      const def = (bonusIndex || []).find((s) => s.id === head.slice(6));
      return { key: BonusPack.keyFor(head.slice(6)), title: def ? def.title : 'Bonus track', diff, cat: 'bonus' };
    }
    const g = remoteIndex.get(boardId);
    if (g) return { key: g.key, title: g.title, diff, cat: 'players', remote: { key: g.key, title: g.title, fp: g.fp, boards: g.boards } };
    const run = save.data.runs.slice().reverse().find((r) => r.world === boardId);
    return run ? { key: run.songKey, title: save.songTitle(run.songKey) || run.title, diff, cat: 'players' } : null;
  }
  const playLabel = (d) => `${BASE_LABEL(parseId(d).difficulty)} · ${FAMILIES[familyOf(d)]}`;

  let worldPlayers = [];
  async function loadPlayers(fresh) {
    const [list, groups] = await Promise.all([World.players({ fresh }), World.songs(80).catch(() => [])]);
    remoteIndex = new Map();
    for (const g of groups) for (const id of Object.values(g.boards)) remoteIndex.set(id, g);
    if (!bonusIndex) await fetchBonusIndex();
    // Imported songs not in the listing: read their board for the title and fingerprint.
    const unknown = [...new Set(list.flatMap((p) => p.scores.map((s) => s.board)))].filter((id) => id.startsWith('chart-') && !remoteIndex.has(id));
    await Promise.all(unknown.slice(0, 20).map(async (id) => {
      try {
        const m = await World.board(id);
        if (m) remoteIndex.set(id, { key: m.songKey, title: m.title || 'Imported song', fp: m.fp || null, boards: { [m.difficulty]: id } });
      } catch (e) { /* left out */ }
    }));
    // Song of the Day: a day you finished #1 on (once the day is over) is a daily win.
    const todayKey = Daily.today();
    worldPlayers = list.map((p) => ({
      ...p,
      dailyWins: p.scores.filter((s) => s.leader && /^daily-\d{4}-\d\d-\d\d(-[a-z0-9-]+)?__/.test(s.board) && s.board.slice(6, 16) < todayKey).length,
      scores: p.scores.map((s) => ({ ...s, info: s.board.startsWith('daily-') ? null : boardInfo(s.board) })).filter((s) => s.info),
    }))
      .map((p) => ({ ...p, trophies: p.scores.filter((s) => s.leader).length }))
      .filter((p) => p.scores.length || p.dailyWins)
      .sort((x, y) => y.trophies - x.trophies || y.scores.length - x.scores.length);
    return worldPlayers;
  }

  async function renderPlayersBoard() {
    const box = $('#players-list');
    if (!World.available()) { box.innerHTML = '<p class="hint">World leaderboards aren\'t switched on, so there are no players to show yet.</p>'; return; }
    box.innerHTML = '<p class="hint">Loading everyone who has posted a score…</p>';
    let list;
    try { list = await loadPlayers(); } catch (e) {
      console.warn(e);
      if (screen === 'boards' && boardsView === 'players') box.innerHTML = '<p class="hint">Couldn\'t reach the world boards (no internet?).</p>';
      return;
    }
    if (screen !== 'boards' || boardsView !== 'players') return;
    if (!list.length) { box.innerHTML = '<p class="hint">Nobody has posted a world score yet. Be the first!</p>'; return; }
    box.innerHTML = '<p class="hint">Everyone who has posted a world score, most trophies first. Tap a player to see their license.</p>' +
      '<div class="list">' + list.map((p, i) => `<button class="player-row${p.trophies ? ' led' : ''}" data-license="${esc(p.sid)}" ${i === 0 ? 'data-autofocus' : ''}>` +
        `<span class="pl-rank">${i + 1}</span><span class="row-main"><b>${esc(p.initials)}${p.mine ? '<span class="you-tag">YOU</span>' : ''}</b>` +
        `<small>${p.trophies ? `<span class="pl-trophies"><svg><use href="#i-crown"/></svg>${p.trophies} TROPH${p.trophies === 1 ? 'Y' : 'IES'}</span> · ` : ''}${p.dailyWins ? `★ ${p.dailyWins} DAILY WIN${p.dailyWins === 1 ? '' : 'S'} · ` : ''}${p.scores.length} SCORE${p.scores.length === 1 ? '' : 'S'} POSTED</small></span>` +
        '<svg class="chev"><use href="#i-chev"/></svg></button>').join('') + '</div>';
  }

  $('#players-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-license]');
    if (b) openLicense(b.dataset.license);
  });

  /** A player's license: an arcade card with their trophies, then their other posted scores. */
  let licenseSid = null;
  function openLicense(sid) {
    licenseSid = sid;
    renderLicense();
    show('license');
  }
  function renderLicense() {
    const p = worldPlayers.find((x) => x.sid === licenseSid);
    if (!p) { $('#license').innerHTML = '<p class="hint">That player isn\'t on the world boards any more.</p>'; return; }
    const fmt = (n) => Number(n).toLocaleString('en-US');
    // Grouped by category, in the song list's order (then bonus tracks and players' music).
    const catOrder = (s) => { const i = CAT_KEYS.indexOf(s.info.cat); return i < 0 ? CAT_KEYS.length : i; };
    const byCat = (a, b) => catOrder(a) - catOrder(b) || String(a.info.title).localeCompare(String(b.info.title));
    const trophies = p.scores.filter((s) => s.leader).sort(byCat);
    const others = p.scores.filter((s) => !s.leader).sort(byCat);
    const grades = ['S', 'A', 'B', 'C', 'D'];
    const best = grades.find((g) => p.scores.some((s) => String(s.grade).startsWith(g))) || '–';
    const since = p.scores.map((s) => s.date).filter(Boolean).sort()[0];
    // Boss trophies: every boss this player has beaten (a posted win on any of its boards;
    // on your own license, a win kept on this device counts too).
    const bosses = Object.entries(Boss.BATTLES).map(([id, b]) => {
      const wins = p.scores.filter((s) => s.board.startsWith('pack-' + id + '__') && /boss$/.test(s.board));
      const local = p.mine && save.data.profiles.some((q) => q.initials === p.initials && bossBeaten(id, q.id));
      const best = wins.slice().sort((x, y) => y.score - x.score)[0];
      return { id, b, beaten: !!(wins.length || local), lead: wins.some((s) => s.leader), best, at: best ? p.scores.indexOf(best) : -1 };
    });
    const beatenCount = bosses.filter((x) => x.beaten).length;
    const row = (s, i) => {
      const d = s.info.diff;
      return `<div class="lic-row${s.leader ? ' lead' : ''}">` +
        `<button class="lic-song" data-lic-board="${i}"><span class="cat-chip theme-${esc(s.info.cat || 'players')}">${esc(CAT_NAME[s.info.cat] || CAT_NAME.players)}</span><b>${tierBadge(s.info.tier)}${esc(String(s.info.title).toUpperCase().slice(0, 34))}</b>` +
        `<span class="lic-how"><span class="board-now-tier" data-base="${parseId(d).difficulty}">${BASE_LABEL(parseId(d).difficulty)}</span> · ${FAMILIES[familyOf(d)]}</span>` +
        `<span class="lic-score">${s.leader ? '<svg><use href="#i-crown"/></svg>' : `#${s.rank} of ${s.players} · `}${fmt(s.score)}${s.fullCombo ? ' · FC' : ''}</span></button>` +
        (p.mine ? '' : canChallenge(d) === true
          ? `<button class="btn small primary ch-btn" data-lic-challenge="${i}"><svg><use href="#i-sword"/></svg>CHALLENGE</button>`
          : `<span class="lic-only">${Input.touch ? 'KEYBOARD ONLY' : 'PHONE ONLY'}</span>`) +
        '</div>';
    };
    $('#license').innerHTML = `<div class="license${p.mine ? ' mine' : ''}">
      <div class="lic-top"><span>BEAT FRETS</span><span>PLAYER LICENSE</span></div>
      <div class="lic-body">
        <div class="lic-photo" aria-hidden="true">${esc(p.initials)}</div>
        <div class="lic-id"><b>${esc(p.initials)}${p.mine ? '<span class="you-tag">YOU</span>' : ''}</b>
          <small>NO. ${esc(p.sid.slice(-6).toUpperCase())}${since ? ` · SINCE ${esc(fmtDate(since))}` : ''}</small>
          ${p.mine && dailyStreak() ? `<small class="lic-streak">🔥 ${dailyStreak()}-DAY SONG OF THE DAY STREAK</small>` : ''}</div>
      </div>
      <div class="lic-stats">
        <span><b>${trophies.length}</b>TROPHIES</span><span><b>${p.scores.length}</b>SCORES</span>
        <span><b>${p.dailyWins || 0}</b>DAILY WINS</span><span><b>${beatenCount}/${bosses.length}</b>BOSSES</span><span><b>${best}</b>BEST GRADE</span>
      </div>
    </div>` +
      `<p class="label">BOSS TROPHIES (${beatenCount} OF ${bosses.length})</p>` +
      `<div class="boss-shelf">${bosses.map((x) => `<button class="boss-trophy${x.beaten ? ' beaten' : ''}${x.lead ? ' lead' : ''}" ${x.at >= 0 ? `data-lic-board="${x.at}"` : 'disabled'} style="--boss:${x.b.color}" title="${esc(x.b.name)}">` +
        `<canvas class="boss-art" width="16" height="${Boss.SPRITES[x.b.id].rows.length}" data-sprite="${x.b.id}" aria-hidden="true"></canvas>` +
        `<b>${esc(x.b.name.replace(/^THE /, ''))}</b><small>${x.beaten ? (x.lead ? '<svg><use href="#i-crown"/></svg>RECORD' : x.best ? Number(x.best.score).toLocaleString('en-US') : 'DEFEATED') : 'NOT YET'}</small></button>`).join('')}</div>` +
      `<p class="label">${trophies.length ? `TROPHIES HELD (${trophies.length})` : 'NO TROPHIES YET'}</p>` +
      (trophies.length ? `<div class="lic-list">${trophies.map((s) => row(s, p.scores.indexOf(s))).join('')}</div>`
        : `<p class="hint">${esc(p.initials)} hasn't taken a #1 spot yet. Their posted high scores are below.</p>`) +
      (others.length ? `<p class="label">HIGH SCORES (${others.length})</p><div class="lic-list">${others.map((s) => row(s, p.scores.indexOf(s))).join('')}</div>` : '');
    // The bosses' portraits: in colour once beaten, a dark silhouette until then.
    for (const cv of $$('#license canvas[data-sprite]')) {
      const art = Boss.SPRITES[cv.dataset.sprite];
      const lit = cv.closest('.boss-trophy').classList.contains('beaten');
      const g = cv.getContext('2d');
      art.rows.forEach((row, y) => [...row].forEach((k, x) => { if (k !== '.') { g.fillStyle = lit ? art.palette[k] : '#2a2440'; g.fillRect(x, y, 1, 1); } }));
    }
  }

  $('#license').addEventListener('click', async (e) => {
    const p = worldPlayers.find((x) => x.sid === licenseSid);
    if (!p) return;
    const ch = e.target.closest('[data-lic-challenge]');
    const open = e.target.closest('[data-lic-board]');
    const s = p.scores[+((ch || open || {}).dataset || {})[ch ? 'licChallenge' : 'licBoard']];
    if (!s) return;
    // The song's world board, on that difficulty; a challenge then opens the versus pop-up.
    await openBoard(s.info.key, s.info.title, s.info.diff, 'license', 'world', s.info.remote || null);
    if (!ch) return;
    const r = worldRows.find((x) => x.id === s.id);
    if (r) openVersus(r);
  });

  /** Imported songs other players have posted: browse them, and challenge with your own copy. */
  let remoteSongs = [];
  async function renderRemoteSongs() {
    let list;
    try { list = await World.songs(80); } catch (e) { console.warn(e); list = null; }
    const box = $('#remote-songs');
    if (!box || screen !== 'boards') return;
    const count = $('.cat[data-cat="players"] .cat-count');
    if (!list) { box.innerHTML = '<p class="hint">Couldn\'t reach the world boards.</p>'; if (count) count.textContent = 'OFFLINE'; return; }
    const mine = new Set(save.data.library.map((s) => s.key));
    remoteSongs = list.filter((g) => !mine.has(g.key)).slice(0, 30);
    if (count) count.textContent = `${remoteSongs.length} SONG${remoteSongs.length === 1 ? '' : 'S'}`;
    box.innerHTML = (remoteSongs.length
      ? '<p class="hint">Songs other players imported. Challenge them with your own copy of the song.</p>' + remoteSongs.map((g, i) => {
        const tiers = Object.keys(g.boards).map((d) => SHORT[d]).join(' · ');
        const have = save.data.library.some((s) => s.fp && g.fp && SaveData.similarity(s.fp, g.fp) >= SaveData.MATCH_THRESHOLD);
        return `<button data-remote="${i}" style="--acc:var(--cyan)"><svg class="ico"><use href="#i-trophy"/></svg>` +
          `<span class="row-main"><b>${esc(String(g.title).toUpperCase().slice(0, 40))}</b><small>${esc(tiers)}${g.duration ? ' · ' + fmtTime(g.duration) : ''}</small></span>` +
          `${have ? '<span class="have-tag">IN YOUR MUSIC</span>' : ''}<svg class="chev"><use href="#i-chev"/></svg></button>`;
      }).join('')
      : '<p class="hint">No one has posted an imported song yet.</p>');
  }

  /** Which tier to open a remote song on: one this device can challenge, if there is one. */
  function remoteTier(boards) {
    const ids = Object.keys(boards);
    return ids.find((d) => canChallenge(d) === true && !parseId(d).tiles) || ids.find((d) => canChallenge(d) === true) || ids[0];
  }

  /**
   * Your copy of a song someone else posted: the song that's open, or one saved
   * in Your music, matched by sound (or by the same key / title words).
   */
  async function findCopy(fp, title, songKey) {
    let saved = new Set();
    try { saved = new Set((await Library.list()).map((m) => m.key)); } catch (e) { /* none saved */ }
    const words = (x) => new Set(String(x || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    const want = words(title);
    const cands = [];
    if (current && current.kind === 'mp3') cands.push({ key: current.key, fp: current.fp, title: current.title, current: true });
    for (const s of save.data.library) if (saved.has(s.key) && !(current && current.key === s.key)) cands.push({ key: s.key, fp: s.fp, title: s.title });
    let best = null;
    let bestScore = 0;
    for (const c of cands) {
      let sc = c.key === songKey ? 10 : 0;
      if (fp && c.fp) {
        sc += 3 * SaveData.similarity(fp, c.fp);
        if (World.tempoKeys(fp.bpm).includes(Math.round(c.fp.bpm))) sc += 0.5;
      }
      for (const w of words(c.title)) if (want.has(w)) sc += 1;
      if (sc > bestScore) { best = c; bestScore = sc; }
    }
    return bestScore >= 1.5 ? best : null;
  }

  $('#boards-pick').addEventListener('click', (e) => {
    const pf = e.target.closest('[data-pick-family]');
    const pt = e.target.closest('[data-pick-tier]');
    if (!pf && !pt) return;
    const fam = pf ? pf.dataset.pickFamily : boardsPick.fam;
    setBoardsPick(fam, pt ? parseId(pt.dataset.pickTier).difficulty : boardsPick.base);
    const keep = $('#boards-list').closest('.scroll');
    const top = keep ? keep.scrollTop : 0;
    renderBoards();
    if (keep) keep.scrollTop = top;
    const sel = pf ? `[data-pick-family="${fam}"]` : `[data-pick-tier="${boardsTier()}"]`;
    requestAnimationFrame(() => { const el = $(sel); if (el) el.focus({ preventScroll: true }); });
  });

  $('#boards-list').addEventListener('click', (e) => {
    const h = e.target.closest('[data-cat-toggle]');
    if (h) { toggleCat('boards', h); return; }

    const rb = e.target.closest('[data-remote]');
    if (rb) {
      const g = remoteSongs[+rb.dataset.remote];
      if (g) openBoard(g.key, g.title, remoteTier(g.boards), 'boards', 'world', { key: g.key, title: g.title, fp: g.fp, boards: g.boards });
      return;
    }
    const bb = e.target.closest('[data-boss-board]');
    if (bb) {
      const def = SongPack.SONGS.find((x) => x.id === bb.dataset.bossBoard);
      openBoard(SongPack.keyFor(def), def.title, bossIdFor(boardsPick.fam === 'tiles' ? 'keys' : boardsPick.fam), 'boards');
      return;
    }
    const b = e.target.closest('[data-board-key]');
    if (b) openBoard(b.dataset.boardKey, b.dataset.title, boardsTier(), 'boards');
  });

  /** Open a leaderboard. `remote`: someone else's imported song ({ key, title, fp, boards: {tier: boardId} }). */
  function openBoard(key, title, diff, back, scope = boardState.scope, remote = null, daily = null) {
    boardState = { key, title, songTitle: title, diff, back, scope: daily ? 'world' : scope, worldId: null, remote, daily };
    $('#screen-board').dataset.back = back;
    const ready = renderBoard();
    show('board', { focus: '#board-scope .on' });
    return ready;
  }

  /**
   * One score as a card: medal, initials, score, then details; your own is lit
   * gold. On world boards #1 wears the leader's crown, and other players' scores
   * have a CHALLENGE button.
   */
  function scoreCard(r, i, { mine, tag, challenge, crown } = {}) {
    const recentBeat = r.beat && r.date && Date.now() - Date.parse(r.date) < 7 * 864e5;
    const tags = (mine ? '<span class="you-tag">YOU</span>' : '') +
      (tag ? ` <span class="tag">${tag}</span>` : '') +
      (recentBeat ? `<span class="beat-tag"><svg><use href="#i-sword"/></svg>BEAT ${esc(r.beat)}</span>` : '');
    return `<div class="score-row${i < 3 ? ' r' + (i + 1) : ''}${mine ? ' me' : ''}">
      <span class="rank">${i + 1}</span>
      <span class="who">${esc(r.initials)}${tags}</span>
      <span class="pts">${Number(r.score).toLocaleString('en-US')}</span>
      <span class="sub">${r.laps != null ? `${r.laps} lap${r.laps === 1 ? '' : 's'} · x${Number(r.topSpeed || 1).toFixed(2)} speed` : `${Number(r.accuracy).toFixed(1)}% · ${r.maxCombo} streak`} · ${esc(fmtDate(r.date))}</span>
      <span class="gr">${esc(r.grade)}${r.fullCombo ? ' FC' : ''}</span>
      ${crown || challenge ? `<span class="row-acts">${crown ? '<span class="leader"><svg><use href="#i-crown"/></svg>LEADER</span>' : ''}${challenge ? `<button class="btn small primary ch-btn" data-challenge="${i}"><svg><use href="#i-sword"/></svg>CHALLENGE</button>` : ''}</span>` : ''}
    </div>`;
  }

  /** Your best, pinned under the list. */
  function pinYou(rows, isMine, world = false) {
    const i = rows.findIndex(isMine);
    $('#board-you').innerHTML = i < 0 ? '' : '<span class="you">YOUR BEST</span>' + scoreCard(rows[i], i, { mine: true, crown: world && i === 0 });
  }

  function renderBoard() {
    const { key, title, diff } = boardState;
    $('#board-title').textContent = title;
    const fam = familyOf(diff);
    $('#board-tabs').innerHTML =
      '<div class="chips">' + Object.entries(FAMILIES).map(([f, label]) => `<button data-board-family="${f}" class="${f === fam ? 'on' : ''}">${label}</button>`).join('') + '</div>' +
      // One tab per difficulty, all in view: the lit one is the board below, and each says
      // who leads it (or that nobody has a score there yet).
      `<div class="diff-tabs" role="tablist" aria-label="Difficulty">${tiersFor(fam, boardState.daily || boardState.remote ? null : key).filter((d) => !boardState.daily || d === diff).map((d) =>
        `<button role="tab" data-board-tier="${d}" data-base="${parseId(d).difficulty}" class="${d === diff ? 'on' : ''}" aria-selected="${d === diff}">` +
        `<b>${BASE_LABEL(parseId(d).difficulty)}</b><small class="tab-lead">…</small></button>`).join('')}</div>`;
    $('#board-now').innerHTML = (boardState.daily ? `★ SONG OF THE DAY ${esc(boardState.daily)} · ` : '') +
      `<span class="board-now-tier" data-base="${parseId(diff).difficulty}">${BASE_LABEL(parseId(diff).difficulty)}</span> LEADERBOARD · ${FAMILIES[fam]}`;
    $('#board-scope').hidden = !!boardState.daily;
    fillTabLeaders();
    $('#board-scope').innerHTML = ['world', 'local'].map((sc) =>
      `<button data-board-scope="${sc}" class="${sc === boardState.scope ? 'on' : ''}">${sc === 'local' ? 'THIS DEVICE' : 'WORLD'}</button>`).join('');
    $('#board-versions').innerHTML = '';
    $('#board-you').innerHTML = '';
    $('#board-note').textContent = '';
    $('#btn-board-play').textContent = boardState.worldId ? 'PLAY THEIR NOTES' : boardState.daily ? 'PLAY THE SONG OF THE DAY' : 'PLAY THIS SONG';
    if (boardState.scope === 'world') return renderWorldBoard();
    const rows = save.leaderboard(key, diff, 25);
    const me = save.active;
    const isMine = (r) => !r.rival && me && r.profileId === me.id;
    $('#board-table').innerHTML = rows.length
      ? rows.map((r, i) => scoreCard(r, i, { mine: isMine(r), tag: r.rival ? (r.verified === false ? 'UNVERIFIED' : 'RIVAL') : '' })).join('')
      : boardMsg(`No ${esc(LABEL(diff))} scores on this device yet. Be the first.`);
    pinYou(rows, isMine);
    return Promise.resolve();
  }

  $('#board-tabs').addEventListener('click', (e) => {
    // Another version's board is one chart, at one tier: other tabs go back to this song.
    if (boardState.worldId) { boardState.worldId = null; boardState.title = boardState.songTitle; }
    const f = e.target.closest('[data-board-family]');
    if (f && boardState.daily) {
      // Today's board for another way of playing.
      boardState.diff = Daily.tierFor(Daily.pick(SongPack.SONGS, boardState.daily).base, f.dataset.boardFamily);
      renderBoard();
      requestAnimationFrame(() => { const el = $(`[data-board-family="${f.dataset.boardFamily}"]`); if (el) el.focus(); });
      return;
    }
    if (f) {
      // Same tier, other input: 'hard' ↔ 'touch4:hard' ↔ 'touch2:hard'.
      const base = parseId(boardState.diff).difficulty;
      const ids = tiersFor(f.dataset.boardFamily, boardState.remote ? null : boardState.key);
      boardState.diff = ids.find((id) => parseId(id).difficulty === base) || ids[0];
      renderBoard();
      requestAnimationFrame(() => { const el = $(`[data-board-family="${f.dataset.boardFamily}"]`); if (el) el.focus(); });
      return;
    }
    const tab = e.target.closest('[data-board-tier]');
    if (!tab || tab.dataset.boardTier === boardState.diff) return;
    boardState.diff = tab.dataset.boardTier;
    renderBoard();
    requestAnimationFrame(() => { const el = $(`[data-board-tier="${tab.dataset.boardTier}"]`); if (el) el.focus(); });
  });

  /** The world board for a tier of the song on screen, if it has one. */
  function boardIdFor(d) {
    const { key, remote } = boardState;
    if (boardState.daily) return Daily.boardId(boardState.daily, d, Daily.pick(SongPack.SONGS, boardState.daily).songId);
    if (remote) return remote.boards[d] || null;
    return songBoardsAll(key)[d] || null;
  }
  /** Like songBoards, for every tier of every way to play (not just the current one). */
  function songBoardsAll(key) {
    const out = {};
    for (const fam of Object.keys(FAMILIES)) {
      for (const d of tiersFor(fam, key)) {
        if (/^(pack|bonus):/.test(key)) out[d] = World.boardId(key, d);
        else {
          const run = save.data.runs.slice().reverse().find((r) => r.songKey === key && r.difficulty === d && r.world);
          if (run) out[d] = run.world;
        }
      }
    }
    return out;
  }

  /** Each difficulty tab: who leads that board, or that nobody's on it yet. */
  function fillTabLeaders() {
    const { key, scope } = boardState;
    for (const tab of $$('#board-tabs [data-board-tier]')) {
      const d = tab.dataset.boardTier;
      const el = $('.tab-lead', tab);
      const show = (r) => {
        if (!el.isConnected) return;
        tab.classList.toggle('led', !!r);
        el.innerHTML = r ? `<svg><use href="#i-crown"/></svg>${esc(r.mine ? 'YOU' : String(r.initials || '???').toUpperCase())}` : 'NO ONE YET';
      };
      if (scope === 'local' || !World.available()) { show(localRecord(key, d)); continue; }
      const id = boardIdFor(d);
      if (!id) { show(null); continue; }
      worldRecordOr(id).then(show, () => { if (el.isConnected) el.textContent = '—'; });
    }
  }

  $('#btn-board-play').addEventListener('click', async () => {
    const { key, title, diff } = boardState;
    if (boardState.worldId) { openVersus(worldRows[0] || null); return; }
    if (boardState.daily) { startDaily(familyOf(diff) === 'tiles' ? 'tiles' : 'frets'); return; }
    if (boardState.remote) {
      const copy = await findCopy(boardState.remote.fp, title, key);
      lastDifficulty = diff;
      if (!copy) {
        songOrigin = 'import';
        renderImport(`Import your copy of "${title}" to play it. Any version works.`);
        show('import');
      } else if (copy.current) { songOrigin = 'boards'; showSong(); }
      else { songOrigin = 'boards'; loadSaved(copy.key); }
      return;
    }
    lastDifficulty = diff;
    if (key.startsWith('pack:')) { songOrigin = 'boards'; loadPack(key.slice(5)); }
    else if (key.startsWith('bonus:')) { songOrigin = 'boards'; loadBonus(key.slice(6)); }
    else if (current && current.key === key) { songOrigin = 'boards'; showSong(); }
    else {
      Library.has(key).then((saved) => {
        if (saved) { songOrigin = 'boards'; loadSaved(key); return; }
        songOrigin = 'import';
        renderImport(`Import your copy of "${title}" to play it.`);
        show('import');
      });
    }
  });

  // ---- players ------------------------------------------------------------------------------------------

  let deleteArmed = false;

  function renderPlayers() {
    deleteArmed = false;
    $('#btn-delete-player').textContent = 'DELETE';
    const active = save.active;
    $('#players-list').innerHTML = save.profiles.map((p) => {
      const on = active && p.id === active.id;
      return `<button data-player="${esc(p.id)}" style="--acc:${esc(p.color)}" ${on ? 'data-autofocus' : ''}><span class="player-dot" style="background:${esc(p.color)}"></span>` +
        `<span class="row-main"><b>${esc(p.initials)}</b><small>${on ? 'Playing now' : 'Tap to switch to this player'}</small></span>${on ? '<span class="badge">ACTIVE</span>' : ''}</button>`;
    }).join('') || '<p class="hint">No players yet.</p>';
    if (active) {
      const s = save.stats(active.id);
      $('#player-stats').innerHTML = `<div><b>PLAYS</b>${s.plays}</div><div><b>NOTES HIT</b>${s.notesHit.toLocaleString('en-US')}</div><div><b>FULL COMBOS</b>${s.fullCombos}</div><div><b>BEST STREAK</b>${s.bestCombo}</div><div><b>STARS</b>${s.stars}★</div>`;
    } else $('#player-stats').innerHTML = '';
    $('#btn-rename').disabled = !active;
    $('#btn-delete-player').disabled = !active;
    $('#players-status').textContent = '';
  }

  $('#players-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-player]');
    if (!b) return;
    save.setActive(b.dataset.player);
    renderPlayers();
    renderMain();
    $('#players-status').textContent = `Now playing as ${save.active.initials}.`;
    requestAnimationFrame(() => { const el = $(`[data-player="${b.dataset.player}"]`); if (el) el.focus(); });
  });

  $('#btn-new-player').addEventListener('click', () => {
    initials.open(null, (txt) => { save.createProfile(txt); renderPlayers(); renderMain(); show('players'); }, 'players');
  });
  $('#btn-rename').addEventListener('click', () => {
    const p = save.active;
    if (p) initials.open(p.initials, (txt) => { save.renameProfile(p.id, txt); renderPlayers(); renderMain(); show('players'); }, 'players');
  });
  $('#btn-delete-player').addEventListener('click', () => {
    const p = save.active;
    if (!p) return;
    if (!deleteArmed) {
      deleteArmed = true;
      $('#btn-delete-player').textContent = `PRESS AGAIN TO DELETE ${p.initials}`;
      return;
    }
    save.deleteProfile(p.id);
    renderPlayers();
    renderMain();
    $('#players-status').textContent = `Deleted ${p.initials} and their scores.`;
  });

  // ---- options -------------------------------------------------------------------------------------------

  // Options don't take effect straight away: a change is held as a draft (and
  // lit up), and only SAVE applies it. UNDO, or leaving and choosing DISCARD,
  // throws it away. That way a slider nudged by accident changes nothing.
  let draft = {};
  const hasDraft = () => Object.keys(draft).length > 0;
  const val = (key) => (key in draft ? draft[key] : settings[key]);
  const OPT_LABEL = {
    speed: 'Note speed', calibrationMs: 'Audio offset', calibrationTouchMs: 'Audio offset', music: 'Music volume', sfx: 'Effects volume',
    tilesLineUp: 'Tiles line', strikeUp4: 'Strike line, sideways', strikeUp2: 'Strike line, upright', crt: 'CRT scanlines',
    shake: 'Screen shake', noFail: 'No-fail mode', hitSounds: 'Hit sounds', vibrate: 'Vibration', autoPost: 'Auto-post',
  };
  const lineText = (up, lo, hi) => (up <= lo ? 'LOW' : up >= hi ? 'HIGH' : 'MIDDLE') + ` (${up}%)`;
  const OPT_SHOW = {
    speed: (v) => Number(v).toFixed(1) + 'x',
    calibrationMs: (v) => (v > 0 ? '+' : '') + v + ' ms',
    calibrationTouchMs: (v) => (v > 0 ? '+' : '') + v + ' ms',
    music: (v) => Math.round(v * 100) + '%',
    sfx: (v) => Math.round(v * 100) + '%',
    tilesLineUp: (v) => lineText(v, 22, 38),
    strikeUp4: (v) => lineText(v, 22, 34),
    strikeUp2: (v) => lineText(v, 16, 26),
  };
  const showVal = (key, v) => (OPT_SHOW[key] ? OPT_SHOW[key](v) : v ? 'ON' : 'OFF');

  function setDraft(key, v) {
    if (v === settings[key]) delete draft[key]; else draft[key] = v;
    if (key === 'music' || key === 'sfx') previewVolume(key);
    renderOptions();
  }

  /** Hear a volume change before saving it (the saved volume comes back on UNDO). */
  let previewAt = 0;
  function previewVolume(key) {
    Sfx.setVolumes(val('music'), val('sfx'));
    if (key === 'sfx' && performance.now() - previewAt > 120) { previewAt = performance.now(); Sfx.tick(); }
  }

  function saveDraft() {
    const keys = Object.keys(draft);
    for (const k of keys) save.setSetting(k, draft[k]);
    draft = {};
    Sfx.setVolumes(settings.music, settings.sfx);
    if (keys.some((k) => k.startsWith('strikeUp'))) applyStrike();
    renderOptions();
    if (keys.length) { Sfx.select(); toast(keys.length === 1 ? `${OPT_LABEL[keys[0]] || 'Setting'} saved.` : `${keys.length} settings saved.`); }
  }

  function undoDraft() {
    draft = {};
    Sfx.setVolumes(settings.music, settings.sfx);
    renderOptions();
  }

  function renderOptions() {
    const range = (id, key) => {
      const v = val(key);
      $(id).value = v;
      $(id + '-out').textContent = showVal(key, v);
      const pending = key in draft;
      const label = $(`label[for="${id.slice(1)}"]`);
      label.classList.toggle('pending', pending);
      $(id).classList.toggle('pending', pending);
      label.dataset.was = pending ? 'WAS ' + showVal(key, settings[key]) : '';
    };
    range('#opt-speed', 'speed');
    $('#opt-calib').dataset.key = calKey();
    range('#opt-calib', calKey());
    $('#opt-calib-label').textContent = Input.touch ? 'AUDIO OFFSET (TOUCH)' : 'AUDIO OFFSET';
    $('#opt-vibrate').hidden = !navigator.vibrate;
    range('#opt-music', 'music');
    range('#opt-sfx', 'sfx');
    range('#opt-tiles-line', 'tilesLineUp');
    range('#opt-strike4', 'strikeUp4');
    range('#opt-strike2', 'strikeUp2');
    for (const [id, key] of TOGGLES) {
      const b = $(id);
      const on = !!val(key);
      $('span', b).textContent = on ? 'ON' : 'OFF';
      b.classList.toggle('on', on);
      b.classList.toggle('pending', key in draft);
      const sm = $('small', b);
      if (sm) sm.dataset.was = key in draft ? 'WAS ' + (settings[key] ? 'ON' : 'OFF') : '';
    }
    $('#opt-world-group').hidden = !World.available();
    document.body.classList.toggle('crt', settings.crt);
    const n = Object.keys(draft).length;
    $('#opt-save-bar').hidden = !n;
    $('#opt-save-count').textContent = n === 1 ? '1 UNSAVED CHANGE' : `${n} UNSAVED CHANGES`;
    updateDeviceUI();
  }

  const TOGGLES = [['#opt-crt', 'crt'], ['#opt-shake', 'shake'], ['#opt-nofail', 'noFail'], ['#opt-hits', 'hitSounds'], ['#opt-vibrate', 'vibrate'], ['#opt-autopost', 'autoPost']];
  const bindRange = (id, key, parse) => $(id).addEventListener('input', (e) => setDraft(typeof key === 'function' ? key() : key, parse(e.target.value)));
  bindRange('#opt-speed', 'speed', parseFloat);
  bindRange('#opt-calib', () => calKey(), (x) => parseInt(x, 10));
  bindRange('#opt-music', 'music', parseFloat);
  bindRange('#opt-sfx', 'sfx', parseFloat);
  bindRange('#opt-strike4', 'strikeUp4', (x) => parseInt(x, 10));
  bindRange('#opt-strike2', 'strikeUp2', (x) => parseInt(x, 10));
  bindRange('#opt-tiles-line', 'tilesLineUp', (x) => parseInt(x, 10));
  for (const [id, key] of TOGGLES) $(id).addEventListener('click', () => setDraft(key, !val(key)));
  $('#btn-strike').addEventListener('click', () => openStrikeSetup('options'));
  $('#opt-save').addEventListener('click', saveDraft);
  $('#opt-undo').addEventListener('click', () => { Sfx.back(); undoDraft(); });

  /** Leaving Options with unsaved changes: SAVE, DISCARD, or stay. */
  function askKeep(then) {
    const n = Object.keys(draft);
    $('#keep-list').innerHTML = n.map((k) => `<li>${esc(OPT_LABEL[k] || k)}: ${esc(showVal(k, settings[k]))} → <b>${esc(showVal(k, draft[k]))}</b></li>`).join('');
    $('#keep-pop').hidden = false;
    Sfx.error();
    const done = (choice) => {
      $('#keep-pop').hidden = true;
      $('#keep-save').onclick = $('#keep-discard').onclick = $('#keep-stay').onclick = null;
      askKeep.cancel = null;
      if (choice === 'save') saveDraft();
      if (choice === 'discard') undoDraft();
      if (choice !== 'stay') then();
      else requestAnimationFrame(() => $('#opt-save').focus());
    };
    $('#keep-save').onclick = () => done('save');
    $('#keep-discard').onclick = () => done('discard');
    $('#keep-stay').onclick = () => done('stay');
    askKeep.cancel = () => done('stay');
    requestAnimationFrame(() => $('#keep-save').focus());
  }

  /** Keyboard/controller and touch each keep their own timing offset. */
  const calKey = () => (Input.touch ? 'calibrationTouchMs' : 'calibrationMs');

  // ---- calibration ---------------------------------------------------------------------------------------

  const calibrate = (() => {
    const INTERVAL = 0.5;
    const COUNT = 16;
    const SKIP = 4;
    let start = 0;
    let offsets = [];
    let running = false;
    let timer = null;
    const latency = () => audioCtx.outputLatency || audioCtx.baseLatency || 0;

    function tap(perfMs) {
      if (!running) return;
      const t = audioCtx.currentTime - latency() - start - (performance.now() - perfMs) / 1000;
      const idx = Math.round(t / INTERVAL);
      if (idx < 0 || idx >= COUNT) return;
      $('#calib-dots').children[idx].classList.add('hit');
      if (idx >= SKIP) offsets.push(t - idx * INTERVAL);
    }

    function cancel() {
      running = false;
      clearTimeout(timer);
    }

    async function run() {
      const c = ensureAudio();
      await c.resume();
      show('calib');
      const dots = $('#calib-dots');
      dots.innerHTML = '<span></span>'.repeat(COUNT);
      $('#calib-status').textContent = 'Get ready…';
      offsets = [];
      start = c.currentTime + 1.0;
      for (let i = 0; i < COUNT; i++) {
        const t = start + i * INTERVAL;
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'square';
        o.frequency.value = i % 4 === 0 ? 1320 : 880;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        o.connect(g).connect(c.destination);
        o.start(t);
        o.stop(t + 0.06);
      }
      running = true;
      const animate = () => {
        if (!running) return;
        const t = c.currentTime - latency() - start;
        const idx = Math.floor(t / INTERVAL);
        Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i === idx));
        if (t >= 0) $('#calib-status').textContent = 'Tap on every click';
        requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
      timer = setTimeout(() => {
        cancel();
        if (offsets.length < 5) { $('#calib-status').textContent = 'Not enough taps. Try again.'; return; }
        offsets.sort((a, b) => a - b);
        const median = offsets[offsets.length >> 1];
        save.setSetting(calKey(), Math.max(-200, Math.min(200, Math.round(median * 1000))));
        delete draft[calKey()];
        renderOptions();
        $('#calib-status').textContent = `Done. Offset set to ${settings[calKey()]} ms.`;
      }, (1.0 + COUNT * INTERVAL + 0.6) * 1000);
    }

    window.addEventListener('keydown', (e) => {
      if (screen === 'calib' && e.code === 'Space' && !e.repeat) { e.preventDefault(); tap(e.timeStamp); }
    });
    // On a phone, tap anywhere on the calibration screen (except its buttons).
    $('#screen-calib').addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' && !e.target.closest('button')) { e.preventDefault(); tap(e.timeStamp); }
    });
    return { run, tap, cancel };
  })();

  $('#btn-calibrate').addEventListener('click', () => calibrate.run());

  // ---- save data ------------------------------------------------------------------------------------------

  let resetArmed = false;
  $('#btn-export').addEventListener('click', () => {
    download(new Blob([save.exportJSON()], { type: 'application/json' }), `beat-frets-save-${new Date().toISOString().slice(0, 10)}.json`);
    $('#data-status').textContent = 'Save file downloaded. Keep it somewhere safe.';
  });
  $('#btn-import-save').addEventListener('click', () => $('#save-file').click());
  $('#save-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const added = save.importJSON(await f.text());
      renderMain();
      $('#data-status').textContent = `Imported ${added.profiles} players, ${added.runs} scores and ${added.rivals} rival scores. Nothing was overwritten.`;
    } catch (err) {
      $('#data-status').textContent = err.message.startsWith('This is not') ? err.message : 'That file could not be read as a Beat Frets save.';
      Sfx.error();
    }
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!resetArmed) {
      resetArmed = true;
      $('#btn-reset').textContent = 'PRESS AGAIN TO ERASE EVERYTHING';
      $('#data-status').textContent = 'This deletes every player, score and rival on this device.';
      return;
    }
    resetArmed = false;
    save.reset();
    $('#btn-reset').textContent = 'ERASE ALL SCORES';
    $('#data-status').textContent = 'All players and scores erased.';
    renderMain();
    renderTitle();
  });

  // ---- drag & drop ---------------------------------------------------------------------------------------------

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    if (game) return;
    const file = e.dataTransfer.files[0];
    if (file) { songOrigin = 'import'; importFile(file); }
  });

  // ---- phones: layout, orientation, wake lock, full screen ------------------------------------------------

  /** Match the stage to the current device and orientation (not during a song). */
  function applyLayout() {
    document.body.classList.toggle('touch', Input.touch);
    document.body.classList.toggle('no-tiles', !TILES_ON);
    if (game) return;
    stage.setLayout(layoutMode(), window.innerWidth / window.innerHeight);
    checkOrientation();
  }

  let resizeTimer = 0;
  let lastLandscape = window.innerWidth > window.innerHeight;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (game) {
        // Turned the wrong way mid-song: pause and ask to turn it back.
        if (!checkOrientation()) stage.setLayout(gameLayout, window.innerWidth / window.innerHeight);
        return;
      }
      renderModes();
      if (screen === 'main') renderDaily();
      // Tiles is upright only: turned sideways in its menus, you're in Beat Frets (4 lanes).
      if (Input.touch && session.mode === 'tiles' && window.innerWidth > window.innerHeight && ['pack', 'import', 'song'].includes(screen)) {
        session.mode = 'frets';
        session.orient = null;
        orientation.release();
        applyLayout();
        if (screen === 'song' && current) showSong(); else if (screen === 'pack') renderPack(); else renderImport();
        renderCrumbs(screen);
        toast('Sideways: Beat Frets on 4 lanes. Tiles is played upright.');
        return;
      }
      // A sideways/upright choice the browser couldn't lock gives way to how the phone is held.
      if (session.mode === 'frets' && session.orient && !orientation.locked) { session.orient = null; orientation.release(); }
      checkOrientation();
      const before = stage.layout;
      applyLayout();
      const land = window.innerWidth > window.innerHeight;
      const turned = land !== lastLandscape;
      lastLandscape = land;
      if ((stage.layout !== before || turned) && screen === 'song' && current) showSong();
      if (stage.layout !== before && screen) renderCrumbs(screen);
    }, 150);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  Input.on('device', () => {
    const before = stage.layout;
    applyLayout();
    if (!game && stage.layout !== before && screen === 'song' && current) showSong();
    renderOptions();
  });

  const wakeLock = {
    lock: null,
    async acquire() {
      try {
        if ('wakeLock' in navigator && !this.lock) {
          this.lock = await navigator.wakeLock.request('screen');
          this.lock.addEventListener('release', () => { this.lock = null; });
        }
      } catch (e) { /* not allowed; the screen may dim */ }
    },
    release() {
      if (this.lock) { this.lock.release().catch(() => {}); this.lock = null; }
    },
  };

  // Phone call, app switch or locked screen: pause, and keep the screen awake again on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game && !game.paused) game.pause();
    if (!document.hidden && game) wakeLock.acquire();
  });

  // Fingers on the stage play the lanes (and the OD and pause buttons).
  Input.attachTouch($('#stage'), (x, y) => {
    if (!game) return null;
    if (game instanceof TilesGame) return game.hitTest(x, y);
    const hit = stage.hitTest(x, y, game.lanes);
    if (hit && hit.type === 'lane') hit.lane = game.assistLane(hit.lane, hit.pos);
    return hit;
  });

  // ---- strike line height (phones) -------------------------------------------------------------------------
  // Stored as % of the screen above the bottom edge, so "higher" means a bigger number.

  const STRIKE_UP = { 4: [16, 40, 28], 2: [10, 32, 20] }; // min, max, default
  function applyStrike() {
    stage.setStrike('touch4', 1 - settings.strikeUp4 / 100);
    stage.setStrike('touch2', 1 - settings.strikeUp2 / 100);
  }
  applyStrike();

  let strikeReturn = 'play';
  function openStrikeSetup(ret) {
    strikeReturn = ret;
    $('#screen-strike-setup').dataset.back = ret === 'options' ? 'options' : ret === 'results' ? 'results' : 'song';
    applyLayout();
    show('strike-setup');
  }
  function setStrikeFromScreen(clientY) {
    const mode = stage.layout;
    if (mode === 'keys') return;
    const n = mode === 'touch4' ? 4 : 2;
    const [lo, hi] = STRIKE_UP[n];
    const y = stage.toBuffer(0, clientY).y;
    const up = Math.round((1 - y / stage.height) * 100);
    save.setSetting('strikeUp' + n, Math.max(lo, Math.min(hi, up)));
    delete draft['strikeUp' + n];
    applyStrike();
  }
  let strikeDrag = null;
  $('#stage').addEventListener('pointerdown', (e) => {
    if (screen !== 'strike-setup' || game) return;
    strikeDrag = e.pointerId;
    setStrikeFromScreen(e.clientY);
  });
  $('#stage').addEventListener('pointermove', (e) => { if (strikeDrag === e.pointerId) setStrikeFromScreen(e.clientY); });
  window.addEventListener('pointerup', () => { strikeDrag = null; });
  window.addEventListener('pointercancel', () => { strikeDrag = null; });
  $('#btn-strike-reset').addEventListener('click', () => {
    const n = stage.layout === 'touch2' ? 2 : 4;
    save.setSetting('strikeUp' + n, STRIKE_UP[n][2]);
    delete draft['strikeUp' + n];
    applyStrike();
  });
  $('#btn-strike-done').addEventListener('click', () => {
    if (strikeReturn === 'options') { renderOptions(); show('options'); return; }
    if (strikeReturn === 'results') { show('results'); return; }
    const id = pendingPlay;
    pendingPlay = null;
    if (id) play(id); else showSong();
  });

  // First touch game: calibrate now or play.
  let calibReturn = 'options';
  $('#btn-res-line').addEventListener('click', () => openStrikeSetup('results'));
  $('#btn-res-calib').addEventListener('click', () => { calibReturn = 'results'; calibrate.run(); });
  $('#btn-offer-calib').addEventListener('click', () => { calibReturn = 'song'; calibrate.run(); });
  $('#btn-offer-play').addEventListener('click', () => { const id = pendingPlay; pendingPlay = null; if (id) play(id); });
  $('#btn-calib-done').addEventListener('click', leaveCalib);
  function leaveCalib() {
    calibrate.cancel();
    const to = calibReturn;
    calibReturn = 'options';
    if (to === 'results') show('results');
    else if (to === 'song' && current) showSong(); else { renderOptions(); show('options'); }
  }

  // ---- the phone's Back button ----------------------------------------------------------------------------------
  // Past the title screen, one spare history entry sits on top. Back (Android's button, the
  // browser's, an iPhone edge swipe) uses it up to step back one menu, or to pause mid-song,
  // instead of leaving the game. From the title screen, Back leaves as usual.

  let guarded = false;
  function guardHistory() {
    if (guarded) return;
    guarded = true;
    history.pushState({ beatFrets: true }, '');
  }
  window.addEventListener('popstate', () => {
    if (!guarded) return; // a share link's hash changing, not Back
    guarded = false;
    if (game) {
      restartHold.cancel();
      if (!game.paused) game.pause();
    } else if (screen === 'results' && resultsAnim) {
      resultsAnim();
    } else {
      goBack();
    }
    if (game || (screen && screen !== 'title')) guardHistory();
  });
  // Browsers may skip history entries made without a tap, so re-arm on the next one.
  window.addEventListener('pointerdown', () => { if (game || (screen && screen !== 'title')) guardHistory(); }, true);

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('#ios-hint').hidden = !isIOS;

  // ---- installable app ------------------------------------------------------------------------------------------

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline play just won't be available */ });
    // A new version took over: reload into it, but never in the middle of something.
    const hadWorker = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadWorker) return;
      if (!game && (screen === 'title' || screen === 'main')) location.reload();
      else updateWaiting = true;
    });
  }

  // ---- boot ------------------------------------------------------------------------------------------------------

  function attractLoop() {
    if (!game) stage.attract(performance.now() / 1000);
    requestAnimationFrame(attractLoop);
  }

  applyLayout();
  renderTitle();
  renderOptions();
  updateDeviceUI();
  document.fonts.load('8px "Press Start 2P"').catch(() => {}).then(() => {});
  requestAnimationFrame(attractLoop);
  if (!checkHash()) show('title');

  // Read-only handle for debugging and automated tests.
  $('#app-version').textContent = 'v' + VERSION;
  $('#opt-version').textContent = 'Beat Frets v' + VERSION;

  window.BeatFrets = {
    version: VERSION,
    session,
    goHome,
    save,
    get game() { return game; },
    get current() { return current; },
    get screen() { return screen; },
    stage,
    Input,
    layoutMode,
    play,
    loadPack,
    loadBonus,
    loadSaved,
    importFile,
    openBoard,
    Library,
  };
})();
