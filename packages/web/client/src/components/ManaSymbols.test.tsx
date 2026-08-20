import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ManaSymbols, parseManaCost } from "./ManaSymbols.js";

describe("parseManaCost", () => {
  test("splits a plain cost into its symbols", () => {
    expect(parseManaCost("{3}{B}{B}").map((s) => s.code)).toEqual(["3", "B", "B"]);
  });

  // Scryfall writes hybrid and phyrexian with a slash; its SVG files drop it (WU.svg, BP.svg).
  test("normalises hybrid and phyrexian to the file naming Scryfall uses", () => {
    expect(parseManaCost("{W/U}{B/P}").map((s) => s.code)).toEqual(["WU", "BP"]);
  });

  test("every symbol carries a text alternative", () => {
    const [three, black] = parseManaCost("{3}{B}");
    expect(three!.label).toBe("3 generic mana");
    expect(black!.label).toBe("one black mana");
    expect(parseManaCost("{X}")[0]!.label).toBe("X generic mana");
  });

  // A cost we cannot parse must survive as text rather than vanish or throw: the reader still
  // needs to see SOMETHING in the column.
  test("unparseable input comes back as one raw symbol", () => {
    expect(parseManaCost("banana")).toEqual([{ raw: "banana", code: "", label: "banana" }]);
    expect(parseManaCost("")).toEqual([]);
  });
});

test("renders one image per symbol, each with its own text alternative", () => {
  render(<ManaSymbols cost="{3}{B}{B}" />);
  const imgs = screen.getAllByRole("img", { name: /mana/ });
  // 3 symbols + the wrapper's own label
  expect(imgs.length).toBeGreaterThanOrEqual(3);
  expect(screen.getByAltText("3 generic mana")).toBeInTheDocument();
  expect(screen.getAllByAltText("one black mana")).toHaveLength(2);
});

// A land has no mana cost. An em dash is the established "not applicable" mark in this report
// (deckCastability already renders one rather than a misleading 0%).
test("an empty cost renders an em dash, not an empty cell", () => {
  render(<ManaSymbols cost="" />);
  expect(screen.getByText("—")).toBeInTheDocument();
});

test("an unreadable cost prints verbatim rather than disappearing", () => {
  render(<ManaSymbols cost="banana" />);
  expect(screen.getByText("banana")).toBeInTheDocument();
});
