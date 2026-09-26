/** THE SCREENSHOTS IN THE README AND ON /how-it-works, REGENERATED FROM THE PRODUCT.
 *
 *  Those four images are the first thing a new reader sees, and a picture of last month's UI is a
 *  claim about the product that is no longer true -- the same failure the figures on those pages
 *  are tested against. So the rule (CONTRIBUTING.md, "Screenshots") is: a change that alters what
 *  one of these frames shows re-runs this script in the same PR. This script is what makes that
 *  a one-line step rather than an afternoon of cropping.
 *
 *    npm run build:client -w @edh-seer/web
 *    npx vite preview --config packages/web/client/vite.config.ts --port 5180 &
 *    npm run screenshots -w @edh-seer/web                    # writes the four .webp files
 *    npm run screenshots -w @edh-seer/web -- --base http://localhost:5173
 *
 *  HERE AND NOT UNDER `research/`: it writes files the site ships, which is what a pipeline script
 *  is (CONTRIBUTING.md, "Where a script goes"), the same home as `assemble-deploy.mjs`.
 *
 *  The build analyses in the browser from `/static` shards. Those shards need the corpus to build,
 *  so by default this script answers `/static/*` from the live site: the UI is this checkout's, the
 *  card data is production's. Pass `--local-data` when the preview serves its own shards.
 *
 *  CROPS ARE ANCHORED TO ELEMENTS, NOT PIXELS: each chapter frame starts at its own heading, so a
 *  layout change moves the crop with it instead of slicing a sentence in half. Sizes are fixed so
 *  the `width`/`height` attributes on the page stay true. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT = join(ROOT, "packages", "web", "client", "how-it-works");
/** Krenko's EDHREC tokens list: a real deck, every card read, and the commander the page's worked
 *  pair (Krenko -> Impact Tremors) already names. */
const DECK = join(ROOT, "packages", "cli", "decks", "krenko-mob-boss.txt");

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1]! : "http://localhost:5180";
const localData = args.includes("--local-data");

/** One frame: where it goes, how it is found, and its fixed size in CSS pixels at 1440 wide. */
type Frame = { file: string; width: number; height: number; quality: number };
const FRAMES = {
  orbit: { file: "shot-orbit.webp", width: 1280, height: 740, quality: 0.82 },
  pairs: { file: "shot-pairs.webp", width: 1040, height: 640, quality: 0.85 },
  improve: { file: "shot-improve.webp", width: 1040, height: 640, quality: 0.85 },
  mana: { file: "shot-mana.webp", width: 640, height: 394, quality: 0.85 },
} satisfies Record<string, Frame>;

/** PNG from Playwright, WebP from the browser's own encoder: no image library in the repo for four
 *  files a quarter. */
async function toWebp(page: Page, png: Buffer, quality: number): Promise<Buffer> {
  const url = await page.evaluate(async ([data, q]) => {
    const img = new Image();
    img.src = data;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")!.drawImage(img, 0, 0);
    return c.toDataURL("image/webp", q);
  }, ["data:image/png;base64," + png.toString("base64"), quality] as const);
  return Buffer.from(url.split(",")[1]!, "base64");
}

async function save(page: Page, frame: Frame, clip: { x: number; y: number }, fullPage = true): Promise<void> {
  const png = await page.screenshot({ fullPage, clip: { ...clip, width: frame.width, height: frame.height } });
  const webp = await toWebp(page, png, frame.quality);
  writeFileSync(join(OUT, frame.file), webp);
  console.log(`${frame.file}  ${frame.width}x${frame.height}  ${(webp.length / 1024).toFixed(0)} KB`);
}

/** Document coordinates of an element's top-left, for a full-page clip. */
async function origin(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY };
  });
  return { x: Math.round(box.x), y: Math.round(box.y) };
}

// PLAYWRIGHT_CHROMIUM and PLAYWRIGHT_CHROMIUM_ARGS (space-separated) are for a machine whose
// browser is not where Playwright installs it, or whose proxy needs its certificate pinned.
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: process.env.PLAYWRIGHT_CHROMIUM_ARGS?.split(" ").filter(Boolean) ?? [],
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } } : {}),
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
if (!localData) {
  await ctx.route("**/static/**", async (route) => {
    const u = new URL(route.request().url());
    route.fulfill({ response: await route.fetch({ url: "https://edhseer.cards" + u.pathname }) });
  });
}
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));

await page.goto(base + "/", { waitUntil: "networkidle" });
await page.fill("textarea[aria-label='Decklist']", readFileSync(DECK, "utf8"));
await page.click("button:has-text('Analyse deck')");
await page.waitForSelector("h2:has-text('Deck at a glance')", { timeout: 90_000 });
// Art and mana symbols arrive after the report; a frame taken before them is a frame of spinners.
await page.waitForLoadState("networkidle");

// The game plan frame opens at the deck's themes, each led by its key cards: what the deck does,
// in the cards a player knows it by.
// Its card images load lazily, so the frame is scrolled to and waited out before it is taken.
await page.locator("h3:text-is('What your deck does')").first().scrollIntoViewIfNeeded();
await page.waitForFunction(() => {
  // The frame holds the first theme: its key cards, and the chips under them. `complete` is also
  // true of an image that failed, so a missing picture cannot stall the capture.
  const first = document.querySelector("section[aria-labelledby='plan-themes'] article");
  return !!first && [...first.querySelectorAll("img")].every((i) => i.complete);
}, undefined, { timeout: 30_000 });
const plan = await origin(page, "h3:text-is('What your deck does')");
await save(page, FRAMES.pairs, { x: plan.x - 12, y: plan.y - 8 });
// The improve frame starts at its own heading, so it carries its title. Its cards are computed after
// the report paints and their images load lazily, so both are waited out before the frame is taken.
await page.waitForFunction(() => !document.body.innerText.includes("Finding cards that fit"), undefined, { timeout: 120_000 });
await page.locator("h2:text-is('How to improve it')").first().scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.waitForFunction(() => [...document.querySelectorAll("#fix img")]
  .filter((i) => i.getBoundingClientRect().top < innerHeight).every((i) => (i as HTMLImageElement).complete), undefined, { timeout: 30_000 });
const improve = await origin(page, "h2:text-is('How to improve it')");
await save(page, FRAMES.improve, { x: improve.x - 12, y: improve.y - 12 });
// The mana frame is the "asks for / will have" chart alone: the one picture in that chapter.
const chart = await origin(page, "text=What it asks for, and what it will have");
await save(page, FRAMES.mana, { x: chart.x - 8, y: chart.y - 10 });

// The commander's orbit, in the Game plan chapter: every card Krenko works with, grouped by what
// the link is. TAKEN FROM THE VIEWPORT, NOT THE FULL PAGE: a full-page capture resizes the page,
// which replays the ring's entrance and caught it mid-flight. Scrolled so the heading sits under
// the two sticky headers, then the entrance and the art are waited out.
await page.locator("h3:text-is('What your commander works with')").first().evaluate((el) => {
  const top = el.getBoundingClientRect().top + scrollY;
  const headers = document.querySelector(".site-header")!.getBoundingClientRect().height
    + parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--report-header-h") || "0");
  scrollTo(0, top - headers - 12);
});
await page.waitForTimeout(4000);
const orbitBox = await page.locator("h3:text-is('What your commander works with')").first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top) };
});
await save(page, FRAMES.orbit, { x: orbitBox.x - 16, y: orbitBox.y - 12 }, false);

await ctx.unrouteAll({ behavior: "ignoreErrors" });
await browser.close();
