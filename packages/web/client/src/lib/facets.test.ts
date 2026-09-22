import { expect, test, describe } from "vitest";
import { coloursFit, eventsFromParams, eventsToParams, intersect, rateLabel, compileCharacteristics, filterKindsOf, withoutFilterKind, type EventQuery } from "./facets.js";

/** THE SEARCH IS ASKED IN EVENTS (spec 2026-09-19): repeated params because a key can carry a
 *  comma, everything ANDs, and identity is fits-in on Cards and exact on Commanders. */

/** A JOINED LIST WOULD HAVE BEEN UNSPLITTABLE. 274 of the 1,187 corpus keys contain a comma; this
 *  pins the param shape against a "tidy it into one param" change. */
test("a key carrying a comma survives the round trip", () => {
  const comma = "fills|creature,enchantment|-|-";
  const params = eventsToParams({ produce: [comma, "enters|land|-|-"], consume: [], colours: ["R", "G"], types: [], subtypes: [], keywords: [], cardColours: [] }, new URLSearchParams());
  expect(params.getAll("produce")).toEqual([comma, "enters|land|-|-"]);
  expect(eventsFromParams(params)).toEqual({ produce: [comma, "enters|land|-|-"], consume: [], colours: ["R", "G"], types: [], subtypes: [], keywords: [], cardColours: [] });
});

test("a static key carrying colons and commas survives too", () => {
  const key = "applies:cost-reduction|creature,artifact|cleric,rogue|-";
  const params = eventsToParams({ produce: [], consume: [key], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] }, new URLSearchParams());
  expect(eventsFromParams(params).consume).toEqual([key]);
});

test("params the reader did not set are left alone, and an emptied group is removed", () => {
  const before = new URLSearchParams("q=samut&produce=a&produce=b&colors=RG");
  const after = eventsToParams({ produce: [], consume: ["c"], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] }, before);
  expect(after.get("q")).toBe("samut");
  expect(after.getAll("produce")).toEqual([]);
  expect(after.getAll("consume")).toEqual(["c"]);
  expect(after.get("colors")).toBeNull();
});

/** `does` AND `theme` ARE NOT READ ANY MORE. An old shared link lands on an unfiltered page rather
 *  than on an answer to a question the vocabulary no longer has. */
test("the retired params are ignored, not honoured", () => {
  const q = eventsFromParams(new URLSearchParams("does=draw-card&theme=tokens&produce=a"));
  expect(q).toEqual({ produce: ["a"], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] });
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
    types: ["instant"], subtypes: ["sliver"], keywords: [], cardColours: [], mvMax: 3, sort: "mv",
  };
  const round = eventsFromParams(eventsToParams(q, new URLSearchParams()));
  expect(round).toEqual(q);
});

test("the two printed-number orders survive the URL", () => {
  for (const sort of ["pow", "tou"] as const) {
    const q: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [], sort };
    expect(eventsFromParams(eventsToParams(q, new URLSearchParams())).sort).toBe(sort);
  }
});

test("the default order is not written into the link", () => {
  const p = eventsToParams({ produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [], sort: "partners" }, new URLSearchParams());
  expect(p.get("sort")).toBeNull();
});

/** A BAD VALUE IS NO FILTER, NOT A CONFIDENT EMPTY LIST. `?mv=abc` reading as "at most 0 mana"
 *  would answer a question nobody asked, and answer it wrongly. */
test("a junk mana value asks nothing", () => {
  expect(eventsFromParams(new URLSearchParams("mv=abc")).mvMax).toBeUndefined();
  expect(eventsFromParams(new URLSearchParams("mv=-2")).mvMax).toBeUndefined();
  expect(eventsFromParams(new URLSearchParams("sort=sideways")).sort).toBeUndefined();
});

