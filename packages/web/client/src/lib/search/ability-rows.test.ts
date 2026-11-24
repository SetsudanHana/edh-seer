import { describe, expect, test } from "vitest";
import { ABILITIES } from "./ability-rows.fixture.js";
import { abilityRecords, buildAbilityRows, decodeAbilityRows } from "./ability-rows.js";
import { evaluate, type EvalContext, type Node } from "./evaluate.js";
import { DEFAULT_DENY, type SearchRegistry } from "./registry.js";
import { walkRecords, type WalkRecord } from "./walk.js";

// Real abilities of five cards (see the fixture): Skullclamp is static + triggered-draw, so "static" and "draws" hold on
// DIFFERENT abilities; Phyrexian Arena's draw and its life loss are two triggered abilities.
const ROWS = ["Skullclamp", "Phyrexian Arena", "Sylvan Library", "Viscera Seer", "Mulldrifter"] as const;
const registry: SearchRegistry = {
  fields: {},
  groups: { abilities: ["tags.abilities"] },
  namedLists: {},
  deny: [...DEFAULT_DENY, "tags.abilities.amount", "tags.abilities.cost", "*.clause", "tags.abilities.effect.subject.token"],
  abilityPrefixes: ["tags.abilities"],
};
const KIND = "tags.abilities.kind";
const VERB = "tags.abilities.emits.verb";
const records: WalkRecord[] = [
  ...ROWS.map((name, row): WalkRecord => ({ row, card: { name }, tags: { abilities: ABILITIES[name] } })),
  { row: 5, card: { name: "No abilities" }, tags: { abilities: [] } },
  { row: 6, card: { name: "Not read" }, tags: null },
];
const names = (rows: readonly number[]): string[] => rows.map((r) => (records[r]!.card as { name: string }).name);

function context(): EvalContext {
  const walk = walkRecords(records, registry);
  const built = buildAbilityRows(records, registry, walk.columns, [6]);
  // through the wire, as the page gets it
  const abilities = decodeAbilityRows(JSON.parse(JSON.stringify(built.payload)));
  return { rowCount: records.length, columns: walk.columns, namedLists: {}, abilities };
}
const has = (field: string, value: string): Node => ({ field, op: "has", value });
const ask = (node: Node) => {
  const r = evaluate(node, context());
  if (!r.ok) throw new Error(r.cannotAnswer.join("; "));
  return names(r.rows);
};

describe("ability( … ): every term on the SAME ability", () => {
  test("static AND draws: Skullclamp has both, on different abilities, so only the card-level and matches it", () => {
    const both: Node[] = [has(KIND, "static"), has(VERB, "draw")];
    expect(ask({ and: both })).toStrictEqual(["Skullclamp"]);
    expect(ask({ ability: { and: both } })).toStrictEqual([]);
  });

  test("triggered AND draws: Phyrexian Arena, Sylvan Library and Mulldrifter hold both on one ability (Skullclamp too: its draw is triggered), so both asks match them", () => {
    const both: Node[] = [has(KIND, "triggered"), has(VERB, "draw")];
    const same = ["Skullclamp", "Phyrexian Arena", "Sylvan Library", "Mulldrifter"];
    expect(ask({ and: both })).toStrictEqual(same);
    expect(ask({ ability: { and: both } })).toStrictEqual(same);
  });

  test("draws AND loses life on one ability: Phyrexian Arena has each on its own ability, so it is out; the card-level and has it", () => {
    const both: Node[] = [has(VERB, "draw"), has(VERB, "lose-life")];
    expect(ask({ and: both })).toStrictEqual(["Phyrexian Arena", "Sylvan Library"]);
    expect(ask({ ability: { and: both } })).toStrictEqual([]);
  });

  test("or, not and a count work over ability rows; a not inside asks for SOME ability that is not it", () => {
    expect(ask({ ability: { or: [has(VERB, "scry"), has(VERB, "lose-life")] } })).toStrictEqual(["Phyrexian Arena", "Sylvan Library", "Viscera Seer"]);
    expect(ask({ ability: { and: [has(KIND, "activated"), { not: has(VERB, "scry") }] } })).toStrictEqual(["Viscera Seer"]);
    expect(ask({ ability: { not: has(KIND, "triggered") } })).toStrictEqual(["Skullclamp", "Viscera Seer"]);
    expect(ask({ not: { ability: has(KIND, "triggered") } })).toStrictEqual(["Viscera Seer", "No abilities"]); // "Not read" (no tags) cannot say it has no such ability
  });

  test("a card with no abilities, or no reading, is in no ability( ) answer", () => {
    expect(ask({ ability: { not: has(KIND, "nothing-like-this") } })).toStrictEqual(["Skullclamp", "Phyrexian Arena", "Sylvan Library", "Viscera Seer", "Mulldrifter"]);
  });
});

describe("what ability( … ) refuses to answer", () => {
  const refused = (node: Node, ctx: EvalContext = context()): string => {
    const r = evaluate(node, ctx);
    if (r.ok) throw new Error(`answered with ${r.rows.length} rows`);
    return r.cannotAnswer.join("; ");
  };
  test("a term that is no ability field is an error, not an empty list", () => {
    expect(refused({ ability: { and: [has(KIND, "static"), has("tags.clauseSource", "grammar")] } })).toBe("tags.clauseSource is not an ability field, so it cannot be inside ability( )");
  });
  test("an unknown field, a second ability( ) and caller rows are errors too", () => {
    expect(refused({ ability: has("tags.abilities.nope", "x") })).toContain("is not an ability field");
    expect(refused({ ability: { ability: has(KIND, "static") } })).toContain("ability( ) inside ability( )");
    expect(refused({ ability: { op: "rows", rows: [1] } })).toContain("rows that are not an ability's");
  });
  test("with the ability rows not loaded there is no answer", () => {
    const { abilities: _a, ...without } = context();
    expect(refused({ ability: has(KIND, "static") }, without)).toBe("the ability rows are not loaded");
  });
});

describe("the ability rows file", () => {
  test("ids run in card-row order: one row per ability, and each id maps back to its card", () => {
    const built = buildAbilityRows(records, registry, walkRecords(records, registry).columns);
    const rows = decodeAbilityRows(JSON.parse(JSON.stringify(built.payload)));
    const per = ROWS.map((n) => ABILITIES[n]!.length);
    expect(rows.count).toBe(per.reduce((a, b) => a + b, 0));
    expect([...rows.owner].slice(0, per[0]!)).toStrictEqual(Array(per[0]).fill(0));
    expect(rows.owner[rows.count - 1]).toBe(4);
    expect(abilityRecords(records).rows).toStrictEqual([0, 1, 2, 3, 4]);
  });

  test("records out of row order get the same ids", () => {
    const a = abilityRecords(records);
    const b = abilityRecords([...records].reverse());
    expect(b.rows).toStrictEqual(a.rows);
    expect(b.n).toStrictEqual(a.n);
  });

  test("a count column that does not fit its rows is refused, never half read", () => {
    const built = buildAbilityRows(records, registry, walkRecords(records, registry).columns);
    expect(() => decodeAbilityRows({ ...built.payload, n: built.payload.n.slice(1) })).toThrow(/does not match/);
  });

  test("only fields the card-level walk kept are here, so a dropped free-text path is not", () => {
    const walk = walkRecords(records, registry);
    const kept = new Map([...walk.columns].filter(([p]) => p !== VERB));
    const built = buildAbilityRows(records, registry, kept);
    expect(built.columns.has(VERB)).toBe(false);
    expect(built.columns.has(KIND)).toBe(true);
  });
});
