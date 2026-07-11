import { expect, test } from "vitest";
import { extractTags } from "./tags.js";
import { FIXTURES } from "./fixtures.js";

test("treasure maker produces artifact, token, mana, sacrifice-fodder", () => {
  const t = extractTags(FIXTURES.dockside);
  expect(t.produces.has("artifact")).toBe(true);
  expect(t.produces.has("token")).toBe(true);
  expect(t.produces.has("mana")).toBe(true);
  expect(t.produces.has("sacrifice-fodder")).toBe(true);
});

test("artifact payoff cares about artifact", () => {
  const t = extractTags(FIXTURES.fireweaver);
  expect(t.cares.has("artifact")).toBe(true);
  expect(t.produces.has("artifact")).toBe(false);
});
