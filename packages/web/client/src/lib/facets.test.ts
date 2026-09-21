import { expect, test, describe } from "vitest";
import { coloursFit, eventsFromParams, eventsToParams, intersect, rateLabel, compileCharacteristics, filterKindsOf, withoutFilterKind, type EventQuery } from "./facets.js";

/** THE SEARCH IS ASKED IN EVENTS (spec 2026-09-19): repeated params because a key can carry a
 *  comma, everything ANDs, and identity is fits-in on Cards and exact on Commanders. */

/** A JOINED LIST WOULD HAVE BEEN UNSPLITTABLE. 274 of the 1,187 corpus keys contain a comma; this
 *  pins the param shape against a "tidy it into one param" change. */
test("a key carrying a comma survives the round trip", () => {
  const comma = "fills|creature,enchantment|-|-";
  const params = eventsToParams({ produce: [comma, "enters|land|-|-"], consume: [], colours: ["R", "G"], types: [], subtypes: [] }, new URLSearchParams());
  expect(params.getAll("produce")).toEqual([comma, "enters|land|-|-"]);
  expect(eventsFromParams(params)).toEqual({ produce: [comma, "enters|land|-|-"], consume: [], colours: ["R", "G"], types: [], subtypes: [] });
});

test("a static key carrying colons and commas survives too", () => {
  const key = "applies:cost-reduction|creature,artifact|cleric,rogue|-";
  const params = eventsToParams({ produce: [], consume: [key], colours: [], types: [], subtypes: [] }, new URLSearchParams());
  expect(eventsFromParams(params).consume).toEqual([key]);
});

test("params the reader did not set are left alone, and an emptied group is removed", () => {
  const before = new URLSearchParams("q=samut&produce=a&produce=b&colors=RG");
  const after = eventsToParams({ produce: [], consume: ["c"], colours: [], types: [], subtypes: [] }, before);
  expect(after.get("q")).toBe("samut");
  expect(after.getAll("produce")).toEqual([]);
  expect(after.getAll("consume")).toEqual(["c"]);
  expect(after.get("colors")).toBeNull();
});

/** `does` AND `theme` ARE NOT READ ANY MORE. An old shared link lands on an unfiltered page rather
 *  than on an answer to a question the vocabulary no longer has. */
test("the retired params are ignored, not honoured", () => {
  const q = eventsFromParams(new URLSearchParams("does=draw-card&theme=tokens&produce=a"));
  expect(q).toEqual({ produce: ["a"], consume: [], colours: [], types: [], subtypes: [] });
});

/** THE REVERSAL (owner 2026-09-19): a card list is read while building a deck, a commander list to
 *  choose a commander. The 2026-09-08 exact-on-both ruling survives on Commanders. */
test("colours: fits-in on Cards, exact on Commanders", () => {
  expect(coloursFit("R", ["R", "G"], "cards")).toBe(true);
  expect(coloursFit("RG", ["R", "G"], "cards")).toBe(true);
  expect(coloursFit("", ["R", "G"], "cards")).toBe(true);
  expect(coloursFit("RU", ["R", "G"], "cards")).toBe(false);
  expect(coloursFit("R", ["R", "G"], "commanders")).toBe(false);
  expect(coloursFit("RG", ["R", "G"], "commanders")).toBe(true);
  expect(coloursFit("R", [], "cards")).toBe(true);
});

test("C is colourless only, on both pages", () => {
  expect(coloursFit("", ["C"], "cards")).toBe(true);
  expect(coloursFit("", ["C"], "commanders")).toBe(true);
  expect(coloursFit("R", ["C"], "cards")).toBe(false);
});

test("intersect keeps only the ids in every list", () => {
  expect([...intersect([[1, 2, 3], [2, 3, 4], [3, 2]])].sort()).toEqual([2, 3]);
  expect([...intersect([[1, 2], []])]).toEqual([]);
  expect([...intersect([[5, 6]])].sort()).toEqual([5, 6]);
  expect([...intersect([])]).toEqual([]);
});

/** THE RATE LABELS STAY (`HighSynergyCards` prints them); only the rate ORDER went with the chip
 *  that named its family. */
