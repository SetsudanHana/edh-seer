import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { buildEngineModel } from "../lib/engine-model.js";
import { buildOrbit } from "../lib/orbit-model.js";
import { OrbitView, layoutOrbit } from "./OrbitView.js";

function view(focusId = "Payoff A") {
  const { report, graph } = engineDeck();
  const onFocus = vi.fn();
  render(<OrbitView report={report} graph={graph} focusId={focusId} onFocus={onFocus} />);
  return onFocus;
}

test("draws the card in the middle and names every disc around it", () => {
  view();
  expect(screen.getByRole("group", { name: "Payoff A and the 11 cards it works with" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Treasure (token)" })).toBeInTheDocument();
  expect(screen.getByText(/Works with/)).toBeInTheDocument();
});

test("a first tap reads the pair, a second puts the card in the middle", async () => {
  const onFocus = view();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Payoff B" }));
  expect(screen.getByText("When Payoff A enters, Payoff B draws")).toBeInTheDocument();
  expect(screen.getByText("Read both cards")).toBeInTheDocument();
  expect(onFocus).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Payoff B" }));
  expect(onFocus).toHaveBeenCalledWith("Payoff B");
});

test("the cards it doesn't reach are listed by name", () => {
  view();
  expect(screen.getByText(/don't connect to Payoff A/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Vanilla" })).toBeInTheDocument();
});

test("the layout is the same every time, and no two names overlap", () => {
  const { report, graph } = engineDeck();
  const o = buildOrbit(buildEngineModel(report, graph), "Payoff A")!;
  for (const narrow of [false, true]) {
    const a = layoutOrbit(o, narrow), b = layoutOrbit(o, narrow);
    expect(a.slots.map((s) => [s.x, s.y])).toEqual(b.slots.map((s) => [s.x, s.y]));
    const boxes = a.slots.flatMap((s) => (s.kind === "card" ? [{ x: s.x + s.lx, y: s.y + s.ly, w: s.label.length * 6.6, anchor: s.anchor }] : []))
      .map(({ x, y, w, anchor }) => { const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2; return { x0, x1: x0 + w, y0: y - 10, y1: y + 4 }; });
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i]!, q = boxes[j]!;
      expect(p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0).toBe(false);
    }
  }
});
