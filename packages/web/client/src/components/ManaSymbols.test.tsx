import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ManaSymbols, ManaText, parseManaCost } from "./ManaSymbols.js";

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

// A COST ROW AND A PRINTED LINE ARE NOT PURE SYMBOL STRINGS (owner, 2026-09-20, on the deployed
// card page): "{T}, Sacrifice an artifact" and "Noncreature spells you cast cost {X} less to cast"
// rendered their braces verbatim while the card image beside them drew the real symbols.
describe("ManaText", () => {
  test("draws the symbols inside a sentence and keeps the words between them", () => {
    render(<ManaText text="{T}, Sacrifice an artifact" />);
    expect(screen.getByAltText("tap this permanent")).toBeInTheDocument();
    expect(screen.getByText(/, Sacrifice an artifact/)).toBeInTheDocument();
  });

  test("a symbol mid-sentence is drawn where it sits", () => {
    render(<ManaText text="Noncreature spells you cast cost {X} less to cast." />);
    expect(screen.getByAltText("X generic mana")).toBeInTheDocument();
    expect(screen.getByText(/Noncreature spells you cast cost/)).toBeInTheDocument();
    expect(screen.getByText(/less to cast\./)).toBeInTheDocument();
  });

  test("text with no symbol renders as plain text, and empty renders nothing", () => {
    const { container } = render(<ManaText text="Haste" />);
    expect(container.textContent).toBe("Haste");
    expect(container.querySelector("img")).toBeNull();
    expect(render(<ManaText text="" />).container.textContent).toBe("");
  });

  // A LOYALTY COST IS NOT A MANA SYMBOL. "+1" and "-7" carry no braces, so nothing is drawn and
  // `LoyaltyCost` keeps its own badge -- this must not start eating them.
  test("a loyalty cost passes through untouched", () => {
    const { container } = render(<ManaText text="+1" />);
    expect(container.textContent).toBe("+1");
    expect(container.querySelector("img")).toBeNull();
  });
});

// A BRACE IS NOT A PROMISE THAT WHAT IS INSIDE IT IS A SYMBOL. `ManaText` reads clause text, so
// the token between the braces is whatever the card (or a corpus defect) printed, and it used to
// go straight into a URL -- CodeQL called it on PR #409 as `js/xss-through-dom`, and the concrete
// shape is a traversal: `{../../x}` builds `.../card-symbols/../../x.svg`. Anything that is not a
// symbol code renders as the raw text it always was, which is also what a reader should see
// instead of a 404 image.
describe("an unknown token never becomes a URL", () => {
  test.each(["{../../x}", "{a b}", "{W.U}", "{TOOLONGTOKEN}", "{}"])("%s renders as text", (raw) => {
    const { container } = render(<ManaText text={`cost ${raw} here`} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(raw);
  });

  test("the real symbols still draw", () => {
    const { container } = render(<ManaText text="{T}{W/U}{B/P}{15}{X}" />);
    expect(container.querySelectorAll("img")).toHaveLength(5);
  });
});
