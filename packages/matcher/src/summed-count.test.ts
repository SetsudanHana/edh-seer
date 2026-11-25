import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import { boardCountsOf, demandKeysOf, fillDemandsOf, abilityRowsOf } from "./partners-core.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/summed-count-811.json" with { type: "json" };

/** #811: A SUMMED COUNT ("the number of A plus the number of B") counts every class it names, and every reader of a count reads them all. Stored documents and canonical clauses of the production corpus, 2026-11-24. */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] | null };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => {
  const src = F[name]!.source;
  const g = F[name]!.canonical === null ? grammarClauseRecords(src as never) : undefined;
  return {
    card: src as unknown as DeckCard["card"],
    tags: deriveCardTags(deriveInputOf(src as never, name, name, g ? g.records : F[name]!.canonical!, undefined, g?.readings)) as CardTags,
  };
};
/** The emblem node the deck builder makes: no card, no permanent, no types (CR 114.3, 114.5); the derived row of the Ajani emblem. */
const emblem = (): DeckCard => {
  const tags = F["__emblem"] as unknown as CardTags;
  return { card: { name: "Ajani Emblem", typeLine: "Emblem — Ajani", oracleText: F["__emblemText"] as unknown as string, keywords: [], colors: [], manaValue: 0 }, tags, isToken: true };
};
const reasons = (p: DeckCard, c: DeckCard) => pairReasons(p, c, loadHierarchy()).filter((r) => r.producer === p.card.name && r.consumer === c.card.name);
const scales = (p: string, c: string) => reasons(dc(p), dc(c)).filter((r) => r.tag.startsWith("scales:")).map((r) => r.tag);

test("Armix counts artifacts you control AND artifact cards in your graveyard: a board artifact and a graveyard filler both feed it", () => {
  expect(scales("Sol Ring", "Armix, Filigree Thrasher")).toContain("scales:artifact");
  expect(scales("Troyan, Gutsy Explorer", "Armix, Filigree Thrasher")).toContain("scales:artifact");
});

test("Abomination of Llanowar counts Elves you control plus Elf cards in your graveyard: an Elf on the board feeds it", () => {
  expect(scales("Llanowar Elves", "Abomination of Llanowar")).toContain("scales:elf");
});

test("Armix's page demands both its classes: the artifact board count and the artifact graveyard fill", () => {
  expect(boardCountsOf(dc("Armix, Filigree Thrasher")).map((b) => b.key)).toContain("counts|-|artifact|-");
  expect(fillDemandsOf(dc("Armix, Filigree Thrasher")).map((b) => b.key)).toContain("fills|artifact|-|-");
  expect(demandKeysOf(dc("Armix, Filigree Thrasher"))).toEqual(expect.arrayContaining(["counts|-|artifact|-", "fills|artifact|-|-"]));
});

test("a card-page row names every subtype a summed count counts: Dauntless Dourbark's Forests and Treefolk, Abomination's Elves once", () => {
  const counts = (n: string) => abilityRowsOf(dc(n)).filter((r) => r.counts !== undefined).map((r) => r.counts);
  expect(counts("Dauntless Dourbark")).toEqual(["forest, treefolk"]);
  expect(counts("Abomination of Llanowar")).toEqual(["elf"]);
});

test("a type grant reaches the SECOND class of a summed count: Xenograft x Dauntless Dourbark (Forests plus Treefolk), The Flesh Is Weak x War Report (creatures plus artifacts)", () => {
  const grant = (p: string, c: string) => reasons(dc(p), dc(c)).filter((r) => r.tag === "static:type-grant");
  expect(grant("Xenograft", "Dauntless Dourbark")).not.toEqual([]);
  expect(grant("The Flesh Is Weak", "War Report")).not.toEqual([]);
});

// CR 114.3: an emblem has no types; CR 114.5: it is neither a card nor a permanent. No planeswalker count counts it.
test("an emblem is no planeswalker: the Ajani emblem feeds no planeswalker count (Ajani, Strength of the Pride; Oath of Jace)", () => {
  for (const c of ["Ajani, Strength of the Pride", "Oath of Jace"]) expect(reasons(emblem(), dc(c)).filter((r) => r.tag.startsWith("scales:")), c).toEqual([]);
});

// An emblem is no creature, but one that CREATES creature tokens puts creatures on your board: it still feeds a creature-token count.
// "Ajani, Adversary of Tyrants Emblem": "At the beginning of your end step, create three 1/1 white Cat creature tokens with lifelink." (the corpus token row, 7c0edef3).
test("an emblem that creates creature tokens still feeds a creature-token count (Redoubled Stormsinger), though its own types meet nothing", () => {
  expect(F["__emblemText"]).toContain("create three 1/1 white Cat creature tokens");
  expect(reasons(emblem(), dc("Redoubled Stormsinger")).filter((r) => r.tag.startsWith("scales:creature")).length).toBeGreaterThan(0);
});
