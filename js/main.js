/*
 * main — UI flow: import → analyse → pick difficulty → play → results.
 */
'use strict';
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const STORE = 'beatfrets.';

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(STORE + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(STORE + key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
    removeMatching(prefix) {
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith(STORE + prefix))
          .forEach((k) => localStorage.removeItem(k));
      } catch (e) { /* storage unavailable */ }
    },
  };

  const settings = {
    speed: store.get('speed', 1),
    calibrationMs: store.get('calibrationMs', 0),
  };

  let audioCtx = null;
  let song = null; // { id, name, buffer, analysis, charts }
  let game = null;
  let lastDifficulty = 'easy';

  function ctx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    return audioCtx;
  }

  // ---- screens -----------------------------------------------------------------

  function show(name) {
    $('#panel').classList.toggle('hidden', !name);
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 5000);
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // ---- loading songs --------------------------------------------------------------

  /** FNV-1a over the file bytes — a cheap, stable cache key. */
  function hashBytes(buf) {
    const bytes = new Uint8Array(buf);
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16) + '-' + bytes.length.toString(16);
  }

  function setProgress(fraction, detail) {
    $('#loading-bar').style.width = Math.round(fraction * 100) + '%';
    if (detail) $('#loading-detail').textContent = detail;
  }

  async function analyseBuffer(id, buffer) {
    const cacheKey = `analysis.${BeatAnalyzer.VERSION}.${id}`;
    const cached = store.get(cacheKey, null);
    if (cached) return cached;
    setProgress(0.05, 'Finding the beat…');
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    const analysis = await BeatAnalyzer.analyze(channels, buffer.sampleRate, (p) =>
      setProgress(0.05 + p * 0.9, p < 0.8 ? 'Detecting hits in each frequency band…' : 'Tracking the beat…')
    );
    if (!store.set(cacheKey, analysis)) {
      // Storage full — drop old analyses and try once more.
      store.removeMatching('analysis.');
      store.set(cacheKey, analysis);
    }
    return analysis;
  }

  async function loadSong(id, name, getBuffer) {
    show('loading');
    $('#loading-title').textContent = 'Listening to ' + name + '…';
    setProgress(0.02, 'Decoding audio…');
    try {
      const buffer = await getBuffer();
      const analysis = await analyseBuffer(id, buffer);
      setProgress(1, 'Building note charts…');
      const charts = {
        easy: ChartGen.generate(analysis, 'easy'),
        hard: ChartGen.generate(analysis, 'hard'),
      };
      if (!charts.easy.notes.length) throw new Error('No beat could be found in this audio.');
      song = { id, name, buffer, analysis, charts };
      showSong();
    } catch (err) {
      console.error(err);
      show('menu');
      toast("Couldn't use that file: " + (err && err.message ? err.message : err));
    }
  }

  async function importFile(file) {
    if (!file) return;
    const name = file.name.replace(/\.[^.]+$/, '');
    show('loading');
    $('#loading-title').textContent = 'Listening to ' + name + '…';
    setProgress(0.02, 'Reading file…');
    let bytes;
    try {
      bytes = await file.arrayBuffer();
    } catch (err) {
      show('menu');
      toast("Couldn't read that file.");
      return;
    }
    const id = hashBytes(bytes);
    await loadSong(id, name, () => ctx().decodeAudioData(bytes));
  }

  async function loadDemo() {
    await loadSong(BeatDemo.id, BeatDemo.name, () => BeatDemo.render());
  }

  // ---- song screen ------------------------------------------------------------------

  function bestKey(difficulty) {
    return `best.${song.id}.${difficulty}`;
  }

  function showSong() {
    $('#song-name').textContent = song.name;
    $('#song-meta').textContent = `${fmtTime(song.analysis.duration)}  ·  ~${Math.round(song.analysis.bpm)} BPM`;
    for (const d of ['easy', 'hard']) {
      const n = song.charts[d].notes.length;
      const nps = n / Math.max(1, song.analysis.duration);
      $(`[data-stats="${d}"]`).textContent = `${n} notes · ${nps.toFixed(1)}/sec`;
      const best = store.get(bestKey(d), null);
      $(`[data-best="${d}"]`).textContent = best ? `Best: ${best.score.toLocaleString()} (${best.grade})` : '';
    }
    show('song');
  }

  // ---- playing ------------------------------------------------------------------------

  async function play(difficulty) {
    lastDifficulty = difficulty;
    if (game) game.stop();
    show(null);
    $('#pause').hidden = true;
    const baseLookahead = difficulty === 'easy' ? 2.0 : 1.5;
    game = new BeatGame($('#stage'), {
      audioCtx: ctx(),
      buffer: song.buffer,
      chart: song.charts[difficulty],
      beats: song.analysis.beats,
      lookahead: baseLookahead / settings.speed,
      calibration: settings.calibrationMs / 1000,
      onEnd: (res) => showResults(difficulty, res),
      onPauseChange: (paused) => { $('#pause').hidden = !paused; },
    });
    await game.start();
  }

  function clearStage() {
    const c = $('#stage');
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }

  function quitToSong() {
    if (game) game.stop();
    game = null;
    $('#pause').hidden = true;
    clearStage();
    showSong();
  }

  function showResults(difficulty, res) {
    game = null;
    clearStage();
    $('#res-title').textContent = `${song.name} — ${ChartGen.DIFFICULTIES[difficulty].label}`;
    $('#res-grade').textContent = res.grade;
    $('#res-score').textContent = res.score.toLocaleString();
    $('#res-acc').textContent = res.accuracy.toFixed(1) + '%';
    $('#res-perfect').textContent = res.counts.perfect;
    $('#res-good').textContent = res.counts.good;
    $('#res-ok').textContent = res.counts.ok;
    $('#res-miss').textContent = res.counts.miss;
    $('#res-combo').textContent = `${res.maxCombo} / ${res.total}`;
    const prev = store.get(bestKey(difficulty), null);
    const isBest = !prev || res.score > prev.score;
    if (isBest) store.set(bestKey(difficulty), { score: res.score, grade: res.grade });
    $('#res-best').textContent = isBest && prev ? 'New best score!' : '';
    show('results');
  }

  // ---- calibration ------------------------------------------------------------------

  function updateSettingsUI() {
    $('#speed').value = settings.speed;
    $('#speed-out').textContent = settings.speed.toFixed(1) + '×';
    $('#calib').value = settings.calibrationMs;
    $('#calib-out').textContent = (settings.calibrationMs > 0 ? '+' : '') + settings.calibrationMs + ' ms';
  }

  async function calibrate() {
    const c = ctx();
    await c.resume();
    show('calib');
    const INTERVAL = 0.5;
    const COUNT = 16;
    const SKIP = 4; // first few taps are warm-up
    const dots = $('#calib-dots');
    dots.innerHTML = '';
    for (let i = 0; i < COUNT; i++) dots.appendChild(document.createElement('span'));
    $('#calib-status').textContent = 'Get ready…';

    const start = c.currentTime + 1.0;
    for (let i = 0; i < COUNT; i++) {
      const t = start + i * INTERVAL;
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = i % 4 === 0 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + 0.08);
    }

    const offsets = [];
    const latency = () => c.outputLatency || c.baseLatency || 0;
    const onKey = (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      e.preventDefault();
      const t = c.currentTime - latency() - start;
      const idx = Math.round(t / INTERVAL);
      if (idx < 0 || idx >= COUNT) return;
      dots.children[idx].classList.add('hit');
      if (idx >= SKIP) offsets.push(t - idx * INTERVAL);
    };
    window.addEventListener('keydown', onKey);

    let done = false;
    const animate = () => {
      if (done) return;
      const t = c.currentTime - latency() - start;
      const idx = Math.floor(t / INTERVAL);
      Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i === idx));
      if (t >= 0) $('#calib-status').textContent = 'Tap Space on every click';
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);

    calibrate.cancel = () => {
      done = true;
      window.removeEventListener('keydown', onKey);
    };

    setTimeout(() => {
      if (done) return;
      calibrate.cancel();
      if (offsets.length < 5) {
        $('#calib-status').textContent = 'Not enough taps — try again.';
        return;
      }
      offsets.sort((a, b) => a - b);
      const median = offsets[offsets.length >> 1];
      settings.calibrationMs = Math.max(-200, Math.min(200, Math.round(median * 1000)));
      store.set('calibrationMs', settings.calibrationMs);
      updateSettingsUI();
      $('#calib-status').textContent = `Done! Offset set to ${settings.calibrationMs} ms.`;
    }, (1.0 + COUNT * INTERVAL + 0.6) * 1000);
  }

  // ---- wiring ---------------------------------------------------------------------------

  $('#file').addEventListener('change', (e) => {
    importFile(e.target.files[0]);
    e.target.value = '';
  });
  $('#btn-demo').addEventListener('click', loadDemo);
  $('#btn-new-song').addEventListener('click', () => show('menu'));
  $$('.diff').forEach((b) => b.addEventListener('click', () => play(b.dataset.diff)));
  $('#btn-retry').addEventListener('click', () => play(lastDifficulty));
  $('#btn-back').addEventListener('click', showSong);
  $('#btn-resume').addEventListener('click', () => game && game.resume());
  $('#btn-restart').addEventListener('click', () => play(lastDifficulty));
  $('#btn-quit').addEventListener('click', quitToSong);
  $('#btn-calibrate').addEventListener('click', calibrate);
  $('#btn-calib-done').addEventListener('click', () => {
    if (calibrate.cancel) calibrate.cancel();
    show('menu');
  });

  $('#speed').addEventListener('input', (e) => {
    settings.speed = parseFloat(e.target.value);
    store.set('speed', settings.speed);
    updateSettingsUI();
  });
  $('#calib').addEventListener('input', (e) => {
    settings.calibrationMs = parseInt(e.target.value, 10);
    store.set('calibrationMs', settings.calibrationMs);
    updateSettingsUI();
  });

  // Drag & drop anywhere.
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
    if (file) importFile(file);
  });

  updateSettingsUI();
  show('menu');

  // Read-only handle for debugging and automated tests.
  window.BeatFrets = {
    get song() { return song; },
    get game() { return game; },
    play,
    importFile,
    loadDemo,
  };
})();
