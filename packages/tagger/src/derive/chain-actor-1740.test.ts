import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./chain-actor-1740.fixtures.json" with { type: "json" };

/** #1740: A LATER VERB JOINED TO THE SAME PLAYER'S EARLIER ONE, for create and sacrifice (the #1735 `JOINED` fragment fed discard and draw only).
 *  Necromentia's "That player shuffles, THEN CREATES a 2/2 ... token" is the opponent's token, read `any` (which met your own token payoffs); Magus of the Balance's "Each player chooses ... then sacrifices the rest" read `you`
 *  off "lands you control", and Archfiend of Depravity's "that player chooses ..., then sacrifices the rest" read `any`. The create join is NARROW: the player is the subject of the earlier verb at the start of its clause, and the
 *  clause prints one create (Smuggler's Share, Giant Space Amoeba and Tempt with Bunnies were falsely joined by the plain JOINED).
 *  Fixtures: card documents and stored `cardClauses` dumped from Mongo 2026-11-22 (DERIVE 574); Giant Space Amoeba has no stored clauses (grammar reading). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const controls = (name: string, verb: string): string[] =>
  rowOf(name).tags.abilities.flatMap((a) => (a.emits ?? []).filter((e) => e.verb === verb).map((e) => `${e.subject.control}${e.subject.edictAll ? "+edictAll" : ""}`));

describe("create: a later create joined to the player's earlier verb is that player's", () => {
  test("Necromentia: 'That player shuffles, then creates' is the opponent's token", () => expect(controls("Necromentia", "create-token")).toEqual(["opp"]));
  test("Smuggler's Share: 'each opponent who drew ..., then create' is not joined", () => expect(controls("Smuggler's Share", "create-token")).toEqual(["you"]));
  test("Giant Space Amoeba: 'target creature defending player controls gets ..., then create' is not joined", () => expect(controls("Giant Space Amoeba", "create-token")).toEqual(["you"]));
  test("Tempt with Bunnies: the three creates keep their own actors", () => expect(controls("Tempt with Bunnies", "create-token")).toEqual(["you", "opp", "you"]));
});

describe("sacrifice: 'chooses ..., then sacrifices the rest' names the chooser", () => {
  test("Magus of the Balance: each player, not you", () => {
    const c = controls("Magus of the Balance", "sacrifice");
    expect(c.slice(1)).toEqual(["any+edictAll", "any+edictAll"]);
  });
  test("Archfiend of Depravity: that player (the opponent whose end step it is)", () => expect(controls("Archfiend of Depravity", "sacrifice")).toEqual(["opp"]));
  test.each(["Balancing Act", "Tragic Arrogance", "Cataclysm", "Cataclysmic Gearhulk", "Single Combat", "Razia's Purification", "Mythos of Snapdax", "Slaughter the Strong"])("%s: each player keeps `any` and is an edict on everyone", (name) => {
    const c = controls(name, "sacrifice");
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) expect(x).toBe("any+edictAll");
  });
});

describe("controls: the sacrifice and create readings that were right stay", () => {
  test("Vile Mutilator and Din of the Fireherd: the opponent's edicts stay opp", () => {
    expect(controls("Vile Mutilator", "sacrifice").slice(1).every((x) => x.startsWith("opp"))).toBe(true);
    expect(controls("Din of the Fireherd", "sacrifice").every((x) => x === "opp")).toBe(true);
  });
});
