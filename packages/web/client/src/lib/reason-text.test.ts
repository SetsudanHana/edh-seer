import { expect, test } from "vitest";
import { reasonSegments } from "./reason-text.js";

const cards = new Set(["Doomwake Giant", "Kaya's Ghostform", "Extraordinary Journey"]);
const tokens = new Map([["Mark of the Rani", "The Rani"], ["Clue", undefined]]);

/** S18, the skeptic's sharpest finding: "the page asserts a relationship between two named cards
 *  and never prints either card's text, so a right answer and a wrong one look identical on my
 *  screen". The names have to come out of the sentence before either can be made checkable. */
test("a sentence's card names come back as cards, and the prose between them as prose", () => {
  const segs = reasonSegments("When Kaya's Ghostform enters, Doomwake Giant triggers", cards, tokens);
  expect(segs.map((s) => s.kind)).toEqual(["text", "card", "text", "card", "text"]);
  expect(segs.filter((s) => s.kind === "card").map((s) => s.text))
    .toEqual(["Kaya's Ghostform", "Doomwake Giant"]);
  expect(segs.map((s) => s.text).join("")).toBe("When Kaya's Ghostform enters, Doomwake Giant triggers");
});

/** FIVE OF THE EXAMPLE DECK'S EIGHT high-synergy reasons begin "When Mark of the Rani enters", and
 *  that is the commander's TOKEN -- not in the decklist, not in the drawer's index, and never named
 *  as one. Both the tuner and the skeptic could not tell whether it was a card, a token or a typo. */
test("a token is marked as one and carries the card that makes it", () => {
  const segs = reasonSegments("When Mark of the Rani enters, Doomwake Giant triggers", cards, tokens);
  const tok = segs.find((s) => s.kind === "token")!;
  expect(tok.text).toBe("Mark of the Rani");
  expect(tok.kind === "token" && tok.maker).toBe("The Rani");
});

test("a token nothing in the deck makes is still marked, without inventing a maker", () => {
  const segs = reasonSegments("When Clue enters, Doomwake Giant triggers", cards, tokens);
  const tok = segs.find((s) => s.kind === "token")!;
  expect(tok.kind === "token" && tok.maker).toBeUndefined();
});

/** LONGEST FIRST, the same rule `reasonTemplate` states one file over: a short name that is a
 *  prefix of a long one would otherwise leave half a name behind as prose. */
test("a name contained inside a longer name never splits it", () => {
  const both = new Set(["Kefka, Court Mage", "Kefka, Court Mage // Kefka, Ruler of Ruin"]);
  const segs = reasonSegments("Kefka, Court Mage // Kefka, Ruler of Ruin draws you 1 card", both);
  expect(segs[0]!.kind).toBe("card");
  expect(segs[0]!.text).toBe("Kefka, Court Mage // Kefka, Ruler of Ruin");
});

/** A NAME IN BOTH SETS IS A CARD. 92 of 661 distinct token names collide with a real card's, and
 *  the drawer settles that collision the same way -- the decklist is what the reader holds. */
test("a token sharing a real card's name is read as the card", () => {
  const segs = reasonSegments("Doomwake Giant triggers", cards, new Map([["Doomwake Giant", "X"]]));
  expect(segs[0]!.kind).toBe("card");
});

test("a sentence naming nothing known survives intact", () => {
  const segs = reasonSegments("Something entirely unrelated happens", cards, tokens);
  expect(segs).toEqual([{ kind: "text", text: "Something entirely unrelated happens" }]);
});

// Regex metacharacters in a name are data, never syntax -- names carry ' , - // and + .
test("a name with regex metacharacters is matched literally", () => {
  const segs = reasonSegments("Aether Vial (M) + friends", new Set(["Aether Vial (M) + friends"]));
  expect(segs).toEqual([{ kind: "card", text: "Aether Vial (M) + friends" }]);
});
