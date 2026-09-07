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
  artCrop: "https://cards.scryfall.io/art_crop/front/8/2/824b2d73.jpg",
  abilities: [{
    kind: "activated", cost: "{T}", when: [], effect: "token-generation",
    scaling: "per-permanent", counts: "goblin",
    emits: ["create-token|creature|goblin|t", "enters|creature|goblin|t"],
  }],
  identity: ["R"],
  commander: true,
  emits: ["create-token|creature|goblin|t", "enters|creature|goblin|t"],
  demands: ["dies|creature|-|-"],
  partners: [row("Simic Payoff", "simic-payoff"), row("Red Payoff", "red-payoff")],
  pool: { "enters|creature|-|-": 1909 },
  rarity: { "enters|creature|-|-": 2879 },
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
  const heading = await screen.findByText(/the other 99 have to bring/i);
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
  expect(await screen.findByText(/no such page/i)).toBeInTheDocument();
  // THE SEARCH IS SEEDED WITH WHAT WAS ASKED FOR, hyphens back to spaces: a truncated or
  // misremembered name is the likelier of the two cases, and this is the recovery from it.
  expect(screen.getByRole("link", { name: /Search for/ }))
    .toHaveAttribute("href", "/commanders?q=black%20lotus");
});

/** A PAIR IS A LINK. Picking a partner or a colour lives in the URL, so the identity and the list
 *  the page shows for that pair can be shared and undone with the back button. */
const WILSON: CardPageData = {
  ...KRENKO,
  name: "Wilson, Refined Grizzly", typeLine: "Legendary Creature — Bear Warrior", identity: ["G"],
  commanderPartners: [row("Green Payoff", "green-payoff")],
  pairsWith: [{ slug: "haunted-one", name: "Haunted One", identity: ["B"], licence: "choose a background" }],
  commanderPartnersBy: { BG: { partners: [row("Black Payoff", "black-payoff")], pool: {}, rarity: {} } },
};
const HAUNTED: CardPageData = {
  ...KRENKO,
  name: "Haunted One", typeLine: "Legendary Enchantment — Background", identity: ["B"],
  pairingOnly: true, commanderPartners: [row("Rat Payoff", "rat-payoff")],
  pairsWith: [{ slug: "wilson-refined-grizzly", name: "Wilson, Refined Grizzly", identity: ["G"], licence: "choose a background" }],
  commanderPartnersBy: { BG: { partners: [row("Golgari Payoff", "golgari-payoff")], pool: {}, rarity: {} } },
};
const CLARA: CardPageData = {
  ...KRENKO, name: "Clara Oswald", identity: [], choosesColour: true,
  commanderPartnersBy: { U: { partners: [row("Blue Payoff", "blue-payoff")], pool: {}, rarity: {} } },
};
const BY_SLUG: Record<string, CardPageData> = {
  "wilson-refined-grizzly": WILSON, "haunted-one": HAUNTED, "clara-oswald": CLARA,
};
const atUrl = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/commanders/:slug" element={<CommanderPage load={async (s) => BY_SLUG[s] ?? null} />} /></Routes>
    </MemoryRouter>,
  );

test("a commander that may pair lists who it may pair with", async () => {
  atUrl("/commanders/wilson-refined-grizzly");
  expect(await screen.findByRole("link", { name: /Haunted One/ })).toHaveAttribute("href", "/commanders/wilson-refined-grizzly?with=haunted-one");
  expect(screen.getByText(/choose a background/i)).toBeInTheDocument();
});

test("picking a partner widens the identity and merges both halves' lists at that identity", async () => {
  atUrl("/commanders/wilson-refined-grizzly?with=haunted-one");
  expect(await screen.findByRole("link", { name: /Black Payoff/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Golgari Payoff/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Green Payoff/ })).not.toBeInTheDocument();
  // The identity line itself, not the Golgari Payoff link, reads the pair's combined identity.
  expect(screen.getByText("colour identity").parentElement).toHaveTextContent(/Golgari/);
});

