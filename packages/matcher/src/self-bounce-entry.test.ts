import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/self-bounce-1811.json" with { type: "json" };

/** #1811, owner ruling 2026-11-26: when a card's own enters-the-battlefield trigger returns it to its owner's hand, it enters again and again, so its own implied entry reads as REPEATABLE, not oneshot ("When Acererak enters, if you haven't completed Tomb of Annihilation, return Acererak
 *  to its owner's hand and venture into the dungeon."). Stored documents and clauses of the production corpus, 2026-11-26. Census of the corpus: four cards have an own ETB that returns the card itself (Acererak the Archlich, Glitch Interpreter, Wild Wurm, Greenbelt Rampager), each conditional. */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => ({ card: F[name]!.source as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical, undefined, undefined)) as CardTags });
const entry = (p: string, c = "Impact Tremors") => pairReasons(dc(p), dc(c), loadHierarchy(), {}).filter((r) => r.producer === p && r.consumer === c && r.impliedProducer === true);

test("the cards print the self-bounce", () => {
  expect(String(F["Acererak the Archlich"]!.source.oracleText)).toContain("When Acererak enters, if you haven't completed Tomb of Annihilation, return Acererak to its owner's hand and venture into the dungeon.");
  expect(String(F["Wild Wurm"]!.source.oracleText)).toContain("If you lose the flip, return this creature to its owner's hand.");
  expect(String(F["Mulldrifter"]!.source.oracleText)).not.toMatch(/owner's hand/);
});

test.each(["Acererak the Archlich", "Wild Wurm"])("%s: its own entry is repeatable for an ETB payoff (Impact Tremors)", (p) => {
  const r = entry(p);
  expect(r.length, `${p} has an implied entry reason`).toBeGreaterThan(0);
  for (const x of r) expect(x.repeatability, `${p}: ${x.text}`).not.toBe("oneshot");
});

test.each(["Mulldrifter", "Whitemane Lion", "Cactuar", "Timid Drake", "Glitch Interpreter", "Greenbelt Rampager"])("%s bounces nothing of its own at its ETB, or its bounce defeats its own condition (owner 2026-11-27: Glitch Interpreter manifests the face-down permanent, Greenbelt Rampager gets the energy): its own entry stays oneshot", (p) => {
  const r = entry(p);
  expect(r.length, `${p} has an implied entry reason`).toBeGreaterThan(0);
  for (const x of r) expect(x.repeatability, `${p}: ${x.text}`).toBe("oneshot");
});

test("Acererak x Impact Tremors: the entry reads 'triggered' (every time it enters), as a card that recasts itself does", () => {
  expect(entry("Acererak the Archlich").map((r) => [r.tag, r.repeatability])).toEqual([["enters:creature", "triggered"]]);
});
