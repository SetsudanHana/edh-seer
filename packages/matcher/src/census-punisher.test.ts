import { describe, expect, test } from "vitest";
import { deckAvailability } from "./availability.js";
import { buildCensus } from "./census.js";
import { pairReasonsAcrossFaces } from "./edges.js";
import { eventKeysForDemand } from "./suggest-keys.js";
import type { DeckCard, Hierarchy } from "./types.js";
import fixtures from "./actor-punisher.fixtures.json" with { type: "json" };

/** THE DEMAND CENSUS AGREES WITH THE GRAPH ABOUT A SYMMETRIC PUNISHER (#1598). #1591 refused the edge from your own producer into
 *  "whenever a player gains life, that player loses ..." (False Cure); the census went on counting that producer as supply, so the
 *  page read "1 want · 3 supply" over a deck with no edge between them, and the unmet-demand finding stayed silent.
 *  Fixtures are STORED rows (`cardTagsDerived` by `oracleId` = `cards._id`, DERIVE 495), the ones actor-punisher.test.ts reads. */
const F = fixtures as unknown as Record<string, DeckCard>;
const H: Hierarchy = {};
const deck = (...names: string[]): DeckCard[] => names.map((n) => F[n]!);
const row = (names: string[], key: string) => deckAvailability(deck(...names), H).find((r) => r.key === key);

/** The cards the census counts as supply for the row, by name. */
const censusSuppliers = (names: string[], key: string): string[] => {
  const d = deck(...names);
  const r = buildCensus(d.map((dc) => dc.tags!), H, { members: true, oracleTexts: d.map((dc) => dc.card.oracleText) })
    .consumers.find((x) => x.key === key);
  return (r?.counterpartIndices ?? []).map((i) => names[i]!).sort();
};
/** The cards the matcher draws an edge from, into the punisher. */
const graphSuppliers = (names: string[], punisher: string): string[] =>
  names.filter((n) => n !== punisher && pairReasonsAcrossFaces(F[n]!, F[punisher]!, H).some((r) => r.consumer === punisher && r.producer === n)).sort();

describe("your own producers are not supply for a punisher of 'that player'", () => {
  test("False Cure + three cards that gain YOU life: 1 want, 0 supply", () => {
    const names = ["False Cure", "Vampire Nighthawk", "Ray of Dissolution", "Alms of the Vein"];
    expect(row(names, "gain-life:* (another player's)")).toMatchObject({ consumers: 1, suppliers: 0, available: 0, selfSupplied: false });
    expect(row(names, "gain-life:*")).toBeUndefined();
    expect(censusSuppliers(names, "gain-life:* (another player's)")).toEqual(graphSuppliers(names, "False Cure"));
  });
  test("Eidolon of the Great Revel + your own cheap spells: 1 want, 0 supply", () => {
    const names = ["Eidolon of the Great Revel", "Lightning Bolt", "Llanowar Elves"];
    expect(row(names, "cast:type:spell (another player's)")).toMatchObject({ consumers: 1, suppliers: 0 });
    expect(row(names, "cast:type:spell")).toBeUndefined();
    expect(censusSuppliers(names, "cast:type:spell (another player's)")).toEqual(graphSuppliers(names, "Eidolon of the Great Revel"));
  });
  test("Phyrexian Tyranny + Divination: 1 want, 0 supply", () => {
    const names = ["Phyrexian Tyranny", "Divination"];
    expect(row(names, "draw:* (another player's)")).toMatchObject({ consumers: 1, suppliers: 0 });
    expect(row(names, "draw:*")).toBeUndefined();
    expect(censusSuppliers(names, "draw:* (another player's)")).toEqual(graphSuppliers(names, "Phyrexian Tyranny"));
  });
});

describe("kept: a producer that makes an opponent, or any player, do it", () => {
  test("Swords to Plowshares (its controller gains the life, stored `opp`) still supplies False Cure", () => {
    const names = ["False Cure", "Vampire Nighthawk", "Swords to Plowshares"];
    expect(row(names, "gain-life:* (another player's)")).toMatchObject({ consumers: 1, suppliers: 1 });
    expect(censusSuppliers(names, "gain-life:* (another player's)")).toEqual(["Swords to Plowshares"]);
    expect(graphSuppliers(names, "False Cure")).toEqual(["Swords to Plowshares"]);
  });
  test("each player draws (Howling Mine, Prosperity) still supplies Phyrexian Tyranny", () => {
    const names = ["Phyrexian Tyranny", "Divination", "Howling Mine", "Prosperity"];
    expect(censusSuppliers(names, "draw:* (another player's)")).toEqual(["Howling Mine", "Prosperity"]);
    expect(graphSuppliers(names, "Phyrexian Tyranny")).toEqual(["Howling Mine", "Prosperity"]);
  });
});

describe("a payoff on the same event is its own row", () => {
  test("Ajani's Pridemate ('whenever you gain life') still counts your lifegain, beside False Cure", () => {
    const names = ["False Cure", "Ajani's Pridemate", "Vampire Nighthawk", "Ray of Dissolution", "Alms of the Vein"];
    expect(row(names, "gain-life:*")).toMatchObject({ consumers: 1, suppliers: 3 });
    expect(row(names, "gain-life:* (another player's)")).toMatchObject({ consumers: 1, suppliers: 0 });
  });
  test("with no punisher in the deck nothing moves", () => {
    const names = ["Ajani's Pridemate", "Vampire Nighthawk", "Ray of Dissolution", "Alms of the Vein"];
    expect(row(names, "gain-life:*")).toMatchObject({ consumers: 1, suppliers: 3 });
    expect(deckAvailability(deck(...names), H).some((r) => r.key.endsWith("(another player's)"))).toBe(false);
  });
  test("the producer side agrees: your lifegain is heard by no card when the only listener is False Cure", () => {
    const heard = (names: string[]) => {
      const d = deck(...names);
      const r = buildCensus(d.map((dc) => dc.tags!), H, { members: true, oracleTexts: d.map((dc) => dc.card.oracleText) })
        .producers.find((x) => x.key === "gain-life:*");
      return (r?.counterpartIndices ?? []).map((i) => names[i]!).sort();
    };
    expect(heard(["False Cure", "Vampire Nighthawk"])).toEqual([]);
    expect(heard(["False Cure", "Swords to Plowshares"])).toEqual(["False Cure"]);
    expect(heard(["False Cure", "Ajani's Pridemate", "Vampire Nighthawk"])).toEqual(["Ajani's Pridemate"]);
  });
});

describe("a caller with no printed text keeps the old count", () => {
  test("buildCensus without oracleTexts: False Cure's row is unmarked and counts your lifegain", () => {
    const names = ["False Cure", "Vampire Nighthawk", "Ray of Dissolution", "Alms of the Vein"];
    const r = buildCensus(deck(...names).map((dc) => dc.tags!), H).consumers.find((x) => x.key.startsWith("gain-life"));
    expect(r).toMatchObject({ key: "gain-life:*", cards: 1, counterpart: 3 });
  });
});

test("the marked key still resolves to event keys for the suggestions", () => {
  expect(eventKeysForDemand("gain-life:* (another player's)", ["gain-life|-|-|-", "draw|-|-|-"])).toEqual(["gain-life|-|-|-"]);
});
