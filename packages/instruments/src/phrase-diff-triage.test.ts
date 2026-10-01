/** H3 FOR THE FILTER GRAMMAR (#896 task 2), AS A RATCHET. Every group of phrases on which the grammar
 *  and `parseSubject` disagree is labelled in `packages/tagger/grammar-triage.json`, and the set is
 *  pinned in both directions: a new group, a vanished one, a group that changed size, or a parsed
 *  count that moved all fail, so a change to either parser is re-triaged and banked there. A
 *  coverage rise has to be banked too — the same rule as the repo's other ratchets, where an
 *  improvement nobody recorded is indistinguishable from an accident. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parse } from "@edh-seer/tagger/grammar";
import { parseSubject } from "@edh-seer/tagger/subject";
import { diffParsers, readPhrases } from "./phrase-diff-core.js";

interface Triage { parsed: number; groups: Record<string, { distinct: number; label: string; rule: string; why: string }> }

const LABELS = new Set(["grammar right", "grammar wrong", "both wrong"]);
const triage = JSON.parse(readFileSync(new URL("../../tagger/grammar-triage.json", import.meta.url), "utf8")) as Triage;
const d = diffParsers(readPhrases(readFileSync(new URL("../../tagger/phrases.jsonl", import.meta.url), "utf8")), parse, parseSubject);

test("the grammar is deterministic over the whole census (H2)", () => {
  expect(d.nondeterministic).toEqual([]);
});

test("every disagreement group is labelled, at the size it was labelled at (H3)", () => {
  const seen = Object.fromEntries(d.groups.map((g) => [g.fields.join(","), g.distinct]));
  const banked = Object.fromEntries(Object.entries(triage.groups).map(([k, g]) => [k, g.distinct]));
  expect(seen).toEqual(banked);
  for (const [k, g] of Object.entries(triage.groups)) {
    expect(LABELS.has(g.label), k).toBe(true);
    expect(g.why.length, k).toBeGreaterThan(20);
  }
});

test("the parsed count is banked: it moves only with grammar-triage.json", () => {
  expect(d.parsed.distinct).toBe(triage.parsed);
});
