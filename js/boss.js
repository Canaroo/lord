/*
 * Boss battles: the ELITE song of a category, played on Hard against a boss with
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
    'castle-overdrive': { id: 'glitch', theme: 'classic', name: 'THE GLITCH KING', color: '#58f8f8' },
    'galactic-showdown': { id: 'alien', theme: 'space', name: 'THE ALIEN OVERLORD', color: '#5a8cff' },
    'ringmasters-gallop': { id: 'ringmaster', theme: 'carnival', name: 'THE RINGMASTER', color: '#f88820' },
    'fuego-mambo': { id: 'toro', theme: 'salsa', name: 'EL TORO', color: '#9be22e' },
    'mic-drop': { id: 'mc', theme: 'hiphop', name: 'MC THUNDER', color: '#ff4f9a' },
    'mountain-king': { id: 'troll', theme: 'classical', name: 'THE MOUNTAIN KING', color: '#e8d8a8' },
  };

  // Tuning. The boss has 100 health. Hitting every note (all PERFECT) deals 70 of it
  // between them, and launching every Fireball the power notes charge deals 90. But
  // every miss heals it a little (and costs twice the usual rock meter), a missed power
  // note heals it more, and so does hitting a trap note: a win takes a strong run.
  const HP = 100;
  const HITS_TOTAL = 70;
  const FIREBALLS_TOTAL = 90;
  const POWER_PER_FIREBALL = 4; // power notes to charge one Fireball
  const HEAL = 2.5; // health back for each power note missed
  const MISS_HEAL = 0.25; // and for any miss
  const MISS_MUL = 2; // misses cost twice the usual rock meter
  const TRAP_HEAL = 3; // hitting a trap note
  const TRAP_ROCK = 0.12; // ...and what it costs the rock meter
  const JUDGE_DAMAGE = { perfect: 1, good: 0.75, ok: 0.5 };

  // ---- attacks: the boss's hazards ------------------------------------------------------
  //
  // Every so often the boss attacks for a few seconds (warned a moment before):
  //   blackout  — darkness or smoke hides the far end of the highway: notes appear late
  //   trap      — cursed notes you must NOT hit join the highway
  //   surge     — the notes rush in faster
  //   scramble  — two lanes swap places on screen (keys stay with their colour). On a
  //               phone you tap where the notes are, so a swap wouldn't change anything:
  //               phones get a second surge instead, and upright (two busy lanes, no
  //               room for traps) a blackout in place of traps.
  // The schedule comes from the chart alone, so everyone on a leaderboard faces the same fight.
  const ATTACK_LEN = { blackout: 5, trap: 6, surge: 4, scramble: 6 };
  const CLEAR = 0.25; // seconds between a trap note and any real note in its lane
  const ATTACK_GAP = 13; // seconds from one attack's start to the next
  const ATTACK_GAP_MIN = 11; // ...on a short song
  const WARN = 1.5; // seconds of warning
  // Each boss leads with its favourite.
  const ORDER = {
    count: ['blackout', 'trap', 'surge', 'scramble'],
    titan: ['surge', 'scramble', 'trap', 'blackout'],
    dragon: ['trap', 'blackout', 'scramble', 'surge'],
    glitch: ['scramble', 'blackout', 'trap', 'surge'],
    alien: ['blackout', 'scramble', 'surge', 'trap'],
    ringmaster: ['scramble', 'trap', 'blackout', 'surge'],
    toro: ['surge', 'blackout', 'trap', 'scramble'],
    mc: ['surge', 'trap', 'scramble', 'blackout'],
    troll: ['surge', 'trap', 'blackout', 'scramble'],
  };
  const ATTACK_NAMES = {
    count: { blackout: ['BATS BLOT OUT THE LIGHT!', 'NOTES APPEAR LATE'], trap: ['CURSED NOTES!', "DON'T HIT THE SKULLS"], surge: ['THE COUNT SPEEDS UP TIME!', 'NOTES RUSH IN'], scramble: ['A HEX ON YOUR FRETS!', 'TWO LANES SWAPPED'] },
    titan: { blackout: ['STAGE SMOKE!', 'NOTES APPEAR LATE'], trap: ['FEEDBACK NOTES!', "DON'T HIT THE SKULLS"], surge: ['SHOCKWAVE!', 'NOTES RUSH IN'], scramble: ['AMP SCRAMBLE!', 'TWO LANES SWAPPED'] },
    dragon: { blackout: ['A CLOUD OF SMOKE!', 'NOTES APPEAR LATE'], trap: ['FIRE NOTES!', "DON'T HIT THE SKULLS"], surge: ["DRAGON'S ROAR!", 'NOTES RUSH IN'], scramble: ['TAIL SWIPE!', 'TWO LANES SWAPPED'] },
    glitch: { blackout: ['SCREEN GLITCH!', 'NOTES APPEAR LATE'], trap: ['GLITCH NOTES!', "DON'T HIT THE SKULLS"], surge: ['OVERCLOCK!', 'NOTES RUSH IN'], scramble: ['BIT FLIP!', 'TWO LANES SWAPPED'] },
    alien: { blackout: ['ECLIPSE!', 'NOTES APPEAR LATE'], trap: ['SPACE MINES!', "DON'T HIT THE SKULLS"], surge: ['HYPERSPACE!', 'NOTES RUSH IN'], scramble: ['GRAVITY FLIP!', 'TWO LANES SWAPPED'] },
    ringmaster: { blackout: ['LIGHTS OUT IN THE BIG TOP!', 'NOTES APPEAR LATE'], trap: ['CREAM PIES!', "DON'T HIT THE SKULLS"], surge: ['FASTER, FASTER!', 'NOTES RUSH IN'], scramble: ['HALL OF MIRRORS!', 'TWO LANES SWAPPED'] },
    toro: { blackout: ['A DUST CLOUD!', 'NOTES APPEAR LATE'], trap: ['HORN NOTES!', "DON'T HIT THE SKULLS"], surge: ['STAMPEDE!', 'NOTES RUSH IN'], scramble: ["THE MATADOR'S CAPE!", 'TWO LANES SWAPPED'] },
    mc: { blackout: ['FOG MACHINE!', 'NOTES APPEAR LATE'], trap: ['BROKEN RECORDS!', "DON'T HIT THE SKULLS"], surge: ['DOUBLE TIME!', 'NOTES RUSH IN'], scramble: ['REMIX!', 'TWO LANES SWAPPED'] },
    troll: { blackout: ['INTO THE CAVE!', 'NOTES APPEAR LATE'], trap: ['TROLL TRAPS!', "DON'T HIT THE SKULLS"], surge: ['FASTER! FASTER!', 'NOTES RUSH IN'], scramble: ['TROLL TRICKS!', 'TWO LANES SWAPPED'] },
  };

  /**
   * The boss's attacks for a chart: [{ kind, t0, t1 }] (seconds), starting about ten
   * seconds in, one every ATTACK_GAP seconds, all over before the last notes.
   * `touch`: phones swap the scramble for a surge. With only two lanes (a phone held
   * upright) there's no free lane for trap notes, so traps become a blackout.
   */
  function attacks(notes, bossId, { touch = false, lanes = 5 } = {}) {
    if (!notes.length) return [];
    const order = ORDER[bossId] || ORDER.count;
    const first = notes[0].t, last = notes[notes.length - 1].t;
    // Shorter songs (the Classics run about a minute) space their attacks a little closer,
    // so every boss gets to use all four.
    const gap = Math.max(ATTACK_GAP_MIN, Math.min(ATTACK_GAP, (last - 3 - (first + 10)) / 5));
    const out = [];
    for (let k = 0, t = first + 10; ; k++, t += gap) {
      let kind = order[k % order.length];
      if (touch && kind === 'scramble') kind = 'surge';
      if (lanes <= 2 && kind === 'trap') kind = 'blackout';
      const t1 = t + ATTACK_LEN[kind];
      if (t1 > last - 3) break;
      out.push({ kind, t0: +t.toFixed(3), t1: +t1.toFixed(3) });
    }
    return out;
  }

  /**
   * Trap notes for the trap attacks: one on about every beat of the attack, in a lane
   * with no real note close by (so a press for a real note never lands on a trap).
   */
  function traps(notes, attackList, lanes, beat = 0.5) {
    const out = [];
    for (const a of attackList) {
      if (a.kind !== 'trap') continue;
      let k = 0;
      const step = beat >= 0.45 ? beat : beat * 2; // about one every half second or more
      for (let t = a.t0 + step / 2; t < a.t1; t += step, k++) {
        // A press for a real note always takes the real note first (it's nearer), so a
        // quarter of a second clear is enough.
        const near = notes.filter((n) => Math.abs(n.t - t) < CLEAR || (n.len && t > n.t - CLEAR && t < n.t + n.len + CLEAR));
        const free = [];
        for (let l = 0; l < lanes; l++) if (!near.some((n) => n.lane === l)) free.push(l);
        if (free.length) out.push({ t: +t.toFixed(4), lane: free[(k * 3) % free.length], trap: true, hit: false });
      }
    }
    return out;
  }

  /** The two lanes a scramble swaps: the second and the second-to-last. */
  const scrambleLanes = (lanes) => (lanes >= 4 ? [1, lanes - 2] : [0, lanes - 1]);

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
      missHeal: MISS_HEAL,
      missMul: MISS_MUL,
      trapHeal: TRAP_HEAL,
      trapRock: TRAP_ROCK,
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
    glitch: {
      palette: { Y: '#f8d830', R: '#f84848', B: '#58f8f8', F: '#e8e0f0', E: '#101018', M: '#601020', P: '#5a2a9a', W: '#f4f4ff', C: '#58f8f8', K: '#181020' },
      rows: [
        '...Y..Y..Y..Y...',
        '...YYYYYYYYYY...',
        '...YRYYBYYRYY...',
        '....FFFFFFFF....',
        '....FEFFFFEF....',
        '....FFFCFFFF....',
        '....FFMMMMFF....',
        '.....FFFFFF.....',
        '..PPPPPPPPPPPP..',
        '.PPPPPWWWWPPPPP.',
        'PPPPPPWCCWPPPPPP',
        'PPPCPPWWWWPPPCPP',
        'PPPPPPPPPPPPPPPP',
        '.PPPPPPCPPPPPPP.',
        '..PPPPPPPPPPPP..',
        '..PPPP....PPPP..',
        '..KKK......KKK..',
      ],
    },
    alien: {
      palette: { A: '#f8d830', G: '#58d858', K: '#101018', M: '#186818', S: '#b8c0d8', L: '#5a8cff' },
      rows: [
        '.......A........',
        '.......A........',
        '....GGGGGGGG....',
        '...GGGGGGGGGG...',
        '..GGGGGGGGGGGG..',
        '..GKKKGGGGKKKG..',
        '..GKKKKGGKKKKG..',
        '...GGKGGGGKGG...',
        '....GGGGGGGG....',
        '.....GGMMGG.....',
        '......GGGG......',
        '....SSSSSSSS....',
        '...SSSLLLLSSS...',
        '..GSSSLLLLSSSG..',
        '..G.SSSSSSSS.G..',
        '....SS....SS....',
        '....SS....SS....',
        '...SSS....SSS...',
      ],
    },
    ringmaster: {
      palette: { K: '#181020', R: '#d82838', F: '#f0c8a0', E: '#101018', M: '#5a3018', W: '#f4f4ff', Y: '#f8d830' },
      rows: [
        '....KKKKKKKK....',
        '....KKKKKKKK....',
        '....KKKKKKKK....',
        '....RRRRRRRR....',
        '..KKKKKKKKKKKK..',
        '....FFFFFFFF....',
        '....FEFFFFEF....',
        '...MMMFFFFMMM...',
        '....FFFFFFFF....',
        '.....FFFFFF.....',
        '...RRRWWWWRRR...',
        '..RRRRWWWWRRRR..',
        '..RRYRRWWRRYRR..',
        '..RRRRRRRRRRRR..',
        '..RRYRRRRRRYRR..',
        '..RR.RRRRRR.RR..',
        '....KKK..KKK....',
        '....KKK..KKK....',
        '...KKKK..KKKK...',
      ],
    },
    toro: {
      palette: { W: '#f0e8d0', B: '#5a3018', E: '#f84848', T: '#c89058', N: '#2a1008', Y: '#f8d830', K: '#181010' },
      rows: [
        'W..............W',
        'WW............WW',
        '.WW..BBBBBB..WW.',
        '..WWBBBBBBBBWW..',
        '...BBBBBBBBBB...',
        '..BBEBBBBBBEBB..',
        '..BBBBBBBBBBBB..',
        '...BBBBBBBBBB...',
        '....BTTTTTTB....',
        '....TTNTTNTT....',
        '....TTTYYTTT....',
        '.....TTTTTT.....',
        '...BBBBBBBBBB...',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '..BBB......BBB..',
        '..BBB......BBB..',
        '..KK........KK..',
      ],
    },
    mc: {
      palette: { C: '#ff4f9a', F: '#a87048', K: '#101018', W: '#f4f4ff', H: '#3a3a58', Y: '#f8d830', M: '#9aa0b8', D: '#262648' },
      rows: [
        '....CCCCCCCC....',
        '...CCCCCCCCCCC..',
        '....FFFFFFFF....',
        '...FKKKKKKKKF...',
        '...FKKFFFFKKF...',
        '....FFFFFFFF....',
        '....FFWWWWFF....',
        '.....FFFFFF.....',
        '...HHHHHHHHHH...',
        '..HHHYHHHHYHHH..',
        '..HHHHYYYYHHHH..',
        '..HHHHHYYHHHHH.M',
        '..HHHHHHHHHHHHMM',
        '..HH.HHHHHH.HHF.',
        '....DDDDDDDD....',
        '....DD....DD....',
        '....DD....DD....',
        '...WWW....WWW...',
      ],
    },
    troll: {
      palette: { Y: '#f8d830', G: '#7a9a5a', E: '#f84848', N: '#5a7a3a', W: '#f0e8d0', B: '#9aa0a8', F: '#7a4a28' },
      rows: [
        '...Y.Y.Y.Y.Y....',
        '...YYYYYYYYY....',
        '..GGGGGGGGGGG...',
        '..GGEGGGGGEGG...',
        '..GGGGGNGGGGG...',
        '..GGGGNNNGGGG...',
        '..GGWGGGGGWGG...',
        '...BBBBBBBBB....',
        '..BBBBBBBBBBB...',
        '.FFFFBBBBBFFFF..',
        'FFFFFFFFFFFFFFF.',
        'FFGGFFFFFFFGGFF.',
        'FFGGFFFFFFFGGFF.',
        '.FFFFFFFFFFFFF..',
        '..GGG.....GGG...',
        '..GGG.....GGG...',
        '.GGGG.....GGGG..',
      ],
    },
  };

  return {
    BATTLES, SPRITES, HP, POWER_PER_FIREBALL, JUDGE_DAMAGE, ATTACK_NAMES, WARN,
    powerNotes, tuning, attacks, traps, scrambleLanes, battleFor: (songId) => BATTLES[songId] || null,
  };
});
