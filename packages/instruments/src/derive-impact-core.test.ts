import { describe, expect, it } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import {
  CONSTANT_FIELDS, FIELD_KIND, formatRatchets, ratchetReport, chooseMatcher, classifyRows, compareRow, diffReasons, fieldDiff, formatSummary, grammarReport, instrumentFor, nodeModulesHash, NOT_MEASURED, sampleCoverage, splitMatcherCode,
  pairsReport, pick, sampleIds, snapOf, tagFamily, treeVerdict, type ImpactReport, type RowSnap,
} from "./derive-impact-core.js";

const row = (name: string, tags: Record<string, unknown>, g = false): RowSnap => snapOf(name, tags, g);

describe("fieldDiff", () => {
  it("lists entries removed and added per field, set-based", () => {
    const a = JSON.stringify({ abilities: [{ v: 1 }, { v: 2 }], unknownTriggers: ["x"] });
    const b = JSON.stringify({ abilities: [{ v: 2 }, { v: 3 }], unknownTriggers: ["x"] });
    expect(fieldDiff(a, b)).toEqual({ abilities: { removed: ['{"v":1}'], added: ['{"v":3}'] } });
  });
  it("reads an object field per key", () => {
    const d = fieldDiff(JSON.stringify({ characteristics: { colors: ["R"], token: false } }), JSON.stringify({ characteristics: { colors: ["U"], token: false } }));
    expect(d.characteristics).toEqual({ removed: ['colors: ["R"]'], added: ['colors: ["U"]'] });
  });
  it("diffs multisets: a deduped duplicate is a removal, even beside another change", () => {
    expect(fieldDiff('{"abilities":["X","X"]}'.replace(/"X"/g, '{"v":1}'), '{"abilities":[{"v":1}]}')).toEqual({ abilities: { removed: ['{"v":1}'], added: [] } });
    const d = fieldDiff('{"abilities":[1,1,2]}', '{"abilities":[1,3]}');
    expect(d.abilities).toEqual({ removed: ["1", "2"], added: ["3"] });
    expect(fieldDiff('{"abilities":[1]}', '{"abilities":[1,1,1]}').abilities).toEqual({ removed: [], added: ["1", "1"] });
  });
  it("keeps a pure reorder visible", () => {
    const d = fieldDiff(JSON.stringify({ abilities: [1, 2] }), JSON.stringify({ abilities: [2, 1] }));
    expect(Object.keys(d)).toEqual(["abilities"]);
  });
  it("is empty for identical input", () => { expect(fieldDiff('{"abilities":[1]}', '{"abilities":[1]}')).toEqual({}); });
});

describe("compareRow / classifyRows", () => {
  it("separates same, changed, added, removed and a source flip with identical tags", () => {
    const base = new Map<string, RowSnap>([
      ["a", row("A", { abilities: [1] })], ["b", row("B", { abilities: [1] })], ["c", row("C", { abilities: [1] }, false)],
      ["d", row("D", { abilities: [1] })], ["e", row("E", { abilities: [1] }, false)],
    ]);
    const head = new Map<string, RowSnap>([
      ["a", row("A", { abilities: [1] })], ["b", row("B", { abilities: [2] })], ["c", row("C", { abilities: [1] }, true)],
      ["e", row("E", { abilities: [9] }, true)], ["f", row("F", { abilities: [] })],
    ]);
    const { totals, changes } = classifyRows(base, head);
    expect(totals).toEqual({ same: 1, changed: 2, added: 1, removed: 1, sourceFlipped: 2, sourceFlippedIdenticalTags: 1 });
    expect(changes.map((c) => `${c.name}:${c.status}`)).toEqual(["B:changed", "C:flip-only", "D:removed", "E:changed", "F:added"]);
    expect(changes.find((c) => c.name === "E")).toMatchObject({ sourceBefore: "model", sourceAfter: "grammar", fields: { abilities: { removed: ["1"], added: ["9"] } } });
  });
  it("a missing row on both sides is not a change", () => { expect(compareRow("x", undefined, undefined).status).toBe("same"); });
});

describe("grammarReport", () => {
  const e = (name: string, b: [boolean, string], h: [boolean, string]) => ({ id: name, name, base: { complete: b[0], records: b[1] }, head: { complete: h[0], records: h[1] } });
  it("counts the totals and lists flips and record changes", () => {
    const r = grammarReport([e("Stay", [true, "r"], [true, "r"]), e("Gain", [false, ""], [true, "r"]), e("Lose", [true, "r"], [false, ""]), e("Edit", [true, "r1"], [true, "r2"]), e("Never", [false, "x"], [false, "y"])]);
    expect(r).toEqual({ completeBase: 3, completeHead: 3, gained: ["Gain"], lost: ["Lose"], recordsChanged: ["Edit"] });
  });
});

