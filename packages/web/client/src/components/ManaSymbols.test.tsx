import { describe, expect, test } from "vitest";
import { parseManaCost } from "./ManaSymbols.js";

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
