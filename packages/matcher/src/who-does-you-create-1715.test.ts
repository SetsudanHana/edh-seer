import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "@edh-seer/tagger/derive-worker";
import type { CardTags } from "@edh-seer/tagger";
import { analyzeDeckStructured, loadHierarchy } from "./index.js";
import { synthesizeTokenTags } from "./token-tags.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/who-does-you-create-1715.json" with { type: "json" };

/** #1715: TEMPTING CONTRACT MAKES YOU A TREASURE TOO ("For each opponent who does, you create a Treasure token"). Its derived row held only the opponent's, so once a replacement of YOUR tokens stopped hearing an opponent's (#1696) it lost
 *  its pairs with Xorn, Academy Manufactor, Chatterfang ... Cards and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 566), derived here as derive-corpus derives them. */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const dc = (name: string): DeckCard => {
  const f = F[name]!;
  const tags: CardTags = deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false }).tags;
  return { card: { _id: name, ...f.source } as unknown as DeckCard["card"], tags };
};
const VANILLA: Record<string, [string, string, string[]]> = { Treasure: ["Token Artifact — Treasure", "", []], Goat: ["Token Creature — Goat", "0", ["W"]] };
const tokenTags = (ref: { name: string }): CardTags | null => {
  const v = VANILLA[ref.name];
  return v ? synthesizeTokenTags({ _id: `test-${ref.name}`, name: ref.name, typeLine: v[0], ...(v[1] ? { power: v[1], toughness: "1" } : {}), colors: v[2], keywords: [], printingIds: [] }) : null;
};
const hears = (maker: string, payoff: string): boolean => {
  const r = analyzeDeckStructured([dc(maker), dc(payoff), dc("Academy Manufactor")], undefined, H, undefined, undefined, undefined, tokenTags as never, undefined, [], [], { skipSimulation: true });
  return r.cards.find((c) => c.name === maker)!.topPartners.some((p) => p.name === payoff);
};

describe("Tempting Contract's own Treasure is heard by a replacement of YOUR tokens", () => {
  test.each(["Xorn", "Academy Manufactor"])("Tempting Contract -> %s pairs", (p) => expect(hears("Tempting Contract", p)).toBe(true));
  // CONTROL: a card that gives ONLY an opponent tokens ("target opponent creates three 0/1 Goat creature tokens") is still not heard by a replacement of yours.
  test("CONTROL: Clackbridge Troll (the opponent's Goats alone) -> Chatterfang: no pair", () => expect(hears("Clackbridge Troll", "Chatterfang, Squirrel General")).toBe(false));
});
