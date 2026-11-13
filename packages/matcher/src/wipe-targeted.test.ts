import { describe, expect, test } from "vitest";
import { detectBuildCategories } from "./build.js";
import { realCard } from "./removal-test-support.js";
import type { DeckCard } from "./types.js";

/** OWNER 2026-11-13, "each half of a card is its own effect", for NON-land kills (#1266, Rules 52). A board wipe that also has a targeted kill is ALSO targeted removal: `removal.targeted` reads the
 *  ability, not the card. A targeted spell that only SEEDS the wipe (Radiance: "damage to target creature and each other creature that shares a color with it") is one effect, not two, and is not. */
const role = (dc: DeckCard, cat: "targetedRemoval" | "boardWipe"): boolean => detectBuildCategories([dc]).get(cat)?.has(dc.card.name) === true;
const overloaded = (n: string): DeckCard => { const c = realCard(n); return { ...c, card: { ...c.card, keywords: ["Overload"] } }; };

describe("a wipe with a targeted kill beside it is both", () => {
  test.each(["Blight Grenade", "Golgari Charm", "Primaris Eliminator", "Smash to Dust", "Fiery Confluence", "Sagittars' Volley", "Fear, Fire, Foes!"])("%s", (n) => {
    expect(role(realCard(n), "boardWipe"), `${n} boardWipe`).toBe(true);
    expect(role(realCard(n), "targetedRemoval"), `${n} targetedRemoval`).toBe(true);
  });

  test.each(["Cyclonic Rift", "Damn"])("%s: the single-target mode is removal, the overload is the wipe", (n) => {
    expect(role(overloaded(n), "boardWipe"), `${n} boardWipe`).toBe(true);
    expect(role(overloaded(n), "targetedRemoval"), `${n} targetedRemoval`).toBe(true);
  });
});

describe("a target that only seeds the wipe is not a second effect", () => {
  test.each(["Cleansing Beam", "Brightflame", "Homing Lightning", "Alpha Brawl", "Flame Wave"])("%s stays a wipe with no targeted removal", (n) => {
    expect(role(realCard(n), "boardWipe"), `${n} boardWipe`).toBe(true);
    expect(role(realCard(n), "targetedRemoval"), `${n} targetedRemoval`).toBe(false);
  });
  test("different amounts are two effects: Chandra's Fury (4 to the target, 1 to each creature) keeps its targeted half", () => {
    expect(role(realCard("Chandra's Fury"), "targetedRemoval")).toBe(true);
  });
});

describe("a mass kill aimed at one player's board is still no targeted kill", () => {
  test("Mogg Infestation: wipe, no targeted removal", () => {
    expect(role(realCard("Mogg Infestation"), "boardWipe")).toBe(true);
    expect(role(realCard("Mogg Infestation"), "targetedRemoval")).toBe(false);
  });
});