test("a rate still prints both ends", () => {
  expect(rateLabel([1, 1, 1, 1], "cards")).toBe("1 card / 1 mana");
  expect(rateLabel([0, 3, 9, 3], "cards")).toBe("0–9 cards / 3 mana");
  expect(rateLabel([1, 8, 1, 4, 1], "cards")).toBe("1 card / 8 mana, then 1 / 4, from next turn");
});

/** WHAT THE CARD IS (owner, 2026-09-21). The URL is the shareable state of this page, so a
 *  dimension that does not round-trip is a filter that vanishes when a link is sent. */
test("types, subtypes, mana value and order survive the URL", () => {
  const q: EventQuery = {
    produce: ["mill|-|-|-"], consume: [], colours: ["U"],
    types: ["instant"], subtypes: ["sliver"], maxMv: 3, sort: "mv",
  };
  const round = eventsFromParams(eventsToParams(q, new URLSearchParams()));
  expect(round).toEqual(q);
});

test("the default order is not written into the link", () => {
  const p = eventsToParams({ produce: [], consume: [], colours: [], types: [], subtypes: [], sort: "partners" }, new URLSearchParams());
  expect(p.get("sort")).toBeNull();
});

/** A BAD VALUE IS NO FILTER, NOT A CONFIDENT EMPTY LIST. `?mv=abc` reading as "at most 0 mana"
 *  would answer a question nobody asked, and answer it wrongly. */
test("a junk mana value asks nothing", () => {
  expect(eventsFromParams(new URLSearchParams("mv=abc")).maxMv).toBeUndefined();
  expect(eventsFromParams(new URLSearchParams("mv=-2")).maxMv).toBeUndefined();
  expect(eventsFromParams(new URLSearchParams("sort=sideways")).sort).toBeUndefined();
});

describe("characteristicsFit", () => {
  const vocab = { types: ["artifact", "creature", "instant"], subtypes: ["sliver", "wizard"] };
  const ask = (q: Partial<Pick<EventQuery, "types" | "subtypes" | "maxMv">>) =>
    ({ types: [], subtypes: [], ...q });

  test("every chosen type must match, the same AND the event chips use", () => {
    const artifactCreature = { t: [0, 1], mv: 2 };
    expect(compileCharacteristics(ask({ types: ["artifact", "creature"] }), vocab)(artifactCreature)).toBe(true);
    expect(compileCharacteristics(ask({ types: ["artifact", "instant"] }), vocab)(artifactCreature)).toBe(false);
  });

  /** THE POINT OF COMPILING: one predicate, many cards. Resolving names per card cost a 488-entry
   *  scan each, over 25,582 rows, on every keystroke. */
  test("one compiled predicate answers for every card", () => {
    const fits = compileCharacteristics(ask({ subtypes: ["sliver"], maxMv: 3 }), vocab);
    expect([{ s: [0], mv: 2 }, { s: [0], mv: 4 }, { s: [1], mv: 1 }, { s: [0] }].map(fits))
      .toEqual([true, false, false, true]);
  });

  test("a subtype is matched by code, not by name", () => {
    expect(compileCharacteristics(ask({ subtypes: ["sliver"] }), vocab)({ s: [0] })).toBe(true);
    expect(compileCharacteristics(ask({ subtypes: ["sliver"] }), vocab)({ s: [1] })).toBe(false);
  });

  /** ABSENT `mv` IS ZERO, which is what the artifact means by leaving it out -- and zero is the
   *  most common value in the corpus, so reading it as "unknown, let it through" would put every
   *  land in the answer to "three or less". */
  test("a card with no recorded mana value counts as zero", () => {
    expect(compileCharacteristics(ask({ maxMv: 3 }), vocab)({})).toBe(true);
    expect(compileCharacteristics(ask({ maxMv: 3 }), vocab)({ mv: 4 })).toBe(false);
    expect(compileCharacteristics(ask({ maxMv: 3 }), vocab)({ mv: 3 })).toBe(true);
  });

  /** AN UNKNOWN NAME KEEPS THE LIST EMPTY rather than ignoring the filter: the vocabulary loads
   *  asynchronously, and a filter that silently stops applying while the tables are in flight
   *  shows cards that do not answer the question. */
  test("a type the vocabulary does not know matches nothing", () => {
    expect(compileCharacteristics(ask({ types: ["planeswalker"] }), vocab)({ t: [1] })).toBe(false);
  });
});

