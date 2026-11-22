import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "@edh-seer/tagger/derive-worker";
import type { CardTags } from "@edh-seer/tagger";
import { impactEdgeWeight, impactWeightOf, loadImpactWeights } from "@edh-seer/engine";
import { loadHierarchy } from "./index.js";
import { pairReasonsAcrossFaces } from "./edges.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/damage-fill-1734.json" with { type: "json" };

/** #1734 (owner ruling 2026-11-22, option 2 marked conditional): a non-combat damage emit that hits creatures records the death / graveyard fill, flagged CONDITIONAL because damage kills only what its amount allows.
 *  Cards and stored `cardClauses` dumped from Mongo 2026-11-22 (DERIVE 579). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const dc = (name: string): DeckCard => {
  const f = F[name]!;
  const tags: CardTags = deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false }).tags;
  return { card: { _id: name, ...f.source } as unknown as DeckCard["card"], tags };
};
const fillEmits = (name: string) => dc(name).tags!.abilities.flatMap((a) => a.emits ?? []).filter((e) => (e.verb === "dies" || e.verb === "enters-graveyard") && e.subject.control !== "you");
const reasons = (p: string, c: string) => pairReasonsAcrossFaces(dc(p), dc(c), H, {});
const W = loadImpactWeights();

describe("damage at creatures records a conditional fill (#1734)", () => {
  test.each([["Goblin Bombardment", "opp"], ["Siege-Gang Commander", "opp"], ["Skred", "opp"], ["Devastating Dreams", "any"], ["Rupture", "any"], ["Flame Sweep", "any"], ["Pestilence", "any"]])("%s derives a conditional dies fill of control %s", (name, control) => {
    const fills = fillEmits(name).filter((e) => e.subject.type === "creature" && e.verb === "dies");
    expect(fills.map((e) => e.subject.control)).toEqual([control]);
    expect(fills.every((e) => e.conditional === true)).toBe(true);
  });
  test.each(["Goblin Bombardment", "Siege-Gang Commander", "Devastating Dreams", "Rupture"])("%s -> Massacre Wurm (a creature an opponent controls dies): reason is conditional and weighed below a sure one", (p) => {
    const rs = reasons(p, "Massacre Wurm").filter((r) => r.tag === "dies:creature");
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.every((r) => r.conditional === true && r.strength === 0.5)).toBe(true);
    expect(impactEdgeWeight(rs, W)).toBe(0.5);
  });
  test.each(["Goblin Bombardment", "Siege-Gang Commander", "Devastating Dreams", "Rupture"])("%s -> Wight of Precinct Six (creature cards in opponents' graveyards): conditional", (p) => {
    const rs = reasons(p, "Wight of Precinct Six").filter((r) => r.tag.startsWith("scales:"));
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.every((r) => r.conditional === true && impactWeightOf(r, W) === 0.5)).toBe(true);
  });
  test("Murder (destroy) is unchanged and unconditional", () => {
    expect(fillEmits("Murder").every((e) => e.conditional === undefined)).toBe(true);
    for (const c of ["Massacre Wurm", "Wight of Precinct Six"]) {
      const rs = reasons("Murder", c);
      expect(rs.length).toBeGreaterThan(0);
      expect(rs.every((r) => r.conditional === undefined && r.strength === undefined)).toBe(true);
      expect(impactEdgeWeight(rs, W)).toBe(1);
    }
  });
  test.each(["Lava Spike", "Lightning Bolt"])("%s: damage to players (and planeswalkers) only, or an any-target bolt aimed by the player, records a fill only for the creature half", (name) => {
    // Lava Spike names a player and a planeswalker: no creature, no fill.
    if (name === "Lava Spike") { expect(fillEmits(name)).toEqual([]); expect(reasons(name, "Massacre Wurm")).toEqual([]); }
    else expect(fillEmits(name).map((e) => e.subject.control)).toEqual(["opp"]);
  });
  test.each(["Abyssal Hunter", "Bring Low"])("%s: damage at the creature a target points back to is an opponent's, like the targeted hit it follows", (name) => {
    expect(fillEmits(name).filter((e) => e.conditional === true).map((e) => e.subject.control)).not.toContain("any");
    expect(fillEmits(name).some((e) => e.conditional === true)).toBe(true);
  });
  test.each(["Aether Flash", "Ashmouth Hound"])("%s: damage at a creature no scope points to (the one that entered, the one blocking) says nothing of whose it is and records no fill", (name) => {
    expect(fillEmits(name)).toEqual([]);
  });
  test("combat damage (implied, never an authored damage action) gives no fill", () => {
    expect(fillEmits("Grizzly Bears")).toEqual([]);
  });
  test("a damage that exiles what dies of it (Anger of the Gods) makes no death", () => {
    expect(fillEmits("Anger of the Gods")).toEqual([]);
  });
  test("a targeted fill is an opponent's creature: it never feeds 'a creature you control dies'", () => {
    expect(reasons("Goblin Bombardment", "Zulaport Cutthroat").filter((r) => r.conditional === true)).toEqual([]);
    expect(reasons("Siege-Gang Commander", "Zulaport Cutthroat").filter((r) => r.conditional === true)).toEqual([]);
  });
  test("a sweep hits your own creatures too (as a destroy sweep does): it feeds 'a creature you control dies', conditionally", () => {
    const rs = reasons("Devastating Dreams", "Zulaport Cutthroat").filter((r) => r.conditional === true);
    expect(rs.length).toBeGreaterThan(0);
  });
});
