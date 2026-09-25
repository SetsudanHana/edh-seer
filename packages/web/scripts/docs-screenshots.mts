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
const DECK = join(ROOT, "packages", "cli", "decks", "edhrec", "tokens", "krenko-mob-boss.real.txt");

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1]! : "http://localhost:5180";
const localData = args.includes("--local-data");

/** One frame: where it goes, how it is found, and its fixed size in CSS pixels at 1440 wide. */
type Frame = { file: string; width: number; height: number; quality: number };
const FRAMES = {
  graph: { file: "shot-graph.webp", width: 1440, height: 830, quality: 0.82 },
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

async function save(page: Page, frame: Frame, clip: { x: number; y: number }): Promise<void> {
  const png = await page.screenshot({ fullPage: true, clip: { ...clip, width: frame.width, height: frame.height } });
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

// The game plan frame opens at the archetype bars rather than the chapter title, so the frame has
// room for the pairs under them -- the sentences are what it is there to show.
const plan = await origin(page, "summary:has-text('What the percentages count')");
await save(page, FRAMES.pairs, { x: plan.x - 12, y: plan.y - 8 });
// The improve frame starts at its own heading, so it carries its title.
const improve = await origin(page, "h2:text-is('How to improve it')");
await save(page, FRAMES.improve, { x: improve.x - 12, y: improve.y - 12 });
// The mana frame is the "asks for / will have" chart alone: the one picture in that chapter.
const chart = await origin(page, "text=What it asks for, and what it will have");
await save(page, FRAMES.mana, { x: chart.x - 8, y: chart.y - 10 });

// The graph opens focused on the commander with its card open beside the board. Wait out the
// pre-settle and the art, then take the viewport below the site header.
await page.click("a[href^='/analysis/graph']");
await page.waitForTimeout(6000);
await page.evaluate(() => scrollTo(0, 0));
const header = await page.locator(".site-header").evaluate((el) => Math.round(el.getBoundingClientRect().bottom));
await save(page, FRAMES.graph, { x: 0, y: header + 1 });

await ctx.unrouteAll({ behavior: "ignoreErrors" });
await browser.close();