describe("derived row fields", () => {
  it("compares every key of a real derived row that is not a known constant", () => {
    const card = { name: "Test Blast", typeLine: "Sorcery", oracleText: "Create two tapped 2/2 black Zombie creature tokens.", keywords: [] as string[] };
    const g = grammarClauseRecords(card);
    const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records, undefined, g.readings));
    // Every key the row carries has been classified: a new CardTags field fails the typecheck of FIELD_KIND, and any key outside it fails here.
    for (const k of Object.keys(tags)) expect(Object.keys(FIELD_KIND), `unclassified field ${k}`).toContain(k);
    const compared = Object.keys(pick(tags as never));
    expect(compared.length).toBeGreaterThan(0);
    for (const k of CONSTANT_FIELDS) expect(compared).not.toContain(k);
    for (const k of compared) expect(FIELD_KIND[k as keyof typeof FIELD_KIND]).toBe("compared");
  });
  it("pick compares an unknown key too", () => { expect(Object.keys(pick({ oracleId: "x", brandNew: 1, abilities: [] }))).toEqual(["abilities", "brandNew"]); });
});

describe("diffReasons", () => {
  const r = (extra: Record<string, unknown> = {}) => ({ tag: "attacks:x", producer: "P", consumer: "C", magnitude: { floor: 1 }, ...extra });
  it("separates membership from magnitude-only and attribute-only moves", () => {
    const base = [r(), r({ consumer: "D" }), r({ producer: "Q", repeatability: "static" }), r({ producer: "M", magnitude: { floor: 0 } })];
    const head = [r(), r({ consumer: "E" }), r({ producer: "Q", repeatability: "triggered", perTurn: true }), r({ producer: "M", magnitude: { floor: 2 } })];
    const d = diffReasons(base, head);
    expect(d.gained).toEqual(["attacks:x|P|E"]);
    expect(d.lost).toEqual(["attacks:x|P|D"]);
    expect(d.magnitude).toEqual([{ key: "attacks:x|M|C", before: ['{"floor":0}'], after: ['{"floor":2}'] }]);
    expect(d.attrs).toEqual([{ key: "attacks:x|Q|C", fields: ["perTurn", "repeatability"] }]);
  });
  it("is empty for identical reasons, and ignores the reason text", () => {
    expect(diffReasons([r({ text: "a" })], [r({ text: "b" })])).toEqual({ gained: [], lost: [], magnitude: [], attrs: [] });
  });
  it("takes the family before the first colon", () => { expect(tagFamily("attacks:creature|P|C")).toBe("attacks"); expect(tagFamily("combo|P|C")).toBe("combo"); });
});

