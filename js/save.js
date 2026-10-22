/*
 * SaveData — everything kept on the player's device: profiles (arcade
 * initials), settings, every finished run, a song library for matching imported
 * MP3s, and rival scores added from friends' share links.
 *
 * Also handles share links (score data packed into the URL) and song
 * fingerprints. Pure logic plus a storage object, so it runs under Node tests.
 */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaveData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KEY = 'beatfrets.save.v2';
  const DIFFICULTY_IDS = ['easy', 'medium', 'mediumplus', 'hard', 'duo'];
  // Touch runs are their own boards: 'touch4:hard' (sideways) and 'touch2:hard' (upright).
  const validDifficulty = (d) => DIFFICULTY_IDS.includes(d) || /^touch[24]:(easy|medium|mediumplus|hard)$/.test(d) || /^tiles:(easy|medium|hard)$/.test(d);
  const VERSION = 2;
  const MAX_RUNS = 2000;
  const PROFILE_COLORS = ['#58f8f8', '#f858c8', '#f8d830', '#38d838', '#f88820', '#a878f8', '#f84848', '#78a8f8'];
  const DEFAULT_SETTINGS = {
    speed: 1,
    calibrationMs: 0,
    music: 0.9,
    sfx: 0.7,
    crt: true,
    shake: true,
    noFail: false,
    hitSounds: false,
    overhit: true,
    calibrationTouchMs: 0, // touch screens have their own delay
    vibrate: false,
    touchCalibOffered: false,
    // Phones: strike line height, in % of the screen above the bottom edge.
    strikeUp4: 28, // sideways (4 lanes)
    strikeUp2: 20, // upright (2 lanes)
    strikeOffered: false,
    playMode: 'frets', // 'frets' (the highway) or 'tiles'
  };

  function emptySave() {
    return { version: VERSION, profiles: [], activeProfile: null, settings: { ...DEFAULT_SETTINGS }, runs: [], rivals: [], library: [], paces: {} };
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const paceKey = (profileId, songKey, difficulty) => `${profileId}|${songKey}|${difficulty}`;

  function cleanInitials(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3).padEnd(3, '-');
  }

  // ---- song fingerprints -----------------------------------------------------------
  //
  // Two copies of the same song (different rips, bitrates, sites) are different
  // files, so a file hash can't match them. Instead we compare what they sound
  // like: length, tempo, and the shape of their loudness over time.

  const SIG_BUCKET = 2; // seconds
  const SIG_LEN = 45; // buckets → first 90 seconds

  function fingerprint(analysis) {
    const buckets = new Array(SIG_LEN).fill(0);
    for (const o of analysis.onsets) {
      const i = Math.floor(o.t / SIG_BUCKET);
      if (i < SIG_LEN) buckets[i] += o.s;
    }
    const used = Math.min(SIG_LEN, Math.ceil(analysis.duration / SIG_BUCKET));
    const max = Math.max(...buckets) || 1;
    const sig = buckets.slice(0, used).map((v) => Math.round((9 * v) / max)).join('');
    return { du: Math.round(analysis.duration * 10) / 10, bpm: Math.round(analysis.bpm * 10) / 10, sig };
  }

  function correlation(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 4) return 0;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }

  /** 0–1 similarity between two fingerprints. */
  function similarity(f1, f2) {
    if (!f1 || !f2) return 0;
    if (Math.abs(f1.du - f2.du) > 3) return 0;
    const ratio = f1.bpm / f2.bpm;
    const tempoOk = [1, 2, 0.5].some((r) => Math.abs(ratio / r - 1) < 0.04);
    if (!tempoOk) return 0;
    const a = [...f1.sig].map(Number);
    const b = [...f2.sig].map(Number);
    // Shape: correlation of the loudness curves, allowing a one-bucket offset
    // for different encoder padding.
    let best = correlation(a, b);
    best = Math.max(best, correlation(a.slice(1), b), correlation(a, b.slice(1)));
    // Level: very even songs (loops, steady electronic tracks) have nearly flat
    // curves where correlation means little, so also compare levels directly.
    const n = Math.min(a.length, b.length);
    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(a[i] - b[i]);
    best = Math.max(best, 1 - diff / Math.max(1, n) / 2);
    return Math.max(0, best);
  }

  const MATCH_THRESHOLD = 0.8;

  // ---- share links ----------------------------------------------------------------------

  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  // The checksum only catches casual URL editing; scores in any browser game can be faked.
  const SALT = 'beat-frets-16bit';
  const SHARE_FIELDS = ['v', 'n', 'k', 't', 'd', 'sc', 'g', 'a', 'c', 'fc', 'dt', 'fp'];

  function encodeShare(run) {
    const data = {
      v: 1,
      n: run.initials,
      k: run.songKey,
      t: run.title,
      d: run.difficulty,
      sc: run.score,
      g: run.grade,
      a: run.accuracy,
      c: run.maxCombo,
      fc: run.fullCombo ? 1 : 0,
      dt: run.date.slice(0, 10),
    };
    if (run.fp) data.fp = run.fp;
    const body = JSON.stringify(SHARE_FIELDS.filter((f) => f in data).map((f) => data[f]));
    return b64urlEncode(body) + '.' + hash(SALT + body);
  }

  function decodeShare(token) {
    try {
      const [payload, check] = String(token).split('.');
      const body = b64urlDecode(payload);
      const arr = JSON.parse(body);
      if (!Array.isArray(arr) || arr[0] !== 1) return null;
      const keys = SHARE_FIELDS.slice(0, arr.length);
      const d = Object.fromEntries(keys.map((k, i) => [k, arr[i]]));
      if (typeof d.sc !== 'number' || !d.k || !validDifficulty(d.d)) return null;
      return {
        verified: hash(SALT + body) === check,
        initials: cleanInitials(d.n),
        songKey: String(d.k).slice(0, 80),
        title: String(d.t || 'Unknown song').slice(0, 80),
        difficulty: d.d,
        score: Math.max(0, Math.floor(d.sc)),
        grade: String(d.g || '?').slice(0, 2),
        accuracy: Math.max(0, Math.min(100, Number(d.a) || 0)),
        maxCombo: Math.max(0, Math.floor(d.c || 0)),
        fullCombo: !!d.fc,
        date: /^\d{4}-\d{2}-\d{2}$/.test(d.dt) ? d.dt : '',
        fp: d.fp && typeof d.fp.sig === 'string' ? { du: +d.fp.du, bpm: +d.fp.bpm, sig: d.fp.sig.replace(/\D/g, '').slice(0, SIG_LEN) } : null,
      };
    } catch (e) {
      return null;
    }
  }

  // ---- the store ----------------------------------------------------------------------------

  class Store {
    /** @param {Storage|null} storage  localStorage, or null for an in-memory save */
    constructor(storage) {
      this.storage = storage;
      this.data = this._load();
    }

    _load() {
      let data = null;
      try {
        const raw = this.storage && this.storage.getItem(KEY);
        if (raw) data = JSON.parse(raw);
      } catch (e) { data = null; }
      if (!data || data.version !== VERSION) {
        data = emptySave();
        // Carry over settings from the first version of the game.
        try {
          const s = this.storage && this.storage.getItem('beatfrets.speed');
          const c = this.storage && this.storage.getItem('beatfrets.calibrationMs');
          if (s) data.settings.speed = JSON.parse(s);
          if (c) data.settings.calibrationMs = JSON.parse(c);
        } catch (e) { /* ignore */ }
      }
      data.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      data.paces = data.paces || {};
      return data;
    }

    save() {
      if (!this.storage) return true;
      try {
        this.storage.setItem(KEY, JSON.stringify(this.data));
        return true;
      } catch (e) {
        // Storage full: drop cached song analyses (they can be recomputed) and retry.
        try {
          Object.keys(this.storage).filter((k) => k.startsWith('beatfrets.analysis.')).forEach((k) => this.storage.removeItem(k));
          this.storage.setItem(KEY, JSON.stringify(this.data));
          return true;
        } catch (e2) { return false; }
      }
    }

    // profiles
    get profiles() { return this.data.profiles; }
    get active() { return this.data.profiles.find((p) => p.id === this.data.activeProfile) || null; }

    createProfile(initials) {
      const p = {
        id: uid(),
        initials: cleanInitials(initials),
        color: PROFILE_COLORS[this.data.profiles.length % PROFILE_COLORS.length],
        created: new Date().toISOString(),
      };
      this.data.profiles.push(p);
      this.data.activeProfile = p.id;
      this.save();
      return p;
    }

    setActive(id) {
      if (this.data.profiles.some((p) => p.id === id)) { this.data.activeProfile = id; this.save(); }
    }

    renameProfile(id, initials) {
      const p = this.data.profiles.find((x) => x.id === id);
      if (p) { p.initials = cleanInitials(initials); this.save(); }
    }

    deleteProfile(id) {
      this.data.profiles = this.data.profiles.filter((p) => p.id !== id);
      this.data.runs = this.data.runs.filter((r) => r.profileId !== id);
      for (const k of Object.keys(this.data.paces)) if (k.startsWith(id + '|')) delete this.data.paces[k];
      if (this.data.activeProfile === id) this.data.activeProfile = this.data.profiles[0] ? this.data.profiles[0].id : null;
      this.save();
    }

    // settings
    get settings() { return this.data.settings; }
    setSetting(k, v) { this.data.settings[k] = v; this.save(); }

    // song library (imported songs)
    /**
     * Find or create the leaderboard key for an imported song.
     * @returns {{key:string, matched:boolean, similarity:number}}
     */
    registerSong(title, fp) {
      let best = null;
      let bestSim = 0;
      for (const s of this.data.library) {
        const sim = similarity(fp, s.fp);
        if (sim > bestSim) { best = s; bestSim = sim; }
      }
      if (best && bestSim >= MATCH_THRESHOLD) return { key: best.key, title: best.title, matched: true, similarity: bestSim };
      const key = 'mp3:' + hash(fp.sig + fp.du + fp.bpm);
      const existing = this.data.library.find((s) => s.key === key);
      if (!existing) {
        this.data.library.push({ key, title, fp });
        this.save();
      }
      return { key, title: existing ? existing.title : title, matched: false, similarity: bestSim };
    }

    songTitle(key) {
      const s = this.data.library.find((x) => x.key === key);
      return s ? s.title : null;
    }

    // runs & leaderboards
    addRun(run) {
      // The score-over-time timeline is only kept for each personal best (for pace).
      const { timeline, ...rest } = run;
      const entry = { ...rest, id: uid(), date: run.date || new Date().toISOString() };
      const before = this.personalBest(entry.profileId, entry.songKey, entry.difficulty);
      const isBest = !entry.failed && (!before || entry.score > before.score);
      if (isBest && timeline && timeline.length) {
        this.data.paces[paceKey(entry.profileId, entry.songKey, entry.difficulty)] = { score: entry.score, timeline };
      }
      this.data.runs.push(entry);
      if (this.data.runs.length > MAX_RUNS) this.data.runs.splice(0, this.data.runs.length - MAX_RUNS);
      this.save();
      const board = this.leaderboard(entry.songKey, entry.difficulty, 100);
      const rank = board.findIndex((e) => e.id === entry.id) + 1;
      return { entry, rank, personalBest: isBest, previousBest: before };
    }

    /** The personal best's score timeline, for the in-game pace counter. */
    pace(profileId, songKey, difficulty) {
      return this.data.paces[paceKey(profileId, songKey, difficulty)] || null;
    }

    /** Best stars (0–5) and whether they were gold (5 stars + full combo). */
    bestStars(profileId, songKey, difficulty) {
      let stars = 0, gold = false;
      for (const r of this.data.runs) {
        if (r.profileId !== profileId || r.songKey !== songKey || r.difficulty !== difficulty || r.failed) continue;
        stars = Math.max(stars, r.stars || 0);
        gold = gold || !!r.goldStars;
      }
      return { stars, gold };
    }

    /** Sum of best stars over every song and tier this player has played. */
    totalStars(profileId) {
      const best = new Map();
      for (const r of this.data.runs) {
        // Tiles mode has its own stars and crowns; these are the 5-star song ratings.
        if (r.profileId !== profileId || r.failed || String(r.difficulty).startsWith('tiles:')) continue;
        const k = r.songKey + '|' + r.difficulty;
        best.set(k, Math.max(best.get(k) || 0, r.stars || 0));
      }
      let total = 0;
      best.forEach((v) => { total += v; });
      return total;
    }

    personalBest(profileId, songKey, difficulty) {
      let best = null;
      for (const r of this.data.runs) {
        if (r.profileId === profileId && r.songKey === songKey && r.difficulty === difficulty && !r.failed) {
          if (!best || r.score > best.score) best = r;
        }
      }
      return best;
    }

    /** Best score per player (local profiles and rivals) for a song, highest first. */
    leaderboard(songKey, difficulty, limit = 10) {
      const bestBy = new Map();
      for (const r of this.data.runs) {
        if (r.songKey !== songKey || r.difficulty !== difficulty || r.failed) continue;
        const p = this.data.profiles.find((x) => x.id === r.profileId);
        if (!p) continue;
        const prev = bestBy.get('p:' + p.id);
        if (!prev || r.score > prev.score) bestBy.set('p:' + p.id, { ...r, initials: p.initials, color: p.color, rival: false });
      }
      for (const r of this.data.rivals) {
        if (r.songKey !== songKey || r.difficulty !== difficulty) continue;
        const k = 'r:' + r.initials;
        const prev = bestBy.get(k);
        if (!prev || r.score > prev.score) bestBy.set(k, { ...r, rival: true });
      }
      return [...bestBy.values()].sort((a, b) => b.score - a.score || a.date.localeCompare(b.date)).slice(0, limit);
    }

    /** Songs that have at least one score, most recently played first. */
    playedSongs() {
      const seen = new Map();
      for (const r of [...this.data.runs, ...this.data.rivals]) {
        const prev = seen.get(r.songKey);
        if (!prev || r.date > prev.date) seen.set(r.songKey, { key: r.songKey, title: r.title, date: r.date });
      }
      return [...seen.values()].sort((a, b) => b.date.localeCompare(a.date));
    }

    /**
     * Add a friend's shared score. Imported songs are matched to the local
     * library by fingerprint, so their score lands on the same board as yours.
     */
    addRival(shared) {
      let songKey = shared.songKey;
      if (shared.fp && songKey.startsWith('mp3:')) {
        for (const s of this.data.library) {
          if (similarity(shared.fp, s.fp) >= MATCH_THRESHOLD) { songKey = s.key; break; }
        }
        if (!this.data.library.some((s) => s.key === songKey)) {
          this.data.library.push({ key: songKey, title: shared.title, fp: shared.fp });
        }
      }
      const entry = {
        id: uid(),
        initials: shared.initials,
        songKey,
        title: shared.title,
        difficulty: shared.difficulty,
        score: shared.score,
        grade: shared.grade,
        accuracy: shared.accuracy,
        maxCombo: shared.maxCombo,
        fullCombo: shared.fullCombo,
        date: shared.date || new Date().toISOString().slice(0, 10),
        verified: shared.verified,
      };
      const dupe = this.data.rivals.find((r) => r.initials === entry.initials && r.songKey === songKey && r.difficulty === entry.difficulty && r.score === entry.score);
      if (!dupe) {
        this.data.rivals.push(entry);
        this.save();
      }
      return { ...entry, duplicate: !!dupe };
    }

    stats(profileId) {
      const runs = this.data.runs.filter((r) => r.profileId === profileId);
      return {
        plays: runs.length,
        notesHit: runs.reduce((s, r) => s + (r.hits || 0), 0),
        fullCombos: runs.filter((r) => r.fullCombo).length,
        bestCombo: runs.reduce((m, r) => Math.max(m, r.maxCombo || 0), 0),
        stars: this.totalStars(profileId),
      };
    }

    // backup
    exportJSON() {
      return JSON.stringify({ app: 'beat-frets', exported: new Date().toISOString(), save: this.data }, null, 1);
    }

    /** Merge a backup into this save. Returns counts of what was added. */
    importJSON(text) {
      const parsed = JSON.parse(text);
      const incoming = parsed && parsed.app === 'beat-frets' ? parsed.save : null;
      if (!incoming || incoming.version !== VERSION) throw new Error('This is not a Beat Frets save file.');
      const added = { profiles: 0, runs: 0, rivals: 0 };
      for (const p of incoming.profiles || []) {
        if (!this.data.profiles.some((x) => x.id === p.id)) { this.data.profiles.push(p); added.profiles++; }
      }
      const runIds = new Set(this.data.runs.map((r) => r.id));
      for (const r of incoming.runs || []) {
        if (!runIds.has(r.id)) { this.data.runs.push(r); added.runs++; }
      }
      for (const r of incoming.rivals || []) {
        if (!this.data.rivals.some((x) => x.id === r.id)) { this.data.rivals.push(r); added.rivals++; }
      }
      for (const [k, v] of Object.entries(incoming.paces || {})) {
        const mine = this.data.paces[k];
        if (!mine || v.score > mine.score) this.data.paces[k] = v;
      }
      for (const s of incoming.library || []) {
        if (!this.data.library.some((x) => x.key === s.key)) this.data.library.push(s);
      }
      if (!this.data.activeProfile && this.data.profiles[0]) this.data.activeProfile = this.data.profiles[0].id;
      this.save();
      return added;
    }

    reset() {
      const settings = this.data.settings;
      this.data = emptySave();
      this.data.settings = settings;
      this.save();
    }
  }

  return { Store, fingerprint, similarity, encodeShare, decodeShare, cleanInitials, MATCH_THRESHOLD, DEFAULT_SETTINGS };
});
