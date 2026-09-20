import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ManaSymbols, manaClass, ManaText, parseManaCost } from "./ManaSymbols.js";

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

// THE ACCESSIBLE NAME IS THE CONTRACT, NOT THE ELEMENT. The mark became a mana-font glyph on
// 2026-09-20; what a screen reader gets must not change with it, which is the whole answer to the
// "a webfont tells a screen reader nothing" objection this file used to carry.
test("a COST is announced once, as one fact", () => {
  render(<ManaSymbols cost="{3}{B}{B}" />);
  // One image, not three: "{3}{B}{B}" is a single cost, and the Scryfall markup that labelled both
  // the wrapper AND every symbol announced every cost on the site twice.
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(screen.getByRole("img", { name: "3 generic mana, one black mana, one black mana" })).toBeInTheDocument();
});

// The glyph is a private-use codepoint, so it must never be read out on its own.
test("the private-use glyph never reaches the accessibility tree itself", () => {
  const { container } = render(<ManaSymbols cost="{T}" />);
  const glyph = container.querySelector("i.ms");
  expect(glyph).not.toBeNull();
  expect(glyph!.className).toContain("ms-tap");
  expect(glyph!.getAttribute("aria-hidden")).toBe("true");
});

// ...and inside a SENTENCE the glyph IS the labelled thing, because there is no wrapper that could
// hold the label without swallowing the sentence around it.
test("in a sentence the glyph carries the label itself", () => {
  const { container } = render(<ManaText text="{T}, Sacrifice an artifact" />);
  const glyph = container.querySelector("i.ms")!;
  expect(glyph.getAttribute("role")).toBe("img");
  expect(glyph.getAttribute("aria-label")).toBe("tap this permanent");
});

// mana names two symbols differently from Scryfall and the rest are the code lower-cased.
// Checked against all 565 classes in mana.min.css rather than assumed.
test("the class is the Scryfall code lower-cased, with tap and untap renamed", () => {
  expect(manaClass("T")).toBe("tap");
  expect(manaClass("Q")).toBe("untap");
  expect(manaClass("WU")).toBe("wu");
  expect(manaClass("BP")).toBe("bp");
  expect(manaClass("15")).toBe("15");
  expect(manaClass("X")).toBe("x");
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

// A COST ROW AND A PRINTED LINE ARE NOT PURE SYMBOL STRINGS (owner, 2026-09-20, on the deployed
// card page): "{T}, Sacrifice an artifact" and "Noncreature spells you cast cost {X} less to cast"
// rendered their braces verbatim while the card image beside them drew the real symbols.
describe("ManaText", () => {
  test("draws the symbols inside a sentence and keeps the words between them", () => {
    render(<ManaText text="{T}, Sacrifice an artifact" />);
    expect(screen.getByRole("img", { name: "tap this permanent" })).toBeInTheDocument();
    expect(screen.getByText(/, Sacrifice an artifact/)).toBeInTheDocument();
  });

  test("a symbol mid-sentence is drawn where it sits", () => {
    render(<ManaText text="Noncreature spells you cast cost {X} less to cast." />);
    expect(screen.getByRole("img", { name: "X generic mana" })).toBeInTheDocument();
    expect(screen.getByText(/Noncreature spells you cast cost/)).toBeInTheDocument();
    expect(screen.getByText(/less to cast\./)).toBeInTheDocument();
  });

  test("text with no symbol renders as plain text, and empty renders nothing", () => {
    const { container } = render(<ManaText text="Haste" />);
    expect(container.textContent).toBe("Haste");
    expect(container.querySelector("i.ms")).toBeNull();
    expect(render(<ManaText text="" />).container.textContent).toBe("");
  });

  // A LOYALTY COST IS NOT A MANA SYMBOL. "+1" and "-7" carry no braces, so nothing is drawn and
  // `LoyaltyCost` keeps its own badge -- this must not start eating them.
  test("a loyalty cost passes through untouched", () => {
    const { container } = render(<ManaText text="+1" />);
    expect(container.textContent).toBe("+1");
    expect(container.querySelector("i.ms")).toBeNull();
  });
});

// A BRACE IS NOT A PROMISE THAT WHAT IS INSIDE IT IS A SYMBOL. `ManaText` reads clause text, so
// the token between the braces is whatever the card (or a corpus defect) printed. It used to go
// straight into a URL -- CodeQL called that on PR #409 as `js/xss-through-dom`, the concrete shape
// being the traversal `{../../x}` -> `.../card-symbols/../../x.svg`. Nothing is fetched per symbol
// any more, and the guard still matters: an unknown token must not become an unknown CSS class
// either, and the reader should see the text the card printed rather than an empty box.
describe("an unknown token never becomes a class", () => {
  test.each(["{../../x}", "{a b}", "{W.U}", "{TOOLONGTOKEN}", "{}"])("%s renders as text", (raw) => {
    const { container } = render(<ManaText text={`cost ${raw} here`} />);
    expect(container.querySelector("i.ms")).toBeNull();
    expect(container.textContent).toContain(raw);
  });

  test("the real symbols still draw", () => {
    const { container } = render(<ManaText text="{T}{W/U}{B/P}{15}{X}" />);
    expect(container.querySelectorAll("i.ms")).toHaveLength(5);
  });
});
