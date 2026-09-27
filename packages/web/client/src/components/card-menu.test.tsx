import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { CardDrawerProvider } from "./card-drawer.js";
import { CardMenuButton } from "./card-menu.js";

function list(name: string) {
  const { graph } = engineDeck();
  render(
    <CardDrawerProvider graph={graph}>
      <CardMenuButton name={name} />
    </CardDrawerProvider>,
  );
}

test("the ⋯ beside a card in a list offers what a player can do with it", async () => {
  list("Payoff B");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More for Payoff B" }));
  const menu = screen.getByRole("menu", { name: "Payoff B" });
  // ONE PLACE FOR A CARD (report cohesion audit, 2026-09-27): "See how it connects" opened a second,
  // full-screen map; the card's links are now drawn in the drawer "Read the card" opens.
  expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
    "Read the card", "Pin it in the report", "Open its card page↗", "Copy the name",
  ]);
  await user.click(within(menu).getByRole("menuitem", { name: "Read the card" }));
  expect(screen.getByTestId("card-inspector")).toBeInTheDocument();
  expect(screen.queryByRole("menu")).toBeNull();
});

test("Escape closes the menu and gives focus back to its button; the pin sticks", async () => {
  list("Payoff B");
  const user = userEvent.setup();
  const button = screen.getByRole("button", { name: "More for Payoff B" });
  await user.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
  // The first line, "Read the card", opened the drawer and closed the menu.
  expect(screen.queryByRole("menu")).toBeNull();
  await user.click(button);
  await user.click(screen.getByRole("menuitem", { name: "Pin it in the report" }));
  await user.click(button);
  expect(screen.getByRole("menuitem", { name: "Unpin it in the report" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(button).toHaveFocus();
});

test("a card the report does not carry gets only its page and its name", async () => {
  list("Swap In");
  await userEvent.setup().click(screen.getByRole("button", { name: "More for Swap In" }));
  expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Open its card page↗", "Copy the name"]);
  expect(screen.getByRole("menuitem", { name: /Open its card page/ })).toHaveAttribute("href", "/cards/swap-in");
});
