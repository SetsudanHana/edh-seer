import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { deriveRow } from "../derive-worker.js";

// #1616: The Prima Vista's stored clause 2 is one misfiled `cast` action whose object is the card's real effect ("The Prima Vista becomes an artifact creature until end of turn").
// The grammar reads that sentence completely as an `animate`; the per-card switch takes it once the difference's group is labelled "grammar right" (grammar-only-triage.json).
// Oracle texts and stored clauses (the `cardClauses` answer a model row derives from) read from the corpus 2026-11-23.
const FX = JSON.parse(readFileSync(new URL("./prima-vista-1616.fixtures.json", import.meta.url), "utf8")) as Record<string, { oracleId: string; typeLine: string; oracleText: string; keywords: string[]; canonical: never }>;
const rowOf = (name: string) => {
  const f = FX[name]!;
  return deriveRow({ doc: { oracleId: f.oracleId, name, canonical: f.canonical } as never, source: { name, typeLine: f.typeLine, oracleText: f.oracleText, keywords: f.keywords } as never, isToken: false });
};

describe("The Prima Vista's misfiled cast (#1616)", () => {
  test("derives its animate from the printed text, under its cast trigger, and leaves nothing unclaimed", () => {
    const { tags, fromGrammar } = rowOf("The Prima Vista");
    expect(fromGrammar).toBe(true);
    const animate = tags.abilities.filter((a) => a.effect?.kind === "animate");
    expect(animate).toHaveLength(1);
    expect(animate[0]!.clause).toBe(2);
    expect(animate[0]!.effect.subject).toMatchObject({ self: true, type: ["creature", "artifact"] });
    expect(tags.unclaimed ?? []).toEqual([]);
  });
  test("a card that really casts is untouched: Archmage Emeritus keeps its stored cast trigger reading", () => {
    const { tags } = rowOf("Archmage Emeritus");
    expect(tags.abilities.some((a) => a.effect?.kind === "animate")).toBe(false);
    expect(tags.abilities.some((a) => (a.emits ?? []).some((e) => e.verb === "draw"))).toBe(true);
  });
  test("Mishra's Factory still animates itself", () => {
    const { tags } = rowOf("Mishra's Factory");
    expect(tags.abilities.filter((a) => a.effect?.kind === "animate").length).toBeGreaterThan(0);
    expect(tags.unclaimed ?? []).toEqual([]);
  });
});