describe("characteristicsFit", () => {
  const vocab = { types: ["artifact", "creature", "instant"], subtypes: ["sliver", "wizard"], keywords: [] };
  const ask = (q: Partial<EventQuery>): EventQuery =>
    ({ produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [], ...q });

  test("every chosen type must match, the same AND the event chips use", () => {
    const artifactCreature = { t: [0, 1], mv: 2 };
    expect(compileCharacteristics(ask({ types: ["artifact", "creature"] }), vocab)(artifactCreature)).toBe(true);
    expect(compileCharacteristics(ask({ types: ["artifact", "instant"] }), vocab)(artifactCreature)).toBe(false);
  });

  /** THE POINT OF COMPILING: one predicate, many cards. Resolving names per card cost a 488-entry
   *  scan each, over 25,582 rows, on every keystroke. */
  test("one compiled predicate answers for every card", () => {
    const fits = compileCharacteristics(ask({ subtypes: ["sliver"], mvMax: 3 }), vocab);
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
    expect(compileCharacteristics(ask({ mvMax: 3 }), vocab)({})).toBe(true);
    expect(compileCharacteristics(ask({ mvMax: 3 }), vocab)({ mv: 4 })).toBe(false);
    expect(compileCharacteristics(ask({ mvMax: 3 }), vocab)({ mv: 3 })).toBe(true);
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
  const empty: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] };

  test("a question nobody has asked draws no rows", () => {
    expect(filterKindsOf(empty)).toEqual([]);
  });

  test("each param brings its own row", () => {
    expect(filterKindsOf({ ...empty, colours: ["R"] })).toEqual(["colours"]);
    expect(filterKindsOf({ ...empty, mvMax: 3 })).toEqual(["mv"]);
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
    const q: EventQuery = { produce: ["a"], consume: ["b"], colours: ["R"], types: ["instant"], subtypes: [], keywords: [], cardColours: [], mvMax: 2 };
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
    types: ["instant"], subtypes: ["sliver"], keywords: [], cardColours: [], mvMax: 3, sort: "name",
  };

  test("the type line row clears both its params", () => {
    const next = withoutFilterKind(full, "typeline");
    expect(next.types).toEqual([]);
    expect(next.subtypes).toEqual([]);
    expect(next.colours).toEqual(["U"]);
    expect(next.mvMax).toBe(3);
  });

  test("mana value goes back to asking nothing, not to zero", () => {
    expect(withoutFilterKind(full, "mv").mvMax).toBeUndefined();
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

/** THE MENU MADE FILTERS CHEAP (owner, 2026-09-21: "if we have + add filter now, we should add all
 *  filter types that make sense"). A row costs one line of a menu now instead of a permanent band
 *  of chrome, so the reason the vocabulary stayed at three dimensions is gone. Four more, all of
 *  them answerable from the corpus the artifact already holds. */
describe("the wider filter vocabulary", () => {
  const empty: EventQuery = {
    produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [],
  };

  test("each new dimension brings its own row", () => {
    expect(filterKindsOf({ ...empty, keywords: ["flying"] })).toEqual(["keywords"]);
    expect(filterKindsOf({ ...empty, cardColours: ["U"] })).toEqual(["cardColours"]);
    expect(filterKindsOf({ ...empty, powMin: 4 })).toEqual(["power"]);
    expect(filterKindsOf({ ...empty, touMax: 2 })).toEqual(["toughness"]);
  });

  /** A RANGE IS ONE ROW WHICHEVER END IS SET. "3 or more" is a range with no ceiling and it is
   *  still the mana value question -- two rows for one dimension would let a reader remove half
   *  of it. */
  test("either end of a range is the same one row", () => {
    expect(filterKindsOf({ ...empty, mvMin: 2 })).toEqual(["mv"]);
    expect(filterKindsOf({ ...empty, mvMax: 4 })).toEqual(["mv"]);
    expect(filterKindsOf({ ...empty, mvMin: 2, mvMax: 4 })).toEqual(["mv"]);
  });

  test("removing a range row clears both its ends", () => {
    const q: EventQuery = { ...empty, mvMin: 2, mvMax: 4, powMin: 1, powMax: 9 };
    const next = withoutFilterKind(q, "mv");
    expect(next.mvMin).toBeUndefined();
    expect(next.mvMax).toBeUndefined();
    // And leaves the neighbouring range alone.
    expect(next.powMin).toBe(1);
    expect(next.powMax).toBe(9);
  });

  test("the rows keep one order however the params arrive", () => {
    const q: EventQuery = {
      produce: ["a"], consume: ["b"], colours: ["R"], types: ["instant"], subtypes: ["sliver"],
      keywords: ["flying"], cardColours: ["U"], mvMin: 1, powMax: 3, touMin: 2,
    };
    expect(filterKindsOf(q)).toEqual([
      "colours", "cardColours", "typeline", "keywords", "mv", "power", "toughness", "produce", "consume",
    ]);
  });
});

describe("the new params round-trip", () => {
  const empty: EventQuery = {
    produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [],
  };
  const round = (q: EventQuery) => eventsFromParams(eventsToParams(q, new URLSearchParams()));

  test("a keyword survives, repeated like a subtype", () => {
    const params = eventsToParams({ ...empty, keywords: ["flying", "first strike"] }, new URLSearchParams());
    expect(params.getAll("keyword")).toEqual(["flying", "first strike"]);
    expect(round({ ...empty, keywords: ["flying", "first strike"] }).keywords).toEqual(["flying", "first strike"]);
  });

  /** THE CARD'S OWN COLOURS ARE A DIFFERENT PARAM FROM ITS IDENTITY, because they are a different
   *  question -- 1,751 of 32,334 cards answer the two differently. `colors` was already taken by
   *  identity when it shipped, and renaming it would break every link. */
  test("card colours and colour identity do not collide", () => {
    const params = eventsToParams({ ...empty, colours: ["R"], cardColours: ["U", "B"] }, new URLSearchParams());
    expect(params.get("colors")).toBe("R");
    expect(params.get("cardcolors")).toBe("UB");
    const back = eventsFromParams(params);
    expect(back.colours).toEqual(["R"]);
    expect(back.cardColours).toEqual(["U", "B"]);
  });

  test("every range survives both ends", () => {
    const q: EventQuery = { ...empty, mvMin: 2, mvMax: 4, powMin: 0, powMax: 3, touMin: 5 };
    const back = round(q);
    expect([back.mvMin, back.mvMax]).toEqual([2, 4]);
    expect([back.powMin, back.powMax]).toEqual([0, 3]);
    expect([back.touMin, back.touMax]).toEqual([5, undefined]);
  });

  /** ZERO IS A REAL BOUND and the reason these are `undefined`-checked rather than truthy-checked:
   *  "power 0 to 0" asks for the Ornithopters, and a falsy test would drop it. */
  test("a bound of zero is kept", () => {
    expect(round({ ...empty, powMin: 0, powMax: 0 }).powMax).toBe(0);
  });

  /** EVERY LINK SHARED BEFORE TODAY still means what it meant. `mv=3` was the ceiling, and it is
   *  live on the deployed site right now -- reading it as anything else, or as nothing, would
   *  silently change a search someone had already sent to somebody. */
  test("the old mv param still reads as a ceiling", () => {
    const back = eventsFromParams(new URLSearchParams("mv=3"));
    expect(back.mvMax).toBe(3);
    expect(back.mvMin).toBeUndefined();
    // And it is rewritten into the new pair, so the legacy spelling does not persist.
    expect(eventsToParams(back, new URLSearchParams("mv=3")).get("mv")).toBeNull();
    expect(eventsToParams(back, new URLSearchParams("mv=3")).get("mvmax")).toBe("3");
  });

  test("a nonsense bound is no filter rather than zero", () => {
    const back = eventsFromParams(new URLSearchParams("mvmax=abc&powmin=-4"));
    expect(back.mvMax).toBeUndefined();
    expect(back.powMin).toBeUndefined();
  });
});

describe("the wider compileCharacteristics", () => {
  const vocab = { types: ["creature", "instant"], subtypes: ["sliver"], keywords: ["flying", "trample"] };
  const ask = (over: Partial<EventQuery>): EventQuery => ({
    produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [], ...over,
  });

  test("every chosen keyword must be printed, the same AND as the types", () => {
    const flier = { k: [0] }, both = { k: [0, 1] };
    expect(compileCharacteristics(ask({ keywords: ["flying"] }), vocab)(flier)).toBe(true);
    expect(compileCharacteristics(ask({ keywords: ["flying", "trample"] }), vocab)(flier)).toBe(false);
    expect(compileCharacteristics(ask({ keywords: ["flying", "trample"] }), vocab)(both)).toBe(true);
  });

  test("a keyword the tables do not know matches nothing rather than everything", () => {
    expect(compileCharacteristics(ask({ keywords: ["nonesuch"] }), vocab)({ k: [0] })).toBe(false);
  });

  /** THE CARD IS AT LEAST THESE COLOURS, which is Scryfall's `c:` and NOT the identity row's
   *  fits-in. "Blue" answers every blue card including Dimir; "Blue, Black" answers the cards that
   *  are both. Colourless is exclusive, as it is everywhere else here. */
  test("card colours ask what the card IS", () => {
    const dimir = { c: 2 | 4 }, mono = { c: 2 }, colourless = {};
    expect(compileCharacteristics(ask({ cardColours: ["U"] }), vocab)(dimir)).toBe(true);
    expect(compileCharacteristics(ask({ cardColours: ["U"] }), vocab)(mono)).toBe(true);
    expect(compileCharacteristics(ask({ cardColours: ["U", "B"] }), vocab)(mono)).toBe(false);
    expect(compileCharacteristics(ask({ cardColours: ["U", "B"] }), vocab)(dimir)).toBe(true);
    expect(compileCharacteristics(ask({ cardColours: ["C"] }), vocab)(colourless)).toBe(true);
    expect(compileCharacteristics(ask({ cardColours: ["C"] }), vocab)(dimir)).toBe(false);
  });

  test("a range holds at both ends, and an open end is open", () => {
    const fits = (over: Partial<EventQuery>, card: { mv?: number }) => compileCharacteristics(ask(over), vocab)(card);
    expect(fits({ mvMin: 2, mvMax: 4 }, { mv: 3 })).toBe(true);
    expect(fits({ mvMin: 2, mvMax: 4 }, { mv: 2 })).toBe(true);
    expect(fits({ mvMin: 2, mvMax: 4 }, { mv: 4 })).toBe(true);
    expect(fits({ mvMin: 2, mvMax: 4 }, { mv: 5 })).toBe(false);
    expect(fits({ mvMin: 5 }, { mv: 9 })).toBe(true);
    // An absent mv is zero, which is what the artifact means by leaving it out.
    expect(fits({ mvMax: 0 }, {})).toBe(true);
  });

  /** 242 CARDS PRINT `*`, `1+*` OR `X` FOR POWER. They cannot answer a numeric range, so they are
   *  not in its answer -- the build omits the field for them, and an absent power is NOT zero the
   *  way an absent mana value is. Saying "Ornithopter and Tarmogoyf both have power 0" would be a
   *  claim, and this engine says nothing rather than guessing. */
  test("a card with no numeric power answers no power question", () => {
    const fits = (over: Partial<EventQuery>, card: { pow?: number }) => compileCharacteristics(ask(over), vocab)(card);
    expect(fits({ powMin: 0 }, {})).toBe(false);
    expect(fits({ powMax: 9 }, {})).toBe(false);
    expect(fits({ powMin: 0, powMax: 0 }, { pow: 0 })).toBe(true);
    // And a card with no power at all is simply not a creature, which is the same answer.
    expect(fits({ touMin: 1 }, { pow: 2 })).toBe(false);
  });
});

/** THE ONE NEW DIMENSION THAT DOES NOT FAIL CLOSED ON ITS OWN (review, 2026-09-21).
 *
 *  A missing `c` means colourless on a fresh artifact, because the build omits the field only when
 *  the mask is 0 -- but every row of an artifact built before the field existed is missing it, so
 *  "Colourless" would answer with the whole corpus. The keyword row fails closed for free (an
 *  unknown word resolves to -1) and so do power and toughness (absent is excluded). This one has
 *  to be told, and `npm run deploy` shipping a stale `static-out/` is a thing that has happened. */
describe("a colour question against an artifact that cannot answer it", () => {
  const vocab = { types: [], subtypes: [], keywords: [] };
  const ask = (over: Partial<EventQuery>): EventQuery => ({
    produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [], ...over,
  });

  test("colourless claims nothing rather than everything", () => {
    const old = { ...vocab, colours: false };
    expect(compileCharacteristics(ask({ cardColours: ["C"] }), old)({})).toBe(false);
    expect(compileCharacteristics(ask({ cardColours: ["U"] }), old)({})).toBe(false);
  });

  test("and a fresh artifact still answers it", () => {
    const fresh = { ...vocab, colours: true };
    expect(compileCharacteristics(ask({ cardColours: ["C"] }), fresh)({})).toBe(true);
    expect(compileCharacteristics(ask({ cardColours: ["C"] }), fresh)({ c: 2 })).toBe(false);
  });

  /** AND AN UNASKED COLOUR QUESTION IS NOT A FILTER, whatever the artifact carries -- a reader who
   *  never opened the row must not lose the corpus to it. */
  test("no colour chosen filters nothing, on either artifact", () => {
    expect(compileCharacteristics(ask({}), { ...vocab, colours: false })({})).toBe(true);
  });
});
