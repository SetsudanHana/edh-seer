import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import type { SubjectFilter } from "../schema.js";
import fixtures from "./untyped-reads.fixtures.json" with { type: "json" };

/** #1577 part 5: THREE UNTYPED READS. "For each Spirit, return it to its owner's hand" (Cut the Tethers) stored an untyped leave; "Remove three +1/+1 counters from Slogurk: Return it to its owner's hand" (Slogurk, the Overslime) stored the card's
 *  own bounce as an untyped one; "Destroy target artifact, enchantment, or creature with flying" (Mutant Chain Reaction, Shower of Arrows ...) stored one merged filter with flying on the enchantment too.
 *  Card documents and stored `cardClauses` dumped from Mongo 2026-11-09 (DERIVE 481). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const emits = (name: string, verb: string): SubjectFilter[] => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb).map((e) => e.subject);

describe("'for each <class>, return it' is that class", () => {
  test("Cut the Tethers: each Spirit", () => {
    const s = emits("Cut the Tethers", "leaves");
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) { expect(x.subtype).toBe("spirit"); expect(x.scope).toBe("each"); }
  });
});

describe("'return it' after a counter removed from the card itself is the card", () => {
  test("Slogurk: the bounce is a self leave", () => {
    const s = emits("Slogurk, the Overslime", "leaves");
    expect(s.filter((x) => x.fromZone === "battlefield").every((x) => x.self === true)).toBe(true);
    expect(s.filter((x) => x.fromZone === "battlefield").length).toBeGreaterThan(0);
  });
});

describe("a list whose last noun carries 'with <keyword>' keeps the keyword on that noun alone", () => {
  test.each(["Mutant Chain Reaction", "Shower of Arrows", "Vivien Reid", "Shoot Down", "Storm, Shaker of Skies", "Broken Wings"])("%s", (name) => {
    const s = emits(name, "dies").concat(emits(name, "exiled")).filter((x) => x.scope === "target");
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) {
      expect(x.type).toBeUndefined();
      expect(x.keyword).toBeUndefined();
      expect(x.anyOf).toEqual([{ type: "artifact" }, { type: "enchantment" }, { type: "creature", keyword: ["flying"] }]);
    }
  });
  test("Atraxa's Fall: four alternatives, battle among them", () => {
    const x = emits("Atraxa's Fall", "dies")[0]!;
    expect(x.anyOf).toEqual([{ type: "artifact" }, { type: "battle" }, { type: "enchantment" }, { type: "creature", keyword: ["flying"] }]);
  });
  test("CONTROL: a two-noun 'instant or sorcery card with a cycling ability' and a token's 'artifact creature tokens with flying' stay as they were", () => {
    const sp = emits("Spellpyre Phoenix", "leaves").concat(emits("Spellpyre Phoenix", "enters")).filter((x) => x.scope === "target");
    for (const x of sp) expect(x.anyOf).toBeUndefined();
    expect(emits("Whirler Rogue", "enters").every((x) => x.anyOf === undefined)).toBe(true);
  });
});
