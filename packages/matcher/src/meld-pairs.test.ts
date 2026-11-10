import { describe, expect, test } from "vitest";
import { docToCard } from "@edh-seer/data";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./meld-pairs.fixtures.json" with { type: "json" };

/** #1582: A MELDED PERMANENT ENTERS AS ITS RESULT CARD, AND NOTHING ELSE. Derived rows dumped from Mongo (DERIVE 485, 2026-11-10): Graf Rats ("meld them into Chittering Host"), Mishra, Claimed by Gix, and the cards they were measured against.
 *  The result is a class creature entering under your control, so a "whenever a creature enters under your control" payoff hears it (Soul Warden, Bloodline Pretender); it is no other card's own enters trigger (Birthing Hulk, an Eldrazi Horror),
 *  and the melder is cast and attacks as the card it is: it is no cast or attack producer for a chosen-type payoff because of the creature it melds into (Vanquisher's Banner). */
const F = fixtures as unknown as Record<string, { doc: unknown; tags: unknown }>;
const H = loadHierarchy();
const dc = (name: string): DeckCard => ({ card: docToCard(F[name]!.doc as never), tags: F[name]!.tags as never });
const reasons = (p: string, c: string) => pairReasons(dc(p), dc(c), H).filter((r) => r.producer === p && r.consumer === c).map((r) => r.tag);

describe("a meld's enters is the result card", () => {
  test("Graf Rats feeds a creature-enters payoff", () => {
    expect(reasons("Graf Rats", "Soul Warden")).toContain("enters:creature");
  });
  test("Mishra feeds a creature-enters payoff", () => {
    expect(reasons("Mishra, Claimed by Gix", "Bloodline Pretender")).toContain("enters:creature");
  });
  test("Graf Rats does not feed Birthing Hulk's own enters trigger", () => {
    expect(reasons("Graf Rats", "Birthing Hulk")).toEqual([]);
  });
  test("Graf Rats is no cast producer for Vanquisher's Banner", () => {
    expect(reasons("Graf Rats", "Vanquisher's Banner").filter((t) => t.startsWith("cast:") || t.startsWith("attacks:"))).toEqual([]);
  });
  test("Mishra's exile of the pair is no leave of Thragtusk, but a creature-exile payoff still hears it", () => {
    expect(reasons("Mishra, Claimed by Gix", "Thragtusk")).toEqual([]);
    expect(reasons("Graf Rats", "Syr Vondam, Sunstar Exemplar").length).toBeGreaterThan(0);
  });
  /** The pair is the melder AND its partner: "another artifact you control leaves the battlefield" (Sludge Strider) hears the Phyrexian Dragon Engine, and an Aura on the melder falls off (Rancor). A `self` mark on the pair refused both. */
  test("Mishra's pair still reaches a class leave payoff and an Aura on it", () => {
    expect(reasons("Mishra, Claimed by Gix", "Sludge Strider")).toContain("leaves:artifact");
    expect(reasons("Mishra, Claimed by Gix", "Rancor")).toContain("dies:aura");
  });
  /** The result's PRINTED stats and colours stand on the entering permanent, so a stat or colour condition on a payoff reads the card that really enters: a missing stat was 0 and a missing colour passed "nonblack" and "colorless". */
  test.each([
    ["Vanille, Cheerful l'Cie", "Mentor of the Meek"], ["Hanweir Battlements", "Ezuri, Claw of Progress"], ["Mishra, Claimed by Gix", "Welcoming Vampire"], ["Graf Rats", "Symmetry Matrix"],
    ["Mishra, Claimed by Gix", "Grave Peril"], ["Mishra, Claimed by Gix", "Eldrazi Mimic"], ["Vanille, Cheerful l'Cie", "Flayer Drone"], ["Titania, Voice of Gaea", "Glaring Fleshraker"],
  ])("%s does not feed %s (a power, toughness, mana value or colour condition the result fails)", (melder, payoff) => {
    expect(reasons(melder, payoff).filter((t) => t.startsWith("enters:"))).toEqual([]);
  });
  /** The pair is named for its partner, not the card itself, so an Aura on the melder (Rancor) goes to the graveyard for all seven. */
  test.each(["Graf Rats", "Hanweir Battlements", "Mishra, Claimed by Gix", "Titania, Voice of Gaea", "Vanille, Cheerful l'Cie", "Urza, Lord Protector", "Gisela, the Broken Blade"])("%s x Rancor: an Aura on the melding pair dies", (melder) => {
    expect(reasons(melder, "Rancor")).toContain("dies:aura");
  });
});
