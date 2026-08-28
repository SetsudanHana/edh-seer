import { expect, test } from "vitest";
import type { Reason } from "@edh-seer/engine";
import type { CardTags } from "@edh-seer/tagger";
import { buildSupplyDemand, cardRate, ratio, type SupplyDemandInput } from "./supply-demand.js";

const card = (id: string, abilities: CardTags["abilities"]): CardTags => ({
  oracleId: id, schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 0, power: "1", toughness: "1", token: false, keywords: [] },
  abilities,
});

/** Makes three creature tokens on every one of your upkeeps. */
const engine = card("engine", [{
  kind: "triggered",
  trigger: { verbs: ["upkeep"], subject: { control: "you", token: null } },
  effect: { kind: "token-generation", subject: { type: "creature", control: "you", token: true } },
  emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: true } }],
  repeats: "per-cycle",
  amount: "3",
}]);

/** A vanilla creature: supplies `enters:creature` once, by existing. */
const body = card("body", []);

const payoff = card("payoff", [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
  effect: { kind: "draw-card" },
  repeats: "repeatable",
}]);

const reason = (producer: string, consumer: string): Reason =>
  ({ tag: "enters:creature", text: "", producer, consumer });

/** Padded to a real library: `seen(5)` is 12 cards, so a three-card deck is one you have entirely
 *  drawn and every draw probability clamps to 1. */
const deck = (...rows: [string, CardTags, boolean][]): SupplyDemandInput[] => [
  ...rows.map(([name, tags, isCommander]) => ({ name, tags, isCommander })),
  ...Array.from({ length: 40 }, (_, i) => ({ name: `filler${i}`, tags: null, isCommander: false })),
];

const only = (rows: ReturnType<typeof buildSupplyDemand>) => rows[0];

/** The whole reason the row is not just a card count: two suppliers of one shape can be a round
 *  apart in throughput, and the unweighted column cannot tell them apart. */
test("rate separates a repeating token engine from a plain body; the card count does not", () => {
  const row = only(buildSupplyDemand(
    [reason("engine", "payoff"), reason("body", "payoff")],
    deck(["engine", engine, false], ["body", body, false], ["payoff", payoff, false]),
  ));
  expect(row.supply.cards).toBe(2);
  // per-cycle (1/round) x amount 3 for the engine, against the body's single implied entry.
  expect(row.supply.rate).toBe(4);
  expect(row.supply.labels).toEqual({ "per-cycle": 1, implied: 1 });
  expect(ratio(row, "cards")).toBe(2);
  expect(ratio(row, "rate")).toBeCloseTo(4 / 6); // one repeatable payoff = 6 events/round
});

/** The owner's ruling: a commander is available in every game, so its side of a ratio must not be
 *  discounted by a draw probability that does not apply to it. */
test("a commander supplier weighs its full rate; a card in the 99 is discounted by draw odds", () => {
  const r = [reason("engine", "payoff")];
  const asCommander = only(buildSupplyDemand(r, deck(["engine", engine, true], ["payoff", payoff, false])));
  const inLibrary = only(buildSupplyDemand(r, deck(["engine", engine, false], ["payoff", payoff, false])));
  expect(asCommander.supply.commander).toBe(true);
  expect(asCommander.supply.avail).toBe(asCommander.supply.rate);
  expect(inLibrary.supply.commander).toBe(false);
  expect(inLibrary.supply.avail).toBeLessThan(inLibrary.supply.rate);
});

/** UNSET means the rules could not read the label, which is a real outcome and not a zero — but a
 *  row that is mostly refusals is one nobody should fit a curve through, so it is counted. */
test("an ability with no repeats label is weighted neutral and counted as refused", () => {
  const unlabelled = card("unlabelled", [{
    kind: "triggered",
    trigger: { verbs: ["upkeep"], subject: { control: "you", token: null } },
    effect: { kind: "token-generation", subject: { type: "creature", control: "you", token: true } },
    emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: true } }],
  }]);
  const row = only(buildSupplyDemand(
    [reason("unlabelled", "payoff")],
    deck(["unlabelled", unlabelled, false], ["payoff", payoff, false]),
  ));
  expect(row.supply.refused).toBe(1);
  expect(row.supply.rate).toBe(1);
  expect(cardRate(unlabelled, "enters", "supply")).toEqual({ rate: 1, label: "REFUSED" });
});

/** A token has no deck slot and no tags in this path. Counting it as a card silently would hide
 *  how much of a lopsided row is token-mediated, which is the population most likely to be one. */
test("a token producer is counted on the side but reported apart from the cards", () => {
  const row = only(buildSupplyDemand(
    [{ ...reason("Treasure", "payoff"), producerIsToken: true }],
    deck(["payoff", payoff, false]),
  ));
  expect(row.supply.tokens).toBe(1);
  expect(row.supply.cards).toBe(1);
  expect(row.supply.labels).toEqual({ token: 1 });
});

/** The inversion instrument needs to know WHICH cards are on a side, not just how many: the
 *  question "do this shape's feeders outrank its payoff" cannot be asked of a count. */
test("a side carries the names of the cards on it", () => {
  const row = only(buildSupplyDemand(
    [reason("engine", "payoff"), reason("body", "payoff")],
    deck(["engine", engine, false], ["body", body, false], ["payoff", payoff, false]),
  ));
  expect([...row.supply.names].sort()).toEqual(["body", "engine"]);
  expect(row.demand.names).toEqual(["payoff"]);
});
