import { describe, expect, it, test } from "vitest";
import type { Card } from "@mtg/engine";
import { pAtLeast, seen } from "@mtg/engine";
import { cardCastability, deckCastability } from "./castability.js";
import type { DeckCard } from "./types.js";

const spell = (name: string, manaCost: string, manaValue: number, oracleText = ""): DeckCard => ({
  card: { name, manaCost, manaValue, typeLine: "Sorcery", oracleText, keywords: [], colors: [] } as Card,
  tags: null,
});

const land = (name: string, produces: string[] = ["B"]): DeckCard => ({
  card: {
    name, typeLine: "Land", oracleText: "", keywords: [], colors: [], manaValue: 0,
    producedMana: produces,
  } as Card,
  tags: null,
});

const deckOf = (spells: DeckCard[], lands: number) => [
  ...spells,
  ...Array.from({ length: lands }, (_, i) => land(`Swamp-${i}`)),
  ...Array.from({ length: 100 - spells.length - lands }, (_, i) => spell(`filler-${i}`, "{2}", 2)),
];

test("the mana axis is P(enough lands by the card's own turn)", () => {
  const deck = deckOf([spell("Damnation", "{2}{B}{B}", 4)], 37);
  const row = cardCastability(deck.find((d) => d.card.name === "Damnation")!, deck);
  expect(row.turn).toBe(4);
  expect(row.mana).toBeCloseTo(pAtLeast(4, 37, seen(4), 100), 10);
});

/** The spec is explicit: do NOT multiply the two axes. Both are driven by the same lands, the
 *  correlation is positive, and the product under-estimates. "Mana yes, colour no" is a different
 *  deck problem from "colour yes, mana no". */
test("the colour axis is reported separately, never folded into the mana one", () => {
  const deck = deckOf([spell("Damnation", "{2}{B}{B}", 4)], 37);
  const row = cardCastability(deck.find((d) => d.card.name === "Damnation")!, deck);
  expect(row.colors).toEqual([
    { color: "B", pips: 2, p: expect.closeTo(pAtLeast(2, 37, seen(4), 100), 10) },
  ]);
  // The product would be the tempting single number, and it is not on the row at all.
  expect(row).not.toHaveProperty("combined");
});

test("a colourless card has a mana axis and no colour rows", () => {
  const deck = deckOf([spell("Sol Ring", "{1}", 1)], 37);
  const row = cardCastability(deck.find((d) => d.card.name === "Sol Ring")!, deck);
  expect(row.colors).toEqual([]);
  expect(row.mana).toBeGreaterThan(0);
});

/** "Refuse the cards the model cannot represent rather than guessing. A silent wrong castability
 *  percentage is worse than a blank -- users will trust that number absolutely." */
test("a cost the model cannot represent is refused, not guessed", () => {
  const deck = deckOf([
    spell("Fireball", "{X}{R}", 1),
    spell("Dig Through Time", "{6}{U}{U}", 8, "Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)"),
    spell("Chord of Calling", "{3}{G}{G}{G}", 6, "Convoke (Your creatures can help cast this spell.)"),
  ], 37);
  for (const name of ["Fireball", "Dig Through Time", "Chord of Calling"]) {
    const row = cardCastability(deck.find((d) => d.card.name === name)!, deck);
    expect(row.mana, name).toBeNull();
    expect(row.refused, name).toBeTruthy();
  }
});

test("a land is not a spell and is left out entirely", () => {
  const deck = deckOf([spell("Bear", "{1}{B}", 2)], 37);
  expect(deckCastability(deck).cards.some((c) => c.name.startsWith("Swamp"))).toBe(false);
});

test("more lands makes the same card more castable", () => {
  const thin = deckOf([spell("Damnation", "{2}{B}{B}", 4)], 30);
  const fat = deckOf([spell("Damnation", "{2}{B}{B}", 4)], 40);
  const p = (deck: DeckCard[]) => cardCastability(deck.find((d) => d.card.name === "Damnation")!, deck).mana!;
  expect(p(fat)).toBeGreaterThan(p(thin));
});

