import { describe, expect, test } from "vitest";
import { detectBuildCategories } from "./build.js";
import { realCard } from "./removal-test-support.js";
import { answerClassesOf } from "./rules.js";

/** OWNER 2026-11-13 (b) and (c), #1266. Small land destruction ("two target lands", "X target lands") is normal removal and NOT stax; mass land destruction and three or more lands stay stax. Each half of a card is its
 *  own effect: a card that also sweeps the board with damage keeps the removal it has for the land. */
describe("small land destruction is removal, never stax", () => {
  const SMALL = ["Rain of Salt", "Plow Under", "Scorched Earth", "Avalanche", "Numot, the Devastator", "Petradon", "Orcish Settlers", "Rumbling Crescendo", "Stone Rain"];
  const role = (n: string, cat: "targetedRemoval" | "stax" | "boardWipe" | "burn"): boolean => detectBuildCategories([realCard(n)]).get(cat)?.has(n) === true;

  test.each(SMALL)("%s is targeted removal and answers lands, and is not stax", (n) => {
    expect(role(n, "targetedRemoval")).toBe(true);
    expect(role(n, "stax")).toBe(false);
    expect(answerClassesOf(realCard(n)).has("land")).toBe(true);
  });

  test.each(["Armageddon", "Burning of Xinye", "Ajani Vengeant"])("%s stays stax", (n) => {
    expect(role(n, "stax")).toBe(true);
  });

  test("Volcanic Eruption keeps its wipe and burn roles and gains removal and the land answer", () => {
    for (const cat of ["boardWipe", "burn", "targetedRemoval"] as const) expect(role("Volcanic Eruption", cat), cat).toBe(true);
    expect(role("Volcanic Eruption", "stax")).toBe(false);
    expect(answerClassesOf(realCard("Volcanic Eruption")).has("land")).toBe(true);
  });

  test("Lavaball Trap keeps its wipe role and gains targeted removal; it keeps the land answer", () => {
    for (const cat of ["boardWipe", "targetedRemoval"] as const) expect(role("Lavaball Trap", cat), cat).toBe(true);
    expect(role("Lavaball Trap", "stax")).toBe(false);
    expect(answerClassesOf(realCard("Lavaball Trap")).has("land")).toBe(true);
  });

  test("the same shape, a single target land plus a sweep, is the same: Devastate, Rancid Earth, Star of Extinction", () => {
    for (const n of ["Devastate", "Rancid Earth", "Star of Extinction"]) {
      expect(role(n, "boardWipe"), `${n} boardWipe`).toBe(true);
      expect(role(n, "targetedRemoval"), `${n} targetedRemoval`).toBe(true);
    }
  });

  test("a wipe with a non-land targeted half is not widened by this: Blight Grenade stays a wipe without targeted removal (not ruled)", () => {
    expect(role("Blight Grenade", "boardWipe")).toBe(true);
    expect(role("Blight Grenade", "targetedRemoval")).toBe(false);
  });
});
