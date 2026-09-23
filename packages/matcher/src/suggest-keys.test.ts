import { expect, test } from "vitest";
import { eventKeysForDemand } from "./suggest-keys.js";

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
