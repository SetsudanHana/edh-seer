import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  BROWSE_LETTERS, browseIndexHtml, browseLetterHtml, browseSegment, cardPageHtml, htmlHeaders,
  injectPage, type InjectableCard,
} from "./inject.js";

/** THE REAL SHELL, not a fixture of one. Every replacement here is a regex against tags this repo
 *  writes by hand in `index.html`; a fixture would keep passing after someone reformatted the head
 *  and the edge started serving pages with the site's generic title on every card. */
const SHELL = readFileSync(join(import.meta.dirname, "..", "..", "index.html"), "utf8");

const KRENKO: InjectableCard = {
  name: "Krenko, Mob Boss",
  typeLine: "Legendary Creature — Goblin Warrior",
  commander: true,
  emits: ["create-token|creature|goblin|t"],
  demands: [],
  partners: [{
    name: "Impact Tremors", slug: "impact-tremors", event: "enters|creature|-|t",
    reason: "When a goblin enters thanks to Krenko, Mob Boss, Impact Tremors deals 1 damage",
  }],
};

const page = (over: Partial<Parameters<typeof injectPage>[1]> = {}) => injectPage(SHELL, {
  title: "Krenko, Mob Boss — EDH Seer", description: "What the engine reads on Krenko, Mob Boss.",
  canonical: "https://edhseer.cards/cards/krenko-mob-boss", indexable: true,
  bodyHtml: "<p>marker</p>", ...over,
});

test("the injected head replaces the shell's title, description, canonical and og tags", () => {
  const out = page();
  expect(out).toContain("<title>Krenko, Mob Boss — EDH Seer</title>");
  expect(out).not.toContain("<title>EDH Seer — Commander Deck Analysis</title>");
  expect(out).toContain('<link rel="canonical" href="https://edhseer.cards/cards/krenko-mob-boss" />');
  expect(out).toContain('<meta property="og:url" content="https://edhseer.cards/cards/krenko-mob-boss" />');
  expect(out).toContain('<meta property="og:title" content="Krenko, Mob Boss — EDH Seer" />');
  // The shell's own canonical must not survive beside the new one -- two canonicals is no canonical.
  expect([...out.matchAll(/<link rel="canonical"/g)]).toHaveLength(1);
});

/** THE WHOLE POINT OF THE TASK. React mounts into `#root`; anything inside it is replaced the
 *  moment the bundle runs, and anything after it survives -- which is what `index.html`'s `.intro`
 *  section already proves. */
test("the body block lands outside #root so React never owns it", () => {
  const out = page();
  expect(out.indexOf("<p>marker</p>")).toBeGreaterThan(out.indexOf('<div id="root">'));
  expect(out).toContain('<div id="root"></div>\n<p>marker</p>');
});

test("a non-indexable page carries the robots meta, and an indexable one does not", () => {
  expect(page({ indexable: false })).toContain('<meta name="robots" content="noindex" />');
  expect(page()).not.toContain('content="noindex"');
});

/** A CARD NAME IS ATTACKER-CONTROLLED ONLY IN THE SENSE THAT IT IS DATA -- but the block is built
 *  by string concatenation and served as HTML, so every field goes through the escaper. Names with
 *  `&` are ordinary (Bruna, Light of Alabaster has none; "Look at Me, I'm the DCI" has an
 *  apostrophe), and one unescaped `<` would break the document for every reader. */
test("every interpolated field is escaped", () => {
  const html = cardPageHtml({
    ...KRENKO, name: 'Evil <script>alert("x")</script> & Co',
  }, "evil", "card");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("&amp; Co");
});

/** THE CLAIM THIS FEATURE MAKES: the reasons are in the HTML before any JavaScript runs. */
test("the static block carries the card, its derivation and the engine's sentences", () => {
  const html = cardPageHtml(KRENKO, "krenko-mob-boss", "card");
  expect(html).toContain("Krenko, Mob Boss");
  expect(html).toContain("Legendary Creature");
  // The block a crawler reads carries ENGLISH, not the artifact's key vocabulary.
  expect(html).toContain("a Goblin creature token being created");
  expect(html).not.toContain("|");
  expect(html).toContain("Impact Tremors deals 1 damage");
  expect(html).toContain('href="/cards/impact-tremors"');
  // A commander's card page offers the other URL, and only a commander's.
  expect(html).toContain('href="/commanders/krenko-mob-boss"');
  expect(cardPageHtml({ ...KRENKO, commander: false }, "x", "card")).not.toContain("/commanders/");
});

