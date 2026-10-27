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
      tier: 'rookie',
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
      tier: 'pro',
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
      tier: 'boss',
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
      tier: 'rookie',
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
      tier: 'pro',
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
    {
      id: 'witching-hour',
      theme: 'spooky',
      tier: 'boss',
      title: 'Witching Hour',
      blurb: 'Midnight strikes: a racing pipe organ and thundering timpani.',
      bpm: 172,
      root: 61,
      scale: 'harmonic',
      prog: [0, 5, 3, 4],
      voice: { lead: 'organ', vibrato: { rate: 7, depth: 0.014 }, echo: { steps: 3, fb: 0.4, wet: 0.35 }, toms: 'timpani' },
      drums: {
        intro: { t: 'x...x...x...x.x.', k: 'x.......x.......' },
        verse: { k: 'x.x...x.x.x...x.', s: '....x.......x...', h: 'x.xxx.xxx.xxx.xx' },
        chorus: { k: 'x.x.x.x.x.x.x.x.', s: '....x.......x..x', o: 'x...x...x...x...', t: '..............xx' },
        brk: { k: 'x.......x.......', t: 'x..x..x.x..x..x.' },
        fill: { k: 'x.x.............', s: '....x.x.xxxxxxxx', t: 'x.x.x.x.........' },
      },
      bass: {
        verse: '0.00.00.0.00.07.',
        chorus: '0.0.0.0.7.7.4.4.',
        brk: '0-------7-------',
      },
      lead: {
        intro: ['0---2---4---7---', '6---4---2---1---'],
        verse: ['7.6.4.6.7.9.a.9.', '7.6.4.2.1.2.4...', '7.6.4.6.7.9.b.a.', '9.7.6.4.6---7...'],
        chorus: ['e.d.c.b.c.b.a.9.', 'a.9.8.7.8.9.a.b.', 'c.b.a.9.a.b.c.d.', 'e-d-c-b-a---7---'],
        brk: ['7-------6-------', '4-------2-------', '1-------2-------', '4-------6-------'],
        outro: ['e-c-a-7-4-2-1---', '0---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'brk', lead: 'intro', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },
    // ---- Rock ----
    {
      id: 'garage-jam',
      theme: 'rock',
      tier: 'rookie',
      title: 'Garage Jam',
      blurb: 'Plug in and stomp along: a simple, chunky first riff.',
      bpm: 104,
      root: 64,
      scale: 'minor',
      prog: [0, 0, 3, 4],
      voice: { lead: 'square', echo: { steps: 4, fb: 0.3, wet: 0.25 }, toms: 'tom' },
      drums: {
        intro: { k: 'x.......x.......', h: 'x...x...x...x...' },
        verse: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        chorus: { k: 'x.......x.x.....', s: '....x.......x...', o: 'x...x...x...x...', h: '..x...x...x...x.' },
        fill: { k: 'x...............', s: '....x...x...x...', t: '........x...x...' },
      },
      bass: {
        verse: '0...0...0...0.7.',
        chorus: '0.0.0.0.7.7.4.4.',
      },
      gtr: {
        intro: 'o---------------',
        verse: 'x.x.x.x.x.x.x.x.',
        chorus: 'o---x.x.o---x.x.',
      },
      lead: {
        verse: ['7---7-9-a---9---', '7---6-4-7-------', '7---7-9-a---b---', 'a---9---7-------'],
        chorus: ['b---b-a-9---a---', '9---9-7-6---7---', 'b---b-c-d---c---', 'b---a---9-------'],
        outro: ['7-------4-------', '0---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'verse', gtr: 'intro', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', gtr: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', gtr: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 8, drums: 'verse', bass: 'verse', gtr: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', gtr: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'verse', bass: 'verse', gtr: 'verse', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'power-chord-party',
      tier: 'pro',
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
      tier: 'boss',
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
      tier: 'rookie',
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
      tier: 'pro',
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
    {
      id: 'dragons-lair',
      theme: 'epic',
      tier: 'boss',
      title: "Dragon's Lair",
      blurb: 'The final boss wakes: blazing brass and pounding drums.',
      bpm: 172,
      root: 62,
      scale: 'harmonic',
      prog: [0, 3, 5, 4],
      voice: { lead: 'brass', vibrato: { rate: 6, depth: 0.008 }, echo: { steps: 3, fb: 0.35, wet: 0.3 }, toms: 'timpani' },
      drums: {
        intro: { k: 'x.......x.......', t: 'x.x.x.x.xxxxxxxx' },
        verse: { k: 'x.....x.x.....x.', s: '....x.......x...', h: 'x.xxx.xxx.xxx.xx' },
        chorus: { k: 'x.x...x.x.x...x.', s: '....x.......x..x', o: 'x...x...x...x...', h: '.x.x.x.x.x.x.x.x', t: 'x.......x.......' },
        brk: { k: 'x...x...x...x...', t: 'x..x..x.x..x..x.' },
        fill: { k: 'x.x.x.x.........', s: '........xxxxxxxx', t: 'xxxx............' },
      },
      bass: {
        verse: '0...0.0.0...0.7.',
        chorus: '0...0.0.4...4.7.',
        brk: '0...0...0...0...',
      },
      lead: {
        intro: ['7---7---7-9-a---', 'b---a---9---7---'],
        verse: ['7.9.a.b.a---9-7-', 'a.b.c.b.a.9.a.b.', 'c.b.a.9.a---7-6-', '7.6.4.6.7---9...'],
        chorus: ['e---e-d-c---b---', 'c---c-b-a---9---', 'a-b-c-d-e---d---', 'c-b-a-9-7-------'],
        brk: ['7.7.7.7.9.9.9.9.', 'a.a.a.a.b.b.b.b.', 'c.c.c.c.d.d.d.d.', 'e---------------'],
        outro: ['e-d-c-b-a-9-7---', '7---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'brk', lead: 'intro', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },
    // ---- Space ----
    {
      id: 'starlight-drift',
      theme: 'space',
      tier: 'rookie',
      title: 'Starlight Drift',
      blurb: 'Float past the planets on a dreamy, twinkling cruise.',
      bpm: 108,
      root: 65,
      scale: 'major',
      prog: [0, 5, 3, 4],
      voice: { lead: 'synth', arp: 'bell', echo: { steps: 6, fb: 0.45, wet: 0.4 }, toms: 'tom' },
      drums: {
        intro: { h: 'x...x...x...x...' },
        verse: { k: 'x.......x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        chorus: { k: 'x.......x.x.....', s: '....x.......x...', o: '..x...x...x...x.' },
        drift: { k: 'x...............', h: '....x.......x...' },
        fill: { k: 'x...x...........', s: '........x.x.x.x.', t: '....x.x.........' },
      },
      bass: {
        verse: '0...0...4...0.7.',
        chorus: '0.0.4.0.7.0.4.2.',
        drift: '0---------------',
      },
      lead: {
        verse: ['4---5-4-2---0---', '2---4-5-7-------', '9---7-5-4---5---', '4---2---1-------'],
        chorus: ['7---9-7-b---9---', 'a---9-7-5---7---', '7---9-b-c---b---', 'a---9---7-------'],
        drift: ['b-------9-------', 'a-------7-------', '9-------b-------', 'c---------------'],
        outro: ['7-------4-------', '0---------------'],
      },
      form: [
        { bars: 2, drums: 'intro', bass: 'drift', arp: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'drift', bass: 'drift', lead: 'drift', arp: true, crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'warp-speed',
      theme: 'space',
      tier: 'pro',
      title: 'Warp Speed',
      blurb: 'Engage! A bold voyage to where no song has gone before.',
      bpm: 140,
      root: 62,
      scale: 'major',
      prog: [0, 5, 3, 4],
      voice: { lead: 'synth', arp: 'bell', echo: { steps: 3, fb: 0.4, wet: 0.35 }, toms: 'timpani' },
      drums: {
        intro: { k: 'x.......x.......', t: '............x.x.' },
        drive: { k: 'x.....x...x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        chorus: { k: 'x...x...x...x...', s: '....x.......x..x', o: '..x...x...x...x.' },
        brk: { k: 'x...............', h: '....x.......x...' },
        fill: { k: 'x...x...x...x...', s: '....x...x.x.x.xx', t: '' },
      },
      bass: {
        drive: '0.0.0.0.0.0.0.7.',
        chorus: '0.0.4.0.7.0.4.0.',
        brk: '0---------------',
      },
      lead: {
        intro: ['0-------3-------', '7---------------'],
        verse: ['0---3---7---9-8-', '7-------4---5---', '0---3---7---a-b-', 'c-------9-------'],
        chorus: ['7.7.9.a.b---a-9-', '7.7.9.a.c---b---', 'b.a.9.7.9.a.b.c.', 'e---c---b---9---'],
        brk: ['7-------9-------', 'b-------a-------', '9-------7-------', '4---------------'],
        outro: ['7---9---b---c---', 'e---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'brk', lead: 'intro', arp: true },
        { bars: 8, drums: 'drive', bass: 'drive', lead: 'verse', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', arp: true, crash: true },
        { bars: 8, drums: 'drive', bass: 'drive', lead: 'verse', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true },
        { bars: 4, drums: 'drive', bass: 'drive', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'galactic-showdown',
      theme: 'space',
      tier: 'boss',
      title: 'Galactic Showdown',
      blurb: 'Starfighters scramble: blazing brass and a battle across the stars.',
      bpm: 168,
      root: 62,
      scale: 'harmonic',
      prog: [0, 5, 3, 4],
      voice: { lead: 'brass', arp: 'bell', vibrato: { rate: 6, depth: 0.007 }, echo: { steps: 3, fb: 0.4, wet: 0.35 }, toms: 'timpani' },
      drums: {
        intro: { t: 'x...x...x...x.x.', k: 'x.......x.......' },
        verse: { k: 'x.x...x.x.x...x.', s: '....x.......x...', h: 'x.xxx.xxx.xxx.xx' },
        chorus: { k: 'x.x.x.x.x.x.x.x.', s: '....x.......x..x', o: 'x...x...x...x...', t: '..............xx' },
        brk: { k: 'x.......x.......', t: 'x..x..x.x..x..x.' },
        fill: { k: 'x.x.............', s: '....x.x.xxxxxxxx', t: 'x.x.x.x.........' },
      },
      bass: {
        verse: '0.00.00.0.00.07.',
        chorus: '0.0.0.0.7.7.4.4.',
        brk: '0-------7-------',
      },
      lead: {
        intro: ['0---4---7---e---', 'd---b---9---7---'],
        verse: ['0.2.4.7.6.4.2.4.', '7.9.a.9.7.6.4...', '0.2.4.7.9.a.b.a.', '9.7.6.4.6---7...'],
        chorus: ['e---d-c-b---7---', 'c---b-a-9---7---', 'a-b-c-d-e---d-c-', 'b---9---7-------'],
        brk: ['7.7.7.7.6.6.6.6.', '4.4.4.4.2.2.2.2.', '1.1.1.1.2.2.2.2.', '4---6---7-------'],
        outro: ['e-d-b-9-7-6-4---', '7---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'brk', lead: 'intro', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', arp: true, crash: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },

    // ---- Carnival ----
    // Calliope melodies are chromatic (each character counts semitones above the root),
    // for the sliding circus runs.
    {
      id: 'big-top-parade',
      theme: 'carnival',
      tier: 'rookie',
      title: 'Big Top Parade',
      blurb: 'Roll up, roll up! A steam calliope leads the circus into town.',
      bpm: 112,
      root: 60,
      scale: 'major',
      leadScale: 'chromatic',
      prog: [0, 3, 4, 0],
      voice: { lead: 'calliope', vibrato: { rate: 7, depth: 0.018 }, echo: { steps: 2, fb: 0.25, wet: 0.2 }, toms: 'tom' },
      drums: {
        intro: { k: 'x.......x.......', s: '....x.......x...' },
        march: { k: 'x.......x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        chorus: { k: 'x.......x.x.....', s: '....x.......x...', o: '..x...x...x...x.' },
        brk: { k: 'x.......x.......', t: '....x.......x...' },
        fill: { k: 'x...............', s: '....x...x.x.x.x.' },
      },
      bass: {
        march: '0...4...0...4...',
        chorus: '0...4...0...4.7.',
        brk: '0-------4-------',
      },
      lead: {
        verse: ['0---4---7-6-7---', '9---5---9-8-9---', 'b---7---2---7---', 'c-------7-------'],
        chorus: ['7.4.7.c.b.c.7...', '9.5.9.c.b.a.9...', 'b.7.b.e.d.e.b...', 'c-------0-------'],
        brk: ['c-------b-a-9---', '9-------8-7-6---', '7-------6-5-4---', '0---------------'],
        outro: ['7-6-5-4-3-2-1---', '0---------------'],
      },
      form: [
        { bars: 2, drums: 'intro', bass: 'march' },
        { bars: 8, drums: 'march', bass: 'march', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'march', bass: 'march', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'march', bass: 'march', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'clown-car-chaos',
      theme: 'carnival',
      tier: 'pro',
      title: 'Clown Car Chaos',
      blurb: 'Honk honk! Twenty clowns tumble out, sliding up and down the scale.',
      bpm: 138,
      root: 65,
      scale: 'major',
      leadScale: 'chromatic',
      prog: [0, 5, 3, 4],
      voice: { lead: 'calliope', vibrato: { rate: 7.5, depth: 0.016 }, echo: { steps: 2, fb: 0.25, wet: 0.2 }, toms: 'tom' },
      drums: {
        intro: { k: 'x.......x.......', s: '....x.......x...', h: 'x.xx.xx.x.xx.xx.' },
        verse: { k: 'x.......x.......', s: '....x.......x...', h: 'x.xx.xx.x.xx.xx.' },
        chorus: { k: 'x...x...x...x...', s: '....x..x....x...', o: '..x...x...x...x.' },
        brk: { k: 'x...............', t: 'x..x..x..x..x...' },
        fill: { k: 'x.......x.......', s: '....x...x.x.xxxx', t: 'x.x.............' },
      },
      bass: {
        verse: '0.4.0.4.0.4.0.4.',
        chorus: '0.0.4.4.0.0.4.4.',
        brk: '0---------------',
      },
      lead: {
        verse: ['7.6.7.4.0.4.7...', '9.8.9.4.0.4.9...', '9.a.9.5.2.5.9...', '7.8.9.a.b.c.7...'],
        chorus: ['c.b.c.7.4.7.c...', 'c.b.c.9.4.9.c...', '9.8.9.5.2.5.9...', 'e.d.c.b.a.9.8.7.'],
        brk: ['7-------6-------', '5-------4-------', '5-------6-------', '7---------------'],
        outro: ['c.b.a.9.8.7.6.5.', '0---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'verse' },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'ringmasters-gallop',
      theme: 'carnival',
      tier: 'boss',
      title: "Ringmaster's Gallop",
      blurb: 'The grand finale: a breakneck circus galop with runaway runs.',
      bpm: 172,
      root: 67,
      scale: 'major',
      leadScale: 'chromatic',
      prog: [0, 3, 4, 0],
      voice: { lead: 'calliope', vibrato: { rate: 8, depth: 0.014 }, echo: { steps: 2, fb: 0.2, wet: 0.18 }, toms: 'tom' },
      drums: {
        intro: { k: 'x...x...x...x...', s: '..x...x...x...x.' },
        verse: { k: 'x.....x.x.....x.', s: '....x.......x...', h: 'x.xxx.xxx.xxx.xx' },
        chorus: { k: 'x.x...x.x.x...x.', s: '....x.......x..x', o: 'x...x...x...x...', h: '.x.x.x.x.x.x.x.x' },
        brk: { k: 'x...x...x...x...', t: 'x..x..x.x..x..x.' },
        fill: { k: 'x.x.x.x.........', s: '........xxxxxxxx', t: 'xxxx............' },
      },
      bass: {
        verse: '0.4.0.4.0.4.0.4.',
        chorus: '0.4.0.4.0.4.7.4.',
        brk: '0---4---0---4---',
      },
      lead: {
        intro: ['0.4.7.c.0.4.7.c.', 'b.a.9.8.7.6.5.4.'],
        verse: ['c.b.a.9.8.7.6.7.', '9.8.9.5.9.8.9.c.', 'b.a.9.7.2.7.b.e.', 'c---7---4---0---'],
        chorus: ['0.4.7.c.0.4.7.c.', '5.9.c.e.5.9.c.e.', '7.b.e.b.7.b.e.c.', 'c.b.a.9.8.7.6.5.'],
        brk: ['7.7.7.7.6.6.6.6.', '5.5.5.5.4.4.4.4.', '3.3.3.3.2.2.2.2.', '1.1.1.1.0.0.0.0.'],
        outro: ['c.b.a.9.8.7.6.5.', '0---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'brk', lead: 'intro', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },

    // ---- Salsa ----
    // Clave (c) keeps the Latin pulse; congas (g) answer it; a bright piano plays the montunos.
    {
      id: 'cafe-cha-cha',
      theme: 'salsa',
      tier: 'rookie',
      title: 'Café Cha-Cha',
      blurb: 'One, two, cha-cha-cha! An easy Latin step to warm up the dance floor.',
      bpm: 112,
      root: 62,
      scale: 'harmonic',
      prog: [0, 3, 4, 4],
      voice: { lead: 'piano', echo: { steps: 3, fb: 0.25, wet: 0.2 }, toms: 'tom' },
      drums: {
        intro: { c: 'x..x..x...x.x...' },
        verse: { k: 'x.......x.......', c: 'x..x..x...x.x...', g: '....x.......x.x.' },
        chorus: { k: 'x.......x.......', c: 'x..x..x...x.x...', g: '..x.x...x.x.X.x.', h: 'x...x...x...x...' },
        brk: { k: 'x...............', g: '..x.x...X.x.x...' },
        fill: { k: 'x...x...........', t: '....x.x.x.x.x.x.' },
      },
      bass: {
        verse: '0.......4...4.4.',
        chorus: '0...0...4...4.4.',
        brk: '0---------------',
      },
      lead: {
        verse: ['7---4---2-4-5---', '3---5---7-5-3---', '6---4---1-4-6---', '4-------4-6-7---'],
        chorus: ['b.a.9.7.9---7---', 'a.9.a.c.a---7---', '8.6.8.b.8---6---', '7---6---4-------'],
        brk: ['7-------4-------', '5-------3-------', '6-------4-------', '7---------------'],
        outro: ['7-4-2-0-4-------', '0---------------'],
      },
      form: [
        { bars: 2, drums: 'intro', bass: 'verse' },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'conga-line',
      theme: 'salsa',
      tier: 'pro',
      title: 'Conga Line',
      blurb: 'Everybody join in! Rolling congas and a piano that never stops moving.',
      bpm: 140,
      root: 57,
      scale: 'harmonic',
      prog: [0, 3, 4, 0],
      voice: { lead: 'piano', echo: { steps: 3, fb: 0.25, wet: 0.2 }, toms: 'tom' },
      drums: {
        intro: { c: 'x..x..x...x.x...', g: 'x.x..xx.x.x..xx.' },
        verse: { k: 'x..x....x..x....', c: 'x..x..x...x.x...', g: '....x.x.....x.X.' },
        chorus: { k: 'x..x....x..x....', s: '....x.......x...', c: 'x..x..x...x.x...', g: '..x.x.X...x.x.X.', o: 'x...x...x...x...' },
        brk: { c: 'x..x..x...x.x...', g: 'x.xX.xx.xXx.x.xX' },
        fill: { k: 'x...x...x.......', t: 'x.x.x.x.xxxxxxxx' },
      },
      bass: {
        verse: '0..0..4.0..0..4.',
        chorus: '0.0.4.4.0.0.4.4.',
        brk: '0-------4-------',
      },
      lead: {
        verse: ['4.7.9.7.4.7.9.7.', '5.7.a.7.5.7.a.7.', '6.8.b.8.6.8.b.8.', '7.9.b.9.7---4---'],
        chorus: ['b---a-9-7-9-b---', 'c---b-a-7-a-c---', 'd---b-8-6-8-b---', 'b-a-9-8-7-------'],
        brk: ['7-------9-------', 'a-------9-------', '8-------6-------', '7---------------'],
        outro: ['b.9.7.4.7.9.b---', '7---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'brk' },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'fuego-mambo',
      theme: 'salsa',
      tier: 'boss',
      title: 'Fuego Mambo',
      blurb: 'The dance floor is on fire: a blazing mambo with racing piano and timbales.',
      bpm: 172,
      root: 62,
      scale: 'harmonic',
      prog: [0, 3, 4, 0],
      voice: { lead: 'piano', echo: { steps: 3, fb: 0.25, wet: 0.2 }, toms: 'tom' },
      drums: {
        intro: { c: 'x..x..x...x.x...', t: 'x.x.x.x.xxxxxxxx' },
        verse: { k: 'x.....x.x.....x.', s: '....x.......x...', c: 'x..x..x...x.x...', g: '.x.x.x.x.x.x.x.x' },
        chorus: { k: 'x.x...x.x.x...x.', s: '....x.......x..x', c: 'x..x..x...x.x...', o: 'x...x...x...x...', g: '.x.x.x.x.x.x.x.x' },
        brk: { k: 'x...x...x...x...', t: 'x..x..x.x..x..x.' },
        fill: { k: 'x.x.x.x.........', s: '........xxxxxxxx', t: 'xxxx............' },
      },
      bass: {
        verse: '0...0.0.0...0.7.',
        chorus: '0...0.0.4...4.7.',
        brk: '0...0...0...0...',
      },
      lead: {
        intro: ['0.4.7.4.0.4.7.4.', '6.4.6.8.b-------'],
        verse: ['7.9.b.9.7.9.b.9.', 'a.c.e.c.a.c.e.c.', '8.b.d.b.8.6.4.6.', '7---4---7-------'],
        chorus: ['e---d-c-b---9---', 'e---c-a-c---a---', 'd---b-8-b---d---', 'e---------------'],
        brk: ['7.7.7.7.9.9.9.9.', 'a.a.a.a.9.9.9.9.', '8.8.8.8.6.6.6.6.', '7---------------'],
        outro: ['e-c-b-9-7-4-0---', '7---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'brk', lead: 'intro', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },

    // ---- Hip hop ----
    // Booming 808 bass under hard-hitting drums, with a mellow electric piano on top.
    {
      id: 'block-party',
      theme: 'hiphop',
      tier: 'rookie',
      title: 'Block Party',
      blurb: 'Heads nodding on the corner: a laid-back boom-bap groove.',
      bpm: 88,
      root: 57,
      scale: 'minor',
      prog: [0, 5, 3, 4],
      voice: { lead: 'keys', bass: '808', echo: { steps: 6, fb: 0.35, wet: 0.3 }, toms: 'tom' },
      drums: {
        intro: { k: 'x......x..x.....', h: 'x.x.x.x.x.x.x.x.' },
        verse: { k: 'x......x..x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        chorus: { k: 'x......x..x.....', s: '....x.......x...', h: 'x.xxx.x.x.xxx.x.' },
        brk: { k: 'x...............', s: '....x.......x...' },
        fill: { k: 'x..x..x.........', s: '....x..x.x.xxxx.' },
      },
      bass: {
        verse: '0-------0-----7-',
        chorus: '0-----0-0---4---',
        brk: '0---------------',
      },
      lead: {
        verse: ['4---2---0-------', '5---4---2-------', '3---5---7---5---', '4-------6-------'],
        chorus: ['7-7-9---7---4---', '7-7-9---a---9---', '8-7-5---3---5---', '7---6---4-------'],
        brk: ['0-------2-------', '3-------2-------', '0-------5-------', '4---------------'],
        outro: ['7---4---2---0---', '0---------------'],
      },
      form: [
        { bars: 2, drums: 'intro', bass: 'verse' },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 2, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 2, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'cipher-session',
      theme: 'hiphop',
      tier: 'pro',
      title: 'Cipher Session',
      blurb: 'Pass the mic: crisp drums, rolling hats and a bouncing 808.',
      bpm: 130,
      root: 62,
      scale: 'minor',
      prog: [0, 3, 5, 4],
      voice: { lead: 'keys', bass: '808', echo: { steps: 3, fb: 0.35, wet: 0.3 }, toms: 'tom' },
      drums: {
        intro: { k: 'x.....x.x.x.....', h: 'x.x.x.x.x.x.x.x.' },
        verse: { k: 'x..x..x.x.x..x..', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' },
        chorus: { k: 'x.xx..x.x.xx.x..', s: '....x..x....x...', h: 'x.xxx.xxx.xxx.xx', o: '..x...........x.' },
        brk: { k: 'x.......x.......', s: '....x.......x...' },
        fill: { k: 'x.x.x.x.........', s: '....x...x.x.xxxx' },
      },
      bass: {
        verse: '0-0-0---0-0-4-4-',
        chorus: '0-0-0-0-4-4-4-7-',
        brk: '0-------4-------',
      },
      lead: {
        verse: ['7.7.4.5.7---4---', '8.8.7.5.3---5---', '9.9.8.7.5---7---', '8.7.5.4.7-------'],
        chorus: ['b.a.9.7.9---7---', 'a.9.7.5.7---a---', 'c.b.9.8.9---b---', 'b---a---9---7---'],
        brk: ['7-------5-------', '3-------5-------', '5-------9-------', '8---------------'],
        outro: ['b-9-7-4-0-------', '7---------------'],
      },
      form: [
        { bars: 2, drums: 'intro', bass: 'verse' },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'mic-drop',
      theme: 'hiphop',
      tier: 'boss',
      title: 'Mic Drop',
      blurb: 'The final battle: a hard trap beat with rapid-fire hats and a sliding 808.',
      bpm: 165,
      root: 60,
      scale: 'minor',
      prog: [0, 5, 3, 4],
      voice: { lead: 'keys', bass: '808', echo: { steps: 3, fb: 0.3, wet: 0.25 }, toms: 'tom' },
      drums: {
        intro: { k: 'x.......x.......', h: 'x...x...x...x...' },
        verse: { k: 'x.x...x...x.xx..', s: '....x.......x...', h: 'x.x.x.xxx.x.x.xx' },
        chorus: { k: 'x.x...x...x.x...', s: '....x.......x...', h: 'xxxxxxxxx.x.xxxx', o: '..............x.' },
        brk: { k: 'x.......x.......', h: 'x...x...x...x...' },
        fill: { k: 'x.x.x.x.........', s: '....x...x.x.xxxx' },
      },
      bass: {
        verse: '0-0-0---0-0-7-7-',
        chorus: '0-0-0-0-4-4-7-4-',
        brk: '0---------------',
      },
      lead: {
        intro: ['7---5---4---3---', '4-------b-------'],
        verse: ['7.5.7.a.9.7.5.4.', '5.4.5.7.9.7.5.4.', '3.5.7.8.a.8.7.5.', '4.6.8.b.d---b---'],
        chorus: ['e---c-b-9---7---', 'c---b-9-7---5---', 'a---8-7-5---3---', 'b-a-9-8-b---d---'],
        brk: ['7.7.7.7.5.5.5.5.', '5.5.5.5.4.4.4.4.', '3.3.3.3.5.5.5.5.', '4---------------'],
        outro: ['e-c-b-9-7-5-4---', '7---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'brk', lead: 'intro', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', lead: 'chorus', crash: true },
        { bars: 4, drums: 'verse', bass: 'verse', lead: 'outro', crash: true },
      ],
    },
    // ---- Classical remix ----
    // Famous public-domain classics, rocked up: a harpsichord carries the tune over drums
    // and power chords. Melodies are written note for note (chromatic, from leadRoot).
    {
      id: 'joyful-ode',
      theme: 'classical',
      tier: 'rookie',
      title: 'Ode to Joy (Remix)',
      blurb: "Beethoven's Ninth gets a backbeat: the tune everyone knows.",
      bpm: 112,
      root: 62,
      scale: 'major',
      leadScale: 'chromatic',
      leadRoot: 57,
      prog: [0, 4, 0, 0],
      voice: { lead: 'harpsichord', echo: { steps: 4, fb: 0.3, wet: 0.28 }, toms: 'timpani' },
      drums: {
        intro: { k: 'x.......x.......', t: '............x.x.' },
        verse: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        chorus: { k: 'x.....x.x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '..............x.' },
        brk: { k: 'x.......x.......', t: '....x...x...x.x.' },
        fill: { k: 'x.......x.......', t: '........x.x.x.x.' },
      },
      bass: {
        verse: '0...0...4...4.2.',
        chorus: '0.0.0.0.4.4.4.2.',
        brk: '0-------4-------',
      },
      gtr: {
        verse: 'o-----x.o-----x.',
        chorus: 'o---x.x.o---x.x.',
      },
      lead: {
        intro: ['5-------7-------', '9-------7-------'],
        verse: ['9---9---a---c---', 'c---a---9---7---', '5---5---7---9---', '9-----7-7-------',
          '9---9---a---c---', 'c---a---9---7---', '5---5---7---9---', '7-----5-5-------'],
        chorus: ['7---7---9---5---', '7---9-a-9---5---', '7---9-a-9---7---', '5---7---0-------',
          '9---9---a---c---', 'c---a---9---7---', '5---5---7---9---', '7-----5-5-------'],
        brk: ['5-------9-------', 'c-------9-------', '7-------4-------', '7---------------'],
        outro: ['9---7---5-------', '5---------------'],
      },
      form: [
        { bars: 4, drums: 'intro', bass: 'brk', lead: 'intro', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', gtr: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', gtr: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', gtr: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', gtr: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'verse', bass: 'verse', gtr: 'verse', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'elise-rocks',
      theme: 'classical',
      tier: 'pro',
      title: 'Für Elise Rocks',
      blurb: "Beethoven's famous piano piece, plugged in and turned up.",
      bpm: 138,
      root: 57,
      scale: 'harmonic',
      leadScale: 'chromatic',
      leadRoot: 64,
      prog: [0, 4, 0, 4],
      voice: { lead: 'harpsichord', echo: { steps: 3, fb: 0.3, wet: 0.25 }, toms: 'tom' },
      drums: {
        intro: { h: 'x.x.x.x.x.x.x.x.' },
        verse: { k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        chorus: { k: 'x.x...x.x.x...x.', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '..............x.' },
        brk: { k: 'x.......x.......', t: '....x.......x.x.' },
        fill: { k: 'x...............', s: '....x...x.x.xxxx', t: 'x.x.............' },
      },
      bass: {
        verse: '0.0.0.0.4.4.4.4.',
        chorus: '0.00.00.4.44.44.',
        brk: '0-------4-------',
      },
      gtr: {
        verse: 'x.x.x.x.o---o---',
        chorus: 'o---x.x.o---x.x.',
        brk: 'o---------------',
      },
      lead: {
        intro: ['cbcbc7a85-------', '7-------0-------'],
        verse: ['cbcbc7a85---0-5-', '7---0-4-7-8-----', 'cbcbc7a85---0-5-', '7---0-8-7-5-----'],
        chorus: ['7-8-a-c---3-d-c-', 'a---1-c-a-8---0-', 'a-8-7---0-c---c-', 'cbcbc7a85-------'],
        brk: ['5-------8-------', '7-------4-------', '5-------c-------', 'b---------------'],
        outro: ['cbcbc7a85-------', '5---------------'],
      },
      form: [
        { bars: 2, drums: 'intro', lead: 'intro' },
        { bars: 8, drums: 'verse', bass: 'verse', gtr: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', gtr: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'brk', bass: 'brk', gtr: 'brk', lead: 'brk', crash: true },
        { bars: 8, drums: 'verse', bass: 'verse', gtr: 'verse', lead: 'verse', crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', gtr: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 8, drums: 'chorus', bass: 'chorus', gtr: 'chorus', lead: 'chorus', arp: true, crash: true, fill: true },
        { bars: 4, drums: 'verse', bass: 'verse', gtr: 'verse', lead: 'outro', crash: true },
      ],
    },
    {
      id: 'mountain-king',
      theme: 'classical',
      tier: 'boss',
      title: 'Hall of the Mountain King',
      blurb: "Grieg's trolls creep in, then the tempo climbs and climbs: hang on!",
      bpm: 126,
      root: 59,
      scale: 'harmonic',
      leadScale: 'chromatic',
      leadRoot: 59,
      prog: [0, 4, 0, 4],
      voice: { lead: 'harpsichord', echo: { steps: 3, fb: 0.3, wet: 0.25 }, toms: 'timpani' },
      drums: {
        creep: { k: 'x...x...x...x...', h: 'x.x.x.x.x.x.x.x.', t: '....x.......x...' },
        march: { k: 'x...x.x.x...x.x.', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        charge: { k: 'x.x.x.x.x.x.x.x.', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '..............x.', t: 'x.......x.......' },
        frenzy: { k: 'xxx.x.xxx.x.x.xx', s: '....x..x....x..x', o: 'x...x...x...x...', h: '.x.x.x.x.x.x.x.x', t: 'x.......x.......' },
        fill: { k: 'x.x.x.x.........', s: '........xxxxxxxx', t: 'xxxx............' },
      },
      bass: {
        creep: '0.......4.......',
        march: '0.0.0.0.4.4.4.4.',
        charge: '0.0.0.0.4.4.4.4.',
      },
      gtr: {
        march: 'x.x.x.x.x.x.x.x.',
        charge: 'x.x.x.x.o---o---',
      },
      lead: {
        // The theme, then the same tune up on F#, as Grieg writes it.
        theme: ['0.2.3.5.7.3.7---', '6.2.6---5.1.5---', '0.2.3.5.7.3.7.c.', 'a.7.3.7.a-------',
          '7.9.b.c.e.b.e---', 'd.a.d---e.b.e---', '7.9.b.c.e.b.e.c.', 'e.c.a.7.c-------'],
        // Double time: the same tune twice as fast.
        rush: ['02357.7.6262515.', '02357.7ca737a...', '79bceb.edade.be.', '79bceb.ec.a.7.c.'],
        outro: ['c.c.c.c.c.c.c.c.', 'c---------------'],
      },
      form: [
        { bars: 8, drums: 'creep', bass: 'creep', lead: 'theme', bpm: 126 },
        { bars: 8, drums: 'march', bass: 'march', gtr: 'march', lead: 'theme', crash: true, fill: true, bpm: 140 },
        { bars: 8, drums: 'march', bass: 'march', gtr: 'march', lead: 'theme', crash: true, fill: true, bpm: 156 },
        { bars: 8, drums: 'charge', bass: 'charge', gtr: 'charge', lead: 'theme', crash: true, fill: true, bpm: 172 },
        { bars: 8, drums: 'charge', bass: 'charge', gtr: 'charge', lead: 'rush', crash: true, fill: true, bpm: 184 },
        { bars: 8, drums: 'frenzy', bass: 'charge', gtr: 'charge', lead: 'rush', arp: true, crash: true, fill: true, bpm: 196 },
        { bars: 8, drums: 'frenzy', bass: 'charge', gtr: 'charge', lead: 'rush', arp: true, crash: true, fill: true, bpm: 208 },
        { bars: 4, drums: 'frenzy', bass: 'charge', gtr: 'charge', lead: 'outro', crash: true, bpm: 208 },
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
    clave: [0.5, [0, 0, 0.3, 1, 0.4]],
    conga: [0.7, [0.3, 1, 0.5, 0.1, 0]],
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
    const events = [];
    const beats = [];
    let bar = 0;
    // A section can set its own tempo (a song that speeds up): time restarts from where
    // the tempo last changed, so songs at one tempo keep exactly the same timings.
    let base = LEAD_IN, baseBar = 0, step = 60 / song.bpm / 4;
    for (const sec of song.form) {
      const st = 60 / (sec.bpm || song.bpm) / 4;
      if (st !== step) { base += (bar - baseBar) * 16 * step; baseBar = bar; step = st; }
      for (let b = 0; b < sec.bars; b++, bar++) {
        const chord = song.prog[bar % song.prog.length];
        const barT = base + (bar - baseBar) * 16 * step;
        for (let i = 0; i < 4; i++) beats.push(+(barT + i * 4 * step).toFixed(4));
        const isFill = sec.fill && b === sec.bars - 1;
        const kit = song.drums[isFill ? 'fill' : sec.drums] || {};
        if (sec.crash && b === 0) events.push({ t: barT, inst: 'crash', vel: 1 });
        for (const [inst, key] of [['kick', 'k'], ['snare', 's'], ['hat', 'h'], ['ohat', 'o'], ['tom', 't'], ['clave', 'c'], ['conga', 'g']]) {
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
            // Chromatic melodies count semitones above the root (or leadRoot, when the tune
          // starts below the key's tonic) instead of scale steps.
            const midi = song.leadScale === 'chromatic' ? (song.leadRoot || song.root) + d : degToMidi(song, d);
            events.push({ t: barT + i * step, inst: 'lead', midi, dur: holdLength(p, i) * step * 0.95, vel: 0.8 });
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
    const end = base + (bar - baseBar) * 16 * step;
    beats.push(+end.toFixed(4));
    events.push({ t: end, inst: 'crash', vel: 1 }, { t: end, inst: 'kick', vel: 1 });
    if (song.bass.verse || song.bass.chorus) {
      events.push({ t: end, inst: 'bass', midi: song.root - 12, dur: 1.2, vel: 0.9 });
    }
    events.sort((a, b) => a.t - b.t);
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
    // Bright piano (salsa montunos) and a mellow electric piano (hip hop keys).
    const piano = (() => {
      const amps = [0, 1, 0.55, 0.35, 0.22, 0.14, 0.09, 0.06, 0.04];
      return ctx.createPeriodicWave(new Float32Array(amps.length), Float32Array.from(amps));
    })();
    const epiano = (() => {
      const amps = [0, 1, 0.22, 0.06, 0.02, 0, 0, 0.05];
      return ctx.createPeriodicWave(new Float32Array(amps.length), Float32Array.from(amps));
    })();
    // Harpsichord (classical remix): a plucked string, bright with many overtones.
    const harpsichord = (() => {
      const amps = [0];
      for (let k = 1; k <= 16; k++) amps.push((k % 2 ? 1 : 0.7) / Math.pow(k, 0.75));
      return ctx.createPeriodicWave(new Float32Array(amps.length), Float32Array.from(amps));
    })();
    // Steam calliope: a whistle, nearly pure, with a little breathy edge.
    const calliope = (() => {
      const amps = [0, 1, 0.32, 0.14, 0.07, 0.035];
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
        case 'clave': {
          // Two hardwood sticks: a short, high, woody click.
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = 2400;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.5 * e.vel, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
          o.connect(g).connect(drumOut);
          o.start(t);
          o.stop(t + 0.08);
          break;
        }
        case 'conga': {
          // A hand drum: a round tone that dips in pitch, with a slap of skin. Accents ring higher.
          const o = ctx.createOscillator();
          o.type = 'sine';
          const f0 = e.vel >= 1 ? 330 : 240;
          o.frequency.setValueAtTime(f0 * 1.15, t);
          o.frequency.exponentialRampToValueAtTime(f0, t + 0.03);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.8 * e.vel, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
          o.connect(g).connect(drumOut);
          o.start(t);
          o.stop(t + 0.3);
          noiseHit(t, 'bandpass', 1800, 0.15 * e.vel, 0.025, drumOut);
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
          if (voice.bass === '808') {
            // Hip hop 808: a deep sine that drops into the note with a punchy start and a long tail.
            o.type = 'sine';
            o.frequency.setValueAtTime(hz(e.midi) * 2, t);
            o.frequency.exponentialRampToValueAtTime(hz(e.midi), t + 0.05);
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.55 * e.vel, t + 0.006);
            g.gain.exponentialRampToValueAtTime(0.2 * e.vel, t + Math.max(0.1, e.dur));
            g.gain.exponentialRampToValueAtTime(0.0001, t + e.dur + 0.12);
            o.connect(g).connect(master);
            o.start(t);
            o.stop(t + e.dur + 0.15);
            break;
          }
          o.type = 'triangle';
          o.frequency.value = hz(e.midi);
          const g = envGain(t, 0.75 * e.vel, 0.004, e.dur, 0.015);
          o.connect(g).connect(master);
          o.start(t);
          o.stop(t + e.dur + 0.1);
          break;
        }
        case 'lead': {
          if (voice.lead === 'synth') {
            // Space synth: two detuned saws through a resonant filter that glows open.
            const f = ctx.createBiquadFilter();
            f.type = 'lowpass';
            f.Q.value = 5;
            f.frequency.setValueAtTime(400, t);
            f.frequency.linearRampToValueAtTime(3200, t + 0.08);
            f.frequency.setTargetAtTime(1500, t + 0.08, 0.25);
            const g = envGain(t, 0.2 * e.vel, 0.012, e.dur, 0.05);
            for (const cents of [-7, 7]) {
              const o = ctx.createOscillator();
              o.type = 'sawtooth';
              o.frequency.value = hz(e.midi);
              o.detune.value = cents;
              o.connect(f);
              o.start(t);
              o.stop(t + e.dur + 0.25);
            }
            f.connect(g);
            g.connect(leadOut);
            g.connect(echoIn);
            break;
          }
          if (voice.lead === 'piano' || voice.lead === 'keys' || voice.lead === 'harpsichord') {
            // Struck notes: a quick attack, then the sound dies away as a piano's does.
            const harp = voice.lead === 'harpsichord';
            const o = ctx.createOscillator();
            o.setPeriodicWave(voice.lead === 'piano' ? piano : harp ? harpsichord : epiano);
            o.frequency.value = hz(e.midi);
            const g = ctx.createGain();
            const peak = (voice.lead === 'piano' ? 0.42 : harp ? 0.3 : 0.4) * e.vel;
            const ring = Math.max(0.12, e.dur);
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(peak, t + (harp ? 0.002 : 0.004));
            g.gain.exponentialRampToValueAtTime(peak * (voice.lead === 'piano' ? 0.25 : harp ? 0.3 : 0.45), t + ring);
            g.gain.exponentialRampToValueAtTime(0.0001, t + ring + 0.12);
            if (voice.lead === 'keys') {
              // Electric piano: a slow, gentle tremolo.
              const lfo = ctx.createOscillator();
              lfo.frequency.value = 4.5;
              const d = ctx.createGain();
              d.gain.value = peak * 0.15;
              lfo.connect(d).connect(g.gain);
              lfo.start(t);
              lfo.stop(t + ring + 0.15);
            }
            o.connect(g);
            g.connect(leadOut);
            g.connect(echoIn);
            o.start(t);
            o.stop(t + ring + 0.15);
            break;
          }
          const o = ctx.createOscillator();
          if (voice.lead === 'calliope') {
            o.setPeriodicWave(calliope);
            // The puff of steam as each whistle speaks.
            noiseHit(t, 'bandpass', Math.min(9000, hz(e.midi) * 3), 0.07 * e.vel, 0.05, leadOut);
          } else if (voice.lead === 'organ') o.setPeriodicWave(organ);
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
          const g = envGain(t, (brass ? 0.26 : voice.lead === 'organ' ? 0.36 : voice.lead === 'calliope' ? 0.34 : 0.32) * e.vel, brass ? 0.03 : voice.lead === 'organ' || voice.lead === 'calliope' ? 0.015 : 0.006, e.dur, 0.02);
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
          if (voice.arp === 'bell') {
            // Twinkling starfield: soft sine bells an octave up, ringing into the echo.
            const o = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.value = hz(e.midi + 12);
            const g = ctx.createGain();
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.09 * e.vel, t + 0.004);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
            o.connect(g);
            g.connect(arpOut);
            g.connect(echoIn);
            o.start(t);
            o.stop(t + 0.37);
            break;
          }
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