describe("matcher selection, sample, cache", () => {
  it("defaults to each side's own matcher; head is explicit; anything else throws", () => {
    expect(chooseMatcher(undefined)).toBe("own");
    expect(chooseMatcher("own")).toBe("own");
    expect(chooseMatcher("head")).toBe("head");
    expect(() => chooseMatcher("auto")).toThrow(/own or head/);
  });
  it("splits changed files into on-path (reachable) and off-path with their instrument; tests, fixtures and tables are neither", () => {
    const reachable = new Set(["packages/matcher/src/edges.ts", "packages/tagger/src/derive/subject.ts", "packages/matcher/rules.json"]);
    const r = splitMatcherCode([
      "packages/matcher/src/edges.ts", "packages/matcher/src/edges.test.ts", "packages/matcher/src/same-job.fixtures.json", "packages/matcher/rules.json",
      "packages/matcher/quality-weights.json", "packages/matcher/src/similar.ts", "packages/matcher/src/redundancy.ts", "packages/matcher/src/bin/build-static-core.ts",
      "packages/matcher/src/bin/build-static.ts", "packages/matcher/src/bin/cs-categories.ts", "packages/matcher/src/card-strength.ts", "packages/tagger/src/derive/subject.ts", "packages/tagger/src/derive/derive.ts", "docs/x.md",
    ], reachable);
    expect(r.onPath).toEqual(["packages/matcher/rules.json", "packages/matcher/src/edges.ts", "packages/tagger/src/derive/subject.ts"]);
    expect(r.offPath).toEqual([
      { file: "packages/matcher/src/bin/build-static-core.ts", instrument: "research/matcher/static-parity.ts (+ the static-out snapshot)" },
      { file: "packages/matcher/src/bin/build-static.ts", instrument: "research/matcher/static-parity.ts (+ the static-out snapshot)" },
      { file: "packages/matcher/src/card-strength.ts", instrument: "none in this report" },
      { file: "packages/matcher/src/redundancy.ts", instrument: "research/matcher/similar-census.ts" },
      { file: "packages/matcher/src/similar.ts", instrument: "research/matcher/similar-census.ts" },
    ]);
    expect(instrumentFor("packages/matcher/src/similar-shard.ts")).toBe("research/matcher/similar-census.ts");
  });
  it("states what a sample can and cannot see", () => {
    const c = sampleCoverage(150, 32270);
    expect(c).toContain("sample of 150 of 32,270 cards (0.46%)");
    expect(c).toContain("a move touching 1 card is missed 100%");
    expect(c).toContain("100 cards 63%");
    expect(c).toContain("fewer than ~643 cards touched is likely (>5%) missed");
    expect(sampleCoverage(0, 10)).toBe("no sample");
  });
  it("samples a stable, seeded subset", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `id${i}`);
    const a = sampleIds(ids, 10), b = sampleIds([...ids].reverse(), 10);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(10);
    expect(a.every((x) => ids.includes(x))).toBe(true);
    expect(sampleIds(ids, 1000)).toHaveLength(100);
    expect(sampleIds(ids, 10, "other")).not.toEqual(a);
  });
  it("accepts only a real directory owned by the caller and not writable by others", () => {
    const ok = { isDirectory: true, isSymbolicLink: false, uid: 501, mode: 0o40700 };
    expect(treeVerdict(ok, 501)).toBe("ok");
    expect(treeVerdict({ ...ok, isSymbolicLink: true }, 501)).toMatch(/symlink/);
    expect(treeVerdict({ ...ok, isDirectory: false }, 501)).toMatch(/not a directory/);
    expect(treeVerdict({ ...ok, uid: 0 }, 501)).toMatch(/owned by uid 0/);
    expect(treeVerdict({ ...ok, mode: 0o40770 }, 501)).toMatch(/group or others/);
    expect(treeVerdict({ ...ok, mode: 0o40757 }, 501)).toMatch(/group or others/);
  });
  it("fingerprints the node_modules listing regardless of order", () => {
    expect(nodeModulesHash(["a", "b"])).toBe(nodeModulesHash(["b", "a"]));
    expect(nodeModulesHash(["a", "b"])).not.toBe(nodeModulesHash(["a", "c"]));
  });
});

describe("pairsReport", () => {
  const none = { magnitude: [], attrs: [] };
  it("groups by family, ranks cards and names the other card of each moved key", () => {
    const p = pairsReport([
      { id: "1", name: "One", gained: ["attacks:a|X|Y"], lost: ["prevented|S|Z"], ...none },
      { id: "2", name: "Two", gained: [], lost: ["prevented|S|Z", "prevented|S|W", "prevented|S|V"], ...none },
      { id: "3", name: "Three", gained: [], lost: [], ...none },
    ]);
    expect(p).toMatchObject({ gained: 1, lost: 4, magnitude: 0, attrs: 0 });
    expect(p.families).toEqual([{ family: "prevented", gained: 0, lost: 4 }, { family: "attacks", gained: 1, lost: 0 }]);
    expect(p.top.map((c) => c.name)).toEqual(["Two", "One"]);
    expect(p.byCounterpart[0]).toEqual({ name: "S", gained: 0, lost: 4 });
  });
  it("counts magnitude-only and attribute moves apart, with the fields", () => {
    const p = pairsReport([{ id: "1", name: "One", gained: [], lost: [], magnitude: [{ key: "t|A|B", before: ["1"], after: ["2"] }], attrs: [{ key: "t|A|C", fields: ["perTurn", "scaling"] }] }]);
    expect(p).toMatchObject({ gained: 0, lost: 0, magnitude: 1, attrs: 1 });
    expect(p.attrFields).toEqual([{ field: "perTurn", count: 1 }, { field: "scaling", count: 1 }]);
    expect(p.top).toEqual([{ name: "One", gained: 0, lost: 0, magnitude: 1, attrs: 1 }]);
  });
  it("caps the top list", () => {
    const cards = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `C${i}`, gained: ["t|a|b"], lost: [], ...none }));
    expect(pairsReport(cards).top).toHaveLength(20);
  });
});

