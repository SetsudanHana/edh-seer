import { expect, test } from "vitest";
import { parseTypeLine } from "./typeline.js";

test("separates supertypes from types", () => {
  expect(parseTypeLine("Legendary Creature — Human Wizard")).toEqual({
    supertypes: ["legendary"],
    types: ["creature"],
    subtypes: ["human", "wizard"],
  });
});

test("handles a type line with no subtypes", () => {
  expect(parseTypeLine("Artifact")).toEqual({ supertypes: [], types: ["artifact"], subtypes: [] });
});

test("handles multiple supertypes and types", () => {
  expect(parseTypeLine("Basic Snow Land — Forest")).toEqual({
    supertypes: ["basic", "snow"],
    types: ["land"],
    subtypes: ["forest"],
  });
  expect(parseTypeLine("Artifact Creature — Golem")).toEqual({
    supertypes: [],
    types: ["artifact", "creature"],
    subtypes: ["golem"],
  });
});

// Callers pass a SINGLE face's type line. A combined DFC line has two em dashes and would
// otherwise smear the second face's types into the first face's subtypes.
test("splits on the first separator only, so a combined DFC line is visibly wrong not silently merged", () => {
  const p = parseTypeLine("Creature — Werewolf // Creature — Werewolf");
  expect(p.types).toEqual(["creature"]);
  expect(p.subtypes).toContain("//");
});

test("accepts en dash and spaced hyphen as separators", () => {
  expect(parseTypeLine("Creature – Goblin").subtypes).toEqual(["goblin"]);
  expect(parseTypeLine("Creature - Goblin").subtypes).toEqual(["goblin"]);
});
