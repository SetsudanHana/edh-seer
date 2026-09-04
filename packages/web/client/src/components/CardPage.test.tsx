import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, test } from "vitest";
import { CardPage } from "./CardPage.js";
import type { CardPageData } from "../lib/partners.js";

const KRENKO: CardPageData = {
  name: "Krenko, Mob Boss",
  typeLine: "Legendary Creature — Goblin Warrior",
  manaCost: "{2}{R}{R}",
  artCrop: "https://cards.scryfall.io/art_crop/front/8/2/824b2d73.jpg",
  abilities: [{
    kind: "activated", cost: "{T}", when: [], effect: "token-generation",
    scaling: "per-permanent", counts: "goblin",
    emits: ["create-token|creature|goblin|t", "enters|creature|goblin|t"],
  }],
  identity: ["R"],
  commander: true,
  emits: ["create-token|creature|goblin|t", "enters|creature|goblin|t"],
  demands: [],
  partners: [{
    name: "Impact Tremors", slug: "impact-tremors", score: 0.126, event: "enters|creature|-|-",
    reason: "When a goblin enters thanks to Krenko, Mob Boss, Impact Tremors deals 1 damage",
  }],
  pool: { "enters|creature|-|-": 1909 },
  rarity: { "enters|creature|-|-": 2879 },
};

/** The loader is injected so the test needs no fetch and no artifact on disk. */
const at = (slug: string, load: () => Promise<CardPageData | null>) =>
  render(
    <MemoryRouter initialEntries={[`/cards/${slug}`]}>
      <Routes><Route path="/cards/:slug" element={<CardPage load={load} />} /></Routes>
    </MemoryRouter>,
  );

test("the page names the card and prints the engine's own reason for each partner", async () => {
  at("krenko-mob-boss", async () => KRENKO);
  expect(await screen.findByRole("heading", { level: 2, name: /Krenko, Mob Boss/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Impact Tremors/ })).toHaveAttribute("href", "/cards/impact-tremors");
  expect(screen.getByText(/Impact Tremors deals 1 damage/)).toBeInTheDocument();
});

/** THE CARD NAME IS AN `h2`, NOT AN `h1`, AND THAT IS NOT A STYLE CHOICE. `index.html` carries the
 *  page's one `h1` on the static header -- the heading a crawler reads without running the bundle --
 *  and `seo.test.ts` asserts there is exactly one. A second `h1` here would be two answers to the
 *  same question. Task 11 injects a card-specific heading OUTSIDE `#root`, which is where a crawler
 *  reads it from and where that trade can be revisited. */
test("the card name does not claim the page's one h1", async () => {
  at("krenko-mob-boss", async () => KRENKO);
  await screen.findByRole("heading", { level: 2, name: /Krenko, Mob Boss/ });
  expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
});

/** 38% OF THE CORPUS IS UNREAD, so this is the ordinary case and not the error case. A missing
 *  claim is better than a confident wrong one -- the page says which of the two it is rather than
 *  rendering an empty shell that reads as broken. */
test("an unread card says so rather than rendering an empty page", async () => {
  at("black-lotus", async () => null);
  // IT MUST NOT CLAIM A CARD EXISTS AT A URL THAT MAY NAME NOTHING. The slug is echoed back and
  // both possibilities are named, because this page cannot tell a real unread card from a typo.
  expect(await screen.findByText(/no such page/i)).toBeInTheDocument();
  // De-slugged: a slug is not what anyone typed, and the heading is what they asked for.
  expect(screen.getByRole("heading", { name: /black lotus/ })).toBeInTheDocument();
  expect(screen.getByText(/that name is wrong/i)).toBeInTheDocument();
  // THE SEARCH IS SEEDED WITH WHAT WAS ASKED FOR, hyphens back to spaces: a truncated or
  // misremembered name is the likelier of the two cases, and this is the recovery from it.
  expect(screen.getByRole("link", { name: /Search for/ }))
    .toHaveAttribute("href", "/cards?q=black%20lotus");
});

/** NAME, TYPE LINE AND MANA COST ARE CARD METADATA AND THE PAGE IS UNUSABLE WITHOUT THEM. The
 *  RULES text is absent entirely -- spec D2, reversed 2026-09-04: the evidence a reader checks a
 *  claim against is the engine's own reason sentence, not a reprint of the card. Quoting the card
 *  would only make this a card database, which is what Scryfall's "may not simply repackage" clause
 *  is about.
 *
 *  ASSERTED ON THE DATA, not just on the rendering, because the rendering cannot prove a negative:
 *  if a later change puts card text back into the artifact, this fails and the policy call has to
 *  be made deliberately rather than drifted into. */
test("the page shows card metadata and the artifact carries no rules text to show", async () => {
  at("krenko-mob-boss", async () => KRENKO);
  expect(await screen.findByText(/Legendary Creature — Goblin Warrior/)).toBeInTheDocument();
  // THE COST IS MANA SYMBOLS, not a `{2}{R}{R}` string: real symbols are what a player reads, and
  // DESIGN.md makes them the one place Wizards' own palette is used verbatim.
  expect(screen.getByRole("img", { name: /2 generic mana, one red mana, one red mana/ })).toBeInTheDocument();
  for (const field of ["clauses", "oracleText", "text"]) {
    expect(KRENKO, `the artifact must not carry ${field}`).not.toHaveProperty(field);
  }
});

