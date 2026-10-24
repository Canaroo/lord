/*
 * Sfx — chiptune sound effects synthesised live (pulse, triangle, noise), plus
 * the music/effects volume buses the rest of the game plays through.
 */
'use strict';
(function (root) {
  let ctx = null;
  let musicBus = null;
  let sfxBus = null;
  // Song path: musicIn → lowpass (muffles in danger) → shelf (brightens in
  // overdrive) → dip (ducks on a miss) → musicBus (volume).
  let musicIn = null;
  let lowpass = null;
  let shelf = null;
  let dip = null;
  let previewBus = null;
  let noise = null;
  const waves = {};
  const volumes = { music: 0.9, sfx: 0.7 };

  function init(audioCtx) {
    if (ctx === audioCtx) return;
    ctx = audioCtx;
    musicBus = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus.connect(ctx.destination);
    sfxBus.connect(ctx.destination);
    musicIn = ctx.createGain();
    lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 20000;
    lowpass.Q.value = 0.7;
    shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 3200;
    shelf.gain.value = 0;
    dip = ctx.createGain();
    musicIn.connect(lowpass).connect(shelf).connect(dip).connect(musicBus);
    previewBus = ctx.createGain();
    previewBus.gain.value = 0.55;
    previewBus.connect(musicBus);
    setVolumes(volumes.music, volumes.sfx);
    noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    for (const duty of [0.125, 0.25, 0.5]) {
      const n = 24;
      const re = new Float32Array(n);
      const im = new Float32Array(n);
      for (let k = 1; k < n; k++) {
        const a = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
        re[k] = a * Math.cos(k * Math.PI * duty);
        im[k] = a * Math.sin(k * Math.PI * duty);
      }
      waves[duty] = ctx.createPeriodicWave(re, im);
    }
  }

  function setVolumes(music, sfx) {
    volumes.music = music;
    volumes.sfx = sfx;
    if (musicBus) musicBus.gain.value = music;
    if (sfxBus) sfxBus.gain.value = sfx * 0.6;
  }

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /** Play a sequence of [midi, durationSec] on a pulse or triangle voice. */
  function seq(notes, { duty = 0.25, gap = 0, vol = 0.3, at = 0, slide = 0 } = {}) {
    if (!ctx || ctx.state !== 'running') return;
    let t = Math.max(ctx.currentTime, at);
    for (const [m, d] of notes) {
      if (m != null) {
        const o = ctx.createOscillator();
        if (duty === 'tri') o.type = 'triangle';
        else o.setPeriodicWave(waves[duty]);
        o.frequency.setValueAtTime(hz(m), t);
        if (slide) o.frequency.exponentialRampToValueAtTime(hz(m + slide), t + d);
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.setValueAtTime(vol, t + d * 0.7);
        g.gain.linearRampToValueAtTime(0, t + d);
        o.connect(g).connect(sfxBus);
        o.start(t);
        o.stop(t + d + 0.01);
      }
      t += d + gap;
    }
  }

  function burst(decay, freq, vol = 0.3, type = 'highpass') {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    n.connect(f).connect(g).connect(sfxBus);
    n.start(t);
    n.stop(t + decay + 0.02);
  }

  const live = () => ctx && musicIn;

  const Sfx = {
    init,
    setVolumes,
    get musicBus() { return musicBus; },
    get musicIn() { return musicIn; },
    get previewBus() { return previewBus; },
    /** 0 = fine, 1 = about to fail: the song gets muffled and a little quieter. */
    setDanger(level) {
      if (!live()) return;
      const t = ctx.currentTime;
      lowpass.frequency.setTargetAtTime(20000 * Math.pow(900 / 20000, level), t, 0.12);
      musicIn.gain.setTargetAtTime(1 - 0.25 * level, t, 0.12);
    },
    /** A quick duck on a missed note. */
    missDip() {
      if (!live()) return;
      const t = ctx.currentTime;
      dip.gain.cancelScheduledValues(t);
      dip.gain.setValueAtTime(dip.gain.value, t);
      dip.gain.linearRampToValueAtTime(0.6, t + 0.03);
      dip.gain.setTargetAtTime(1, t + 0.08, 0.09);
    },
    /** Overdrive: a brighter, more present mix. */
    setOverdrive(on) {
      if (!live()) return;
      shelf.gain.setTargetAtTime(on ? 6 : 0, ctx.currentTime, 0.15);
    },
    resetMusicFx() {
      if (!live()) return;
      const t = ctx.currentTime;
      for (const p of [lowpass.frequency, shelf.gain, dip.gain, musicIn.gain]) p.cancelScheduledValues(t);
      lowpass.frequency.setValueAtTime(20000, t);
      shelf.gain.setValueAtTime(0, t);
      dip.gain.setValueAtTime(1, t);
      musicIn.gain.setValueAtTime(1, t);
    },
    hitTick: () => seq([[96, 0.012]], { duty: 0.125, vol: 0.07 }),
    // Tiles mode: a bright two-note chime per tile, pitched by column (a pentatonic
    // chord, so fast runs still sound pleasant). PERFECT adds the octave sparkle.
    // Tiles mode: a rising note at each quarter of a long tile, so holding sounds like filling up.
    holdStep: (lane, step) => {
      const base = [76, 79, 83, 88][lane] || 79;
      seq([[base + [0, 2, 4, 7, 12][step], 0.04]], { duty: 0.125, vol: 0.06 });
    },
    tileTap: (lane, perfect) => {
      const base = [76, 79, 83, 88][lane] || 79;
      seq(perfect ? [[base, 0.025], [base + 12, 0.06]] : [[base, 0.05]], { duty: 0.125, vol: 0.08 });
    },
    levelUp: (level) => seq([[72 + level * 4, 0.04], [79 + level * 4, 0.06]], { duty: 0.125, vol: 0.12 }),
    move: () => seq([[84, 0.03]], { duty: 0.5, vol: 0.15 }),
    select: () => seq([[79, 0.04], [91, 0.07]], { duty: 0.25, vol: 0.2 }),
    back: () => seq([[79, 0.04], [72, 0.07]], { duty: 0.25, vol: 0.18 }),
    error: () => seq([[50, 0.08], [49, 0.12]], { duty: 0.5, vol: 0.2 }),
    miss: () => { seq([[45, 0.09]], { duty: 0.5, vol: 0.16, slide: -5 }); burst(0.06, 600, 0.12, 'lowpass'); },
    countdown: (at) => seq([[72, 0.08]], { duty: 0.5, vol: 0.22, at }),
    go: (at) => seq([[84, 0.18]], { duty: 0.5, vol: 0.22, at }),
    streak: (n) => {
      const top = Math.min(4, Math.floor(n / 50));
      seq([[72, 0.05], [76, 0.05], [79, 0.05], [84 + top * 2, 0.12]], { duty: 0.125, vol: 0.18 });
    },
    // A bright rising run that cuts through the music: overdrive is ready.
    overdriveReady: () => seq([[76, 0.05], [79, 0.05], [84, 0.05], [88, 0.05], [91, 0.05], [96, 0.22]], { duty: 0.25, vol: 0.24, gap: 0.008 }),
    overdrive: () => {
      seq([[60, 0.25]], { duty: 0.25, vol: 0.2, slide: 24 });
      burst(0.5, 3000, 0.18);
    },
    rockDanger: () => seq([[55, 0.1], [54, 0.1]], { duty: 'tri', vol: 0.35 }),
    fail: () => seq([[67, 0.15], [63, 0.15], [60, 0.15], [55, 0.4]], { duty: 0.5, vol: 0.22, gap: 0.03 }),
    tick: () => seq([[96, 0.015]], { duty: 0.5, vol: 0.08 }),
    stamp: () => { burst(0.25, 200, 0.3, 'lowpass'); seq([[40, 0.12]], { duty: 'tri', vol: 0.5, slide: -12 }); },
    fanfare: () => seq(
      [[72, 0.09], [72, 0.09], [72, 0.09], [72, 0.27], [68, 0.27], [70, 0.27], [72, 0.18], [70, 0.09], [72, 0.45]],
      { duty: 0.25, vol: 0.2, gap: 0.01 }
    ),
    record: () => seq([[79, 0.07], [83, 0.07], [86, 0.07], [91, 0.25]], { duty: 0.125, vol: 0.2 }),
    // Challenges: the versus screen sting, and the lead changing hands mid-song.
    challenger: () => {
      burst(0.3, 300, 0.25, 'lowpass');
      seq([[55, 0.08], [58, 0.08], [62, 0.08], [67, 0.08], [70, 0.08], [74, 0.3]], { duty: 0.5, vol: 0.22, gap: 0.01 });
    },
    takeLead: () => seq([[84, 0.06], [88, 0.06], [91, 0.06], [96, 0.18]], { duty: 0.125, vol: 0.22, gap: 0.005 }),
    loseLead: () => seq([[67, 0.08], [62, 0.14]], { duty: 0.5, vol: 0.16 }),
  };

  root.Sfx = Sfx;
})(window);
