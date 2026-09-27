import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { buildEngineModel } from "../lib/engine-model.js";
import { buildOrbit } from "../lib/orbit-model.js";
import { CardDrawerProvider } from "./card-drawer.js";
import { allPartners, MAP_CAP, mapPartners } from "./Constellation.js";
import { OrbitView, countText } from "./OrbitView.js";

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

test("a first tap picks the card without the pair box, a second puts it in the middle", async () => {
  const onFocus = view();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Payoff B" }));
  // The card opens in the drawer (owner, 2026-09-27); the pair box no longer opens beside it.
  expect(screen.queryByText("Read both cards")).toBeNull();
  expect(onFocus).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Payoff B" }));
  expect(onFocus).toHaveBeenCalledWith("Payoff B");
});

test("the cards it doesn't reach are listed by name", () => {
  view();
  expect(screen.getByText(/don't connect to Payoff A/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Vanilla" })).toBeInTheDocument();
});

test("the map draws the partners that work with the card most, in their groups' order", () => {
  const { report, graph } = engineDeck();
  const o = buildOrbit(buildEngineModel(report, graph), "Payoff A")!;
  const all = o.sectors.flatMap((s) => s.partners);
  expect(mapPartners(o).map((x) => x.p)).toEqual(all.slice(0, MAP_CAP));
  const big = { ...o, sectors: [{ ...o.sectors[0]!, partners: Array.from({ length: 20 }, (_, i) => ({ ...all[0]!, card: { ...all[0]!.card, id: `c${i}` }, links: [{ ...all[0]!.links[0]!, repeat: i === 19 ? "static" as const : "oneshot" as const }] })) }] };
  const drawn = mapPartners(big).map((x) => x.p.card.id);
  expect(drawn.length).toBe(MAP_CAP);
  // The one that always works makes the cut, though it comes last.
  expect(drawn).toContain("c19");
  // THE COMMANDER'S MAP DRAWS THEM ALL (Glance mockup): the same strongest are named, the rest small.
  const every = allPartners(big);
  expect(every).toHaveLength(20);
  expect(every.filter((x) => !x.minor).map((x) => x.p.card.id)).toEqual(drawn);
});

test("a count says how many cards and how many of them work once", () => {
  expect(countText(5, 0)).toBe("5 cards");
  expect(countText(5, 1)).toBe("5 cards, 1 of them only once");
  expect(countText(2, 2)).toBe("2 cards, both only once");
  expect(countText(1, 1)).toBe("1 card, only once");
});

test("the cards one step out are grouped by the card they go through, each with a sentence", async () => {
  view();
  await userEvent.setup().click(screen.getByText(/work with a card around Payoff A/));
  expect(screen.getByText("Reducer reduces what Cleric 1 costs")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Put it in the middle" }).length).toBeGreaterThan(0);
});

test("after centring a card, the way back is a button and the path is drawn above it", async () => {
  const { report, graph } = engineDeck();
  const user = userEvent.setup();
  const { rerender } = render(<OrbitView report={report} graph={graph} focusId="Payoff A" onFocus={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Payoff B" }));
  await user.click(screen.getByRole("button", { name: "Payoff B" }));
  rerender(<OrbitView report={report} graph={graph} focusId="Payoff B" onFocus={() => {}} />);
  expect(screen.getByRole("button", { name: "← Back to Payoff A" })).toBeInTheDocument();
  const path = screen.getByRole("navigation", { name: "Your path" });
  expect(path.textContent).toBe("Payoff A›Payoff B");
});

// LESS IS MORE (owner, 2026-09-27): "every other card connects" was an all-is-well line; the panel
// now says only what does not connect.
test("when every card connects, the panel lists nothing and says nothing", () => {
  const { report, graph } = engineDeck();
  // Doom Blade and Vanilla link to nothing; without them every card reaches Payoff A.
  const g = { ...graph, nodes: graph.nodes.filter((n) => n.id !== "Doom Blade" && n.id !== "Vanilla") };
  render(<OrbitView report={report} graph={g} focusId="Payoff A" onFocus={() => {}} />);
  expect(screen.queryByText(/don't connect/)).toBeNull();
  expect(screen.queryByText(/Every other card in the deck connects/)).toBeNull();
});

test("a group's cards that share one sentence are listed under it once", async () => {
  view();
  await userEvent.setup().click(screen.getByRole("button", { name: /^Cleric tribal/ }));
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

test("the ticks run from the card that gives to the card that gains, both ways when both give", () => {
  const { container } = render(<OrbitView report={engineDeck().report} graph={engineDeck().graph} focusId="Payoff A" onFocus={() => {}} />);
  // A Cleric feeds Payoff A. Payoff B and Payoff A feed each other: a tick each way.
  const ticks = [...container.querySelectorAll("[data-testid=constellation-tick]")].map((t) => `${t.getAttribute("data-from")}>${t.getAttribute("data-to")}`);
  expect(ticks).toContain("Cleric 1>Payoff A");
  expect(ticks).toContain("Payoff A>Payoff B");
  expect(ticks).toContain("Payoff B>Payoff A");
});

test("walking to a card keeps the one you came from on the map, joined by the route", async () => {
  const { report, graph } = engineDeck();
  const onFocus = vi.fn();
  const user = userEvent.setup();
  const { container, rerender } = render(<OrbitView report={report} graph={graph} focusId="Payoff A" onFocus={onFocus} />);
  expect(container.querySelector("[data-testid=constellation-route]")).toBeNull();
  expect(screen.queryByRole("button", { name: "See my path" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Payoff B" }));
  await user.click(screen.getByRole("button", { name: "Payoff B" }));
  rerender(<OrbitView report={report} graph={graph} focusId="Payoff B" onFocus={onFocus} />);
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  expect(container.querySelector("[data-testid=constellation-route]")).not.toBeNull();
  expect(screen.getByRole("button", { name: "See my path" })).toBeInTheDocument();
  // Payoff A is still a card on the map, and walking back to it works as any walk does.
  onFocus.mockClear();
  await user.click(container.querySelector("[data-id='Payoff A']")!);
  await user.click(container.querySelector("[data-id='Payoff A']")!);
  expect(onFocus).toHaveBeenCalledWith("Payoff A");
});

test("with reduced motion nothing runs, and arrows carry the direction", async () => {
  const mm = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
  try {
    const { container } = render(<OrbitView report={engineDeck().report} graph={engineDeck().graph} focusId="Payoff A" onFocus={() => {}} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const shown = (id: string) => [...container.querySelectorAll(`[data-testid=${id}]`)].filter((e) => (e as SVGElement).style.display !== "none");
    expect(shown("constellation-tick").length).toBe(0);
    expect(shown("constellation-arrow").length).toBeGreaterThan(0);
    expect(screen.getByText(/A solid line keeps working; a dashed line works once\./)).toBeInTheDocument();
  } finally { window.matchMedia = mm; }
});

test("pointing at a card brightens its lines", async () => {
  const { container } = render(<OrbitView report={engineDeck().report} graph={engineDeck().graph} focusId="Payoff A" onFocus={() => {}} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Payoff B" })); });
  expect(container.querySelector("[data-id='Payoff B']")).toHaveAttribute("aria-pressed", "true");
  expect(container.querySelector("[data-id='Cleric 1']")).toHaveAttribute("aria-pressed", "false");
});

test("the motion can be paused, and then arrows carry the direction", async () => {
  const { container } = render(<OrbitView report={engineDeck().report} graph={engineDeck().graph} focusId="Payoff A" onFocus={() => {}} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Pause the motion" }));
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  const shown = (id: string) => [...container.querySelectorAll(`[data-testid=${id}]`)].filter((e) => (e as SVGElement).style.display !== "none");
  expect(shown("constellation-tick").length).toBe(0);
  expect(shown("constellation-arrow").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Play the motion" })).toHaveAttribute("aria-pressed", "true");
  try { localStorage.removeItem("orbit-paused"); } catch { /* none */ }
});

test("a right click on a card opens its menu: read how, walk to it, and Escape closes it", async () => {
  const onFocus = view();
  const user = userEvent.setup();
  fireEvent.contextMenu(screen.getByRole("button", { name: "Payoff B" }), { clientX: 40, clientY: 40 });
  const menu = screen.getByRole("menu", { name: "Payoff B" });
  expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
    // No "Read the card" here: outside a report there is no card drawer to open it in.
    "How it works with Payoff A", "Put Payoff B in the middle", "Open its card page↗", "Copy the name",
  ]);
  expect(within(menu).getByRole("menuitem", { name: /Open its card page/ })).toHaveAttribute("href", "/cards/payoff-b");
  // The first line takes focus, so the keyboard can go straight on.
  expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.contextMenu(screen.getByRole("button", { name: "Payoff B" }), { clientX: 40, clientY: 40 });
  await user.click(screen.getByRole("menuitem", { name: "How it works with Payoff A" }));
  expect(screen.getByText("When Payoff A enters, Payoff B draws")).toBeInTheDocument();
  fireEvent.contextMenu(screen.getByRole("button", { name: "Payoff B" }), { clientX: 40, clientY: 40 });
  await user.click(screen.getByRole("menuitem", { name: "Put Payoff B in the middle" }));
  expect(onFocus).toHaveBeenCalledWith("Payoff B");
});

/** THE CARDS THIS RUN ADDED WEAR THE "NEW" MARK ON THE MAP TOO (roadmap S9); the menu no longer
 *  offers a hand-made pin (owner, 2026-09-27). */
test("a card this run added wears the new mark on the map, and the menu offers no pin", async () => {
  const { report, graph } = engineDeck();
  const { container } = render(<CardDrawerProvider graph={graph} added={["Payoff B"]}><OrbitView report={report} graph={graph} focusId="Payoff A" onFocus={() => {}} /></CardDrawerProvider>);
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  expect(container.querySelector("[data-id='Payoff B'] path")).toHaveAttribute("opacity", "1");
  fireEvent.contextMenu(screen.getByRole("button", { name: "Payoff B" }), { clientX: 40, clientY: 40 });
  expect(screen.getByRole("menuitem", { name: "Read the card" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: /pin/i })).toBeNull();
});

test("a right click on the map itself offers the view and the motion", async () => {
  const { container } = render(<OrbitView report={engineDeck().report} graph={engineDeck().graph} focusId="Payoff A" onFocus={() => {}} />);
  fireEvent.contextMenu(container.querySelector("svg[role=group]")!, { clientX: 10, clientY: 10 });
  const menu = screen.getByRole("menu", { name: "The map" });
  expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Pause the motion", "Frame Payoff A and its cards"]);
  await userEvent.setup().click(within(menu).getByRole("menuitem", { name: "Pause the motion" }));
  expect(screen.getByRole("button", { name: "Play the motion" })).toBeInTheDocument();
  try { localStorage.removeItem("orbit-paused"); } catch { /* none */ }
});

/** A CARD OPENS IN THE DRAWER, AND EMPTY SPACE CLEARS THE PICK (owner, 2026-09-27: the panel's box
 *  "is not very informative", and a tap on empty space left the pick in place). */
test("tapping a card opens it in the drawer; tapping empty space clears the pick", async () => {
  const { report, graph } = engineDeck();
  const user = userEvent.setup();
  const { container } = render(<CardDrawerProvider graph={graph}><OrbitView report={report} graph={graph} focusId="Payoff A" onFocus={() => {}} /></CardDrawerProvider>);
  const map = container.querySelector<SVGSVGElement>("svg[role=group]")!;
  const node = () => within(map as unknown as HTMLElement).getByRole("button", { name: "Payoff B" });
  await user.click(node());
  expect(await screen.findByTestId("card-inspector")).toBeInTheDocument();
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  expect(node()).toHaveAttribute("aria-pressed", "true");
  // The pointer leaves the card for empty space, then taps there.
  await user.unhover(node());
  fireEvent.click(map);
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  expect(node()).toHaveAttribute("aria-pressed", "false");
});
