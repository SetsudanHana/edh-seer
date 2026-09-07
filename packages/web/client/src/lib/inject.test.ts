import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cardPageHtml, injectPage, type InjectableCard } from "./inject.js";

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
