import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import { demandKeysOf, fodderDemandsOf } from "./partners-core.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/disjunct-sacrifice-1805.json" with { type: "json" };

/** #1805, owner ruling 2026-11-24: "it is not an answer it is part of the cost of the spell". "Sacrifice an artifact or creature" (Deadly Dispute, Defiant Salvager) and "sacrifice an artifact or land" (Destructive Digger) is a COST of your own,
 *  so it asks for fodder of each type it names, as a lone "sacrifice an artifact" outlet does: an artifact is fodder (a lone artifact outlet reaches it), and a creature or a land is fodder only as it is for a lone "sacrifice a creature" / "sacrifice a land" outlet
 *  (a token, a card that comes back) -- nothing wider. An edict ("target player sacrifices an artifact or creature of their choice", Hit // Run) is an answer, not your cost. Stored documents and clauses of the production corpus, 2026-11-25. */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] | null };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => {
  const src = F[name]!.source;
  const g = F[name]!.canonical === null ? grammarClauseRecords(src as never) : undefined;
  return { card: src as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(src as never, name, name, g ? g.records : F[name]!.canonical!, undefined, g?.readings)) as CardTags };
};
const treasure = (): DeckCard => ({ card: { name: "Treasure", typeLine: "Token Artifact — Treasure", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: F["__treasure"] as unknown as CardTags, isToken: true });
const fodder = (p: DeckCard, c: DeckCard) => pairReasons(p, c, loadHierarchy()).filter((r) => r.tag.startsWith("fodder:") && r.consumer === c.card.name && r.producer === p.card.name);
const keys = (n: string) => fodderDemandsOf(dc(n)).map((k) => k.key).sort();

test("the cost names its types, and each is a fodder demand", () => {
  expect(F["Deadly Dispute"]!.source.oracleText).toContain("As an additional cost to cast this spell, sacrifice an artifact or creature.");
  expect(keys("Deadly Dispute")).toEqual(["fodder|-|artifact|-", "fodder|-|creature|-"]);
  expect(F["Defiant Salvager"]!.source.oracleText).toContain("Sacrifice an artifact or creature: Put a +1/+1 counter on this creature.");
  expect(keys("Defiant Salvager")).toEqual(["fodder|-|artifact|-", "fodder|-|creature|-"]);
  expect(F["Destructive Digger"]!.source.oracleText).toContain("Sacrifice an artifact or land: Draw a card.");
  expect(keys("Destructive Digger")).toEqual(["fodder|-|artifact|-", "fodder|-|land|-"]);
  expect(demandKeysOf(dc("Deadly Dispute"))).toEqual(expect.arrayContaining(["fodder|-|artifact|-", "fodder|-|creature|-"]));
});

test("an edict is an answer, not your cost: Hit // Run (target player sacrifices an artifact or creature) asks for no fodder", () => {
  expect(F["Hit // Run"]!.source.oracleText).toContain("Target player sacrifices an artifact or creature of their choice.");
  expect(keys("Hit // Run")).toEqual([]);
  expect(fodder(dc("Sol Ring"), dc("Hit // Run"))).toEqual([]);
});

test.each(["Deadly Dispute", "Defiant Salvager", "Destructive Digger"])("an artifact is fodder for %s, and so is a Treasure; a plain creature is not (it is the whole deck)", (c) => {
  expect(fodder(dc("Sol Ring"), dc(c)).map((r) => r.tag), "Sol Ring").toEqual(["fodder:artifact"]);
  expect(fodder(dc("Ornithopter"), dc(c)).map((r) => r.tag), "Ornithopter").toEqual(["fodder:artifact"]);
  expect(fodder(treasure(), dc(c)).map((r) => r.tag), "Treasure").toEqual(["fodder:artifact"]);
  expect(fodder(dc("Llanowar Elves"), dc(c)), "Llanowar Elves").toEqual([]);
});

// OWNER VERDICT 2026-10-16 (Aether Spellbomb), unchanged: a card spent through its own "sacrifice this" for the same payoff is no fodder for an outlet that pays the same. Mind Stone draws a card; Destructive Digger draws a card.
test("the Spellbomb verdict still holds: Mind Stone (sacrifice this: draw a card) is no fodder for Destructive Digger, and is for Deadly Dispute", () => {
  expect(fodder(dc("Mind Stone"), dc("Destructive Digger"))).toEqual([]);
  expect(fodder(dc("Mind Stone"), dc("Deadly Dispute")).map((r) => r.tag)).toEqual(["fodder:artifact"]);
});

test("an artifact creature is fodder as an artifact (Ornithopter), never as the wider creature", () => {
  expect(fodder(dc("Ornithopter"), dc("Deadly Dispute")).map((r) => r.tag)).toEqual(["fodder:artifact"]);
});

test("the sentence says the card is fodder, with no 'counts it and' and no empty tail", () => {
  const [r] = fodder(dc("Sol Ring"), dc("Deadly Dispute"));
  expect(r!.text).toBe("Sol Ring is fodder for Deadly Dispute");
});

test("a lone-type outlet is unchanged: Lobelia (sacrifice an artifact) still takes Sol Ring, and Viscera Seer (sacrifice a creature) still refuses Llanowar Elves", () => {
  expect(fodder(dc("Sol Ring"), dc("Lobelia, Defender of Bag End")).map((r) => r.tag)).toEqual(["fodder:artifact"]);
  expect(fodder(dc("Llanowar Elves"), dc("Viscera Seer"))).toEqual([]);
});
