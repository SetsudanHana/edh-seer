import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/esix-copy.json" with { type: "json" };

/** #1549 review: Esix, Fractal Bloom's "create a token that is a copy of a chosen creature other than Esix" lost its static token-generation subject when "other than" stopped being scope `all`
 *  (a static keeps its effect subject only for a class scope, `namesItsTargets`), and `copySubject` refuses a subjectless token-generation, so the whole copy family went (about 3,440 true pairs).
 *  Source documents and stored `cardClauses.canonical` dumped from Mongo 2026-11-06. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const esix = dc("Esix, Fractal Bloom");
const reasons = (consumer: string) => pairReasons(esix, dc(consumer), H);

test("Esix's copy re-triggers an enters card: Mulldrifter and Champion of Wits", () => {
  for (const c of ["Mulldrifter", "Champion of Wits"]) expect(reasons(c).filter((r) => r.tag.startsWith("static:token-generation") || r.tag.startsWith("enters:")), c).not.toEqual([]);
});
test("Esix's copy of Kokusho trips the legend rule: a dies reason", () => {
  expect(reasons("Kokusho, the Evening Star").length).toBeGreaterThan(0);
});
test("Esix keeps what it copies as `copyOf` and no class of its own: no go-wide board, no lord", () => {
  const gen = esix.tags!.abilities.find((x) => x.effect.kind === "token-generation")!;
  expect(gen.effect.subject?.type).toBeUndefined();
  expect(gen.effect.subject?.scope).toBeUndefined();
  expect(gen.effect.subject?.copyOf?.type).toBe("creature");
});
