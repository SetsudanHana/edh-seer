import { expect, test } from "vitest";
import { GATE_CONFIDENCE, GATE_TURN, gateProbability, gateVerdict, lineGateVerdict } from "./gate.js";
import { CORPUS_MEDIAN_CLOCK, REQUIRED_CONFIDENCE } from "./deck-math.js";
import { mkLine } from "./mana-test-support.js";
import type { DeckCard } from "./types.js";

const dc = (name: string, typeLine: string, oracleText = ""): DeckCard => ({ card: { name, typeLine, oracleText, manaValue: 1 } as never, tags: null });
const copies = (n: number, make: (i: number) => DeckCard): DeckCard[] => Array.from({ length: n }, (_, i) => make(i));
const filler = (n: number): DeckCard[] => copies(n, (i) => dc(`Spell ${i}`, "Instant"));
/** A 100-card deck: `own` plus filler. */
const deckOf = (...own: DeckCard[][]): DeckCard[] => { const cards = own.flat(); return [...cards, ...filler(100 - cards.length)]; };

test("the gate horizon is the deck-math one (not imported there: deck-math reaches this module through land-score)", () => {
  expect(GATE_TURN).toBe(CORPUS_MEDIAN_CLOCK);
  expect(GATE_CONFIDENCE).toBe(REQUIRED_CONFIDENCE);
});

test("'you control a <subtype>' is met by a deck that has enough of the subtype to draw one by the median clock, not by one stray card (Mox Jasper)", () => {
  const dragons = (n: number) => copies(n, (i) => dc(`Dragon ${i}`, "Creature — Dragon"));
  expect(gateVerdict("you control a dragon", deckOf(dragons(12)))).toBe("met");
  expect(gateVerdict("you control a dragon", deckOf(dragons(1)))).toBe("unmet");
  expect(gateVerdict("you control a dragon", deckOf([]))).toBe("unmet");
  // 12 Dragons make the gate near-certain and a lone one makes it unlikely: the probability is what a quality weight reads
  expect(gateProbability("you control a dragon", deckOf(dragons(12)))!).toBeGreaterThan(0.8);
  expect(gateProbability("you control a dragon", deckOf(dragons(1)))!).toBeLessThan(0.2);
});

test("a card type, an 'or' of land types and a count ('three or more artifacts', Mox Opal) are read off the deck's type lines", () => {
  const artifacts = copies(25, (i) => dc(`Rock ${i}`, "Artifact"));
  expect(gateVerdict("you control three or more artifacts", deckOf(artifacts))).toBe("met");
  expect(gateVerdict("you control three or more artifacts", deckOf(copies(3, (i) => dc(`Rock ${i}`, "Artifact"))))).toBe("unmet");
  expect(gateVerdict("you control an artifact", deckOf(artifacts))).toBe("met");
  const swamps = copies(14, () => dc("Swamp", "Basic Land — Swamp"));
  expect(gateVerdict("you control a plains or a swamp", deckOf(swamps))).toBe("met");
  expect(gateVerdict("you control a forest or a plains", deckOf(swamps))).toBe("unmet");
  // a land with the type counts, a dual with both
  expect(gateVerdict("you control a swamp", deckOf(copies(10, () => dc("Watery Grave", "Land — Island Swamp"))))).toBe("met");
});

test("lands: 'five or more lands' and 'three or more lands with the same name' (Temple, Sceptre of Eternal Glory)", () => {
  const lands = copies(36, (i) => dc(i < 20 ? "Forest" : `Land ${i}`, i < 20 ? "Basic Land — Forest" : "Land"));
  expect(gateVerdict("you control five or more lands", deckOf(lands))).toBe("met");
  expect(gateVerdict("you control five or more lands", deckOf(copies(3, () => dc("Forest", "Basic Land — Forest"))))).toBe("unmet");
  expect(gateVerdict("you control three or more lands with the same name", deckOf(lands))).toBe("met");
  // no land name is repeated: nothing has 'the same name'
  expect(gateVerdict("you control three or more lands with the same name", deckOf(copies(36, (i) => dc(`Land ${i}`, "Land"))))).toBe("unmet");
});

test("'you have the initiative' is met by a deck with a card that takes it (Sarevok's Tome does itself) and not otherwise", () => {
  const tome = dc("Sarevok's Tome", "Artifact — Book", "When this artifact enters, you take the initiative.\n{T}: Add {C}. If you have the initiative, add {C}{C} instead.");
  expect(gateVerdict("you have the initiative", deckOf([tome]))).toBe("met");
  expect(gateVerdict("you have the initiative", deckOf([]))).toBe("unmet");
});

test("a gate that is a game state, the card's own state or a trigger is unknown, never met (Yue's trigger, speed, counters, 'entered this turn')", () => {
  const deck = deckOf(copies(40, (i) => dc(`Rock ${i}`, "Artifact")));
  for (const g of ["when princess yue dies", "speed 4", "an opponent has three or more poison counters", "this land entered this turn",
    "there are three or more brick counters on this artifact", "this creature has a +1/+1 counter on it", "there are seven or more cards in your graveyard", "it was bargained",
    "you control a legendary creature", "you control an urza's mine and an urza's tower"]) {
    expect(gateVerdict(g, deck), g).toBe("unknown");
  }
});

test("a line with no gate is met; a gated line with no deck to judge it against is unknown (the pre-deck behaviour: never credited)", () => {
  expect(lineGateVerdict(mkLine(), undefined)).toBe("met");
  expect(lineGateVerdict(mkLine({ gate: "you control a dragon" }), undefined)).toBe("unknown");
  expect(lineGateVerdict(mkLine({ gate: "you control a dragon" }), deckOf(copies(12, (i) => dc(`Dragon ${i}`, "Creature — Dragon"))))).toBe("met");
});