/** THE PANEL IS A LIST OF ROWS NOW (owner, 2026-09-21: "cards are like 20 % of the screen").
 *
 *  Measured before the change: the first card sat at 772px of a 930px viewport -- 83% of the
 *  screen was chrome, and the reader scrolled past eight labelled groups to reach a result. Every
 *  control is a row you ADD; the page starts as a search box, a plus and the count.
 *
 *  WHICH ROWS ARE DRAWN IS A QUESTION ABOUT THE URL, not about what was clicked. A link carrying
 *  `?subtype=sliver&mv=3` has to arrive with those two rows already open and filled, or a shared
 *  search would land on a page that does not show what it is asking. */
describe("filterKindsOf", () => {
  const empty: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [] };

  test("a question nobody has asked draws no rows", () => {
    expect(filterKindsOf(empty)).toEqual([]);
  });

  test("each param brings its own row", () => {
    expect(filterKindsOf({ ...empty, colours: ["R"] })).toEqual(["colours"]);
    expect(filterKindsOf({ ...empty, maxMv: 3 })).toEqual(["mv"]);
    expect(filterKindsOf({ ...empty, produce: ["mill|-|-|-"] })).toEqual(["produce"]);
    expect(filterKindsOf({ ...empty, consume: ["dies|creature|-|-"] })).toEqual(["consume"]);
  });

  /** ONE ROW, BOTH PARAMS. Type and subtype are one control (owner: "why type and subtype is not
   *  one like on scryfall") over one vocabulary of 487 words -- 13 types and 474 subtypes, with no
   *  word in both, so each resolves to its own param without asking which was meant. */
  test("type and subtype are one row", () => {
    expect(filterKindsOf({ ...empty, types: ["instant"] })).toEqual(["typeline"]);
    expect(filterKindsOf({ ...empty, subtypes: ["sliver"] })).toEqual(["typeline"]);
    expect(filterKindsOf({ ...empty, types: ["instant"], subtypes: ["sliver"] })).toEqual(["typeline"]);
  });

  /** A STABLE ORDER, AND NOT THE ORDER THEY WERE ADDED: the rows would otherwise shuffle between a
   *  reader's own session and the link they share, which are the same question. */
  test("the rows keep one order however the params arrive", () => {
    const q: EventQuery = { produce: ["a"], consume: ["b"], colours: ["R"], types: ["instant"], subtypes: [], maxMv: 2 };
    expect(filterKindsOf(q)).toEqual(["colours", "typeline", "mv", "produce", "consume"]);
  });

  /** SORT IS NOT A FILTER and must never become a row: it applies with nothing asked, so a reader
   *  cannot "add" it and there is nothing to remove. It lives beside the count instead. */
  test("an order is not a filter", () => {
    expect(filterKindsOf({ ...empty, sort: "name" })).toEqual([]);
  });
});

/** REMOVING A ROW CLEARS ITS OWN PARAMS AND NOTHING ELSE. The remove control is the only way back
 *  to "not asked" for a row, so a kind that clears a neighbour's question silently narrows a search
 *  the reader still wanted. */
describe("withoutFilterKind", () => {
  const full: EventQuery = {
    produce: ["mill|-|-|-"], consume: ["dies|creature|-|-"], colours: ["U"],
    types: ["instant"], subtypes: ["sliver"], maxMv: 3, sort: "name",
  };

  test("the type line row clears both its params", () => {
    const next = withoutFilterKind(full, "typeline");
    expect(next.types).toEqual([]);
    expect(next.subtypes).toEqual([]);
    expect(next.colours).toEqual(["U"]);
    expect(next.maxMv).toBe(3);
  });

  test("mana value goes back to asking nothing, not to zero", () => {
    expect(withoutFilterKind(full, "mv").maxMv).toBeUndefined();
  });

  test("each other row clears itself alone", () => {
    expect(withoutFilterKind(full, "colours").colours).toEqual([]);
    expect(withoutFilterKind(full, "produce").produce).toEqual([]);
    expect(withoutFilterKind(full, "consume").consume).toEqual([]);
  });

  test("an order survives every removal", () => {
    for (const k of ["colours", "typeline", "mv", "produce", "consume"] as const) {
      expect(withoutFilterKind(full, k).sort).toBe("name");
    }
  });
});
