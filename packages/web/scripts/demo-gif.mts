/** THE README'S DEMO: paste a deck, read the report, follow the commander's links. Recorded from
 *  the product.
 *
 *    npm run build:client -w @edh-seer/web
 *    npx vite preview --config packages/web/client/vite.config.ts --port 5180 &
 *    npm run demo-gif -w @edh-seer/web                       # writes docs/images/demo.gif
 *
 *  The same setup as `docs-screenshots.mts`, and the same rule (CONTRIBUTING.md, "Screenshots"): a
 *  change that alters what the demo shows re-records it in the same PR. Card data comes from the
 *  live site unless `--local-data` is passed; `--base` points at another server.
 *
 *  FRAMES, NOT VIDEO. Playwright's own recorder writes VP8 only and this repo has no ffmpeg, so each
 *  frame is a screenshot, scaled in the browser's canvas and encoded by `gifenc` (pure JS). The GIF's
 *  timing is set per frame, so how long a screenshot takes to capture never shows in the result, and
 *  a frame identical to the one before it becomes a longer delay rather than a second copy.
 *
 *  A CURSOR IS DRAWN INTO THE PAGE, because a headless browser has none and a demo of clicks without
 *  a pointer reads as a slideshow. It is an absolutely positioned SVG, moved between real targets. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import gifenc from "gifenc";

const { GIFEncoder, quantize, applyPalette } = gifenc;
const ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT = join(ROOT, "docs", "images", "demo.gif");
const DECK = join(ROOT, "packages", "cli", "decks", "krenko-mob-boss.txt");
/** The card walked to from Goblin Warchief's map. */
const SECOND = "Goblin King";

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1]! : "http://localhost:5180";
const localData = args.includes("--local-data");
/** `--frames <dir>` also writes every frame as a PNG, for reviewing the cut before committing it. */
const framesDir = args.includes("--frames") ? args[args.indexOf("--frames") + 1]! : undefined;

/** Captured at a desktop size, shown at README width. */
const VIEW = { width: 1280, height: 800 };
const OUT_W = 880;
const OUT_H = Math.round((OUT_W * VIEW.height) / VIEW.width);

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: process.env.PLAYWRIGHT_CHROMIUM_ARGS?.split(" ").filter(Boolean) ?? [],
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } } : {}),
});
const ctx = await browser.newContext({ viewport: VIEW, colorScheme: "dark" });
if (!localData) {
  await ctx.route("**/static/**", async (route) => {
    const u = new URL(route.request().url());
    route.fulfill({ response: await route.fetch({ url: "https://edhseer.cards" + u.pathname }) });
  });
}
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
/** A blank page that owns the canvas used to scale and read back each frame. */
const scaler = await browser.newPage();

type Frame = { rgba: Uint8Array; delay: number };
const frames: Frame[] = [];
if (framesDir) mkdirSync(framesDir, { recursive: true });
let last = "";

async function frame(delay: number): Promise<void> {
  const png = await page.screenshot();
  const b64 = png.toString("base64");
  if (b64 === last) { frames.at(-1)!.delay += delay; return; }
  last = b64;
  if (framesDir) writeFileSync(join(framesDir, `${String(frames.length).padStart(3, "0")}.png`), png);
  const out = await scaler.evaluate(async ([data, w, h]) => {
    const img = new Image();
    img.src = "data:image/png;base64," + data;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    let s = "";
    for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
    return btoa(s);
  }, [b64, OUT_W, OUT_H] as const);
  frames.push({ rgba: new Uint8Array(Buffer.from(out, "base64")), delay });
}
const hold = (ms: number) => frame(ms);

// --- the cursor --------------------------------------------------------------------------------

