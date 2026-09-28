/** THE README'S DEMO: paste a deck, then the commander's map -- a card's links, the drawer, a walk
 *  and the way back. Recorded from the product.
 *
 *    npm run build:client -w @edh-seer/web
 *    (cd packages/web && npx vite preview --config client/vite.config.ts --port 5180) &
 *    npm run demo -w @edh-seer/web                           # writes docs/images/demo.webp
 *    npm run demo -w @edh-seer/web -- --story browse         # writes docs/images/browse.webp
 *
 *  The same setup as `docs-screenshots.mts`, and the same rule (CONTRIBUTING.md, "Screenshots"): a
 *  change that alters what the demo shows re-records it in the same PR. Card data comes from the
 *  live site unless `--local-data` is passed; `--base` points at another server.
 *
 *  THE PAGE'S CLOCK IS OURS (owner, 2026-09-28: "is there a way for it to be more fluent?"). A
 *  screenshot takes ~150ms, so filming in real time sampled the map's motion at ~6 frames a second.
 *  Once the report is up the page's clock is paused, and every frame moves it -- timers, animation
 *  frames and the CSS/Web Animations -- forward exactly 1/FPS of a second. How long a capture takes
 *  never shows.
 *
 *  ANIMATED WEBP, NOT GIF: full colour where a GIF's 256 banded the glows and the card art, and it
 *  plays in an `<img>` like a GIF. Encoded by `sharp`; a frame identical to the one before it
 *  becomes a longer delay rather than a second copy.
 *
 *  A CURSOR IS DRAWN INTO THE PAGE, because a headless browser has none and a demo of clicks without
 *  a pointer reads as a slideshow. The real mouse follows it, so hovers happen as they would. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const ROOT = join(import.meta.dirname, "..", "..", "..");
/** `--story browse` records the second demo: the pages beyond the report. */
const STORY = process.argv.includes("--story") ? process.argv[process.argv.indexOf("--story") + 1]! : "deck";
const OUT = STORY === "browse" ? join(ROOT, "docs", "images", "browse.webp") : join(ROOT, "docs", "images", "demo.webp");
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
const FPS = 25;
const STEP = 1000 / FPS;

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
await page.clock.install();

type Frame = { png: Buffer; delay: number };
const frames: Frame[] = [];
if (framesDir) mkdirSync(framesDir, { recursive: true });

async function shoot(delay: number): Promise<void> {
  const png = await page.screenshot();
  const prev = frames.at(-1);
  if (prev && prev.png.equals(png)) { prev.delay += delay; return; }
  if (framesDir) writeFileSync(join(framesDir, `${String(frames.length).padStart(4, "0")}.png`), png);
  frames.push({ png, delay });
}

/** Move the page's time on by `ms`: its timers and animation frames, and every CSS transition and
 *  animation, which the paused clock does not reach on its own. */
let paused = false;
async function advance(ms: number): Promise<void> {
  if (!paused) return;
  await page.clock.runFor(ms);
  await page.evaluate((ms) => {
    for (const a of document.getAnimations()) {
      if (a.playState !== "paused") a.pause();
      a.currentTime = (Number(a.currentTime) || 0) + ms;
    }
  }, ms);
}

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

/** Let `ms` of the page's time play, a frame at a time. */
async function play(ms: number, ring = false): Promise<void> {
  for (let i = 0; i < Math.round(ms / STEP); i++) {
    await advance(STEP);
    await drawCursor(ring);
    await shoot(STEP);
  }
}

/** Glide to the centre of a target, as a hand would; the real mouse goes with it. */
async function moveTo(selector: string, ms = 750): Promise<void> {
  const box = (await page.locator(selector).first().boundingBox())!;
  const to = { x: box.x + Math.min(box.width / 2, 60), y: box.y + box.height / 2 };
  const from = { ...cursor };
  const n = Math.round(ms / STEP);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    cursor = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
    await page.mouse.move(cursor.x, cursor.y);
    await advance(STEP);
    await drawCursor();
    await shoot(STEP);
  }
}

async function click(selector: string): Promise<void> {
  await moveTo(selector);
  await play(300);
  await play(280, true);
  await page.mouse.click(cursor.x, cursor.y);
}

/** Scroll the page by `by` pixels over `ms`, eased, so the eye can follow it. */
async function scroll(by: number, ms = 900): Promise<void> {
  const n = Math.round(ms / STEP);
  let done = 0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const to = Math.round(by * (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2));
    await page.evaluate((dy) => scrollBy(0, dy), to - done);
    done = to;
    await advance(STEP);
    await drawCursor();
    await shoot(STEP);
  }
}
const top = (sel: string) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().top);

/** WAITING IS CUT: the page's clock runs freely while `wait` loads what comes next, and stops again
 *  the moment it is there, so an entrance is filmed from its start. */
