/** "a card or token" is either (#1499). Clause records copied verbatim from Mongo `cardClauses.clauses` (DERIVE 448), oracle lines from `cards.oracleText`. */
import { describe, expect, test } from "vitest";
import { deriveAbilities } from "./derive.js";

const LINE = "If a card or token would be put into your graveyard from anywhere, exile it instead.";
const exiledSubjects = (name: string, line: string, object: string, toZone: string | null) => {
  const text = line;
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "static", actions: [{ verb: "exile", object, fromZone: null, toZone, amount: null, optional: false }] }] as never,
    name, { 1: text }, undefined, text,
  );
  return abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled").map((e) => e.subject);
};

describe("a card or token is either", () => {
  test.each([
    ["Necrodominance", "exile"], ["Festival of Embers", null], ["Emet-Selch, Unsundered // Hades, Sorcerer of Eld", "exile"],
  ])("%s: the exiled emit is token null", (name, toZone) => {
    const s = exiledSubjects(name, LINE, "a card or token", toZone);
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) expect(x.token).toBeNull();
  });
  test("Rest in Peace: same", () => {
    const s = exiledSubjects("Rest in Peace", "If a card or token would be put into a graveyard from anywhere, exile it instead.", "a card or token", null);
    for (const x of s) expect(x.token).toBeNull();
  });
  test("a token alone stays token true; a card alone stays null (as on main)", () => {
    for (const x of exiledSubjects("T", "If a token would be put into your graveyard from anywhere, exile it instead.", "a token", "exile")) expect(x.token).toBe(true);
    for (const x of exiledSubjects("C", "If a card would be put into your graveyard from anywhere, exile it instead.", "a card", "exile")) expect(x.token).toBeNull();
  });
});
