# How a pack song is written

Every pack song is a plain object in the `SONGS` array in `js/songs.js`. `build()` expands it into
timed notes, `toAnalysis()` turns those into what ChartGen reads, and `render()` synthesises the
audio in the browser. Nothing is recorded: the composition *is* the song, and the chart comes
straight from it, which is why every player gets identical notes and the world leaderboards are fair.

## Fields

```js
{
  id: 'garage-jam',          // lowercase-hyphenated, unique, permanent (see "ids are forever")
  theme: 'rock',             // classic (or leave out), spooky, rock, epic, space, carnival, salsa, hiphop — or a new theme
  tier: 'rookie',            // rookie | pro | boss
  title: 'Garage Jam',
  blurb: 'Plug in and stomp along: a simple, chunky first riff.',   // one short line, shown in the list
  bpm: 104,
  root: 64,                  // MIDI note of the key's tonic (60 = middle C, 64 = E, 62 = D, 57 = A)
  scale: 'minor',            // major | minor | harmonic (harmonic minor: spooky / boss flavour)
  leadScale: 'chromatic',    // optional: melody digits count semitones above root (carnival runs)
  prog: [0, 0, 3, 4],        // chord root per bar as a scale degree, cycling for the whole song
  voice: { ... },            // optional sound settings, below
  drums: { kitName: { k, s, h, o, t }, ..., fill: { ... } },
  bass: { name: '16 steps', ... },
  gtr: { name: '16 steps', ... },        // optional power-chord guitar
  lead: { name: ['16 steps', ...], ... },// a phrase: one string per bar, repeating through a section
  form: [ { bars, drums, bass, lead, gtr, arp, crash, fill }, ... ],
}
```

## Patterns: 16 steps per bar (sixteenth notes)

Every pattern string is exactly 16 characters; `build()` throws if not.

