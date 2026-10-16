# Beat Frets

A 16-bit rhythm game in the spirit of *Frets on Fire* and *Guitar Hero*. Play an original
chiptune song pack and bonus tracks, or import any MP3 and the game listens to it and
builds the note chart for you. Play on a keyboard or a game controller.

**Play it:** https://canaroo.github.io/lord/

- **Easy:** 3 lanes. Notes on the strong beats.
- **Medium:** 4 lanes. Beats plus some off-beats, no chords.
- **Hard:** 5 lanes. Off-beats, fast runs and two-button chords.

## Controls

| | Keyboard | Xbox | PlayStation | Switch Pro |
| --- | --- | --- | --- | --- |
| Hard lanes | `A` `S` `D` `F` `G` | LT LB A RB RT | L2 L1 ✕ R1 R2 | ZL L B R ZR |
| Medium lanes | `A` `S` `D` `F` | LB A RB RT | L1 ✕ R1 R2 | L B R ZR |
| Easy lanes | `A` `S` `D` | LB A RB | L1 ✕ R1 | L B R |
| Overdrive | `Space` | Y | △ | X |
| Pause | `Esc` | Menu | Options | + |
| Menus | Arrows, `Enter`, `Esc` | D-pad / stick, A, B | D-pad / stick, ✕, ○ | D-pad / stick, B, A |

Controllers are detected automatically. Browsers only reveal a controller after one of its
buttons is pressed, so press any button and the on-screen labels switch to that pad's buttons.
The keyboard keeps working alongside it.

## How to play

Hit each note as it crosses the line.

- **Streak multiplier:** every 10 notes in a row raises it, up to ×4.
- **Overdrive (OD meter, left):** fills as you hit notes, with a bonus every 50-note streak.
  Once it's half full, trigger it for double points (up to ×8). A full meter lasts 16 seconds.
- **Rock meter (right):** rises on hits and drops on misses. If it empties, the song fails.
  You can turn on **No-fail mode** in Options.
- **Grades:** S, A, B, C or D by accuracy. "Full combo" means you missed nothing.

**Timing feels off?** Go to **Options → Auto-calibrate timing** and tap along with the clicks.
Bluetooth headphones usually need this.

## Leaderboards and sharing

Everything is saved in your browser on this device. Nothing is uploaded.

- **Players:** each person enters arcade-style initials and gets their own scores. Switch
  players from the main menu.
- **Leaderboards:** each song and difficulty (Easy, Medium, Hard) has a board with every player's best score.
  Failed runs don't count.
- **Sharing:** after a song, **Share** makes a pixel-art score card (copy the link, save the
  image, or use your device's share menu). A friend who opens the link sees your score and can
  add it to their leaderboard as a **rival**.
- **Fair comparisons:** the **chiptune pack** charts are built from the composition itself,
  and **bonus tracks** ship with pre-built charts, so everyone plays identical notes. For **imported MP3s**, two people's copies of a song are
  usually different files, so the game matches them by how they *sound* (length, tempo and
  the shape of the song's loudness over time). Your friend's score then lands on the same board.
- **Backups:** **Save data → Export** downloads your save as a file. Import it on another
  computer or browser to bring your players and scores along. Importing merges and never
  overwrites.

Share links have a checksum, so a hand-edited link shows as **unverified**. Like any browser
game, a determined player could still fake a score, so treat rival scores as friendly bragging.

## Bonus tracks

Recorded songs can ship with the game in the `songs/` folder. Each one downloads only when
it's picked, and comes with a pre-built chart made by `npm run build-charts`. Browsers decode
MP3s with slightly different start delays, so on load the game listens to the first 30 seconds
and slides the chart into line with the audio. See [`songs/README.md`](songs/README.md) for
how to add songs. Only add music you have the right to share: the site is public.

## How the auto-charting works

Imported songs are analysed in the browser (`js/analyzer.js`):

1. **Per-band spectral flux:** the song is split into ~12 ms frames and run through an FFT.
   For 5 frequency bands, the game measures sudden rises in energy (drum hits, plucked notes).
2. **Onsets:** peaks that stand out from the local average become candidate notes, each with
   a strength and a 5-band "fingerprint".
3. **Tempo:** autocorrelation of the onset curve gives the BPM.
4. **Beat tracking:** dynamic programming (Ellis, 2007) finds a steady sequence of beats.

Then `js/chartgen.js` builds the chart. It snaps onsets to a beat/8th/16th-note grid, keeps
the strong ones (beats first), enforces a minimum gap between notes (300 ms on Easy, 100 ms on
Hard), and picks lanes by frequency: kick and bass on the left, hi-hats and cymbals on the
right. It then spreads notes so no single fret hogs the chart.

Song pack tracks (`js/songs.js`) are written as patterns and synthesised with a 16-bit-style
sound palette: pulse-wave leads with SNES-style echo, triangle bass and noise drums. Their
charts come from the notes themselves, with the melody walking across the frets.

## Development

There is no build step. The page is plain HTML, CSS and JavaScript.

```
js/analyzer.js   onset detection, tempo, beat tracking
js/chartgen.js   analysis → Easy/Hard note charts
js/songs.js      chiptune song pack (composition, synthesis, charts)
js/bonus.js      bonus tracks: lining pre-built charts up with the decoded audio
tools/build-charts.js   builds bonus-track charts (needs ffmpeg)
js/render.js     the 16-bit stage: highway, crowd, lights, HUD
js/game.js       timing, judging, scoring, rock meter, overdrive
js/input.js      keyboard and Gamepad API input
js/sfx.js        chiptune sound effects and volume buses
js/save.js       players, scores, leaderboards, share links, song matching
js/share.js      score card image and challenge links
js/main.js       menus and app flow
```

```bash
npm start                         # serve locally on http://localhost:8080
npm test                          # unit tests (plain Node, no dependencies)
npm run build-charts              # build charts for MP3s in songs/
npm i -D playwright && npm run e2e -- [song.mp3]   # full browser test
```

The end-to-end test drives the game with a simulated Xbox controller. It enters initials,
navigates menus with the D-pad, plays a full song (overdrive included), checks the
leaderboard, shares the score, opens the link as a friend in a separate browser, accepts the
challenge, fails a song on purpose, pauses with Start, and imports an MP3.

### Ideas for next steps

- Hold notes for sustained sounds.
- More chiptune tracks. Each one is a small block of pattern data in `js/songs.js`.
- An online leaderboard. Scores are already structured for it; it needs a small hosted
  database such as Supabase.
- Button remapping.