describe("formatSummary", () => {
  const sec = (over = {}) => ({ cards: 2, gained: 5, lost: 7, magnitude: 3, attrs: 1, attrFields: [{ field: "perTurn", count: 1 }], families: [{ family: "prevented", gained: 0, lost: 7 }], top: [], byCounterpart: [], skipped: ["Tokeny (no maker)"], ...over });
  const report: ImpactReport = {
    base: { ref: "abc1234", sha: "abc12345", deriveVersion: 405 }, head: { ref: "HEAD", sha: "def67890", deriveVersion: 406, dirty: true }, matcher: "own", matcherCode: ["packages/matcher/src/edges.ts"],
    matcherOffPath: [{ file: "packages/matcher/src/similar.ts", instrument: "research/matcher/similar-census.ts" }], samplePopulation: 32270,
    rows: { totals: { same: 100, changed: 2, added: 0, removed: 0, sourceFlipped: 1, sourceFlippedIdenticalTags: 1 }, changes: [
      { id: "1", name: "Alpha", status: "changed", fields: { abilities: { removed: ["x"], added: [] } } }, { id: "2", name: "Beta", status: "changed", fields: { abilities: { removed: ["x"], added: ["y", "z"] } } }, { id: "3", name: "Gamma", status: "flip-only", fields: {} },
    ] },
    grammar: { completeBase: 28417, completeHead: 28423, gained: ["a"], lost: [], recordsChanged: ["b", "c"] },
    pairs: sec(), sample: sec({ cards: 150, gained: 9 }), tokens: { docs: 1096, withRow: 527, nodesBase: 530, nodesHead: 531 },
    ratchets: ratchetReport({ dropped: { A: ["1:tap"], B: ["2:cant", "3:cant"] }, roles: { A: ["role:ramp"] }, untagged: ["U1"] }, { dropped: { A: ["1:tap"], B: ["2:cant"] }, roles: { A: ["role:ramp", "role:draw"] }, untagged: ["U1", "U2"] }, { dropped: { A: ["1:tap"], B: ["2:cant", "3:cant"] }, roles: { A: ["role:ramp"] }, untagged: ["U1"] }),
  };
  it("is one paste-ready block with versions, dirty flag, counts and the open ends", () => {
    const s = formatSummary(report);
    expect(s).toContain("derive-impact abc12345 (DERIVE_VERSION 405) -> def67890 working tree (dirty) (DERIVE_VERSION 406)");
    expect(s).toContain("2 changed");
    expect(s).toContain("source flips 1 (1 with identical tags)");
    expect(s).toContain("top changed: Beta; Alpha");
    expect(s).not.toContain("Gamma");
    expect(s).toContain("28,417 -> 28,423");
    expect(s).toContain("membership +5 gained, -7 lost; magnitude-only 3; attributes changed 1 [perTurn x1]");
    expect(s).toContain("MATCHER CODE DIFFERS on the pair/role path (1 file(s): packages/matcher/src/edges.ts): pair reasons below cover changed rows only; matcher-only effects are measured on the sample");
    expect(s).toContain("changed but NOT on the pair/role path, not measured here: packages/matcher/src/similar.ts (instrument: research/matcher/similar-census.ts)");
    expect(s).toContain("matcher-only coverage: sample of 150 of 32,270 cards");
    for (const x of NOT_MEASURED) expect(s).toContain(x);
    expect(s).toContain("matcher sample, seeded (150 cards)");
    expect(s).toContain("not paired (1): Tokeny (no maker)");
    expect(s).toContain("role-ratchet gained 1, lost 0 (1 -> 2 memberships); gained: A +role:draw; against the banked snapshot: gained 1, lost 0; untagged 1 -> 2 (newly 1: U2, tagged now 0), against the banked list 1 new / 0 tagged now");
    expect(s).toContain("dropped-clauses 3 -> 2 (new 0, fixed 1: B -3:cant); against the banked snapshot: new 0, fixed 1");
    expect(s).toContain("tokens: 1,096 token docs, 527 with a derived row and 569 synthesized as the engine does; token nodes the cards create: BASE 530, HEAD 531");
    expect(s).toContain("token-vs-token pairs are not covered");
    expect(s).toContain("pair options: deck-specific landTypes / enterWatchers / revenantToughness are off");
  });
  it("says ratchets were not run when they were not", () => { expect(formatSummary({ ...report, ratchets: undefined })).toContain("ratchets: not run"); });
  it("reports zeros as zeros", () => {
    const z = { dropped: { A: ["1:tap"] }, roles: { A: ["role:ramp"] }, untagged: ["U1"] };
    expect(formatRatchets(ratchetReport(z, z, z))).toEqual([
      "role-ratchet gained 0, lost 0 (1 -> 1 memberships); against the banked snapshot: gained 0, lost 0; untagged 1 -> 1, against the banked list 0 new / 0 tagged now",
      "dropped-clauses 1 -> 1 (new 0, fixed 0); against the banked snapshot: new 0, fixed 0",
    ]);
  });
  it("is silent about the matcher when its code is the same, and says so when pairs did not run", () => {
    const s = formatSummary({ ...report, matcherCode: [], matcherOffPath: [], pairs: undefined, sample: undefined, head: { ...report.head, dirty: false } });
    expect(s).not.toContain("MATCHER CODE DIFFERS");
    expect(s).toContain("pair reasons: not run");
    expect(s).toContain("def67890 working tree (DERIVE_VERSION");
  });
});
