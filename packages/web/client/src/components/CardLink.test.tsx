import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import { CardLink } from "./CardLink.js";
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
