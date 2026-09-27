import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { EngineCard, EngineModel, Link, Pair } from "../lib/engine-model.js";
import { ComboFeature, comboParts } from "./ComboFeature.js";

const card = (name: string, score = 1): EngineCard => ({
  id: name, name, physical: name, typeLine: "Creature", text: "", isToken: false, isCommander: false, isLand: false, isFace: false,
  roles: [], score, manaCost: "",
} as EngineCard);
const link = (from: string, to: string, text: string): Link => ({ from, to, tag: "t", text, repeat: "triggered" });
function model(pairs: [string, string, string][]): EngineModel {
  const names = [...new Set(pairs.flatMap(([a, b]) => [a, b]))];
  const partners = new Map<string, Map<string, Pair>>(names.map((n) => [n, new Map()]));
  for (const [a, b, text] of pairs) {
    const p: Pair = { a, b, links: [link(a, b, text)], once: false };
    partners.get(a)!.set(b, p); partners.get(b)!.set(a, p);
  }
  return { cards: new Map(names.map((n) => [n, card(n)])), partners } as unknown as EngineModel;
}

const m = model([
  ["A", "B", "When B enters because A copies it, it triggers again"],
  ["B", "C", "When C enters thanks to B, it sacrifices a creature"],
  ["C", "A", "When A sees C, it copies it"],
  ["Pay", "A", "Pay deals 1 damage when A makes a token"],
  ["Pay", "B", "Pay deals 1 damage when B enters"],
  ["Lone", "A", "Lone only works with A"],
]);

test("each side of the loop is its own sentence, and a card working with two pieces is what a lap pays", () => {
  const parts = comboParts(["A", "B", "C"], m)!;
  expect(parts.sides.map((l) => l?.text)).toEqual([
    "When B enters because A copies it, it triggers again",
    "When C enters thanks to B, it sacrifices a creature",
    "When A sees C, it copies it",
  ]);
  expect(parts.payoffs.map((p) => [p.card.name, p.reach])).toEqual([["Pay", 2]]);
});

test("a piece the engine does not know leaves the combo as a row", () => {
  expect(comboParts(["A", "Missing"], m)).toBeNull();
});

test("the loop is drawn with its steps numbered and the repeats named", () => {
  render(<ComboFeature parts={comboParts(["A", "B", "C"], m)!} result="Infinite mana, Infinite tokens" manaValue={9} cheap={false} />);
  expect(screen.getByTestId("combo-feature")).toHaveTextContent("When C enters thanks to B");
  expect(screen.getByText("Infinite tokens")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /^A \+ B \+ C, a loop; outside it, Pay$/ })).toBeInTheDocument();
  expect(screen.getByText("works with 2 of 3")).toBeInTheDocument();
});
