import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/end-step-exile-pairs.json" with { type: "json" };

/** #1502 round 3: Gruesome Encore returns a card from an OPPONENT's graveyard under your control. A card in an opponent's graveyard is owned by that opponent (CR 400.3), so it is never a card of YOUR deck: it can fire
 *  no deck-mate's own "when this creature enters" (Mulldrifter), but it does fire a class trigger ("whenever a creature you control enters", Impact Tremors) and feed a processor of cards an opponent owns
 *  (Ulamog's Nullifier, Ruin Processor). Source documents and stored `cardClauses.canonical` dumped from Mongo 2026-11-04. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const encore = dc("Gruesome Encore");
const tags = (consumer: string) => pairReasons(encore, dc(consumer), H).map((r) => r.tag);

test("Gruesome Encore forms no self reason with Mulldrifter's own enter trigger", () => {
  expect(tags("Mulldrifter").filter((t) => t.startsWith("enters:"))).toEqual([]);
});
test("Gruesome Encore still feeds a 'whenever a creature you control enters' card", () => {
  expect(tags("Impact Tremors").filter((t) => t.startsWith("enters:"))).not.toEqual([]);
});
test.each(["Ulamog's Nullifier", "Ruin Processor"])("Gruesome Encore's exile of an opponent-owned creature feeds %s", (name) => {
  expect(tags(name).some((t) => t.startsWith("exile-processing:"))).toBe(true);
});