test("the deck summary ranks the hardest casts first and counts what it refused", () => {
  const deck = deckOf([
    spell("Damnation", "{2}{B}{B}", 4),
    spell("Ulamog", "{10}", 10),
    spell("Bear", "{1}{B}", 2),
    spell("Fireball", "{X}{R}", 1),
  ], 37);
  const summary = deckCastability(deck);
  expect(summary.cards[0].name).toBe("Ulamog"); // the least castable of the modelled cards
  expect(summary.refused).toBe(1);
  // Both biases have to travel with the number, and the summary is where a reader meets it: what
  // each end of the range counts, and what neither end counts.
  expect(summary.biases).toMatch(/lands only/i);
  expect(summary.biases).toMatch(/rock/i);
  expect(summary.biases).toMatch(/tapped/i);
});

/** Found live: a decklist that names its commander in both the commander section and the deck body
 *  reaches here twice, and the panel showed Inalla as its own two hardest casts. */
test("a card listed twice is one row", () => {
  const dup = spell("Inalla", "{1}{U}{B}{R}", 4);
  const deck = deckOf([dup, { ...dup }], 37);
  expect(deckCastability(deck).cards.filter((c) => c.name === "Inalla")).toHaveLength(1);
});

test("a commander is priced like any other card but never counted in the library", () => {
  const deck = deckOf([spell("Boss", "{4}{B}{B}", 6)], 37);
  const withCmd = deckCastability(deck, { commanderNames: ["Boss"] });
  const without = deckCastability(deck);
  const p = (s: ReturnType<typeof deckCastability>) => s.cards.find((c) => c.name === "Boss")!.mana!;
  // A 99-card library concentrates the lands slightly, so the same commander is easier to cast.
  expect(p(withCmd)).toBeGreaterThan(p(without));
});

const rock = (name: string, manaValue: number, produces: string[] = ["B"]): DeckCard => ({
  card: {
    name, typeLine: "Artifact", oracleText: "", keywords: [], colors: [], manaValue,
    manaCost: `{${manaValue}}`, producedMana: produces,
  } as Card,
  tags: null,
});

const ritual = (name: string, produces: string[] = ["B"]): DeckCard => ({
  card: {
    name, typeLine: "Instant", oracleText: "", keywords: [], colors: [], manaValue: 1,
    manaCost: "{B}", producedMana: produces,
  } as Card,
  tags: null,
});

/** The pair is the deliverable: lands-only is the floor, lands-plus-rocks the ceiling, and neither
 *  is the answer on its own. */
test("the mana axis is a range, and the rocks end is the higher one", () => {
  const deck = deckOf([spell("Damnation", "{2}{B}{B}", 4), ...Array.from({ length: 6 }, (_, i) => rock(`Signet-${i}`, 2))], 34);
  const row = cardCastability(deck.find((d) => d.card.name === "Damnation")!, deck);
  expect(row.mana).toBeCloseTo(pAtLeast(4, 34, seen(4), 100), 10);
  expect(row.manaWithRocks).toBeCloseTo(pAtLeast(4, 40, seen(4), 100), 10);
  expect(row.manaWithRocks!).toBeGreaterThan(row.mana!);
});

/** A rock cast on the turn the card is due has produced nothing yet, so the two ends collapse and
 *  the reader is told one number rather than a fake interval. */
test("a rock too expensive to be down already does not widen the range", () => {
  const deck = deckOf([spell("Bear", "{1}{B}", 2), ...Array.from({ length: 6 }, (_, i) => rock(`Rock-${i}`, 2))], 34);
  const row = cardCastability(deck.find((d) => d.card.name === "Bear")!, deck);
  expect(row.manaWithRocks).toBe(row.mana);
});

/** A ritual adds mana once and is gone. It is not a source you can hold to 90% on either axis. */
test("a one-shot ritual is not a coloured source and is not a rock", () => {
  const withRituals = deckOf([spell("Damnation", "{2}{B}{B}", 4), ...Array.from({ length: 8 }, (_, i) => ritual(`Dark Ritual-${i}`))], 34);
  const without = deckOf([spell("Damnation", "{2}{B}{B}", 4)], 34);
  const row = (deck: DeckCard[]) => cardCastability(deck.find((d) => d.card.name === "Damnation")!, deck);
  expect(row(withRituals).colors[0].p).toBeCloseTo(row(without).colors[0].p, 10);
  expect(row(withRituals).manaWithRocks).toBeCloseTo(row(without).manaWithRocks!, 10);
});

