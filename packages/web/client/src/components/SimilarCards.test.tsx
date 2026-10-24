import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import type { SimilarItem } from "@edh-seer/matcher/similar-shard";
import { SimilarCards } from "./SimilarCards.js";

const ITEMS: SimilarItem[] = [
  { name: "Gamble", slug: "gamble", tier: "output", chips: [{ dim: "trigger", label: "when it dies" }] },
  { name: "Ghalta", slug: "ghalta", tier: "same", chips: [] },
  { name: "Beta", slug: "beta", tier: "close", chips: [{ dim: "extra", label: "+ protection" }, { dim: "missing", label: "no haste" }] },
];

const show = (items: SimilarItem[], note?: string) =>
  render(<MemoryRouter><SimilarCards items={items} note={note} /></MemoryRouter>);

test("groups render in tier order under plain-English headings", () => {
  show(ITEMS);
  const heads = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
  expect(heads).toEqual(["Same effect", "Close variants", "Same result, different trigger"]);
  expect(screen.getByRole("heading", { level: 2, name: "Similar cards" })).toBeInTheDocument();
});

test("an empty group is hidden", () => {
  show(ITEMS.filter((i) => i.tier !== "close"));
  expect(screen.queryByRole("heading", { name: "Close variants" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Same effect" })).toBeInTheDocument();
});

test("rows link to the card page and carry their differs-by chips", () => {
  show(ITEMS);
  expect(screen.getByRole("link", { name: "Beta" })).toHaveAttribute("href", "/cards/beta");
  const row = screen.getByRole("link", { name: "Beta" }).closest("li")!;
  expect(within(row).getByText("+ protection")).toBeInTheDocument();
  expect(within(row).getByText("no haste")).toBeInTheDocument();
  expect(within(row).getByText(/differs by/i)).toBeInTheDocument();
  expect(within(screen.getByRole("link", { name: "Ghalta" }).closest("li")!).queryByText(/differs by/i)).toBeNull();
});

test("an empty list renders nothing", () => {
  const { container } = show([]);
  expect(container).toBeEmptyDOMElement();
});

test("the optional note is printed", () => {
  show(ITEMS, "Only cards within this commander's colours.");
  expect(screen.getByText(/within this commander's colours/)).toBeInTheDocument();
});