test("a colour chooser offers five colours and ranks over the chosen one", async () => {
  atUrl("/commanders/clara-oswald?color=U");
  expect(await screen.findByRole("link", { name: /Blue Payoff/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /^white$/i })).toHaveAttribute("href", "/commanders/clara-oswald?color=W");
});

test("a Background says it never leads alone", async () => {
  atUrl("/commanders/haunted-one");
  expect(await screen.findByText(/second commander/i)).toBeInTheDocument();
});

/** WHEN THE PARTNER CHOOSES, THE PICKER IS HERE TOO. The Ninth Doctor's page with Clara picked is
 *  a three-colour deck, and the page has to let the reader say which colour she is. */
const NINTH: CardPageData = {
  ...KRENKO, name: "The Ninth Doctor", identity: ["U", "R"],
  commanderPartners: [row("Izzet Payoff", "izzet-payoff")],
  pairsWith: [{ slug: "clara-oswald", name: "Clara Oswald", identity: [], licence: "doctor's companion", choosesColour: true }],
  commanderPartnersBy: { WUR: { partners: [row("Jeskai Payoff", "jeskai-payoff")], pool: {}, rarity: {} } },
};
const CLARA_COMPANION: CardPageData = {
  ...CLARA,
  pairsWith: [{ slug: "the-ninth-doctor", name: "The Ninth Doctor", identity: ["U", "R"], licence: "doctor's companion" }],
  commanderPartnersBy: { ...CLARA.commanderPartnersBy, WUR: { partners: [row("Clara Jeskai", "clara-jeskai")], pool: {}, rarity: {} } },
};
BY_SLUG["the-ninth-doctor"] = NINTH;
BY_SLUG["clara-oswald"] = CLARA_COMPANION;

test("a partner who chooses a colour brings the colour picker to the lead's page", async () => {
  atUrl("/commanders/the-ninth-doctor?with=clara-oswald&color=W");
  expect(await screen.findByRole("link", { name: /Jeskai Payoff/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Clara Jeskai/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /^blue$/i })).toHaveAttribute("href", "/commanders/the-ninth-doctor?with=clara-oswald&color=U");
  expect(screen.getByText("colour identity").parentElement).toHaveTextContent(/Jeskai/);
});

/** A CARD THE ENGINE READ NOTHING ON SAYS SO, in place of three sentences that are only true of a
 *  card it read. 509 commanders shipped with an empty ability list and "it answers every event it
 *  watches" (branch review, 2026-09-05). */
test("a commander with no derived ability says the engine read nothing rather than claiming it answers everything", async () => {
  BY_SLUG["faceless-one"] = { ...KRENKO, name: "Faceless One", abilities: [], emits: [], demands: [], commanderPartners: [] };
  atUrl("/commanders/faceless-one");
  // The gap paragraph and the empty partner list both say it; either is the point.
  expect((await screen.findAllByText(/read nothing on this card/i)).length).toBeGreaterThan(0);
  expect(screen.queryByText(/answers every event it watches/)).not.toBeInTheDocument();
  expect(screen.queryByText(/refused each one on the merits/)).not.toBeInTheDocument();
});

/** THE PAIR IS TWO CARDS, SO THE RAIL SHOWS TWO CARDS. Owner, 2026-09-05: "when you choose the
 *  option you should see the card image next to the main commander you chose." */
test("picking a partner shows its card beside the commander's", async () => {
  atUrl("/commanders/wilson-refined-grizzly?with=haunted-one");
  expect(await screen.findByRole("img", { name: /^Haunted One/ })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /^Wilson, Refined Grizzly/ })).toBeInTheDocument();
});

test("without a pick, only the commander's card is shown", async () => {
  atUrl("/commanders/wilson-refined-grizzly");
  expect(await screen.findByRole("img", { name: /^Wilson, Refined Grizzly/ })).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: /^Haunted One/ })).not.toBeInTheDocument();
});
