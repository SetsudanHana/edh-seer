import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { CardContextMenu } from "./pop-menu.js";

/** RIGHT-CLICK OR LONG-PRESS ON ANY CARD OPENS THE ONE MENU (#1003; owner, 2026-10-03: "I would
 *  have it consistent"). A surface opts in with `data-card`; "Read the card" is its own plain click. */
function mount(onOpen = vi.fn()) {
  render(
    <MemoryRouter>
      <CardContextMenu />
      <button type="button" data-card="Sol Ring" onClick={onOpen}>Sol Ring</button>
      <a href="/cards/x" data-card="Godless Shrine" data-card-slug="godless-shrine-x">Godless Shrine</a>
      <p>not a card</p>
    </MemoryRouter>,
  );
  return onOpen;
}

afterEach(() => vi.useRealTimers());

test("a right-click on a card opens the card menu, and Read the card is the card's own click", async () => {
  const onOpen = mount();
  fireEvent.contextMenu(screen.getByText("Sol Ring"), { clientX: 10, clientY: 10 });
  const menu = screen.getByRole("menu", { name: "Sol Ring" });
  expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
    "Read the card", "Open its card page", "Copy the name",
  ]);
  await userEvent.click(within(menu).getByRole("menuitem", { name: "Read the card" }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menu")).toBeNull();
});

test("the card page line follows the surface's own slug", () => {
  mount();
  fireEvent.contextMenu(screen.getByText("Godless Shrine"), { clientX: 10, clientY: 10 });
  expect(screen.getByRole("menuitem", { name: /Open its card page/ })).toHaveAttribute("href", "/cards/godless-shrine-x");
});

test("a right-click anywhere else is the browser's", () => {
  mount();
  expect(fireEvent.contextMenu(screen.getByText("not a card"))).toBe(true);
  expect(screen.queryByRole("menu")).toBeNull();
});

/** jsdom has no PointerEvent, so `pointerType` is set by hand on a mouse event of that name. */
function touch(el: Element, type: "pointerdown" | "pointerup") {
  const e = new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 });
  Object.defineProperty(e, "pointerType", { value: "touch" });
  el.dispatchEvent(e);
}

test("a long press opens it on touch; a short one does not", () => {
  vi.useFakeTimers();
  mount();
  const card = screen.getByText("Sol Ring");
  touch(card, "pointerdown");
  vi.advanceTimersByTime(200);
  touch(card, "pointerup");
  vi.advanceTimersByTime(600);
  expect(screen.queryByRole("menu")).toBeNull();
  touch(card, "pointerdown");
  act(() => { vi.advanceTimersByTime(600); });
  expect(screen.getByRole("menu", { name: "Sol Ring" })).toBeInTheDocument();
});
