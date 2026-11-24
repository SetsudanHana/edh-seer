import { describe, expect, test } from "vitest";
import { eventsOf, fieldNames, fromNode, parse, print, shapeNode, toNode, type Query, type QuerySchema } from "./query.js";

const SCHEMA: QuerySchema = {
  fields: [
    { id: "t", kind: "set", values: ["creature", "land", "instant"] },
    { id: "st", kind: "set", values: ["borg", "elf", "human", "time lord"] },
    { id: "k", kind: "set" },
    { id: "id", kind: "set", values: ["W", "U", "B", "R", "G"] },
    { id: "mv", kind: "number" },
    { id: "pow", kind: "number" },
    { id: "tags.clauseSource", kind: "set", alias: "src", values: ["grammar", "model"] },
    { id: "cares", kind: "set", values: ["card-types", "weird \"one\" \\ (x)", "and", "-lead"] },
    { id: "dup1", kind: "set", alias: "shared" },
    { id: "dup2", kind: "set", alias: "shared" },
  ],
  lists: ["creature", "card"],
  events: {
    makes: new Set(["create-token|creature|-|t", "mill|-|-|-", "a,b|*|-|-"]),
    asks: new Set(["dies|creature|-|-"]),
  },
};
const ok = (text: string): Query | null => {
  const r = parse(text, SCHEMA);
  if (!r.ok) throw new Error(r.error.message);
  return r.ast;
};
const bad = (text: string) => {
  const r = parse(text, SCHEMA);
  if (r.ok) throw new Error(`expected an error for ${text}`);
  return r.error;
};

describe("parse", () => {
  test("the issue's example: not borg, and three or more creature types", () => {
    expect(ok("-st:borg #st@creature>=3")).toStrictEqual({
      and: [{ not: { field: "st", op: "has", value: "borg" } }, { field: "st", op: "countIn", list: "creature", min: 3 }],
    });
  });

  test("precedence: not binds tightest, then and (also implicit), then or", () => {
    const a = { field: "t", op: "has", value: "creature" };
    const b = { field: "st", op: "has", value: "elf" };
    const c = { field: "st", op: "has", value: "human" };
    expect(ok("t:creature or st:elf st:human")).toStrictEqual({ or: [a, { and: [b, c] }] });
    expect(ok("t:creature or st:elf and st:human")).toStrictEqual({ or: [a, { and: [b, c] }] });
    expect(ok("(t:creature or st:elf) st:human")).toStrictEqual({ and: [{ or: [a, b] }, c] });
    expect(ok("not t:creature st:elf")).toStrictEqual({ and: [{ not: a }, b] });
    expect(ok("-(t:creature or st:elf)")).toStrictEqual({ not: { or: [a, b] } });
  });

  test("bounds, ranges, colours, events and aliases", () => {
    expect(ok("mv<=3")).toStrictEqual({ field: "mv", op: "cmp", max: 3 });
    expect(ok("mv>=2")).toStrictEqual({ field: "mv", op: "cmp", min: 2 });
    expect(ok("mv=2..4")).toStrictEqual({ field: "mv", op: "cmp", min: 2, max: 4 });
    expect(ok("#t=1..2")).toStrictEqual({ field: "t", op: "count", min: 1, max: 2 });
    expect(ok("id<=WUG")).toStrictEqual({ field: "id", op: "within", value: ["W", "U", "G"] });
    expect(ok("id=C")).toStrictEqual({ field: "id", op: "exactly", value: [] });
    expect(ok("makes:mill|-|-|-")).toStrictEqual({ op: "event", side: "makes", key: "mill|-|-|-" });
    expect(ok("src:grammar")).toStrictEqual({ field: "tags.clauseSource", op: "has", value: "grammar" });
    expect(ok("tags.clauseSource:grammar")).toStrictEqual({ field: "tags.clauseSource", op: "has", value: "grammar" });
    expect(ok("st:\"time lord\"")).toStrictEqual({ field: "st", op: "has", value: "time lord" });
  });

  test("a value's case is read against the catalogue and stored as the catalogue spells it", () => {
    expect(ok("st:Elf")).toStrictEqual({ field: "st", op: "has", value: "elf" });
  });

  test("empty text asks nothing", () => {
    expect(parse("   ", SCHEMA)).toStrictEqual({ ok: true, ast: null, usesEvents: false });
  });

  test("reports whether it names an event (the page then needs the event lists)", () => {
    const r = parse("makes:mill|-|-|- or t:land", SCHEMA);
    expect(r.ok && r.usesEvents).toBe(true);
  });

  test("an event is not judged while the event lists are not loaded", () => {
    expect(parse("makes:anything", { ...SCHEMA, events: null }).ok).toBe(true);
  });
});

