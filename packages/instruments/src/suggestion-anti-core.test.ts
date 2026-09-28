import { expect, test } from "vitest";
import { suggestionViolations } from "./suggestion-anti-core.js";

const lists = {
  plan: [{ name: "Pious Evangel" }], routes: [{ name: "Tainted Aether" }], pairs: [{ cut: "X", add: { name: "Portcullis" } }],
  synergy: { "enters:creature": [{ name: "Lethal Vapors" }] }, build: { Ramp: [{ name: "Arcane Signet" }] }, answers: {},
};

test("a listed card found in any suggestion list is a violation, named with the list it is on", () => {
  const v = suggestionViolations(lists as never, ["Tainted Aether", "Portcullis", "Lethal Vapors", "Grave Peril"]);
  expect(v).toEqual([
    { card: "Tainted Aether", list: "routes" },
    { card: "Portcullis", list: "pairs" },
    { card: "Lethal Vapors", list: "synergy enters:creature" },
  ]);
});

test("a clean deck has no violations; build and answer lists are not checked (a wipe is asked there)", () => {
  expect(suggestionViolations(lists as never, ["Arcane Signet"])).toEqual([]);
});
