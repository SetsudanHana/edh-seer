import { expect, test } from "vitest";
import { deckCoverage } from "./coverage.js";
import type { DeckCard } from "./types.js";

const card = (name: string, derived: boolean): DeckCard => ({
  card: { name, typeLine: "Creature", oracleText: "", keywords: [], colors: [], manaValue: 1 } as never,
  tags: derived
    ? ({ oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t", characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 1, power: "1", toughness: "1", token: false, keywords: [] }, abilities: [] } as never)
    : null,
});

test("a fully derived deck admits nothing", () => {
  // A report with nothing to admit should say nothing — the 71 calibration decks are ~99% derived,
  // which is exactly why this defect went unseen.
  expect(deckCoverage([card("a", true), card("b", true)])).toBeUndefined();
});

test("an underived card is counted and named", () => {
  const c = deckCoverage([card("a", true), card("Ash Barrens", false), card("Despark", false)]);
  expect(c?.coverage.resolved).toBe(3);
  expect(c?.coverage.derived).toBe(1);
  expect(c?.coverage.underivedNames).toEqual(["Ash Barrens", "Despark"]);
  expect(c?.coverage.caveat).toContain("2 cards of 3");
});

test("the name list is capped and the rest become a count", () => {
  // The legality report caps at eight for the same reason: a paste can produce dozens, and a list
  // that long stops being read.
  const deck = Array.from({ length: 12 }, (_, i) => card(`card-${String(i).padStart(2, "0")}`, false));
  const c = deckCoverage(deck);
  expect(c?.coverage.underivedNames).toHaveLength(8);
  expect(c?.coverage.more).toBe(4);
});

test("copies of one card are one name", () => {
  // `resolved` counts SLOTS — a 30-copy deck really does have 30 unread cards — but the list a
  // reader scans is names.
  const deck = [card("Dragon's Approach", false), card("Dragon's Approach", false)];
  const c = deckCoverage(deck);
  expect(c?.coverage.resolved).toBe(2);
  expect(c?.coverage.underivedNames).toEqual(["Dragon's Approach"]);
  expect(c?.coverage.more).toBe(0);
  // The COUNT is slots, not names: 2 of this deck's slots form no edges, and saying "1 card" would
  // understate the hole on exactly the arbitrary paste this panel exists for.
  expect(c?.coverage.caveat).toContain("2 cards of 2");
});

test("the claim is narrow, because the loss is narrow", () => {
  // An underived card still counts toward the mana base, land count, castability, legality, the
  // bracket and combo detection — all of which read PRINTED data. Over-stating the loss would be
  // its own wrong answer, so the sentence says which half survives.
  const c = deckCoverage([card("a", true), card("b", false)]);
  expect(c?.coverage.caveat).toContain("no synergy edges");
  expect(c?.coverage.caveat).toContain("still count everywhere else");
});

test("the sentence agrees with its own count, in both directions", () => {
  // Found by reading it on screen, not by a test: `card()` singularised the noun and the three
  // verbs around it stayed plural, so one unread card printed "1 card of 103 are not in the read
  // corpus yet, so they form no synergy edges". A deck one card short of fully read is the common
  // case now that the corpus covers the calibration decks.
  const one = deckCoverage([card("a", true), card("b", false)])!.coverage.caveat;
  expect(one).toContain("1 card of 2 is not in the read corpus yet");
  expect(one).toContain("it forms no synergy edges and carries no theme");
  const many = deckCoverage([card("a", false), card("b", false)])!.coverage.caveat;
  expect(many).toContain("2 cards of 2 are not in the read corpus yet");
  expect(many).toContain("they form no synergy edges and carry no theme");
});
