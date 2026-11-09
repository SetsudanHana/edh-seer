import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./producer-misreads.fixtures.json" with { type: "json" };

/** #1579 part 4 -- TWO PRODUCER MISREADS. Card documents and stored `cardClauses` dumped from Mongo (DERIVE 482 tree, 2026-11-09): `producer-misreads.fixtures.json`; oracle text quoted from them.
 *  (1) AN OPPONENT'S EDICT WITH TWO SACRIFICES IN ONE CLAUSE WAS STORED `any`: Vona's Hunger "Each opponent sacrifices a creature of their choice. If you have the city's blessing, instead each opponent sacrifices half the creatures they control of their choice";
 *  Gideon's Triumph "Target opponent sacrifices a creature of their choice that attacked or blocked this turn. ... that player sacrifices two of those creatures of their choice instead"; Invoke Despair "Target opponent sacrifices a creature of their choice. ... Then repeat this process for an enchantment and a planeswalker."
 *  (2) A POWER-ONLY DEBUFF KILLS NOTHING: Stronghold Overseer "creatures without shadow get -1/-0", Fyndhorn Pollen "All creatures get -1/-0", Mouth of the Storm "creatures your opponents control get -3/-0", Tidal Influence "all blue creatures get -2/-0", Meishin "-X/-0". */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const emits = (name: string, verb: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb && e.implied !== true);

describe("an opponent's edict is the opponent's, whatever number of sacrifices the clause holds", () => {
  test.each(["Vona's Hunger", "Gideon's Triumph", "Invoke Despair"])("%s: every sacrifice and its death is control opp", (name) => {
    for (const verb of ["sacrifice", "dies"]) {
      const e = emits(name, verb);
      expect(e.length).toBeGreaterThan(0);
      for (const x of e) expect(x.subject.control).toBe("opp");
    }
  });
  test("CONTROL: 'target player' (Diabolic Edict, Structural Collapse) names no opponent and stays any", () => {
    for (const name of ["Diabolic Edict", "Structural Collapse"]) for (const x of emits(name, "sacrifice")) expect(x.subject.control).toBe("any");
  });
  test("CONTROL: Tariff ('Each player sacrifices the creature they control with the greatest mana value unless they pay') keeps one sacrifice per side", () => {
    expect(emits("Tariff", "sacrifice").map((x) => x.subject.control)).toEqual(["you", "opp"]);
  });
  test("CONTROL: Liliana, Dreadhorde General's 'Each player sacrifices two creatures' stays any", () => {
    expect(emits("Liliana, Dreadhorde General", "sacrifice").some((x) => x.subject.control === "any")).toBe(true);
  });
});

describe("a power-only debuff is no death", () => {
  test.each(["Stronghold Overseer", "Fyndhorn Pollen", "Mouth of the Storm", "Tidal Influence", "Meishin, the Mind Cage"])("%s: no dies emit", (name) => {
    expect(emits(name, "dies")).toEqual([]);
  });
  test.each(["Plague Mare", "Massacre Wurm", "Toxic Deluge", "Final Revels"])("CONTROL: %s (a toughness debuff) keeps its dies", (name) => {
    expect(emits(name, "dies").length).toBeGreaterThan(0);
  });
});
