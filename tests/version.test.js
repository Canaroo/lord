'use strict';
// An update has to load as one matching set of files (see sw.js), so the version
// must be the same everywhere it's written.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the version matches in main.js, sw.js, index.html and package.json', () => {
  const version = read('js/main.js').match(/const VERSION = '([\d.]+)'/)[1];
  assert.strictEqual(read('sw.js').match(/const V = '([\d.]+)'/)[1], version, 'sw.js V');
  const html = read('index.html');
  assert.strictEqual(html.match(/<html[^>]*data-v="([\d.]+)"/)[1], version, 'index.html data-v');
  const refs = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 16, 'code and style are listed');
  for (const r of refs) assert.ok(r.endsWith('?v=' + version), `${r} asks for ?v=${version}`);
  assert.ok(JSON.parse(read('package.json')).version.startsWith(version + '.'), 'package.json version');
});

test('every script the page loads is cached for offline play', () => {
  const html = read('index.html');
  const sw = read('sw.js');
  const list = sw.match(/\[([^\]]+)\]\.map\(\(f\) => `js\/\$\{f\}\.js\?v=\$\{V\}`\)/)[1];
  const cached = new Set([...list.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
  for (const m of html.matchAll(/<script src="js\/([a-z-]+)\.js\?v=/g)) assert.ok(cached.has(m[1]), `${m[1]}.js is in the service worker's list`);
});
