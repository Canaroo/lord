#!/usr/bin/env node
/*
 * Song-pack report: notes per second on every difficulty, the checks npm test
 * makes, and whether each theme still runs ROOKIE → PRO → ELITE.
 *
 *   node .claude/skills/add-song/scripts/song-stats.js            # every song
 *   node .claude/skills/add-song/scripts/song-stats.js garage-jam  # just these (themes still checked)
 *
 * Exits 1 if any song fails a check, so it's safe to use as a gate.
 */
'use strict';
const path = require('path');
const root = path.resolve(__dirname, '../../../..');
const SongPack = require(path.join(root, 'js/songs.js'));
const ChartGen = require(path.join(root, 'js/chartgen.js'));

// Same limits as tests/songs.test.js (keep in step if those change).
const RANGE = { easy: [1, 3.5], medium: [1.8, 5.5], hard: [3, 8], insane: [3.5, 8.6] };
// Where each tier usually sits on Easy (notes a second), from the songs already in the pack.
const LABEL = (t) => ({ rookie: 'ROOKIE', pro: 'PRO', boss: 'ELITE' }[t] || String(t || '?').toUpperCase());
const TIER_EASY = { rookie: [1.2, 2.0], pro: [1.8, 2.6], boss: [2.4, 3.5] };
const ORDER = { rookie: 0, pro: 1, boss: 2 };

const only = process.argv.slice(2);
const rows = [];
let failed = 0;

for (const song of SongPack.SONGS) {
  const problems = [];
  let a;
  try { a = SongPack.toAnalysis(SongPack.build(song)); }
  catch (e) { rows.push({ song, problems: [e.message] }); failed++; continue; }
  const nps = {}, total = {};
  for (const d of Object.keys(ChartGen.DIFFICULTIES)) {
    const c = ChartGen.generate(a, d);
    total[d] = c.notes.length;
    nps[d] = c.notes.length / a.duration;
    if (RANGE[d] && !(nps[d] > RANGE[d][0] && nps[d] < RANGE[d][1])) problems.push(`${d} ${nps[d].toFixed(2)}/s is outside ${RANGE[d][0]}–${RANGE[d][1]}`);
    const counts = new Array(c.lanes).fill(0);
    c.notes.forEach((n) => counts[n.lane]++);
    if (counts.some((x) => x / c.notes.length <= 0.04)) problems.push(`${d}: a lane is almost unused (${counts})`);
  }
  if (!(total.easy < total.medium && total.medium < total.hard && total.hard < total.insane)) problems.push(`difficulties don't step up: ${JSON.stringify(total)}`);
  if (!ORDER.hasOwnProperty(song.tier)) problems.push(`tier must be rookie, pro or boss (got ${song.tier})`);
  const guide = TIER_EASY[song.tier];
  const note = guide && (nps.easy < guide[0] || nps.easy > guide[1]) ? `Easy ${nps.easy.toFixed(2)}/s is unusual for ${LABEL(song.tier)} (usually ${guide[0]}–${guide[1]})` : '';
  if (problems.length) failed++;
  rows.push({ song, nps, secs: a.duration, problems, note });
}

const show = rows.filter((r) => !only.length || only.includes(r.song.id));
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('song', 22) + pad('theme', 9) + pad('tier', 8) + pad('bpm', 5) + pad('secs', 6) + 'easy  med   hard  insane');
for (const r of show) {
  const s = r.song;
  const n = r.nps ? ['easy', 'medium', 'hard', 'insane'].map((d) => r.nps[d].toFixed(2).padEnd(6)).join('') : '';
  console.log(pad(s.id, 22) + pad(s.theme || 'classic', 9) + pad(s.tier || '?', 8) + pad(s.bpm, 5) + pad(r.secs ? r.secs.toFixed(0) : '', 6) + n);
  for (const p of r.problems) console.log('   FAIL ' + p);
  if (r.note) console.log('   note ' + r.note);
}

// Each theme should list its songs ROOKIE, PRO, ELITE, getting harder as it goes.
const themes = {};
for (const r of rows) (themes[r.song.theme || 'classic'] = themes[r.song.theme || 'classic'] || []).push(r);
console.log('\nthemes (in list order):');
for (const [t, list] of Object.entries(themes)) {
  const tiers = list.map((r) => r.song.tier);
  const sorted = tiers.every((x, i) => i === 0 || ORDER[tiers[i - 1]] <= ORDER[x]);
  const easy = list.map((r) => (r.nps ? r.nps.easy.toFixed(2) : '?'));
  console.log(`  ${pad(t, 9)} ${tiers.map(LABEL).join(' → ')}   easy ${easy.join(' → ')}${sorted ? '' : '   FAIL tiers out of order'}`);
  if (!sorted) failed++;
  const harder = list.every((r, i) => i === 0 || !r.nps || !list[i - 1].nps || r.song.tier === list[i - 1].song.tier || r.nps.easy > list[i - 1].nps.easy);
  if (!harder) console.log('   note a higher tier is not busier on Easy than the one before it');
}
const ids = SongPack.SONGS.map((s) => s.id);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dup.length) { console.log('FAIL duplicate ids: ' + dup.join(', ')); failed++; }
console.log(failed ? `\n${failed} problem(s)` : '\nall songs pass');
process.exit(failed ? 1 : 0);
