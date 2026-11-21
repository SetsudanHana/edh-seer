import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./self-milled-recursion.fixtures.json" with { type: "json" };

/** #1732 -- A RECURSION THAT RETURNS ONLY WHAT THE CARD ITSELF MILLED IS SUPPLIED BY NOTHING ELSE. "Mill three cards, then you may put an artifact or land card from among the milled cards into your hand" (T'Chaka),
 *  "Target player mills five cards, then puts each Goblin card milled this way into their hand" (Grub's Command): the set is the card's own mill, so Entomb, a sacrifice outlet or a land that dies pairs with it only as a
 *  claim about a card the recursion never reads. Oracle text and clause records are the corpus's own (Mongo, 2026-11-21). */
type Fx = { source: Record<string, unknown>; canonical: ClauseRecord[] };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const card = (name: string): DeckCard => ({ card: F[name]!.source as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags });
const recursion = (p: string, c: string): string[] => [...new Set(pairReasons(card(p), card(c), H).filter((r) => r.consumer === c && r.producer === p && r.tag.startsWith("graveyard-recursion")).map((r) => r.tag))];

describe("a recursion from the card's own milled set takes no outside fill", () => {
  test.each(["T'Chaka, Venerable King", "Grub's Command"])("Entomb / Ruthless Knave / Savai Triome x %s: no graveyard-recursion", (c) => {
    for (const p of ["Entomb", "Ruthless Knave", "Savai Triome"]) expect(recursion(p, c), `${p} x ${c}`).toEqual([]);
  });
  test("Patient Naturalist (land card from among the milled cards) is refused Entomb too", () => {
    expect(recursion("Entomb", "Patient Naturalist")).toEqual([]);
  });
});

describe("CONTROLS: a recursion with an outside source still pairs", () => {
  test("Entomb x Animate Dead (ordinary return from a graveyard)", () => {
    expect(recursion("Entomb", "Animate Dead").length).toBeGreaterThan(0);
  });
  test("Entomb x Wrenn and Realmbreaker: -2 reads the milled cards, -7 plays permanents from the graveyard, so the card has two sources", () => {
    expect(recursion("Entomb", "Wrenn and Realmbreaker").length).toBeGreaterThan(0);
  });
  test("Szarekh (already self-supplied by 'from among the cards milled this way') stays refused", () => {
    expect(recursion("Entomb", "Szarekh, the Silent King")).toEqual([]);
  });
});
