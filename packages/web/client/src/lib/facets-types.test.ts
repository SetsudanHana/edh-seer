import { describe, expect, test } from "vitest";
import { eventsFromParams, eventsToParams, filterKindsOf, NATURAL_DIR, orderOf, withoutFilterKind, type EventQuery } from "./facets.js";

const base: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] };

describe("NOT on types, subtypes and keywords", () => {
  test("round-trip as repeated params, absent when empty", () => {
    const q = { ...base, notTypes: ["land"], notSubtypes: ["borg", "elf"], notKeywords: ["flying"] };
    const p = eventsToParams(q, new URLSearchParams());
    expect(p.getAll("nottype")).toEqual(["land"]);
    expect(p.getAll("notsubtype")).toEqual(["borg", "elf"]);
    expect(p.getAll("notkeyword")).toEqual(["flying"]);
    expect(eventsFromParams(p)).toMatchObject(q);
    expect([...eventsToParams(base, new URLSearchParams("nottype=land")).keys()]).toEqual([]);
  });

  test("a link without them reads exactly as before", () => {
    expect(eventsFromParams(new URLSearchParams("type=creature"))).toEqual({ ...base, types: ["creature"] });
  });

  test("they are part of the type-line and keyword rows", () => {
    expect(filterKindsOf({ ...base, notSubtypes: ["borg"] })).toContain("typeline");
    expect(filterKindsOf({ ...base, notKeywords: ["flying"] })).toContain("keywords");
    expect(withoutFilterKind({ ...base, types: ["a"], notTypes: ["b"], notSubtypes: ["c"] }, "typeline"))
      .toEqual(base);
    expect(withoutFilterKind({ ...base, notKeywords: ["b"] }, "keywords")).toEqual(base);
  });
});

describe("the five type counts", () => {
  const names = [
    ["cardTypes", "cardtypes"], ["frontTypes", "fronttypes"], ["supertypes", "supertypes"],
    ["subtypeCount", "subtypes"], ["creatureTypes", "creaturetypes"],
  ] as const;

  for (const [field, param] of names) {
    test(`${param}min/max: zero is a real bound, a bad one is no filter`, () => {
      const q = eventsFromParams(new URLSearchParams(`${param}min=0&${param}max=3`));
      expect(q).toMatchObject({ [`${field}Min`]: 0, [`${field}Max`]: 3 });
      const p = eventsToParams(q, new URLSearchParams());
      expect(p.get(`${param}min`)).toBe("0");
      expect(p.get(`${param}max`)).toBe("3");
      const bad = eventsFromParams(new URLSearchParams(`${param}min=abc&${param}max=-1`));
      expect(bad).not.toHaveProperty(`${field}Min`);
      expect(bad).not.toHaveProperty(`${field}Max`);
    });
  }

  test("they are one filter kind, and removing it clears all five", () => {
    const q = { ...base, cardTypesMin: 1, creatureTypesMax: 0 };
    expect(filterKindsOf(q)).toEqual(["typeCounts"]);
    expect(withoutFilterKind({ ...q, mvMin: 2 }, "typeCounts")).toEqual({ ...base, mvMin: 2 });
  });
});

describe("sort keys", () => {
  test("five new orders, natural direction descending", () => {
    for (const s of ["cardtypes", "fronttypes", "supertypes", "subtypes", "creaturetypes"] as const) {
      expect(eventsFromParams(new URLSearchParams(`sort=${s}`)).sort).toBe(s);
      expect(NATURAL_DIR[s]).toBe("desc");
      expect(orderOf({ ...base, sort: s })).toBe(s);
    }
  });
});

describe("changelings=keep", () => {
  test("round-trips, and only that value counts", () => {
    expect(eventsFromParams(new URLSearchParams("changelings=keep")).keepChangelings).toBe(true);
    expect(eventsFromParams(new URLSearchParams("changelings=no"))).not.toHaveProperty("keepChangelings");
    expect(eventsToParams({ ...base, keepChangelings: true }, new URLSearchParams()).get("changelings")).toBe("keep");
    expect(eventsToParams(base, new URLSearchParams("changelings=keep")).has("changelings")).toBe(false);
  });
});
