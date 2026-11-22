import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import { faceDeckCards } from "./faces.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/defender-1753.json" with { type: "json" };

/** #1753: a creature with defender can't attack (CR 702.3b), so its implied `attacks` is not supplied. It still blocks and still deals combat damage (as a blocker). A card whose own text gets round
 *  defender ("can attack as though it didn't have defender", "loses defender") keeps it. Production fixtures: card documents and stored clauses dumped from Mongo 2026-11-22 (DERIVE 578). */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const hellrider = dc("Hellrider"); // "Whenever a creature you control attacks, ..."
const noble = dc("Noble Stand"); // "Whenever a creature you control blocks, you gain 2 life."
const moria = dc("Moria Marauder"); // "Whenever a Goblin or Orc you control deals combat damage to a player, ..."
const arcades = dc("Arcades, the Strategist"); // "Whenever a creature you control with defender enters, draw a card."
const captain = dc("Perimeter Captain"); // "Whenever a creature you control with defender blocks, ..."
const heard = (producer: string, consumer: DeckCard, verb: string) => pairReasons(dc(producer), consumer, H).map((r) => r.tag).filter((t) => t.startsWith(verb + ":"));

describe("a creature with defender supplies no attacks", () => {
  test.each(["Wall of Limbs", "Glacial Wall"])("%s: no attacks:creature to an attack payoff", (p) => {
    expect(heard(p, hellrider, "attacks")).toEqual([]);
  });
  test("a non-defender creature is unchanged", () => {
    expect(heard("Grizzly Bears", hellrider, "attacks")).not.toEqual([]);
    expect(heard("Grizzly Bears", noble, "blocks")).not.toEqual([]);
  });
});

describe("a defender still blocks and deals combat damage", () => {
  test.each(["Wall of Limbs", "Glacial Wall"])("%s blocks for a block payoff", (p) => {
    expect(heard(p, noble, "blocks")).not.toEqual([]);
  });
  test("Perimeter Captain ('with defender' blocks) is still fed by a defender", () => {
    expect(heard("Glacial Wall", captain, "blocks")).not.toEqual([]);
  });
  test("combat-damage is still supplied (CEILING: a consumer's 'to a player' is not carried)", () => {
    expect(heard("Wall of Limbs", moria, "combat-damage")).toEqual(heard("Grizzly Bears", moria, "combat-damage"));
  });
});

describe("a card whose own text gets round defender keeps attacking", () => {
  test.each(["Mirror Wall", "Wishful Merfolk", "Guardians of Oboro"])("%s still supplies attacks", (p) => {
    expect(heard(p, hellrider, "attacks")).not.toEqual([]);
  });
});

describe("a deck-level enabler's own pair survives", () => {
  test("Arcades is still fed by a creature with defender entering", () => {
    expect(pairReasons(dc("Wall of Limbs"), arcades, H).map((r) => r.tag)).toContain("enters:creature");
    expect(pairReasons(dc("Glacial Wall"), arcades, H).length).toBeGreaterThan(0);
  });
});

describe("defender is read per face", () => {
  test("a transform card with defender on its front face only: the front is barred, the back carries no flag", () => {
    const chars = dc("Ulvenwald Captive").tags!.characteristics;
    expect(chars.faces).toEqual([{ types: ["creature"], subtypes: ["werewolf", "horror"], defender: true }]);
    expect(heard("Ulvenwald Captive", hellrider, "attacks")).toEqual([]);
    const [front, back] = faceDeckCards(dc("Ulvenwald Captive"));
    expect(back!.tags!.characteristics.faces).toEqual([]);
    expect(heard("Ulvenwald Captive", noble, "blocks")).not.toEqual([]);
    expect(front!.tags!.characteristics.faces).toEqual(chars.faces);
  });
  test("defender on the BACK face only (The Fall of Lord Konda) does not bar the front", () => {
    expect(dc("The Fall of Lord Konda").tags!.characteristics.faces).toEqual([{ types: ["enchantment"], subtypes: ["saga"] }]);
  });
});
