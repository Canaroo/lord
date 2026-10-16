/*
 * BeatDemo — synthesises a short, royalty-free drum & synth track with the
 * Web Audio API so the game can be tried without importing an MP3.
 */
'use strict';
(function (root) {
  const BPM = 112;

  async function render() {
    const sr = 44100;
    const beat = 60 / BPM;
    const bar = beat * 4;
    const BARS = 20;
    const duration = BARS * bar + 2;
    const ctx = new OfflineAudioContext(2, Math.ceil(sr * duration), sr);

    const master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);

    const noise = ctx.createBuffer(1, sr, sr);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    function env(gainNode, t, peak, decay) {
      gainNode.gain.setValueAtTime(0.0001, t);
      gainNode.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    }

    function kick(t) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
      env(g, t, 1.0, 0.45);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + 0.5);
    }

    function snare(t) {
      const n = ctx.createBufferSource(); n.buffer = noise;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
      const g = ctx.createGain(); env(g, t, 0.75, 0.22);
      n.connect(f).connect(g).connect(master);
      n.start(t); n.stop(t + 0.3);
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 190;
      const g2 = ctx.createGain(); env(g2, t, 0.35, 0.09);
      o.connect(g2).connect(master); o.start(t); o.stop(t + 0.12);
    }

    function hat(t, open) {
      const n = ctx.createBufferSource(); n.buffer = noise;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
      const g = ctx.createGain(); env(g, t, open ? 0.3 : 0.22, open ? 0.25 : 0.05);
      n.connect(f).connect(g).connect(master);
      n.start(t, Math.random() * 0.5); n.stop(t + 0.3);
    }

    function synth(t, freq, len, type, cutoff, peak) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(f).connect(g).connect(master);
      o.start(t); o.stop(t + len + 0.02);
    }

    // A minor – F – C – G
    const roots = [110, 87.31, 130.81, 98];
    const triads = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];

    for (let b = 0; b < BARS; b++) {
      const t0 = 1 + b * bar;
      const chord = b % 4;
      const section = b < 2 ? 'intro' : b < 8 ? 'verse' : b < 14 ? 'chorus' : b < 16 ? 'break' : 'outro';

      for (let q = 0; q < 4; q++) {
        const t = t0 + q * beat;
        const drums = section !== 'break';
        if (drums) {
          if (section === 'chorus' || section === 'outro' || q % 2 === 0) kick(t);
          if (section === 'verse' && q === 2 && b % 2 === 1) kick(t + beat / 2);
          if (section !== 'intro' && q % 2 === 1) snare(t);
        }
        // Hats: 8ths everywhere, 16ths in the chorus.
        const subs = section === 'chorus' ? 4 : 2;
        for (let s = 0; s < subs; s++) {
          if (section === 'break' && s % 2 === 0) continue;
          hat(t + (s * beat) / subs, section === 'outro' && q === 3 && s === subs - 1);
        }
        // Bass on 8ths after the intro.
        if (section !== 'intro' && section !== 'break') {
          synth(t, roots[chord], beat * 0.45, 'sawtooth', 500, 0.35);
          synth(t + beat / 2, roots[chord] * (q === 3 ? 1.5 : 1), beat * 0.4, 'sawtooth', 500, 0.3);
        }
        // Lead arpeggio in the chorus and break.
        if (section === 'chorus' || section === 'break') {
          const notes = triads[chord];
          for (let s = 0; s < 2; s++) {
            const n = notes[(q * 2 + s) % 3] * (q === 3 && s === 1 ? 2 : 1);
            synth(t + (s * beat) / 2, n, beat * 0.4, 'square', 2600, 0.11);
          }
        }
      }
    }
    // Final crash.
    const end = 1 + BARS * bar;
    kick(end);
    const n = ctx.createBufferSource(); n.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4000;
    const g = ctx.createGain(); env(g, end, 0.4, 1.6);
    n.connect(f).connect(g).connect(master); n.start(end); n.stop(end + 1.7);

    return ctx.startRendering();
  }

  root.BeatDemo = { render, name: `Demo Beat (${BPM} BPM)`, id: 'demo-v1' };
})(window);
