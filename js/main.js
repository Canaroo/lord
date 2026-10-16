/*
 * main — screens and flow: title → main menu → song → play → results → share,
 * plus leaderboards, players, options, save data and incoming challenges.
 * Every menu works with mouse, keyboard or gamepad.
 */
'use strict';
(function () {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const fmtDate = (iso) => (iso ? iso.slice(0, 10) : '');
  const DIFFS = ['easy', 'medium', 'hard'];

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

  function show(name, { focus } = {}) {
    screen = name;
    $('#panel').classList.toggle('hidden', !name);
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    $('#hints').hidden = !name;
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
      if (a === 'pause') game.pause();
      if (a === 'overdrive') game.activateOverdrive();
      return;
    }
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
    const parts = DIFFS.map((d) => {
      const b = save.personalBest(p.id, key, d);
      return b ? `${d[0].toUpperCase()} ${b.score.toLocaleString('en-US')} ${b.grade}` : null;
    }).filter(Boolean);
    return parts.length ? 'BEST ' + parts.join(' · ') : 'Not played yet';
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
        if (chart && chart.charts) {
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
          for (const d of DIFFS) charts[d] = ChartGen.generate(analysis, d);
          entry = { buffer, analysis, charts, prebuilt: false, shift: 0 };
        }
        bonusCache.set(id, entry);
      }
      setProgress(1, 'Ready');
      current = {
        key: BonusPack.keyFor(id), title: def.title, artist: def.artist || '', credit: def.credit || '', kind: 'bonus', bonusId: id,
        buffer: entry.buffer, analysis: entry.analysis, charts: entry.charts, fp: null, shift: entry.shift,
        matchNote: entry.prebuilt ? null : "This song's chart hasn't been pre-built yet, so this device made one. Other players' notes may differ slightly.",
      };
      showSong();
    } catch (err) {
      console.error(err);
      renderPack();
      show('pack');
      toast(`"${def.title}" could not be loaded: ${err.message || err}`);
    }
  }

  function renderImport(note) {
    const recent = save.data.library.slice(-4).reverse();
    $('#recent-list').innerHTML = (note ? `<p class="match">${esc(note)}</p>` : '') + (recent.length
      ? `<p class="eyebrow">YOUR IMPORTED SONGS</p>` + recent.map((s) =>
        `<p class="hint">${esc(s.title)} — ${esc(bestLine(s.key))}</p>`).join('') + `<p class="hint">Import a song again to play it. Its scores are kept.</p>`
      : '');
  }

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
    for (const d of DIFFS) charts[d] = ChartGen.generate(analysis, d);
    setProgress(0.45, 'Tuning the sound chip…');
    try {
      let buffer = bufferCache.get(id);
      if (!buffer) {
        buffer = await SongPack.render(built);
        bufferCache.set(id, buffer);
      }
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
      const id = hashBytes(bytes);
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
      for (const d of DIFFS) charts[d] = ChartGen.generate(analysis, d);
      if (!charts.easy.notes.length) throw new Error('No beat could be found in this audio.');
      const fp = SaveData.fingerprint(analysis);
      const reg = save.registerSong(name, fp);
      current = {
        key: reg.key, title: name, kind: 'mp3', buffer, analysis, charts, fp,
        matchNote: reg.matched && reg.title !== name
          ? `Matched to "${reg.title}" by sound (${Math.round(reg.similarity * 100)}% alike), so you share its leaderboard.`
          : null,
      };
      showSong();
    } catch (err) {
      console.error(err);
      renderImport();
      show('import');
      toast("That file couldn't be used: " + (err && err.message ? err.message : err));
    }
  }

  // ---- song screen ------------------------------------------------------------------------------

  function miniBoard(key, diff) {
    const rows = save.leaderboard(key, diff, 5);
    const me = save.active;
    if (!rows.length) return '<li class="empty">No scores yet</li>';
    return rows.map((r, i) =>
      `<li class="${!r.rival && me && r.profileId === me.id ? 'me' : ''}"><span>#${i + 1}</span><span>${esc(r.initials)}</span><span class="sc">${r.score.toLocaleString('en-US')}</span><span>${esc(r.grade)}${r.rival ? ' <span class="tag">RIVAL</span>' : ''}</span></li>`
    ).join('');
  }

  function showSong() {
    $('#song-name').textContent = current.title;
    const kind = { pack: 'Chiptune pack: identical charts for everyone', bonus: 'Bonus track: identical charts for everyone', mp3: 'Imported song' }[current.kind];
    $('#song-meta').textContent = `${fmtTime(current.analysis.duration)} · ~${Math.round(current.analysis.bpm)} BPM · ${kind}`;
    const credit = [current.artist, current.credit].filter(Boolean).join(' · ');
    $('#song-credit').hidden = !credit;
    $('#song-credit').textContent = credit;
    $('#song-match').hidden = !current.matchNote;
    $('#song-match').textContent = current.matchNote || '';
    for (const d of DIFFS) {
      const n = current.charts[d].notes.length;
      $(`[data-stats="${d}"]`).textContent = `${n} notes · ${(n / Math.max(1, current.analysis.duration)).toFixed(1)}/sec`;
      $(`[data-board="${d}"]`).innerHTML = miniBoard(current.key, d);
    }
    updateDeviceUI();
    show('song', { focus: `[data-diff="${lastDifficulty}"]` });
  }

  $$('.diff').forEach((b) => b.addEventListener('click', () => play(b.dataset.diff)));
  $('#btn-song-back').addEventListener('click', () => { if (songOrigin === 'import') renderImport(); show(songOrigin); });

  // ---- playing --------------------------------------------------------------------------------------

  async function play(difficulty) {
    if (!current) return;
    lastDifficulty = difficulty;
    if (game) game.stop();
    ensureAudio();
    await document.fonts.load('8px "Press Start 2P"').catch(() => {});
    show(null);
    $('#pause').hidden = true;
    const chart = current.charts[difficulty];
    Input.setGameplay(true, chart.lanes);
    game = new Game({
      audioCtx,
      buffer: current.buffer,
      chart,
      beats: current.analysis.beats,
      stage,
      lookahead: ({ easy: 2.0, medium: 1.75, hard: 1.5 }[difficulty] || 1.5) / settings.speed,
      calibration: settings.calibrationMs / 1000,
      noFail: settings.noFail,
      intro: { title: current.title.toUpperCase().slice(0, 40), sub: ChartGen.DIFFICULTIES[difficulty].label.toUpperCase() },
      onEnd: (res) => {
        game = null;
        Input.setGameplay(false);
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

  $('#btn-resume').addEventListener('click', () => game && game.resume());
  $('#btn-restart').addEventListener('click', () => { $('#pause').hidden = true; play(lastDifficulty); });
  $('#btn-quit').addEventListener('click', () => {
    if (game) game.stop();
    game = null;
    Input.setGameplay(false);
    $('#pause').hidden = true;
    showSong();
  });

  // ---- results -------------------------------------------------------------------------------------

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
      fp: current.kind === 'mp3' ? current.fp : undefined,
    };
    const outcome = p ? save.addRun(run) : null;
    lastRun = outcome ? outcome.entry : { ...run, date: new Date().toISOString() };

    $('#res-title').textContent = `${current.title.toUpperCase().slice(0, 40)} · ${difficulty.toUpperCase()}`;
    const gradeEl = $('#res-grade');
    gradeEl.textContent = '';
    gradeEl.className = 'grade';
    $('#res-acc').textContent = res.accuracy.toFixed(1) + '%';
    $('#res-perfect').textContent = res.counts.perfect;
    $('#res-good').textContent = res.counts.good;
    $('#res-ok').textContent = res.counts.ok;
    $('#res-miss').textContent = res.counts.miss;
    $('#res-combo').textContent = `${res.maxCombo} / ${res.total}`;
    $('#btn-share').disabled = res.failed;

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

    // Count the score up, then stamp the grade.
    const scoreEl = $('#res-score');
    const t0 = performance.now();
    const dur = Math.min(1400, 400 + res.score / 50);
    let lastTick = 0;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      scoreEl.textContent = Math.round(res.score * k).toLocaleString('en-US');
      if (now - lastTick > 60 && k < 1) { Sfx.tick(); lastTick = now; }
      if (k < 1) { requestAnimationFrame(step); return; }
      gradeEl.textContent = res.grade;
      gradeEl.className = `grade stamp ${res.grade}`;
      Sfx.stamp();
      setTimeout(() => {
        flagEl.textContent = flag;
        if (celebrate) { flagEl.classList.add('new'); Sfx.record(); }
        if (res.grade === 'S') Sfx.fanfare();
      }, 300);
    };
    requestAnimationFrame(step);
  }

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
    $('#ch-detail').textContent = `${shared.difficulty.toUpperCase()} · grade ${shared.grade} · ${shared.accuracy.toFixed(1)}% · ${shared.maxCombo} streak${shared.fullCombo ? ' · FULL COMBO' : ''}${shared.date ? ' · ' + shared.date : ''}`;
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
    if (b) openBoard(b.dataset.boardKey, b.dataset.title, 'easy', 'boards');
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
    $$('[data-board-diff]').forEach((b) => b.classList.toggle('on', b.dataset.boardDiff === diff));
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
        : `<tr><td colspan="7" class="hint">No ${diff} scores yet. Be the first.</td></tr>`);
  }

  $$('[data-board-diff]').forEach((b) => b.addEventListener('click', () => { boardState.diff = b.dataset.boardDiff; renderBoard(); }));

  $('#btn-board-play').addEventListener('click', () => {
    const { key, title, diff } = boardState;
    lastDifficulty = diff;
    if (key.startsWith('pack:')) { songOrigin = 'boards'; loadPack(key.slice(5)); }
    else if (key.startsWith('bonus:')) { songOrigin = 'boards'; loadBonus(key.slice(6)); }
    else if (current && current.key === key) { songOrigin = 'boards'; showSong(); }
    else { songOrigin = 'import'; renderImport(`Import your copy of "${title}" to play it.`); show('import'); }
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
      $('#player-stats').innerHTML = `<div><b>PLAYS</b>${s.plays}</div><div><b>NOTES HIT</b>${s.notesHit.toLocaleString('en-US')}</div><div><b>FULL COMBOS</b>${s.fullCombos}</div><div><b>BEST STREAK</b>${s.bestCombo}</div>`;
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
    $('#opt-calib').value = settings.calibrationMs;
    $('#opt-calib-out').textContent = (settings.calibrationMs > 0 ? '+' : '') + settings.calibrationMs + ' ms';
    $('#opt-music').value = settings.music;
    $('#opt-music-out').textContent = Math.round(settings.music * 100) + '%';
    $('#opt-sfx').value = settings.sfx;
    $('#opt-sfx-out').textContent = Math.round(settings.sfx * 100) + '%';
    $('#opt-crt span').textContent = settings.crt ? 'ON' : 'OFF';
    $('#opt-shake span').textContent = settings.shake ? 'ON' : 'OFF';
    $('#opt-nofail span').textContent = settings.noFail ? 'ON' : 'OFF';
    document.body.classList.toggle('crt', settings.crt);
    updateDeviceUI();
  }

  const bindRange = (id, key, parse) => $(id).addEventListener('input', (e) => {
    save.setSetting(key, parse(e.target.value));
    if (key === 'music' || key === 'sfx') Sfx.setVolumes(settings.music, settings.sfx);
    renderOptions();
  });
  bindRange('#opt-speed', 'speed', parseFloat);
  bindRange('#opt-calib', 'calibrationMs', (v) => parseInt(v, 10));
  bindRange('#opt-music', 'music', parseFloat);
  bindRange('#opt-sfx', 'sfx', parseFloat);
  for (const [id, key] of [['#opt-crt', 'crt'], ['#opt-shake', 'shake'], ['#opt-nofail', 'noFail']]) {
    $(id).addEventListener('click', () => { save.setSetting(key, !settings[key]); renderOptions(); });
  }
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
        save.setSetting('calibrationMs', Math.max(-200, Math.min(200, Math.round(median * 1000))));
        renderOptions();
        $('#calib-status').textContent = `Done. Offset set to ${settings.calibrationMs} ms.`;
      }, (1.0 + COUNT * INTERVAL + 0.6) * 1000);
    }

    window.addEventListener('keydown', (e) => {
      if (screen === 'calib' && e.code === 'Space' && !e.repeat) { e.preventDefault(); tap(e.timeStamp); }
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

  // ---- boot ------------------------------------------------------------------------------------------------------

  function attractLoop() {
    if (!game) stage.attract(performance.now() / 1000);
    requestAnimationFrame(attractLoop);
  }

  renderTitle();
  renderOptions();
  updateDeviceUI();
  document.fonts.load('8px "Press Start 2P"').catch(() => {}).then(() => {});
  requestAnimationFrame(attractLoop);
  if (!checkHash()) show('title');

  // Read-only handle for debugging and automated tests.
  window.BeatFrets = {
    save,
    get game() { return game; },
    get current() { return current; },
    get screen() { return screen; },
    play,
    loadPack,
    loadBonus,
    importFile,
  };
})();
