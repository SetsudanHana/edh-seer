import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord, SubjectFilter } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons, subjectMatches } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./all-types-producer.fixtures.json" with { type: "json" };

/** #1577: A CLASS PRODUCER CAN BE AN OBJECT OF ALL THE TYPES A CONSUMER DEMANDS TOGETHER. "Destroy target artifact" can destroy an artifact creature, so it feeds "whenever an artifact creature dies" (Dross Scorpion). The consumer's `allTypes` is a conjunction;
 *  a producer EVENT (a class with a scope, not a printed type line) satisfies it when its types meet the conjunction and its notType excludes none of it. Oracle text and clause records are the corpus's own (Mongo, 2026-11-09). */
type Fx = { source: Record<string, unknown>; canonical: ClauseRecord[] };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const card = (name: string): DeckCard => ({ card: F[name]!.source as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags });
const tags = (p: string, c: string) => pairReasons(card(p), card(c), H).filter((r) => r.producer === p && r.consumer === c).map((r) => r.tag);
const s = (o: Partial<SubjectFilter>): SubjectFilter => ({ control: "any", token: null, ...o });
const AC = s({ type: ["artifact", "creature"], allTypes: ["artifact", "creature"] });

describe("subjectMatches: allTypes against a class producer", () => {
  test("a target artifact, a target creature and a mass of either can be an artifact creature", () => {
    expect(subjectMatches(s({ type: "artifact", scope: "target" }), AC, H)).toBe(true);
    expect(subjectMatches(s({ type: "creature", scope: "target" }), AC, H)).toBe(true);
    expect(subjectMatches(s({ type: "creature", scope: "all" }), AC, H)).toBe(true);
  });
  test("a notType that excludes one of the demanded types does not", () => {
    expect(subjectMatches(s({ type: "artifact", scope: "target", notType: ["creature"] }), AC, H)).toBe(false);
    expect(subjectMatches(s({ type: "creature", scope: "target", notType: ["artifact"] }), AC, H)).toBe(false);
  });
  test("CONTROL: a printed type line (no scope) stays strict, a type outside the conjunction and a producer conjunction too", () => {
    expect(subjectMatches(s({ type: "artifact" }), AC, H)).toBe(false);
    expect(subjectMatches(s({ type: "enchantment", scope: "target" }), AC, H)).toBe(false);
    expect(subjectMatches(s({ type: "enchantment", subtype: "aura", scope: "all" }), s({ type: ["enchantment", "creature"], allTypes: ["enchantment", "creature"] }), H)).toBe(false);
    expect(subjectMatches(s({ type: ["artifact", "enchantment"], allTypes: ["artifact", "enchantment"], scope: "target" }), AC, H)).toBe(false);
  });
});

describe("pairs", () => {
  test.each([["Mutant Chain Reaction", "Dross Scorpion"], ["Airship Crash", "Szarekh, the Silent King"], ["Murder", "Dross Scorpion"], ["Shatter", "Dross Scorpion"]])("%s -> %s pairs", (p, c) => {
    expect(tags(p, c).length).toBeGreaterThan(0);
  });
  test("CONTROL: Nissa's Defeat (Forest, green enchantment or planeswalker) -> Dross Scorpion: none", () => {
    expect(tags("Nissa's Defeat", "Dross Scorpion")).toEqual([]);
  });
});
