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
  const VERSION = '1.11';
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const fmtDate = (iso) => (iso ? iso.slice(0, 10) : '');
  const DIFFS = Object.keys(ChartGen.DIFFICULTIES); // easy, medium, mediumplus, hard, duo
  /** 'hard', 'touch4:hard', 'touch2:hard', or a Tiles mode tier 'tiles:hard'. */
  const parseId = (id) => {
    const m = /^tiles:(\w+)$/.exec(id);
    return m ? { difficulty: m[1], lanes: 4, touch: false, tiles: true } : ChartGen.parseId(id);
  };
  const TILES_IDS = ['tiles:easy', 'tiles:medium', 'tiles:hard'];
  /** The chart a tier plays: Tiles mode uses the 4-lane phone chart. */
  const chartFor = (id) => (parseId(id).tiles ? current.charts['touch4:' + parseId(id).difficulty] : current.charts[id]);
  const BASE_LABEL = (d) => (ChartGen.DIFFICULTIES[d] ? ChartGen.DIFFICULTIES[d].label : d).toUpperCase();
  /** 'hard' → HARD; 'touch4:hard' → HARD · TOUCH 4 */
  const LABEL = (id) => {
    const p = parseId(id);
    return BASE_LABEL(p.difficulty) + (p.tiles ? ' · TILES' : p.touch ? ` · TOUCH ${p.lanes}` : '');
  };
  const SHORT_BASE = { easy: 'E', medium: 'M', mediumplus: 'M+', hard: 'H', duo: 'DUO' };
  const SHORT = new Proxy({}, { get: (_, id) => { const p = parseId(String(id)); return (p.tiles ? 'T' : '') + (SHORT_BASE[p.difficulty] || id) + (p.touch ? p.lanes : ''); } });
  const FAMILIES = { keys: 'KEYS', touch4: 'TOUCH 4', touch2: 'TOUCH 2', tiles: 'TILES' };
  const familyOf = (id) => { const p = parseId(id); return p.tiles ? 'tiles' : p.touch ? 'touch' + p.lanes : 'keys'; };
  const idsFor = (family) => (family === 'keys' ? DIFFS : family === 'tiles' ? TILES_IDS : ChartGen.TOUCH_TIERS.map((d) => family + ':' + d));

  // Which game the player picked on the home screen, and for Beat Frets on a
  // phone, which way up (sideways = 4 lanes, upright = 2 lanes).
  const session = { mode: null, orient: null };

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
      if (o && Input.touch && screen.orientation && screen.orientation.lock) screen.orientation.lock(o).catch(() => { /* not allowed here: the prompt covers it */ });
      checkOrientation();
    },
    release() {
      this.wanted = null;
      try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* nothing locked */ }
      checkOrientation();
    },
  };
  function wantedOrientation() {
    if (!Input.touch) return null;
    if (orientation.wanted) return orientation.wanted;
    if (game && gameLayout !== 'keys') return gameLayout === 'touch4' ? 'landscape' : 'portrait';
    return null;
  }
  /** Show the "turn your phone" prompt (and pause a song) while it's held the wrong way. */
  function checkOrientation() {
    const want = wantedOrientation();
    const wrong = !!want && (want === 'landscape') !== (window.innerWidth > window.innerHeight);
    $('#rotate').hidden = !wrong;
    $('#rotate-msg').textContent = want === 'landscape' ? 'TURN YOUR PHONE SIDEWAYS' : 'TURN YOUR PHONE UPRIGHT';
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
    return wrong;
  }
  const tilesMode = () => session.mode === 'tiles';
  const tierIds = () => (tilesMode() ? TILES_IDS : idsFor(layoutMode()));
  /** The chart id for a tier in the current layout ('hard' → 'touch4:hard' when sideways). */
  function idFor(base) {
    if (tilesMode()) return 'tiles:' + (base === 'easy' ? 'easy' : base === 'medium' ? 'medium' : 'hard');
    const m = layoutMode();
    return m === 'keys' ? base : m + ':' + (base === 'duo' ? 'hard' : base);
  }
  const WHAT = {
    easy: 'Strong beats only',
    medium: 'Off-beats and long notes',
    mediumplus: 'Near-Hard speed on 4 keys',
    hard: 'Everything, with chords',
    duo: 'Hard speed on 2 keys',
  };
  const WHAT_TOUCH = {
    easy: 'Strong beats only',
    medium: 'Off-beats and long notes',
    mediumplus: 'Faster runs',
    hard: 'Everything, with two-thumb chords',
  };
  const WHAT_TILES = {
    easy: 'Strong beats, gentle speed',
    medium: 'More tiles, long tiles',
    hard: 'Every tile, with doubles',
  };
  const LOOKAHEAD = { easy: 2.0, medium: 1.75, mediumplus: 1.55, hard: 1.5, duo: 1.5 };

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
    if (updateWaiting && !game && (name === 'title' || name === 'main')) { location.reload(); return; }
    stopPreview();
    stage.setupMode = name === 'strike-setup';
    if (name === 'main' || name === 'title') leaveMode();
    renderCrumbs(name);
    screen = name;
    $('#panel').classList.toggle('hidden', !name);
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    $('#hints').hidden = !name;
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
    if (!$('#pause').hidden) return $('#pause');
    return screen ? $('#screen-' + screen) : null;
  }

  function moveFocus(dir) {
    const root = activeRoot();
    if (!root) return;
    const items = focusables(root);
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
    if (!$('#pause').hidden) { if (game) game.resume(); return; }
    if (screen === 'initials') { initials.cancel(); return; }
    if (screen === 'calib') { leaveCalib(); return; }
    if (screen === 'strike-setup') {
      pendingPlay = null;
      Sfx.back();
      if (strikeReturn === 'options') { renderOptions(); show('options'); } else showSong();
      return;
    }
    if (screen === 'song') { Sfx.back(); show(songOrigin); return; }
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

  function renderMain() {
    const p = save.active;
    $('#main-player').textContent = p ? p.initials : 'none';
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

  function renderPack() {
    $('#pack-list').innerHTML = SongPack.SONGS.map((s, i) =>
      `<button data-pack="${esc(s.id)}" ${i === 0 ? 'data-autofocus' : ''}>${esc(s.title.toUpperCase())} <small>${s.bpm} BPM · ${esc(s.blurb)}<br>${esc(bestLine(SongPack.keyFor(s)))}</small></button>`
    ).join('');
    fetchBonusIndex().then((list) => {
      $('#bonus-section').hidden = !list.length;
      $('#bonus-list').innerHTML = list.map((s) =>
        `<button data-bonus="${esc(s.id)}">${esc(s.title.toUpperCase().slice(0, 40))} <small>${esc(s.artist || 'Bonus track')}<br>${esc(bestLine(BonusPack.keyFor(s.id)))}</small></button>`
      ).join('');
    });
  }

  $('#pack-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pack]');
    if (b) { songOrigin = 'pack'; loadPack(b.dataset.pack); }
  });
  $('#bonus-list').addEventListener('click', (e) => {
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
    if (!def) { toast('That bonus track is not on this site.'); return; }
    ensureAudio();
    show('loading');
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
      showSong();
    } catch (err) {
      console.error(err);
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
      box.innerHTML = (note ? `<p class="match">${esc(note)}</p>` : '') + '<p class="eyebrow">YOUR SAVED SONGS</p>' +
        songs.map((m) => `<div class="lib-row">
          <button data-saved="${esc(m.key)}">${esc(m.title.toUpperCase().slice(0, 36))} <small>${esc(bestLine(m.key))} · ${fmtSize(m.size)}</small></button>
          <button class="del" data-del="${esc(m.key)}" aria-label="Delete ${esc(m.title)}">DELETE</button>
        </div>`).join('');
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
  }

  async function loadPack(id) {
    const def = SongPack.SONGS.find((s) => s.id === id);
    if (!def) return;
    ensureAudio();
    show('loading');
    $('#loading-title').textContent = 'LOADING ' + def.title.toUpperCase();
    setProgress(0.2, 'Writing the charts…');
    const built = SongPack.build(def);
    const analysis = SongPack.toAnalysis(built);
    const charts = {};
    for (const id of ChartGen.ALL_IDS) charts[id] = ChartGen.generateId(analysis, id);
    setProgress(0.45, 'Tuning the sound chip…');
    try {
      const buffer = await packBuffer(id);
      setProgress(1, 'Ready');
      current = { key: SongPack.keyFor(def), title: def.title, kind: 'pack', packId: id, buffer, analysis, charts, fp: null, matchNote: null };
      showSong();
    } catch (err) {
      console.error(err);
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
    show('loading');
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
    previewBuffers.set('mp3:' + reg.key, buffer);
    showSong();
  }

  // ---- song previews ------------------------------------------------------------------------------

  const previewBuffers = new Map();
  const preview = { key: null, timer: 0, src: null, gain: null };

  function stopPreview() {
    clearTimeout(preview.timer);
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
  }

  /** Play a short faded loop from about a third of the way into a song. */
  function schedulePreview(key, getBuffer) {
    if (!audioCtx || game || key === preview.key) return;
    stopPreview();
    preview.key = key;
    preview.timer = setTimeout(async () => {
      let buf = null;
      try { buf = await getBuffer(); } catch (e) { buf = null; }
      if (preview.key !== key || !buf || game) return;
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const gain = audioCtx.createGain();
      const t = audioCtx.currentTime;
      const len = Math.min(12, buf.duration * 0.5);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(1, t + 0.5);
      gain.gain.setValueAtTime(1, t + len - 1);
      gain.gain.linearRampToValueAtTime(0, t + len);
      src.connect(gain).connect(Sfx.previewBus || audioCtx.destination);
      src.start(t, buf.duration * 0.3, len);
      preview.src = src;
      preview.gain = gain;
    }, 450);
  }

  async function packBuffer(id) {
    let buffer = bufferCache.get(id);
    if (!buffer) {
      buffer = await SongPack.render(SongPack.build(SongPack.SONGS.find((s) => s.id === id)));
      bufferCache.set(id, buffer);
    }
    return buffer;
  }

  async function savedBuffer(key) {
    const k = 'mp3:' + key;
    if (previewBuffers.has(k)) return previewBuffers.get(k);
    const bytes = await Library.get(key);
    if (!bytes) return null;
    const buf = await audioCtx.decodeAudioData(bytes);
    previewBuffers.set(k, buf);
    return buf;
  }

  function previewFor(el) {
    if (!el) return;
    if (el.dataset.pack) schedulePreview('pack:' + el.dataset.pack, () => packBuffer(el.dataset.pack));
    else if (el.dataset.bonus) {
      const cached = bonusCache.get(el.dataset.bonus);
      if (cached) schedulePreview('bonus:' + el.dataset.bonus, async () => cached.buffer);
    } else if (el.dataset.saved) schedulePreview('saved:' + el.dataset.saved, () => savedBuffer(el.dataset.saved));
  }
  document.addEventListener('focusin', (e) => previewFor(e.target.closest && e.target.closest('[data-pack], [data-bonus], [data-saved]')));
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-pack], [data-bonus], [data-saved]');
    if (el) previewFor(el);
  });

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
    const kind = { pack: 'Chiptune pack: identical charts for everyone', bonus: 'Bonus track: identical charts for everyone', mp3: 'Imported song' }[current.kind];
    $('#song-meta').textContent = `${fmtTime(current.analysis.duration)} · ~${Math.round(current.analysis.bpm)} BPM · ${kind}`;
    const credit = [current.artist, current.credit].filter(Boolean).join(' · ');
    $('#song-credit').hidden = !credit;
    $('#song-credit').textContent = credit;
    const mode = layoutMode();
    if (mode !== 'keys') {
      $('#song-meta').textContent = `${fmtTime(current.analysis.duration)} · ~${Math.round(current.analysis.bpm)} BPM · ` + (mode === 'touch4'
        ? (session.orient ? '4 lanes, sideways.' : '4 lanes. Turn your phone upright for 2.')
        : (session.orient ? '2 lanes, upright.' : '2 lanes. Turn your phone sideways for 4.'));
    }
    if (tilesMode()) $('#song-meta').textContent = `${fmtTime(current.analysis.duration)} · Tap each tile as it reaches the line. Two hearts, and every lap gets faster.`;
    $('#song-match').hidden = !current.matchNote;
    $('#song-match').textContent = current.matchNote || '';
    $('#diffs').innerHTML = tierIds().map((d) => {
      const c = chartFor(d);
      if (tilesMode()) {
        const base = parseId(d).difficulty;
        return `<div class="diff-col">
          <button class="diff" data-diff="${d}"><strong>${BASE_LABEL(base)}</strong>
            <span class="what">${esc(WHAT_TILES[base])}</span>
            <span class="keys" data-keys="4">${Input.touch ? '<span class="lanes-tag">4 COLUMNS</span>' : ''}</span>
            <span class="stats">${c.notes.length} tiles a lap</span>
            ${tilesBest(d)}
          </button>
          <ol class="mini-board">${miniBoard(current.key, d)}</ol>
        </div>`;
      }
      const n = c.notes.length;
      const holds = c.notes.filter((x) => x.len).length;
      return `<div class="diff-col">
        <button class="diff" data-diff="${d}"><strong>${BASE_LABEL(parseId(d).difficulty)}</strong>
          <span class="what">${esc((mode === 'keys' ? WHAT : WHAT_TOUCH)[parseId(d).difficulty] || '')}</span>
          <span class="keys" data-keys="${c.lanes}">${mode === 'keys' ? '' : `<span class="lanes-tag">${c.lanes} LANES</span>`}</span>
          <span class="stats">${n} notes · ${(n / Math.max(1, current.analysis.duration)).toFixed(1)}/sec${holds ? ` · ${holds} long` : ''}</span>
          ${cardStars(d)}
        </button>
        <ol class="mini-board">${miniBoard(current.key, d)}</ol>
      </div>`;
    }).join('');
    updateDeviceUI();
    show('song', { focus: `[data-diff="${idFor(parseId(lastDifficulty).difficulty)}"]` });
  }

  $('#diffs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-diff]');
    if (b) play(b.dataset.diff);
  });
  $('#btn-song-back').addEventListener('click', () => { if (songOrigin === 'import') renderImport(); show(songOrigin); });

  // ---- playing --------------------------------------------------------------------------------------

  let gameLayout = 'keys';
  let pendingPlay = null;

  async function play(difficulty) {
    if (!current) return;
    const tier = parseId(difficulty);
    if (tier.tiles) { playTiles(difficulty); return; }
    // First touch game: let the player put the strike line where their thumbs rest...
    if (tier.touch && !settings.strikeOffered) {
      save.setSetting('strikeOffered', true);
      pendingPlay = difficulty;
      openStrikeSetup('play');
      return;
    }
    // ...then offer a quick timing check, since phone audio delay varies a lot.
    if (tier.touch && !settings.touchCalibOffered) {
      save.setSetting('touchCalibOffered', true);
      pendingPlay = difficulty;
      show('calib-offer');
      return;
    }
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
    const chart = current.charts[difficulty];
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
      // Resting fingers make stray touches common, so the overhit rule is keys-only.
      antiMash: !tier.touch && settings.overhit && tier.difficulty !== 'easy',
      windowScale: tier.touch ? 1.15 : 1,
      holdGrace: tier.touch ? 0.12 : 0,
      vibrate: tier.touch && settings.vibrate,
      hitSounds: settings.hitSounds,
      playerColor: save.active ? save.active.color : '#58f8f8',
      best: save.active ? save.pace(save.active.id, current.key, difficulty) : null,
      intro: { title: current.title.toUpperCase().slice(0, 40), sub: LABEL(difficulty) },
      onEnd: (res) => {
        game = null;
        wakeLock.release();
        Input.setGameplay(false);
        applyLayout();
        showResults(difficulty, res);
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
      chart: chartFor(id),
      stage,
      tier: tier.difficulty,
      speed: settings.speed,
      duration: current.analysis.duration,
      beats: current.analysis.beats,
      lineUp: settings.tilesLineUp,
      calibration: (Input.touch ? settings.calibrationTouchMs : settings.calibrationMs) / 1000,
      vibrate: Input.touch && settings.vibrate,
      intro: { title: current.title.toUpperCase().slice(0, 40), sub: LABEL(id) },
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
    };
    const outcome = p ? save.addRun(run) : null;
    lastRun = outcome ? outcome.entry : { ...run, date: new Date().toISOString() };
    $('#tr-title').textContent = `${current.title.toUpperCase().slice(0, 40)} · ${LABEL(id)}`;
    $('#tr-score').textContent = res.score.toLocaleString('en-US');
    $('#tr-stars').innerHTML = tilesBadge(res.stars, res.crowns) + (res.crowns ? ` <span class="hint">${res.crowns} CROWN${res.crowns > 1 ? 'S' : ''}</span>` : '');
    $('#tr-flag').textContent = outcome && outcome.personalBest ? (before ? 'NEW PERSONAL BEST!' : 'FIRST CLEAR!') : '';
    $('#tr-tiles').textContent = res.tiles;
    $('#tr-perfect').textContent = res.counts.perfect;
    $('#tr-great').textContent = res.counts.great;
    $('#tr-cool').textContent = res.counts.cool;
    $('#tr-miss').textContent = res.counts.miss + res.counts.wrong;
    $('#tr-combo').textContent = res.maxCombo;
    $('#tr-laps').textContent = `${res.laps} · TOP SPEED x${res.topSpeed.toFixed(2)}`;
    show('tiles-results');
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
      // Tiles is always played upright.
      session.orient = Input.touch ? 'portrait' : null;
      orientation.want(session.orient);
      goSongs();
      return;
    }
    if (Input.touch) { show('frets-setup'); return; }
    goSongs();
  }
  function goSongs(which = 'pack') {
    const back = session.mode === 'frets' && Input.touch ? 'frets-setup' : 'main';
    $('#screen-pack').dataset.back = back;
    $('#screen-import').dataset.back = back;
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
  function renderCrumbs(name) {
    const IN_MODE = ['frets-setup', 'pack', 'import', 'song', 'results', 'tiles-results', 'board', 'share', 'strike-setup', 'calib-offer', 'calib'];
    const visible = !!session.mode && IN_MODE.includes(name);
    $('#crumbs').hidden = !visible;
    if (!visible) return;
    const parts = [MODE_LABEL[session.mode] + (session.mode === 'frets' && session.orient ? (session.orient === 'landscape' ? ' · 4 LANES' : ' · 2 LANES') : '')];
    if (name !== 'frets-setup') parts.push('SONGS');
    if (current && !['frets-setup', 'pack', 'import'].includes(name)) parts.push(current.title.toUpperCase().slice(0, 22));
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
  $('#btn-rotate-home').addEventListener('click', goHome);

  $('#btn-resume').addEventListener('click', () => game && game.resume());
  $('#btn-restart').addEventListener('click', () => { $('#pause').hidden = true; play(lastDifficulty); });
  $('#btn-quit').addEventListener('click', () => {
    if (game) game.stop();
    game = null;
    wakeLock.release();
    Input.setGameplay(false);
    applyLayout();
    $('#pause').hidden = true;
    showSong();
  });

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

  const NEXT_TIER = { easy: 'medium', medium: 'mediumplus', mediumplus: 'hard' };
  const PREV_TIER = { medium: 'easy', mediumplus: 'medium', hard: 'mediumplus', duo: 'mediumplus' };

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

  function showResults(difficulty, res) {
    const p = save.active;
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
      stars: res.stars,
      goldStars: res.goldStars,
      timeline: res.timeline,
      fp: current.kind === 'mp3' ? current.fp : undefined,
    };
    const outcome = p ? save.addRun(run) : null;
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
    $('#res-over-row').hidden = !res.overhits;
    $('#res-over').textContent = res.overhits;
    $('#btn-share').disabled = res.failed;

    // Stars and the next target.
    const starsEl = $('#res-stars');
    starsEl.innerHTML = starsHtml(0);
    starsEl.classList.toggle('gold', res.goldStars);
    const st = Game.stars(res.score, res.maxScore);
    $('#res-next').textContent = res.failed ? '' : res.goldStars ? 'GOLD STARS: perfect run!'
      : st.next ? `Next star at ${st.next.toLocaleString('en-US')}` : 'Full combo for gold stars';

    drawGraph($('#res-graph'), res.graph);

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
        renderOptions();
        applyBtn.hidden = true;
        $('#res-timing').textContent = `Timing adjusted to ${next} ms. Change it any time in Options.`;
      };
    } else {
      $('#res-timing').textContent = res.timingSamples ? `Timing: right on (${Math.abs(avg)} ms ${avg >= 0 ? 'late' : 'early'} on average).` : '';
    }

    // What to try next.
    let suggest = '';
    const base = parseId(difficulty).difficulty;
    const tierLabel = (b) => LABEL(idFor(b));
    if (res.failed) {
      suggest = PREV_TIER[base] ? `Tough one. Try ${tierLabel(PREV_TIER[base])}, or turn on No-fail in Options.` : 'Tough one. Turn on No-fail in Options to play it through.';
    } else if ((res.grade === 'S' || res.stars >= 4) && NEXT_TIER[base]) {
      suggest = `Ready for ${tierLabel(NEXT_TIER[base])}?`;
    } else if (res.grade === 'S' && difficulty === 'hard') {
      suggest = 'Try Duo: Hard speed on two keys.';
    }
    $('#res-suggest').textContent = suggest;

    let flag = '';
    let celebrate = false;
    if (res.failed) flag = 'SONG FAILED. TRY NO-FAIL MODE IN OPTIONS.';
    else if (outcome) {
      const board = save.leaderboard(current.key, difficulty, 100);
      if (outcome.personalBest && outcome.previousBest) { flag = 'NEW PERSONAL BEST!'; celebrate = true; }
      else if (outcome.rank === 1 && board.length > 1) { flag = '#1 ON THIS BOARD!'; celebrate = true; }
      else if (outcome.rank) flag = `RANK #${outcome.rank} ON THIS BOARD`;
      if (res.fullCombo) flag += (flag ? ' · ' : '') + 'FULL COMBO!';
    }
    const flagEl = $('#res-flag');
    flagEl.textContent = '';
    flagEl.className = 'flag';
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
    };
    requestAnimationFrame(step);
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
  $('#btn-res-back').addEventListener('click', showSong);
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
    challenge = shared;
    $('#ch-head').textContent = `${shared.initials} scored ${shared.score.toLocaleString('en-US')} on ${shared.title}`;
    $('#ch-detail').textContent = `${LABEL(shared.difficulty)} · grade ${shared.grade} · ${shared.accuracy.toFixed(1)}% · ${shared.maxCombo} streak${shared.fullCombo ? ' · FULL COMBO' : ''}${shared.date ? ' · ' + shared.date : ''}`;
    $('#ch-warn').hidden = shared.verified;
    $('#ch-warn').textContent = 'This link was changed after it was made, so this score will be marked unverified.';
    const pack = shared.songKey.startsWith('pack:') && SongPack.SONGS.find((s) => 'pack:' + s.id === shared.songKey);
    const bonus = shared.songKey.startsWith('bonus:');
    const playBtn = $('#btn-ch-play');
    playBtn.textContent = pack ? `PLAY ${pack.title.toUpperCase()}` : bonus ? `PLAY ${shared.title.toUpperCase().slice(0, 30)}` : 'IMPORT YOUR COPY OF THE SONG';
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

  // ---- leaderboards ------------------------------------------------------------------------------------

  let boardState = { key: null, title: '', diff: 'easy', back: 'boards' };

  function renderBoards() {
    const pack = SongPack.SONGS.map((s) => ({ key: SongPack.keyFor(s), title: s.title, pack: true }));
    const bonus = (bonusIndex || []).map((s) => ({ key: BonusPack.keyFor(s.id), title: s.title }));
    if (!bonusIndex) fetchBonusIndex().then((l) => { if (l.length && screen === 'boards') renderBoards(); });
    const played = save.playedSongs().filter((s) => s.key.startsWith('mp3:'))
      .map((s) => ({ key: s.key, title: save.songTitle(s.key) || s.title, pack: false }));
    $('#boards-list').innerHTML =
      '<p class="eyebrow">SONG PACK</p>' +
      pack.map((s, i) => `<button data-board-key="${esc(s.key)}" data-title="${esc(s.title)}" ${i === 0 ? 'data-autofocus' : ''}>${esc(s.title.toUpperCase())}</button>`).join('') +
      (bonus.length ? '<p class="eyebrow">BONUS TRACKS</p>' + bonus.map((s) => `<button data-board-key="${esc(s.key)}" data-title="${esc(s.title)}">${esc(s.title.toUpperCase().slice(0, 40))}</button>`).join('') : '') +
      (played.length ? '<p class="eyebrow">YOUR MUSIC</p>' + played.map((s) => `<button data-board-key="${esc(s.key)}" data-title="${esc(s.title)}">${esc(s.title.toUpperCase().slice(0, 40))}</button>`).join('') : '');
  }

  $('#boards-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-board-key]');
    if (b) openBoard(b.dataset.boardKey, b.dataset.title, idFor('easy'), 'boards');
  });

  function openBoard(key, title, diff, back) {
    boardState = { key, title, diff, back };
    $('#screen-board').dataset.back = back;
    renderBoard();
    show('board', { focus: `[data-board-diff="${diff}"]` });
  }

  function renderBoard() {
    const { key, title, diff } = boardState;
    $('#board-title').textContent = title;
    const fam = familyOf(diff);
    $('#board-tabs').innerHTML =
      Object.entries(FAMILIES).map(([f, label]) => `<button data-board-family="${f}" class="${f === fam ? 'on' : ''}">${label}</button>`).join('') +
      '<span class="tab-break"></span>' +
      idsFor(fam).map((d) => `<button data-board-diff="${d}" class="${d === diff ? 'on' : ''}">${BASE_LABEL(parseId(d).difficulty)}</button>`).join('');
    const rows = save.leaderboard(key, diff, 25);
    const me = save.active;
    $('#board-table').innerHTML = '<tr><th>#</th><th>PLAYER</th><th class="num">SCORE</th><th>GRADE</th><th class="num">ACC</th><th class="num">STREAK</th><th>DATE</th></tr>' +
      (rows.length ? rows.map((r, i) => `<tr class="${i === 0 ? 'top ' : ''}${!r.rival && me && r.profileId === me.id ? 'me' : ''}">
        <td>${i + 1}</td>
        <td>${esc(r.initials)}${r.rival ? ` <span class="tag">${r.verified === false ? 'UNVERIFIED' : 'RIVAL'}</span>` : ''}</td>
        <td class="num">${r.score.toLocaleString('en-US')}</td>
        <td>${esc(r.grade)}${r.fullCombo ? ' FC' : ''}</td>
        <td class="num">${Number(r.accuracy).toFixed(1)}%</td>
        <td class="num">${r.maxCombo}</td>
        <td>${esc(fmtDate(r.date))}</td></tr>`).join('')
        : `<tr><td colspan="7" class="hint">No ${LABEL(diff)} scores yet. Be the first.</td></tr>`);
  }

  $('#board-tabs').addEventListener('click', (e) => {
    const f = e.target.closest('[data-board-family]');
    if (f) {
      // Same tier, other input: 'hard' ↔ 'touch4:hard' ↔ 'touch2:hard'.
      const base = parseId(boardState.diff).difficulty;
      const ids = idsFor(f.dataset.boardFamily);
      boardState.diff = ids.find((id) => parseId(id).difficulty === base) || ids[0];
      renderBoard();
      requestAnimationFrame(() => { const el = $(`[data-board-family="${f.dataset.boardFamily}"]`); if (el) el.focus(); });
      return;
    }
    const b = e.target.closest('[data-board-diff]');
    if (!b) return;
    boardState.diff = b.dataset.boardDiff;
    renderBoard();
    requestAnimationFrame(() => { const el = $(`[data-board-diff="${boardState.diff}"]`); if (el) el.focus(); });
  });

  $('#btn-board-play').addEventListener('click', () => {
    const { key, title, diff } = boardState;
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
    $('#players-list').innerHTML = save.profiles.map((p) =>
      `<button data-player="${esc(p.id)}" ${active && p.id === active.id ? 'data-autofocus' : ''}><span style="color:${esc(p.color)}">${esc(p.initials)}</span>${active && p.id === active.id ? ' <small>Playing now</small>' : ' <small>Switch to this player</small>'}</button>`
    ).join('') || '<p class="hint">No players yet.</p>';
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

  function renderOptions() {
    $('#opt-speed').value = settings.speed;
    $('#opt-speed-out').textContent = settings.speed.toFixed(1) + 'x';
    const cal = settings[calKey()];
    $('#opt-calib').value = cal;
    $('#opt-calib-out').textContent = (cal > 0 ? '+' : '') + cal + ' ms';
    $('#opt-calib-label').textContent = Input.touch ? 'AUDIO OFFSET (TOUCH)' : 'AUDIO OFFSET';
    $('#opt-vibrate').hidden = !navigator.vibrate;
    $('#opt-vibrate span').textContent = settings.vibrate ? 'ON' : 'OFF';
    $('#opt-music').value = settings.music;
    $('#opt-music-out').textContent = Math.round(settings.music * 100) + '%';
    $('#opt-sfx').value = settings.sfx;
    $('#opt-sfx-out').textContent = Math.round(settings.sfx * 100) + '%';
    $('#opt-crt span').textContent = settings.crt ? 'ON' : 'OFF';
    $('#opt-shake span').textContent = settings.shake ? 'ON' : 'OFF';
    $('#opt-nofail span').textContent = settings.noFail ? 'ON' : 'OFF';
    $('#opt-hits span').textContent = settings.hitSounds ? 'ON' : 'OFF';
    $('#opt-overhit span').textContent = settings.overhit ? 'ON' : 'OFF';
    $('#opt-tiles-line').value = settings.tilesLineUp;
    $('#opt-tiles-line-out').textContent = (settings.tilesLineUp <= 22 ? 'LOW' : settings.tilesLineUp >= 38 ? 'HIGH' : 'MIDDLE') + ` (${settings.tilesLineUp}%)`;
    for (const n of [4, 2]) {
      const up = settings['strikeUp' + n];
      const [lo, hi] = n === 4 ? [22, 34] : [16, 26];
      $(`#opt-strike${n}`).value = up;
      $(`#opt-strike${n}-out`).textContent = (up <= lo ? 'LOW' : up >= hi ? 'HIGH' : 'MIDDLE') + ` (${up}%)`;
    }
    document.body.classList.toggle('crt', settings.crt);
    updateDeviceUI();
  }

  const bindRange = (id, key, parse) => $(id).addEventListener('input', (e) => {
    save.setSetting(key, parse(e.target.value));
    if (key === 'music' || key === 'sfx') Sfx.setVolumes(settings.music, settings.sfx);
    renderOptions();
  });
  bindRange('#opt-speed', 'speed', parseFloat);
  $('#opt-calib').addEventListener('input', (e) => { save.setSetting(calKey(), parseInt(e.target.value, 10)); renderOptions(); });
  bindRange('#opt-music', 'music', parseFloat);
  bindRange('#opt-sfx', 'sfx', parseFloat);
  for (const n of [4, 2]) {
    $(`#opt-strike${n}`).addEventListener('input', (e) => {
      save.setSetting('strikeUp' + n, parseInt(e.target.value, 10));
      applyStrike();
      renderOptions();
    });
  }
  $('#btn-strike').addEventListener('click', () => openStrikeSetup('options'));
  $('#opt-tiles-line').addEventListener('input', (e) => { save.setSetting('tilesLineUp', parseInt(e.target.value, 10)); renderOptions(); });
  for (const [id, key] of [['#opt-crt', 'crt'], ['#opt-shake', 'shake'], ['#opt-nofail', 'noFail'], ['#opt-hits', 'hitSounds'], ['#opt-overhit', 'overhit'], ['#opt-vibrate', 'vibrate']]) {
    $(id).addEventListener('click', () => { save.setSetting(key, !settings[key]); renderOptions(); });
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
    if (game) return;
    stage.setLayout(layoutMode(), window.innerWidth / window.innerHeight);
    checkOrientation();
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (game) {
        // Turned the wrong way mid-song: pause and ask to turn it back.
        if (!checkOrientation()) stage.setLayout(gameLayout, window.innerWidth / window.innerHeight);
        return;
      }
      checkOrientation();
      const before = stage.layout;
      applyLayout();
      if (stage.layout !== before && screen === 'song' && current) showSong();
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
    applyStrike();
  });
  $('#btn-strike-done').addEventListener('click', () => {
    if (strikeReturn === 'options') { renderOptions(); show('options'); return; }
    const id = pendingPlay;
    pendingPlay = null;
    if (id) play(id); else showSong();
  });

  // First touch game: calibrate now or play.
  let calibReturn = 'options';
  $('#btn-offer-calib').addEventListener('click', () => { calibReturn = 'song'; calibrate.run(); });
  $('#btn-offer-play').addEventListener('click', () => { const id = pendingPlay; pendingPlay = null; if (id) play(id); });
  $('#btn-calib-done').addEventListener('click', leaveCalib);
  function leaveCalib() {
    calibrate.cancel();
    const to = calibReturn;
    calibReturn = 'options';
    if (to === 'song' && current) showSong(); else { renderOptions(); show('options'); }
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
    Library,
  };
})();
