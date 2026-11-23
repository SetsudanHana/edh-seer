import { describe, expect, test } from "vitest";
import { evaluate } from "./evaluate.js";
import { coreContext, fromEventQuery, type CoreRow } from "./from-event-query.js";
import type { EventQuery } from "../facets.js";

const vocab = { types: ["creature", "land"], subtypes: ["elf", "human", "wizard"], keywords: ["flying", "trample"] };
const rows: CoreRow[] = [
  { identity: [], t: [0], s: [0] },          // 0 creature elf
  { identity: [], t: [0], s: [1] },          // 1 creature human
  { identity: [], t: [0], s: [2] },          // 2 creature wizard
  { identity: [], t: [1], s: [0] },          // 3 land elf
  { identity: [], t: [0], s: [0, 1] },       // 4 creature elf human
];
const base: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] };
const run = (q: EventQuery) => evaluate(fromEventQuery(q, "cards", { vocab }), coreContext(rows, vocab));

describe("any-of inside one row", () => {
  test("(elf or human) and creature: the OR group is ANDed with the must chips", () => {
    expect(run({ ...base, types: ["creature"], orSubtypes: ["elf", "human"] })).toEqual({ ok: true, rows: [0, 1, 4] });
  });

  test("any-of with a never: (elf or wizard) and not human", () => {
    expect(run({ ...base, orSubtypes: ["elf", "wizard"], notSubtypes: ["human"] })).toEqual({ ok: true, rows: [0, 2, 3] });
  });

  test("a single any-of word is the same question as a must word", () => {
    expect(run({ ...base, orTypes: ["land"] })).toEqual(run({ ...base, types: ["land"] }));
  });

  test("any-of words the vocabulary does not know match nothing, not everything", () => {
    expect(run({ ...base, orSubtypes: ["nonesuch"] })).toEqual({ ok: true, rows: [] });
  });
});