describe("errors name what is wrong and where, and never drop a term", () => {
  test.each([
    ["t:creature foo:x", "unknown field `foo` at 11", 11],
    ["st:bogus", "unknown value `bogus` for st at 3", 3],
    ["-st:borg bar", "unknown field `bar` at 9", 9],
    ["#st@nope>=1", "unknown list `nope` at 4", 4],
    ["makes:nothing", "unknown event `nothing` for makes at 6", 6],
    ["asks:mill|-|-|-", "unknown event `mill|-|-|-` for asks at 5", 5],
    ["(t:land", "the `(` at 0 is never closed", 0],
    ["t:land)", "an unexpected `)` at 6", 6],
    ["t:land or", "a term must follow `or` at 9", 9],
    ["- t:land", "`-` must touch the term it negates, at 0", 0],
    ["mv<3", "bounds are inclusive: write <= at 2", 2],
    ["mv:3", "`mv` is a number: write mv>=n, mv<=n or mv=n at 0", 0],
    ["#mv>=1", "`mv` is a number, so it has no count: write mv>=n, mv<=n or mv=n at 1", 1],
    ["mv=5..2", "the range 5..2 is empty, at 2", 6],
    ["t:\"open", "the quote at 2 is never closed", 2],
    ["t:", "a value is missing after `t:` at 2", 2],
    ["id<=WW", "`W` is repeated at 4", 4],
    ["id<=WX", "unknown value `X` for id at 4", 4],
    ["t", "`t` is a list of values: write t:value, #t>=n, t<=LETTERS or t=LETTERS at 0", 0],
    ["shared:x", "unknown field `shared` at 0", 0],
    ["makes", "`makes` is followed by `:` and an event key at 0", 0],
  ] as const)("%s", (text, message, pos) => {
    const e = bad(text);
    expect(e.message).toBe(message);
    expect(e.pos).toBe(pos);
  });
});

describe("print", () => {
  test("uses the alias, quotes what needs it, and keeps nested groups parenthesised", () => {
    const q: Query = { and: [
      { field: "tags.clauseSource", op: "has", value: "grammar" },
      { not: { or: [{ field: "st", op: "has", value: "time lord" }, { field: "mv", op: "cmp", min: 1, max: 1 }] } },
      { and: [{ field: "t", op: "has", value: "land" }, { field: "t", op: "has", value: "creature" }] },
    ] };
    expect(print(q, SCHEMA)).toBe("src:grammar -(st:\"time lord\" or mv=1) (t:land t:creature)");
  });
});

describe("parse(print(ast)) = ast", () => {
  // A seeded generator over the whole AST, not a fixed list: the same 600 queries every run.
  let seed = 20261123;
  const rnd = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const bounds = (): { min?: number; max?: number } => {
    const a = Math.floor(rnd() * 30);
    const b = a + Math.floor(rnd() * 5);
    return pick([{ min: a }, { max: a }, { min: a, max: a }, { min: a, max: b }, { min: 0, max: b }]);
  };
  const colours = (): string[] => ["W", "U", "B", "R", "G"].filter(() => rnd() < 0.4);
  const leaf = (): Query => {
    switch (Math.floor(rnd() * 8)) {
      case 0: return { field: "t", op: "has", value: pick(SCHEMA.fields[0]!.values!) };
      case 1: return { field: "st", op: "has", value: pick(SCHEMA.fields[1]!.values!) };
      case 2: return { field: "cares", op: "has", value: pick(SCHEMA.fields.find((f) => f.id === "cares")!.values!) };
      case 3: return { field: "st", op: "countIn", list: pick(SCHEMA.lists), ...bounds() };
      case 4: return { field: pick(["t", "tags.clauseSource", "k"]), op: "count", ...bounds() };
      case 5: return { field: pick(["mv", "pow"]), op: "cmp", ...bounds() };
      case 6: return { field: "id", op: pick(["within", "exactly"] as const), value: colours() };
      default: return pick([
        { op: "event", side: "makes", key: pick([...SCHEMA.events!.makes]) },
        { op: "event", side: "asks", key: pick([...SCHEMA.events!.asks]) },
      ] as const);
    }
  };
  const gen = (depth: number): Query => {
    if (depth === 0 || rnd() < 0.3) return leaf();
    const n = 2 + Math.floor(rnd() * 2);
    switch (Math.floor(rnd() * 3)) {
      case 0: return { and: Array.from({ length: n }, () => gen(depth - 1)) };
      case 1: return { or: Array.from({ length: n }, () => gen(depth - 1)) };
      default: return { not: gen(depth - 1) };
    }
  };

  test("600 generated queries survive print then parse, deep-equal", () => {
    for (let i = 0; i < 600; i++) {
      const ast = gen(4);
      const text = print(ast, SCHEMA);
      const back = parse(text, SCHEMA);
      expect(back.ok, text).toBe(true);
      expect(back.ok && back.ast, text).toStrictEqual(ast);
      // and printing again is a fixed point: the text is canonical
      expect(print((back as { ast: Query }).ast, SCHEMA), text).toBe(text);
    }
  });
});

describe("reading a parsed query", () => {
  test("events are listed once, and a query with an event the caller has no rows for is not a tree", () => {
    const q = ok("makes:mill|-|-|- (makes:mill|-|-|- or asks:dies|creature|-|-)")!;
    expect(eventsOf(q)).toStrictEqual([{ side: "makes", key: "mill|-|-|-" }, { side: "asks", key: "dies|creature|-|-" }]);
    expect(toNode(q, () => undefined)).toBeNull();
    expect(toNode(ok("makes:mill|-|-|-")!, () => [1, 2])).toStrictEqual({ op: "rows", rows: [1, 2] });
    expect(shapeNode(q)).toBeDefined();
  });

  test("an evaluator tree prints; one holding caller rows has no words", () => {
    expect(print(fromNode({ and: [{ field: "t", op: "has", value: "land" }] })!, SCHEMA)).toBe("t:land");
    expect(fromNode({ and: [{ op: "rows", rows: [1] }] })).toBeNull();
  });

  test("field names a player can type leave out ambiguous aliases", () => {
    const names = fieldNames(SCHEMA).map((f) => f.name);
    expect(names).toContain("src");
    expect(names).not.toContain("shared");
    expect(names).toContain("dup1");
  });
});
