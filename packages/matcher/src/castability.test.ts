import { describe, expect, it, test } from "vitest";
import type { Card } from "@mtg/engine";
import { cardCastability, costRefusal, deckCastability } from "./castability.js";
import { manaModel } from "./goldfish.js";
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

/** Castability is read off the SIMULATED BOARD now, not off a hypergeometric, so every test here
 *  goes through the same model the report does. Small trial counts: these assert structure and
 *  ordering, not third-decimal probabilities. */
const curvesFor = (deck: DeckCard[], alsoPrice: DeckCard[] = []) =>
  manaModel(deck, { trials: 600, seed: 5, alsoPrice }).curves;
const rowFor = (deck: DeckCard[], name: string) =>
  cardCastability(deck.find((d) => d.card.name === name)!, curvesFor(deck));

test("castability is ONE number now, and it means you can cast the card", () => {
  const deck = deckOf([spell("Damnation", "{2}{B}{B}", 4)], 37);
  const row = rowFor(deck, "Damnation");
  expect(row.turn).toBe(4);
  // The interval is the PLAY POLICY, not two arithmetic biases, so the low end is the arm that
  // holds up two mana and the high one the greedy ceiling.
  expect(row.castable!.low).toBeLessThanOrEqual(row.castable!.high);
  expect(row.castable!.high).toBeGreaterThan(0);
  // Mana is kept as the DIAGNOSTIC and can only ever be at least castability: colour takes away.
  expect(row.castable!.high).toBeLessThanOrEqual(row.mana!.high);
});

test("a colour the deck cannot make is what separates the two figures", () => {
  // Every land is a Swamp, so the mana is there and the blue is not. This is the whole reason the
  // old two-axis report existed, and the whole reason it could not combine them.
  const deck = deckOf([spell("Counterspell", "{U}{U}", 2)], 37);
  const row = rowFor(deck, "Counterspell");
  expect(row.mana!.high).toBeGreaterThan(0.5);
  expect(row.castable!.high).toBe(0);
});

test("a colourless card reads the same on both figures", () => {
  const deck = deckOf([spell("Sol Ring", "{1}", 1)], 37);
  const row = rowFor(deck, "Sol Ring");
  expect(row.castable).toEqual(row.mana);
});

test("a cost the model cannot represent is refused, not guessed", () => {
  const deck = deckOf([spell("Fireball", "{X}{R}", 1)], 37);
  const row = rowFor(deck, "Fireball");
  expect(row.castable).toBeNull();
  expect(row.mana).toBeNull();
  expect(row.refused).toMatch(/X cost/);
  // The refusal list is exported on its own, because a caller can want the reason without a number.
  expect(costRefusal(spell("Fireball", "{X}{R}", 1))).toMatch(/X cost/);
  expect(costRefusal(spell("Plain", "{1}{R}", 2))).toBeUndefined();
});

test("a card past the simulated horizon is refused rather than priced at a nearer turn", () => {
  const deck = deckOf([spell("Emrakul", "{15}", 15)], 37);
  const row = rowFor(deck, "Emrakul");
  expect(row.castable).toBeNull();
  expect(row.refused).toMatch(/past the 12 turns/);
});

test("a land is not a spell and is left out entirely", () => {
  const deck = deckOf([spell("Damnation", "{2}{B}{B}", 4)], 37);
  expect(deckCastability(deck, curvesFor(deck)).cards.some((r) => r.name.startsWith("Swamp-"))).toBe(false);
});

test("more lands makes the same card more castable", () => {
  const thin = deckOf([spell("Damnation", "{2}{B}{B}", 4)], 20);
  const fat = deckOf([spell("Damnation", "{2}{B}{B}", 4)], 45);
  expect(rowFor(fat, "Damnation").castable!.high)
    .toBeGreaterThan(rowFor(thin, "Damnation").castable!.high);
});

test("the deck summary ranks the hardest casts first and counts what it refused", () => {
  const deck = deckOf([
    spell("Damnation", "{2}{B}{B}", 4),
    spell("Duress", "{B}", 1),
    spell("Fireball", "{X}{R}", 1),
  ], 37);
  const out = deckCastability(deck, curvesFor(deck));
  expect(out.refused).toBeGreaterThanOrEqual(1);
  expect(out.cards.some((r) => r.name === "Fireball")).toBe(false);
  const names = out.cards.map((r) => r.name);
  expect(names.indexOf("Damnation")).toBeLessThan(names.indexOf("Duress"));
  // The caveat ships WITH the number or it should not ship.
  expect(out.biases).toMatch(/play policy/i);
});

