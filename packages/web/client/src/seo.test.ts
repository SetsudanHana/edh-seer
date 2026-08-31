import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

/** WHAT A CRAWLER AND A CHAT WINDOW SEE, asserted rather than assumed. Every failure mode here is
 *  silent: a missing description means the search result quotes whatever text the page happens to
 *  start with, a broken `og:image` path means a shared link renders as a grey box, and a mismatched
 *  canonical means two URLs compete for the same page. None of it shows up in the app. */
const CLIENT = join(process.cwd(), "client");
const html = readFileSync(join(CLIENT, "index.html"), "utf8");
const robots = readFileSync(join(CLIENT, "public", "robots.txt"), "utf8");
const sitemap = readFileSync(join(CLIENT, "public", "sitemap.xml"), "utf8");

/** The one absolute origin in the app, written down once. Every assertion below reads it from the
 *  canonical tag rather than repeating it, so the day a custom domain replaces this one, the tests
 *  move with the page instead of failing against it. */
const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? "";

test("the page states one canonical origin, and every absolute URL agrees with it", () => {
  expect(canonical).toMatch(/^https:\/\/[^/]+\/$/);
  const absolutes = [...html.matchAll(/(?:content|href)="(https:\/\/[^"]+)"/g)].map((m) => m[1]);
  const ownOrigin = absolutes.filter((u) => u.startsWith(new URL(canonical).origin));
  // Google Fonts and the Wizards/Scryfall links in the footer are other people's origins; these are
  // the ones that claim to be US, and a stale one of those is what splits a page in two.
  expect(ownOrigin.length).toBeGreaterThanOrEqual(4);
  for (const u of ownOrigin) expect(u.startsWith(canonical) || u === canonical.slice(0, -1)).toBe(true);
});

test("the description is present and the length a search result actually shows", () => {
  const description = /<meta name="description" content="([^"]+)"/.exec(html)?.[1] ?? "";
  // Under ~160 characters is what survives a result snippet; over 50 is what makes it worth having.
  expect(description.length).toBeGreaterThan(50);
  expect(description.length).toBeLessThanOrEqual(200);
  // The claim the product can actually stand behind — no account, and oracle text as the source.
  expect(description).toMatch(/oracle/i);
});

test("a shared link carries a card, an image and its real dimensions", () => {
  for (const tag of ["og:type", "og:title", "og:description", "og:url", "og:image", "og:image:alt"]) {
    expect(html, `${tag} is present`).toContain(`property="${tag}"`);
  }
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  // The dimensions are declared so a scraper can lay the card out before the image arrives; they
  // have to match the file, which `pwa.test.ts` reads for the icons the same way.
  const png = readFileSync(join(CLIENT, "public", "og-image.png"));
  expect({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) }).toEqual({ w: 1200, h: 630 });
  expect(html).toContain('property="og:image:width" content="1200"');
  expect(html).toContain('property="og:image:height" content="630"');
});

/** 16,384 JSON shards are data the app fetches for itself, not pages. Letting a crawler walk them
 *  spends its budget and this site's bandwidth on files no human reads — and the card text inside
 *  them is Wizards' property rather than ours to publish as pages. */
test("robots keeps crawlers out of the card artifacts and points at the sitemap", () => {
  expect(robots).toMatch(/^Disallow: \/static\/$/m);
  expect(robots).toMatch(/^Allow: \/$/m);
  expect(robots).toContain(`Sitemap: ${canonical}sitemap.xml`);
});

test("the sitemap lists the pages that exist and nothing that does not", () => {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs).toEqual([canonical, `${canonical}how-it-works`]);
  // Every listed URL has a file behind it. A sitemap entry for a page that 404s is worse than no
  // sitemap: it is a promise the site does not keep.
  for (const loc of locs) {
    const path = loc.slice(canonical.length);
    const file = path === "" ? join(CLIENT, "index.html") : join(CLIENT, path, "index.html");
    expect(existsSync(file), `${loc} has a file`).toBe(true);
  }
});

/** THE DEFECT THIS CLOSES: the body was `<div id="root"></div>` and nothing else, so a crawler that
 *  does not run JavaScript — most social scrapers, most LLM crawlers, Bing more often than Google —
 *  had no text to read and a search result had nothing to quote but the meta description. This
 *  counts what such a crawler actually receives. */
