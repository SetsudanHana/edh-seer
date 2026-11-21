import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./chooser-controller-1713.fixtures.json" with { type: "json" };

/** #1713: A CHOOSER NAMED IN A PUT'S OBJECT IS NOT THE CONTROLLER OF WHAT IT CHOOSES.
 *  Realms Uncharted stores "the two cards chosen by an opponent" going to the graveyard, and `parseControl` read the word "opponent" there as the cards' controller: an `enters-graveyard {control: opp}` that fed every
 *  "a card is put into an opponent's graveyard" consumer (Bloodchief Ascension, Dauthi Voidwalker, Compost), when the cards go into YOUR graveyard. Emergent Ultimatum ("one of those cards chosen by an opponent" shuffled
 *  into your library) and Ecological Appreciation (same, into your library) read `shuffle: opp` the same way.
 *  Fixtures: card documents and stored `cardClauses` dumped from Mongo 2026-11-21 (derived at DERIVE 566; the stored clauses do not move with a derive bump); derived as derive-corpus derives them (`deriveAsCorpus`). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const emitTypes = (name: string, verb: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb).map((e) => e.subject.type);
const emitControls = (name: string, verb: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb).map((e) => e.subject.control);

describe("the opponent who CHOOSES the cards does not control them", () => {
  test("Realms Uncharted: the chosen cards go into YOUR graveyard", () => expect(emitControls("Realms Uncharted", "enters-graveyard")).toEqual(["you"]));
  test("Realms Uncharted: the chosen cards are the searched LAND cards, not an untyped wildcard (it paired with every 'when this is put into a graveyard' self-trigger)", () => {
    expect(rowOf("Realms Uncharted").tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "enters-graveyard").map((e) => e.subject.type)).toEqual(["land"]);
  });
  test("Fork in the Road / Jarad's Orders: 'the other' into the graveyard is a card of the searched class", () => {
    expect(emitTypes("Fork in the Road", "enters-graveyard")).toEqual(["land"]);
    expect(rowOf("Fork in the Road").tags.abilities.flatMap((a) => a.emits ?? []).filter((x) => x.verb === "enters-graveyard").map((e) => e.subject.basic)).toEqual([true]);
    expect(emitTypes("Jarad's Orders", "enters-graveyard")).toEqual(["creature"]);
    // ...and it is one card of that class, not "another card, every one of a class", which fed no recursion consumer of its own class.
    for (const n of ["Fork in the Road", "Jarad's Orders"]) for (const e of rowOf(n).tags.abilities.flatMap((a) => a.emits ?? []).filter((x) => x.verb === "enters-graveyard")) expect([e.subject.other, e.subject.scope]).toEqual([undefined, undefined]);
  });
  test("Elemental Teachings (the twin, handled by #1694) stays yours", () => expect(emitControls("Elemental Teachings", "enters-graveyard")).toEqual(["you"]));
  test("Emergent Ultimatum: 'one of those cards chosen by an opponent' is shuffled into YOUR library", () => expect(emitControls("Emergent Ultimatum", "shuffle")).not.toContain("opp"));
  test("Ecological Appreciation: the chosen cards are shuffled into YOUR library", () => expect(emitControls("Ecological Appreciation", "shuffle")).not.toContain("opp"));
});

describe("controls: a chooser control reads you; a real opponent subject (no chooser phrase) stays opp", () => {
  test("Rejoin the Fight: the card chosen by each opponent is in YOUR graveyard and returns under YOUR control", () => {
    expect(emitControls("Rejoin the Fight", "enters")).toEqual(["you"]);
  });
  test("Life's Finale: 'target opponent's library' search put stays opp", () => expect(emitControls("Life's Finale", "enters-graveyard")).toContain("opp"));
  test("Imperial Edict: 'target opponent sacrifices a creature' is their creature dying", () => expect(emitControls("Imperial Edict", "dies")).toContain("opp"));
});