test("a card listed twice is one row", () => {
  const one = spell("Damnation", "{2}{B}{B}", 4);
  const deck = [one, one, ...deckOf([], 37)];
  expect(deckCastability(deck, curvesFor(deck)).cards.filter((r) => r.name === "Damnation")).toHaveLength(1);
});

test("a commander is priced without being shuffled into the library", () => {
  // CR 903.6: it is not in the library, and "can I cast my commander on turn six" is still the one
  // card a reader looks for by name. `alsoPrice` is what makes both true at once.
  const cmd = spell("Atraxa", "{2}{B}{B}", 4);
  const library = deckOf([], 37);
  const row = cardCastability(cmd, curvesFor(library, [cmd]));
  expect(row.castable).not.toBeNull();
  // And it is absent from the library's own rows, because it is not in the library.
  expect(deckCastability(library, curvesFor(library, [cmd])).cards.some((r) => r.name === "Atraxa")).toBe(false);
});

test("a card the model never priced is a refusal, never a zero", () => {
  const deck = deckOf([spell("Damnation", "{2}{B}{B}", 4)], 37);
  const row = cardCastability(spell("Stranger", "{1}{B}", 2), curvesFor(deck));
  expect(row.castable).toBeNull();
  expect(row.refused).toMatch(/not priced/);
});

describe("what 'cast for free' actually refuses (K5a)", () => {
  const c = (name: string, oracleText: string, manaCost = "{2}{B}", manaValue = 3): DeckCard =>
    ({ card: { name, typeLine: "Creature — Human", oracleText, manaCost, manaValue, keywords: [], colors: [] } as never, tags: null });
  const lands = Array.from({ length: 40 }, (_, i) =>
    ({ card: { name: `L${i}`, typeLine: "Basic Land — Swamp", oracleText: "", manaValue: 0, keywords: [], colors: [], producedMana: ["B"] } as never, tags: null }));
  const priced = (dc: DeckCard) => costRefusal(dc) === undefined;

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
    expect(deckCastability(deck, new Map()).cheatsIntoPlay).toEqual(["Sneak Attack"]);
  });

  it("REFUSES a land from hand — that is a land drop you already had, which is ramp", () => {
    const deck = [
      cheat("Wrenn and Seven", "You may put any number of land cards from your hand onto the battlefield."),
      cheat("Growth Spiral", "Draw a card. You may put a land card from your hand onto the battlefield."),
    ];
    expect(deckCastability(deck, new Map()).cheatsIntoPlay).toEqual([]);
  });

  it("does not fire on a card that merely CASTS something for free — a different family", () => {
    const deck = [cheat("Mizzix's Mastery", "Exile target instant or sorcery card from your graveyard. Copy it. You may cast the copy without paying its mana cost.")];
    expect(deckCastability(deck, new Map()).cheatsIntoPlay).toEqual([]);
  });

  it("changes no percentage — the figures stand and the caveat says what they miss", () => {
    const spell = (i: number): DeckCard => ({
      card: { name: `f-${i}`, typeLine: "Sorcery", manaCost: "{1}", manaValue: 1, oracleText: "", keywords: [], colors: [] } as DeckCard["card"],
      tags: null,
    });
    const base = [...Array.from({ length: 60 }, (_, i) => spell(i)), ...Array.from({ length: 39 }, (_, i) => land(`Swamp-${i}`))];
    const cheater = cheat("Sneak Attack", "{R}: You may put a creature card from your hand onto the battlefield.");
    const without = deckCastability(base, manaModel(base, { trials: 400, seed: 3 }).curves);
    const with_ = deckCastability([...base, cheater], manaModel(base, { trials: 400, seed: 3 }).curves);
    for (const row of without.cards) {
      const same = with_.cards.find((r) => r.name === row.name)!;
      expect(same.castable).toEqual(row.castable);
    }
  });
});
