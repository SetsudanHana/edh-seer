import { expect, test } from "vitest";
import { deriveAbilities } from "./derive.js";

/** REDOUBLED STORMSINGER (issue #502), oracle text from the corpus. `segment()` splits the cleanup
 *  "At the beginning of the next end step, sacrifice those tokens." into a clause of its own; it is
 *  the maker's temporary departure, not a sacrifice outlet every token in the deck feeds. And the
 *  "for each creature token you control ..., create" preamble is what the create counts. */
const attack = "Whenever this creature attacks, for each creature token you control that entered this turn, create a tapped and attacking token that's a copy of that token.";
const cleanup = "At the beginning of the next end step, sacrifice those tokens.";
const clauses = [
  { id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" },
    actions: [{ verb: "create", object: "a tapped and attacking token that's a copy of that token", amount: "1" }] },
  { id: 2, abilityType: "triggered", trigger: { event: "end-step", subject: "the next end step", control: "you" },
    actions: [{ verb: "sacrifice", object: "those tokens" }] },
];

test("a next-end-step cleanup marks the maker temporary and is no outlet", () => {
  const { abilities } = deriveAbilities(clauses as never, "Redoubled Stormsinger", { 1: attack, 2: cleanup }, undefined, `${attack} ${cleanup}`);
  expect(abilities.map((a) => a.effect.kind)).toEqual(["token-generation"]);
  expect(abilities[0]!.temporary).toBe(true);
  expect((abilities[0]!.emits ?? []).map((e) => e.verb)).toContain("dies");
  expect((abilities[0]!.emits ?? []).map((e) => e.verb)).not.toContain("sacrifice");
});

test("a 'for each creature token you control' preamble is the create's board count", () => {
  const { abilities } = deriveAbilities(clauses as never, "Redoubled Stormsinger", { 1: attack, 2: cleanup }, undefined, `${attack} ${cleanup}`);
  const s = abilities[0]!.effect.scalingSubject;
  expect([s?.type, s?.token, s?.zone, s?.control]).toEqual(["creature", true, "battlefield", "you"]);
});

test("a cleanup after a clause that made no token keeps its own reading", () => {
  const reanimate = "Put target creature card from a graveyard onto the battlefield under your control.";
  const { abilities } = deriveAbilities([
    { id: 1, abilityType: "static", actions: [{ verb: "put", object: "target creature card from a graveyard", fromZone: "graveyard", toZone: "battlefield" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "end-step", subject: "the next end step", control: "you" }, actions: [{ verb: "sacrifice", object: "it" }] },
  ] as never, "Test", { 1: reanimate, 2: "At the beginning of the next end step, sacrifice it." }, undefined, reanimate);
  expect(abilities.some((a) => (a.emits ?? []).some((e) => e.verb === "sacrifice"))).toBe(true);
});
