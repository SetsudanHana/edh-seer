import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import { CardSearch, SEARCH_LIMIT } from "./CardSearch.js";
import type { NameIndexEntry } from "../lib/partners.js";

const INDEX: NameIndexEntry[] = [
  { slug: "krenko-mob-boss", name: "Krenko, Mob Boss", identity: ["R"], commander: true },
  { slug: "krenkos-command", name: "Krenko's Command", identity: ["R"], commander: false },
  { slug: "jotun-grunt", name: "Jötun Grunt", identity: ["W"], commander: false },
  { slug: "ajanis-chosen", name: "Ajani's Chosen", identity: ["W"], commander: false },
];

const at = (index: NameIndexEntry[] = INDEX, props: Partial<Parameters<typeof CardSearch>[0]> = {}) =>
  render(<MemoryRouter><CardSearch load={async () => index} {...props} /></MemoryRouter>);

test("typing a name lists matching cards as links", async () => {
  at();
  await userEvent.type(await screen.findByRole("searchbox"), "krenko");
  expect(await screen.findByRole("link", { name: /Krenko, Mob Boss/ }))
    .toHaveAttribute("href", "/cards/krenko-mob-boss");
  expect(screen.getByRole("link", { name: /Krenko's Command/ })).toBeInTheDocument();
});

/** THE QUERY IS MATCHED THE WAY THE URL IS BUILT. `slugOf` folds diacritics and drops apostrophes,
 *  so a reader who types what they can reach on their keyboard finds the card -- and finds it under
 *  exactly the spelling the link will use. A raw substring match would answer "Jötun" and not
 *  "jotun", which is the one a reader is more likely to type. */
test("the search folds diacritics and punctuation, because the slug does", async () => {
  at();
  const box = await screen.findByRole("searchbox");
  await userEvent.type(box, "jotun");
  expect(await screen.findByRole("link", { name: /Jötun Grunt/ })).toBeInTheDocument();
  await userEvent.clear(box);
  await userEvent.type(box, "ajanis");
  expect(await screen.findByRole("link", { name: /Ajani's Chosen/ })).toBeInTheDocument();
});

/** A SHARE LINK COPIED BEFORE THE SURFACES MOVED lands here, because `/cards` used to BE the
 *  report's card list. The hash never reaches the server, so no edge rule can tell that link from
 *  someone who typed `/cards` -- the check has to be in the client, and it is the same component
 *  the other two legacy paths use. */
test("a stale share link on /cards hands off to /analysis/cards", () => {
  const replace = vi.fn();
  at(INDEX, { hash: "#deck=abc", replace });
  expect(replace).toHaveBeenCalledWith("/analysis/cards#deck=abc");
});

test("someone who typed /cards is left alone", () => {
  const replace = vi.fn();
  at(INDEX, { hash: "", replace });
  expect(replace).not.toHaveBeenCalled();
});

/** THE BOX IS THE PAGE, so it takes focus on arrival and a reader can type without reaching for a
 *  mouse. It is labelled rather than placeholder-only: a placeholder disappears the moment anyone
 *  types, and is not an accessible name. */
test("the search box is labelled and holds focus on arrival", async () => {
  at();
  const box = await screen.findByRole("searchbox");
  expect(box).toHaveAccessibleName();
  expect(box).toHaveFocus();
});

/** AN EMPTY QUERY IS NOT AN EMPTY PAGE, AND IT IS NOT 15,350 LINKS EITHER. The index is the whole
 *  corpus; rendering it on mount would be the jank the cap exists to prevent, and rendering nothing
 *  reads as a page that failed to load. */
test("before anything is typed the page says what it holds, and lists nothing", async () => {
  at();
  expect(await screen.findByText(/4 cards/)).toBeInTheDocument();
  expect(screen.queryAllByRole("link")).toHaveLength(0);
});

test("a query matching more than the cap shows the cap and says how many it found", async () => {
  const many = Array.from({ length: SEARCH_LIMIT + 7 }, (_, i) => ({
    slug: `goblin-${i}`, name: `Goblin ${i}`, identity: ["R"], commander: false,
  }));
  at(many);
  await userEvent.type(await screen.findByRole("searchbox"), "goblin");
  expect(await screen.findByText(new RegExp(`${SEARCH_LIMIT + 7} cards match`))).toBeInTheDocument();
  expect(screen.getAllByRole("link")).toHaveLength(SEARCH_LIMIT);
});

test("a query that matches nothing says so", async () => {
  at();
  await userEvent.type(await screen.findByRole("searchbox"), "zzzz");
  expect(await screen.findByText(/No card/i)).toBeInTheDocument();
});
