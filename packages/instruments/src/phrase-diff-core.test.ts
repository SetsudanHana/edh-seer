import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseSubject } from "@edh-seer/tagger/subject";
import type { SubjectFilter } from "@edh-seer/tagger/schema";
import { diffParsers, differingFields, domainOf, readPhrases, type Phrase } from "./phrase-diff-core.js";

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

/** The classifier decides what S1 is measured over, so it is pinned BOTH ways: a phrase that is no
 *  filter leaves the denominator, and one that is a filter must stay in it -- a rule too broad would
 *  raise coverage by hiding the phrases the grammar cannot read. Every example is from the census. */
test("domainOf: what is not a filter phrase, and what stays one", () => {
  const cases: [string, string][] = [
    ["carnage or homage", "fragment"], ["loot", "fragment"], ["impostor counter", "counter"],
    ["loyalty counters on a planeswalker", "counter"], ["six +1/+1 counters", "counter"],
    ["Planeswalkers you control [0]: Proliferate", "ability-text"], ["lands you control; {T}: add {G} or {W}", "ability-text"],
    ["Spells your opponents cast that target this creature cost {2} more to cast", "clause"],
    ["Creatures with power less than this creature's power can't block creatures you control", "clause"],
    ["you tap two untapped creatures you control", "clause"], ["a card left your graveyard this turn", "clause"],
    ["blocked by fewer than two creatures each combat", "clause"], ["two cards unless you discard a creature card", "clause"],
    ["Aetherwing's power equal to the number of artifacts you control", "amount"], ["excess damage", "amount"],
    ["when you do", "time"], ["II or III", "time"], ["after this main phase", "time"],
    ["revealed creature or land card", "reference"], ["creatures not chosen by their controller", "reference"],
    ["all activated abilities of the exiled card", "reference"], ["Beregond or another Human you control", "reference"],
    ["a creature card you drafted that isn't in your deck", "draft"], ["planar die", "game-piece"], ["Dáin", "name"],
    ["your next instant or sorcery spell this turn", "ordinal"], ["Xantcha's controller", "reference"],
    ["an opponent controls a creature with power 4 or greater", "clause"], ["target snow permanent isn't snow until end of turn", "clause"],
    // ...and filters, however close they sit to a rule above.
    ["Angel", "filter"], ["attacking", "filter"], ["10/10", "filter"], ["snow", "filter"],
    ["target creature card with a sticker on it", "filter"], ["target creature you control into a 1/1 Citizen", "filter"],
    ["target spell if it was kicked", "filter"], ["a token that's a copy of the exiled card", "filter"],
    ["target creature you control and target creature the opponent to your left controls", "filter"],
    ["up to X target creatures divided as you choose", "filter"], ["target creature's controller", "filter"], ["a white Avatar creature token with power and toughness each equal to your life total", "filter"], ["an instant or sorcery spell with mana value greater than the number of experience counters you have", "filter"],
    ["a green Ooze creature token with \"This token's power is equal to the number of card types among cards in your graveyard.\"", "filter"],
  ];
  for (const [phrase, domain] of cases) expect(domainOf(phrase), phrase).toBe(domain);
});
