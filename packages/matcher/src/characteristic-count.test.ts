import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/characteristic-count-1680.json" with { type: "json" };

/** #1680, owner ruling 2026-11-22: a count of DISTINCT characteristics ("creature types among creatures you control", "colors among permanents you control") is not raised by the class growing, so the class is no `scales` partner;
 *  a creature-type count keeps the changelings (every creature type); a graveyard count (Tarmogoyf) keeps its class. Stored documents and canonical clauses of the production corpus, 2026-11-23. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] | null }>;
// A card the grammar reads completely has no stored clauses (Saavik): read it from its printed text, as derive-corpus does.
const dc = (name: string): DeckCard => {
  const src = F[name]!.source;
  const g = F[name]!.canonical === null ? grammarClauseRecords(src as never) : undefined;
  return {
    card: src as unknown as DeckCard["card"],
    tags: deriveCardTags(deriveInputOf(src as never, name, name, g ? g.records : F[name]!.canonical!, undefined, g?.readings)) as CardTags,
  };
};
const grant = (p: string, c: string) => pairReasons(dc(p), dc(c), loadHierarchy()).filter((r) => r.tag === "static:type-grant" && r.producer === p && r.consumer === c);
const scales = (p: string, c: string) => pairReasons(dc(p), dc(c), loadHierarchy()).filter((r) => r.tag.startsWith("scales:") && r.producer === p && r.consumer === c);

test("Valiant Changeling counts creature types: a changeling is a partner, a vanilla creature is not", () => {
  expect(scales("Changeling Outcast", "Valiant Changeling").length).toBeGreaterThan(0);
  expect(scales("Grizzly Bears", "Valiant Changeling")).toEqual([]);
  expect(scales("Llanowar Elves", "Valiant Changeling")).toEqual([]);
});

test("colors among permanents you control (Faeburrow Elder, Bloom Tender) join nothing as a class, and the mana line is still read", () => {
  for (const c of ["Faeburrow Elder", "Bloom Tender"]) {
    for (const p of ["Grizzly Bears", "Llanowar Elves", "Changeling Outcast"]) expect(scales(p, c), `${p} -> ${c}`).toEqual([]);
    expect(dc(c).tags!.abilities.every((a) => a.effect.scalingSubject === undefined), c).toBe(true);
  }
  for (const c of ["Faeburrow Elder", "Bloom Tender"]) expect(dc(c).tags!.manaLines?.length, c).toBeGreaterThan(0);
});

test("a graveyard count keeps its class: Tarmogoyf still counts every graveyard", () => {
  expect(dc("Tarmogoyf").tags!.abilities.some((a) => a.effect.scalingSubject?.zone === "graveyard")).toBe(true);
});

// A type grant that adds MEMBERS to the counted class still raises a distinct-characteristics count (owner ruling 2026-11-22 refuses the class `scales` partner, not this).
test("a grant that makes more things the counted class feeds the colour count: Maskwood Nexus x Earthen Ally (Allies), Encroaching Mycosynth and The Flesh Is Weak x Karn (artifacts)", () => {
  expect(grant("Maskwood Nexus", "Earthen Ally")).not.toEqual([]);
  expect(grant("Encroaching Mycosynth", "Karn, Gilded Guardian")).not.toEqual([]);
  expect(grant("The Flesh Is Weak", "Karn, Gilded Guardian")).not.toEqual([]);
});

test("the chosen-type and every-type grants that reached Earthen Ally before still do: Arcane Adaptation, Conspiracy, Leyline of Transformation, Xenograft, Omo", () => {
  for (const p of ["Arcane Adaptation", "Conspiracy", "Leyline of Transformation", "Xenograft", "Omo, Queen of Vesuva"]) expect(grant(p, "Earthen Ally"), p).not.toEqual([]);
});

test("a granted CARD TYPE feeds a card-type count only when the granter is not that type already: The Flesh Is Weak (an Enchantment granting Artifact) x Loot, not Enchanted Evening, Encroaching Mycosynth or Secret Arcade", () => {
  expect(grant("The Flesh Is Weak", "Loot, the Key to Everything")).not.toEqual([]);
  for (const p of ["Enchanted Evening", "Encroaching Mycosynth", "Secret Arcade // Dusty Parlor"]) expect(grant(p, "Loot, the Key to Everything"), p).toEqual([]);
});

test("guards: Toph (artifacts become lands, no basic land type) x a domain card, a vanilla creature x Valiant Changeling, and a changeling x Saavik (non-Borg) stay unpaired", () => {
  for (const c of ["Artillery Blast", "Draco"]) expect(grant("Toph, the First Metalbender", c), c).toEqual([]);
  expect(scales("Grizzly Bears", "Valiant Changeling")).toEqual([]);
  expect(scales("Changeling Outcast", "Saavik, Stoic Student")).toEqual([]);
  expect(dc("Saavik, Stoic Student").tags!.abilities.every((a) => a.effect.scalingSubject === undefined)).toBe(true);
});
