import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { buildEngineModel } from "../lib/engine-model.js";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { CutMap } from "./CutMap.js";

const model = () => { const { report, graph } = engineDeck(); return buildEngineModel(report, graph); };

/** WHY A CUT IS A CUT, DRAWN (report cohesion audit, 2026-09-27). */
test("draws the cut in the middle of its own links, with no count of its own", () => {
  const m = model();
  render(<CutMap model={m} card={m.cards.get("Reducer")!} />);
  const map = screen.getByTestId("cut-map");
  // Reducer makes all eight Clerics cheaper: eight partners, one line each.
  expect(map.querySelectorAll("line")).toHaveLength(8);
  expect(screen.getByRole("img", { name: "Reducer and the cards it works with" })).toBeInTheDocument();
  // The sentence beside the map carries the count; the map's caption is a legend.
  expect(map.querySelector("figcaption")!.textContent).toMatch(/^solid: keeps working/);
  expect(map.querySelector("figcaption")!.textContent).not.toMatch(/\d+ keep/);
});

test("a card with no links is a lone disc in a dashed ring", () => {
  const m = model();
  render(<CutMap model={m} card={m.cards.get("Vanilla")!} />);
  const map = screen.getByTestId("cut-map");
  expect(map.querySelectorAll("line")).toHaveLength(0);
  expect(map.querySelector("circle[stroke-dasharray]")).not.toBeNull();
  expect(map).toHaveTextContent("works with nothing here");
});
