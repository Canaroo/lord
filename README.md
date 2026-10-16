# Beat Frets

A keyboard rhythm game in the spirit of *Frets on Fire*. Import any MP3, and the game
listens to it and builds the note chart for you. No hand-made charts needed.

- **Easy:** 3 lanes (`A` `S` `D`). Notes on the strong beats.
- **Hard:** 5 lanes (`A` `S` `D` `F` `G`). Off-beats, 16th notes and two-key chords.

Notes are placed by **frequency**: kick drums and bass land in the left lanes, snares and
vocals in the middle, and hi-hats and cymbals on the right, so you feel like you're
playing the song's instruments.

## Play

There is nothing to install or build. Open `index.html` in a modern desktop browser (Chrome, Edge,
Firefox or Safari), then:

1. Click **Import an MP3**, or drag an audio file onto the window. Any format your browser
   can decode works (MP3, WAV, OGG, M4A…).
2. Wait a few seconds while it analyses the song.
3. Pick **Easy** or **Hard** and hit each key as its note crosses the line.

No MP3 handy? Click **Play the built-in demo beat**. It's synthesised in your browser.

| Key | Action |
| --- | --- |
| `A` `S` `D` `F` `G` | Frets (green, red, yellow, blue, orange) |
| `Esc` | Pause / resume |

**Timing feels off?** Open **Settings → Auto-calibrate**, then tap `Space` along with the clicks.
Bluetooth headphones usually need this. You can also adjust note speed there.

To serve it over HTTP instead of opening the file directly: `npm start`, then open http://localhost:8080.

## How the auto-charting works

All analysis runs locally in the browser. Nothing is uploaded.

1. **Spectral flux, per band** (`js/analyzer.js`): the song is split into short frames
   (about 12 ms apart) and run through an FFT. For 5 frequency bands, the game measures how
   suddenly the energy rises. A sudden rise is an *onset*, such as a drum hit or a plucked note.
2. **Onset picking:** peaks that stand out from the local average become candidate notes,
   each with a strength and a 5-band "fingerprint".
3. **Tempo:** autocorrelating the onset curve finds the repeating period, giving the BPM.
4. **Beat tracking:** dynamic programming (Ellis, 2007) finds the sequence of beats that best
   matches the onsets while keeping a steady tempo. These are the lines that scroll down
   the highway.
5. **Chart generation** (`js/chartgen.js`):
   - Build a grid of beats, 8th notes and 16th notes, and snap each onset to its slot.
   - Keep onsets above a strength threshold, filling **beats first, then off-beats**,
     with a minimum gap between notes (300 ms on Easy, 100 ms on Hard).
   - Choose the lane from the strongest frequency band, then apply playability rules:
     no long runs on one key, no fast repeats of the same key on Hard, and occasional
     chords on big accents on Hard.

Each song's analysis is cached in `localStorage`, keyed by a hash of the file, so
re-importing the same song is instant. Best scores are saved per song and difficulty.

### Scoring

| Judgement | Window | Points |
| --- | --- | --- |
| Perfect | ±50 ms | 100 |
| Good | ±95 ms | 70 |
| OK | ±140 ms | 40 |

Every 10-note combo raises the multiplier, up to ×4. Stray key presses aren't penalised.

## Limits

- Charts follow the song's rhythm and frequencies but don't understand phrasing, so they're
  fun and on-beat rather than hand-designed.
- Songs with a strong, steady beat (pop, rock, electronic, hip-hop) chart best. Tracks with a
  drifting tempo, ambient music and very quiet drums give sparser or looser charts.

## Development

```
js/analyzer.js   onset detection, tempo, beat tracking (works in the browser and Node)
js/chartgen.js   analysis → Easy/Hard note charts
js/game.js       highway rendering, input, judging, scoring
js/demo.js       synthesised demo track
js/main.js       menus and app flow
```

```bash
npm test                          # unit tests: tempo/beat accuracy, chart rules (plain Node)
npm i -D playwright && npm run e2e -- path/to/song.mp3   # headless browser smoke test
```

The end-to-end test loads the page, imports a song (or the demo), lets a bot play Hard mode
for a few seconds, and checks that its on-time presses are judged *Perfect*.

### Ideas for next steps

- Hold notes for sustained sounds (long onsets with steady energy).
- A "Medium" difficulty (4 lanes): add an entry to `ChartGen.DIFFICULTIES` and a button in `index.html`.
- Remappable keys and a fail meter.
- Pattern memory, so repeated choruses get identical note patterns.
