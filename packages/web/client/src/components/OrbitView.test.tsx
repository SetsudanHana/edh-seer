import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { buildEngineModel } from "../lib/engine-model.js";
import { buildOrbit } from "../lib/orbit-model.js";
import { OrbitView, countText, layoutOrbit, nameLines } from "./OrbitView.js";

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
  expect(screen.getByText(/Works with/).textContent).toMatch(/Works with 10 cards and 1 token\./);
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
    const lineH = narrow ? 15 : 14, charW = narrow ? 8 : 7;
    const boxes = a.slots.flatMap((s) => (s.kind === "card" ? [{ x: s.x + s.lx, y: s.y + s.ly, w: Math.max(...s.lines.map((l) => l.length)) * charW, h: s.lines.length * lineH, anchor: s.anchor }] : []))
      .map(({ x, y, w, h, anchor }) => { const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2; return { x0, x1: x0 + w, y0: y - lineH + 3, y1: y - lineH + 3 + h }; });
    for (const b of boxes) expect(b.x0 >= 0 && b.x1 <= a.W).toBe(true);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i]!, q = boxes[j]!;
      expect(p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0).toBe(false);
    }
  }
});

test("a count says how many cards and how many of them work once", () => {
  expect(countText(5, 0)).toBe("5 cards");
  expect(countText(5, 1)).toBe("5 cards, 1 of them only once");
  expect(countText(2, 2)).toBe("2 cards, both only once");
  expect(countText(1, 1)).toBe("1 card, only once");
});

test("a name wraps to two lines, keeps whose back it is, and uses the full name when first parts clash", () => {
  const card = (name: string, extra: object = {}) => ({ id: name, name, typeLine: "", text: "", isToken: false, isCommander: false, isLand: false, isFace: false, roles: [], score: 0, manaCost: "", ...extra });
  expect(nameLines(card("Trance Kuja, Fate Defied", { faceOf: "Kuja, Genome Sorcerer" }), false, 16)).toEqual(["Trance Kuja", "(back of Kuja)"]);
  expect(nameLines(card("Yuna, Hope of Spira"), true, 16)).toEqual(["Yuna, Hope of", "Spira"]);
  expect(nameLines(card("Yuna, Hope of Spira"), false, 16)).toEqual(["Yuna"]);
  expect(nameLines(card("Coruscation Mage", { isToken: true }), false, 11)).toEqual(["Coruscatio…", "(token)"]);
});

test("the cards one step out are grouped by the card they go through, each with a sentence", async () => {
  view();
  await userEvent.setup().click(screen.getByText(/work with a card around Payoff A/));
  expect(screen.getByText("Reducer reduces what Cleric 1 costs")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Put it in the middle" }).length).toBeGreaterThan(0);
});

test("after centring a card, the way back is a button at the top of the panel", async () => {
  const { report, graph } = engineDeck();
  const user = userEvent.setup();
  const { rerender } = render(<OrbitView report={report} graph={graph} focusId="Payoff A" onFocus={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Payoff B" }));
  await user.click(screen.getByRole("button", { name: "Put Payoff B in the middle" }));
  rerender(<OrbitView report={report} graph={graph} focusId="Payoff B" onFocus={() => {}} />);
  expect(screen.getByRole("button", { name: "← Back to Payoff A" })).toBeInTheDocument();
});

test("when every card connects, the panel says so instead of leaving the list out", () => {
  const { report, graph } = engineDeck();
  // Doom Blade and Vanilla link to nothing; without them every card reaches Payoff A.
  const g = { ...graph, nodes: graph.nodes.filter((n) => n.id !== "Doom Blade" && n.id !== "Vanilla") };
  render(<OrbitView report={report} graph={g} focusId="Payoff A" onFocus={() => {}} />);
  expect(screen.queryByText(/don't connect/)).toBeNull();
  expect(screen.getByText(/Every other card in the deck connects to Payoff A, directly or through a card around it\./)).toBeInTheDocument();
});

test("a group's cards that share one sentence are listed under it once", async () => {
  view();
  await userEvent.setup().click(screen.getByRole("button", { name: /^Counts your Clerics/ }));
  expect(screen.getByText("While you control one of these, Payoff A counts it")).toBeInTheDocument();
  // Once on the ring, once under the sentence.
  expect(screen.getAllByRole("button", { name: "Cleric 1" }).length).toBe(2);
});

test("a name in a Through list opens its own line and both cards' text", async () => {
  view();
  const user = userEvent.setup();
  await user.click(screen.getByText(/work with a card around Payoff A/));
  await user.click(screen.getByRole("button", { name: /^Reducer,?$/ }));
  expect(screen.getByRole("button", { name: "Put Reducer in the middle" })).toBeInTheDocument();
  expect(screen.getAllByText("Read both cards").length).toBeGreaterThan(0);
});

test("dots run from the card that gives to the card that gains", async () => {
  const { flowOf } = await import("./OrbitView.js");
  const { report, graph } = engineDeck();
  const o = buildOrbit(buildEngineModel(report, graph), "Payoff A")!;
  const all = o.sectors.flatMap((s) => s.partners);
  // A Cleric feeds Payoff A: in only. Payoff B and Payoff A feed each other: both ways.
  expect(flowOf(all.find((p) => p.card.id === "Cleric 1")!, "Payoff A")).toMatchObject({ in: true, out: false });
  expect(flowOf(all.find((p) => p.card.id === "Payoff B")!, "Payoff A")).toMatchObject({ in: true, out: true });
});

test("with reduced motion nothing animates, and arrows carry the direction", () => {
  const mm = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
  try {
    const { container } = render(<OrbitView report={engineDeck().report} graph={engineDeck().graph} focusId="Payoff A" onFocus={() => {}} />);
    expect(container.querySelector("animateMotion")).toBeNull();
    expect(container.querySelectorAll("[data-testid=orbit-arrows]").length).toBeGreaterThan(0);
    expect(screen.getByText(/Arrows point from the card that gives/)).toBeInTheDocument();
  } finally { window.matchMedia = mm; }
});

test("at rest the ring is still after its arrival wave; dots run on the card pointed at", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const { container } = render(<OrbitView report={engineDeck().report} graph={engineDeck().graph} focusId="Payoff A" onFocus={() => {}} />);
    // One wave as the ring arrives, then nothing moves on its own.
    expect(container.querySelectorAll("[data-testid=orbit-flow] animateMotion[repeatCount='1']").length).toBeGreaterThan(0);
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(container.querySelectorAll("animateMotion").length).toBe(0);
    await act(async () => { fireEvent.mouseEnter(screen.getByRole("button", { name: "Payoff B" })); });
    expect(container.querySelectorAll("animateMotion[repeatCount='indefinite']").length).toBeGreaterThan(0);
  } finally { vi.useRealTimers(); }
});

test("the dots can be paused, and then arrows carry the direction", async () => {
  const { container } = render(<OrbitView report={engineDeck().report} graph={engineDeck().graph} focusId="Payoff A" onFocus={() => {}} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Pause the dots" }));
  expect(container.querySelector("animateMotion")).toBeNull();
  expect(container.querySelectorAll("[data-testid=orbit-arrows]").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Play the dots" })).toHaveAttribute("aria-pressed", "true");
  try { localStorage.removeItem("orbit-paused"); } catch { /* none */ }
});
