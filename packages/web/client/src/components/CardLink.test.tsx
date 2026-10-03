import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import { CardLink, Unpaged } from "./CardLink.js";
import { PeekContext, type PeekApi } from "./peek.js";

/** A CARD LINK PEEKS ON A PLAIN CLICK AND NAVIGATES ON A MODIFIER (#1003). The precon page's swaps
 *  and decklist were bare links that left the page; this is the rule they follow now. */
test("a plain click peeks the card; a modifier click leaves it to the link", () => {
  const push = vi.fn();
  const peek: PeekApi = { stack: [], push, back: () => {}, close: () => {} };
  render(<MemoryRouter><PeekContext.Provider value={peek}><CardLink name="Godless Shrine" slug="godless-shrine">Godless Shrine</CardLink></PeekContext.Provider></MemoryRouter>);
  const link = screen.getByRole("link", { name: "Godless Shrine" });
  expect(link).toHaveAttribute("href", "/cards/godless-shrine");
  expect(fireEvent.click(link)).toBe(false);
  expect(push).toHaveBeenCalledWith("godless-shrine", link);
  push.mockClear();
  fireEvent.click(link, { metaKey: true });
  expect(push).not.toHaveBeenCalled();
});

/** A CARD WITH NO PAGE IS NAMED, NOT LINKED (#1003 review: Godless Shrine's swap went to a 404). */
test("a card the page lists as unpaged is text, not a link", () => {
  render(<MemoryRouter><Unpaged.Provider value={new Set(["Plains"])}><CardLink name="Plains">Plains</CardLink><CardLink name="Sol Ring">Sol Ring</CardLink></Unpaged.Provider></MemoryRouter>);
  expect(screen.queryByRole("link", { name: "Plains" })).toBeNull();
  expect(screen.getByText("Plains")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sol Ring" })).toHaveAttribute("href", "/cards/sol-ring");
});
