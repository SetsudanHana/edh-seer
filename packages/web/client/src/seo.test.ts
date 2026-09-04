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
/** THE SITEMAP IS BUILT, NOT CHECKED IN (Task 10). `assemble-deploy.mjs` writes it from
 *  `name-index.json`, so the tests that read it only run where a build exists -- the same
 *  `existsSync` guard the other dist-dependent tests here use. */
const DIST = join(CLIENT, "dist");
const builtSitemap = join(DIST, "sitemap.xml");
const llms = readFileSync(join(CLIENT, "public", "llms.txt"), "utf8");

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

/** THE SECOND PAGE HAS ITS OWN ABSOLUTE URLS, and until this existed nothing checked them against
 *  the canonical. The test above reads `index.html` only, and `how-it-works` was covered for its
 *  canonical tag alone -- so a domain change applied to one file and not the other would leave
 *  `og:url` and `og:image` pointing at the old origin, and the suite would stay green while every
 *  shared link from that page resolved somewhere else. Written when the pages.dev origin was about
 *  to be replaced, which is exactly the change that would have slipped through. */
test("the how-it-works page's absolute URLs agree with the canonical origin too", () => {
  const page = readFileSync(join(CLIENT, "how-it-works", "index.html"), "utf8");
  const origin = new URL(canonical).origin;
  const ours = [...page.matchAll(/(?:content|href)="(https:\/\/[^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => u.startsWith(origin));
  // canonical, og:url and og:image at minimum -- an empty list would pass this vacuously, which is
  // the failure mode the floor exists to catch.
  expect(ours.length).toBeGreaterThanOrEqual(3);
  for (const u of ours) expect(new URL(u).origin).toBe(origin);
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

/** A HAND-WRITTEN SITEMAP CANNOT STAY CORRECT AT THIS SIZE. Two URLs were maintainable; 17,775 are
 *  not, and a checked-in copy would drift from the artifact the first time the corpus grew --
 *  into promising pages that 404, which is worse than having no sitemap. */
test("no hand-written sitemap survives in public/", () => {
  expect(existsSync(join(CLIENT, "public", "sitemap.xml"))).toBe(false);
});

/** THE GENERATED ONE LISTS EXACTLY WHAT THE ARTIFACT HOLDS: the two static pages, one card URL per
 *  substantive card, and a second URL for every card that can lead a deck. A card the engine has
 *  never read is not in the index and so is never promised a page.
 *
 *  Skipped without a build, because `dist/` is produced by `npm run build` plus `assemble-deploy`
 *  and a fresh checkout has neither. */
test.skipIf(!existsSync(builtSitemap))("the sitemap lists every substantive card and commander, and nothing else", () => {
  const version = JSON.parse(readFileSync(join(DIST, "static", "manifest.json"), "utf8")).version as string;
  const index = JSON.parse(
    readFileSync(join(DIST, "static", version, "name-index.json"), "utf8"),
  ) as { slug: string; commander: boolean }[];
  const locs = [...readFileSync(builtSitemap, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);

  expect(locs).toHaveLength(2 + index.length + index.filter((e) => e.commander).length);
  expect(locs.slice(0, 2)).toEqual([canonical, `${canonical}how-it-works`]);
  // Every URL is on the canonical origin -- a sitemap that names another host is a sitemap for
  // another site.
  for (const loc of locs) expect(loc.startsWith(canonical.slice(0, -1))).toBe(true);
  // THE PROMISE THIS FILE MAKES: a card the engine has not read has no page and is not listed.
  const slugs = new Set(index.map((e) => e.slug));
  for (const loc of locs.slice(2)) {
    const slug = loc.slice(loc.lastIndexOf("/") + 1);
    expect(slugs.has(slug), `${loc} is a card the index holds`).toBe(true);
  }
});

/** THE PRERENDER ROUTES EXIST, AND ARE NAMED WHAT CLOUDFLARE EXPECTS.
 *
 *  A Pages Function is wired by its PATH: `functions/cards/[slug].ts` answers `/cards/:slug` and
 *  nothing announces it. Rename the file, move the directory, or deploy from a working directory
 *  where `functions/` is not beside the output, and every card URL quietly goes back to serving the
 *  empty shell -- with a green suite, a correct sitemap, and 17,775 URLs a crawler reads as blank.
 *  The logic is tested in `inject.test.ts`; this asserts the wiring that carries it. */
test("the card and commander prerender functions are where Pages looks for them", () => {
  const functions = join(CLIENT, "..", "functions");
  for (const route of ["cards/[slug].ts", "commanders/[slug].ts"]) {
    expect(existsSync(join(functions, route)), `${route} exists`).toBe(true);
    expect(readFileSync(join(functions, route), "utf8")).toContain("renderCardPage");
  }
});

/** THE WORDMARK GOES HOME, ON BOTH PAGES (owner, 2026-09-03).
 *
 *  `how-it-works` has had `<a class="brand" href="/">` since it was written; the home page's header
 *  was a bare `h1` with no link in it. So from `/cards`, `/graph` or `/combos` the one affordance
 *  every reader on the web already believes in did nothing, and the app has no other way back to
 *  the analyser.
 *
 *  THE `h1` HAS TO SURVIVE THE CHANGE. It is the page's one heading and the one a crawler reads
 *  without running the bundle -- the test below asserts exactly that -- so the anchor wraps the
 *  mark and the word INSIDE the heading rather than replacing it. Parsed, not pattern-matched, for
 *  the same reason the JS-free text test is. */
test("the wordmark links home on every page, and stays the page's h1", () => {
  const page = readFileSync(join(CLIENT, "how-it-works", "index.html"), "utf8");
  for (const [name, markup] of [["index", html], ["how-it-works", page]] as const) {
    const doc = new DOMParser().parseFromString(markup, "text/html");
    const brand = doc.querySelector(".brand")!;
    expect(brand, `${name} has a wordmark`).not.toBeNull();
    const link = brand.matches("a") ? brand : brand.querySelector("a");
    expect(link?.getAttribute("href"), `${name}'s wordmark points home`).toBe("/");
    // The name itself is inside the link, not merely near it: a linked icon with the word outside
    // it is a 24px target for the thing the reader is aiming at.
    expect(link?.textContent?.replace(/\s+/g, ""), `${name}'s wordmark reads edhseer`).toContain("edhseer");
  }
  // And the home page's heading is still the heading.
  const home = new DOMParser().parseFromString(html, "text/html");
  expect(home.querySelectorAll("h1")).toHaveLength(1);
  expect(home.querySelector("h1")!.classList.contains("brand")).toBe(true);
});

/** WHAT AN LLM CRAWLER GETS TOLD, in the one file the convention has agreed on (llmstxt.org, and
 *  the file is `llms.txt` — `llm.txt` is not the name anything looks for).
 *
 *  It is not decoration on a site like this one. The whole product is a claim about cards, and the
 *  two things a model quoting it can get wrong are the two things this file states outright: what
 *  the engine REFUSES to say (a role is not a synergy, a self-reference means the card itself,
 *  popularity is nothing), and whose text the cards are. A summariser that misses the first
 *  reports the tool as saying more than it does; one that misses the second republishes Wizards'
 *  property as ours.
 *
 *  Same promise-keeping rule the sitemap is held to: every URL it names has a file behind it. */
test("llms.txt names the pages that exist, on the canonical origin", () => {
  const origin = new URL(canonical).origin;
  const ours = [...llms.matchAll(/\((https:\/\/[^)]+)\)/g)]
    .map((m) => m[1]!)
    .filter((u) => u.startsWith(origin));
  expect(ours).toEqual([canonical, `${canonical}how-it-works`]);
  for (const url of ours) {
    const path = url.slice(canonical.length);
    const file = path === "" ? join(CLIENT, "index.html") : join(CLIENT, path, "index.html");
    expect(existsSync(file), `${url} has a file`).toBe(true);
  }
});

/** THE FORMAT, and the claims that are the reason for writing it at all. A file that parses but
 *  says nothing is the failure mode here -- it would pass a "the file exists" check and still let a
 *  model report roles as synergies. */
test("llms.txt carries the refusals and the attribution, not just a title", () => {
  // llmstxt.org: an H1, then a blockquote summary. Everything after is free-form.
  expect(llms).toMatch(/^# EDH Seer\n/);
  expect(llms).toMatch(/\n> /);
  for (const claim of [/no language model at analysis time/i, /roles are not synergies/i,
    /names itself means itself/i, /popularity is not synergy/i, /missing claim is better/i]) {
    expect(llms, claim.source).toMatch(claim);
  }
  // Whose text the cards are. This site does not own it and must not read as if it does.
  expect(llms).toMatch(/Wizards of the Coast/);
  expect(llms).toMatch(/Scryfall/);
  // The same exclusion robots.txt states, for readers that never fetch robots.txt.
  expect(llms).toContain("/static/");
});

/** THE DEFECT THIS CLOSES: the body was `<div id="root"></div>` and nothing else, so a crawler that
 *  does not run JavaScript — most social scrapers, most LLM crawlers, Bing more often than Google —
 *  had no text to read and a search result had nothing to quote but the meta description. This
 *  counts what such a crawler actually receives. */
test("the page ships real text without running JavaScript", () => {
  // PARSED, NOT PATTERN-MATCHED. This stripped tags with regexes and CodeQL was right twice in a
  // row: the first missed `<SCRIPT>`, and the fix missed `</script >`, which browsers also accept as
  // an end tag. A third patch would have been a third guess about a grammar this file does not own.
  // The client's tests run in jsdom, so a real parser is already here — it costs nothing, it cannot
  // be circumvented by a spelling, and `textContent` skips comment nodes for free.
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.querySelectorAll("script, style")) el.remove();
  const readable = (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();

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
  // No script at all: the prose is the whole page, so JS-off readers and crawlers get all of it.
  // Asked of the parsed document rather than the source text, for the reason above.
  const parsed = new DOMParser().parseFromString(page, "text/html");
  expect(parsed.querySelectorAll("script")).toHaveLength(0);
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
  // The last regex over this HTML, gone for the same reason as the others: a parser knows where a
  // script tag ends and a pattern only guesses.
  const doc = new DOMParser().parseFromString(html, "text/html");
  const raw = doc.querySelector('script[type="application/ld+json"]')?.textContent ?? "";
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

/** THE LANDING SHOWS, THE PROSE PAGE EXPLAINS. The landing used to restate how-it-works in four
 *  headed paragraphs and no devices -- 94% prose, zero figures -- which is the same argument told
 *  worse, first. These two blocks are what replaced them, and a future edit that quietly returns
 *  the page to prose should fail here rather than ship. */
test("the landing carries the devices that replaced its prose", () => {
  for (const block of ["figures", "edge-demo"]) {
    expect(html, `the ${block} block is present`).toContain(`class="${block}"`);
  }
  // The refusal is the half that differentiates this from a popularity list, so it is the half
  // most worth asserting: an edge that forms is unsurprising, one the engine declines is not.
  expect(html).toContain("edge-row-refused");
  // THE WORKED EXAMPLE IS DELIBERATELY DUPLICATED, so a reader who follows the link to how-it-works
  // recognises where they are -- but nothing enforces the two copies stay identical. This is the
  // drift check: the same four values have to appear on both pages.
  const prose = readFileSync(join(CLIENT, PAGES["/how-it-works"]), "utf8");
  for (const shared of ["34,433", "~495", "Krenko, Mob Boss", "Enduring Courage"]) {
    expect(html, `the landing has ${shared}`).toContain(shared);
    expect(prose, `how-it-works has ${shared}`).toContain(shared);
  }
});
