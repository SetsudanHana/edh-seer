import { expect, test } from "vitest";
import { axisEventKeys, eventKeysForDemand } from "./suggest-keys.js";

const KEYS = ["enters|creature|goblin|t", "enters|creature|-|-", "enters|artifact|-|-", "dies|creature|-|-",
  "enters-graveyard|land|-|-", "attacks|-|-|-", "enters|-|goblin|-"];

test("a subtype demand takes every key carrying that subtype, any type, any token", () => {
  expect(eventKeysForDemand("enters:subtype:goblin", KEYS)).toEqual(["enters|creature|goblin|t", "enters|-|goblin|-"]);
});

test("a type demand with two types takes either", () => {
  expect(eventKeysForDemand("enters:type:artifact+creature", KEYS))
    .toEqual(["enters|creature|goblin|t", "enters|creature|-|-", "enters|artifact|-|-"]);
});

test("zoned verbs keep their spelling on both sides", () => {
  expect(eventKeysForDemand("enters-graveyard:type:land", KEYS)).toEqual(["enters-graveyard|land|-|-"]);
});

test("any takes every key of the verb, and the narrowed suffix is ignored", () => {
  expect(eventKeysForDemand("attacks:any (narrowed)", KEYS)).toEqual(["attacks|-|-|-"]);
});

test("an unknown shape translates to nothing rather than to everything", () => {
  expect(eventKeysForDemand("garbage", KEYS)).toEqual([]);
  expect(eventKeysForDemand("enters:", KEYS)).toEqual([]);
});

/** THE ENGINE'S CROSS-VERB SUPPLIES (`verbSatisfies`, edges.ts): a death satisfies a leave, damage
 *  to a player is life loss, and a damage emit can be what a creature is dealt. A filter that
 *  compared verbs only by equality refused those producers before the engine was ever asked. */
test("a producer the engine accepts under another verb is collected", () => {
  const keys = ["dies|creature|-|-", "leaves|creature|-|-", "non-combat-damage|-|-|-", "combat-damage|-|-|-", "lose-life|-|-|-"];
  expect(eventKeysForDemand("leaves:type:creature", keys)).toEqual(["dies|creature|-|-", "leaves|creature|-|-"]);
  expect(eventKeysForDemand("lose-life:any", keys)).toEqual(["non-combat-damage|-|-|-", "lose-life|-|-|-"]);
  expect(eventKeysForDemand("damaged:any", keys)).toEqual(["non-combat-damage|-|-|-", "combat-damage|-|-|-"]);
});

/** AN AXIS TAG (`zoneEventKey` form: `enters:goblin`, `lose-life:any`) names its subject bare, so it
 *  may be a type or a subtype; both slots are tried. Same over-collecting filter, never a match. */
test("an axis tag takes the keys of its word in either slot", () => {
  expect(axisEventKeys("enters:goblin", KEYS)).toEqual(["enters|creature|goblin|t", "enters|-|goblin|-"]);
  expect(axisEventKeys("enters:artifact", KEYS)).toEqual(["enters|artifact|-|-"]);
  expect(axisEventKeys("attacks:any", KEYS)).toEqual(["attacks|-|-|-"]);
  expect(axisEventKeys("static:cost", KEYS)).toEqual([]);
  expect(axisEventKeys("static:pump", ["applies:pump|creature|-|-", "applies:pump|-|goblin|-", "applies:cost-reduction|creature|-|-"]))
    .toEqual(["applies:pump|creature|-|-"]);
});