async function offCamera(wait: () => Promise<unknown>): Promise<void> {
  paused = false;
  await page.clock.resume();
  await wait();
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 50);
  paused = true;
}

// --- the storyboards ---------------------------------------------------------------------------

async function deckStory(): Promise<void> {
  await offCamera(() => page.goto(base + "/", { waitUntil: "networkidle" }));
  await play(1200);

  // Paste the list: a few lines at a time, so it reads as a paste landing, then the whole list.
  const deck = readFileSync(DECK, "utf8");
  const lines = deck.split("\n");
  await moveTo("textarea[aria-label='Decklist']");
  for (const n of [6, 18, 40]) {
    await page.fill("textarea[aria-label='Decklist']", lines.slice(0, n).join("\n"));
    await play(160);
  }
  await page.fill("textarea[aria-label='Decklist']", deck);
  await play(1000);

  // The analysis runs in real time and is cut; the clock stops again the moment the report is up,
  // so the map's entrance is filmed from its start.
  await click("button:has-text('Analyse deck')");
  await offCamera(() => page.waitForSelector("h2:has-text('Deck at a glance')", { timeout: 90_000 }));
  await page.waitForLoadState("networkidle");

  // THE STORY IS THE COMMANDER'S MAP (owner, 2026-09-27: "showcase our constellation properly"). It is
  // the report's first screen: the ring comes in, its links run, the key names what links them.
  cursor = { x: VIEW.width * 0.42, y: VIEW.height * 0.55 };
  await play(4500);

  // A card's links light as the pointer rests on it; a tap opens it in the drawer, with its links.
  const disc = (name: string) => `svg[role='group'] g[role='button'][aria-label='${name}'] circle`;
  await moveTo(disc("Goblin Warchief"), 900);
  await play(2200);
  await click(disc("Goblin Warchief"));
  await play(3800);

  // Walk the map from it: Warchief in the middle, the path back beside it.
  await click("button:has-text('Walk the map from here')");
  await play(4200);

  // One step further, then back to the start along the path.
  await click(disc(SECOND));
  await play(3200);
  await click("button:has-text('Walk the map from here')");
  await play(4000);
  await click("nav[aria-label='Your path'] button:has-text('Krenko')");
  await play(4000);
}

/** THE PAGES BEYOND THE REPORT: the precons, one precon's swaps, then the site search to a
 *  commander's page and the cards that work with it. No deck is pasted. */
async function browseStory(): Promise<void> {
  const precon = "a[href='/precons/multiverse-reforged-reality-fracture-commander']";
  await offCamera(async () => {
    await page.goto(base + "/precons/", { waitUntil: "networkidle" });
    await page.waitForSelector(precon, { timeout: 60_000 });
  });
  await play(1400);
  await click(precon);
  await offCamera(() => page.waitForSelector("h2:has-text('swaps')", { timeout: 60_000 }));
  // The orbit's entrance plays as the page arrives.
  await play(3800);
  await scroll((await top("h2:has-text('swaps')")) - 110, 1200);
  await play(3000);

  // The site search: a few letters, the suggestions, and the commander picked from them.
  await click("input[aria-label='Find a card']");
  for (const ch of "Krenko") {
    await page.keyboard.type(ch);
    await play(140);
  }
  await offCamera(() => page.waitForSelector("#site-search-list [role='option']", { timeout: 30_000 }));
  await play(1200);
  await click("#site-search-list [role='option']:has-text('Krenko, Mob Boss')");
  await offCamera(() => page.waitForSelector("nav[aria-label='Surface']", { timeout: 60_000 }));
  await play(1800);
  await click("nav[aria-label='Surface'] a:has-text('As a commander')");
  await offCamera(() => page.waitForSelector("h2:text-is('Works well with')", { timeout: 60_000 }));
  await play(1200);
  await scroll((await top("h2:text-is('Works well with')")) - 110, 1100);
  await play(4200);
}

await (STORY === "browse" ? browseStory() : deckStory());

await ctx.unrouteAll({ behavior: "ignoreErrors" });
await browser.close();

// --- encode ------------------------------------------------------------------------------------

const scaled = await Promise.all(frames.map((f) => sharp(f.png).resize(OUT_W).png({ compressionLevel: 1 }).toBuffer()));
const webp = await sharp(scaled, { join: { animated: true } })
  .webp({ quality: 58, effort: 4, loop: 0, delay: frames.map((f) => Math.round(f.delay)), minSize: true })
  .toBuffer();
mkdirSync(join(ROOT, "docs", "images"), { recursive: true });
writeFileSync(OUT, webp);
const total = frames.reduce((s, f) => s + f.delay, 0);
console.log(`${STORY === "browse" ? "browse.webp" : "demo.webp"}  ${OUT_W}px wide  ${frames.length} frames  ${(total / 1000).toFixed(1)}s  ${(webp.length / 1024 / 1024).toFixed(2)} MB`);
