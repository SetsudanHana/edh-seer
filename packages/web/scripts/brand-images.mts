/** THE REPOSITORY'S BRAND IMAGES: the README banner and the GitHub social preview.
 *
 *    npx tsx packages/web/scripts/brand-images.mts
 *
 *  Drawn in HTML and photographed by Chromium, in the site's own fonts and colours, so the first
 *  thing a visitor to the repository sees is the product's face and not a default heading. No
 *  server and no data: this renders from nothing but this file and the two font packages.
 *
 *  THE COLOURS ARE LITERALS FOR THE SAME REASON `favicon.svg`'s ARE: no CSS custom property reaches
 *  an image. Keep them in step with the background, foreground, muted and accent tokens in
 *  `client/src/index.css`.
 *
 *  THE BANNER HAS TRANSPARENT CORNERS so it reads as a card on GitHub's light theme and on its dark
 *  one alike; a square dark block on a white page reads as a mistake.
 *
 *  Writes `docs/images/banner.png` (the README) and `docs/images/social-preview.png`, which is
 *  uploaded by hand under Settings > General > Social preview -- GitHub has no API for it. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT = join(ROOT, "docs", "images");
/** EMBEDDED, NOT LINKED: a page built with `setContent` is `about:blank`, which may not read a
 *  `file://` font, and Chromium then falls back to a serif without a word of complaint. */
const font = (pkg: string, file: string) =>
  "data:font/woff2;base64," +
  readFileSync(join(ROOT, "node_modules", "@fontsource-variable", pkg, "files", file)).toString("base64");

const C = { bg: "#0d0912", fg: "#e9e4ef", muted: "#948ba6", accent: "#c64bc6", line: "#2a2236" };

/** A small synergy board: one hub and the cards it pairs with, dashed the way the graph draws a
 *  pairing. Fixed positions, so the image is the same on every run. */
function board(w: number, h: number): string {
  const hub = { x: w * 0.42, y: h * 0.55 };
  const nodes = [
    [0.1, 0.22, "#2ec4b6"], [0.3, 0.12, "#e0a526"], [0.62, 0.18, "#2ec4b6"], [0.86, 0.3, "#7c6cf0"],
    [0.92, 0.62, "#2ec4b6"], [0.74, 0.86, "#e0a526"], [0.46, 0.92, "#7c6cf0"], [0.16, 0.8, "#2ec4b6"],
    [0.66, 0.52, "#e0a526"],
  ] as const;
  const faint = [[0.05, 0.5], [0.24, 0.45], [0.55, 0.35], [0.8, 0.08], [0.97, 0.9], [0.3, 0.7], [0.58, 0.72]] as const;
  const at = (x: number, y: number) => ({ x: x * w, y: y * h });
  let s = "";
  for (const [x, y] of faint) {
    const p = at(x, y);
    for (const [x2, y2] of faint.slice(0, 3)) {
      const q = at(x2, y2);
      s += `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${C.line}" stroke-width="1"/>`;
    }
  }
  for (const [x, y, c] of nodes) {
    const p = at(x, y);
    s += `<line x1="${hub.x}" y1="${hub.y}" x2="${p.x}" y2="${p.y}" stroke="${c}" stroke-opacity="0.75" stroke-width="1.6" stroke-dasharray="5 5"/>`;
  }
  for (const [x, y] of faint) {
    const p = at(x, y);
    s += `<circle cx="${p.x}" cy="${p.y}" r="7" fill="#1c1626" stroke="${C.line}" stroke-width="1.5"/>`;
  }
  for (const [x, y, c] of nodes) {
    const p = at(x, y);
    s += `<circle cx="${p.x}" cy="${p.y}" r="10" fill="#1c1626" stroke="${c}" stroke-width="2.5"/>`;
  }
  s += `<circle cx="${hub.x}" cy="${hub.y}" r="15" fill="#1c1626" stroke="${C.fg}" stroke-width="3"/>`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

function page(w: number, h: number, radius: number, title: number, lines: string[]): string {
  return `<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: Inter; src: url("${font("inter", "inter-latin-wght-normal.woff2")}") format("woff2-variations"); font-weight: 100 900; }
    @font-face { font-family: Mono; src: url("${font("jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2")}") format("woff2-variations"); font-weight: 100 900; }
    html, body { margin: 0; background: transparent; }
    .card { width: ${w}px; height: ${h}px; border-radius: ${radius}px; background: ${C.bg}; position: relative;
            overflow: hidden; font-family: Inter; color: ${C.fg}; display: flex; align-items: center; }
    .text { position: relative; z-index: 1; padding-left: ${Math.round(w * 0.06)}px; width: 56%; }
    .word { display: flex; align-items: center; gap: ${title * 0.28}px; font-size: ${title}px; font-weight: 400;
            letter-spacing: -0.03em; line-height: 1; margin-bottom: ${title * 0.45}px; }
    .word b { font-weight: 700; }
    .edh { color: ${C.muted}; }
    .lead { font-size: ${title * 0.42}px; font-weight: 500; line-height: 1.3; margin: 0 0 ${title * 0.3}px; }
    .sub { font-family: Mono; font-size: ${title * 0.19}px; letter-spacing: 0.14em; text-transform: uppercase; color: ${C.muted}; text-wrap: balance; }
    .rule { position: absolute; left: ${Math.round(w * 0.06)}px; width: ${Math.round(w * 0.4)}px; bottom: ${Math.round(h * 0.1)}px;
            height: 2px; background: ${C.accent}; opacity: 0.8; }
    .board { position: absolute; right: 0; top: 0; }
  </style>
  <div class="card">
    <div class="board">${board(Math.round(w * 0.48), h)}</div>
    <div class="text">
      <div class="word">
        <svg width="${title * 0.9}" height="${title * 0.9}" viewBox="4 8 24 16" fill="none" aria-hidden="true">
          <line x1="11.75" y1="16" x2="15.25" y2="16" stroke="${C.muted}" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="8.25" cy="16" r="3.5" fill="${C.muted}"/>
          <circle cx="21.25" cy="16" r="4.5" fill="none" stroke="${C.muted}" stroke-width="2"/>
        </svg>
        <span><span class="edh">edh</span><b>seer</b></span>
      </div>
      <p class="lead">${lines[0]}</p>
      <div class="sub">${lines[1]}</div>
    </div>
    <div class="rule"></div>
  </div>`;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined });
const shoot = async (file: string, w: number, h: number, scale: number, html: string) => {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  const png = await p.locator(".card").screenshot({ omitBackground: true });
  writeFileSync(join(OUT, file), png);
  console.log(`${file}  ${w * scale}x${h * scale}  ${(png.length / 1024).toFixed(0)} KB`);
  await p.close();
};

const lines = ["Commander synergy, explained.", "Every pairing in your deck, in a sentence you can check"];
// The README shows the banner at up to ~880px wide; 2x keeps the type crisp on a retina screen.
await shoot("banner.png", 1280, 320, 2, page(1280, 320, 20, 76, lines));
// GitHub's recommended social preview size, square corners: the platforms that show it crop their own.
await shoot("social-preview.png", 1280, 640, 1, page(1280, 640, 0, 104, lines));
await browser.close();
