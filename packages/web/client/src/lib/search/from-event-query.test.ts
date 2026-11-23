import { describe, expect, test } from "vitest";
import { identityKeyOf } from "@edh-seer/matcher/partners-core";
import { compileCharacteristics, coloursFit, type EventQuery } from "../facets.js";
import { evaluate } from "./evaluate.js";
import { coreContext, evaluateEventQuery, fromEventQuery, type CoreRow } from "./from-event-query.js";

type Row = CoreRow & { slug: string; name: string };
const vocab = {
  types: ["artifact", "creature", "instant", "land"],
  subtypes: ["elf", "human", "sliver", "wizard"],
  keywords: ["flying", "trample", "vigilance"],
};
const IDENT = ["", "W", "U", "B", "R", "G", "WU", "UB", "RG", "WUBRG", "BG", "WB"];

/** A tiny deterministic generator, so a failing combination can be reproduced from its seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const some = <T,>(r: () => number, xs: readonly T[], p: number): T[] => xs.filter(() => r() < p);

function fixtureRows(n: number): Row[] {
  const r = rng(7);
  return Array.from({ length: n }, (_, i) => {
    const identity = [...pick(r, IDENT)];
    const colour = r() < 0.2 ? 0 : [1, 2, 4, 8, 16, 3, 6, 24, 31][Math.floor(r() * 9)]!;
    const row: Row = {
      slug: `c${i}`, name: `Card ${i}`, identity, commander: r() < 0.3,
      t: some(r, [0, 1, 2, 3], 0.4),
      s: some(r, [0, 1, 2, 3], 0.3),
      k: some(r, [0, 1, 2], 0.3),
    };
    if (r() < 0.7) row.mv = Math.floor(r() * 8);
    if (r() < 0.5) row.pow = Math.floor(r() * 7);
    if (r() < 0.5) row.tou = Math.floor(r() * 7);
    if (colour !== 0) row.c = colour;
    return row;
  });
}

function randomQuery(r: () => number): EventQuery {
  const bound = (): number | undefined => (r() < 0.6 ? undefined : Math.floor(r() * 7));
  const colourSet = ["W", "U", "B", "R", "G", "C"];
  const q: EventQuery = {
    produce: [], consume: [],
    colours: r() < 0.5 ? [] : some(r, colourSet, 0.4),
    types: r() < 0.5 ? [] : some(r, [...vocab.types, "nonesuch"], 0.15),
    subtypes: r() < 0.7 ? [] : some(r, vocab.subtypes, 0.2),
    keywords: r() < 0.7 ? [] : some(r, vocab.keywords, 0.2),
    cardColours: r() < 0.6 ? [] : some(r, colourSet, 0.25),
  };
  const mvMin = bound(); const mvMax = bound(); const powMin = bound(); const powMax = bound();
  const touMin = bound(); const touMax = bound();
  if (mvMin !== undefined) q.mvMin = mvMin;
  if (mvMax !== undefined) q.mvMax = mvMax;
  if (powMin !== undefined) q.powMin = powMin;
  if (powMax !== undefined) q.powMax = powMax;
  if (touMin !== undefined) q.touMin = touMin;
  if (touMax !== undefined) q.touMax = touMax;
  return q;
}

/** What the page did before: the old predicate pair, row for row. */
function oldRows(rows: Row[], q: EventQuery, mode: "cards" | "commanders", colours: boolean): number[] {
  const fits = compileCharacteristics(q, { ...vocab, colours });
  const out: number[] = [];
  rows.forEach((e, i) => {
    const key = identityKeyOf(e.identity);
    if (coloursFit(key === "C" ? "" : key, q.colours, mode) && fits(e)) out.push(i);
  });
  return out;
}

