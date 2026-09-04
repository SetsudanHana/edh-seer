import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, test } from "vitest";
import { CommanderPage } from "./CommanderPage.js";
import type { CardPageData } from "../lib/partners.js";

const row = (name: string, slug: string, event = "enters|creature|-|-") => ({
  name, slug, score: 0.126, event, reason: `When a goblin enters thanks to Krenko, Mob Boss, ${name} triggers`,
});

const KRENKO: CardPageData = {
  name: "Krenko, Mob Boss",
  typeLine: "Legendary Creature — Goblin Warrior",
  manaCost: "{2}{R}{R}",
  identity: ["R"],
  commander: true,
  emits: ["create-token|creature|goblin|t", "enters|creature|goblin|t"],
  demands: ["dies|creature|-|-"],
  partners: [row("Simic Payoff", "simic-payoff"), row("Red Payoff", "red-payoff")],
  pool: { "enters|creature|-|-": 1909 },
  commanderPartners: [row("Red Payoff", "red-payoff")],
  commanderPool: { "enters|creature|-|-": 800 },
};

const at = (slug: string, load: () => Promise<CardPageData | null>) =>
  render(
    <MemoryRouter initialEntries={[`/commanders/${slug}`]}>
      <Routes><Route path="/commanders/:slug" element={<CommanderPage load={load} />} /></Routes>
    </MemoryRouter>,
  );

/** THE WHOLE REASON THIS URL EXISTS (spec D5). Two pages about the same card that print the same
 *  list are duplicate content competing with each other; the commander page ranks over the cards
 *  this commander's deck could legally contain, which is a different list and a different order. */
test("a commander's partners are the ones its deck could legally contain", async () => {
  at("krenko-mob-boss", async () => KRENKO);
  expect(await screen.findByRole("link", { name: /Red Payoff/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Simic Payoff/ })).not.toBeInTheDocument();
});

test("the commander page links to the card page", async () => {
  at("krenko-mob-boss", async () => KRENKO);
  expect(await screen.findByRole("link", { name: /what the engine reads/i }))
    .toHaveAttribute("href", "/cards/krenko-mob-boss");
});

/** THE LABELS COME FROM THE CARD'S OWN EVENTS, and `themesOf` returns every one that fits rather
 *  than picking. Krenko makes tokens and watches creatures die. */
test("the page names the archetypes this commander's own events point at", async () => {
  at("krenko-mob-boss", async () => KRENKO);
  expect(await screen.findByText(/Tokens/)).toBeInTheDocument();
  expect(screen.getByText(/Aristocrats/)).toBeInTheDocument();
});

/** WHAT THE DECK HAS TO BRING. Krenko wants creatures dying and kills none himself. */
test("a demand the commander does not answer itself is listed as one the deck must cover", async () => {
  at("krenko-mob-boss", async () => KRENKO);
  // ENGLISH, NOT THE KEY: `dies|creature|-|-` is engine vocabulary and this page is read by someone
  // who has never seen it.
  expect(await screen.findByText("a creature dying")).toBeInTheDocument();
});

/** A GOBLIN TOKEN ENTERING IS A CREATURE ENTERING, so this commander answers its own demand and the
 *  page must not tell a reader to go find something they already have.
 *
 *  ASSERTED INSIDE THE SECTION, because the event key also appears on every partner row below --
 *  the first cut of this matched those and failed for the wrong reason. */
test("a self-supplied demand is not listed as a gap", async () => {
  at("krenko-mob-boss", async () => ({ ...KRENKO, demands: ["enters|creature|-|-"] }));
  const heading = await screen.findByRole("heading", { name: /other 99 cards/i });
  const section = heading.parentElement!;
  expect(within(section).getByText(/answers every event it watches/i)).toBeInTheDocument();
  expect(within(section).queryByText(/entering the battlefield/)).toBeNull();
});

/** A CARD THAT CANNOT LEAD A DECK HAS NO COMMANDER PAGE, and saying so beats rendering an empty
 *  one: the URL is guessable, so a reader will arrive here for Sol Ring. */
test("a card that is not a commander says so and points at its card page", async () => {
  at("sol-ring", async () => ({ ...KRENKO, name: "Sol Ring", commander: false, commanderPartners: undefined }));
  expect(await screen.findByText(/cannot lead a deck/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /what the engine reads/i }))
    .toHaveAttribute("href", "/cards/sol-ring");
});

test("an unread card says so rather than rendering an empty page", async () => {
  at("black-lotus", async () => null);
  expect(await screen.findByRole("heading", { name: /No page for/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Search the commanders/ })).toHaveAttribute("href", "/commanders");
});
