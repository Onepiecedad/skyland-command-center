#!/usr/bin/env node
/**
 * Skyland karusellgenerator — JSON-copy in, Instagram-klara PNG:er ut (1080×1350).
 *
 * Användning:
 *   node build.mjs slides.example.json        → out/slide-01.png … slide-NN.png
 *   node build.mjs min-karusell.json --html   → bara HTML (ingen Chrome-rendering)
 *
 * Kräver Google Chrome (macOS-default; överstyr med CHROME_PATH).
 * Markup i texter: ~orange~  *fet*  _kursiv_  \n = radbrytning.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const W = 1080, H = 1350;

// ── Designsystem (matchar Opus-originalen) ──────────────────────────────
const C = {
  bg: '#0e1013',
  cream: '#f4f1e8',
  gray: '#8e8b7e',
  orange: '#e9a23b',
  card: '#1a1d22',
  line: 'rgba(244,241,232,0.16)',
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** ~orange~ *fet* _kursiv_ → spans. Körs EFTER esc. */
function markup(s) {
  return esc(s)
    .replace(/~([^~]+)~/g, `<span style="color:${C.orange}">$1</span>`)
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

const HEADLINE_SIZES = { l: 104, m: 84, s: 68 };
const SUB_SIZES = { l: 56, s: 44 };

function renderBlock(b) {
  const kind = b.kind;
  if (kind === 'kicker') {
    const color = b.color === 'gray' ? C.gray : C.orange;
    return `<div class="kicker" style="color:${color}">${markup(b.text)}</div>`;
  }
  if (kind === 'headline') {
    const size = HEADLINE_SIZES[b.size || 'l'] || HEADLINE_SIZES.l;
    return `<h1 style="font-size:${size}px">${markup(b.text)}</h1>`;
  }
  if (kind === 'sub') {
    const size = SUB_SIZES[b.size || 'l'] || SUB_SIZES.l;
    return `<div class="sub" style="font-size:${size}px">${markup(b.text)}</div>`;
  }
  if (kind === 'note') {
    const color = b.color === 'gray' ? C.gray : C.cream;
    const style = `color:${color};${b.italic ? 'font-style:italic;font-weight:400;' : ''}`;
    return `<div class="note" style="${style}">${markup(b.text)}</div>`;
  }
  if (kind === 'calc') {
    return `<div class="calc">${markup(b.text)}</div>`;
  }
  if (kind === 'bignumber') {
    const suffix = b.suffix ? `<span class="bignum-suffix">${esc(b.suffix)}</span>` : '';
    return `<div class="bignum">${markup(b.text)}${suffix}</div>`;
  }
  if (kind === 'card') {
    return `<div class="card"><div class="card-header">${markup(b.header || '')}</div><div class="card-text">${markup(b.text)}</div></div>`;
  }
  if (kind === 'pills') {
    const pills = (b.items || []).map((item, i) => {
      const active = i === (b.active ?? -1);
      const style = active
        ? `border:2px solid ${C.orange};color:${C.orange};font-weight:700;`
        : `border:1px solid ${C.line};color:${C.gray};`;
      return `<div class="pill" style="${style}">${esc(item)}</div>`;
    }).join('');
    return `<div class="pills">${pills}</div>`;
  }
  if (kind === 'quote') {
    return `<div class="quote"><div class="quote-lead">${markup(b.lead || '')}</div><div class="quote-text">${markup(b.text)}</div></div>`;
  }
  if (kind === 'cta') {
    return `<div class="cta">${markup(b.text)}</div>`;
  }
  if (kind === 'footer') {
    return `<div class="footer-line">${markup(b.text)}</div>`;
  }
  if (kind === 'spacer') {
    return `<div style="height:${b.px || 40}px"></div>`;
  }
  throw new Error(`Okänd block-typ: ${kind}`);
}

function renderSlide(slide, index, total, brand) {
  const num = String(index + 1).padStart(2, '0');
  const tot = String(total).padStart(2, '0');
  const blocks = slide.blocks.map(renderBlock).join('\n');
  const progress = Array.from({ length: total }, (_, i) =>
    `<div class="seg" style="background:${i === index ? C.orange : 'rgba(244,241,232,0.18)'}"></div>`
  ).join('');

  return `<!doctype html>
<html lang="sv"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,400;0,600;0,700;0,800;0,900;1,400&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${W}px; height:${H}px; overflow:hidden; }
  body {
    background:${C.bg}; color:${C.cream};
    font-family:'Archivo',-apple-system,sans-serif;
    display:flex; flex-direction:column;
    padding:84px 96px 72px;
  }
  .top { display:flex; justify-content:space-between; align-items:baseline;
         font-family:'Space Mono',monospace; font-size:26px; letter-spacing:6px; }
  .top .brand { color:${C.cream}; font-weight:700; }
  .top .page { color:${C.gray}; letter-spacing:8px; }
  .top-rule { border-top:1px solid ${C.line}; margin-top:28px; }
  .content { flex:1; display:flex; flex-direction:column; justify-content:center; gap:44px; }
  .kicker { font-family:'Space Mono',monospace; font-size:28px; letter-spacing:8px; text-transform:uppercase; }
  h1 { font-weight:800; line-height:1.08; letter-spacing:-1px; }
  .sub { color:${C.gray}; font-weight:600; line-height:1.22; }
  .sub strong { color:${C.gray}; font-weight:800; }
  .note { font-size:38px; font-weight:700; line-height:1.3; }
  .calc { font-family:'Space Mono',monospace; font-size:30px; letter-spacing:6px; color:${C.gray}; text-transform:uppercase; }
  .bignum { font-size:170px; font-weight:900; color:${C.orange}; letter-spacing:-2px; line-height:1; }
  .bignum-suffix { font-size:64px; font-weight:800; margin-left:12px; }
  .card { background:${C.card}; border-radius:24px; padding:40px 44px; max-width:860px; }
  .card-header { font-family:'Space Mono',monospace; font-size:26px; letter-spacing:5px; color:${C.orange}; margin-bottom:22px; }
  .card-text { font-size:46px; color:${C.cream}; opacity:0.92; line-height:1.3; }
  .pills { display:flex; gap:24px; }
  .pill { flex:1; text-align:center; padding:30px 0; border-radius:16px;
          font-family:'Space Mono',monospace; font-size:28px; letter-spacing:5px; }
  .quote { border-left:4px solid ${C.orange}; padding-left:36px; }
  .quote-lead { font-size:40px; font-weight:800; margin-bottom:8px; }
  .quote-text { font-size:40px; color:${C.gray}; line-height:1.35; }
  .cta { display:inline-flex; align-self:flex-start; background:${C.orange}; color:#12100b;
         font-size:44px; font-weight:800; padding:34px 56px; border-radius:999px; }
  .cta strong { font-family:'Space Mono',monospace; font-weight:700; }
  .footer-line { font-family:'Space Mono',monospace; font-size:26px; letter-spacing:6px; color:${C.gray}; }
  .progress { display:flex; gap:18px; margin-top:36px; }
  .seg { flex:1; height:4px; border-radius:2px; }
</style></head>
<body>
  <div class="top"><span class="brand">${esc(brand)}</span><span class="page">${num} / ${tot}</span></div>
  <div class="top-rule"></div>
  <div class="content">
${blocks}
  </div>
  <div class="progress">${progress}</div>
</body></html>`;
}

// ── Main ────────────────────────────────────────────────────────────────
const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Användning: node build.mjs <slides.json> [--html]');
  process.exit(1);
}
const htmlOnly = process.argv.includes('--html');
const spec = JSON.parse(readFileSync(inputPath, 'utf-8'));
const outDir = resolve(__dirname, 'out');
mkdirSync(outDir, { recursive: true });

const total = spec.slides.length;
for (let i = 0; i < total; i++) {
  const num = String(i + 1).padStart(2, '0');
  const htmlPath = resolve(outDir, `slide-${num}.html`);
  const pngPath = resolve(outDir, `slide-${num}.png`);
  writeFileSync(htmlPath, renderSlide(spec.slides[i], i, total, spec.brand || 'SKYLAND'));

  if (!htmlOnly) {
    execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      `--window-size=${W},${H}`, '--force-device-scale-factor=2',
      '--virtual-time-budget=5000',
      `--screenshot=${pngPath}`, `file://${htmlPath}`,
    ], { stdio: 'pipe' });
    console.log(`✓ ${pngPath}`);
  } else {
    console.log(`✓ ${htmlPath}`);
  }
}
console.log(`\nKlart — ${total} slides i ${outDir}`);