test("a refused cost has no range either, rather than half a one", () => {
  const deck = deckOf([spell("Fireball", "{X}{R}", 1)], 37);
  const row = cardCastability(deck.find((d) => d.card.name === "Fireball")!, deck);
  expect(row.mana).toBeNull();
  expect(row.manaWithRocks).toBeNull();
});

describe("what 'cast for free' actually refuses (K5a)", () => {
  const c = (name: string, oracleText: string, manaCost = "{2}{B}", manaValue = 3): DeckCard =>
    ({ card: { name, typeLine: "Creature — Human", oracleText, manaCost, manaValue, keywords: [], colors: [] } as never, tags: null });
  const lands = Array.from({ length: 40 }, (_, i) =>
    ({ card: { name: `L${i}`, typeLine: "Basic Land — Swamp", oracleText: "", manaValue: 0, keywords: [], colors: [], producedMana: ["B"] } as never, tags: null }));
  const priced = (dc: DeckCard) => cardCastability(dc, [dc, ...lands]).mana !== null;

  test("the phrase about ANOTHER card does not refuse this one", () => {
    // Hidetsugu and Kairi's DEATH trigger free-casts the exiled card. Six of the 71 decks' own
    // commanders were unpriced for this, which is a blank where a real number belongs.
    expect(priced(c("Hidetsugu and Kairi", "When this creature dies, exile the top card of your library. You may cast it without paying its mana cost."))).toBe(true);
  });

  test("REBOUND is priced: the second cast is free and the FIRST costs its printed mana", () => {
    expect(priced(c("Staggershock", "Rebound (Exile this card as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)"))).toBe(true);
  });

  test("a card that really is free on its first cast is still refused", () => {
    expect(priced(c("Deadly Rollick", "If you control a commander, you may cast this spell without paying its mana cost."))).toBe(false);
  });
});

/** ROADMAP I6. Putting a permanent onto the battlefield from hand is not casting it, so none of the
 *  percentages this module produces apply to whatever it cheats in. The list ships; no rate does. */
describe("cheats into play", () => {
  const cheat = (name: string, text: string): DeckCard => ({
    card: {
      name, typeLine: "Enchantment", manaCost: "{3}{R}", manaValue: 4,
      oracleText: text, keywords: [], colors: ["R"],
    } as DeckCard["card"],
    tags: null,
  });

  it("names a card that puts a creature onto the battlefield from hand", () => {
    const deck = [cheat("Sneak Attack", "{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste.")];
    expect(deckCastability(deck).cheatsIntoPlay).toEqual(["Sneak Attack"]);
  });

  it("REFUSES a land from hand — that is a land drop you already had, which is ramp", () => {
    const deck = [
      cheat("Wrenn and Seven", "You may put any number of land cards from your hand onto the battlefield."),
      cheat("Growth Spiral", "Draw a card. You may put a land card from your hand onto the battlefield."),
    ];
    expect(deckCastability(deck).cheatsIntoPlay).toEqual([]);
  });

  it("does not fire on a card that merely CASTS something for free — a different family", () => {
    const deck = [cheat("Mizzix's Mastery", "Exile target instant or sorcery card from your graveyard. Copy it. You may cast the copy without paying its mana cost.")];
    expect(deckCastability(deck).cheatsIntoPlay).toEqual([]);
  });

  it("changes no percentage — the figures stand and the caveat says what they miss", () => {
    const spell = (i: number): DeckCard => ({
      card: { name: `f-${i}`, typeLine: "Sorcery", manaCost: "{1}", manaValue: 1, oracleText: "", keywords: [], colors: [] } as DeckCard["card"],
      tags: null,
    });
    const base = Array.from({ length: 60 }, (_, i) => spell(i));
    const without = deckCastability(base);
    const with_ = deckCastability([...base, cheat("Sneak Attack", "{R}: You may put a creature card from your hand onto the battlefield.")]);
    for (const row of without.cards) {
      const same = with_.cards.find((r) => r.name === row.name)!;
      expect(same.mana).toBe(row.mana);
      expect(same.manaWithRocks).toBe(row.manaWithRocks);
    }
  });
});
