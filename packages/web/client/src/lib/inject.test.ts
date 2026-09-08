import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cardPageHtml, htmlHeaders, injectPage, type InjectableCard } from "./inject.js";

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
