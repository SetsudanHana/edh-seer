import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { groupAnchor } from "./group-anchor.js";
import {
  BROWSE_LETTERS, browseIndexHtml, browseLetterHtml, browseSegment, cardPageHtml, groupDirection,
  htmlHeaders, injectPage, withheldFrom, type InjectableCard,
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
  expect(out).not.toContain("<title>EDH Seer — Commander deck synergy, mana and bracket checker</title>");
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

/** THE COUNT IS IN THE HTML TOO (2026-09-08). "793 cards can cause an artifact dying" is the one
 *  figure that makes a card page's static block that card's and not the template's; it had only
 *  ever been rendered by React. One sentence per event group, above that group's list, in the
 *  app's own wording, and nothing when the shard carries no map. */
test("the static block prints how many cards can cause each event, per group", () => {
  const two: InjectableCard = {
    ...KRENKO,
    partners: [
      ...KRENKO.partners,
      { name: "Purphoros, God of the Forge", slug: "purphoros-god-of-the-forge", event: "enters|creature|-|t",
        reason: "When a goblin enters thanks to Krenko, Mob Boss, Purphoros deals 2 damage" },
      { name: "Skullclamp", slug: "skullclamp", event: "dies|creature|-|-",
        reason: "When a creature dies thanks to Krenko, Mob Boss, Skullclamp draws you 2 cards" },
    ],
    rarity: { "enters|creature|-|t": 1234, "dies|creature|-|-": 1451 },
  };
  const html = cardPageHtml(two, "krenko-mob-boss", "card");
  // AK4: the event is named the way the group runs -- these rows are what the cards CAUSE -- and
  // the count follows it, because "1,234 cards can cause a creature dies" is not a sentence.
  // These fixture rows carry no `producer` flag, so the group runs the ASKER direction and the
  // event is named as the thing those cards wait for. A producer group says "kill a creature".
  // AND THE COUNT SAYS WHOSE IT IS (2026-09-22): every row here ASKS, so this page's card is one of
  // the cards that cause the event -- the reason those rows are its partners at all.
  expect(html).toContain("a creature token enters the battlefield — 1,234 cards can cause this, Krenko, Mob Boss among them.");
  expect(html).toContain("a creature dies — 1,451 cards can cause this, Krenko, Mob Boss among them.");
  // One list per event, the count directly above its own list.
  expect(html.match(/<ol>/g)).toHaveLength(2);
  expect(html.indexOf("1,234 cards")).toBeLessThan(html.indexOf("purphoros-god-of-the-forge"));
  expect(html.indexOf("purphoros-god-of-the-forge")).toBeLessThan(html.indexOf("1,451 cards"));
  expect(cardPageHtml(KRENKO, "krenko-mob-boss", "card")).not.toContain("cards can cause");
});

// THE WITHHELD COUNT IS IN THE HTML TOO (2026-09-16), under its own group, and only when the
// artifact's pool says more asked than are shown. Grouping is by key, not adjacency.
test("the static block prints the withheld count per group, and groups by key", () => {
  const rows = [
    { name: "Purphoros, God of the Forge", slug: "purphoros-god-of-the-forge", event: "enters|creature|-|t", reason: "a" },
    { name: "Skullclamp", slug: "skullclamp", event: "dies|creature|-|-", reason: "b" },
    { name: "Impact Tremors", slug: "impact-tremors", event: "enters|creature|-|t", reason: "c" },
  ];
  const html = cardPageHtml({ ...KRENKO, partners: rows, pool: { "enters|creature|-|t": 1906, "dies|creature|-|-": 1 } }, "krenko-mob-boss", "card");
  expect(html.match(/<ol>/g)).toHaveLength(2);
  expect(html).toContain("1,904 other cards ask for it too");
  expect(html).not.toContain("0 other cards");
  // Tremors sits in Purphoros's list, not in a third one.
  expect(html.indexOf("impact-tremors")).toBeLessThan(html.indexOf("skullclamp"));
});

/** THE CLAIM THIS FEATURE MAKES: the reasons are in the HTML before any JavaScript runs. */
test("the static block carries the card, its derivation and the engine's sentences", () => {
  const html = cardPageHtml(KRENKO, "krenko-mob-boss", "card");
  expect(html).toContain("Krenko, Mob Boss");
  expect(html).toContain("Legendary Creature");
  // The block a crawler reads carries ENGLISH, not the artifact's key vocabulary.
  expect(html).toContain("create a Goblin creature token");
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

/** THE CARD'S NAME IS THE PAGE'S ONE `h1` (owner, 2026-09-17). The shell's thesis heading belongs
 *  to the landing and leaves with the rest of `.intro`, so a served card page carries exactly one
 *  `h1` and it is the card's -- two would be two answers to "what is this page". */
test("the block carries the page's one h1, and the landing's intro is not on it", () => {
  const out = injectPage(SHELL, {
    title: "t", description: "d", canonical: "https://edhseer.cards/cards/x", indexable: true,
    bodyHtml: cardPageHtml(KRENKO, "krenko-mob-boss", "card"),
  });
  expect([...out.matchAll(/<h1\b/g)]).toHaveLength(1);
  expect(out).toContain("<h1>Krenko, Mob Boss</h1>");
  expect(out).not.toContain('class="intro"');
  expect(out).not.toContain("intro-thesis");
});

/** THE CRAWLABLE PAGE HAD NO IMAGE AT ALL (measured 2026-09-18): zero `<img>` across 22,209 card
 *  pages, because the art renders client-side and `og:image` is a head tag, which Google Images
 *  does not index. The `<img>` is the same URL the page already preloads, so a reader pays nothing
 *  for it and the crawler gets a picture.
 *
 *  THE FULL CARD, NEVER THE CROP. Scryfall's image rule requires an artist credit beside an
 *  `art_crop`, or a full card image in the same interface; the corpus has no artist field, so the
 *  second branch is the only one open (spec `2026-09-03-card-and-commander-pages-design.md`, D2a
 *  constraint 2). `cardImageUrl` performs that rewrite and refuses a URL off Scryfall's origin. */
test("the static block carries the card's image, rewritten to the full card", () => {
  const html = cardPageHtml(
    { ...KRENKO, artCrop: "https://cards.scryfall.io/art_crop/front/8/2/824b2d73.jpg?1712" },
    "krenko-mob-boss", "card");
  expect(html).toContain(
    '<img src="https://cards.scryfall.io/normal/front/8/2/824b2d73.jpg?1712"'
    + ' alt="Krenko, Mob Boss" width="488" height="680" />');
  expect(html).not.toContain("art_crop");
});

test("a card with no usable art prints no image rather than a broken one", () => {
  expect(cardPageHtml(KRENKO, "x", "card")).not.toContain("<img");
  expect(cardPageHtml({ ...KRENKO, artCrop: null }, "x", "card")).not.toContain("<img");
  // Not Scryfall's origin: `cardImageUrl` returns null and the block prints nothing.
  expect(cardPageHtml({ ...KRENKO, artCrop: "https://evil.example/x.jpg" }, "x", "card"))
    .not.toContain("<img");
});

/** MANA COST IS METADATA AND IT WAS MISSING. D2a names "card name, type line, mana cost, our
 *  derived events, our reason sentences" as what the page carries; the block printed everything but
 *  the cost. A land has none, and prints no line rather than an empty one. */
test("the block carries the mana cost, and omits the line when a card has none", () => {
  expect(cardPageHtml({ ...KRENKO, manaCost: "{2}{R}{R}" }, "x", "card"))
    .toContain("<p>Mana cost: {2}{R}{R}</p>");
  expect(cardPageHtml(KRENKO, "x", "card")).not.toContain("Mana cost:");
});

/** WHAT THE ENGINE READ, so a claim can be checked without leaving the page. Spec D2a option 2,
 *  taken 2026-09-18: option 1 shipped our derivation with nothing to check it against, and
 *  "Produces: a card being drawn" is unfalsifiable on a page that never shows the line it came
 *  from. Unattributed, because one clause can yield several abilities and naming which one produced
 *  a given edge would be a guess wearing a citation's clothes. */
test("the block reads down the card, clause by clause, in printed order", () => {
  const html = cardPageHtml({ ...KRENKO, clauses: [
    { id: 1, text: "When Kogla and Yidaro enters, choose one" },
    { id: 2, text: "{2}{R}{G}, Discard this card: Destroy up to one target artifact or enchantment." },
  ] }, "x", "card");
  expect(html).toContain("<h2>How the engine reads this card</h2>");
  // ONE QUOTE PER CLAUSE, the same shape `EngineReading` renders: the segmentation is the claim,
  // and a run of paragraphs reads as one passage of card text instead of the units the engine read.
  expect(html).toContain("<blockquote>When Kogla and Yidaro enters, choose one</blockquote>");
  expect(html).toContain(
    "<blockquote>{2}{R}{G}, Discard this card: Destroy up to one target artifact or enchantment.</blockquote>");
  // Printed order, which is the order a player reads the card in.
  expect(html.indexOf("When Kogla")).toBeLessThan(html.indexOf("{2}{R}{G}"));
  // It is evidence for the derivation, so it sits above the derivation it explains.
  expect(html.indexOf("How the engine reads this card")).toBeLessThan(html.indexOf("Produces:"));
});

test("a card with no rules text and no abilities gets no section at all", () => {
  expect(cardPageHtml(KRENKO, "x", "card")).not.toContain("How the engine reads this card");
  expect(cardPageHtml({ ...KRENKO, clauses: [] }, "x", "card")).not.toContain("How the engine reads this card");
  expect(cardPageHtml({ ...KRENKO, clauses: [] }, "x", "card")).not.toContain("<blockquote>");
});

/** THE CONDITION IS SAID ONCE PER GROUP, NOT ONCE PER ROW. Every reason in an event group opens on
 *  the same clause by construction, so a crawler read it once per partner -- 29% of all reason bytes
 *  over a 2,573-row sample. The claim is not shortened: the heading plus the row is the whole
 *  sentence, which matters because the sentence is the evidence for the edge. */
test("an event group says its shared condition once, as a heading", () => {
  const rows = [
    { name: "God-Eternal Bontu", slug: "god-eternal-bontu", event: "dies|creature|-|-",
      reason: "When a creature dies thanks to Krenko, Mob Boss, God-Eternal Bontu triggers" },
    { name: "Cavalier of Night", slug: "cavalier-of-night", event: "dies|creature|-|-",
      reason: "When a creature dies thanks to Krenko, Mob Boss, Cavalier of Night deals 2 damage" },
  ];
  const html = cardPageHtml({ ...KRENKO, partners: rows }, "krenko-mob-boss", "card");
  expect(html).toContain("<p>When a creature dies thanks to Krenko, Mob Boss:</p>");
  expect(html).toContain('<a href="/cards/god-eternal-bontu">God-Eternal Bontu</a> — triggers');
  expect(html).toContain('<a href="/cards/cavalier-of-night">Cavalier of Night</a> — deals 2 damage');
  // Said once, not twice.
  expect([...html.matchAll(/When a creature dies thanks to/g)]).toHaveLength(1);
});

/** IT REFUSES RATHER THAN GUESSES, in all three ways it can go wrong. */
test("a group with nothing worth factoring keeps every sentence whole", () => {
  const one = [{ name: "Impact Tremors", slug: "impact-tremors", event: "e",
    reason: "When a goblin enters thanks to Krenko, Mob Boss, Impact Tremors deals 1 damage" }];
  // A group of one has no shared lead to find.
  expect(cardPageHtml({ ...KRENKO, partners: one }, "x", "card"))
    .toContain("When a goblin enters thanks to Krenko, Mob Boss, Impact Tremors deals 1 damage");

  // A lead under MIN_SHARED_LEAD is noise, not a heading.
  const short = [
    { name: "A", slug: "a", event: "e", reason: "Krenko draws a card" },
    { name: "B", slug: "b", event: "e", reason: "Krenko gains a life" },
  ];
  const shortHtml = cardPageHtml({ ...KRENKO, partners: short }, "x", "card");
  expect(shortHtml).toContain("Krenko draws a card");
  expect(shortHtml).toContain("Krenko gains a life");

  // A row that would be left with nothing takes the whole group back to full sentences: a row
  // reading "Bontu —" is worse than the repetition the factoring removes.
  const empty = [
    { name: "Bontu", slug: "bontu", event: "e", reason: "When a creature dies thanks to Krenko, Bontu" },
    { name: "Cavalier", slug: "cav", event: "e", reason: "When a creature dies thanks to Krenko, Cavalier" },
  ];
  const emptyHtml = cardPageHtml({ ...KRENKO, partners: empty }, "x", "card");
  expect(emptyHtml).toContain("When a creature dies thanks to Krenko, Bontu");
  expect(emptyHtml).not.toContain("</a> — </li>");
});

/** THE WITHHELD LINE NAMED ONE DIRECTION AND COUNTED THE OTHER. Both readers took the figure from
 *  `pool` -- how many cards ASK for the event -- and printed "N other cards CAUSE it too" under a
 *  group whose rows all supply it. Measured on Samut, the Driving Force (2026-09-19): the
 *  `lose-life` group shows 8 rows, all `producer: true`, and printed 930 (`pool 938 - 8`) where the
 *  honest figure is `rarity 2,679 - 8 = 2,671`.
 *
 *  AND ON A NARROW GROUP IT VANISHED: `applies:keyword-grant|creature|cleric` has `pool 1`, so the
 *  count came out 0 and no line rendered at all, under a chip reading "589 cards can cause this"
 *  above a list of one. That was the owner-reported "it says 589 and shows 1". */
test("a producer group counts the cards that can CAUSE the event, not the ones that ask", () => {
  const rows = [{
    name: "Zahur, Glory's Past", slug: "zahur-glorys-past", event: "lose-life|-|-|-",
    reason: "When a permanent makes a player lose life thanks to Krenko, Zahur raises your speed",
    producer: true as const,
  }];
  const html = cardPageHtml({
    ...KRENKO, partners: rows,
    rarity: { "lose-life|-|-|-": 2679 },
    pool: { "lose-life|-|-|-": 938 },
  }, "x", "card");
  expect(html).toContain("2,678 other cards cause it too");
  expect(html).not.toContain("937 other cards");
});

test("a consumer group still counts the cards that ASK, which was always right", () => {
  const rows = [{
    name: "Pitchstone Wall", slug: "pitchstone-wall", event: "discard|-|-|-",
    reason: "When Patrol Hound discards a card, Pitchstone Wall triggers",
  }];
  const html = cardPageHtml({
    ...KRENKO, partners: rows,
    rarity: { "discard|-|-|-": 1609 },
    pool: { "discard|-|-|-": 67 },
  }, "x", "card");
  expect(html).toContain("66 other cards ask for it too");
  expect(html).not.toContain("1,608 other cards");
});

/** A FEEDER SUPPLIES THE EVENT TOO, so it counts from `rarity` like a producer and not from `pool`
 *  -- measured on Sanctum of Fruitful Harvest's `counts|-|shrine` (rarity 22, pool 21): the rows
 *  are the shrines it counts. The verb stays "feed it", which the copy already said. */
test("a feeder group counts from rarity and keeps its own verb", () => {
  const rows = [{
    name: "Sanctum of Stone Fangs", slug: "sanctum-of-stone-fangs", event: "counts|-|shrine|-",
    reason: "While you control Sanctum of Stone Fangs, Sanctum of Fruitful Harvest counts it",
  }];
  const html = cardPageHtml({
    ...KRENKO, partners: rows,
    rarity: { "counts|-|shrine|-": 22 },
    pool: { "counts|-|shrine|-": 21 },
  }, "x", "card");
  expect(html).toContain("21 other cards feed it too");
});

test("the direction is read off the rows, three ways", () => {
  expect(groupDirection([{ name: "a", slug: "a", event: "e", reason: "x", producer: true }]))
    .toBe("causes");
  expect(groupDirection([{ name: "a", slug: "a", event: "e", reason: "While you control a, b counts it" }]))
    .toBe("feeds");
  expect(groupDirection([{ name: "a", slug: "a", event: "e", reason: "When b discards, a triggers" }]))
    .toBe("asks");
  // A MIXED GROUP IS NOT A PRODUCER GROUP: one row without the flag makes the whole group ask, which
  // is the conservative reading -- the old code had the same rule and only the counter was wrong.
  expect(groupDirection([
    { name: "a", slug: "a", event: "e", reason: "x", producer: true },
    { name: "b", slug: "b", event: "e", reason: "y" },
  ])).toBe("asks");
});

test("a missing counter prints no line rather than a guess", () => {
  expect(withheldFrom("causes", "e", 3, undefined, undefined)).toBe(0);
  // Never negative: a counter smaller than what is shown is a stale artifact, not a negative count.
  expect(withheldFrom("causes", "e", 8, { e: 3 }, undefined)).toBe(0);
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

/** THE SHARE CARD'S TITLE AND TEXT WERE THE SITE'S, ON ALL 24,874 PAGES (measured 2026-09-18).
 *  `og:` was per-card from the start and `twitter:` was not, so every Discord and Twitter paste of
 *  any card page previewed as the home page -- one grey generic card for the whole corpus. The two
 *  vocabularies describe the same page and there is no reading on which they should disagree, so
 *  they are replaced together, outside the image branch: a browse page has no image and still has
 *  its own name. */
test("the share card's title and description are the page's, not the shell's", () => {
  const out = page();
  expect(out).toContain('<meta name="twitter:title" content="Krenko, Mob Boss — EDH Seer" />');
  expect(out).toContain(
    '<meta name="twitter:description" content="What the engine reads on Krenko, Mob Boss." />');
  expect(out).not.toContain('content="EDH Seer — Commander deck synergy, mana and bracket checker" />\n    <meta name="twitter:description"');
  expect(out).not.toContain("Why two cards work together, from the oracle text itself.");
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
  expect(block).toContain("<h2>Works well with</h2>");
  expect(block).not.toContain("Most specific");
  const page = readFileSync(join(import.meta.dirname, "..", "components", "CardPage.tsx"), "utf8");
  expect(page).toContain(">Works well with</h2>");
});

/** THE WITHHELD COUNT IS A LINK IN THE HTML TOO (roadmap AJ3). A crawler with JavaScript off and a
 *  reader in the app must reach the same set: the two readers print this sentence from one builder
 *  precisely because AJ1 shipped a version where they disagreed. */
test("a producer group's count links to the cards that cause it", () => {
  const rows = [{
    name: "Zahur, Glory's Past", slug: "zahur-glorys-past", event: "lose-life|-|-|-",
    reason: "When a permanent makes a player lose life thanks to Krenko, Zahur raises your speed",
    producer: true as const,
  }];
  const html = cardPageHtml({
    ...KRENKO, partners: rows,
    rarity: { "lose-life|-|-|-": 2679 }, pool: { "lose-life|-|-|-": 938 },
  }, "x", "card");
  expect(html).toContain('<a href="/cards?produce=lose-life%7C-%7C-%7C-">2,678 other cards cause it too</a>');
});

test("a consumer group links by consume", () => {
  const rows = [{
    name: "Pitchstone Wall", slug: "pitchstone-wall", event: "discard|-|-|-",
    reason: "When Patrol Hound discards a card, Pitchstone Wall triggers",
  }];
  const html = cardPageHtml({
    ...KRENKO, partners: rows,
    rarity: { "discard|-|-|-": 1609 }, pool: { "discard|-|-|-": 67 },
  }, "x", "card");
  expect(html).toContain("consume=discard");
  expect(html).not.toContain("produce=discard");
});

/** ON A COMMANDER PAGE THE LINK CARRIES THE DECK'S COLOURS, because the number above it is already
 *  scoped to them (AJ5). A corpus-wide set under a commander-sized count is the same lie AJ5 fixed. */
test("a commander page's link is scoped to its identity, a card page's is not", () => {
  const rows = [{
    name: "Zahur, Glory's Past", slug: "zahur-glorys-past", event: "lose-life|-|-|-",
    reason: "When a permanent makes a player lose life thanks to Krenko, Zahur raises your speed",
    producer: true as const,
  }];
  const card = {
    ...KRENKO, commander: true, identity: ["R", "G", "W"], partners: rows,
    rarity: { "lose-life|-|-|-": 2679 }, pool: { "lose-life|-|-|-": 938 },
  };
  expect(cardPageHtml(card, "x", "commander")).toContain("colors=RGW");
  expect(cardPageHtml(card, "x", "card")).not.toContain("colors=");
});

/** BOTH READERS SAY THE SAME WORDS (roadmap AJ4, the spec's headline risk). `.prerendered` is
 *  hidden the instant React boots, so a sentence only one of them renders is served to a crawler
 *  and hidden from every human -- or the reverse. This shipped once: the component's "wants" rows
 *  were fixed to the noun form and this reader was left on the clause form, so one event had two
 *  sentences, and the static reach rows existed in the app and not here at all. */
test("the crawlable reading carries a static's reach, in the same words the app uses", () => {
  const html = cardPageHtml({
    ...KRENKO,
    clauses: [{ id: 3, text: "Other creatures you control get +X/+0, where X is your speed." }],
    abilities: [
      { kind: "static", clause: 3, effect: "pump", when: [], emits: [], applies: ["applies:pump|creature|-|-"] },
      { kind: "triggered", effect: "speed", when: ["lose-life|-|-|-"], emits: [] },
    ],
  }, "x", "card");
  // The static's demand is its reach; without it the anthem rendered with no events at all.
  expect(html).toContain(`<li>wants <a href="#${groupAnchor("applies:pump|creature|-|-")}">a creature it boosts</a></li>`);
  // "wants" takes the NOUN form, the way the component renders it.
  expect(html).toContain("life being lost");
  expect(html).not.toContain("wants <a href=\"#event-lose-life\">life is lost</a>");
  // An implied ability still has no quote above it, and still carries its events.
  expect(html).toContain("read off the card itself");
});

/** A STAPLE'S PAGE SAYS ITS JOB (review 2026-09-25). Sol Ring has no partners by design; its
 *  crawlable block used to say only "No partners specific enough to list". */
test("a card with a job and no partners explains the job instead of an empty list", () => {
  const sol: InjectableCard = {
    name: "Sol Ring", typeLine: "Artifact", commander: false, emits: [], demands: [], partners: [],
    roles: ["ramp"],
  };
  const html = cardPageHtml(sol, "sol-ring", "card");
  expect(html).toContain("<h2>What it does in a deck</h2>");
  expect(html).toContain("Sol Ring is ramp.");
  expect(html).toContain("toward your Ramp total");
  expect(html).not.toContain("No partners specific enough to list.");
  // A role the report does not count names no job.
  expect(cardPageHtml({ ...sol, roles: ["stax"] }, "sol-ring", "card"))
    .toContain("No partners specific enough to list.");
});
