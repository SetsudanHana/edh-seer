import { expect, test } from "vitest";
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
  // Both biases have to travel with the number, and the summary is where a reader meets it.
  expect(summary.biases).toMatch(/ramp/i);
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
