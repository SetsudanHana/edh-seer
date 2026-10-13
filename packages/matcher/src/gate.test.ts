import { expect, test } from "vitest";
import { GATE_CONFIDENCE, GATE_TURN, boardCount, boardGateOf, gateMetBy, gateProbability, gateVerdict, lineGateMetBy, lineGateVerdict, permOf } from "./gate.js";
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

test("a gate that is a game state, the card's own state or a trigger is unknown, never met (Yue's trigger, counters, 'entered this turn')", () => {
  const deck = deckOf(copies(40, (i) => dc(`Rock ${i}`, "Artifact")));
  for (const g of ["when princess yue dies", "an opponent has three or more poison counters", "this land entered this turn",
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

test("a board-count gate parses to the permanents it names and how many; every other gate is not one", () => {
  expect(boardGateOf("you control a dragon")).toEqual({ need: 1, nouns: ["dragon"] });
  expect(boardGateOf("you control four or more creatures")).toEqual({ need: 4, nouns: ["creature"] });
  expect(boardGateOf("you control three or more artifacts")).toEqual({ need: 3, nouns: ["artifact"] });
  expect(boardGateOf("you control a mountain or a forest")).toEqual({ need: 1, nouns: ["mountain", "forest"] });
  expect(boardGateOf("you control an artifact")).toEqual({ need: 1, nouns: ["artifact"] });
  for (const g of ["you control three or more lands with the same name", "you control an urza's mine and an urza's tower", "you have the initiative", "speed 4", "you control a land named wastes"]) expect(boardGateOf(g), g).toBeNull();
  const forest = permOf(dc("Forest", "Basic Land \u2014 Forest"))!;
  const dragon = permOf(dc("Dragon", "Creature \u2014 Dragon"))!;
  expect(permOf(dc("Bolt", "Instant"))).toBeNull();
  expect(boardCount(boardGateOf("you control a mountain or a forest")!, [forest, dragon, forest])).toBe(2);
});

// THE SAME GATE BY A TURN (the colour audit and the Karsten inputs ask it; the goldfish counts the permanents of each game): the cards seen by then, and only the permanents that can be
// on the battlefield by then -- a land, or a spell whose mana value is at most the turn.
test("a gate is met BY a turn when enough of what it names could be on the battlefield by then: five-mana Dragons are not castable on turn 4", () => {
  const dragons = (n: number, mv: number) => copies(n, (i) => ({ ...dc(`Dragon ${i}`, "Creature \u2014 Dragon"), card: { name: `Dragon ${i}`, typeLine: "Creature \u2014 Dragon", oracleText: "", manaValue: mv } as never }));
  const heavy = deckOf(dragons(12, 5));
  expect(gateMetBy("you control a dragon", heavy, 5)).toBe(false);
  expect(gateMetBy("you control a dragon", heavy, 6)).toBe(true);
  expect(gateProbability("you control a dragon", heavy, 5)).toBe(0);
  const light = deckOf(dragons(20, 1));
  expect(gateMetBy("you control a dragon", light, 1)).toBe(false);
  expect(gateMetBy("you control a dragon", light, 2)).toBe(true);
  expect(lineGateMetBy(mkLine({ gate: "you control a dragon" }), light, 2)).toBe(true);
  expect(lineGateMetBy(mkLine({ gate: "you control a dragon" }), heavy, 2)).toBe(false);
  expect(lineGateMetBy(mkLine({ gate: "you control a dragon" }), undefined, 9)).toBe(false);
  expect(lineGateMetBy(mkLine(), undefined, 1)).toBe(true);
  // a gate no decklist settles is never met by any turn
  expect(gateMetBy("an opponent has three or more poison counters", light, 9)).toBe(false);
});

// CR 702.179a: speed starts at 1; CR 702.179d: it rises by 1, once each turn, while under 4 -- so "speed 4" is the earliest turn 4 (owner 2026-10-13), in any deck.
test("a max-speed gate is met from turn 4 in any deck, and with no deck at all (CR 702.179a, 702.179d)", () => {
  const deck = deckOf(copies(40, (i) => dc(`Rock ${i}`, "Artifact")));
  for (const turn of [1, 2, 3]) expect(gateMetBy("speed 4", deck, turn), `turn ${turn}`).toBe(false);
  for (const turn of [4, 5, 9]) expect(gateMetBy("speed 4", deck, turn), `turn ${turn}`).toBe(true);
  expect(gateMetBy("speed 4", [], 4)).toBe(true);
  expect(gateVerdict("speed 4", deck)).toBe("met");
  expect(gateVerdict("speed 4", [])).toBe("met");
  const line = mkLine({ gate: "speed 4" });
  expect(lineGateVerdict(line, undefined)).toBe("met");
  expect(lineGateMetBy(line, undefined, 3)).toBe(false);
  expect(lineGateMetBy(line, undefined, 4)).toBe(true);
  expect(gateProbability("speed 4", deck, 3)).toBe(0);
  expect(gateProbability("speed 4", deck)).toBe(1);
});

test("a count of lands cannot exceed the land drops: 'five or more lands' is not met by turn 4 whatever the deck", () => {
  const lands = deckOf(copies(60, (i) => dc(`Land ${i}`, "Land")));
  expect(gateMetBy("you control five or more lands", lands, 4)).toBe(false);
  expect(gateMetBy("you control five or more lands", lands, 5)).toBe(true);
  // ...and a land that is itself the holder of the gate takes a land drop of its own: a Tainted land needs its Swamp AND itself
  const swamps = deckOf(copies(40, (i) => dc(`Swamp ${i}`, "Basic Land \u2014 Swamp")));
  expect(gateMetBy("you control a swamp", swamps, 1)).toBe(true);
  expect(gateMetBy("you control a swamp", swamps, 1, true)).toBe(false);
  expect(gateMetBy("you control a swamp", swamps, 2, true)).toBe(true);
  expect(gateMetBy("you control three or more lands with the same name", deckOf(copies(36, () => dc("Forest", "Basic Land \u2014 Forest"))), 2)).toBe(false);
  expect(gateMetBy("you control three or more lands with the same name", deckOf(copies(36, () => dc("Forest", "Basic Land \u2014 Forest"))), 3)).toBe(true);
});

test("a 0-mana-value spell that holds a gate counts from turn 2, as the goldfish counts it (cast at the end of turn 1, on the board from the next); a land counts at turn 1", () => {
  const free = copies(30, (i) => ({ card: { name: `Free ${i}`, typeLine: "Artifact", oracleText: "", manaValue: 0 } as never, tags: null }) as DeckCard);
  const deck = deckOf(free);
  expect(gateProbability("you control an artifact", deck, 1)).toBe(0);
  expect(gateProbability("you control an artifact", deck, 2)!).toBeGreaterThan(0.3);
  // a land is played on turn 1 and counts then
  expect(gateProbability("you control a swamp", deckOf(copies(30, () => dc("Swamp", "Basic Land — Swamp"))), 1)!).toBeGreaterThan(0.3);
});
