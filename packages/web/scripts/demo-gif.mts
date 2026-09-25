/** THE README'S DEMO: paste a deck, read the report, open the graph. Recorded from the product.
 *
 *    VITE_STATIC_DATA=1 npm run build:client -w @edh-seer/web
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
import { chromium, type Page } from "@playwright/test";
import gifenc from "gifenc";

const { GIFEncoder, quantize, applyPalette } = gifenc;
const ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT = join(ROOT, "docs", "images", "demo.gif");
const DECK = join(ROOT, "packages", "cli", "decks", "edhrec", "tokens", "krenko-mob-boss.real.txt");

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
    // Fullscreen puts one element on the top layer, above everything in the body, so the cursor
    // follows it there or disappears for the last shot.
    const host = document.fullscreenElement ?? document.body;
    if (el.parentElement !== host) host.appendChild(el);
    el.style.transform = `translate(${x - 4}px, ${y - 3}px)`;
    (el.querySelector(".ring") as SVGElement).setAttribute("opacity", ring ? "0.9" : "0");
  }, [cursor.x, cursor.y, ring] as const);
}

/** Glide to the centre of a target, a frame per step, as a hand would. */
async function moveTo(selector: string, steps = 7): Promise<void> {
  const box = (await page.locator(selector).first().boundingBox())!;
  const to = { x: box.x + Math.min(box.width / 2, 60), y: box.y + box.height / 2 };
  const from = { ...cursor };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    cursor = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
    await drawCursor();
    await frame(40);
  }
}

async function click(selector: string): Promise<void> {
  await moveTo(selector);
  await drawCursor(true);
  await frame(180);
  await drawCursor(false);
  await page.locator(selector).first().click();
}

/** Scroll the report in small steps so the eye can follow it. */
async function scroll(by: number, steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await page.evaluate((dy) => scrollBy(0, dy), by / steps);
    await drawCursor();
    await frame(70);
  }
}

// --- the storyboard ----------------------------------------------------------------------------

await page.goto(base + "/", { waitUntil: "networkidle" });
await drawCursor();
await hold(900);

// Paste the list: a few lines at a time, so it reads as a paste landing, then the whole list.
const deck = readFileSync(DECK, "utf8");
const lines = deck.split("\n");
await moveTo("textarea[aria-label='Decklist']");
for (const n of [6, 18, 40]) {
  await page.fill("textarea[aria-label='Decklist']", lines.slice(0, n).join("\n"));
  await frame(90);
}
await page.fill("textarea[aria-label='Decklist']", deck);
await hold(700);

await click("button:has-text('Analyse deck')");
await page.waitForSelector("h2:has-text('Deck at a glance')", { timeout: 90_000 });
await page.waitForLoadState("networkidle");
await drawCursor();
await hold(1600);

// The report: the scores, then the pairs behind each theme, then what to fix.
await scroll(420, 6);
await hold(1400);
const plan = await page.locator("summary:has-text('What the percentages count')").first().evaluate((el) => el.getBoundingClientRect().top);
await scroll(plan - 90, 8);
await hold(2200);
const improve = await page.locator("h2:text-is('How to improve it')").first().evaluate((el) => el.getBoundingClientRect().top);
await scroll(improve - 150, 8);
await hold(2200);

// The graph, opened from the rail (it stays in view while the report scrolls), then a key card
// picked from the strip, then the board on its own: the graph page is fixed to the viewport, and
// at 800px tall the board starts halfway down it, so Fullscreen is how the board gets the frame.
await click("a[href^='/analysis/graph']");
await page.waitForTimeout(6000);
await drawCursor();
await hold(1500);
await click("[data-testid='graph-key-cards'] button >> nth=1");
await page.waitForTimeout(2500);
await drawCursor();
await hold(2000);
await click("button:has-text('Fullscreen')");
await page.waitForTimeout(2500);
await drawCursor();
await hold(2800);

await ctx.unrouteAll({ behavior: "ignoreErrors" });
await browser.close();

// --- encode ------------------------------------------------------------------------------------

const gif = GIFEncoder();
for (const f of frames) {
  const palette = quantize(f.rgba, 256);
  gif.writeFrame(applyPalette(f.rgba, palette), OUT_W, OUT_H, { palette, delay: f.delay });
}
gif.finish();
mkdirSync(join(ROOT, "docs", "images"), { recursive: true });
writeFileSync(OUT, gif.bytes());
const total = frames.reduce((s, f) => s + f.delay, 0);
console.log(`demo.gif  ${OUT_W}x${OUT_H}  ${frames.length} frames  ${(total / 1000).toFixed(1)}s  ${(gif.bytes().length / 1024 / 1024).toFixed(2)} MB`);
