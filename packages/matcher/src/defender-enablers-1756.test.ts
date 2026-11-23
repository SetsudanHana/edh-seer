import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, analyzeDeckStructured, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/defender-1756.json" with { type: "json" };

/** #1756: a card that lets your defenders attack (CR 702.3b: a creature with defender can't attack) sits on ANOTHER card, so `analyzeDeckStructured` clears `defender` on the defenders it covers, for that deck only.
 *  Production fixtures: card documents and stored clauses dumped from Mongo 2026-11-23 (DERIVE 592). */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const attacksEdge = (deck: string[], wall: string): boolean => {
  const report = analyzeDeckStructured(deck.map(dc), undefined, H);
  return report.edges.some((e) => [e.a, e.b].includes(wall) && [e.a, e.b].includes("Hellrider") && e.reasons.some((r) => r.tag.startsWith("attacks:")));
};

describe("an enabler in the deck lets its defenders supply attacks", () => {
  test("Arcades + a wall + an attack payoff: the pair is present", () => {
    expect(attacksEdge(["Arcades, the Strategist", "Wall of Limbs", "Hellrider"], "Wall of Limbs")).toBe(true);
  });
  test("the same deck without Arcades: the pair is absent", () => {
    expect(attacksEdge(["Grizzly Bears", "Wall of Limbs", "Hellrider"], "Wall of Limbs")).toBe(false);
  });
  test.each(["High Alert", "Felothar the Steadfast", "Ghalta the Immovable", "Assault Formation", "Warmonger's Chariot", "Wakestone Gargoyle", "Walking Bulwark"])("%s covers every defender", (e) => {
    expect(attacksEdge([e, "Perimeter Captain", "Hellrider"], "Perimeter Captain")).toBe(true);
    expect(attacksEdge([e, "Wall of Limbs", "Hellrider"], "Wall of Limbs")).toBe(true);
  });
  test.each(["Rolling Stones", "Animate Wall"])("%s covers a Wall and not another defender", (e) => {
    expect(attacksEdge([e, "Wall of Limbs", "Hellrider"], "Wall of Limbs")).toBe(true);
    expect(attacksEdge([e, "Perimeter Captain", "Hellrider"], "Perimeter Captain")).toBe(false);
  });
  test("an enabler sharing a deck with no defender changes nothing; Ghalta, Stampede Tyrant is no enabler", () => {
    expect(attacksEdge(["Ghalta, Stampede Tyrant", "Wall of Limbs", "Hellrider"], "Wall of Limbs")).toBe(false);
  });
  test("a card that only gets ITSELF round defender (Mirror Wall) enables nobody", () => {
    expect(attacksEdge(["Mirror Wall", "Wall of Limbs", "Hellrider"], "Wall of Limbs")).toBe(false);
  });
});

describe("the pass never mutates the caller's tags, and pair mode is unchanged", () => {
  test("the DeckCard tags handed in keep their defender flag", () => {
    const deck = ["Arcades, the Strategist", "Wall of Limbs", "Hellrider"].map(dc);
    const wall = deck[1]!.tags!;
    const before = JSON.stringify(wall.characteristics);
    analyzeDeckStructured(deck, undefined, H);
    expect(JSON.stringify(wall.characteristics)).toBe(before);
    expect(wall.characteristics.defender).toBe(true);
  });
  test("pairReasons (no deck) still bars the wall even next to Arcades", () => {
    expect(pairReasons(dc("Wall of Limbs"), dc("Hellrider"), H).map((r) => r.tag).filter((t) => t.startsWith("attacks:"))).toEqual([]);
  });
});