| Part | Characters |
| --- | --- |
| Drums `k` kick, `s` snare, `h` hat, `o` open hat, `t` tom/timpani, `c` clave, `g` conga | `x` hit, `X` accented hit (a conga's `X` is a higher slap), `.` rest |
| Bass | `0` `2` `4` `7` = the bar's chord root, third, fifth and octave (an octave below the lead), `-` hold, `.` rest |
| Guitar (`gtr`) | `x` short palm-muted chug, `o` open power chord that rings through following `-`, `.` rest |
| Lead | `0`–`9`, `a`–`e` = scale degrees 0–14 above `root` (two octaves; `7` is the octave), `-` hold the previous note, `.` rest. With `leadScale: 'chromatic'` they're semitones instead (0–14: an octave and a minor third; `c` is the octave) |

A lead phrase is a list of bars; inside a section, bar *b* plays `phrase[b % phrase.length]`.
Four-bar phrases are the norm; an `outro` is often two bars.

## Form

Each section: `{ bars: 8, drums: 'verse', bass: 'verse', lead: 'verse', gtr: 'verse', arp: true, crash: true, fill: true }`.

- `drums`, `bass`, `lead`, `gtr` name entries in those maps; leave one out to drop that part.
- `arp: true` adds a fast chord arpeggio (sound only: arpeggios never become notes).
- `crash: true` hits a crash cymbal on the section's first bar.
- `fill: true` swaps the section's last bar to the `fill` drum kit, so the song needs `drums.fill`.

Song length is `total bars × 16 × (60 / bpm / 4)` seconds plus 1 s lead-in. The Classics run about
55–60 s; every newer song runs **about 90–98 s**, so aim there: total bars ≈ `92 × bpm / 240`
(104 BPM → ~40 bars, 140 → ~54, 172 → ~66). The usual shape is intro (2–4 bars), verse 8,
chorus 8, a 4-bar break, verse 8, chorus 8, (another chorus 8), outro 4.

## Voice (sound)

```js
voice: { lead: 'organ', vibrato: { rate: 6, depth: 0.012 }, echo: { steps: 3, fb: 0.45, wet: 0.4 }, toms: 'timpani' }
```

- `lead`: `pulse` (default, chiptune), `square` (rock), `organ` (spooky drawbar), `brass` (epic, swells open),
  `synth` (space: two detuned saws, filter glows open), `calliope` (carnival steam whistle with a puff of air),
  `piano` (salsa montunos: struck, decaying), `keys` (hip hop electric piano with a slow tremolo).
- `bass`: leave out for the triangle bass, or `808` (hip hop: a deep sine that drops into each note, long tail).
- `arp`: leave out for chiptune pulse arpeggios, or `bell` for soft twinkling sine bells (space).
- `vibrato`: `{ rate (Hz), depth (fraction of pitch) }`; organ uses 0.012–0.018, brass about 0.008.
- `echo`: `{ steps (sixteenths), fb (feedback 0–0.5), wet (0–0.45) }`; longer and wetter = spookier.
- `toms`: `tom` or `timpani` (deep and rolling, for epic or boss moments).

Each theme has its own palette; match it so the theme sounds like one album:

| Theme | Scale | Sound |
| --- | --- | --- |
| classic | major / minor / harmonic | pulse lead, plenty of `arp` |
| spooky | harmonic | organ with vibrato, long echo, toms (timpani for the boss) |
| rock | minor | square lead, `gtr` power chords, toms |
| epic | major → harmonic for the boss | brass, timpani |
| space | major → harmonic for the boss | synth lead (brass for the boss), `bell` arps, long echo, timpani |
| carnival | major, `leadScale: 'chromatic'` | calliope with fast vibrato, oom-pah bass (`0...4...`), chromatic runs, short echo |
| salsa | harmonic minor (i-iv-V) | `piano` montunos, clave `x..x..x...x.x...` every bar, congas, toms as timbales |
| hiphop | minor | `keys` lead, `bass: '808'` with held notes, boom-bap kick/snare, 16th hats (trap for the boss) |

## How notes become a chart (what moves the numbers)

Every drum hit, bass note, guitar hit and lead note becomes an onset (hits at the same instant merge
into one). ChartGen then picks notes from those onsets per difficulty: Easy keeps the strongest,
Hard keeps most of them. Lanes follow pitch: the melody walks across the frets from low to high, so
a lead that uses a wide range of degrees spreads notes over every lane. Held lead or bass notes
(`-`) become long notes on Medium and up (never on Easy).

So, to change how busy a song is to play:

| To make it… | Turn this |
| --- | --- |
| busier everywhere | more hits on off-beats (`h` hats every step, `k` doubles like `x.x.`), a busier bass |
| busier on Easy only | stronger hits on new positions (kicks and snares count most, hats least) |
| calmer | fewer hats, kicks on the beat only, lead notes held (`-`) instead of repeated |
| a clearer step from Medium to Medium+ | Medium caps quick runs; long runs of sixteenths in the lead or hats widen the gap |
| use every lane | widen the lead's range (use low degrees and `a`–`e`), avoid one-note riffs |

## Limits the tests enforce (`tests/songs.test.js`)

Notes per second must sit inside these ranges on every song:

| Easy | Medium | Medium+ | Hard | Duo |
| --- | --- | --- | --- | --- |
| 1 – 3.5 | 1.8 – 5.5 | 2.8 – 7 | 3 – 8 | 2.8 – 7.5 |

And: Easy < Medium < Medium+ ≤ Hard (in note count); Medium+ and Duo at least 75% of Hard; every
lane gets more than 4% of the notes; Easy has no long notes, every other difficulty has some.
`scripts/song-stats.js` checks all of this in a second, before the slower `npm test`.

## Tiers

Easy mostly follows the beat (about one note a beat, a few more on busy songs), so tempo sets
the Easy density more than the patterns do: a slow hip hop groove needs a faster PRO and BOSS
for the tiers to step up.


The badge describes the *song*, whatever difficulty it's played on. Measured on Easy:

| Tier | Easy notes/s | Tempo | Typical feel |
| --- | --- | --- | --- |
| ROOKIE | ~1.65–1.95 | 104–120 | on-the-beat drums, held melody, simple bass |
| PRO | ~2.05–2.35 | 128–152 | off-beat hats, gallops, a busier chorus |
| BOSS | ~2.55–2.8 | 160–172 | sixteenth hats, double kicks, fast runs; Medium near the 5.5 cap |

In each theme the next tier up should be clearly busier on Easy than the one before it (look at the
"themes" lines that `song-stats.js` prints).

## ids are forever

The id is the key for every saved score, star rating, local leaderboard and world leaderboard
(`pack:<id>` locally, `pack-<id>__<difficulty>` in Firebase). Renaming an id quietly orphans all of
them. Change the `title` instead; the id never shows to players.

## Retuning a song that's already published

Changing a published song's notes changes its chart, but its world leaderboards stay: they were
created with the old note count, and old scores were set on the old chart. Before retuning, tell
the user:

- Old world scores stay on the boards but were played on different notes, so the comparison is no
  longer fair. Small fixes (a lane or a few notes) are fine; a big change is better as a new song.
- If the new chart has *more* notes, the board's score cap (2,000 × the old note count) can block a
  very high new score from posting. Fewer notes is always safe.
- Each player's saved copy rebuilds by itself the first time they play it again (10–60 s).

## A new theme

A theme needs, besides its songs:

1. `js/main.js` → `renderPack()` → the `THEMES` list: `['space', 'SPACE ADVENTURE']`, in the
   order it should appear.
2. `css/style.css` next to `#pack-list .label.theme-epic`: a heading colour and the row accent:
   `#pack-list .label.theme-space { color: …; }` and `.list.theme-space button { --acc: …; }`.
   Pick a colour that's distinct from cyan (classic), purple (spooky), red (rock) and gold (epic).
3. A sound palette (scale, `voice`, which parts it leans on), written down in the README's theme
   table so later songs match.
4. Three songs (ROOKIE, PRO, BOSS) so it fits the rest of the pack. With fewer, say so to the user.