describe("the AST path agrees with compileCharacteristics + coloursFit", () => {
  const rows = fixtureRows(400).map((x) => ({ ...x, t: x.t ?? [] })); // every row carries `t`: none is thin
  const ctx = coreContext(rows, vocab);
  for (const mode of ["cards", "commanders"] as const) {
    test(`400 random queries, ${mode}`, () => {
      const r = rng(mode === "cards" ? 11 : 12);
      let nonEmpty = 0;
      for (let k = 0; k < 400; k++) {
        const q = randomQuery(r);
        const res = evaluate(fromEventQuery(q, mode), ctx);
        expect(res.ok).toBe(true);
        const want = oldRows(rows, q, mode, true);
        if (want.length > 0) nonEmpty++;
        expect(res.ok ? res.rows : null, JSON.stringify(q)).toEqual(want);
      }
      // A property over only-empty answers would agree trivially.
      expect(nonEmpty).toBeGreaterThan(100);
    });
  }
});

describe("what the AST cannot answer", () => {
  test("a card-colour question on an artifact whose rows carry no `c` answers cannot-answer, not empty and not all", () => {
    const old = fixtureRows(40).map(({ c: _c, ...rest }) => ({ ...rest, t: rest.t ?? [] }));
    const q: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: ["C"] };
    const res = evaluate(fromEventQuery(q, "cards"), coreContext(old, vocab));
    expect(res.ok).toBe(false);
    // The same artifact still answers every question that is not about card colours.
    const plain = evaluate(fromEventQuery({ ...q, cardColours: [], types: ["creature"] }, "cards"), coreContext(old, vocab));
    expect(plain.ok).toBe(true);
  });

  test("a list-based field cannot answer until the catalogue is loaded", () => {
    const rows = fixtureRows(20).map((x) => ({ ...x, t: x.t ?? [] }));
    const ctx = coreContext(rows, vocab);
    expect(evaluate({ field: "st", op: "countIn", list: "creature", min: 1 }, ctx).ok).toBe(false);
    expect(evaluate({ field: "tFront", op: "has", value: "creature" }, ctx).ok).toBe(false);
    expect(evaluate({ field: "read", op: "has", value: "grammar" }, ctx).ok).toBe(false);
  });

  test("evaluateEventQuery reports an unanswerable question as cannot-answer", () => {
    const old = fixtureRows(10).map(({ c: _c, ...rest }) => rest);
    const q: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: ["U"] };
    expect(evaluateEventQuery(old, vocab, q, "cards").ok).toBe(false);
  });
});

describe("a thin row has no mana value (#1789)", () => {
  const thin: Row = { slug: "thin", name: "Cmdr. Troi, Outgoing Empath", identity: ["W"], commander: true };
  const full: Row = { slug: "full", name: "Sol Ring", identity: [], commander: false, t: [0] }; // mv omitted: 0
  const q = (over: Partial<EventQuery>): EventQuery => ({ produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [], ...over });

  test("the old path read it as 0; the new one leaves it out of every mv range", () => {
    const rows = [thin, full];
    expect(oldRows(rows, q({ mvMax: 2 }), "cards", true)).toEqual([0, 1]);
    const res = evaluateEventQuery(rows, vocab, q({ mvMax: 2 }), "cards");
    expect(res).toEqual({ ok: true, rows: [1] });
    expect(evaluateEventQuery(rows, vocab, q({ mvMin: 0, mvMax: 0 }), "cards")).toEqual({ ok: true, rows: [1] });
  });

  test("with no mv range it still answers", () => {
    expect(evaluateEventQuery([thin, full], vocab, q({}), "cards")).toEqual({ ok: true, rows: [0, 1] });
  });
});

describe("the rows leaf", () => {
  test("combines an externally computed set inside the same evaluator", () => {
    const rows = fixtureRows(30).map((x) => ({ ...x, t: x.t ?? [] }));
    const ctx = coreContext(rows, vocab);
    const keep = [1, 2, 3, 5, 8, 13];
    expect(evaluate({ op: "rows", rows: new Set(keep) }, ctx)).toEqual({ ok: true, rows: keep });
    const and = evaluate({ and: [{ op: "rows", rows: keep }, { not: { op: "rows", rows: [2, 3] } }] }, ctx);
    expect(and).toEqual({ ok: true, rows: [1, 5, 8, 13] });
  });
});
