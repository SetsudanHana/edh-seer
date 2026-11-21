import { describe, expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { analyzeDeckStructured, loadHierarchy } from "./index.js";
import { synthesizeTokenTags } from "./token-tags.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/opp-token-consumers.json" with { type: "json" };

/** #1696: A TOKEN AN OPPONENT IS GIVEN (Balefang the Unslayable's Baneslayer Angel, Hunted Horror's Centaurs) IS NOT A TOKEN YOU CREATE, so a replacement printed "under your control" / "If you would create"
 *  (Chatterfang, Mondrak, Adrix and Nev, Jinnie Fay, Divine Visitation) does not hear it; Primal Vigor, which names no creator, does. Cards dumped from Mongo 2026-11-21 (DERIVE 561). */
const F = fixtures as unknown as { cards: Record<string, { source: Record<string, unknown>; tags: CardTags }> };
const dc = (name: string): DeckCard => ({ card: F.cards[name]!.source as unknown as DeckCard["card"], tags: F.cards[name]!.tags });
const tokenTags = (ref: { name: string }): CardTags | null =>
  ref.name === "Centaur" ? synthesizeTokenTags({ _id: "test-Centaur", name: "Centaur", typeLine: "Token Creature — Centaur", power: "3", toughness: "3", colors: ["G"], keywords: [], printingIds: [] }) : null;
const H = loadHierarchy();
const hears = (maker: string, payoff: string): boolean => {
  // A third card keeps the deck large enough for the copy-count simulation.
  const r = analyzeDeckStructured([dc(maker), dc(payoff), dc("Doubling Season")], undefined, H, undefined, undefined, undefined, tokenTags as never, undefined, [], [], { skipSimulation: true });
  return r.cards.find((c) => c.name === maker)!.topPartners.some((p) => p.name === payoff);
};
const PAYOFFS = ["Chatterfang, Squirrel General", "Mondrak, Glory Dominus", "Jinnie Fay, Jetmir's Second", "Divine Visitation", "Adrix and Nev, Twincasters"];

describe("a token an opponent is given is not heard by a replacement of your tokens", () => {
  test.each(["Balefang the Unslayable", "Hunted Horror"].flatMap((m) => PAYOFFS.map((p) => [m, p] as const)))("%s -> %s: no pair", (m, p) => {
    expect(hears(m, p)).toBe(false);
  });
  test.each(["Balefang the Unslayable", "Hunted Horror"])("CONTROL: %s -> Primal Vigor (any token) still pairs", (m) => {
    expect(hears(m, "Primal Vigor")).toBe(true);
  });
});