test("the page ships real text without running JavaScript", () => {
  const body = html.split("<body>")[1] ?? "";
  const readable = body
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  expect(readable.length).toBeGreaterThan(800);
  // The claims the product is actually made of, in the words a reader would search for.
  expect(readable).toMatch(/oracle text/i);
  expect(readable).toMatch(/commander/i);
  expect(readable).toMatch(/synerg/i);
  expect(html).toContain('href="/how-it-works"');
  // ONE route to GitHub per region, not three. The header nav and the footer both carry it, so the
  // intro must not: a page that repeats the same destination in three places is a page that has not
  // decided where it lives.
  const intro = html.slice(html.indexOf('class="intro"'), html.indexOf("</section>"));
  expect(intro).not.toContain("github.com");
});

test("the how-it-works page is a page, not an app route", () => {
  const page = readFileSync(join(CLIENT, "how-it-works", "index.html"), "utf8");
  // No script tag at all: the prose is the whole page, so JS-off readers and crawlers get all of it.
  expect(page).not.toMatch(/<script/);
  expect(page).toContain('<link rel="canonical" href="' + canonical + 'how-it-works"');
  expect(page).toMatch(/<h1>How it works<\/h1>/);
  // It explains the thing it promises to explain, in its own words rather than by linking away.
  for (const idea of ["clause", "edge", "refuses", "calibrated"]) {
    expect(page.toLowerCase()).toContain(idea);
  }
});

/** Structured data is a claim like any other. This asserts the shape parses and that it does not
 *  carry the fields this product has no evidence for — an invented rating is the schema equivalent
 *  of a synergy claim with no reason behind it. */
test("the structured data parses and claims only what is true", () => {
  const raw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  const data = JSON.parse(raw);
  expect(data["@type"]).toBe("WebApplication");
  expect(data.url).toBe(canonical);
  expect(data.isAccessibleForFree).toBe(true);
  expect(data.aggregateRating).toBeUndefined();
  expect(data.review).toBeUndefined();
});

/** THE HEADER IS STATIC ON BOTH PAGES, which is what lets a crawler read the site's name and reach
 *  its other page without running the bundle — and what stops the two pages growing different
 *  headers. The nav also fills a header whose right half was empty at every width. */
const PAGES = { "/": "index.html", "/how-it-works": "how-it-works/index.html" } as const;

test.each(Object.entries(PAGES))("%s carries the site header and the same nav", (_url, file) => {
  const page = readFileSync(join(CLIENT, file), "utf8");
  expect(page).toContain('class="site-header"');
  expect(page).toContain('class="site-nav"');
  for (const href of [
    "https://github.com/SetsudanHana/edh-seer",
    "https://github.com/SetsudanHana/edh-seer/issues/new",
  ]) {
    expect(page, `${file} links ${href}`).toContain(`href="${href}"`);
  }
});

/** ONE `h1` PER PAGE, and it has to be the one that says what the page is about. The app page's is
 *  the brand; the prose page's is its own title, which is why the brand is a link there — two `h1`s
 *  is two answers to the same question. */
test.each(Object.entries(PAGES))("%s has exactly one h1", (_url, file) => {
  const page = readFileSync(join(CLIENT, file), "utf8");
  expect([...page.matchAll(/<h1\b/g)]).toHaveLength(1);
});

test("the app page's h1 is the brand, and the prose page's is its title", () => {
  expect(html).toMatch(/<h1 class="brand">/);
  const prose = readFileSync(join(CLIENT, PAGES["/how-it-works"]), "utf8");
  expect(prose).toMatch(/<h1>How it works<\/h1>/);
  expect(prose).toMatch(/<a class="brand" href="\/">/);
});

/** THE FIGURES ARE THE PAGE. It was a wall of text; these three blocks are what make the method
 *  legible, and they are HTML rather than images so they wrap, scale and are read aloud. A future
 *  edit that drops one should fail rather than quietly return the page to prose. */
test("the prose page carries its three figures", () => {
  const prose = readFileSync(join(CLIENT, PAGES["/how-it-works"]), "utf8");
  for (const block of ["figures", "pipeline", "edge-demo"]) {
    expect(prose, `the ${block} block is present`).toContain(`class="${block}"`);
  }
  // The worked edge shows both outcomes: the ordinary case and a refusal.
  expect(prose).toContain("edge-row-refused");
});
