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
  ];

  // Instrument fingerprints for charting: [strength, 5-band spectrum (low → high)].
  const CHART = {
    kick: [1.0, [1, 0.5, 0, 0, 0]],
    snare: [0.85, [0, 0.1, 1, 0.35, 0.15]],
    hat: [0.3, [0, 0, 0, 0.3, 1]],
    ohat: [0.45, [0, 0, 0, 0.4, 1]],
    crash: [1.0, [0.3, 0.2, 0.3, 0.6, 1]],
    bass: [0.5, [0.5, 1, 0.1, 0, 0]],
  };

  function validate(song) {
    const check = (s, where) => {
      if (s.length !== 16) throw new Error(`${song.id}: ${where} must be 16 steps, got ${s.length}`);
    };
    for (const [name, kit] of Object.entries(song.drums)) {
      for (const [inst, s] of Object.entries(kit)) if (s) check(s, `drums.${name}.${inst}`);
    }
    for (const [name, s] of Object.entries(song.bass)) check(s, `bass.${name}`);
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
        for (const [inst, key] of [['kick', 'k'], ['snare', 's'], ['hat', 'h'], ['ohat', 'o']]) {
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
      const g = groups.get(key) || { t: +key, s: 0, b: [0, 0, 0, 0, 0] };
      g.s = Math.max(g.s, strength * e.vel);
      // Weight by strength so quiet hats don't drag every note right; the melody
      // gets extra weight so lanes follow the tune when it lands on a drum hit.
      const w = (e.inst === 'lead' ? 1.4 : e.inst === 'kick' ? 0.8 : e.inst === 'bass' ? 0.3 : strength) * e.vel;
      for (let i = 0; i < 5; i++) g.b[i] += bands[i] * w;
      groups.set(key, g);
    }
    const onsets = [...groups.values()].sort((a, b) => a.t - b.t).map((g) => {
      const m = Math.max(...g.b) || 1;
      return { t: g.t, s: +Math.min(1, g.s).toFixed(3), b: g.b.map((x) => +(x / m).toFixed(2)) };
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

  async function render(built) {
    const sr = 44100;
    const ctx = new OfflineAudioContext(2, Math.ceil(sr * built.duration), sr);
    const step = 60 / built.song.bpm / 4;

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
    delay.delayTime.value = step * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2800;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
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
          o.setPeriodicWave(pulse25);
          o.frequency.value = hz(e.midi);
          // A touch of delayed vibrato on held notes.
          if (e.dur > 0.3) {
            const lfo = ctx.createOscillator();
            lfo.frequency.value = 5.5;
            const depth = ctx.createGain();
            depth.gain.setValueAtTime(0, t);
            depth.gain.linearRampToValueAtTime(hz(e.midi) * 0.012, t + 0.3);
            lfo.connect(depth).connect(o.frequency);
            lfo.start(t);
            lfo.stop(t + e.dur + 0.1);
          }
          const g = envGain(t, 0.32 * e.vel, 0.006, e.dur, 0.02);
          o.connect(g);
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
