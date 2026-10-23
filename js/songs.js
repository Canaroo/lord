/*
 * SongPack — original chiptune tracks composed as data and synthesised in the
 * browser (pulse leads with echo, triangle bass, noise drums: a 16-bit console
 * sound palette).
 *
 * Charts for these songs come from the composition itself, not from audio
 * analysis, so every player gets the exact same notes. That is what makes the
 * song pack fair for comparing scores with friends.
 *
 * build() and toAnalysis() are pure and run in Node for tests; render() needs
 * Web Audio (browser only).
 */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SongPack = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    harmonic: [0, 2, 3, 5, 7, 8, 11],
  };
  // Bass pattern characters → scale steps above the chord root.
  const BASS_STEPS = { 0: 0, 2: 2, 4: 4, 7: 7 };
  const LEAD_IN = 1.0;

  const SONGS = [
    {
      id: 'pixel-overture',
      title: 'Pixel Overture',
      blurb: 'A bright warm-up in C major.',
      bpm: 104,
      root: 60,
      scale: 'major',
      prog: [0, 4, 5, 3],
      drums: {
        intro: { h: 'x...x...x...x...' },
        basic: { k: 'x.......x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        drive: { k: 'x.....x.x.......', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' },
        fill: { k: 'x...x...x.......', s: '....x...x.x.xxxx', h: 'x.x.x.x.........' },
      },
      bass: {
        verse: '0.0.0.4.0.0.0.7.',
        chorus: '0.0.4.0.7.0.4.2.',
      },
      lead: {
        verse: ['4---2---4-5-7---', '6---4---4-2-1---', '5---7---9-7-5---', '3---5---7---5-4-'],
        chorus: ['7-7-9-7-b---9-7-', '6-6-8-6-4---6-8-', '7-7-9-7-c---b-9-', 'a-9-7-5-7-------'],
        outro: ['7-------4-------', '0---------------'],
      },
      form: [
        { bars: 2, drums: 'intro', arp: true },
        { bars: 4, drums: 'basic', bass: 'verse', lead: 'verse', crash: true },
        { bars: 4, drums: 'drive', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'basic', bass: 'verse', lead: 'verse', crash: true },
        { bars: 4, drums: 'drive', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'drive', bass: 'chorus', lead: 'chorus', arp: true, crash: true },
        { bars: 2, drums: 'basic', bass: 'verse', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'turbo-cartridge',
      title: 'Turbo Cartridge',
      blurb: 'A racing-game rush in E minor.',
      bpm: 140,
      root: 64,
      scale: 'minor',
      prog: [0, 5, 2, 6],
      drums: {
        intro: { k: 'x.......x.......', h: 'x.x.x.x.x.x.x.x.' },
        drive: { k: 'x.....x...x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        chorus: { k: 'x...x...x...x...', s: '....x.......x..x', o: '..x...x...x...x.' },
        brk: { k: 'x...............', h: '....x.......x...' },
        fill: { k: 'x...x...x...x...', s: '....x...x.x.x.xx', h: '' },
      },
      bass: {
        gallop: '0.00.00.0.00.07.',
        chorus: '0.0.0.0.7.0.4.0.',
        brk: '0---------------',
      },
      lead: {
        verse: ['7---4---7-8-9---', '9-8-7-5-4---0---', '4---2---4-5-7---', '6-5-4-2-1-------'],
        chorus: ['7.7.9.7.a.9.7.5.', '7.7.9.7.b...a.9.', '9.9.a.9.7.5.4.5.', '6.6.5.6.8...7...'],
      },
      form: [
        { bars: 2, drums: 'intro', arp: true },
        { bars: 8, drums: 'drive', bass: 'gallop', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', arp: true, crash: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true },
        { bars: 2, drums: 'drive', bass: 'gallop', lead: 'verse', crash: true },
      ],
    },
    {
      id: 'castle-overdrive',
      title: 'Castle Overdrive',
      blurb: 'A final-boss gauntlet in D harmonic minor.',
      bpm: 168,
      root: 62,
      scale: 'harmonic',
      prog: [0, 0, 5, 4],
      drums: {
        intro: { k: 'x...x...x...x...', h: 'x.x.x.x.x.x.x.x.' },
        verse: { k: 'x.x...x.x.x...x.', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        chorus: { k: 'x.xxx.x.x.xxx.x.', s: '....x.......x...', h: 'x...x...x...x...' },
        half: { k: 'x...........x...', s: '........x.......', h: 'x...x...x...x...' },
        fill: { k: 'x.x.x.x.x.x.x.x.', s: '....x...xxxxxxxx', h: '' },
      },
      bass: {
        verse: '0.0.0.0.0.0.0.0.',
        chorus: '0.0.0.0.0.0.4.4.',
        half: '0-------4-------',
      },
      lead: {
        verse: ['7-6-7-4-7-6-7-2-', '7-6-7-4-2-1-0---', '5-4-5-2-5-4-5-0-', '4-6-8-6-4-------'],
        chorus: ['b.a.9.7.9.a.b---', 'e-d-b-9-b---7---', 'c.b.a.9.a.b.c---', 'b-d-e-d-b-------'],
        half: ['7-------9-------', 'b-------a---9---', 'c-------b---a---', 'b---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', arp: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'half', bass: 'half', lead: 'half', crash: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'verse', crash: true },
      ],
    },

    // ---- Spooky ----
    {
      id: 'haunted-hallway',
      theme: 'spooky',
      title: 'Haunted Hallway',
      blurb: 'A creeping monster march on a wobbly organ.',
      bpm: 112,
      root: 57,
      scale: 'harmonic',
      prog: [0, 5, 3, 4],
      voice: { lead: 'organ', vibrato: { rate: 4.5, depth: 0.018 }, echo: { steps: 6, fb: 0.5, wet: 0.45 }, toms: 'tom' },
      drums: {
        intro: { k: 'x.......x.......', t: '..........x...x.' },
        march: { k: 'x.......x.......', s: '....x.......x...', h: '..x...x...x...x.' },
        chorus: { k: 'x...x...x...x...', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        creep: { k: 'x...............', t: 'x.....x.....x...' },
        fill: { k: 'x...x...........', s: '........x.x.x.x.', t: '....x.x.........' },
      },
      bass: {
        march: '0...4...0...4...',
        chorus: '0.0.4.4.0.0.7.4.',
        creep: '0---------------',
      },
      lead: {
        verse: ['4---3-2-1---6...', '7---6-5-4-------', '5---4-3-2---3-4-', '6---4-6-7-------'],
        chorus: ['7.7.b.a.9.8.7...', 'c-b-a-9-8---6---', 'a.a.9.8.7.6.5...', '6-7-8-6-7-------'],
        creep: ['b-------a-------', 'c-------b---a---', '9-------8-------', '6---------------'],
        outro: ['7-------4-------', '0---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'creep', arp: true },
        { bars: 8, drums: 'march', bass: 'march', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'creep', bass: 'creep', lead: 'creep', crash: true },
        { bars: 8, drums: 'march', bass: 'march', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'march', bass: 'march', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'graveyard-shift',
      theme: 'spooky',
      title: 'Graveyard Shift',
      blurb: 'Skeletons dance a fast, spooky shuffle.',
      bpm: 138,
      root: 62,
      scale: 'harmonic',
      prog: [0, 0, 5, 6],
      voice: { lead: 'organ', vibrato: { rate: 6, depth: 0.012 }, echo: { steps: 3, fb: 0.45, wet: 0.4 }, toms: 'tom' },
      drums: {
        intro: { k: 'x.......x.......', h: 'x.xx.xx.x.xx.xx.' },
        verse: { k: 'x..x..x...x..x..', s: '....x.......x...', h: 'x.xx.xx.x.xx.xx.' },
        chorus: { k: 'x...x...x...x...', s: '....x..x....x...', o: '..x...x...x...x.' },
        brk: { k: 'x...............', t: 'x..x..x..x..x...' },
        fill: { k: 'x.......x.......', s: '....x...x.x.xxxx', t: 'x.x.............' },
      },
      bass: {
        verse: '0..0..4.0..0..7.',
        chorus: '0.0.0.0.4.4.7.4.',
        brk: '0---------------',
      },
      lead: {
        verse: ['0.2.4.7.6.4.2.1.', '0.2.4.7.8.7.6...', '5.4.3.2.1.2.3.4.', '6.4.6.7.6.......'],
        chorus: ['7.7.9.b.a.9.7.6.', '7.7.9.b.c.b.a...', 'b.a.9.8.7.6.5.4.', '6.7.8.9.a---7...'],
        brk: ['7-------6-------', '5-------4-------', '3-------2-------', '6---------------'],
        outro: ['7-6-4-2-0-------', '0---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'verse', arp: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },
    // ---- Rock ----
    {
      id: 'power-chord-party',
      theme: 'rock',
      title: 'Power Chord Party',
      blurb: 'Crunchy guitars and a big stadium chorus.',
      bpm: 128,
      root: 64,
      scale: 'minor',
      prog: [0, 5, 6, 4],
      voice: { lead: 'square', echo: { steps: 3, fb: 0.3, wet: 0.25 }, toms: 'tom' },
      drums: {
        intro: { k: 'x.......x.......', h: 'x.x.x.x.x.x.x.x.' },
        verse: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        chorus: { k: 'x.x...x.x.x...x.', s: '....x.......x...', o: 'x...x...x...x...' },
        solo: { k: 'x.x.x.x.x.x.x.x.', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' },
        fill: { k: 'x...............', s: '....x.......xxxx', t: '........x.x.x...' },
      },
      bass: {
        verse: '0.0.0.0.0.0.0.0.',
        chorus: '0.0.0.0.0.0.7.7.',
      },
      gtr: {
        intro: 'o-------o-------',
        verse: 'x.x.x.x.x.x.x.x.',
        chorus: 'o---x.x.o---x.x.',
        solo: 'x.xxx.xxx.xxx.xx',
      },
      lead: {
        verse: ['7---7-9-a---9-7-', '6---6-7-9---7---', '5---5-6-7---6-5-', '4-------6---7---'],
        chorus: ['b.b.a.9.a---9-7-', 'a.a.9.7.9---7-6-', '9.9.7.6.7---6-5-', '6.7.9.a.b-------'],
        solo: ['7.9.a.b.a.9.7.9.', 'a.b.c.b.a.9.a.b.', 'c.b.a.9.a.9.7.6.', '7-9-a-b-c-b-a---'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'verse', gtr: 'intro', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', gtr: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', gtr: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 8, drums: 'verse', bass: 'verse', gtr: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', gtr: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 8, drums: 'solo', bass: 'verse', gtr: 'solo', lead: 'solo', crash: true, fill: true },
        { bars: 4, drums: 'chorus', bass: 'chorus', gtr: 'chorus', lead: 'chorus', crash: true },
      ],
    },
    {
      id: 'amp-overload',
      theme: 'rock',
      title: 'Amp Overload',
      blurb: 'A fast, shredding speed-metal blast.',
      bpm: 160,
      root: 57,
      scale: 'minor',
      prog: [0, 0, 3, 4],
      voice: { lead: 'square', vibrato: { rate: 7, depth: 0.008 }, echo: { steps: 2, fb: 0.3, wet: 0.25 }, toms: 'tom' },
      drums: {
        intro: { k: 'x.x.x.x.x.x.x.x.', h: 'x.x.x.x.x.x.x.x.' },
        verse: { k: 'x.x...x.x.x...x.', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        pre: { k: 'x...x...x...x...', s: '....x...x...x.x.', h: 'xxxxxxxxxxxxxxxx' },
        chorus: { k: 'x.x.x.x.x.x.x.x.', s: '....x.......x...', o: 'x...x...x...x...' },
        fill: { k: 'x.x.x.x.........', s: '........xxxxxxxx', t: '....x.x.........' },
      },
      bass: {
        verse: '0.00.00.0.00.07.',
        chorus: '0.0.0.0.0.0.0.0.',
      },
      gtr: {
        intro: 'x.x.x.x.x.x.x.x.',
        verse: 'x.xxx.xxx.xxx.x.',
        pre: 'x.x.x.x.x.x.x.x.',
        chorus: 'o-------o---o---',
      },
      lead: {
        verse: ['7.7.9.7.a.7.b.a.', '9.9.a.9.7...5.4.', '7.7.9.7.a.7.b.a.', 'c.b.a.9.a---7---'],
        pre: ['b-b-a-a-9-9-8-8-', 'b-b-a-a-c---b---'],
        chorus: ['e---d-c-b---a-b-', 'c---b-a-9---7---', 'a---b-c-d---c-b-', 'c-d-e-----------'],
        solo: ['e.d.c.b.c.b.a.9.', 'a.9.8.7.8.9.a.b.', 'c.d.e.d.c.b.a.b.', 'c.b.a.9.a---7---'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'verse', gtr: 'intro', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', gtr: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 4, drums: 'pre', bass: 'verse', gtr: 'pre', lead: 'pre', crash: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', gtr: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 8, drums: 'verse', bass: 'verse', gtr: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 4, drums: 'pre', bass: 'verse', gtr: 'pre', lead: 'pre', crash: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', gtr: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'verse', gtr: 'verse', lead: 'solo', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', gtr: 'chorus', lead: 'chorus', crash: true },
      ],
    },
    // ---- Epic video game ----
    {
      id: 'heros-dawn',
      theme: 'epic',
      title: "Hero's Dawn",
      blurb: 'A brassy fanfare for the start of a quest.',
      bpm: 120,
      root: 62,
      scale: 'major',
      prog: [0, 4, 5, 3],
      voice: { lead: 'brass', echo: { steps: 4, fb: 0.35, wet: 0.35 }, toms: 'timpani' },
      drums: {
        intro: { t: 'x.......x.x.x...' },
        march: { k: 'x.......x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', t: '..............x.' },
        chorus: { k: 'x...x...x...x...', s: '....x.......x...', o: '..x...x...x...x.', t: 'x.......x.......' },
        bridge: { k: 'x.......x.......', t: '....x.......x...' },
        fill: { k: 'x...............', t: 'x.x.x.x.x.x.xxxx' },
      },
      bass: {
        verse: '0...4...0...4...',
        chorus: '0.0.4.4.7.7.4.2.',
        bridge: '0-------4-------',
      },
      lead: {
        intro: ['0---4---7-------', '6---7-8-9-------'],
        verse: ['4---4-7-6-4-2---', '3---3-5-4-------', '4---4-7-9-8-7---', '8---6-7---------'],
        chorus: ['7-7-9-b---9-7---', '8-8-9-a---9-8---', '9-9-a-c---b-a---', 'b---9---7-------'],
        bridge: ['5-------4-------', '3-------4-------', '5-------6-------', '7---------------'],
        outro: ['7---4---0-------', '0---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'bridge', lead: 'intro', crash: true },
        { bars: 8, drums: 'march', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'bridge', bass: 'bridge', lead: 'bridge', crash: true },
        { bars: 8, drums: 'march', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'march', bass: 'verse', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'final-quest',
      theme: 'epic',
      title: 'Final Quest',
      blurb: 'The last dungeon: thundering timpani and a heroic charge.',
      bpm: 152,
      root: 60,
      scale: 'harmonic',
      prog: [0, 5, 3, 4],
      voice: { lead: 'brass', echo: { steps: 3, fb: 0.35, wet: 0.3 }, toms: 'timpani' },
      drums: {
        intro: { t: 'x...x...x...xxxx' },
        verse: { k: 'x.x...x.x.x...x.', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        chorus: { k: 'x.x.x.x.x.x.x.x.', s: '....x.......x...', o: 'x...x...x...x...', t: 'x.......x.......' },
        brk: { k: 'x...............', t: 'x..x..x.x..x..x.' },
        fill: { s: '....x...........', t: 'x.x.x.x.xxxxxxxx' },
      },
      bass: {
        verse: '0.00.00.0.00.07.',
        chorus: '0.0.0.0.7.7.4.4.',
        brk: '0---------------',
      },
      lead: {
        intro: ['7---4---7---b---', 'a---9---8---6---'],
        verse: ['7.6.7.4.2.4.7.9.', '8.7.8.4.6---4...', '9.8.9.7.5.7.9.a.', 'b.a.9.8.6---7...'],
        chorus: ['e---d-c-b---9---', 'c---b-a-9-------', 'a---b-c-d---b---', 'c-b-a-9-6---7---'],
        brk: ['7-------8-------', '9-------a-------', 'b-------c-------', 'd---------------'],
        outro: ['e-------b-------', '7---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'brk', lead: 'intro', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },
  ];

  // Instrument fingerprints for charting: [strength, 5-band spectrum (low → high)].
  const CHART = {
    kick: [1.0, [1, 0.5, 0, 0, 0]],
    snare: [0.85, [0, 0.1, 1, 0.35, 0.15]],
    hat: [0.3, [0, 0, 0, 0.3, 1]],
    ohat: [0.45, [0, 0, 0, 0.4, 1]],
    crash: [1.0, [0.3, 0.2, 0.3, 0.6, 1]],
    bass: [0.5, [0.5, 1, 0.1, 0, 0]],
    tom: [0.8, [0.7, 1, 0.3, 0, 0]],
    gtr: [0.6, [0.2, 0.7, 1, 0.3, 0]],
  };

  function validate(song) {
    const check = (s, where) => {
      if (s.length !== 16) throw new Error(`${song.id}: ${where} must be 16 steps, got ${s.length}`);
    };
    for (const [name, kit] of Object.entries(song.drums)) {
      for (const [inst, s] of Object.entries(kit)) if (s) check(s, `drums.${name}.${inst}`);
    }
    for (const [name, s] of Object.entries(song.bass)) check(s, `bass.${name}`);
    for (const [name, s] of Object.entries(song.gtr || {})) check(s, `gtr.${name}`);
    for (const [name, bars] of Object.entries(song.lead)) bars.forEach((s, i) => check(s, `lead.${name}[${i}]`));
  }

  function degToMidi(song, deg) {
    const sc = SCALES[song.scale];
    const oct = Math.floor(deg / 7);
    return song.root + sc[((deg % 7) + 7) % 7] + 12 * oct;
  }

  /** Length in steps of a note starting at i: itself plus following '-' holds. */
  function holdLength(pattern, i) {
    let n = 1;
    while (i + n < pattern.length && pattern[i + n] === '-') n++;
    return n;
  }

  /** Expand a song into timed events. Pure and deterministic. */
  function build(song) {
    validate(song);
    const step = 60 / song.bpm / 4;
    const events = [];
    let bar = 0;
    for (const sec of song.form) {
      for (let b = 0; b < sec.bars; b++, bar++) {
        const chord = song.prog[bar % song.prog.length];
        const barT = LEAD_IN + bar * 16 * step;
        const isFill = sec.fill && b === sec.bars - 1;
        const kit = song.drums[isFill ? 'fill' : sec.drums] || {};
        if (sec.crash && b === 0) events.push({ t: barT, inst: 'crash', vel: 1 });
        for (const [inst, key] of [['kick', 'k'], ['snare', 's'], ['hat', 'h'], ['ohat', 'o'], ['tom', 't']]) {
          const p = kit[key];
          if (!p) continue;
          for (let i = 0; i < 16; i++) {
            if (p[i] === 'x' || p[i] === 'X') events.push({ t: barT + i * step, inst, vel: p[i] === 'X' ? 1 : 0.85 });
          }
        }
        if (sec.bass) {
          const p = song.bass[sec.bass];
          for (let i = 0; i < 16; i++) {
            if (!(p[i] in BASS_STEPS)) continue;
            const midi = degToMidi(song, chord + BASS_STEPS[p[i]]) - 12;
            events.push({ t: barT + i * step, inst: 'bass', midi, dur: holdLength(p, i) * step * 0.92, vel: 0.9 });
          }
        }
        if (sec.gtr) {
          // Power chords on the chord root: 'x' a short palm-muted chug, 'o' an open
          // chord that rings through any following '-'.
          const p = song.gtr[sec.gtr];
          for (let i = 0; i < 16; i++) {
            if (p[i] !== 'x' && p[i] !== 'o') continue;
            const open = p[i] === 'o';
            events.push({ t: barT + i * step, inst: 'gtr', midi: degToMidi(song, chord) - 12, open, dur: open ? holdLength(p, i) * step * 0.95 : step * 0.8, vel: open ? 0.9 : 0.75 });
          }
        }
        if (sec.lead) {
          const phrase = song.lead[sec.lead];
          const p = phrase[b % phrase.length];
          for (let i = 0; i < 16; i++) {
            const d = parseInt(p[i], 15);
            if (Number.isNaN(d)) continue;
            events.push({ t: barT + i * step, inst: 'lead', midi: degToMidi(song, d), dur: holdLength(p, i) * step * 0.95, vel: 0.8 });
          }
        }
        if (sec.arp) {
          const tones = [chord, chord + 2, chord + 4];
          for (let i = 0; i < 16; i++) {
            events.push({ t: barT + i * step, inst: 'arp', midi: degToMidi(song, tones[i % 3]) + 12, dur: step * 0.7, vel: 0.5 });
          }
        }
      }
    }
    const end = LEAD_IN + bar * 16 * step;
    events.push({ t: end, inst: 'crash', vel: 1 }, { t: end, inst: 'kick', vel: 1 });
    if (song.bass.verse || song.bass.chorus) {
      events.push({ t: end, inst: 'bass', midi: song.root - 12, dur: 1.2, vel: 0.9 });
    }
    events.sort((a, b) => a.t - b.t);
    const beats = [];
    for (let i = 0; i <= bar * 4; i++) beats.push(+(LEAD_IN + i * 4 * step).toFixed(4));
    return { song, events, beats, duration: end + 2.5 };
  }

  function leadBands(range, midi) {
    // Spread the melody over the middle-to-right lanes by its pitch within the song.
    const p = Math.max(0, Math.min(1, (midi - range[0]) / Math.max(1, range[1] - range[0])));
    return [0, 0.1, Math.max(0, 1 - 2 * p), Math.max(0, 1 - Math.abs(2 * p - 1)), Math.max(0, 2 * p - 1)];
  }

  /** Convert events into the same shape BeatAnalyzer produces, for ChartGen. */
  function toAnalysis(built) {
    const groups = new Map();
    const leadNotes = built.events.filter((e) => e.inst === 'lead').map((e) => e.midi);
    const range = leadNotes.length ? [Math.min(...leadNotes), Math.max(...leadNotes)] : [0, 1];
    for (const e of built.events) {
      let strength, bands;
      if (e.inst === 'arp') continue;
      if (e.inst === 'lead') { strength = 0.65; bands = leadBands(range, e.midi); }
      else [strength, bands] = CHART[e.inst];
      const key = e.t.toFixed(4);
      const g = groups.get(key) || { t: +key, s: 0, b: [0, 0, 0, 0, 0], d: 0 };
      g.s = Math.max(g.s, strength * e.vel);
      // How long it rings: exact for melody and bass notes, short for drums.
      if (e.inst === 'lead' || e.inst === 'bass' || (e.inst === 'gtr' && e.open)) g.d = Math.max(g.d, e.dur);
      // Weight by strength so quiet hats don't drag every note right; the melody
      // gets extra weight so lanes follow the tune when it lands on a drum hit.
      const w = (e.inst === 'lead' ? 1.4 : e.inst === 'kick' ? 0.8 : e.inst === 'bass' ? 0.3 : e.inst === 'gtr' ? 0.5 : strength) * e.vel;
      for (let i = 0; i < 5; i++) g.b[i] += bands[i] * w;
      groups.set(key, g);
    }
    const onsets = [...groups.values()].sort((a, b) => a.t - b.t).map((g) => {
      const m = Math.max(...g.b) || 1;
      return { t: g.t, s: +Math.min(1, g.s).toFixed(3), b: g.b.map((x) => +(x / m).toFixed(2)), d: +g.d.toFixed(3) };
    });
    return { version: 'pack-1', duration: +built.duration.toFixed(3), bpm: built.song.bpm, beats: built.beats, onsets };
  }

  // ---- audio rendering (browser only) ---------------------------------------------

  function pulseWave(ctx, duty) {
    const n = 40;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      const a = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      real[k] = a * Math.cos(k * Math.PI * duty);
      imag[k] = a * Math.sin(k * Math.PI * duty);
    }
    return ctx.createPeriodicWave(real, imag);
  }

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /**
   * Synthesise a song. 32 kHz, the SNES's own output rate: authentic, and a
   * quarter less work than 44.1 kHz. `onProgress(0–1)` is called as it goes.
   */
  async function render(built, onProgress) {
    const sr = 32000;
    const ctx = new OfflineAudioContext(2, Math.ceil(sr * built.duration), sr);
    if (onProgress) {
      for (let k = 1; k < 10; k++) {
        const at = Math.floor((built.duration * k) / 10 * sr / 128) * 128 / sr;
        ctx.suspend(at).then(() => { onProgress(k / 10); ctx.resume(); }).catch(() => {});
      }
    }
    const step = 60 / built.song.bpm / 4;
    // Each song can set its own sound: lead instrument, vibrato, echo, toms.
    const voice = { lead: 'pulse', vibrato: null, echo: { steps: 3, fb: 0.38, wet: 0.32 }, toms: 'tom', ...(built.song.voice || {}) };

    // Master: gentle low-pass for that warm console DAC, then a limiter.
    const master = ctx.createGain();
    master.gain.value = 0.5;
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 11000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    master.connect(warm).connect(comp).connect(ctx.destination);

    // Echo bus, in the spirit of the SNES echo unit.
    const echoIn = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = Math.min(0.99, step * voice.echo.steps);
    const fb = ctx.createGain();
    fb.gain.value = voice.echo.fb;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2800;
    const wet = ctx.createGain();
    wet.gain.value = voice.echo.wet;
    echoIn.connect(delay).connect(echoTone).connect(fb).connect(delay);
    echoTone.connect(wet).connect(master);

    // Deterministic noise.
    const noise = ctx.createBuffer(1, sr, sr);
    const nd = noise.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < nd.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      nd[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    const pulse25 = pulseWave(ctx, 0.25);
    const pulse125 = pulseWave(ctx, 0.125);
    const square = pulseWave(ctx, 0.5);
    // Drawbar organ: a fundamental plus a few soft harmonics.
    const organ = (() => {
      const amps = [0, 1, 0.65, 0.4, 0.3, 0, 0.2, 0, 0.15];
      return ctx.createPeriodicWave(new Float32Array(amps.length), Float32Array.from(amps));
    })();
    // A whole power chord in one waveform: played an octave below the root, its
    // 2nd, 3rd and 4th harmonics are the root, fifth and octave, each with square-
    // wave overtones. One oscillator per chord keeps rendering quick.
    const powerChord = (() => {
      const n = 48, imag = new Float32Array(n);
      for (const [part, amp] of [[2, 1], [3, 0.8], [4, 0.55]]) {
        for (let k = 1; part * k < n; k += 2) imag[part * k] += amp / k;
      }
      return ctx.createPeriodicWave(new Float32Array(n), imag);
    })();
    // Guitar distortion: a hard-clipping curve.
    const crunch = (() => {
      const ws = ctx.createWaveShaper();
      const n = 1024, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 6); }
      ws.curve = c;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 3200;
      const g = ctx.createGain();
      g.gain.value = 0.17;
      const pan = ctx.createStereoPanner();
      pan.pan.value = -0.15;
      ws.connect(tone).connect(g).connect(pan).connect(master);
      return ws;
    })();

    const panner = (v) => {
      const p = ctx.createStereoPanner();
      p.pan.value = v;
      p.connect(master);
      return p;
    };
    const leadOut = panner(0.1);
    const arpOut = panner(-0.25);
    const drumOut = panner(0);

    function envGain(t, peak, attack, len, release) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.setTargetAtTime(peak * 0.7, t + attack, len * 0.4);
      g.gain.setTargetAtTime(0, t + len, release);
      return g;
    }

    function noiseHit(t, type, freq, peak, decay, out) {
      const n = ctx.createBufferSource();
      n.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      n.connect(f).connect(g).connect(out);
      n.start(t, (t * 7.31) % 0.5);
      n.stop(t + decay + 0.02);
    }

    for (const e of built.events) {
      const t = e.t;
      switch (e.inst) {
        case 'kick': {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.setValueAtTime(180, t);
          o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
          const g = ctx.createGain();
          g.gain.setValueAtTime(1.3 * e.vel, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
          o.connect(g).connect(drumOut);
          o.start(t);
          o.stop(t + 0.32);
          noiseHit(t, 'lowpass', 3000, 0.25 * e.vel, 0.02, drumOut);
          break;
        }
        case 'snare': {
          noiseHit(t, 'bandpass', 2200, 0.9 * e.vel, 0.16, drumOut);
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.setValueAtTime(220, t);
          o.frequency.exponentialRampToValueAtTime(140, t + 0.06);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.5 * e.vel, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
          o.connect(g).connect(drumOut);
          o.start(t);
          o.stop(t + 0.1);
          break;
        }
        case 'hat': noiseHit(t, 'highpass', 8500, 0.28 * e.vel, 0.035, drumOut); break;
        case 'ohat': noiseHit(t, 'highpass', 7500, 0.25 * e.vel, 0.18, drumOut); break;
        case 'crash': noiseHit(t, 'highpass', 4500, 0.45 * e.vel, 1.3, drumOut); break;
        case 'tom': {
          // Toms, or deep rolling timpani for the epic songs.
          const timp = voice.toms === 'timpani';
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.setValueAtTime(timp ? 120 : 200, t);
          o.frequency.exponentialRampToValueAtTime(timp ? 62 : 95, t + (timp ? 0.35 : 0.18));
          const g = ctx.createGain();
          g.gain.setValueAtTime((timp ? 1.1 : 0.9) * e.vel, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + (timp ? 0.7 : 0.3));
          o.connect(g).connect(drumOut);
          o.start(t);
          o.stop(t + (timp ? 0.75 : 0.32));
          noiseHit(t, 'lowpass', timp ? 900 : 1600, 0.2 * e.vel, timp ? 0.12 : 0.05, drumOut);
          break;
        }
        case 'gtr': {
          // A distorted power chord: root, fifth and octave through the crunch.
          // Chugs are palm-muted (short, darker); open chords ring.
          const mute = ctx.createBiquadFilter();
          mute.type = 'lowpass';
          mute.frequency.value = e.open ? 5000 : 1400;
          const g = envGain(t, (e.open ? 0.5 : 0.42) * e.vel, 0.003, e.dur, e.open ? 0.06 : 0.02);
          g.connect(mute).connect(crunch);
          const o = ctx.createOscillator();
          o.setPeriodicWave(powerChord);
          o.frequency.value = hz(e.midi - 12);
          o.connect(g);
          o.start(t);
          o.stop(t + e.dur + 0.1);
          break;
        }
        case 'bass': {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = hz(e.midi);
          const g = envGain(t, 0.75 * e.vel, 0.004, e.dur, 0.015);
          o.connect(g).connect(master);
          o.start(t);
          o.stop(t + e.dur + 0.1);
          break;
        }
        case 'lead': {
          const o = ctx.createOscillator();
          if (voice.lead === 'organ') o.setPeriodicWave(organ);
          else if (voice.lead === 'square') o.setPeriodicWave(square);
          else if (voice.lead === 'brass') o.type = 'sawtooth';
          else o.setPeriodicWave(pulse25);
          o.frequency.value = hz(e.midi);
          if (voice.vibrato) {
            // Themed vibrato from the very start (a wobbly organ, say).
            const lfo = ctx.createOscillator();
            lfo.frequency.value = voice.vibrato.rate;
            const depth = ctx.createGain();
            depth.gain.value = hz(e.midi) * voice.vibrato.depth;
            lfo.connect(depth).connect(o.frequency);
            lfo.start(t);
            lfo.stop(t + e.dur + 0.1);
          } else if (e.dur > 0.3) {
            // A touch of delayed vibrato on held notes.
            const lfo = ctx.createOscillator();
            lfo.frequency.value = 5.5;
            const depth = ctx.createGain();
            depth.gain.setValueAtTime(0, t);
            depth.gain.linearRampToValueAtTime(hz(e.midi) * 0.012, t + 0.3);
            lfo.connect(depth).connect(o.frequency);
            lfo.start(t);
            lfo.stop(t + e.dur + 0.1);
          }
          const brass = voice.lead === 'brass';
          const g = envGain(t, (brass ? 0.26 : voice.lead === 'organ' ? 0.36 : 0.32) * e.vel, brass ? 0.03 : voice.lead === 'organ' ? 0.015 : 0.006, e.dur, 0.02);
          if (brass) {
            // Brass: the tone opens up as the note swells, then settles.
            const f = ctx.createBiquadFilter();
            f.type = 'lowpass';
            f.Q.value = 2;
            f.frequency.setValueAtTime(500, t);
            f.frequency.linearRampToValueAtTime(3600, t + 0.06);
            f.frequency.setTargetAtTime(1800, t + 0.06, 0.15);
            o.connect(f).connect(g);
          } else o.connect(g);
          g.connect(leadOut);
          g.connect(echoIn);
          o.start(t);
          o.stop(t + e.dur + 0.15);
          break;
        }
        case 'arp': {
          const o = ctx.createOscillator();
          o.setPeriodicWave(pulse125);
          o.frequency.value = hz(e.midi);
          const g = envGain(t, 0.12 * e.vel, 0.003, e.dur, 0.01);
          o.connect(g).connect(arpOut);
          o.start(t);
          o.stop(t + e.dur + 0.06);
          break;
        }
      }
    }
    return ctx.startRendering();
  }

  return { SONGS, build, toAnalysis, render, keyFor: (song) => 'pack:' + song.id };
});
