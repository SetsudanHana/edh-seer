import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./discard-actor-1722.fixtures.json" with { type: "json" };

/** #1722 (a): AN OPPONENT'S DISCARD IS NOT YOURS. Cabal Conditioning ("Any number of target players each discard ...") read the "you control" of its COUNT ("the greatest mana value among permanents you control") as the discarders, and Rottenmouth Viper ("each
 *  opponent loses 4 life unless that player sacrifices a nonland permanent ... or discards a card") had its second verb's player unread: both stored `discard {control: you}`, so neither fed a counter of cards in an OPPONENT's graveyard (Wight of Precinct Six, Detritivore).
 *  Fixtures: card documents and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 569); derived as derive-corpus derives them (`deriveAsCorpus`). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const discards = (name: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "discard").map((e) => e.subject.control);

describe("the discarding player is the one the text names", () => {
  test("Cabal Conditioning: 'any number of target players each discard' is any player's discard, not yours", () => expect(discards("Cabal Conditioning")).toEqual(["any"]));
  test("Rottenmouth Viper: 'unless that player sacrifices ... or discards a card' is the opponent's discard", () => expect(discards("Rottenmouth Viper")).toEqual(["opp", "opp"]));
});

describe("controls: a discard nobody else makes stays yours; an opponent's stays theirs", () => {
  test("Faithless Looting: 'then discard two cards' is yours", () => expect(discards("Faithless Looting")).toEqual(["you"]));
  test("Wandering Champion: 'you may discard a card' is yours", () => expect(discards("Wandering Champion")).toEqual(["you"]));
  test("Mind Rot: 'target player discards two cards' is anyone's (unchanged)", () => expect(discards("Mind Rot")).toEqual(["any"]));
  test("Dusk Mangler: the cost discard is yours, 'each opponent ... discards a card' is theirs (unchanged)", () => expect(discards("Dusk Mangler")).toEqual(["you", "opp"]));
  test("Zabaz: 'destroy target artifact you control' stays your own death", () => {
    expect(rowOf("Zabaz, the Glimmerwasp").tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "dies").map((e) => e.subject.control)).toEqual(["you"]);
  });
});
