import { fireEvent, render, screen } from "@testing-library/react";
import type { CardGraph } from "../types.js";
import { CardDrawerProvider, useCardDrawer } from "./card-drawer.js";
import { useEffect } from "react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import { CardContextMenu } from "./pop-menu.js";
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
  return { cards: new Map(names.map((n) => [n, card(n)])), partners, groups: [] } as unknown as EngineModel;
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

/** THE REPORT'S OWN PAYOFFS LEAD (owner, 2026-09-29): a card that turns what the loop repeats into a
 *  win is drawn under it with one link to a piece; the guess by shared links still needs two. */
test("a measured win payoff leads, and needs only one link", () => {
  const parts = comboParts(["A", "B", "C"], m, ["Lone"])!;
  expect(parts.payoffs.map((p) => p.card.name)).toEqual(["Lone", "Pay"]);
});

test("a piece the engine does not know leaves the combo as a row", () => {
  expect(comboParts(["A", "Missing"], m)).toBeNull();
});

test("the loop is drawn with its steps numbered and the repeats named", () => {
  render(<ComboFeature parts={comboParts(["A", "B", "C"], m)!} result="Infinite mana, Infinite tokens" manaValue={9} cheap={false} />);
  expect(screen.getByTestId("combo-feature")).toHaveTextContent("When C enters thanks to B");
  expect(screen.getByText("Infinite tokens")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: /^A \+ B \+ C, a loop; outside it, Pay$/ })).toBeInTheDocument();
  expect(screen.getByText("works with 2 of 3")).toBeInTheDocument();
});

/** THE LOOP'S NODES ARE BUTTONS (#1003): a node opened its card on a mouse click only; the keyboard
 *  reaches it now, and Enter reads the card in the same drawer. */
test("a node of the loop is a button, and Enter opens its card", () => {
  const graph = { nodes: ["A", "B", "C"].map((n) => ({ id: n, label: n, copies: 1, types: [], subtypes: [], supertypes: [], colors: [], cmc: 1 })), edges: [] } as unknown as CardGraph;
  render(<CardDrawerProvider graph={graph}><ComboFeature parts={comboParts(["A", "B", "C"], m)!} result="Infinite mana" manaValue={9} cheap={false} /></CardDrawerProvider>);
  const node = screen.getByRole("button", { name: "Read B" });
  expect(node).toHaveAttribute("tabindex", "0");
  fireEvent.keyDown(node, { key: "Enter" });
  expect(screen.getByTestId("card-inspector")).toBeInTheDocument();
});

function Walks({ walk }: { walk: (id: string) => void }) {
  const { setExtras } = useCardDrawer();
  useEffect(() => { setExtras({ model: m, walk }); return () => setExtras(null); }, [setExtras, walk]);
  return null;
}

/** THE MAP RULE ON THE COMBO (#1003; owner, 2026-10-03: "it should get walk and the menu"): the
 *  first click reads the piece, the second walks the commander's map from it, and the right-click
 *  menu leads with the walk. */
test("a second click on a piece walks the map from it, and its menu offers the walk", () => {
  const walk = vi.fn();
  const graph = { nodes: ["A", "B", "C"].map((n) => ({ id: n, label: n, copies: 1, types: [], subtypes: [], supertypes: [], colors: [], cmc: 1 })), edges: [] } as unknown as CardGraph;
  render(<MemoryRouter><CardContextMenu /><CardDrawerProvider graph={graph}><Walks walk={walk} /><ComboFeature parts={comboParts(["A", "B", "C"], m)!} result="Infinite mana" manaValue={9} cheap={false} /></CardDrawerProvider></MemoryRouter>);
  const node = screen.getByRole("button", { name: "Read B" });
  fireEvent.click(node);
  expect(screen.getByTestId("card-inspector")).toBeInTheDocument();
  expect(walk).not.toHaveBeenCalled();
  fireEvent.click(node);
  expect(walk).toHaveBeenCalledWith("B");
  expect(screen.queryByTestId("card-inspector")).toBeNull();
  fireEvent.contextMenu(screen.getByRole("button", { name: "Read C" }), { clientX: 5, clientY: 5 });
  expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
    "Walk the map from here", "Read the card", "Open its card page", "Copy the name",
  ]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Walk the map from here" }));
  expect(walk).toHaveBeenLastCalledWith("C");
});

/** WHAT KILLS, AND EACH STEP ONCE (#1034): Rani's Dualcaster loop printed two identical steps and
 *  never said what wins. */
test("the drawn combo names its win or says none was found, and prints an identical step once", () => {
  const parts = comboParts(["A", "B", "C"], m)!;
  const twice = { ...parts, sides: [parts.sides[0]!, parts.sides[0]!, parts.sides[2] ?? null] };
  const { unmount } = render(<ComboFeature parts={twice} result="Infinite mana" manaValue={9} cheap={false} wins={[]} />);
  expect(screen.getByText(/No card here was found that turns what the loop repeats into a win/)).toBeInTheDocument();
  expect(screen.getAllByText(parts.sides[0]!.text, { exact: false })).toHaveLength(1);
  // Numbered 1, 2 with no gap, in the list and on the drawing alike.
  expect([...document.querySelectorAll("ol .pip")].map((p) => p.textContent)).toEqual(["1", "2"]);
  expect([...document.querySelectorAll("svg text")].map((t) => t.textContent).filter((t) => /^\d+$/.test(t ?? ""))).toEqual(["1", "2"]);
  unmount();
  render(<ComboFeature parts={parts} result="Infinite mana" manaValue={9} cheap={false} wins={["Lone"]} />);
  expect(screen.getByText(/Wins through/)).toHaveTextContent("Wins through Lone");
});

test("the drawn combo whose result is the kill says it wins by itself", () => {
  const parts = comboParts(["A", "B", "C"], m)!;
  render(<ComboFeature parts={parts} result="Infinite mana, Infinite damage" manaValue={9} cheap={false} wins={[]} />);
  expect(screen.getByText(/The loop wins by itself: Infinite damage\./)).toBeInTheDocument();
  expect(screen.queryByText(/No card here was found/)).toBeNull();
});

/** THE TRIANGLE SITS BESIDE THE STEPS (#987): a 1fr text column left it ~1,600px away at 3840. */
test("the text column is capped so the diagram sits beside the steps", () => {
  render(<ComboFeature parts={comboParts(["A", "B", "C"], m)!} result="Infinite mana" manaValue={9} cheap={false} />);
  expect(screen.getByTestId("combo-feature").className).toContain("lg:grid-cols-[minmax(0,56rem)_minmax(0,28rem)]");
});
