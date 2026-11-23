import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/characteristic-count-1680.json" with { type: "json" };

/** #1680, owner ruling 2026-11-22: a count of DISTINCT characteristics ("creature types among creatures you control", "colors among permanents you control") is not raised by the class growing, so the class is no `scales` partner;
 *  a creature-type count keeps the changelings (every creature type); a graveyard count (Tarmogoyf) keeps its class. Stored documents and canonical clauses of the production corpus, 2026-11-23. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
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
