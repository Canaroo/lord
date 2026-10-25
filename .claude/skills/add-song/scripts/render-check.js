#!/usr/bin/env node
/*
 * Synthesises pack songs in a real browser, the same way a phone does on first
 * play, and reports length, loudness and how long the build took.
 *
 *   node .claude/skills/add-song/scripts/render-check.js witching-hour garage-jam
 *   node .claude/skills/add-song/scripts/render-check.js --preview <dir> garage-jam
 *
 * --preview also saves <dir>/<id>.mp3 (or .wav without ffmpeg) to listen to.
 *
 * Needs Playwright with Chromium (pre-installed in Claude Code cloud sessions).
 * Exits 1 on a page error, a failed render, or a song that is silent or clipping.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../../..');

(async () => {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--preview');
  const previewDir = pi >= 0 ? path.resolve(args.splice(pi, 2)[1]) : null;
  const ids = args;
  if (!ids.length) { console.error('usage: render-check.js <song-id> [...]'); process.exit(2); }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(root, 'index.html'));
  await page.waitForTimeout(300);
  let bad = 0;
  for (const id of ids) {
    const out = await page.evaluate(async ([id, wantPcm]) => {
      const s = SongPack.SONGS.find((x) => x.id === id);
      if (!s) return { id, error: 'no such song' };
      const t0 = performance.now();
      try {
        const buf = await SongPack.render(SongPack.build(s));
        const d = buf.getChannelData(0);
        let sum = 0, peak = 0;
        for (let i = 0; i < d.length; i += 7) { sum += d[i] * d[i]; peak = Math.max(peak, Math.abs(d[i])); }
        const res = { id, sec: +buf.duration.toFixed(1), rms: +Math.sqrt(sum / (d.length / 7)).toFixed(3), peak: +peak.toFixed(2), buildSec: +((performance.now() - t0) / 1000).toFixed(1) };
        if (wantPcm) {
          // 16-bit stereo interleaved, as base64, for a WAV file.
          const L = buf.getChannelData(0), R = buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0);
          const pcm = new Int16Array(L.length * 2);
          for (let i = 0; i < L.length; i++) {
            pcm[2 * i] = Math.max(-1, Math.min(1, L[i])) * 32767;
            pcm[2 * i + 1] = Math.max(-1, Math.min(1, R[i])) * 32767;
          }
          const bytes = new Uint8Array(pcm.buffer);
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          res.pcm = btoa(bin);
          res.sr = buf.sampleRate;
        }
        return res;
      } catch (e) { return { id, error: e.message }; }
    }, [id, !!previewDir]);
    if (out.pcm) {
      const data = Buffer.from(out.pcm, 'base64');
      delete out.pcm;
      const head = Buffer.alloc(44);
      head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
      head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22);
      head.writeUInt32LE(out.sr, 24); head.writeUInt32LE(out.sr * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
      head.write('data', 36); head.writeUInt32LE(data.length, 40);
      fs.mkdirSync(previewDir, { recursive: true });
      const wav = path.join(previewDir, id + '.wav');
      fs.writeFileSync(wav, Buffer.concat([head, data]));
      out.preview = wav;
      try {
        const mp3 = path.join(previewDir, id + '.mp3');
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-b:a', '160k', mp3]);
        fs.unlinkSync(wav);
        out.preview = mp3;
      } catch (e) { /* no ffmpeg: keep the WAV */ }
      delete out.sr;
    }
    // The pack's songs sit around rms 0.12–0.17 with peaks below 1.
    const warn = out.error ? out.error : out.rms < 0.05 ? 'too quiet' : out.peak >= 0.99 ? 'clipping' : '';
    if (warn) bad++;
    console.log(JSON.stringify(out) + (warn ? '   FAIL ' + warn : ''));
  }
  if (errors.length) { console.log('page errors:', errors); bad++; }
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
