import { expect, test } from "vitest";
import type { CardTags } from "./schema.js";
import { composeTagsLookup, resolveTagsSource } from "./tags-lookup.js";

const tag = (model: string): CardTags => ({
  oracleId: "x", schemaVersion: 1, promptVersion: 0, model,
  characteristics: {
    types: ["creature"], subtypes: [], colors: [], identity: [],
    cmc: 1, power: null, toughness: null, token: false, keywords: [],
  },
  abilities: [],
});

const src = (doc: CardTags | null) => ({ findOne: async () => doc });

test("TAGS_SOURCE defaults to derived", () => {
  // Flipped 2026-08-06 on the edge-precision measurement: derived 69.0% [58.5, 77.9] against flat
  // 18.0% [12.7, 24.9], non-overlapping on every view. `derived` and not `derived-first` because
  // this project treats a silent wrong answer as worse than a missing one, and the flat fallback
  // would serve an 18%-precision population for any card outside the purchased corpus.
  expect(resolveTagsSource({})).toBe("derived");
  expect(resolveTagsSource({ TAGS_SOURCE: "derived-first" })).toBe("derived-first");
  expect(resolveTagsSource({ TAGS_SOURCE: "derived" })).toBe("derived");
});

test("an unrecognised TAGS_SOURCE throws instead of silently serving flat", () => {
  // A typo that quietly falls back would look exactly like a working derived deployment while
  // serving the old population -- the silent-wrong-answer class this project treats as worse than
  // a missing one.
  expect(() => resolveTagsSource({ TAGS_SOURCE: "dervied" })).toThrow(/dervied/);
});

test("flat reads only the flat collection", async () => {
  const l = composeTagsLookup(src(tag("flat")), src(tag("derived")), "flat");
  expect((await l.findOne("x"))?.model).toBe("flat");
});

test("derived reads only the derived collection, and a miss stays a miss", async () => {
  // Deliberately NOT falling back: this mode exists to measure the derived population alone.
  const hit = composeTagsLookup(src(tag("flat")), src(tag("derived")), "derived");
  expect((await hit.findOne("x"))?.model).toBe("derived");

  const miss = composeTagsLookup(src(tag("flat")), src(null), "derived");
  expect(await miss.findOne("x")).toBeNull();
});

test("derived-first prefers derived and falls back to flat", async () => {
  // The normal case: coverage measurement puts a newly built deck near half derived, half flat.
  const both = composeTagsLookup(src(tag("flat")), src(tag("derived")), "derived-first");
  expect((await both.findOne("x"))?.model).toBe("derived");

  const onlyFlat = composeTagsLookup(src(tag("flat")), src(null), "derived-first");
  expect((await onlyFlat.findOne("x"))?.model).toBe("flat");

  const neither = composeTagsLookup(src(null), src(null), "derived-first");
  expect(await neither.findOne("x")).toBeNull();
});

test("flat mode never touches the derived collection", async () => {
  // Reading it would be harmless but wasteful -- one findOne per card per deck.
  let touched = false;
  const derived = { findOne: async () => { touched = true; return tag("derived"); } };
  await composeTagsLookup(src(tag("flat")), derived, "flat").findOne("x");
  expect(touched).toBe(false);
});
