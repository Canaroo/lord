#!/usr/bin/env node
/*
 * Builds note charts for the bonus songs in songs/ and updates songs/index.json.
 *
 *   npm run build-charts            # every .mp3 in songs/
 *   node tools/build-charts.js songs/my-song.mp3
 *
 * Needs ffmpeg and ffprobe on your PATH (https://ffmpeg.org). Song titles and
 * artists come from the MP3's tags, or the file name. Edit songs/index.json
 * afterwards to add a credit line; re-running keeps your edits.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const BeatAnalyzer = require('../js/analyzer.js');
const ChartGen = require('../js/chartgen.js');
const BonusPack = require('../js/bonus.js');

const SONGS_DIR = process.env.SONGS_DIR || path.join(__dirname, '..', 'songs');
const INDEX = path.join(SONGS_DIR, 'index.json');
const SR = 44100;

function slug(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 48) || 'song';
}

function tags(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', file], { encoding: 'utf8' });
    const t = (JSON.parse(out).format || {}).tags || {};
    const get = (k) => t[k] || t[k.toUpperCase()] || t[k[0].toUpperCase() + k.slice(1)] || '';
    return { title: get('title'), artist: get('artist') };
  } catch (e) {
    return { title: '', artist: '' };
  }
}

function decode(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

async function build(file, index) {
  const base = path.basename(file);
  const existing = index.songs.find((s) => s.file === base);
  const t = tags(file);
  const title = (existing && existing.title) || t.title || base.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  const artist = (existing && existing.artist) || t.artist || '';
  const id = (existing && existing.id) || slug(title);
  process.stdout.write(`${base}: decoding… `);
  const samples = decode(file);
  process.stdout.write(`analysing ${(samples.length / SR).toFixed(0)}s… `);
  const analysis = await BeatAnalyzer.analyze([samples], SR);
  const charts = {};
  for (const d of Object.keys(ChartGen.DIFFICULTIES)) charts[d] = ChartGen.generate(analysis, d);
  const chartFile = id + '.chart.json';
  fs.writeFileSync(path.join(SONGS_DIR, chartFile), JSON.stringify({
    version: 1,
    analyzer: BeatAnalyzer.VERSION,
    duration: analysis.duration,
    bpm: analysis.bpm,
    beats: analysis.beats,
    reference: BonusPack.referenceOnsets(analysis),
    charts,
  }));
  const sizeMb = fs.statSync(file).size / 1e6;
  const entry = { id, title, artist, file: base, chart: chartFile, credit: existing ? existing.credit || '' : '' };
  if (existing) Object.assign(existing, entry); else index.songs.push(entry);
  console.log(`${Math.round(analysis.bpm)} BPM, ${Object.entries(charts).map(([d, c]) => `${d} ${c.notes.length}`).join(', ')} notes${sizeMb > 8 ? `  (warning: ${sizeMb.toFixed(1)} MB; 128–192 kbps keeps downloads quick)` : ''}`);
}

(async () => {
  if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR, { recursive: true });
  const index = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, 'utf8')) : { songs: [] };
  const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs.readdirSync(SONGS_DIR).filter((f) => /\.mp3$/i.test(f)).map((f) => path.join(SONGS_DIR, f));
  if (!files.length) { console.log(`No MP3s found in ${SONGS_DIR}.`); return; }
  for (const f of files) await build(f, index);
  // Drop entries whose MP3 is gone.
  index.songs = index.songs.filter((s) => fs.existsSync(path.join(SONGS_DIR, s.file)));
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');
  console.log(`Updated ${path.relative(process.cwd(), INDEX)} (${index.songs.length} songs).`);
})().catch((e) => {
  console.error(e.code === 'ENOENT' ? 'ffmpeg/ffprobe not found. Install ffmpeg and try again.' : e);
  process.exit(1);
});
