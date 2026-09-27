import { fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { expect, test, vi } from "vitest";
import { CardDrawerProvider, useCardDrawer } from "./card-drawer.js";
import { buildEngineModel } from "../lib/engine-model.js";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { CardMap } from "./CardMap.js";

const model = () => { const { report, graph } = engineDeck(); return buildEngineModel(report, graph); };

/** ONE CARD IN THE MIDDLE OF ITS OWN LINKS (report cohesion audit, 2026-09-27). */
test("draws the cut in the middle of its own links, with no count of its own", () => {
  const m = model();
  render(<CardMap model={m} card={m.cards.get("Reducer")!} />);
  const map = screen.getByTestId("card-map");
  // Reducer makes all eight Clerics cheaper: eight partners, one line each.
  expect(map.querySelectorAll("line")).toHaveLength(8);
  expect(screen.getByRole("img", { name: "Reducer and the cards it works with" })).toBeInTheDocument();
  // The sentence beside the map carries the count; the map's caption is a legend.
  expect(map.querySelector("figcaption")!.textContent).toMatch(/^solid: keeps working/);
  expect(map.querySelector("figcaption")!.textContent).not.toMatch(/\d+ keep/);
});

test("a card with no links is a lone disc in a dashed ring", () => {
  const m = model();
  render(<CardMap model={m} card={m.cards.get("Vanilla")!} />);
  const map = screen.getByTestId("card-map");
  expect(map.querySelectorAll("line")).toHaveLength(0);
  expect(map.querySelector("circle[stroke-dasharray]")).not.toBeNull();
  expect(map).toHaveTextContent("works with nothing here");
});

/** ONE PLACE FOR A CARD (report cohesion audit, 2026-09-27): with the report's extras registered,
 *  the drawer draws the card's own map and walks the commander's map from it, then closes. */
test("the drawer draws the card's map and walks the commander's map from it", async () => {
  const { report, graph } = engineDeck();
  const m = buildEngineModel(report, graph);
  const walk = vi.fn();
  function Register() {
    const { setExtras, open } = useCardDrawer();
    useEffect(() => { setExtras({ model: m, walk }); open("Reducer"); }, [setExtras, open]);
    return null;
  }
  render(<CardDrawerProvider graph={graph}><Register /></CardDrawerProvider>);
  const drawer = await screen.findByTestId("card-inspector");
  expect(within(drawer).getByTestId("card-map")).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole("button", { name: "Walk the map from here" }));
  expect(walk).toHaveBeenCalledWith("Reducer");
  expect(screen.queryByTestId("card-inspector")).toBeNull();
});
