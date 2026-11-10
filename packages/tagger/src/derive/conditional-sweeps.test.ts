import { describe, expect, test } from "vitest";
import { deriveRow } from "../derive-worker.js";
import fixtures from "./conditional-sweeps.fixtures.json" with { type: "json" };

/** #1586 -- A CONDITIONAL SWEEP CARRIES ITS CONDITION. "Destroy each nonland permanent with mana value X or less" (Karn's Sylex), "... equal to the number of charge counters" (Ratchet Bomb), "each other nonland permanent with the same mana value as that
 *  permanent" (Mists of Lorien), "that entered this turn" (Renet), "with the same name as" (Deputy of Detention), "that's not historic" (Desynchronization) and Urza's "Artifacts and planeswalkers you control gain indestructible. Destroy all nonland permanents"
 *  were stored as the bare type list of every nonland permanent, which the matcher reads as a sweep of every subtype (subject.ts `sweepsEveryPermanent`). The grammar reads each condition (`stats`, `shares`, `history`, `nameRelation`, `except`); the emit now keeps it.
 *  Card documents and stored `cardClauses.canonical` dumped from Mongo (DERIVE 485 tree, 2026-11-10): `conditional-sweeps.fixtures.json`. */
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: unknown[]; segmentHash?: string }>)[name]!;
  return deriveRow({ doc: { oracleId: name, name, canonical: f.canonical, segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
/** The sweep's own removal emits: a mass of permanents (not the card sacrificing itself). */
const sweeps = (name: string, verb: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? [])
  .filter((e) => e.verb === verb && e.subject.self !== true && (e.subject.scope === "all" || e.subject.scope === "each") && [e.subject.type].flat().includes("creature") && [e.subject.type].flat().includes("artifact"));

describe("a mana value or counter sweep carries a variable mana value stat", () => {
  test.each(["Karn's Sylex", "Ratchet Bomb", "The Moment", "Gaze of Granite", "Engineered Explosives", "Blast Zone", "The Filigree Sylex"])("%s", (name) => {
    const s = sweeps(name, "dies");
    expect(s.length).toBe(1);
    expect(s[0]!.subject.stats).toEqual([expect.objectContaining({ metric: "mana-value", variable: true })]);
  });
});

describe("the other conditions are carried on their own field", () => {
  test("Mists of Lorien: the same mana value as the target (shares)", () => {
    const s = sweeps("Mists of Lórien", "leaves");
    expect(s.map((e) => e.subject.shares)).toEqual([{ what: "mana-value", with: "ref" }]);
  });
  test("Renet: entered this turn (history)", () => {
    expect(sweeps("Renet, Temporal Apprentice", "leaves").map((e) => e.subject.history)).toEqual([["entered"]]);
  });
  test("Deputy of Detention: the same name as the target (nameRelation)", () => {
    expect(sweeps("Deputy of Detention", "exiled").map((e) => e.subject.nameRelation)).toEqual(["same"]);
  });
  test("Desynchronization: not historic (except)", () => {
    expect(sweeps("Desynchronization", "leaves").map((e) => e.subject.except)).toEqual([[{ historic: true }]]);
  });
  test("Urza, Planeswalker: the artifacts and planeswalkers you control gained indestructible (except)", () => {
    expect(sweeps("Urza, Planeswalker", "dies").map((e) => e.subject.except)).toEqual([[{ type: ["artifact", "planeswalker"], control: "you" }]]);
  });
});

describe("CONTROL: an unconditional sweep carries none of them", () => {
  test.each([["Apocalypse", "exiled"], ["Wrath of God", "dies"], ["Scourglass", "dies"], ["Exterminatus", "dies"], ["Fated Clash", "dies"]])("%s", (name, verb) => {
    const e = rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((x) => x.verb === verb && x.subject.self !== true && x.subject.scope === "all");
    expect(e.length).toBeGreaterThan(0);
    for (const x of e) for (const k of ["stats", "shares", "history", "nameRelation", "except"] as const) expect(x.subject[k], `${name} ${k}`).toBeUndefined();
  });
});
