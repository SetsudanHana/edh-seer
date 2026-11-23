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

// ---- #1782 task 2: NOT, the five type counts, changelings ---------------------------------------------------------
import { rowCountsOf, typeCountSpec, withEveryCreatureType } from "./from-event-query.js";

describe("NOT on the word rows", () => {
  const rows = fixtureRows(300).map((x) => ({ ...x, t: x.t ?? [] }));
  const ctx = coreContext(rows, vocab);
  const q0: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] };

  test("matches the naive reading row for row, and composes with the positive terms", () => {
    const res = evaluate(fromEventQuery({ ...q0, types: ["creature"], notTypes: ["land"], notSubtypes: ["elf"], notKeywords: ["flying", "trample"] }, "cards", { vocab }), ctx);
    const want = rows.flatMap((r, i) => (r.t.includes(1) && !r.t.includes(3) && !(r.s ?? []).includes(0)
      && !(r.k ?? []).includes(0) && !(r.k ?? []).includes(1) ? [i] : []));
    expect(res).toEqual({ ok: true, rows: want });
    expect(want.length).toBeGreaterThan(0);
  });

  test("a NOT name the vocabulary does not know matches nothing (a not-yet-loaded table must not show everything)", () => {
    const empty = { types: [], subtypes: [], keywords: [] };
    for (const over of [{ notTypes: ["land"] }, { notSubtypes: ["elf"] }, { notKeywords: ["flying"] }]) {
      expect(evaluate(fromEventQuery({ ...q0, ...over }, "cards", { vocab: empty }), coreContext(rows, empty))).toEqual({ ok: true, rows: [] });
    }
  });
});

describe("the five type counts", () => {
  // types: 0 creature 1 land 2 legendary 3 artifact; subtypes 0 elf 1 human 2 wizard 3 borg 4 forest
  const tv = { types: ["creature", "land", "legendary", "artifact"], subtypes: ["elf", "human", "wizard", "borg", "forest"], keywords: [] };
  const lists = {
    card: { values: ["creature", "land", "artifact"] },
    super: { values: ["legendary"] },
    creature: { values: ["elf", "human", "wizard", "borg"] },
  };
  const crows = [
    { identity: [], t: [0], s: [0, 1, 2] },            // 0: 1 card type, 0 super, 3 sub, 3 creature
    { identity: [], t: [0, 2, 3], s: [0] },            // 1: 2 card types + legendary
    { identity: [], t: [1], s: [4] },                  // 2: land forest, 0 creature types
    { identity: [], t: [0], s: [0, 1, 2, 3] },         // 3: every creature type
    { identity: [], t: [0, 3] },                       // 4: no subtypes
  ];
  // The creature-type count reads stBest (sparse over st); no row's best face differs here.
  const best = { kind: "set" as const, path: "stBest", group: "faces", fallback: "st", overrides: [] as number[], values: new Map<string, number[]>() };
  const ctx = coreContext(crows, tv, { namedLists: lists, columns: [best] });
  const ask = (over: Partial<EventQuery>) => evaluate(fromEventQuery({ produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [], ...over }, "cards", { vocab: tv }), ctx);

  test("card types count CR 205.2a types and not supertypes", () => {
    expect(ask({ cardTypesMin: 2 })).toEqual({ ok: true, rows: [1, 4] });
    expect(ask({ cardTypesMin: 1, cardTypesMax: 1 })).toEqual({ ok: true, rows: [0, 2, 3] });
  });
  test("supertypes, with zero a real bound", () => {
    expect(ask({ supertypesMin: 1 })).toEqual({ ok: true, rows: [1] });
    expect(ask({ supertypesMax: 0 })).toEqual({ ok: true, rows: [0, 2, 3, 4] });
  });
  test("subtypes and creature types", () => {
    expect(ask({ subtypeCountMin: 3 })).toEqual({ ok: true, rows: [0, 3] });
    expect(ask({ subtypeCountMax: 0 })).toEqual({ ok: true, rows: [4] });
    expect(ask({ creatureTypesMin: 3 })).toEqual({ ok: true, rows: [0, 3] });
    expect(ask({ creatureTypesMax: 0 })).toEqual({ ok: true, rows: [2, 4] });
  });
  test("a thin row (no `t`) is outside every count range, as it is outside every mv range", () => {
    const thinCtx = coreContext([...crows, { identity: [] }], tv, { namedLists: lists, columns: [best] }); // row 5: thin
    const askThin = (over: Partial<EventQuery>) => evaluate(fromEventQuery({ produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [], ...over }, "cards", { vocab: tv }), thinCtx);
    expect(askThin({ cardTypesMax: 0 })).toEqual({ ok: true, rows: [] });
    expect(askThin({ supertypesMax: 0 })).toEqual({ ok: true, rows: [0, 2, 3, 4] });
    expect(askThin({ subtypeCountMax: 0 })).toEqual({ ok: true, rows: [4] });
    expect(askThin({ creatureTypesMax: 0 })).toEqual({ ok: true, rows: [2, 4] });
  });
  test("front-face count needs the faces group: without it, cannot-answer", () => {
    expect(ask({ frontTypesMin: 1 }).ok).toBe(false);
  });
  test("without the catalogue's named lists every count that needs one is cannot-answer, never empty", () => {
    const bare = coreContext(crows, tv);
    const q: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [], cardTypesMin: 1 };
    expect(evaluate(fromEventQuery(q, "cards", { vocab: tv }), bare).ok).toBe(false);
  });
  test("per-row counts for the sort, and the spec table names all five", () => {
    expect([...rowCountsOf(ctx, "creaturetypes")!]).toEqual([3, 1, 0, 4, 0]);
    expect([...rowCountsOf(ctx, "cardtypes")!]).toEqual([1, 2, 1, 1, 2]);
    expect([...rowCountsOf(ctx, "supertypes")!]).toEqual([0, 1, 0, 0, 0]);
    expect([...rowCountsOf(ctx, "subtypes")!]).toEqual([3, 1, 1, 4, 0]);
    expect(rowCountsOf(coreContext(crows, tv), "cardtypes")).toBeNull();
    expect(Object.keys(typeCountSpec).sort()).toEqual(["cardtypes", "creaturetypes", "fronttypes", "subtypes", "supertypes"]);
  });
});

