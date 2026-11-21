import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./who-does-you-create-1715.fixtures.json" with { type: "json" };

/** #1715: "FOR EACH OPPONENT WHO DOES, YOU CREATE ..." IS YOUR OWN TOKEN.
 *  Tempting Contract stores ONE `create` ("each opponent may create a Treasure token. For each opponent who does, you create a Treasure token"), and derive read it for the opponent only: your Treasure was missing, so since #1696 (your-token replacement
 *  triggers hear `you` only) its pairs with Xorn, Academy Manufactor, Chatterfang ... were lost. Tempt with Reflections / Vengeance print the second create in the imperative ("For each opponent who does, create ...") and derived it `any`.
 *  Fixtures: card documents and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 566); derived as derive-corpus derives them (`deriveAsCorpus`). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const emits = (name: string, verb: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb);
const controls = (name: string, verb: string) => emits(name, verb).map((e) => e.subject.control);

describe("the maker of the second create is you", () => {
  test("Tempting Contract: the opponent's Treasure AND yours", () => {
    expect(controls("Tempting Contract", "create-token").sort()).toEqual(["opp", "you"]);
    expect(emits("Tempting Contract", "create-token").map((e) => e.subject.subtype).sort()).toEqual(["treasure", "treasure"]);
    expect(controls("Tempting Contract", "enters").sort()).toEqual(["opp", "you"]);
  });
  test("Tempt with Reflections / Vengeance: 'For each opponent who does, create ...' is yours (the opponent's own stays opp); the leading imperative create still reads any -- KNOWN GAP #1728", () => {
    for (const n of ["Tempt with Reflections", "Tempt with Vengeance"]) expect(controls(n, "create-token"), n).toEqual(["any", "opp", "you"]);
  });
  test("Tempt with Bunnies: the opponent's create opp, the trailing one you; the leading imperative create still reads any -- KNOWN GAP #1728", () => expect(controls("Tempt with Bunnies", "create-token")).toEqual(["any", "opp", "you"]));
});

describe("controls: only the opponent acts, or only you act, stays as it was", () => {
  test("Clackbridge Troll: 'target opponent creates three 0/1 Goat' is the opponent's alone", () => expect(controls("Clackbridge Troll", "create-token")).toEqual(["opp"]));
  test("Balefang the Unslayable: 'target opponent creates a tapped Baneslayer Angel token' is the opponent's alone", () => expect(controls("Balefang the Unslayable", "create-token")).toEqual(["opp"]));
  test("Gisa's Favorite Shovel / Charismatic Conqueror / Divert Disaster: 'If they do, you create' stays yours alone", () => {
    for (const n of ["Gisa's Favorite Shovel", "Charismatic Conqueror", "Divert Disaster"]) expect(controls(n, "create-token"), n).toEqual(["you"]);
  });
});
