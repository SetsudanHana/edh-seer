import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import { LegacyDeckRedirect } from "./LegacyDeckRedirect.js";

/** A SHARE LINK IS `path + #deck=<payload>`, AND THE HASH NEVER REACHES THE SERVER. Links already
 *  in the wild point at `/cards`, which is about to be the card SEARCH page -- so no Cloudflare
 *  redirect can tell a stale share link from a genuine visit, and the check has to be here. */
test("a stale share link keeps its hash and lands on the analysis surface", () => {
  const replace = vi.fn();
  render(
    <MemoryRouter initialEntries={["/cards"]}>
      <LegacyDeckRedirect to="/analysis/cards" hash="#deck=abc" replace={replace} />
    </MemoryRouter>,
  );
  expect(replace).toHaveBeenCalledWith("/analysis/cards#deck=abc");
});

test("no deck in the hash means no redirect", () => {
  const replace = vi.fn();
  render(
    <MemoryRouter initialEntries={["/cards"]}>
      <LegacyDeckRedirect to="/analysis/cards" hash="" replace={replace} />
    </MemoryRouter>,
  );
  expect(replace).not.toHaveBeenCalled();
});

/** A HASH THAT IS NOT A DECK IS NOT A SHARE LINK. An anchor, a fragment, anything else: the visitor
 *  wanted the page they asked for. */
test("a hash that is not a deck payload is left alone", () => {
  const replace = vi.fn();
  render(
    <MemoryRouter initialEntries={["/cards"]}>
      <LegacyDeckRedirect to="/analysis/cards" hash="#anchor" replace={replace} />
    </MemoryRouter>,
  );
  expect(replace).not.toHaveBeenCalled();
});
