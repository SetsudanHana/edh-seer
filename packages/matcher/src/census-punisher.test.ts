import { describe, expect, test } from "vitest";
import { deckAvailability } from "./availability.js";
import { buildCensus } from "./census.js";
import { computeDeckMath } from "./deck-math.js";
import { pairReasonsAcrossFaces } from "./edges.js";
import { loadHierarchy } from "./hierarchy.js";
import { eventKeysForDemand } from "./suggest-keys.js";
import type { DeckCard, Hierarchy } from "./types.js";
import fixtures from "./actor-punisher.fixtures.json" with { type: "json" };

/** THE DEMAND CENSUS AGREES WITH THE GRAPH ABOUT A SYMMETRIC PUNISHER (#1598). #1591 refused the edge from your own producer into
 *  "whenever a player gains life, that player loses ..." (False Cure); the census went on counting that producer as supply, so the
 *  page read "1 want · 3 supply" over a deck with no edge between them, and the unmet-demand finding stayed silent.
 *  Fixtures are STORED rows (`cardTagsDerived` by `oracleId` = `cards._id`, DERIVE 495), the ones actor-punisher.test.ts reads. */
const F = fixtures as unknown as Record<string, DeckCard>;
// The shipped hierarchy: with an empty one an instant is not a "spell", and "your spells are not Eidolon's supply" would pass on main too.
const H: Hierarchy = loadHierarchy();
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

/** ANOTHER PLAYER'S ROUTINE ACTION HAPPENS ON ITS OWN (owner ruling 2026-11-11, #1598). After the you-refusal a punisher's row read
 *  1 want / 0 supply in every deck, and so did a trigger that watches only opponents (Kaervek the Merciless): the page then said
 *  "a spell being cast (by another player) -- and nothing in the deck does it" and offered your own spells. Opponents cast, draw
 *  and put permanents onto the battlefield unaided, so such a row is self-supplied; what they do not do unaided (gain life,
 *  discard) is still a demand. Supplier counts are untouched. */
describe("a demand only another player's routine action satisfies is self-supplied", () => {
  const routine = { suppliers: 0, selfSupplied: true, available: null };
  test("a punisher on cast (Eidolon of the Great Revel), draw (Phyrexian Tyranny) and enters (Nature's Wrath)", () => {
    expect(row(["Eidolon of the Great Revel", "Lightning Bolt", "Llanowar Elves"], "cast:type:spell (another player's)")).toMatchObject({ consumers: 1, ...routine });
    expect(row(["Phyrexian Tyranny", "Divination"], "draw:* (another player's)")).toMatchObject({ consumers: 1, ...routine });
    const wrath = deckAvailability(deck("Nature's Wrath", "Island", "Merfolk Looter"), H).filter((r) => r.key.startsWith("enters:"));
    expect(wrath.map((r) => r.key)).toEqual(["enters:* (another player's)"]);
    expect(wrath[0]).toMatchObject({ consumers: 1, ...routine });
  });
  test("a trigger that watches only opponents: Kaervek the Merciless (cast), Underworld Dreams (draw)", () => {
    expect(row(["Kaervek the Merciless", "Lightning Bolt", "Llanowar Elves"], "cast:type:spell")).toMatchObject({ consumers: 1, ...routine });
    expect(row(["Underworld Dreams", "Divination"], "draw:*")).toMatchObject({ consumers: 1, ...routine });
  });
  test("a supplier is still counted: each player draws (Howling Mine) beside Phyrexian Tyranny", () => {
    expect(row(["Phyrexian Tyranny", "Divination", "Howling Mine"], "draw:* (another player's)")).toMatchObject({ suppliers: 1, selfSupplied: true, available: null });
  });
});

describe("kept as a demand: what another player does not do unaided, and what you do", () => {
  test("False Cure with no opponent lifegain is unmet; with Swords to Plowshares it is priced", () => {
    expect(row(["False Cure", "Vampire Nighthawk"], "gain-life:* (another player's)")).toMatchObject({ suppliers: 0, selfSupplied: false, available: 0 });
    const met = row(["False Cure", "Vampire Nighthawk", "Swords to Plowshares"], "gain-life:* (another player's)")!;
    expect(met).toMatchObject({ suppliers: 1, selfSupplied: false });
    expect(met.available).toBeGreaterThan(0);
  });
  test("an opponent's discard (Megrim) is unmet with no discard source", () => {
    expect(row(["Megrim", "Lightning Bolt"], "discard:*")).toMatchObject({ consumers: 1, suppliers: 0, selfSupplied: false, available: 0 });
  });
  // The row is read as it was on 7e495047: the ruling is about another player's action, so neither `you` nor `any` moves. (That an
  // unnarrowed cast trigger counts no implied cast as supply is `castSelfSupplied`'s, older than this file.)
  test("'whenever you cast a spell' (Manaplasm) is unchanged: still a priced demand", () => {
    const names = ["Manaplasm", "Lightning Bolt", "Llanowar Elves"];
    expect(row(names, "cast:type:spell")).toMatchObject({ consumers: 1, suppliers: 0, selfSupplied: false, available: 0 });
    expect(deckAvailability(deck(...names), H).some((r) => r.key.endsWith("(another player's)"))).toBe(false);
  });
  test("'whenever a player casts a spell' with no 'that player' price (Standstill) is unchanged: the deck can supply it", () => {
    expect(row(["Standstill", "Lightning Bolt", "Llanowar Elves"], "cast:type:spell")).toMatchObject({ consumers: 1, selfSupplied: false, available: 0 });
  });
  test("a row shared with your own trigger stays a demand: Kaervek beside Manaplasm, nothing to cast", () => {
    expect(row(["Kaervek the Merciless", "Manaplasm", "Island"], "cast:type:spell")).toMatchObject({ consumers: 2, selfSupplied: false });
  });
});

/** THE ROW THE PAGE READS. `computeDeckMath` hands `deckMath.demand` to findings.ts and suggest-static.ts, whose unmet-demand test
 *  is `available !== null && suppliers === 0 && consumers > 0`. On 7e495047 Eidolon's row passed it: "1 card is waiting for
 *  something the deck never does ... a spell being cast (by another player)", and the suggestions offered your own spells. */
describe("through computeDeckMath: what the unmet-demand finding is given", () => {
  const unmet = (...names: string[]) =>
    computeDeckMath(deck(...names), H).demand.filter((d) => d.available !== null && d.suppliers === 0 && d.consumers > 0).map((d) => d.key);
  test("Eidolon, Phyrexian Tyranny, Nature's Wrath and Kaervek leave nothing unmet", () => {
    const names = ["Eidolon of the Great Revel", "Phyrexian Tyranny", "Nature's Wrath", "Kaervek the Merciless", "Lightning Bolt", "Llanowar Elves", "Divination", "Island"];
    const demand = computeDeckMath(deck(...names), H).demand;
    expect(demand.map((d) => d.key).sort()).toEqual(["cast:type:spell", "cast:type:spell (another player's)", "draw:* (another player's)", "enters:* (another player's)", "upkeep:*"]);
    expect(demand.map((d) => d.available)).toEqual([null, null, null, null, null]);
    expect(unmet(...names)).toEqual([]);
  });
  test("False Cure with no opponent lifegain is still handed over as unmet", () => {
    expect(unmet("False Cure", "Vampire Nighthawk", "Ray of Dissolution", "Alms of the Vein")).toEqual(["gain-life:* (another player's)"]);
  });
});