let cursor = { x: VIEW.width * 0.62, y: VIEW.height * 0.6 };
async function drawCursor(ring = false): Promise<void> {
  await page.evaluate(([x, y, ring]) => {
    let el = document.getElementById("demo-cursor");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-cursor";
      el.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:28px;height:28px";
      el.innerHTML = `<svg width="28" height="28" viewBox="0 0 28 28"><circle class="ring" cx="4" cy="4" r="12" fill="none" stroke="#c64bc6" stroke-width="2.5" opacity="0"/><path d="M4 3 L4 22 L9 17 L12.5 25 L15.5 23.7 L12 16 L19 16 Z" fill="#fff" stroke="#0d0912" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    }
    if (el.parentElement !== document.body) document.body.appendChild(el);
    el.style.transform = `translate(${x - 4}px, ${y - 3}px)`;
    (el.querySelector(".ring") as SVGElement).setAttribute("opacity", ring ? "0.9" : "0");
  }, [cursor.x, cursor.y, ring] as const);
}

/** Glide to the centre of a target, a frame per step, as a hand would. Slow enough to follow: the
 *  first cut, 7 steps of 40ms, read as "very fast and loose" (owner, 2026-09-27). */
async function moveTo(selector: string, steps = 14): Promise<void> {
  const box = (await page.locator(selector).first().boundingBox())!;
  const to = { x: box.x + Math.min(box.width / 2, 60), y: box.y + box.height / 2 };
  const from = { ...cursor };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    cursor = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
    await drawCursor();
    await frame(50);
  }
}

async function click(selector: string): Promise<void> {
  await moveTo(selector);
  await hold(350);
  await drawCursor(true);
  await frame(300);
  await drawCursor(false);
  await page.locator(selector).first().click();
}

/** THE MAP MOVES, SO A HOLD ON IT IS FILMED, not frozen: frames are taken as fast as the browser
 *  gives them and each is shown for as long as it really took, so the GIF plays the map's own
 *  motion at its own speed. */
async function film(ms: number): Promise<void> {
  const end = Date.now() + ms;
  let t = Date.now();
  while (Date.now() < end) {
    await drawCursor();
    await frame(0);
    const now = Date.now();
    frames.at(-1)!.delay += now - t;
    t = now;
  }
}

// --- the storyboard ----------------------------------------------------------------------------

await page.goto(base + "/", { waitUntil: "networkidle" });
await drawCursor();
await hold(1200);

// Paste the list: a few lines at a time, so it reads as a paste landing, then the whole list.
const deck = readFileSync(DECK, "utf8");
const lines = deck.split("\n");
await moveTo("textarea[aria-label='Decklist']");
for (const n of [6, 18, 40]) {
  await page.fill("textarea[aria-label='Decklist']", lines.slice(0, n).join("\n"));
  await frame(160);
}
await page.fill("textarea[aria-label='Decklist']", deck);
await hold(1000);

await click("button:has-text('Analyse deck')");
await page.waitForSelector("h2:has-text('Deck at a glance')", { timeout: 90_000 });
await page.waitForLoadState("networkidle");

// THE STORY IS THE COMMANDER'S MAP (owner, 2026-09-27: "showcase our constellation properly"). It is
// the report's first screen: the ring comes in, its links run, the key names what links them.
cursor = { x: VIEW.width * 0.42, y: VIEW.height * 0.55 };
await film(4500);

// A card's links light as the pointer rests on it; a tap opens it in the drawer, with its links.
const disc = (name: string) => `svg[role='group'] g[role='button'][aria-label='${name}'] circle`;
await moveTo(disc("Goblin Warchief"));
await page.locator(disc("Goblin Warchief")).first().hover();
await film(2200);
await click(disc("Goblin Warchief"));
await film(3800);

// Walk the map from it: Warchief in the middle, its own ring, the path back beside it.
await click("button:has-text('Walk the map from here')");
await film(4200);

// One step further, then back to the start along the path.
await click(disc(SECOND));
await film(3200);
await click("button:has-text('Walk the map from here')");
await film(4000);
await click("nav[aria-label='Your path'] button:has-text('Krenko')");
await film(4000);

await ctx.unrouteAll({ behavior: "ignoreErrors" });
await browser.close();

// --- encode ------------------------------------------------------------------------------------

/** ONE PALETTE, AND ONLY WHAT CHANGED IS STORED. The map moves while the page around it holds
 *  still; with one palette for the whole GIF a still pixel keeps its exact index, so it is written
 *  as transparent over the frame before (dispose 1 keeps it) without any tolerance to leave ghosts.
 *  Filming the map's motion at its own speed cost 10.9 MB with a palette per frame. */
const sample: number[] = [];
for (const f of frames) for (let p = 0; p < f.rgba.length; p += 4 * 61) sample.push(f.rgba[p]!, f.rgba[p + 1]!, f.rgba[p + 2]!, 255);
const palette = quantize(new Uint8Array(sample), 255);
while (palette.length < 256) palette.push([0, 0, 0]);
const CLEAR = 255;
const gif = GIFEncoder();
let shown: Uint8Array | undefined;
for (const f of frames) {
  const index = applyPalette(f.rgba, palette);
  const next = index.slice();
  if (shown) for (let i = 0; i < index.length; i++) if (index[i] === shown[i]) index[i] = CLEAR;
  gif.writeFrame(index, OUT_W, OUT_H, { palette, delay: f.delay, transparent: shown !== undefined, transparentIndex: CLEAR, dispose: 1 });
  shown = next;
}
gif.finish();
mkdirSync(join(ROOT, "docs", "images"), { recursive: true });
writeFileSync(OUT, gif.bytes());
const total = frames.reduce((s, f) => s + f.delay, 0);
console.log(`demo.gif  ${OUT_W}x${OUT_H}  ${frames.length} frames  ${(total / 1000).toFixed(1)}s  ${(gif.bytes().length / 1024 / 1024).toFixed(2)} MB`);
