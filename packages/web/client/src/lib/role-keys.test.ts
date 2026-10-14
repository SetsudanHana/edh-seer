import { expect, test } from "vitest";
import { ROLE_PARENTS } from "@edh-seer/matcher/role-parents";
import { SAMPLE } from "../fixtures.js";
import type { DeckReport } from "../types.js";
import { findings, slotTrade } from "./findings.js";
import { headerGaps, shortRoles, verdict } from "./verdict.js";
import { offThemeSplit } from "./off-theme.js";
import { slackLeaves } from "./role-group.js";
import { diffRuns } from "./run-diff.js";
import { suggestionsFor } from "./suggestions.js";
import type { DeckSuggestions } from "@edh-seer/matcher/suggest-static";

/** #1194: a role parent is SELECTED by `key` in every web reader; its name is display text only. Every
 *  parent's name is renamed here (as #1086 renamed "Consistency" to "Card advantage"), as the engine
 *  would carry it: in `buildParents`, in `slack`, and in the suggestion sentences that start with it. */
const RENAME = (n: string): string => `Renamed ${n}`;

function renamed(report: DeckReport): DeckReport {
  const names = new Map(ROLE_PARENTS.map((p) => [p.name, RENAME(p.name)]));
  return {
    ...report,
    buildParents: report.buildParents?.map((p) => ({ ...p, name: names.get(p.name) ?? p.name })),
    slack: report.slack?.map((s) => ({ ...s, category: names.get(s.category) ?? s.category })),
    // The engine writes the new name into its sentences; the key is what addresses them.
    suggestions: report.suggestions?.map((s) => [...names].reduce((t, [from, to]) => (t.startsWith(`${from} `) ? to + t.slice(from.length) : t), s)),
    suggestionByKey: Object.fromEntries(Object.entries(report.suggestionByKey ?? {}).map(([k, s]) => [k, [...names].reduce((t, [from, to]) => (t.startsWith(`${from} `) ? to + t.slice(from.length) : t), s)])),
  };
}

const slack = [{ category: "Ramp", key: "ramp", count: 17, target: 10, over: 7 }];
const withSlack = (): DeckReport => ({
  ...SAMPLE.report,
  buildParents: SAMPLE.report.buildParents!.map((p) => p.key === "ramp" ? { ...p, count: 17 } : p),
  slack,
  cards: [
    { name: "Sol Ring", roles: ["ramp"] },
    { name: "Plain Card", roles: [] },
  ] as unknown as DeckReport["cards"],
});

test("the fixture's own parents are exactly ROLE_PARENTS, so the rename covers every one", () => {
  expect(SAMPLE.report.buildParents!.map((p) => p.key).sort()).toEqual(ROLE_PARENTS.map((p) => p.key).sort());
});

test("the verdict's and the header's gaps find their parents after every name is renamed", () => {
  const was = shortRoles(SAMPLE.report);
  expect(was.length).toBeGreaterThan(0);
  const now = shortRoles(renamed(SAMPLE.report));
  // Same roles, words and figures; only the shelf heading (display text) follows the rename.
  expect(now.map(({ shelfWord, ...r }) => r)).toEqual(was.map(({ shelfWord, ...r }) => r));
  expect(headerGaps(renamed(SAMPLE.report)).map((g) => [g.word, g.count, g.target])).toEqual(headerGaps(SAMPLE.report).map((g) => [g.word, g.count, g.target]));
  expect(verdict(renamed(SAMPLE.report))).toBe(verdict(SAMPLE.report));
  expect(now.every((g) => !Number.isNaN(g.target))).toBe(true);
});

test("build finding ids are the parent's key, whatever its name", () => {
  const ids = findings(SAMPLE.report).filter((f) => f.kind === "build").map((f) => f.id).sort();
  expect(ids).toEqual(["build:boardWipes", "build:interaction", "build:ramp"]);
  expect(findings(renamed(SAMPLE.report)).filter((f) => f.kind === "build").map((f) => f.id).sort()).toEqual(ids);
});

test("the slot trade and the donor sentence follow the key, not the name", () => {
  const r = renamed(withSlack());
  expect(slotTrade(r, findings(r))).toContain("sits at 17 against a target of 10");
  const was = findings(withSlack()).map((f) => [f.id, f.action?.replace(/Ramp/g, "R")]);
  const now = findings(r).map((f) => [f.id, f.action?.replace(/Renamed Ramp/g, "R")]);
  expect(now).toEqual(was);
});

test("off-theme cuts treat a surplus parent's leaves as spare after a rename", () => {
  const was = offThemeSplit(["Sol Ring", "Plain Card"], withSlack());
  expect(was).toEqual({ free: ["Sol Ring", "Plain Card"], held: [] });
  expect(offThemeSplit(["Sol Ring", "Plain Card"], renamed(withSlack()))).toEqual(was);
  // A slack row naming the OLD display text beside parents carrying the new one (a report built across a rename).
  const skew = { ...withSlack(), buildParents: renamed(withSlack()).buildParents };
  expect(offThemeSplit(["Sol Ring", "Plain Card"], skew)).toEqual(was);
});

test("a surplus group's leaves (the chapter's cards) resolve by key after a rename", () => {
  const r = renamed(withSlack());
  expect(slackLeaves(r, r.slack![0]!)).toEqual(["ramp"]);
});

test("a run snapshot saved with name-keyed finding ids still diffs against key-keyed ones", () => {
  const base = { cards: ["a", "b", "c", "d"], categories: {} };
  const prev = { ...base, findings: { "build:Ramp": "Ramp 6/10" } };
  const next = { ...base, findings: { "build:ramp": "Ramp 6/10" } };
  expect(diffRuns(prev, next)).toBeNull();
});

test("the engine's suggestion sentence and the suggested cards attach to each short parent by key after a rename", () => {
  const was = findings(SAMPLE.report).filter((f) => f.kind === "build");
  // The "No board wipe (target N)" sentence is not "<name> n/t - add": it used to match no prefix.
  expect(was.filter((f) => f.action).map((f) => f.id).sort()).toEqual(["build:boardWipes", "build:interaction", "build:ramp"]);
  const r = renamed(SAMPLE.report);
  // Sentences that no longer start with any parent's name: only the key can find them.
  r.suggestions = r.suggestions!.map((s) => s.replace(/^[A-Za-z ]+(?= \d| \(target)/, "Elsewhere"));
  const now = findings(r).filter((f) => f.kind === "build");
  expect(now.map((f) => [f.id, f.action])).toEqual(was.map((f) => [f.id, f.action]));
  const card = { name: "Sol Ring" } as DeckSuggestions["build"][string][number];
  const sug = { build: { ramp: [card], interaction: [], boardWipes: [] }, answers: {}, synergy: {}, plan: [], pairs: [], routes: [] } as unknown as DeckSuggestions;
  for (const f of now) expect(suggestionsFor(f, sug, r), f.id).toEqual(f.id === "build:ramp" ? [card] : []);
});
