import { readFileSync } from "node:fs";
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

test("the sitemap lists the canonical URL and nothing that does not exist", () => {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs).toEqual([canonical]);
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
