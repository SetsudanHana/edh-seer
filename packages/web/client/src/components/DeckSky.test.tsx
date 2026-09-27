import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { buildEngineModel } from "../lib/engine-model.js";
import { DeckSky } from "./DeckSky.js";

const model = () => { const { report, graph } = engineDeck(); return buildEngineModel(report, graph); };

test("the sky names its themes; a theme's name lights it, a star's tap names it", () => {
  const m = model();
  const { container } = render(<DeckSky model={m} caption="Every card is a star." />);
  expect(screen.getByRole("img", { name: /^The deck as a sky:/ })).toBeInTheDocument();
  expect(screen.getByText("Every card is a star.")).toBeInTheDocument();
  const first = m.groups.find((g) => !g.helper)!;
  const name = screen.getByRole("button", { name: first.name.toUpperCase() });
  fireEvent.click(name);
  expect(name).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(new RegExp(`^: \\d+ cards\\. Tap the name again`))).toBeInTheDocument();
  // A star outside that theme dims.
  const outside = [...container.querySelectorAll("[data-star]")].find((g) => !first.hubs.concat(first.members).includes(g.getAttribute("data-star")!));
  if (outside) expect(outside).toHaveAttribute("opacity", "0.18");
  fireEvent.click(container.querySelector(`[data-star='${first.hubs[0]}']`)!);
  expect(screen.getAllByText(m.cards.get(first.hubs[0]!)!.name).length).toBeGreaterThan(0);
});

test("a chapter's light: its cards shine, its lines are drawn in gold, and it says what they are", () => {
  const m = model();
  const ids = [...m.cards.keys()].slice(0, 2);
  const { container } = render(<DeckSky model={m} lit={{ ids: new Set(ids), lines: [[ids[0]!, ids[1]!]], label: "Two cards" }} />);
  expect(screen.getByText("Two cards")).toBeInTheDocument();
  expect(container.querySelectorAll("[data-testid=sky-lit-lines] line").length).toBe(1);
});

/** ON A PHONE THE THEMES ARE NAMED UNDER THE SKY (owner, 2026-09-27: they crowded round the
 *  commander at 358px): a chip per theme, which lights it as the name did. */
test("drawn narrow, the themes' names become chips under the sky, and a chip lights its theme", async () => {
  const RO = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe() { this.cb([{ contentRect: { width: 358 } } as ResizeObserverEntry], this as never); }
    unobserve() {}
    disconnect() {}
  } as never;
  try {
    const m = model();
    const { container } = render(<DeckSky model={m} />);
    const chips = await screen.findByRole("list", { name: "The themes on the sky" });
    const first = m.groups.find((g) => !g.helper)!;
    expect(container.querySelector("text.sky-theme")).toBeNull();
    const chip = screen.getByRole("button", { name: first.name });
    expect(chips).toContainElement(chip);
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  } finally { globalThis.ResizeObserver = RO; }
});

/** ONE NAME PER THEME (persona round, 2026-09-27: "Enchantments entering" on the sky, "Enchantress"
 *  in Game plan, for the same cards). */
test("a constellation that is the deck's named theme takes that name", async () => {
  const { SkyThemeContext } = await import("./DeckSky.js");
  const m = model();
  const g = m.groups.find((x) => !x.helper)!;
  render(<SkyThemeContext.Provider value={{ name: "Clerics Matter", tag: g.tag, count: 5, nonland: 10 }}><DeckSky model={m} /></SkyThemeContext.Provider>);
  expect(screen.getByRole("button", { name: "CLERICS MATTER" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: g.name.toUpperCase() })).toBeNull();
});
