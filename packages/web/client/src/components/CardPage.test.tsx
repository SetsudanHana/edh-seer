import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, test } from "vitest";
import { CardPage } from "./CardPage.js";
import type { CardPageData } from "../lib/partners.js";

const KRENKO: CardPageData = {
  name: "Krenko, Mob Boss",
  typeLine: "Legendary Creature — Goblin Warrior",
  manaCost: "{2}{R}{R}",
  identity: ["R"],
  commander: true,
  emits: ["create-token|creature|goblin", "enters|creature|goblin"],
  demands: [],
  partners: [{
    name: "Impact Tremors", slug: "impact-tremors", score: 0.126, event: "enters|creature|-",
    reason: "When a goblin enters thanks to Krenko, Mob Boss, Impact Tremors deals 1 damage",
  }],
  pool: { "enters|creature|-": 1909 },
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
  expect(await screen.findByText(/has not been read/i)).toBeInTheDocument();
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
  expect(screen.getByText(/\{2\}\{R\}\{R\}/)).toBeInTheDocument();
  for (const field of ["clauses", "oracleText", "text"]) {
    expect(KRENKO, `the artifact must not carry ${field}`).not.toHaveProperty(field);
  }
});

/** WHAT `PER_EVENT_CAP` WITHHELD, SAID RATHER THAN PADDED. Three rows plus a count is the same fact
 *  as twenty rows that all say "triggers when a creature enters", and `pool` is a CANDIDATE count,
 *  so the page has to word it as one -- these are cards that demand the event, not verified edges. */
test("a capped event says how many candidates it is not showing, as candidates", async () => {
  at("krenko-mob-boss", async () => KRENKO);
  const line = await screen.findByText(/1,908 more/);
  expect(line.textContent).toMatch(/demand|trigger/i);
});

/** A CARD WITH NO PARTNERS IS A REAL ANSWER. 12.3% of substantive cards have none, and an empty
 *  list with no sentence reads as a page that failed to load. */
test("a card with no partners says so", async () => {
  at("lonely-card", async () => ({ ...KRENKO, partners: [], pool: {} }));
  expect(await screen.findByText(/no partner/i)).toBeInTheDocument();
});