describe("a changeling is every creature type (CR 702.73a)", () => {
  const tv = { types: ["creature"], subtypes: ["elf", "human", "borg", "forest"], keywords: [] };
  const lists = { creature: { values: ["elf", "human", "borg"] } };
  const crows = [
    { identity: [], t: [0], s: [0, 1, 2, 3] }, // 0 changeling that also carries a NON-creature subtype
    { identity: [], t: [0], s: [0, 2] },       // 1 borg elf
    { identity: [], t: [0], s: [0, 1] },       // 2 elf human
    { identity: [], t: [0], s: [0, 1, 3] },    // 3 three subtypes but borg is missing: NOT every creature type
  ];
  const base: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [], notSubtypes: ["borg"] };
  const ctx = withEveryCreatureType(coreContext(crows, tv, { namedLists: lists }), crows, tv);
  const run = (q: EventQuery) => evaluate(fromEventQuery(q, "cards", { vocab: tv, creatureTypes: new Set(lists.creature.values) }), ctx);

  test("the every-creature-type view needs ALL of the list: three subtypes with one creature type missing is not a changeling", () => {
    expect(evaluate({ field: "everyCreatureType", op: "has", value: "true" }, ctx)).toEqual({ ok: true, rows: [0] });
  });
  test("not <creature type> hides it by default, and keeps it with keepChangelings", () => {
    expect(run(base)).toEqual({ ok: true, rows: [2, 3] });
    expect(run({ ...base, keepChangelings: true })).toEqual({ ok: true, rows: [0, 2, 3] });
  });
  test("keepChangelings only forgives a CREATURE type: a changeling carrying a NOT-ed non-creature subtype stays out", () => {
    const res = run({ ...base, notSubtypes: ["forest"], keepChangelings: true });
    expect(res).toEqual({ ok: true, rows: [1, 2] });
    // and with both, the creature-type one is forgiven but the forest still excludes it
    expect(run({ ...base, notSubtypes: ["borg", "forest"], keepChangelings: true })).toEqual({ ok: true, rows: [2] });
  });
});

describe("commandersOnly over a mixed fixture", () => {
  const mixed: CoreRow[] = [
    { identity: ["R"], commander: true, t: [1], mv: 2 },
    { identity: ["R"], commander: false, t: [1], mv: 2 },
    { identity: ["R"], commander: true, t: [3], mv: 2 },
    { identity: ["U"], commander: true, t: [1], mv: 2 },
    { identity: ["R"], t: [1], mv: 2 },
  ];
  const q = { produce: [], consume: [], colours: ["R"], types: ["creature"], subtypes: [], keywords: [], cardColours: [] } as EventQuery;
  test("only commanders survive, and the rest of the query still applies", () => {
    expect(evaluateEventQuery(mixed, vocab, q, "commanders", { commandersOnly: true })).toEqual({ ok: true, rows: [0] });
    expect(evaluateEventQuery(mixed, vocab, q, "cards", { commandersOnly: false })).toEqual({ ok: true, rows: [0, 1, 4] });
    expect(evaluateEventQuery(mixed, vocab, q, "cards", { commandersOnly: true })).toEqual({ ok: true, rows: [0] });
  });
  test("a row with no `commander` flag is not a commander", () => {
    expect(evaluateEventQuery([{ identity: [], t: [1] }], vocab, { ...q, colours: [] }, "commanders", { commandersOnly: true })).toEqual({ ok: true, rows: [] });
  });
});
