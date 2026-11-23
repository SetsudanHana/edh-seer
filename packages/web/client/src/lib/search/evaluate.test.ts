import { expect, test } from "vitest";
import { evaluate, type EvalContext, type Node } from "./evaluate.js";
import { buildTypeViews } from "./type-views.js";
import type { Column } from "./walk.js";

const creatureList = ["borg", "human", "elf", "wizard"];
const types = ["creature", "land", "legendary"];
const subtypes = ["borg", "elf", "human", "wizard", "forest"];
// rows: 0 changeling, 1 borg, 2 three-type, 3 two-type, 4 land
const cards = [
  { t: [0], s: [0, 1, 2, 3] },
  { t: [0], s: [0, 1, 2] },
  { t: [0, 2], s: [1, 2, 3] },
  { t: [0], s: [1, 2] },
  { t: [1], s: [4] },
  { t: [0], s: [0, 1, 2, 4] }, // as many subtypes as the creature list, but not the list
];
const views = buildTypeViews({ types, subtypes, cards }, { creatureList });
const ctx: EvalContext = {
  rowCount: cards.length,
  columns: new Map<string, Column>(views.map((v) => [v.path, v])),
  namedLists: { creature: { values: creatureList } },
};

test("acceptance: t has creature AND NOT st has borg AND countIn(st, creature) >= 3 excludes the changeling", () => {
  const q: Node = {
    and: [
      { field: "t", op: "has", value: "creature" },
      { not: { field: "st", op: "has", value: "borg" } },
      { field: "st", op: "countIn", list: "creature", min: 3 },
    ],
  };
  expect(evaluate(q, ctx)).toEqual({ ok: true, rows: [2] });
});

test("the changeling has every creature type, so it is flagged and is not Borg-free", () => {
  expect(evaluate({ field: "everyCreatureType", op: "has", value: "true" }, ctx)).toEqual({ ok: true, rows: [0] });
  expect(evaluate({ not: { field: "st", op: "has", value: "borg" } }, ctx)).toEqual({ ok: true, rows: [2, 3, 4] });
});

test("count, or and bounds", () => {
  expect(evaluate({ field: "st", op: "count", min: 2, max: 2 }, ctx)).toEqual({ ok: true, rows: [3] });
  expect(evaluate({ field: "st", op: "count", max: 0 }, ctx)).toEqual({ ok: true, rows: [] });
  expect(evaluate({ or: [{ field: "t", op: "has", value: "land" }, { field: "st", op: "count", min: 4 }] }, ctx)).toEqual({
    ok: true,
    rows: [0, 4, 5],
  });
});

test("tFront falls back to the row types; frontTypes overrides", () => {
  const v = buildTypeViews({ types, subtypes, cards }, { creatureList, frontTypes: new Map([[2, ["land"]]]) });
  const c2: EvalContext = { ...ctx, columns: new Map<string, Column>(v.map((x) => [x.path, x])) };
  expect(evaluate({ field: "tFront", op: "has", value: "creature" }, c2)).toEqual({ ok: true, rows: [0, 1, 3, 5] });
  expect(evaluate({ field: "t", op: "has", value: "creature" }, c2)).toEqual({ ok: true, rows: [0, 1, 2, 3, 5] });
});

test("an unknown field, list, or a numeric field is cannot-answer, never empty or all", () => {
  expect(evaluate({ field: "nope", op: "has", value: "x" }, ctx)).toEqual({ ok: false, cannotAnswer: ["unknown field nope"] });
  expect(evaluate({ field: "st", op: "countIn", list: "zzz", min: 1 }, ctx)).toMatchObject({ ok: false });
  expect(evaluate({ not: { field: "nope", op: "has", value: "x" } }, ctx)).toMatchObject({ ok: false });
  const num: Column = { kind: "number", path: "n", group: "g", rows: [0], min: [1], max: [1] };
  expect(evaluate({ field: "n", op: "count" }, { ...ctx, columns: new Map([["n", num]]) })).toMatchObject({ ok: false });
});

// ---- numeric comparisons and colour identity (task 2) ----
import { buildIdentityView, buildNumberViews } from "./type-views.js";

const rows2 = [
  { identity: ["W", "U"], mv: 3, pow: 2, tou: 2 },
  { identity: [], mv: undefined, pow: 0, tou: 1 },
  { identity: ["W", "U", "G"], mv: 5, pow: undefined, tou: undefined },
  { identity: ["B"], mv: 1, pow: 4, tou: 4 },
];
const numCtx: EvalContext = {
  rowCount: rows2.length,
  columns: new Map<string, Column>([...buildNumberViews(rows2), buildIdentityView(rows2)].map((c) => [c.path, c])),
  namedLists: {},
};

test("number views: absent mv is 0 (as facets.ts), absent pow/tou stays absent", () => {
  const pow = numCtx.columns.get("pow")!;
  expect(pow).toMatchObject({ kind: "number", rows: [0, 1, 3], min: [2, 0, 4] });
  expect(numCtx.columns.get("mv")).toMatchObject({ rows: [0, 1, 2, 3], min: [3, 0, 5, 1] });
});

test("cmp: bounds are inclusive, and an absent power matches neither pow<=3 nor pow>=0", () => {
  expect(evaluate({ field: "pow", op: "cmp", max: 3 }, numCtx)).toEqual({ ok: true, rows: [0, 1] });
  expect(evaluate({ field: "pow", op: "cmp", min: 0 }, numCtx)).toEqual({ ok: true, rows: [0, 1, 3] });
  expect(evaluate({ field: "mv", op: "cmp", min: 3, max: 5 }, numCtx)).toEqual({ ok: true, rows: [0, 2] });
});

test("id within is fits-in (colourless fits everywhere), exactly is equality", () => {
  expect(evaluate({ field: "id", op: "within", value: ["W", "U", "G"] }, numCtx)).toEqual({ ok: true, rows: [0, 1, 2] });
  expect(evaluate({ field: "id", op: "within", value: ["W", "U"] }, numCtx)).toEqual({ ok: true, rows: [0, 1] });
  expect(evaluate({ field: "id", op: "exactly", value: ["U", "W"] }, numCtx)).toEqual({ ok: true, rows: [0] });
  expect(evaluate({ field: "id", op: "exactly", value: [] }, numCtx)).toEqual({ ok: true, rows: [1] });
});

test("cmp on a set field and has on a number field are cannot-answer", () => {
  expect(evaluate({ field: "id", op: "cmp", min: 1 }, numCtx)).toMatchObject({ ok: false });
  expect(evaluate({ field: "pow", op: "has", value: "2" }, numCtx)).toMatchObject({ ok: false });
  expect(evaluate({ field: "pow", op: "within", value: ["W"] }, numCtx)).toMatchObject({ ok: false });
});
