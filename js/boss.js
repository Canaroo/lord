/*
 * Boss battles: the BOSS song of a category, played on Hard against a boss with
 * a health bar. Every note you hit chips at it; glowing power notes charge a
 * Fireball (it takes the place of Overdrive) that you launch with the Overdrive
 * key or a swipe up for a big hit. A power note you miss lets the boss heal a
 * little. If the boss is still standing when the song ends, the boss wins.
 *
 * Pure and runs in Node for tests (the sprites are just data).
 */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Boss = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Which songs are boss battles, and who you fight. Keyed by pack song id.
  const BATTLES = {
    'witching-hour': { id: 'count', theme: 'spooky', name: 'THE VAMPIRE COUNT', color: '#b878f8' },
    'amp-overload': { id: 'titan', theme: 'rock', name: 'THE AMP TITAN', color: '#f84848' },
    'dragons-lair': { id: 'dragon', theme: 'epic', name: 'THE DRAGON', color: '#f8d830' },
  };

  // Tuning. The boss has 100 health. Hitting every note (all PERFECT) deals 60 of it
  // between them, and launching every Fireball the power notes charge deals 80, so a
  // win takes a solid run with most Fireballs launched (roughly a B or better).
  const HP = 100;
  const HITS_TOTAL = 60;
  const FIREBALLS_TOTAL = 80;
  const POWER_PER_FIREBALL = 4; // power notes to charge one Fireball
  const HEAL = 2.5; // health back for each power note missed
  const JUDGE_DAMAGE = { perfect: 1, good: 0.75, ok: 0.5 };

  /**
   * Which notes glow: about one in twenty, spread evenly through the song, in a
   * multiple of POWER_PER_FIREBALL. Returns the set of note indices (notes sorted by time).
   */
  function powerNotes(notes) {
    const out = new Set();
    if (!notes.length) return out;
    const want = Math.max(POWER_PER_FIREBALL, Math.round(notes.length / 20 / POWER_PER_FIREBALL) * POWER_PER_FIREBALL);
    const t0 = notes[0].t, t1 = notes[notes.length - 1].t;
    let j = 0;
    for (let k = 0; k < want; k++) {
      const target = t0 + ((k + 0.5) * (t1 - t0)) / want;
      while (j < notes.length - 1 && Math.abs(notes[j + 1].t - target) <= Math.abs(notes[j].t - target)) j++;
      // The nearest note not already glowing, and not sharing a moment with one that is.
      let i = j;
      while (i < notes.length && (out.has(i) || [...out].some((o) => notes[o].t === notes[i].t))) i++;
      if (i < notes.length) out.add(i);
    }
    return out;
  }

  /** Damage per hit and per Fireball for a chart with these notes. */
  function tuning(notes, power) {
    const fireballs = Math.max(1, Math.floor(power.size / POWER_PER_FIREBALL));
    return {
      hp: HP,
      hit: HITS_TOTAL / Math.max(1, notes.length),
      fireball: FIREBALLS_TOTAL / fireballs,
      charge: 1 / POWER_PER_FIREBALL,
      heal: HEAL,
    };
  }

  // Sprites: 16 pixels wide, drawn at 2× from the feet up. '.' is see-through.
  const SPRITES = {
    count: {
      palette: { H: '#181020', F: '#e8e0f0', E: '#ff2030', W: '#ffffff', G: '#5a2080', C: '#3a1050', R: '#a01828', K: '#101018', S: '#c8c0d8' },
      rows: [
        '.....HHHHHH.....',
        '....HHHHHHHH....',
        '...HHHFFFFHHH...',
        '...HFFFFFFFFH...',
        '...FFEEFFEEFF...',
        '...FFFFFFFFFF...',
        '....FFWFFWFF....',
        'GG...FFFFFF...GG',
        'GGG...FFFF...GGG',
        'CGGGCCSSSSCCGGGC',
        'CCCCCCRRRRCCCCCC',
        'CCCCCRRKKRRCCCCC',
        'CCCCCRKKKKRCCCCC',
        'CCCC.RKKKKR.CCCC',
        'CCC..RKKKKR..CCC',
        'CC...RKKKKR...CC',
        'C....RKKKKR....C',
        '.....RKKKKR.....',
        '.....KK..KK.....',
        '.....KK..KK.....',
      ],
    },
    titan: {
      palette: { S: '#f84848', F: '#f0c8a0', E: '#101018', M: '#601010', A: '#202030', G: '#383850', L: '#8890a8', D: '#101018', Y: '#f8d830', P: '#262648', B: '#0c0c18' },
      rows: [
        '..S..S..S..S....',
        '..SSSSSSSSSS....',
        '..SFFFFFFFFS....',
        '..FFEEFFEEFF....',
        '..FFFFFFFFFF....',
        '...FFMMMMFF.....',
        '....FFFFFF......',
        'AAAAAAAAAAAAAA..',
        'AGGGGGGGGGGGGA..',
        'AGLLLGGGGLLLGA..',
        'AGLDLGGGGLDLGA..',
        'AGLLLGGGGLLLGA..',
        'AGGGGGGGGGGGGA..',
        'AYAYAYAAAAAAAA..',
        'AAAAAAAAAAAAAA..',
        '..PPP.....PPP...',
        '..PPP.....PPP...',
        '..PPP.....PPP...',
        '.BBBB....BBBB...',
      ],
    },
    dragon: {
      palette: { W: '#a01828', H: '#38a838', D: '#187818', E: '#f8d830', N: '#0c2c0c', T: '#ffffff', B: '#f8d830', O: '#f0e0b0', C: '#e8e8f0' },
      rows: [
        '..W..O....O..W..',
        '.WWW.OHHHHO.WWW.',
        'WWWWWHHHHHHWWWWW',
        'WWWWHHEHHEHHWWWW',
        '.WWWHHHHHHHHWWW.',
        '..WWHDHHHHDHWW..',
        '...HHNNHHNNHH...',
        '...HHHHHHHHHH...',
        '....HTTTTTTH....',
        '.....HHHHHH.....',
        '....HBBBBBBH....',
        '...HHBBBBBBHH...',
        '..HHHBBBBBBHHH..',
        '..HHHBBBBBBHHH..',
        '...HHBBBBBBHH...',
        '....HHHHHHHH....',
        '....HHH..HHH....',
        '...CCC....CCC...',
      ],
    },
  };

  return { BATTLES, SPRITES, HP, POWER_PER_FIREBALL, JUDGE_DAMAGE, powerNotes, tuning, battleFor: (songId) => BATTLES[songId] || null };
});