test("the commander block links back to the card page", () => {
  expect(cardPageHtml(KRENKO, "krenko-mob-boss", "commander"))
    .toContain('<a href="/cards/krenko-mob-boss">What the engine reads on this card</a>');
});

/** THE SHELL KEEPS ITS ONE `h1` -- the wordmark. A second one here would be two answers to "what
 *  is this page", which is the defect `seo.test.ts` guards against on the static pages. */
test("the block adds no second h1", () => {
  const out = injectPage(SHELL, {
    title: "t", description: "d", canonical: "https://edhseer.cards/cards/x", indexable: true,
    bodyHtml: cardPageHtml(KRENKO, "krenko-mob-boss", "card"),
  });
  expect([...out.matchAll(/<h1\b/g)]).toHaveLength(1);
});

test("a card with no partners says so rather than printing an empty list", () => {
  const html = cardPageHtml({ ...KRENKO, partners: [] }, "x", "card");
  expect(html).toContain("No partners specific enough to list");
  expect(html).not.toContain("<ol>");
});

/** THE INLINE RECORD, AND WHY IT EXISTS. Without it the app fetches its data from `/static/`, which
 *  `robots.txt` disallows, so Googlebot's renderer got nothing and every card page rendered as
 *  `<NotFound />` in the DOM Google keeps. Confirmed in Search Console 2026-09-08 against
 *  `/cards/accursed-witch-infectious-curse`, a page the edge serves with 24 partner links. */
test("the page hands the app its own record, keyed by the slug it was served for", () => {
  const html = page({ data: { slug: "krenko-mob-boss", record: KRENKO } });
  const tag = /<script type="application\/json" id="edh-card-page" data-slug="([^"]+)">([\s\S]*?)<\/script>/
    .exec(html);
  expect(tag, "the data block is in the document").not.toBeNull();
  expect(tag![1]).toBe("krenko-mob-boss");
  expect(JSON.parse(tag![2]!)).toEqual(KRENKO);
});

/** A PAGE WITH NO RECORD WRITES NO TAG, rather than an empty one the reader would have to
 *  distinguish from a corrupt one. `notFound()` and `degraded()` both take this branch. */
test("a page with no record carries no data block", () => {
  expect(page()).not.toContain("edh-card-page");
});

/** THE ESCAPE IS THE SECURITY BOUNDARY, AND `esc` IS THE WRONG TOOL FOR IT.
 *
 *  Inside a `<script>` the HTML parser does not decode entities -- it scans raw text for `</script`
 *  and ends the element there. So a `</script>` anywhere in this data closes the block early and
 *  everything after it is parsed as MARKUP. The JSON itself cannot execute (`application/json` is
 *  not run), but breaking out of the element lets what follows become real HTML including a real
 *  script. The data is Scryfall's and ours today; the corpus is 34,433 third-party rows and grows
 *  every set, so the escape is mechanical rather than reasoned. */
test("a card whose text could close the script element cannot", () => {
  const hostile = {
    ...KRENKO,
    name: "</script><script>alert(1)</script>",
    // `&` and the two JS line terminators go too: they are legal in JSON and cannot be trusted to
    // stay harmless everywhere this string might later be embedded.
    typeLine: "Creature \u2014 <img src=x onerror=alert(2)> & \u2028 \u2029 friends",
  };
  const html = page({ data: { slug: "hostile", record: hostile } });
  const body = /id="edh-card-page" data-slug="hostile">([\s\S]*?)<\/script>/.exec(html)![1]!;
  // THE PARSER'S ACTUAL TRIGGER IS `</script`, and nothing weaker. With every `<` escaped it cannot
  // occur however the data nests it -- so this asserts the absence of `<` itself, which is the
  // property that makes the claim true rather than a spot check on one spelling of the attack.
  expect(body).not.toContain("<");
  expect(body).not.toContain(">");
  expect(body.toLowerCase()).not.toContain("</script");
  expect(body).not.toContain("\u2028");
  // And it is still the data, not a mangled copy of it: an escape that corrupts the payload would
  // be the same bug wearing a safer hat. `esc` would have done exactly that -- inside a script the
  // parser decodes no entities, so `&lt;` reaches `JSON.parse` as four literal characters.
  expect(JSON.parse(body)).toEqual(hostile);
});

/** THE PROSE BLOCK AND THE DATA BLOCK ESCAPE DIFFERENTLY BECAUSE THEY SIT IN DIFFERENT PARSERS.
 *  HTML text wants entities; script text wants `<`. Using either escaper in the other's place
 *  is a defect -- one lets the element close, the other hands `JSON.parse` a corrupted string. */
