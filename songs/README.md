# Bonus tracks

Recorded songs that ship with the game. They appear under **Song pack → Bonus tracks**,
and everyone gets identical charts, so their leaderboards are fair.

**Only add music you own or have permission to share.** This folder is published on a
public website.

## Adding songs

1. Put the MP3s in this folder. 128–192 kbps keeps downloads quick; a 3-minute song is
   about 3–4 MB. Set the Title and Artist tags if you can, because the game shows them.
2. Build the charts: `npm run build-charts` (needs [Node.js](https://nodejs.org) and
   [ffmpeg](https://ffmpeg.org)). This writes a `.chart.json` for each song and updates
   `index.json`.
3. Optionally edit `index.json` to fix a title or add a `credit` line, such as a license or
   a link to the artist. Re-running the build keeps your edits.
4. Commit and push. GitHub Pages republishes in a few minutes.

A song in `index.json` without a chart file still plays: the game builds its chart in
the player's browser. Pre-built charts are better, because everyone gets the same notes
and the song starts faster.
