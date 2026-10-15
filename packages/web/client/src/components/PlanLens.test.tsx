import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { buildEngineModel } from "../lib/engine-model.js";
import { PlanLens } from "./PlanLens.js";
import type { CardGraph, DeckReport } from "../types.js";

type Reason = { producer: string; consumer: string; tag: string; text: string; repeatability: string };
const lasting = (producer: string, consumer: string, text: string): Reason => ({ producer, consumer, tag: "etb:creature", text, repeatability: "triggered" });
const once = (producer: string, consumer: string, text: string): Reason => ({ producer, consumer, tag: "etb:creature", text, repeatability: "oneshot" });

const NAMES = ["Leech", "Ascension", "Kitten", "Giant", "Curse"];
const REASONS = [
  lasting("Kitten", "Leech", "When Leech enters thanks to Kitten, it drains"),
  lasting("Giant", "Ascension", "When a creature dies thanks to Giant, Ascension drains"),
  once("Kitten", "Ascension", "When Kitten is cast, Ascension drains"),
  // The drain card feeding the Curse: it does not set the plan up.
  lasting("Leech", "Curse", "When Leech attacks, Curse makes a token"),
  once("Curse", "Leech", "When Curse enters, Leech drains"),
];
const report = {
  commanders: [], combos: [],
  cards: NAMES.map((name, i) => ({ name, score: 1, manaValue: i + 1 })),
  edges: REASONS.map((r) => ({ a: r.producer, b: r.consumer, score: 1, reasons: [r] })),
  manaAvailability: { rows: [{ turn: 2, mana: { median: 2 } }, { turn: 3, mana: { median: 3 } }] },
} as unknown as DeckReport;
const graph = {
  nodes: NAMES.map((n) => ({ id: n, label: n, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: n === "Kitten" ? ["U"] : ["B"], cmc: 2, roles: [], oracleText: `${n} text` })),
  edges: [], undirectedReasons: 0, offDeckReasons: 0,
} as unknown as CardGraph;
const model = buildEngineModel(report, graph);
const mv = new Map(NAMES.map((n, i) => [n, i + 1]));

const lens = () => render(<PlanLens report={report} graph={graph} model={model} plan="burn" planCards={["Leech", "Ascension"]} plans={[{ plan: "burn", cards: ["Leech", "Ascension"] }]} manaValueOf={(n) => mv.get(n)} />);
const row = (name: string) => screen.getAllByTestId("plan-lens-row").find((r) => r.getAttribute("data-card") === name)!;

test("each card's row says what feeds it and how many of those links keep working, with the sentence", () => {
  lens();
  expect(screen.getByText("Damage or drain, on the map")).toBeInTheDocument();
  expect(row("Leech")).toHaveTextContent("1 mana · Black · fed by 2, 1 lasting");
  expect(row("Leech")).toHaveTextContent("Keeps working: When Leech enters thanks to Kitten, it drains");
  // The Curse feeds Leech once; its attack link runs the other way and is not counted.
  expect(row("Curse")).toHaveTextContent("feeds 1, 0 lasting");
});

test("'Why each one' lists every partner with its sentence", () => {
  lens();
  fireEvent.click(within(row("Leech")).getByRole("button", { name: /Why each one/ }));
  const links = within(row("Leech")).getByTestId("plan-lens-links");
  expect(links).toHaveTextContent("Kitten keeps working");
  expect(links).toHaveTextContent("Curse once");
  expect(links).toHaveTextContent("When Curse enters, Leech drains");
});

test("tapping a card reads it; cutting it says what each plan card keeps", () => {
  lens();
  const kitten = screen.getAllByTestId("plan-lens-card").find((g) => g.getAttribute("data-card") === "Kitten")!;
  fireEvent.click(kitten);
  // What it feeds in each plan first; the either-way count after, saying it is one (round 6).
  expect(screen.getByTestId("plan-lens-across")).toHaveTextContent("It feeds 2 cards in this plan (1 lasting). Counting links in either direction, it works with 2 of your 2 plan cards, 1 of them with links that keep working.");
  fireEvent.click(screen.getByRole("button", { name: "What if I cut Kitten?" }));
  expect(screen.getByTestId("plan-lens-cut-summary")).toHaveTextContent("Leech loses a lasting link. Leech would have no lasting link left.");
  expect(screen.getByRole("button", { name: "Cut: Kitten ✕" })).toBeInTheDocument();
});

test("lasting links only hides the dashed lines and the once-only chips", () => {
  lens();
  const before = screen.getAllByTestId("plan-lens-line").length;
  fireEvent.click(screen.getByRole("button", { name: "Lasting links only" }));
  expect(screen.getAllByTestId("plan-lens-line").length).toBeLessThan(before);
  expect(screen.getAllByTestId("plan-lens-line").every((l) => l.hasAttribute("data-lasting"))).toBe(true);
  expect(row("Leech")).toHaveTextContent("+1 once, hidden");
});

test("an opened row lists every reason, even with Lasting links only on", () => {
  lens();
  fireEvent.click(screen.getByRole("button", { name: "Lasting links only" }));
  fireEvent.click(within(row("Curse")).getByRole("button", { name: /Why each one/ }));
  expect(within(row("Curse")).getByTestId("plan-lens-links")).toHaveTextContent("Leech once");
});