test("the prose block still uses HTML entities, not the JSON escape", () => {
  const html = page({
    data: { slug: "s", record: KRENKO },
    bodyHtml: cardPageHtml({ ...KRENKO, name: "A & B <c>" }, "s", "card"),
  });
  expect(html).toContain("A &amp; B &lt;c&gt;");
});

/** WHAT EVERY HTML RESPONSE THE EDGE WRITES CARRIES, and why it is written here rather than ticked
 *  in a dashboard. `_headers` governs ASSET responses; the two security headers the rest of the
 *  site has are Pages' own defaults on assets. A Function response gets neither. Measured on the
 *  deployed site 2026-09-08: `/how-it-works/` carried both, `/cards/krenko-mob-boss` carried
 *  neither, and the Function routes are the majority of this site's HTML. */
test("an html response carries the headers the rest of the site gets for free", () => {
  const h = htmlHeaders();
  expect(h["content-type"]).toBe("text/html; charset=utf-8");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  // Indexable by default: the header is a refusal, and a refusal must be asked for.
  expect(h["x-robots-tag"]).toBeUndefined();
});

/** THE HEADER TWIN OF THE META TAG, on the same condition. The tag is read by anything that renders
 *  the page; the header is read by everything, including Cloudflare's Crawler Hints -- whose
 *  documented opt-out is this header or the tag, and which does not say which of the two it
 *  actually inspects. 2,823 of these pages are `noindex` and Crawler Hints was enabled 2026-09-08,
 *  so "probably parses the body" stopped being a good enough answer. */
test("a page that refuses the index says so in the header as well as the tag", () => {
  expect(htmlHeaders(false)["x-robots-tag"]).toBe("noindex");
  expect(page({ indexable: false })).toContain('<meta name="robots" content="noindex" />');
  // The two must not be able to disagree: `render.ts` reads one binding for both, and this is the
  // pairing that binding exists to keep true.
  expect(page({ indexable: true })).not.toContain('content="noindex"');
});

/** THE BROWSE PAGES ARE THE DOOR INTO THE CORPUS, and until 2026-09-08 there was none: `/cards` and
 *  `/commanders` fetch `name-index.json` from `/static/`, `robots.txt` disallows `/static/`, and
 *  Googlebot's renderer will not fetch a disallowed subresource -- so both rendered with zero links
 *  to any card, and 17,338 URLs hung off the sitemap alone. */
test("the collection page offers the whole alphabet and says how much is behind it", () => {
  const html = browseIndexHtml("cards", 16715);
  for (const l of BROWSE_LETTERS) {
    expect(html, `letter ${l} is reachable`).toContain(`/browse/cards/${browseSegment(l)}`);
  }
  expect(html).toContain("16,715 cards");
});

/** `#` CANNOT BE A PATH SEGMENT -- it starts a fragment. It is served at `0`, and the page exists so
 *  that walking the alphabet reaches every card rather than almost every card. */
test("the letter with no letter is still a URL", () => {
  expect(browseSegment("#")).toBe("0");
  expect(browseSegment("K")).toBe("k");
  expect(BROWSE_LETTERS).toHaveLength(27);
  // Last, not first: it holds the names with no leading letter, and an alphabet that opens on a
  // footnote reads as a mistake.
  expect(BROWSE_LETTERS[26]).toBe("#");
});

test("a letter page links every card on it, and marks where the reader is", () => {
  const html = browseLetterHtml("cards", "K", [
    { slug: "krenko-mob-boss", name: "Krenko, Mob Boss" },
    { slug: "kodamas-reach", name: "Kodama's Reach" },
  ]);
  expect(html).toContain('<a href="/cards/krenko-mob-boss">Krenko, Mob Boss</a>');
  expect(html).toContain('<a href="/cards/kodamas-reach">Kodama\'s Reach</a>');
  expect(html).toContain("2 cards");
  // The current letter is not a link to itself, and says so to a screen reader too.
  expect(html).toContain('<span aria-current="page">K</span>');
  expect(html).not.toContain('href="/browse/cards/k"');
});

/** A NAME IS NOT MARKUP. These strings come from Scryfall and the corpus grows every set, so the
 *  escape is mechanical here exactly as it is in the JSON block. */
test("a hostile card name cannot inject markup into a browse listing", () => {
  const html = browseLetterHtml("cards", "X", [
    { slug: "x", name: '</a><script>alert(1)</script>' },
  ]);
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;/a&gt;&lt;script&gt;");
});

