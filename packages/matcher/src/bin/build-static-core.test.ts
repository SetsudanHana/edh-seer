import { expect, test } from "vitest";
import { anchorOf, comboIndex, cardFileName } from "./build-static-core.js";

/** THE ANCHOR IS WHY THE INDEX IS EXACT RATHER THAN APPROXIMATE. A combo is contained in a deck
 *  only if EVERY one of its cards is present, so it can only ever match if its alphabetically-first
 *  card is present — index by that and each combo lands in exactly one bucket with no loss.
 *  Measured 2026-08-30: embedding beats one 1.60 MB gz blob 120x on the median deck
 *  (p50 13.4 KB gz) and breaks even only after ~70 decks. */
test("a combo is anchored on its alphabetically-first card, whatever order it was stored in", () => {
  expect(anchorOf(["Thassa's Oracle", "Demonic Consultation"])).toBe("Demonic Consultation");
  expect(anchorOf(["Demonic Consultation", "Thassa's Oracle"])).toBe("Demonic Consultation");
});

test("every combo lands in exactly one bucket", () => {
  const combos = [
    { cards: ["B", "A"], result: "win" },
    { cards: ["A", "C"], result: "win" },
    { cards: ["C", "D"], result: "draw" },
  ];
  const idx = comboIndex(combos);
  expect(idx.get("A")).toHaveLength(2);
  expect(idx.get("C")).toHaveLength(1);
  expect(idx.get("B")).toBeUndefined();
  expect([...idx.values()].flat()).toHaveLength(combos.length);
});

/** A CARD NAME IS NOT A FILENAME. Slashes in a split card's name would write outside the output
 *  directory, and a colon or a question mark is illegal on some filesystems. Percent-encoding is
 *  what `fetch` does to a URL anyway, so the client needs no separate rule. */
test("a name with a slash, a comma and an apostrophe survives the round trip as one path segment", () => {
  const n = cardFileName("fell the profane // fell mire");
  expect(n).not.toContain("/");
  expect(decodeURIComponent(n)).toBe("fell the profane // fell mire");
  expect(cardFileName("krenko, mob boss")).toBe(encodeURIComponent("krenko, mob boss"));
});
