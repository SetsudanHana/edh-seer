import { expect, test } from "vitest";
import type { CutChoice } from "./cut-choice.js";
import { lossSplit, pickTogether, tokenMakersOf } from "./cut-together.js";

const link = (text: string) => ({ from: "x", to: "y", tag: "t", text, repeat: "static" });
const cut = (name: string, covers: { text: string; by: string[] }[] = [], loses: string[] = []): CutChoice => ({
  name, manaValue: 2, keeps: [], onPlan: false, unmet: [], reasons: [], twins: [],
  row: { partners: 1, why: "w", loses: loses.map(link), covers: covers.map((c) => ({ link: link(c.text), by: c.by, partner: "P" })) } as never,
});

test("of two cards that cover each other, pickTogether picks one", () => {
  const picked = pickTogether([cut("Elf", [{ text: "L", by: ["Druid"] }]), cut("Druid", [{ text: "L", by: ["Elf"] }])], Infinity, new Map());
  expect([...picked]).toEqual(["Elf"]);
});

test("a card that loses something on its own is never picked", () => {
  expect([...pickTogether([cut("Costly", [], ["own"]), cut("Free")], Infinity, new Map())]).toEqual(["Free"]);
});

test("a token covered only by a cut maker counts as a loss", () => {
  const tok = { id: "token:Goblin", name: "Goblin", typeLine: "Token", text: "", isToken: true, isCommander: false, isLand: false, isFace: false, roles: [], score: 0, manaCost: "", physical: "token:Goblin", madeBy: ["B"] };
  const makers = tokenMakersOf({ cards: new Map([["token:Goblin", tok]]) } as never);
  const a = cut("A", [{ text: "A pays off", by: ["token:Goblin"] }]);
  expect([...pickTogether([a, cut("B")], Infinity, makers)]).toEqual(["A"]);
  expect(lossSplit(a, new Set(["A", "B"]), makers)).toEqual({ own: [], together: ["A pays off"], by: ["B"] });
});

test("limit caps the pick", () => {
  expect(pickTogether([cut("A"), cut("B"), cut("C")], 2, new Map()).size).toBe(2);
});
