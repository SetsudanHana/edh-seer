import { expect, test } from "vitest";
import { normalizeVariant } from "./spellbook.js";

test("normalizes a variant into a combo", () => {
  const n = normalizeVariant({
    id: "v1",
    uses: [
      { card: { name: "Thassa's Oracle" } },
      { card: { name: "Demonic Consultation" } },
    ],
    produces: [{ feature: { name: "Win the game" } }],
  });
  expect(n!.id).toBe("v1");
  expect(n!.combo.cards).toEqual(["Thassa's Oracle", "Demonic Consultation"]);
  expect(n!.combo.result).toBe("Win the game");
});

/** #568: the line needs a creature the variant names only by kind. Dropping it made two named cards
 *  read as a whole two-card combo. */
test("keeps the pieces a variant names by template, once per copy", () => {
  const n = normalizeVariant({
    id: "v3",
    uses: [{ card: { name: "Goblin Bombardment" } }, { card: { name: "Metallic Mimic" } }],
    requires: [{ template: { name: "Creature with undying" }, quantity: 1 }, { template: { name: "Token" }, quantity: 2 }],
    produces: [{ feature: { name: "Infinite death triggers" } }],
  });
  expect(n!.combo.requires).toEqual(["Creature with undying", "Token", "Token"]);
  // A variant with none carries no field at all, so the stored documents stay as they were.
  expect(normalizeVariant({ id: "v4", uses: [{ card: { name: "A" } }], produces: [{ feature: { name: "Win the game" } }] })!.combo)
    .not.toHaveProperty("requires");
});

test("joins multiple produced features into the result", () => {
  const n = normalizeVariant({
    id: "v2",
    uses: [{ card: { name: "A" } }],
    produces: [{ feature: { name: "Infinite mana" } }, { feature: { name: "Infinite tokens" } }],
  });
  expect(n!.combo.result).toBe("Infinite mana, Infinite tokens");
});

test("skips variants with no cards or no results", () => {
  expect(normalizeVariant({ id: "x", uses: [], produces: [{ feature: { name: "Win" } }] })).toBeNull();
  expect(normalizeVariant({ id: "y", uses: [{ card: { name: "A" } }], produces: [] })).toBeNull();
  expect(normalizeVariant({ uses: [{ card: { name: "A" } }], produces: [{ feature: { name: "Win" } }] })).toBeNull();
});
