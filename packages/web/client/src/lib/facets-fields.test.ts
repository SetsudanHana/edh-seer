import { describe, expect, test } from "vitest";
import { eventsFromParams, eventsToParams, filterKindsOf, withoutFilterKind, type EventQuery } from "./facets.js";

const base: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] };

describe("any-of groups on the three word rows (#1782)", () => {
  test("ortype / orsubtype / orkeyword round-trip as repeated params, absent when empty", () => {
    const q = { ...base, orTypes: ["land", "artifact"], orSubtypes: ["elf"], orKeywords: ["flying", "trample"] };
    const p = eventsToParams(q, new URLSearchParams());
    expect(p.getAll("ortype")).toEqual(["land", "artifact"]);
    expect(p.getAll("orsubtype")).toEqual(["elf"]);
    expect(p.getAll("orkeyword")).toEqual(["flying", "trample"]);
    expect(eventsFromParams(p)).toMatchObject(q);
    expect([...eventsToParams(base, new URLSearchParams("ortype=land")).keys()]).toEqual([]);
  });

  test("a link without them reads exactly as before", () => {
    expect(eventsFromParams(new URLSearchParams("type=creature"))).toEqual({ ...base, types: ["creature"] });
  });

  test("they belong to the type-line and keyword rows, and removing the row clears them", () => {
    expect(filterKindsOf({ ...base, orSubtypes: ["elf"] })).toContain("typeline");
    expect(filterKindsOf({ ...base, orKeywords: ["flying"] })).toContain("keywords");
    expect(withoutFilterKind({ ...base, types: ["a"], orTypes: ["b"], orSubtypes: ["c"] }, "typeline")).toEqual(base);
    expect(withoutFilterKind({ ...base, orKeywords: ["b"] }, "keywords")).toEqual(base);
  });
});

describe("generic catalogue rows: f / fany / fnot / frange", () => {
  test("round-trip, one param per value, the value may hold a colon", () => {
    const fieldFilters = [
      { field: "tags.abilities.emits.verb", op: "must" as const, value: "draw" },
      { field: "tags.abilities.emits.verb", op: "any" as const, value: "mill" },
      { field: "tags.abilities.emits.verb", op: "any" as const, value: "gain-life" },
      { field: "read", op: "not" as const, value: "no-record" },
      { field: "x", op: "must" as const, value: "a:b" },
      { field: "tags.abilities.count.floor", op: "range" as const, min: 0, max: 3 },
    ];
    const p = eventsToParams({ ...base, fieldFilters }, new URLSearchParams());
    expect(p.getAll("f")).toEqual(["tags.abilities.emits.verb:draw", "x:a:b"]);
    expect(p.getAll("fany")).toEqual(["tags.abilities.emits.verb:mill", "tags.abilities.emits.verb:gain-life"]);
    expect(p.getAll("fnot")).toEqual(["read:no-record"]);
    expect(p.getAll("frange")).toEqual(["tags.abilities.count.floor:0..3"]);
    const back = eventsFromParams(p).fieldFilters ?? [];
    expect([...back].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
      .toEqual([...fieldFilters].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  });

  test("either end of a range is optional and zero is a bound", () => {
    const q = eventsFromParams(new URLSearchParams("frange=a:..3&frange=b:2..&frange=c:0..0"));
    expect(q.fieldFilters).toEqual([
      { field: "a", op: "range", max: 3 }, { field: "b", op: "range", min: 2 }, { field: "c", op: "range", min: 0, max: 0 },
    ]);
    expect(eventsToParams(q, new URLSearchParams()).getAll("frange")).toEqual(["a:..3", "b:2..", "c:0..0"]);
  });

  test("a malformed value is kept as a filter naming it, never dropped", () => {
    expect(eventsFromParams(new URLSearchParams("f=nocolon")).fieldFilters).toEqual([{ field: "nocolon", op: "must", value: "" }]);
  });

  test("a malformed range keeps its field so the page can name it", () => {
    expect(eventsFromParams(new URLSearchParams("frange=nope.x:abc..&frange=nope.y:5&frange=nope.z")).fieldFilters).toEqual([
      { field: "nope.x", op: "range" }, { field: "nope.y", op: "range" }, { field: "nope.z", op: "range" },
    ]);
    expect(eventsFromParams(new URLSearchParams("frange=:1..2")).fieldFilters).toBeUndefined();
  });

  test("absent when empty; no collision with a param that already exists", () => {
    expect([...eventsToParams(base, new URLSearchParams("f=a:b&fany=a:b&fnot=a:b&frange=a:1..2")).keys()]).toEqual([]);
    expect(eventsFromParams(new URLSearchParams("fronttypesmin=2&sort=fronttypes")).fieldFilters).toBeUndefined();
  });

  test("they are not a FilterKind and do not touch the other rows", () => {
    expect(filterKindsOf({ ...base, fieldFilters: [{ field: "x", op: "must", value: "y" }] })).toEqual([]);
  });
});
