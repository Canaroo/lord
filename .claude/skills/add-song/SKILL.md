---
name: add-song
description: Compose and add a new song to the Beat Frets song pack (js/songs.js), from a loose idea like "a spooky rookie song about a haunted carnival" — picking theme, ROOKIE/PRO/BOSS tier, tempo, key and sound, writing the patterns, tuning note density, testing, rendering an MP3 preview, and publishing it. Also use it to start a new theme (e.g. a Space theme with three songs), or to re-tier or retune an existing pack song whose difficulty feels wrong. Use this whenever the user wants a new song, track, tune, level or theme in Beat Frets, asks to make a song easier, harder or longer, or to move a song between tiers — even if they don't say "skill" or name the file. Not for MP3 bonus tracks (songs/ + tools/build-charts.js) or players' own uploaded music.
---

# Add a song to Beat Frets

Beat Frets is a 16-bit browser rhythm game a parent builds with their kids. Its song pack is
composed as data in `js/songs.js` and synthesised in the browser, so charts are identical for every
player and the world leaderboards stay fair. This skill turns a song idea into a finished, tested
pack song, then publishes it and reports back with previews.

Read `references/song-format.md` before composing: it explains every field, the pattern
characters, the sound palette of each theme, what changes note density, and the limits the tests
enforce. Then read the songs already in the same theme in `js/songs.js`: matching their sound and
structure is what makes a theme feel like one album.

## 1. Pin down the idea

The user usually gives a loose idea. Work out:

- **Theme**: an existing one (classic, spooky, rock, epic) or a new one.
- **Tier**: ROOKIE, PRO or BOSS. If the theme already has songs, the gap is often obvious.
- **Title, blurb, tempo, key, sound**: invent these to fit the idea and theme; that's the fun part
  and the user expects you to do it.

Ask (with AskUserQuestion, a few options each) only when the theme or tier really can't be inferred,
or when the request is a new theme (its name, colour and sound are the user's call). Everything
else the user can hear in the preview and ask to change afterwards, so don't front-load
questions about tempo or notes.

For a **retune or re-tier** of an existing song, read "Retuning a song that's already published"
and "ids are forever" in the reference, and tell the user the leaderboard consequences *before*
changing anything, since they may prefer a new song instead.

## 2. Compose

Add the song object to `SONGS` in `js/songs.js` inside its theme's block (`// ---- Spooky ----`
etc.), placed so the theme reads ROOKIE → PRO → BOSS; the song list shows songs in array order. If
two songs share a tier, put the gentler one first.

Aim for the target length (about 90–98 s; the reference has the bar formula) and the tier's feel.
Write music that's actually pleasant: a melody with a shape (rises to a peak in the chorus, comes
home at the end), a chord progression that suits the mood, a break that gives the ears a rest. The
kids will play it dozens of times.

## 3. Tune with the numbers

```bash
node .claude/skills/add-song/scripts/song-stats.js <song-id>
```

It prints notes per second for every difficulty, any check the tests would fail, a note if the Easy
density is unusual for the tier, and each theme's progression. Adjust the patterns using the "what
moves the numbers" table in the reference and re-run until there are no FAIL lines and the song
sits where its tier should: clearly busier than the tier below in its theme, calmer than the one
above. It takes a second, so iterate freely.

## 4. Test and listen

```bash
npm test
node .claude/skills/add-song/scripts/render-check.js --preview <scratchpad>/previews <song-id>
```

`npm test` checks every song's charts (density, lanes, long notes, Duo, touch). `render-check.js`
synthesises the song in a real browser, the way a phone does on first play, reports length,
loudness and build time, and saves an MP3 to listen to. Rendering takes 10–60 s per song, so pass
several ids in one call. The pack's songs sit around rms 0.12–0.17 with peaks under 1; a song far
outside that will sound noticeably quieter or louder than its neighbours.

For a new theme, also run `E2E_ONLY=records npm run e2e` (about a minute) and look at a
screenshot of the song list to make sure the new category, its heading colour and summary show.
The full browser run isn't needed for a song.

## 5. Publish

The user has said not to wait for their approval: once the checks pass, publish, then send the
previews and the explanation so they can listen and ask for changes afterwards.

1. Bump the version in all four places: `VERSION` in `js/main.js`, `V` in `sw.js`, `data-v` and
   every `?v=` in `index.html`, and `package.json` (`x.y.0`). `tests/version.test.js` fails if any
   disagree, and a missed `?v=` can leave phones running a half-updated game.
2. README: add the song to the theme table (tempo in brackets), add or update the theme row for
   a new theme, and add a changelog line under "Versions".
3. Run `npm test` again, then commit with a message naming the song(s) and push to the working branch.

## 6. Report

Send the MP3 preview(s) with SendUserFile, then tell the user in chat:

- What you made: title, theme, tier, tempo, key, sound, and one sentence on the musical idea.
- A table with notes per second on Easy, Medium, Medium+ and Hard (alongside the theme's other
  songs when it helps show the tier step).
- Length, first-play build time, the tests you ran, and the version it went out in.
- For retunes, the before → after numbers and the leaderboard note.
- Anything you did differently from what they asked, and why.

Then offer to change anything they'd like after listening; a change is just another version.
