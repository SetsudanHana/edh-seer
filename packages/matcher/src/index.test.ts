import { expect, test } from "vitest";
import { rankThemes, themeWeights, computeCohesion } from "@edh-seer/engine";
import type { DeckCard, Hierarchy } from "./index.js";

test("engine weights helpers are importable and matcher types are exported", () => {
  expect(typeof rankThemes).toBe("function");
  expect(typeof themeWeights).toBe("function");
  expect(typeof computeCohesion).toBe("function");
  const h: Hierarchy = { wizard: ["creature"] };
  const dc = { tags: null } as Partial<DeckCard>;
  expect(h.wizard).toEqual(["creature"]);
  expect(dc.tags).toBeNull();
});
