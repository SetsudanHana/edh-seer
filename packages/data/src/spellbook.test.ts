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
