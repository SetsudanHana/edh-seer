import { describe, expect, test } from "vitest";
import { evaluate } from "./evaluate.js";
import { buildTypeViews, sparseBestFace } from "./type-views.js";
import type { SetColumn } from "./walk.js";

// subtypes: 0 tiefling, 1 druid, 2 bird, 3 bear, 4 elf, 5 shapeshifter, 6 forest (not a creature type)
const index = {
  types: ["creature", "land"],
  subtypes: ["tiefling", "druid", "bird", "bear", "elf", "shapeshifter", "forest"],
  cards: [
    { t: [0], s: [0, 1, 2, 3] },                 // 0 Casal-like: Tiefling Druid // Bird Bear
    { t: [0], s: [0, 1, 2, 3] },                 // 1 same union, only the front face is in `faces` (transform, one entry)
    { t: [0], s: [4, 2, 3] },                    // 2 front: elf (1); back: bird bear (2) -> best is the back
    { t: [0], s: [4] },                          // 3 single face, no faces data
    { t: [0], s: [0, 1, 2, 3, 4, 5] },           // 4 a changeling: holds every creature type; its faces list only what is printed
    { t: [0], s: [4, 6] },                       // 5 single face with a non-creature subtype
  ],
};
const creatures = ["tiefling", "druid", "bird", "bear", "elf", "shapeshifter"];
const faces = new Map<number, string[][]>([
  [0, [["tiefling", "druid"], ["bird", "bear"]]],
  [1, [["tiefling", "druid"]]],
  [2, [["elf"], ["bird", "bear"]]],
  [4, [["shapeshifter"]]],
  [5, [["elf", "forest"]]],
]);

function column(): SetColumn {
  const st = buildTypeViews(index, { creatureList: creatures }).find((c) => c.path === "st")!;
  const best = sparseBestFace(index, faces, creatures);
  return Object.assign(best, { st });
}
const count = (row: number): number => {
  const best = sparseBestFace(index, faces, creatures);
  const st = buildTypeViews(index, { creatureList: creatures }).find((c) => c.path === "st")!;
  const res = evaluate({ field: "stBest", op: "countIn", list: "creature", min: 0 }, {
    rowCount: index.cards.length, columns: new Map([["st", st], ["stBest", best]]), namedLists: { creature: { values: creatures } },
  });
  if (!res.ok) throw new Error(res.cannotAnswer.join());
  const nodes = [...Array(7).keys()].find((n) => evaluate({ field: "stBest", op: "countIn", list: "creature", min: n, max: n }, {
    rowCount: index.cards.length, columns: new Map([["st", st], ["stBest", best]]), namedLists: { creature: { values: creatures } },
  }).ok && (evaluate({ field: "stBest", op: "countIn", list: "creature", min: n, max: n }, {
    rowCount: index.cards.length, columns: new Map([["st", st], ["stBest", best]]), namedLists: { creature: { values: creatures } },
  }) as { rows: number[] }).rows.includes(row));
  return nodes ?? -1;
};

describe("stBest: the creature types of the best face", () => {
  test("a two-faced card counts its best face, not the union: Casal-like is 2, not 4", () => {
    expect(count(0)).toBe(2);
  });
  test("a transform card whose faces list only the front counts that face", () => {
    expect(count(1)).toBe(2);
  });
  test("the face with MORE creature types wins, whichever it is", () => {
    expect(count(2)).toBe(2);
  });
  test("a single-face card with no faces data is unchanged", () => {
    expect(count(3)).toBe(1);
    expect(count(5)).toBe(1);
  });
  test("a changeling keeps every creature type, whatever its faces print", () => {
    expect(count(4)).toBe(6);
  });
  test("it is sparse over st: only rows whose best face differs are stored", () => {
    const c = column();
    expect(c.fallback).toBe("st");
    expect(c.overrides).toEqual([0, 1, 2]);
    expect(c.path).toBe("stBest");
    expect(c.group).toBe("faces");
  });
});