/** THE COMMANDER SIDE RANKS A DIFFERENT SET, so a letter can be full of cards and empty of
 *  commanders. It still renders and still carries the alphabet -- the walk continues -- it simply
 *  makes no promise a crawler should index. */
test("a letter with nothing on it still carries the alphabet", () => {
  const html = browseLetterHtml("commanders", "Q", []);
  expect(html).toContain("No commanders start with this letter");
  expect(html).toContain("/browse/commanders/a");
});

/** A SHARED CARD LINK SHOWED THE SITE'S ONE GENERIC IMAGE, on all 17,338 card and commander pages
 *  (measured 2026-09-08). The record already carries the card's own image, and a Discord or Reddit
 *  preview that shows the card is the difference between a grey box and a click. The same URL is
 *  preloaded, because the `<img>` the app renders for it is the page's LCP element and used to wait
 *  for the bundle before its request began. */
test("a page with an image preloads it and hands it to the share cards", () => {
  const image = "https://cards.scryfall.io/normal/front/8/2/824b2d73.jpg";
  const out = page({ image });
  expect(out).toContain(`<link rel="preload" as="image" href="${image}" fetchpriority="high" />`);
  expect(out).toContain(`<meta property="og:image" content="${image}" />`);
  expect(out).toContain(`<meta name="twitter:image" content="${image}" />`);
  // A card is portrait; the large-image card crops a square out of its middle.
  expect(out).toContain('<meta name="twitter:card" content="summary" />');
  expect(out).toContain('<meta property="og:image:width" content="488" />');
  expect(out).toContain('<meta property="og:image:height" content="680" />');
  expect(out).toContain('<meta property="og:image:alt" content="Krenko, Mob Boss — EDH Seer" />');
  expect(out).not.toContain("og-image.png");
});

test("a page without an image keeps the site's share image untouched", () => {
  const out = page();
  expect(out).not.toContain('rel="preload" as="image"');
  expect(out).toContain('<meta property="og:image" content="https://edhseer.cards/og-image.png" />');
  expect(out).toContain('<meta name="twitter:card" content="summary_large_image" />');
});

/** THE PATH UNDER THE TITLE. Every edge-rendered page carried the landing's WebApplication block and
 *  nothing about itself; a BreadcrumbList is what a result page shows for a card page's position. */
test("breadcrumbs become a BreadcrumbList block, escaped for a script element", () => {
  const out = page({ breadcrumbs: [
    { name: "EDH Seer", url: "https://edhseer.cards/" },
    { name: "Cards", url: "https://edhseer.cards/cards" },
    { name: "Krenko, Mob Boss </script>", url: "https://edhseer.cards/cards/krenko-mob-boss" },
  ] });
  const blocks = [...out.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  const crumbs = blocks.map((b) => JSON.parse(b) as { "@type": string; itemListElement?: { position: number; name: string; item: string }[] })
    .find((b) => b["@type"] === "BreadcrumbList")!;
  expect(crumbs.itemListElement!.map((e) => [e.position, e.name, e.item])).toEqual([
    [1, "EDH Seer", "https://edhseer.cards/"],
    [2, "Cards", "https://edhseer.cards/cards"],
    [3, "Krenko, Mob Boss </script>", "https://edhseer.cards/cards/krenko-mob-boss"],
  ]);
  // The raw sequence never appears in the document: the name above parsed back intact, and the
  // element did not end early.
  expect(out.split("</script>").length - 1).toBe(blocks.length + (out.match(/<script(?![^>]*ld\+json)/g)?.length ?? 0));
});

test("a page without breadcrumbs adds no structured data", () => {
  expect((page().match(/application\/ld\+json/g) ?? []).length)
    .toBe((SHELL.match(/application\/ld\+json/g) ?? []).length);
});

/** THE CRAWLER'S HEADING IS THE PAGE'S HEADING. The block said "Most specific partners" for two
 *  days after the page said "Partners" (PR #256), which is a search snippet naming a section the
 *  reader will not find. Held to the word CardPage renders. */
test("the prerendered partner heading is the word the page uses", () => {
  const block = cardPageHtml(KRENKO, "krenko-mob-boss", "card");
  expect(block).toContain("<h3>Partners</h3>");
  expect(block).not.toContain("Most specific");
  const page = readFileSync(join(import.meta.dirname, "..", "components", "CardPage.tsx"), "utf8");
  expect(page).toContain(">Partners</h3>");
});
