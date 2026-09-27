import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { CardDrawerProvider } from "./card-drawer.js";
import { CardLinksContext, CardMenuButton } from "./card-menu.js";

function list(name: string, show = vi.fn()) {
  const { graph } = engineDeck();
  render(
    <CardDrawerProvider graph={graph}>
      <CardLinksContext.Provider value={{ idOf: (n) => (n === "Payoff B" ? "Payoff B" : undefined), show }}>
        <CardMenuButton name={name} />
      </CardLinksContext.Provider>
    </CardDrawerProvider>,
  );
  return show;
}

test("the ⋯ beside a card in a list offers what a player can do with it", async () => {
  const show = list("Payoff B");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More for Payoff B" }));
  const menu = screen.getByRole("menu", { name: "Payoff B" });
  expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
    "See how it connects", "Read the card", "Pin it in the report", "Open its card page↗", "Copy the name",
  ]);
  await user.click(within(menu).getByRole("menuitem", { name: "See how it connects" }));
  expect(show).toHaveBeenCalledWith("Payoff B");
  expect(screen.queryByRole("menu")).toBeNull();
});

test("Escape closes the menu and gives focus back to its button; the pin sticks", async () => {
  list("Payoff B");
  const user = userEvent.setup();
  const button = screen.getByRole("button", { name: "More for Payoff B" });
  await user.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  await user.keyboard("{ArrowDown}{Enter}");
  // The second line, "Read the card", opened the drawer and closed the menu.
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
