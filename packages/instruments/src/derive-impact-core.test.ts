import { describe, expect, it } from "vitest";
import {
  classifyRows, compareRow, diffReasonKeys, fieldDiff, formatSummary, grammarReport, pairsReport, reasonKey, snapOf, tagFamily,
  type ImpactReport, type RowSnap,
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

describe("reason keys", () => {
  it("keys by tag|producer|consumer|magnitude", () => {
    expect(reasonKey({ tag: "attacks:x", producer: "P", consumer: "C", magnitude: { n: 1 } })).toBe('attacks:x|P|C|{"n":1}');
    expect(reasonKey({ tag: "t" })).toBe("t|||null");
  });
  it("diffs gained and lost", () => { expect(diffReasonKeys(["a", "b"], ["b", "c"])).toEqual({ gained: ["c"], lost: ["a"] }); });
  it("takes the family before the first colon", () => { expect(tagFamily("attacks:creature|P|C|null")).toBe("attacks"); expect(tagFamily("combo|P|C|null")).toBe("combo"); });
});

describe("pairsReport", () => {
  it("groups by family, ranks cards and counts a key moved on many cards", () => {
    const p = pairsReport([
      { id: "1", name: "One", gained: ["attacks:a|X|Y|null"], lost: ["prevented|S|Z|null"] },
      { id: "2", name: "Two", gained: [], lost: ["prevented|S|Z|null", "prevented|S|W|null", "prevented|S|V|null"] },
      { id: "3", name: "Three", gained: [], lost: [] },
    ]);
    expect(p).toMatchObject({ gained: 1, lost: 4 });
    expect(p.families).toEqual([{ family: "prevented", gained: 0, lost: 4 }, { family: "attacks", gained: 1, lost: 0 }]);
    expect(p.top).toEqual([{ name: "Two", gained: 0, lost: 3 }, { name: "One", gained: 1, lost: 1 }]);
    expect(p.byCounterpart[0]).toEqual({ name: "S", gained: 0, lost: 4 });
  });
  it("caps the top list", () => {
    const cards = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `C${i}`, gained: ["t|a|b|null"], lost: [] }));
    expect(pairsReport(cards).top).toHaveLength(20);
  });
});

describe("formatSummary", () => {
  const report: ImpactReport = {
    base: "abc1234", head: "working tree", matcher: "own",
    rows: { totals: { same: 100, changed: 2, added: 0, removed: 0, sourceFlipped: 1, sourceFlippedIdenticalTags: 1 }, changes: [
      { id: "1", name: "Alpha", status: "changed", fields: { abilities: { removed: ["x"], added: [] } } }, { id: "2", name: "Beta", status: "changed", fields: { abilities: { removed: ["x"], added: ["y", "z"] } } }, { id: "3", name: "Gamma", status: "flip-only", fields: {} },
    ] },
    grammar: { completeBase: 28417, completeHead: 28423, gained: ["a"], lost: [], recordsChanged: ["b", "c"] },
    pairs: { cards: 2, gained: 5, lost: 7, families: [{ family: "prevented", gained: 0, lost: 7 }], top: [], byCounterpart: [] },
  };
  it("is one paste-ready block with the counts", () => {
    const s = formatSummary(report);
    expect(s).toContain("derive-impact abc1234 -> working tree");
    expect(s).toContain("2 changed");
    expect(s).toContain("source flips 1 (1 with identical tags)");
    expect(s).toContain("top changed: Beta; Alpha");
    expect(s).not.toContain("Gamma");
    expect(s).toContain("28,417 -> 28,423");
    expect(s).toContain("+5 gained, -7 lost");
    expect(s).toContain("each side's own matcher");
  });
  it("says so when pairs did not run", () => { expect(formatSummary({ ...report, pairs: undefined })).toContain("pair reasons: not run"); });
});
