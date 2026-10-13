/**
 * generateCard.js — EZ Manga  ·  v3 Production
 * ─────────────────────────────────────────────
 * npm install @napi-rs/canvas
 *
 * Exports:
 *   generateSingleCard(opts)  → Buffer (PNG)
 *   generateMultiCard(opts)   → Buffer (PNG)
 *
 * ── generateSingleCard(opts) ─────────────────
 * opts = {
 *   title:      string   (required)
 *   author:     string
 *   synopsis:   string
 *   genres:     string[]           e.g. ["ACTION","FANTASY"]
 *   chapters:   string             default "01"
 *   status:     string             default "ONGOING"
 *   translator: string             default "EZ TEAM"
 *   type:       string             default "MANGA"
 *   date:       string             default today
 *   coverUrl:   string | null      remote image URL
 *   accent:     [R, G, B]          default [232,0,29]
 * }
 *
 * ── generateMultiCard(opts) ──────────────────
 * opts = {
 *   works: [
 *     { title, author, genre, synopsis }
 *     ...up to 4
 *   ]
 *   headerTitle: string
 *   date:        string
 * }
 */

'use strict';

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const https = require('https');
const http  = require('http');

// ── Fetch remote image ────────────────────────────────────────────────────────
function fetchImage(url) {
  return new Promise((res, rej) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, r => {
      const c = [];
      r.on('data', d => c.push(d));
      r.on('end',  () => res(Buffer.concat(c)));
      r.on('error', rej);
    }).on('error', rej);
  });
}

// ── Rounded rect path ─────────────────────────────────────────────────────────
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

// ── Word-wrap ─────────────────────────────────────────────────────────────────
function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '', curY = y;
  for (const word of words) {
    const t = line + word + ' ';
    if (ctx.measureText(t).width > maxW && line) {
      ctx.fillText(line.trim(), x, curY);
      line = word + ' '; curY += lineH;
    } else line = t;
  }
  ctx.fillText(line.trim(), x, curY);
  return curY;
}

// ── Seeded grain ──────────────────────────────────────────────────────────────
function drawGrain(ctx, W, H, seed) {
  let s = seed || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
  for (let i = 0; i < 2800; i++) {
    ctx.beginPath();
    ctx.arc(rnd() * W, rnd() * H, rnd() * 1.2 + 0.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`; ctx.fill();
  }
}

// ── Ink brush stroke ──────────────────────────────────────────────────────────
function drawInkStroke(ctx, x, y, w, h, rgb, alpha) {
  alpha = alpha || 0.15;
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0,    'transparent');
  g.addColorStop(0.08, `rgba(${rgb},${alpha})`);
  g.addColorStop(0.45, `rgba(${rgb},${alpha * 1.35})`);
  g.addColorStop(0.75, `rgba(${rgb},${alpha * 0.55})`);
  g.addColorStop(1,    'transparent');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.3);
  ctx.quadraticCurveTo(x + w * 0.2, y,            x + w * 0.5, y + h * 0.12);
  ctx.quadraticCurveTo(x + w * 0.8, y + h * 0.05, x + w,       y + h * 0.28);
  ctx.lineTo(x + w, y + h * 0.75);
  ctx.quadraticCurveTo(x + w * 0.75, y + h,       x + w * 0.4, y + h * 0.88);
  ctx.quadraticCurveTo(x + w * 0.15, y + h * 0.95, x,          y + h * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Speed lines ───────────────────────────────────────────────────────────────
function speedLines(ctx, cx, cy, count, len, opacity) {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.strokeStyle = `rgba(255,255,255,${opacity})`; ctx.lineWidth = 0.6; ctx.stroke();
  }
  ctx.restore();
}

// ── Scanlines ─────────────────────────────────────────────────────────────────
function drawScanlines(ctx, W, H) {
  for (let y = 0; y < H; y += 4) {
    ctx.fillStyle = 'rgba(0,0,0,0.055)'; ctx.fillRect(0, y, W, 1);
  }
}

// ── Cover placeholder ─────────────────────────────────────────────────────────
function drawCoverPlaceholder(ctx, CX, CY, CW, CH, accent) {
  const [R, G, B] = accent;
  const rgb = accent.join(',');

  const cpg = ctx.createLinearGradient(CX, CY, CX + CW, CY + CH);
  cpg.addColorStop(0,   `rgba(${R},${Math.floor(G * 0.15)},${Math.floor(B * 0.15)},0.38)`);
  cpg.addColorStop(0.4, 'rgba(8,8,18,0.95)');
  cpg.addColorStop(1,   'rgba(2,2,8,1)');
  ctx.fillStyle = cpg; ctx.fillRect(CX, CY, CW, CH);

  speedLines(ctx, CX + CW / 2, CY + CH / 2, 48, CH, 0.07);

  for (let hx = CX + 8; hx < CX + CW - 8; hx += 11) {
    for (let hy = CY + 8; hy < CY + CH - 8; hy += 11) {
      const dx = (hx - CX - CW / 2) / (CW / 2);
      const dy = (hy - CY - CH / 2) / (CH / 2);
      const r2 = Math.max(0, (1 - Math.sqrt(dx * dx + dy * dy)) * 2.5);
      if (r2 < 0.25) continue;
      ctx.beginPath(); ctx.arc(hx, hy, Math.min(r2, 2.8), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb},0.11)`; ctx.fill();
    }
  }

  ctx.font = `bold ${Math.floor(CW * 0.62)}px serif`;
  ctx.fillStyle = `rgba(${rgb},0.055)`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('EZ', CX + CW / 2, CY + CH * 0.44);

  ctx.font = 'bold 9px monospace';
  ctx.fillStyle = `rgba(${rgb},0.35)`;
  ctx.fillText('[ COVER ART ]', CX + CW / 2, CY + CH * 0.78);
}


// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SINGLE CARD  —  1000 × 440                                                ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
async function generateSingleCard(opts) {
  opts = opts || {};
  const title      = opts.title      || 'Untitled';
  const author     = opts.author     || '';
  const synopsis   = opts.synopsis   || '';
  const genres     = opts.genres     || [];
  const chapters   = opts.chapters   || '01';
  const status     = opts.status     || 'ONGOING';
  const translator = opts.translator || 'EZ TEAM';
  const type       = opts.type       || 'MANGA';
  const coverUrl   = opts.coverUrl   || null;
  const accent     = opts.accent     || [232, 0, 29];
  const date       = opts.date       || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

  const W = 1000, H = 440;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  const [R, G, B] = accent;
  const rgb = accent.join(',');

  // ── BACKGROUND ──────────────────────────────────────────────────────────────
  ctx.fillStyle = '#050509'; ctx.fillRect(0, 0, W, H);

  const neb1 = ctx.createRadialGradient(W * 0.72, H * 0.28, 0, W * 0.72, H * 0.28, W * 0.55);
  neb1.addColorStop(0, `rgba(${R},${Math.floor(G * 0.3)},${Math.floor(B * 0.3)},0.12)`);
  neb1.addColorStop(1, 'transparent');
  ctx.fillStyle = neb1; ctx.fillRect(0, 0, W, H);

  const neb2 = ctx.createRadialGradient(W * 0.12, H * 0.85, 0, W * 0.12, H * 0.85, W * 0.38);
  neb2.addColorStop(0, `rgba(${R},${Math.floor(G * 0.2)},${Math.floor(B * 0.2)},0.06)`);
  neb2.addColorStop(1, 'transparent');
  ctx.fillStyle = neb2; ctx.fillRect(0, 0, W, H);

  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.025)'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 52) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 52) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();

  ctx.save();
  for (let i = -5; i <= 9; i++) {
    const gd = ctx.createLinearGradient(i * 190, 0, i * 190 + 80, 0);
    gd.addColorStop(0, 'transparent'); gd.addColorStop(0.5, 'rgba(255,255,255,0.011)'); gd.addColorStop(1, 'transparent');
    ctx.fillStyle = gd; ctx.save(); ctx.transform(1, 0, -0.28, 1, 0, 0);
    ctx.fillRect(i * 190 - 10, 0, 90, H); ctx.restore();
  }
  ctx.restore();

  speedLines(ctx, 190, H / 2, 72, W * 1.1, 0.022);
  drawScanlines(ctx, W, H);

  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.85);
  vig.addColorStop(0, 'transparent'); vig.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

  drawGrain(ctx, W, H, 42);

  // ── COVER ───────────────────────────────────────────────────────────────────
  const CX = 28, CY = 24, CW = 268, CH = H - 48;

  for (let i = 5; i >= 1; i--) {
    const gg = ctx.createRadialGradient(CX + CW / 2, CY + CH * 0.6, 10, CX + CW / 2, CY + CH * 0.4, CH * (0.5 + i * 0.08));
    gg.addColorStop(0, `rgba(${rgb},${0.04 * i})`); gg.addColorStop(1, 'transparent');
    ctx.fillStyle = gg; ctx.fillRect(CX - i * 8, CY - i * 5, CW + i * 16, CH + i * 10);
  }

  rr(ctx, CX, CY, CW, CH, 10); ctx.save(); ctx.clip();

  let coverLoaded = false;
  if (coverUrl) {
    try {
      const buf = await fetchImage(coverUrl);
      const img = await loadImage(buf);
      ctx.drawImage(img, CX, CY, CW, CH);
      const cf2 = ctx.createLinearGradient(CX, CY + CH * 0.55, CX, CY + CH);
      cf2.addColorStop(0, 'transparent'); cf2.addColorStop(1, 'rgba(3,3,10,0.78)');
      ctx.fillStyle = cf2; ctx.fillRect(CX, CY, CW, CH);
      coverLoaded = true;
    } catch (_) {}
  }

  if (!coverLoaded) {
    drawCoverPlaceholder(ctx, CX, CY, CW, CH, accent);
    const cf = ctx.createLinearGradient(CX, CY + CH * 0.55, CX, CY + CH);
    cf.addColorStop(0, 'transparent'); cf.addColorStop(1, 'rgba(3,3,10,0.88)');
    ctx.fillStyle = cf; ctx.fillRect(CX, CY, CW, CH);
  }
  ctx.restore();

  // Cover border
  rr(ctx, CX, CY, CW, CH, 10);
  const cb = ctx.createLinearGradient(CX, CY, CX + CW, CY + CH);
  cb.addColorStop(0, `rgba(${rgb},0.8)`); cb.addColorStop(0.4, `rgba(${rgb},0.32)`); cb.addColorStop(1, `rgba(${rgb},0.55)`);
  ctx.strokeStyle = cb; ctx.lineWidth = 1.5; ctx.stroke();

  // Corner brackets
  ctx.strokeStyle = `rgba(${rgb},0.9)`; ctx.lineWidth = 2;
  const bL = 14;
  [[CX, CY, 1, 1], [CX + CW, CY, -1, 1], [CX, CY + CH, 1, -1], [CX + CW, CY + CH, -1, -1]].forEach(([x, y, dx, dy]) => {
    ctx.beginPath(); ctx.moveTo(x, y + dy * bL); ctx.lineTo(x, y); ctx.lineTo(x + dx * bL, y); ctx.stroke();
  });

  // Volume badge
  ctx.save();
  rr(ctx, CX + 10, CY + CH - 38, 58, 22, 3);
  ctx.fillStyle = `rgba(${rgb},0.85)`; ctx.fill();
  ctx.font = 'bold 8px monospace'; ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(`VOL.01 CH.${chapters}`, CX + 17, CY + CH - 22);
  ctx.restore();

  // Separator
  const sepX = CX + CW + 32;
  const sepG = ctx.createLinearGradient(sepX, CY, sepX, CY + CH);
  sepG.addColorStop(0, 'transparent'); sepG.addColorStop(0.2, `rgba(${rgb},0.4)`);
  sepG.addColorStop(0.8, `rgba(${rgb},0.25)`); sepG.addColorStop(1, 'transparent');
  ctx.fillStyle = sepG; ctx.fillRect(sepX, CY, 1, CH);

  // ── CONTENT ─────────────────────────────────────────────────────────────────
  const TX = sepX + 28, TW = W - TX - 28;

  drawInkStroke(ctx, TX - 10, 88, TW + 20, 72, rgb, 0.13);

  // Badge + team
  ctx.save();
  ctx.font = 'bold 8.5px monospace';
  const bTxt = '✦  NEW SERIES';
  const bW   = ctx.measureText(bTxt).width + 18;
  rr(ctx, TX, 26, bW, 19, 3);
  const bg2 = ctx.createLinearGradient(TX, 26, TX + bW, 45);
  bg2.addColorStop(0, `rgba(${rgb},0.25)`); bg2.addColorStop(1, `rgba(${rgb},0.08)`);
  ctx.fillStyle = bg2; ctx.fill();
  rr(ctx, TX, 26, bW, 19, 3);
  ctx.strokeStyle = `rgba(${rgb},0.8)`; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = `rgb(${rgb})`; ctx.fillText(bTxt, TX + 9, 39);
  ctx.font = '8.5px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillText('EZ MANGA TRANSLATION TEAM', TX + bW + 12, 39);
  ctx.restore();

  ctx.save(); ctx.font = '9px monospace'; ctx.fillStyle = `rgba(${rgb},0.55)`;
  ctx.fillText(`CHAPTER ${chapters}  ·  ${date}  ·  ${status}`, TX, 62); ctx.restore();

  // Title
  ctx.save();
  let tSz = 52; ctx.font = `bold ${tSz}px serif`;
  while (ctx.measureText(title).width > TW && tSz > 26) { tSz -= 2; ctx.font = `bold ${tSz}px serif`; }

  ctx.shadowColor = `rgba(${rgb},0.4)`; ctx.shadowBlur = 22;
  const titleGrad = ctx.createLinearGradient(TX, 80, TX + TW * 0.8, 80 + tSz);
  titleGrad.addColorStop(0,    '#ffffff');
  titleGrad.addColorStop(0.35, '#f0f0f0');
  titleGrad.addColorStop(0.6,  `rgb(${rgb})`);
  titleGrad.addColorStop(0.82, '#ffffff');
  titleGrad.addColorStop(1,    `rgba(${rgb},0.7)`);
  ctx.fillStyle = titleGrad;

  let tY = 112, tL = '';
  for (const w of title.split(' ')) {
    const t = tL + w + ' ';
    if (ctx.measureText(t).width > TW && tL) { ctx.fillText(tL.trim(), TX, tY); tL = w + ' '; tY += tSz * 1.18; }
    else tL = t;
  }
  ctx.fillText(tL.trim(), TX, tY);
  ctx.shadowBlur = 0;
  const postTitle = tY + tSz * 0.32;
  ctx.restore();

  // Accent rule
  const lW = Math.min(TW * 0.7, 340);
  const lg = ctx.createLinearGradient(TX, 0, TX + lW, 0);
  lg.addColorStop(0, `rgb(${rgb})`); lg.addColorStop(0.5, `rgba(${rgb},0.35)`); lg.addColorStop(1, 'transparent');
  ctx.fillStyle = lg; ctx.fillRect(TX, postTitle + 6, lW, 1.5);
  ctx.save(); ctx.translate(TX - 1, postTitle + 6.75); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = `rgb(${rgb})`; ctx.fillRect(-3, -3, 6, 6); ctx.restore();

  // Author
  if (author) {
    ctx.save(); ctx.font = 'bold 13px monospace'; ctx.fillStyle = `rgba(${rgb},0.9)`;
    ctx.fillText(author, TX, postTitle + 26); ctx.restore();
  }

  // Genre tags
  if (genres.length) {
    ctx.save(); ctx.font = 'bold 8.5px monospace';
    let gx = TX;
    for (const genre of genres) {
      const gW = ctx.measureText(genre).width + 14;
      rr(ctx, gx, postTitle + 36, gW, 17, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
      rr(ctx, gx, postTitle + 36, gW, 17, 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillText(genre, gx + 7, postTitle + 49);
      gx += gW + 7;
    }
    ctx.restore();
  }

  // Synopsis
  if (synopsis) {
    ctx.save(); ctx.font = '13px serif'; ctx.fillStyle = 'rgba(255,255,255,0.35)';
    wrapText(ctx, synopsis, TX, postTitle + (genres.length ? 72 : 54), TW, 21);
    ctx.restore();
  }

  // Stats bar
  const statsY = H - 72;
  ctx.save();
  rr(ctx, TX, statsY, TW, 48, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.032)'; ctx.fill();
  rr(ctx, TX, statsY, TW, 48, 5);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();

  const stats = [
    { icon: '◈', label: 'CHAPTERS',   val: chapters  },
    { icon: '◉', label: 'STATUS',     val: status    },
    { icon: '◆', label: 'TRANSLATOR', val: translator },
    { icon: '◇', label: 'TYPE',       val: type      },
  ];
  const colW = TW / stats.length;
  stats.forEach((st, i) => {
    const sx = TX + i * colW + 14;
    ctx.font = 'bold 8px monospace'; ctx.fillStyle = `rgba(${rgb},0.65)`;
    ctx.fillText(`${st.icon} ${st.label}`, sx, statsY + 17);
    ctx.font = 'bold 11px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(st.val, sx, statsY + 34);
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(TX + i * colW, statsY + 8); ctx.lineTo(TX + i * colW, statsY + 40); ctx.stroke();
    }
  });
  ctx.restore();

  // ── CHROME ──────────────────────────────────────────────────────────────────
  const topBar = ctx.createLinearGradient(0, 0, W, 0);
  topBar.addColorStop(0,    `rgb(${rgb})`);
  topBar.addColorStop(0.45, `rgba(${rgb},0.55)`);
  topBar.addColorStop(0.75, `rgba(${rgb},0.2)`);
  topBar.addColorStop(1,    'transparent');
  ctx.fillStyle = topBar; ctx.fillRect(0, 0, W, 3);

  const botBar = ctx.createLinearGradient(0, 0, W, 0);
  botBar.addColorStop(0,   'transparent');
  botBar.addColorStop(0.3, `rgba(${rgb},0.5)`);
  botBar.addColorStop(0.5, `rgb(${rgb})`);
  botBar.addColorStop(0.7, `rgba(${rgb},0.5)`);
  botBar.addColorStop(1,   'transparent');
  ctx.fillStyle = botBar; ctx.fillRect(0, H - 3, W, 3);

  rr(ctx, 0.5, 0.5, W - 1, H - 1, 6);
  const cardB = ctx.createLinearGradient(0, 0, W, H);
  cardB.addColorStop(0,   `rgba(${rgb},0.45)`);
  cardB.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  cardB.addColorStop(1,   `rgba(${rgb},0.2)`);
  ctx.strokeStyle = cardB; ctx.lineWidth = 1; ctx.stroke();

  ctx.strokeStyle = `rgba(${rgb},0.6)`; ctx.lineWidth = 1.8;
  const CL = 22;
  [[1, 1, 1, 1], [W - 1, 1, -1, 1], [1, H - 1, 1, -1], [W - 1, H - 1, -1, -1]].forEach(([x, y, dx, dy]) => {
    ctx.beginPath(); ctx.moveTo(x, y + dy * CL); ctx.lineTo(x, y); ctx.lineTo(x + dx * CL, y); ctx.stroke();
  });

  ctx.save(); ctx.font = 'bold 8px monospace'; ctx.fillStyle = `rgba(${rgb},0.4)`;
  ctx.fillText('EZ', CX, H - 10);
  ctx.font = '8px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillText('MANGA  ·  FREE TRANSLATIONS', CX + 20, H - 10);
  ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillText(date, W - 22, H - 10);
  ctx.restore();

  return canvas.encode('png');
}


// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  MULTI CARD  —  1200 × 520                                                 ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
async function generateMultiCard(opts) {
  opts = opts || {};
  const works       = opts.works       || [];
  const headerTitle = opts.headerTitle || 'NEW RELEASES';
  const date        = opts.date        || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

  const W = 1200, H = 520;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  const PALS   = [[232, 0, 29], [59, 130, 246], [245, 158, 11], [34, 197, 94]];

  ctx.fillStyle = '#050509'; ctx.fillRect(0, 0, W, H);

  const atm = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.65);
  atm.addColorStop(0, 'rgba(232,0,29,0.07)'); atm.addColorStop(1, 'transparent');
  ctx.fillStyle = atm; ctx.fillRect(0, 0, W, H);

  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.022)'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 52) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 52) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();

  ctx.save();
  for (let i = -5; i <= 9; i++) {
    const gd = ctx.createLinearGradient(i * 190, 0, i * 190 + 80, 0);
    gd.addColorStop(0, 'transparent'); gd.addColorStop(0.5, 'rgba(255,255,255,0.01)'); gd.addColorStop(1, 'transparent');
    ctx.fillStyle = gd; ctx.save(); ctx.transform(1, 0, -0.28, 1, 0, 0);
    ctx.fillRect(i * 190 - 10, 0, 90, H); ctx.restore();
  }
  ctx.restore();

  speedLines(ctx, W / 2, -40, W, H, 80, 0.02);
  drawScanlines(ctx, W, H);

  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.9);
  vig.addColorStop(0, 'transparent'); vig.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
  drawGrain(ctx, W, H, 13);

  // Header
  const topBar = ctx.createLinearGradient(0, 0, W, 0);
  topBar.addColorStop(0, '#e8001d'); topBar.addColorStop(0.55, 'rgba(232,0,29,0.4)'); topBar.addColorStop(1, 'transparent');
  ctx.fillStyle = topBar; ctx.fillRect(0, 0, W, 3);

  ctx.save(); ctx.font = 'bold 11px monospace'; ctx.fillStyle = '#e8001d';
  ctx.fillText('EZ MANGA', 38, 46);
  ctx.font = '9px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillText('TRANSLATION TEAM', 38, 63); ctx.restore();

  ctx.save(); ctx.font = 'bold 9px monospace';
  const cTxt = `${works.length} NEW SERIES`;
  const cW   = ctx.measureText(cTxt).width + 20;
  rr(ctx, W - cW - 36, 22, cW, 22, 3);
  ctx.fillStyle = 'rgba(232,0,29,0.15)'; ctx.fill();
  rr(ctx, W - cW - 36, 22, cW, 22, 3);
  ctx.strokeStyle = 'rgba(232,0,29,0.7)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#e8001d'; ctx.fillText(cTxt, W - cW - 36 + 10, 37);
  ctx.font = '9px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.textAlign = 'right'; ctx.fillText(date, W - 36, 59); ctx.restore();

  drawInkStroke(ctx, 28, 72, W * 0.55, 58, '232,0,29', 0.1);
  ctx.save(); ctx.font = 'bold 38px serif';
  ctx.shadowColor = 'rgba(232,0,29,0.35)'; ctx.shadowBlur = 24;
  const htG = ctx.createLinearGradient(38, 80, 500, 120);
  htG.addColorStop(0, '#ffffff'); htG.addColorStop(0.5, 'rgb(232,0,29)'); htG.addColorStop(1, '#ffffff');
  ctx.fillStyle = htG; ctx.fillText(headerTitle, 38, 118);
  ctx.shadowBlur = 0; ctx.restore();

  const divG = ctx.createLinearGradient(38, 0, W - 38, 0);
  divG.addColorStop(0, 'rgba(232,0,29,0.65)'); divG.addColorStop(0.4, 'rgba(232,0,29,0.2)');
  divG.addColorStop(0.8, 'rgba(255,255,255,0.06)'); divG.addColorStop(1, 'transparent');
  ctx.fillStyle = divG; ctx.fillRect(38, 132, W - 76, 1);
  ctx.save(); ctx.translate(32, 132.5); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#e8001d'; ctx.fillRect(-3.5, -3.5, 7, 7); ctx.restore();

  // Panels
  const GAP  = 16;
  const pW   = Math.floor((W - GAP * (works.length + 1)) / works.length);
  const pTop = 152, pH = H - pTop - 36;

  for (let i = 0; i < works.length; i++) {
    const pal = PALS[i % PALS.length];
    const PR  = pal.join(',');
    const px  = GAP + i * (pW + GAP), py = pTop;

    const pg = ctx.createRadialGradient(px + pW / 2, py + pH, 10, px + pW / 2, py + pH * 0.4, pH * 0.9);
    pg.addColorStop(0, `rgba(${PR},0.07)`); pg.addColorStop(1, 'transparent');
    ctx.fillStyle = pg; ctx.fillRect(px - 10, py - 10, pW + 20, pH + 20);

    rr(ctx, px, py, pW, pH, 8);
    const pbg = ctx.createLinearGradient(px, py, px, py + pH);
    pbg.addColorStop(0, 'rgba(255,255,255,0.055)'); pbg.addColorStop(1, 'rgba(255,255,255,0.01)');
    ctx.fillStyle = pbg; ctx.fill();

    rr(ctx, px, py, pW, pH, 8); ctx.save(); ctx.clip();
    const pbg2 = ctx.createLinearGradient(px, py + pH * 0.5, px, py + pH);
    pbg2.addColorStop(0, 'transparent'); pbg2.addColorStop(1, `rgba(${PR},0.12)`);
    ctx.fillStyle = pbg2; ctx.fillRect(px, py, pW, pH); ctx.restore();

    for (let hx = px + 5; hx < px + pW - 5; hx += 13) {
      for (let hy = py + 5; hy < py + pH - 5; hy += 13) {
        const dx = (hx - px - pW / 2) / (pW / 2);
        const dy = (hy - py - pH / 2) / (pH / 2);
        const r2 = Math.max(0, (1 - Math.sqrt(dx * dx + dy * dy)) * 2.2);
        if (r2 < 0.2) continue;
        ctx.beginPath(); ctx.arc(hx, hy, Math.min(r2, 2.4), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${PR},0.08)`; ctx.fill();
      }
    }

    rr(ctx, px, py, pW, pH, 8);
    const pbd = ctx.createLinearGradient(px, py, px, py + pH);
    pbd.addColorStop(0,   `rgba(${PR},0.6)`);
    pbd.addColorStop(0.5, `rgba(${PR},0.2)`);
    pbd.addColorStop(1,   `rgba(${PR},0.4)`);
    ctx.strokeStyle = pbd; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.fillStyle = `rgb(${PR})`; rr(ctx, px, py + 18, 3, pH - 36, 2); ctx.fill();

    ctx.save(); ctx.font = 'bold 8px monospace';
    const nTxt = `0${i + 1}`;
    const nW   = ctx.measureText(nTxt).width + 12;
    rr(ctx, px + 14, py + 14, nW, 16, 2);
    ctx.fillStyle = `rgba(${PR},0.2)`; ctx.fill();
    rr(ctx, px + 14, py + 14, nW, 16, 2);
    ctx.strokeStyle = `rgba(${PR},0.65)`; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.fillStyle = `rgb(${PR})`; ctx.fillText(nTxt, px + 20, py + 26); ctx.restore();

    ctx.save(); ctx.font = 'bold 18px serif';
    ctx.shadowColor = `rgba(${PR},0.3)`; ctx.shadowBlur = 10;
    const titG = ctx.createLinearGradient(px + 14, py + 45, px + 14 + pW * 0.8, py + 45 + 22);
    titG.addColorStop(0, '#ffffff'); titG.addColorStop(0.6, `rgb(${PR})`); titG.addColorStop(1, '#ffffff');
    ctx.fillStyle = titG;
    let tY2 = py + 50, tL2 = '';
    for (const w of (works[i].title || '').split(' ')) {
      const t = tL2 + w + ' ';
      if (ctx.measureText(t).width > pW - 30 && tL2) { ctx.fillText(tL2.trim(), px + 18, tY2); tL2 = w + ' '; tY2 += 21; }
      else tL2 = t;
    }
    ctx.fillText(tL2.trim(), px + 18, tY2); ctx.shadowBlur = 0; ctx.restore();

    const ulG = ctx.createLinearGradient(px + 18, 0, px + 18 + pW * 0.65, 0);
    ulG.addColorStop(0, `rgb(${PR})`); ulG.addColorStop(1, 'transparent');
    ctx.fillStyle = ulG; ctx.fillRect(px + 18, tY2 + 5, pW * 0.65, 1.2);

    if (works[i].author) {
      ctx.save(); ctx.font = '10px monospace'; ctx.fillStyle = `rgba(${PR},0.8)`;
      ctx.fillText(works[i].author, px + 18, tY2 + 21); ctx.restore();
    }

    if (works[i].synopsis) {
      ctx.save(); ctx.font = '11px serif'; ctx.fillStyle = 'rgba(255,255,255,0.28)';
      wrapText(ctx, works[i].synopsis, px + 18, tY2 + 38, pW - 32, 18); ctx.restore();
    }

    if (works[i].genre) {
      ctx.save(); ctx.font = 'bold 8px monospace';
      const gTxt = works[i].genre.toUpperCase();
      const gW   = ctx.measureText(gTxt).width + 12;
      rr(ctx, px + 18, py + pH - 30, gW, 18, 2);
      ctx.fillStyle = `rgba(${PR},0.15)`; ctx.fill();
      rr(ctx, px + 18, py + pH - 30, gW, 18, 2);
      ctx.strokeStyle = `rgba(${PR},0.55)`; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.fillStyle = `rgb(${PR})`; ctx.fillText(gTxt, px + 24, py + pH - 17); ctx.restore();
    }

    ctx.strokeStyle = `rgba(${PR},0.5)`; ctx.lineWidth = 1.2;
    const pCL = 9;
    [[px + 2, py + 2, 1, 1], [px + pW - 2, py + 2, -1, 1], [px + 2, py + pH - 2, 1, -1], [px + pW - 2, py + pH - 2, -1, -1]].forEach(([x, y, dx, dy]) => {
      ctx.beginPath(); ctx.moveTo(x, y + dy * pCL); ctx.lineTo(x, y); ctx.lineTo(x + dx * pCL, y); ctx.stroke();
    });
  }

  // Chrome
  const bb = ctx.createLinearGradient(0, 0, W, 0);
  bb.addColorStop(0, 'transparent'); bb.addColorStop(0.5, '#e8001d'); bb.addColorStop(1, 'transparent');
  ctx.fillStyle = bb; ctx.fillRect(0, H - 3, W, 3);

  ctx.save(); ctx.font = 'bold 8px monospace'; ctx.fillStyle = 'rgba(232,0,29,0.4)';
  ctx.fillText('EZ', 38, H - 11);
  ctx.font = '8px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillText('MANGA  ·  FREE TRANSLATIONS', 60, H - 11); ctx.restore();

  rr(ctx, 0.5, 0.5, W - 1, H - 1, 6);
  const ob = ctx.createLinearGradient(0, 0, W, H);
  ob.addColorStop(0, 'rgba(232,0,29,0.35)'); ob.addColorStop(0.5, 'rgba(255,255,255,0.04)'); ob.addColorStop(1, 'rgba(232,0,29,0.15)');
  ctx.strokeStyle = ob; ctx.lineWidth = 1; ctx.stroke();

  ctx.strokeStyle = 'rgba(232,0,29,0.55)'; ctx.lineWidth = 1.8;
  const OCL = 22;
  [[1, 1, 1, 1], [W - 1, 1, -1, 1], [1, H - 1, 1, -1], [W - 1, H - 1, -1, -1]].forEach(([x, y, dx, dy]) => {
    ctx.beginPath(); ctx.moveTo(x, y + dy * OCL); ctx.lineTo(x, y); ctx.lineTo(x + dx * OCL, y); ctx.stroke();
  });

  return canvas.encode('png');
}

module.exports = { generateSingleCard, generateMultiCard };