/** WHAT `PER_EVENT_CAP` WITHHELD, SAID RATHER THAN PADDED. Three rows plus a count is the same fact
 *  as twenty rows that all say "triggers when a creature enters", and `pool` is a CANDIDATE count,
 *  so the page has to word it as one -- these are cards that demand the event, not verified edges. */
test("a capped event says how many candidates it is not showing, as candidates", async () => {
  at("krenko-mob-boss", async () => KRENKO);
  // The count sits under the event group it is about, not at the foot of the page.
  const line = await screen.findByText(/other cards ask for it too/);
  expect(line.textContent).toMatch(/1,908/);
});

/** A CARD WITH NO PARTNERS IS A REAL ANSWER. 12.3% of substantive cards have none, and an empty
 *  list with no sentence reads as a page that failed to load. */
test("a card with no partners says so", async () => {
  at("lonely-card", async () => ({ ...KRENKO, partners: [], pool: {} }));
  expect(await screen.findByText(/no partner/i)).toBeInTheDocument();
});

/** THE CARD ITSELF, WHOLE — and whole is a licence line, not a taste one. An art crop obliges the
 *  site to credit the artist and the corpus has no artist field (0 of 34,433); the full card prints
 *  that credit bottom-left, which is the branch spec D2a offers. It is also what let the pages stop
 *  printing a second copy of the oracle text. */
test("the page shows the whole card, at the /normal/ size and never the crop", async () => {
  at("krenko-mob-boss", async () => KRENKO);
  const img = await screen.findByRole("img", { name: /Krenko, Mob Boss — the card/ });
  expect(img).toHaveAttribute("src", expect.stringContaining("/normal/"));
  expect(img.getAttribute("src")).not.toContain("art_crop");
  expect(img).toHaveAttribute("loading", "lazy");
});

/** 491 CORPUS CARDS HAVE NO IMAGE. The page renders without one rather than reserving a hole. */
test("a card with no image renders without one", async () => {
  at("krenko-mob-boss", async () => ({ ...KRENKO, artCrop: null }));
  await screen.findByRole("heading", { level: 2, name: /Krenko, Mob Boss/ });
  expect(screen.queryByRole("img", { name: /the card/ })).toBeNull();
});

/** THE CARD ITSELF, WHOLE — and whole is a licence line, not a taste one. An art crop obliges the
 *  site to credit the artist and the corpus has no artist field (0 of 34,433 cards); the full card
 *  prints that credit bottom-left, which is the branch spec D2a offers. It is also what lets the
 *  pages around it stop printing a second copy of the oracle text. */
test("the page shows the whole card, at the /normal/ size and never the crop", async () => {
  at("krenko-mob-boss", async () => KRENKO);
  const img = await screen.findByRole("img", { name: /Krenko, Mob Boss — the card/ });
  expect(img.getAttribute("src")).toContain("/normal/");
  expect(img.getAttribute("src")).not.toContain("art_crop");
  expect(img).toHaveAttribute("loading", "lazy");
});

/** 491 CORPUS CARDS HAVE NO IMAGE. The page renders without one rather than reserving a hole. */
test("a card with no image renders without one", async () => {
  at("krenko-mob-boss", async () => ({ ...KRENKO, artCrop: null }));
  await screen.findByRole("heading", { level: 2, name: /Krenko, Mob Boss/ });
  expect(screen.queryByRole("img", { name: /the card/ })).toBeNull();
});

/** THE NUMBER THE ORDER IS COMPUTED FROM HAS TO BE ON SCREEN. The page showed only how many cards
 *  ASK for an event and ranked on how many can CAUSE it -- two different populations. A skeptic
 *  reconstructed the ranking from the visible figure, found it non-monotonic, and concluded the
 *  ranking was broken. It was not; the evidence was missing. */
test("a group states the rarity its ranking is computed from", async () => {
  at("krenko-mob-boss", async () => KRENKO);
  const line = await screen.findByText(/cards can cause this/);
  expect(line.textContent).toMatch(/2,879/);
});

/** A LIMIT THE PAGE STATES IS HONEST; A LIMIT IT HIDES IS NOT. 3,453 consumer abilities carry no
 *  effect kind, so their sentence ends at "triggers" -- and used to sit in the same typeface as the
 *  rows that say something. */
test("a row whose effect the engine could not read says so", async () => {
  at("krenko-mob-boss", async () => ({
    ...KRENKO,
    partners: [{ ...KRENKO.partners[0]!, reason: "When a Goblin enters, X triggers", unread: true as const }],
  }));
  expect(await screen.findByText(/engine did not read what it does/)).toBeInTheDocument();
});

test("a row the engine did read carries no such marker", async () => {
  at("krenko-mob-boss", async () => KRENKO);
  await screen.findByRole("heading", { level: 2, name: /Krenko, Mob Boss/ });
  expect(screen.queryByText(/engine did not read/)).toBeNull();
});
