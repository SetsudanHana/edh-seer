import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parse } from "@edh-seer/tagger/grammar";
import { parseSubject } from "@edh-seer/tagger/subject";
import { diffTriggers, readingDiff, readTriggers, storedReading, type TriggerRow } from "./trigger-diff-core.js";

const subjectOf = (t: string) => parse(t) ?? parseSubject(t);
const row = (preamble: string, event: string, subject: string, control = "you", cards = 1, condition: string | null = null): TriggerRow =>
  ({ preamble, condition, event, subject, control, cards });

test("the stored trigger is the baseline: its event, its control (opponent spelled opp), its subject as derive reads it", () => {
  const r = storedReading(row("Whenever a creature an opponent controls dies", "dies", "a creature an opponent controls", "opponent"), subjectOf);
  expect(r).toMatchObject({ event: "dies", control: "opp", subject: { type: "creature", control: "opp" } });
});

test("coverage, agreement and disagreements grouped by the fields that differ, weighted by cards", () => {
  const rows = [
    row("When this creature enters", "enters", "this creature", "you", 10),
    row("Whenever you cast a noncreature spell", "cast", "a noncreature spell", "you", 4),
    row("Whenever a creature dies", "other", "a creature", "any", 3),
    row("When ~ unlocks", "unlocked", "~", "you", 2),
  ];
  // A toy candidate: reads "dies" where the store wrote "other", refuses the Room.
  const d = diffTriggers(rows, (p) => {
    if (/unlocks/.test(p)) return null;
    const base = storedReading(rows.find((r) => r.preamble === p)!, subjectOf);
    return /dies/.test(p) ? { ...base, event: "dies" } : base;
  }, subjectOf);
  expect(d.total).toEqual({ distinct: 4, cards: 19 });
  expect(d.parsed).toEqual({ distinct: 3, cards: 17 });
  expect(d.agree).toEqual({ distinct: 2, cards: 14 });
  expect(d.groups.map((g) => [g.fields.join(","), g.cards])).toEqual([["event", 3]]);
  expect(d.nondeterministic).toEqual([]);
});

test("a condition the baseline drops is a difference of its own; the subject's fields are prefixed", () => {
  const base = { event: "dies", subject: { type: "creature", control: "any" as const } };
  expect(readingDiff(base, { ...base, condition: { kind: "counter-presence" } })).toEqual(["condition"]);
  expect(readingDiff(base, { ...base, subject: { type: "creature", control: "you" as const } })).toEqual(["subject.control"]);
});

test("a candidate that answers differently on a second call is caught (H2)", () => {
  let n = 0;
  const d = diffTriggers([row("When this creature enters", "enters", "this creature")], () => ({ event: n++ % 2 ? "enters" : "dies" }), subjectOf);
  expect(d.nondeterministic).toEqual(["When this creature enters"]);
});

test("the checked-in census reads, and the stored trigger agrees with itself on every row", () => {
  const rows = readTriggers(readFileSync(new URL("../../tagger/triggers.jsonl", import.meta.url), "utf8"));
  expect(rows.length).toBeGreaterThan(3000);
  const byPreamble = new Map(rows.map((r) => [`${r.preamble}|${r.condition}|${r.event}|${r.subject}|${r.control}`, r]));
  // Rows share preambles (the model wrote different triggers for one printed text), so the identity
  // parser is keyed on the whole row through a closure over the row being read.
  let current: TriggerRow | undefined;
  const d = diffTriggers(rows.map((r) => ({ ...r, preamble: `${r.preamble}|${r.condition}|${r.event}|${r.subject}|${r.control}` })),
    (p) => { current = byPreamble.get(p); return storedReading(current!, subjectOf); }, subjectOf);
  expect(d.agree.distinct).toBe(rows.length);
});
