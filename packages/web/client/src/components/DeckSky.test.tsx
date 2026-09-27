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
