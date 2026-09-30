import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseSubject } from "@edh-seer/tagger/subject";
import type { SubjectFilter } from "@edh-seer/tagger/schema";
import { diffParsers, differingFields, readPhrases, type Phrase } from "./phrase-diff-core.js";

const f = (x: object) => x as SubjectFilter;

test("a lone string and a one-element list are the same field; an OR-list in another order too; null is not absent", () => {
  expect(differingFields(f({ type: "creature" }), f({ type: ["creature"] }))).toEqual([]);
  expect(differingFields(f({ type: ["instant", "sorcery"] }), f({ type: ["sorcery", "instant"] }))).toEqual([]);
  expect(differingFields(f({ control: "you", token: null }), f({ control: "any" }))).toEqual(["control", "token"]);
  // anyOf holds filters: the same filters built with their keys in another order are the same field.
  expect(differingFields(f({ anyOf: [{ type: "creature", control: "you" }, { subtype: "elf" }] }),
    f({ anyOf: [{ subtype: "elf" }, { control: "you", type: "creature" }] }))).toEqual([]);
});

test("coverage, agreement and disagreements grouped by the fields that differ, weighted by cards", () => {
  const phrases: Phrase[] = [
    { kind: "subject", phrase: "a creature you control", cards: 10 },
    { kind: "object", phrase: "target nonland permanent", cards: 5 },
    { kind: "object", phrase: "target artifact", cards: 3 },
    { kind: "object", phrase: "unparseable thing", cards: 7 },
  ];
  const baseline = (t: string) => f({ control: "any", type: t.split(" ").at(-1) });
  const candidate = (t: string) => t.startsWith("unparseable") ? null
    : t.includes("you control") ? f({ control: "you", type: "control" }) : baseline(t);
  const d = diffParsers(phrases, candidate, baseline);
  expect(d.total).toEqual({ distinct: 4, cards: 25 });
  expect(d.parsed).toEqual({ distinct: 3, cards: 18 });
  expect(d.agree).toEqual({ distinct: 2, cards: 8 });
  expect(d.groups.map((g) => [g.fields, g.distinct, g.cards])).toEqual([[["control"], 1, 10]]);
  expect(d.nondeterministic).toEqual([]);
});

test("a parser that answers differently on a second call is caught (H2)", () => {
  let n = 0;
  const d = diffParsers([{ kind: "subject", phrase: "x", cards: 1 }], () => f({ control: n++ % 2 ? "you" : "any" }), () => f({}));
  expect(d.nondeterministic).toEqual(["x"]);
});

// The shipped fixture parses, and parseSubject against itself is total agreement: the harness is
// sound before any grammar is compared through it.
test("parseSubject against itself over the checked-in census agrees on every phrase", () => {
  const phrases = readPhrases(readFileSync(new URL("../../tagger/phrases.jsonl", import.meta.url), "utf8"));
  expect(phrases.length).toBeGreaterThan(10_000);
  const d = diffParsers(phrases, parseSubject, parseSubject);
  expect(d.agree).toEqual(d.total);
  expect(d.nondeterministic).toEqual([]);
});
