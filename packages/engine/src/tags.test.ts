import { expect, test } from "vitest";
import { extractTags, tag, describeTag } from "./tags.js";
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

test("tag builds bare and parametric canonical strings", () => {
  expect(tag("artifact")).toBe("artifact");
  expect(tag("tribe", "goblin")).toBe("tribe:goblin");
  expect(tag("counter", "+1/+1")).toBe("counter:+1/+1");
});

test("describeTag renders human labels for parametric and bare tags", () => {
  expect(describeTag("tribe:goblin")).toBe("Goblins");
  expect(describeTag("counter:+1/+1")).toBe("+1/+1 counters");
  expect(describeTag("cast:instant")).toBe("instants");
  expect(describeTag("creature-etb")).toBe("creatures entering");
  expect(describeTag("artifact")).toBe("artifact");
});
