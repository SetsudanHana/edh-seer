import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test } from "vitest";
import type { SuggestedCard, SuggestedPair } from "@edh-seer/matcher/suggest-static";
import { CardDrawerProvider } from "./card-drawer.js";
import { SuggestedCards } from "./SuggestedCards.js";
import { SwapLine } from "./SuggestedPairs.js";

const card: SuggestedCard = {
  name: "Pious Evangel", slug: "pious-evangel", identity: ["W"], mv: 3,
  connections: ["A", "B", "C"],
  reasons: [{ text: "Pious Evangel puts cards into the graveyard that Thwart the Grave can bring back", others: ["B"] }],
  oracle: "Whenever Pious Evangel or another creature enters, you gain 1 life.",
};
const graph = { nodes: [], edges: [] } as never;

function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }
function page(children: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <CardDrawerProvider graph={graph}>
        <Routes><Route path="*" element={<>{children}<Where /></>} /></Routes>
      </CardDrawerProvider>
    </MemoryRouter>,
  );
}

test("a suggested card opens in the drawer and the report stays", async () => {
  page(<SuggestedCards cards={[card]} empty="" />);
  await userEvent.click(screen.getByRole("link", { name: "Pious Evangel" }));
  expect(screen.getByTestId("where").textContent).toBe("/");
  const drawer = screen.getByTestId("suggestion-drawer");
  expect(drawer).toHaveTextContent("Not in your deck");
  expect(drawer).toHaveTextContent("Works with 3 of your cards.");
  expect(drawer).toHaveTextContent("(and 1 more of your cards)");
  expect(within(drawer).getByRole("link", { name: /Open its card page/ })).toHaveAttribute("href", "/cards/pious-evangel");
});

test("a click with a modifier still follows the link to the card's page", () => {
  page(<SuggestedCards cards={[card]} empty="" />);
  fireEvent.click(screen.getByRole("link", { name: "Pious Evangel" }), { ctrlKey: true });
  expect(screen.queryByTestId("suggestion-drawer")).toBeNull();
});

test("a swap's card names the slot it can take, never the cut's own count", async () => {
  const pair: SuggestedPair = { cut: "Stick Together", cutConnections: 4, add: card, rule: "no-role", counts: [] };
  page(<SwapLine p={pair} />);
  await userEvent.click(screen.getByRole("link", { name: "Pious Evangel" }));
  const drawer = screen.getByTestId("suggestion-drawer");
  expect(drawer).toHaveTextContent("Can take Stick Together’s slot.");
  // The close control and a click away both close it.
  await userEvent.click(within(drawer).getByRole("button", { name: "close" }));
  expect(screen.queryByTestId("suggestion-drawer")).toBeNull();
});

test("a staple with no links is suggested for its job, never for working with 0 cards", async () => {
  page(<SuggestedCards cards={[{ ...card, name: "Fellwar Stone", slug: "fellwar-stone", connections: [], reasons: [], fills: "Ramp" }]} empty="" />);
  await userEvent.click(screen.getByRole("link", { name: "Fellwar Stone" }));
  const drawer = screen.getByTestId("suggestion-drawer");
  expect(drawer).toHaveTextContent("Suggested for its job: counts as ramp.");
  expect(drawer).not.toHaveTextContent("Works with 0");
});
