/*
 * ShareCard — draws a pixel-art score card (for saving or sending) and builds
 * the challenge link friends can open.
 */
'use strict';
(function (root) {
  const W = 320;
  const H = 168;
  const SCALE = 3;
  const FONT = '"Press Start 2P", monospace';
  const LANES = ['#38d838', '#f83838', '#f8d830', '#3878f8', '#f88820'];

  function link(run) {
    const base = location.origin && location.origin !== 'null' ? location.origin + location.pathname : 'https://canaroo.github.io/lord/';
    return base + '#c=' + SaveData.encodeShare(run);
  }

  function fit(g, text, max) {
    let s = text;
    while (s.length > 3 && g.measureText(s).width > max) s = s.slice(0, -2) + '…';
    return s;
  }

  /** @returns {HTMLCanvasElement} full-size card */
  function draw(run) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const txt = (s, x, y, color, size = 8, align = 'left') => {
      g.font = `${size}px ${FONT}`;
      g.textAlign = align;
      g.textBaseline = 'top';
      g.fillStyle = '#08081a';
      g.fillText(s, x + 1, y + 1);
      g.fillStyle = color;
      g.fillText(s, x, y);
    };

    // Background bands and a strip of lane colours.
    const bands = ['#07071a', '#0d0c2a', '#14113a', '#1c154a', '#251a58'];
    bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, (i * H) / bands.length, W, H / bands.length + 1); });
    LANES.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * (W / 5), H - 6, W / 5, 6); });
    // Window frame.
    g.fillStyle = '#e6e8ff'; g.fillRect(6, 6, W - 12, 2); g.fillRect(6, H - 16, W - 12, 2);
    g.fillRect(6, 6, 2, H - 20); g.fillRect(W - 8, 6, 2, H - 20);

    txt('BEAT FRETS', 16, 16, '#f8d830');
    txt(run.initials, W - 16, 16, '#58f8f8', 8, 'right');
    g.font = `8px ${FONT}`;
    txt(fit(g, run.title.toUpperCase(), W - 32), 16, 34, '#f4f4ff');
    const kind = run.songKey.startsWith('pack:') ? ' · SONG PACK' : run.songKey.startsWith('bonus:') ? ' · BONUS TRACK' : ' · IMPORTED';
    txt(run.difficulty.toUpperCase() + kind, 16, 48, '#a8acd8');

    const gradeColor = run.grade === 'S' ? '#58f8f8' : run.grade === 'F' ? '#f84848' : '#f8d830';
    txt(run.grade, 22, 72, gradeColor, 40);
    txt(run.score.toLocaleString('en-US'), 84, 74, '#f4f4ff', 16);
    txt(`${run.accuracy.toFixed(1)}% ACC`, 84, 98, '#a8acd8');
    txt(`${run.maxCombo} STREAK`, 84, 112, '#a8acd8');
    if (run.fullCombo) txt('FULL COMBO!', W - 16, 112, '#f858c8', 8, 'right');
    txt('CAN YOU BEAT IT?', W / 2, 134, '#f8d830', 8, 'center');

    const out = document.createElement('canvas');
    out.width = W * SCALE;
    out.height = H * SCALE;
    const o = out.getContext('2d');
    o.imageSmoothingEnabled = false;
    o.drawImage(c, 0, 0, out.width, out.height);
    return out;
  }

  root.ShareCard = { draw, link };
})(window);
