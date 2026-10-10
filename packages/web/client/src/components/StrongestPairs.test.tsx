import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { EngineCard, EngineModel } from "../lib/engine-model.js";
import type { TopPair } from "../lib/top-pairs.js";
import { StrongestPairs } from "./StrongestPairs.js";

const card = (name: string, text: string): EngineCard => ({ id: name, name, typeLine: "Creature", text, score: 1 } as unknown as EngineCard);
const model = { cards: new Map([["Dualcaster Mage", card("Dualcaster Mage", "Flash. Copy target spell.")], ["Twinflame", card("Twinflame", "Create a token copy.")], ["Rhys", card("Rhys", "Rhys text")], ["Sam", card("Sam", "Sam text")]]) } as unknown as EngineModel;
const combo: TopPair = { kind: "combo", cards: ["Dualcaster Mage", "Twinflame"], manaTogether: 5, result: "Infinite hasty tokens", kill: "wins by itself" };
const two: TopPair = { kind: "synergy", cards: ["Rhys", "Sam"], ways: ["Draw", "Ramp"], both: true, lines: [{ from: "Sam", to: "Rhys", tag: "t", text: "Rhys draws when Sam enters", repeat: "triggered" }, { from: "Rhys", to: "Sam", tag: "t", text: "Sam ramps", repeat: "static" }] };
const one: TopPair = { kind: "synergy", cards: ["Sam", "Rhys"], ways: ["Draw"], both: false, lines: [] };

test("a combo and a synergy pair each name both cards and say what the number means", () => {
  const { container } = render(<StrongestPairs pairs={[combo, two, one]} model={model} />);
  expect(screen.getByRole("heading", { name: "Cards that work best together" })).toBeInTheDocument();
  const items = [...container.querySelectorAll("section > ul > li")];
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent("Dualcaster Mage + Twinflame");
  expect(items[0]).toHaveTextContent("A two-card combo: 5 mana together, wins by itself");
  expect(items[1]).toHaveTextContent("Work together in 2 ways · each helps the other");
  expect(items[1]).toHaveTextContent("Rhys draws when Sam enters");
  // The report's own Lines: a badge says how often it happens.
  expect(items[1]).toHaveTextContent(/always on/i);
  expect(items[2]).toHaveTextContent("Work together in 1 way");
  expect(items[2]).not.toHaveTextContent("1 ways");
  expect(items[2]).not.toHaveTextContent("each helps the other");
});

test("each entry folds both cards' text", () => {
  render(<StrongestPairs pairs={[combo]} model={model} />);
  const fold = screen.getByText("Read both cards").closest("details")!;
  expect(within(fold).getByText("Flash. Copy target spell.")).toBeInTheDocument();
  expect(within(fold).getByText("Create a token copy.")).toBeInTheDocument();
});

test("nothing renders with no pairs", () => {
  const { container } = render(<StrongestPairs pairs={[]} model={model} />);
  expect(container).toBeEmptyDOMElement();
});

test("Glance: the strip follows the verdict in both branches", () => {
  const src = readFileSync(join(__dirname, "ReportChapters.tsx"), "utf8");
  const read = src.slice(src.indexOf('<Chapter id="read"'), src.indexOf('<Chapter id="stand"'));
  // Rail up: the verdict is in the heading row, so the strip leads the chapter, above the map.
  expect(read).toMatch(/verdictAbove \? <StrongestPairs[^\n]*\/> : null/);
  expect(read.search(/verdictAbove \? <StrongestPairs/)).toBeLessThan(read.indexOf("<OrbitView"));
  // No rail: the verdict is in the "rest" part, and the strip is handed to it, to follow it.
  expect(read).toMatch(/part="rest"[^\n]*afterVerdict=\{!verdictAbove \? <StrongestPairs/);
  const panel = readFileSync(join(__dirname, "RecognitionPanel.tsx"), "utf8");
  const at = panel.indexOf("See the {suggestions === 1", panel.indexOf("!verdictAbove ? ("));
  expect(panel.indexOf("{afterVerdict}")).toBeGreaterThan(at);
});
