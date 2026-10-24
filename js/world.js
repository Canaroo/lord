/*
 * World — global leaderboards, kept in Firebase (Firestore).
 *
 * Fairness: a score only counts against people who played the same notes.
 *   - Song pack and bonus tracks have the same chart for everyone, so each
 *     (song, tier) has one world board.
 *   - An imported MP3's board is named after its chart: a hash of the notes,
 *     measured from the first note. Two rips that chart the same (even with
 *     different silence at the start) share a board; a different version of
 *     the song gets its own.
 *   - A challenge plays someone else's exact notes over your own copy of the
 *     song. Their chart is stored with their board, and we slide it to line up
 *     with your audio (like bonus tracks), so nobody has to send an MP3.
 *
 * The pure parts (hashing, packing, alignment) run under Node tests. The
 * network part talks to a backend: Firestore when js/firebase-config.js has a
 * config, or a stand-in set on window.BeatFretsWorldBackend (used by tests).
 */
'use strict';
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.World = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const COLLECTION = 'beatfrets_boards';
  const SONGS = 'beatfrets_songs'; // a small listing of imported songs' boards (no charts), for browsing
  const MAX_ALIGN_SHIFT = 15; // seconds: different rips can start quite differently
  const GOOD_MATCH = 0.6;

  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  // ---- charts ---------------------------------------------------------------------------

  /** Notes as compact text: times in ms from the first note, so a shifted copy hashes the same. */
  function noteText(chart) {
    const notes = chart.notes || [];
    const t0 = notes.length ? notes[0].t : 0;
    const ms = (t) => Math.round((t - t0) * 100) * 10; // 10 ms steps absorb rounding noise
    return notes.map((n) => {
      let s = ms(n.t).toString(36) + ':' + n.lane;
      if (n.len) s += ':' + Math.round(n.len * 100).toString(36);
      if (n.slide) s += ':' + n.slide.map(([a, l]) => Math.round(a * 100).toString(36) + '>' + l).join('~');
      return s;
    }).join(',');
  }

  function chartHash(chart) {
    const text = (chart.lanes || 0) + '|' + noteText(chart);
    return hash(text) + hash('bf' + text).slice(0, 3);
  }

  /** A chart as a small JSON string (times rounded to 1 ms). */
  function packChart(chart) {
    const r = (x) => Math.round(x * 1000);
    return JSON.stringify({
      d: chart.difficulty,
      l: chart.lanes,
      n: chart.notes.map((n) => {
        const a = [r(n.t), n.lane];
        if (n.len || n.slide) a.push(r(n.len || 0));
        if (n.slide) a.push(n.slide.map(([t, l]) => [r(t), l]));
        return a;
      }),
    });
  }

  function unpackChart(text) {
    const o = typeof text === 'string' ? JSON.parse(text) : text;
    if (!o || !Array.isArray(o.n)) throw new Error('bad chart');
    const lanes = Math.max(2, Math.min(5, o.l | 0));
    return {
      difficulty: String(o.d || ''),
      lanes,
      notes: o.n.map(([t, lane, len, slide]) => {
        const n = { t: t / 1000, lane: Math.max(0, Math.min(lanes - 1, lane | 0)) };
        if (len) n.len = len / 1000;
        if (Array.isArray(slide)) n.slide = slide.map(([a, l]) => [a / 1000, Math.max(0, Math.min(lanes - 1, l | 0))]);
        return n;
      }).filter((n) => isFinite(n.t)).sort((a, b) => a.t - b.t),
    };
  }

  /** Every world board's id: one per song and tier, or per chart for imported songs. */
  function boardId(songKey, difficulty, chart) {
    const diff = String(difficulty).replace(/[^a-z0-9]/gi, '-');
    if (/^(pack|bonus):/.test(songKey)) return songKey.replace(':', '-').replace(/[^a-z0-9-]/gi, '') + '__' + diff;
    return 'chart-' + chartHash(chart) + '__' + diff;
  }

  /**
   * Shift (seconds) to add to `reference` notes so they land on `local` ones,
   * searched coarse then fine over ±maxShift. Notes are {t, lane}: music repeats
   * every bar, so timing alone fits at many shifts, but lanes (which follow the
   * sound's pitch) only line up at the right one. `match` (0–1) says how well
   * the notes landed: half for timing, half for timing in the same lane, since
   * two charts of one song still pick some lanes differently.
   */
  function alignShift(reference, local, maxShift = MAX_ALIGN_SHIFT) {
    if (reference.length < 6 || local.length < 6) return { shift: 0, match: 0 };
    const sorted = (arr) => arr.map((n) => n.t).sort((a, b) => a - b);
    const all = sorted(local);
    const byLane = {};
    for (const n of local) (byLane[n.lane] = byLane[n.lane] || []).push(n);
    for (const k of Object.keys(byLane)) byLane[k] = sorted(byLane[k]);
    const near = (loc, t) => {
      if (!loc || !loc.length) return Infinity;
      let lo = 0, hi = loc.length - 1;
      if (t <= loc[0]) return loc[0] - t;
      if (t >= loc[hi]) return t - loc[hi];
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (loc[mid] < t) lo = mid; else hi = mid;
      }
      return Math.min(t - loc[lo], loc[hi] - t);
    };
    const fit = (sh, tol) => {
      let s = 0;
      for (const n of reference) {
        const d = near(byLane[n.lane], n.t + sh);
        if (d < tol) s += 1 - d / tol;
        const any = near(all, n.t + sh);
        if (any < tol) s += 0.3 * (1 - any / tol);
      }
      return s;
    };
    const search = (from, to, step, tol) => {
      let best = 0, bestScore = -1;
      for (let i = 0, sh = from; sh <= to + 1e-9; i++, sh = from + i * step) {
        const s = fit(sh, tol);
        if (s > bestScore + 1e-6 || (Math.abs(s - bestScore) < 1e-6 && Math.abs(sh) < Math.abs(best))) { bestScore = s; best = sh; }
      }
      return best;
    };
    let sh = search(-maxShift, maxShift, 0.01, 0.03);
    sh = search(sh - 0.02, sh + 0.02, 0.001, 0.015);
    let same = 0, any = 0;
    for (const n of reference) {
      if (near(byLane[n.lane], n.t + sh) < 0.04) same++;
      if (near(all, n.t + sh) < 0.04) any++;
    }
    return { shift: +sh.toFixed(3), match: (same + any) / 2 / reference.length };
  }

  /** Their chart, slid onto your copy of the song (`mine` is your own chart of it). */
  function alignChart(chart, mine) {
    const { shift, match } = alignShift(chart.notes, mine.notes);
    return {
      chart: { ...chart, notes: chart.notes.map((n) => ({ ...n, t: +(n.t + shift).toFixed(4) })) },
      shift,
      match,
      good: match >= GOOD_MATCH,
    };
  }

  // ---- backend ----------------------------------------------------------------------------

  const config = () => root.BEAT_FRETS_FIREBASE || null;
  const available = () => !!(root.BeatFretsWorldBackend || (config() && config().projectId));
  let backendPromise = null;

  function backend() {
    if (root.BeatFretsWorldBackend) return Promise.resolve(root.BeatFretsWorldBackend);
    if (!available()) return Promise.reject(new Error('World boards are not set up.'));
    if (!backendPromise) backendPromise = firestoreBackend(config()).catch((e) => { backendPromise = null; throw e; });
    return backendPromise;
  }

  async function firestoreBackend(cfg) {
    const [app, auth, fs] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-firestore.js'),
    ]);
    const fb = app.initializeApp(cfg, 'beat-frets');
    const a = auth.getAuth(fb);
    const user = a.currentUser || (await auth.signInAnonymously(a)).user;
    const db = fs.getFirestore(fb);
    const boardRef = (id) => fs.doc(db, COLLECTION, id);
    const scores = (id) => fs.collection(db, COLLECTION, id, 'scores');
    return {
      uid: user.uid,
      async getBoard(id) { const s = await fs.getDoc(boardRef(id)); return s.exists() ? s.data() : null; },
      async createBoard(id, meta) { await fs.setDoc(boardRef(id), { ...meta, created: fs.serverTimestamp() }); },
      async getScore(id, sid) { const s = await fs.getDoc(fs.doc(scores(id), sid)); return s.exists() ? s.data() : null; },
      async putScore(id, sid, entry) { await fs.setDoc(fs.doc(scores(id), sid), { ...entry, at: fs.serverTimestamp() }); },
      async top(id, limit) {
        const q = fs.query(scores(id), fs.orderBy('score', 'desc'), fs.limit(limit));
        return (await fs.getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
      },
      async above(id, score) {
        const q = fs.query(scores(id), fs.where('score', '>', score));
        return (await fs.getCountFromServer(q)).data().count;
      },
      async getSong(id) { const s = await fs.getDoc(fs.doc(db, SONGS, id)); return s.exists() ? s.data() : null; },
      async createSong(id, data) { await fs.setDoc(fs.doc(db, SONGS, id), { ...data, created: fs.serverTimestamp() }); },
      async listSongs(limit) {
        const q = fs.query(fs.collection(db, SONGS), fs.orderBy('created', 'desc'), fs.limit(limit));
        return (await fs.getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data(), created: d.data().created && d.data().created.toMillis ? d.data().created.toMillis() : 0 }));
      },
      async findBoards(difficulty, bpmKeys) {
        const q = fs.query(fs.collection(db, COLLECTION), fs.where('difficulty', '==', difficulty),
          fs.where('bpmKey', 'in', bpmKeys), fs.limit(30));
        return (await fs.getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
      },
    };
  }

  // ---- what the game calls --------------------------------------------------------------------

  /**
   * Post a run. Keeps one best score per player per board (player = this
   * device's sign-in + local profile). Imported songs' boards are created with
   * their chart, so others can challenge it.
   * @returns {Promise<{rank:number, improved:boolean, best:number}>}
   */
  const scoreId = (b, profileId) => b.uid + '_' + String(profileId || 'guest').replace(/[^a-z0-9]/gi, '').slice(0, 24);

  /**
   * Before posting: this player's world best on the board (null if none yet),
   * and the rank a score would get. Nothing is written.
   * @returns {Promise<{best:number|null, rank:number, better:boolean}>}
   */
  async function peek({ id, profileId, score }) {
    const b = await backend();
    const prev = await b.getScore(id, scoreId(b, profileId));
    const best = prev ? prev.score : null;
    const better = best == null || score > best;
    const exists = !!(await b.getBoard(id));
    return { best, better, exists, rank: (await b.above(id, better ? score : best)) + 1 };
  }

  async function submit({ id, meta, entry, profileId }) {
    const b = await backend();
    if (!(await b.getBoard(id))) await b.createBoard(id, meta);
    // Imported songs are listed (without their charts) so others can find them.
    if (meta.kind === 'mp3' && b.getSong) {
      try {
        if (!(await b.getSong(id))) {
          await b.createSong(id, {
            title: meta.title, songKey: meta.songKey, difficulty: meta.difficulty,
            bpm: meta.bpm, duration: meta.duration, notes: meta.notes, fp: meta.fp || null,
          });
        }
      } catch (e) { /* the listing is optional; the score still posts */ }
    }
    const sid = scoreId(b, profileId);
    const prev = await b.getScore(id, sid);
    const improved = !prev || entry.score > prev.score;
    if (improved) {
      try {
        await b.putScore(id, sid, entry);
      } catch (e) {
        // Boards whose rules predate race lines turn the extra fields away: post without them.
        if (!/permission/i.test(String((e && e.code) || e)) || !('tl' in entry || 'beat' in entry)) throw e;
        const { tl, beat, ...plain } = entry;
        await b.putScore(id, sid, plain);
      }
    }
    const best = improved ? entry.score : prev.score;
    return { rank: (await b.above(id, best)) + 1, improved, best, sid };
  }

  async function top(id, limit = 25) {
    const b = await backend();
    const rows = await b.top(id, limit);
    return rows.map((r) => ({ ...r, mine: r.id && r.id.startsWith(b.uid + '_') }));
  }

  async function board(id) { return (await backend()).getBoard(id); }

  /** Other imported-song boards that look like the same song, best guess first. */
  /** Tempos that could be the same song: close by, or at half or double time. */
  function tempoKeys(bpm) {
    const k = Math.round(bpm || 0);
    const set = new Set();
    for (const c of [k, Math.round(k / 2), k * 2]) for (let d = -3; d <= 3; d++) if (c + d > 0) set.add(c + d);
    return [...set].slice(0, 30);
  }

  /**
   * Imported songs on the world boards, newest first, grouped by song: one entry
   * per upload, with each difficulty's board.
   */
  async function songs(limit = 80) {
    const b = await backend();
    if (!b.listSongs) return [];
    const rows = await b.listSongs(limit);
    const groups = new Map();
    for (const r of rows) {
      if (/^selftest/.test(r.id)) continue; // setup checks run against the live database
      const k = (r.songKey || r.id) + '|' + r.title;
      if (!groups.has(k)) groups.set(k, { key: r.songKey, title: r.title, fp: r.fp || null, bpm: r.bpm, duration: r.duration, created: r.created || 0, boards: {} });
      const g = groups.get(k);
      g.boards[r.difficulty] = r.id;
      g.created = Math.max(g.created, r.created || 0);
    }
    return [...groups.values()].sort((a, c) => c.created - a.created);
  }

  async function versions({ difficulty, bpm, fp, title, exclude }) {
    const b = await backend();
    const found = await b.findBoards(difficulty, tempoKeys(bpm));
    const words = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    const mine = words(title);
    const sim = root.SaveData && fp ? root.SaveData.similarity : null;
    return found.filter((x) => x.id !== exclude && x.kind === 'mp3').map((x) => {
      let score = 0;
      for (const w of words(x.title)) if (mine.has(w)) score += 1;
      if (sim && x.fp) score += 2 * sim(fp, x.fp);
      return { ...x, likeness: score };
    }).sort((a, c) => c.likeness - a.likeness).slice(0, 6);
  }

  return {
    available, peek, submit, top, board, versions, songs, tempoKeys,
    boardId, chartHash, packChart, unpackChart, alignShift, alignChart,
    GOOD_MATCH, COLLECTION,
  };
});
