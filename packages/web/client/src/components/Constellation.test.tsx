import { act, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { allPartners, drawnPartners, idleOpacity, labelSpots, placeLabel, type MapPartner } from "./Constellation.js";
import { OrbitView } from "./OrbitView.js";
import { buildEngineModel } from "../lib/engine-model.js";
import { buildOrbit } from "../lib/orbit-model.js";

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

test("a phone draws only the named partners; a wide screen keeps the small unnamed discs", () => {
  const { report, graph } = engineDeck();
  const o = buildOrbit(buildEngineModel(report, graph), "Payoff A")!;
  const all = allPartners(o, 3);
  expect(all.some((x) => x.minor)).toBe(true);
  expect(drawnPartners(all, true).every((x: MapPartner) => !x.minor)).toBe(true);
  expect(drawnPartners(all, true)).toHaveLength(3);
  expect(drawnPartners(all, false)).toBe(all);
});

test("placeLabel: below if it fits, else above, else beside, else nowhere", () => {
  const spots = labelSpots({ x: 100, y: 100, r: 20 }, 60, 12);
  const [below, above] = spots;
  expect(placeLabel(spots, [])).toBe(below);
  expect(placeLabel(spots, [below!.box])).toBe(above);
  const side = placeLabel(spots, [below!.box, above!.box]);
  expect(side).not.toBeNull();
  expect(["start", "end"]).toContain(side!.anchor);
  expect(placeLabel(spots, spots.map((s) => s.box))).toBeNull();
  // a disc over the below spot is a blocker like a name is
  expect(placeLabel(spots, [box(90, 118, 110, 135)])).toBe(above);
});

test("a phone shows the hint above the map", async () => {
  const mm = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
  try {
    render(<OrbitView report={engineDeck().report} graph={engineDeck().graph} focusId="Payoff A" onFocus={() => {}} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByText("Tap a card to read it.")).toBeInTheDocument();
  } finally { window.matchMedia = mm; }
});

test("a wide screen has no hint", () => {
  render(<OrbitView report={engineDeck().report} graph={engineDeck().graph} focusId="Payoff A" onFocus={() => {}} />);
  expect(screen.queryByText("Tap a card to read it.")).toBeNull();
});

test("a card left on the map by an earlier step is faint on a wide screen and not drawn on a phone", () => {
  expect(idleOpacity(false)).toBe(0.35);
  expect(idleOpacity(true)).toBe(0);
});
