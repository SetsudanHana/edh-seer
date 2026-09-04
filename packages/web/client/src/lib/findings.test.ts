import { expect, test } from "vitest";
import { findings, rankedFindings, slotTrade, FINDING_CAP } from "./findings.js";
import type { DeckReport } from "../types.js";

const report = (over: Partial<DeckReport>): DeckReport => ({ ...over } as DeckReport);

test("a build parent under target becomes a finding, and the shortfall is the fraction missing", () => {
  const [f] = findings(report({
    buildParents: [{ name: "Consistency", count: 6, target: 14, leaves: ["draw"] }],
  }));
  expect(f.figure).toBe("6/14");
  expect(f.shortfall).toBeCloseTo(8 / 14);
  expect(f.filled).toBeCloseTo(6 / 14);
});

test("a parent AT or OVER target is not a finding — a surplus is a trade, not a fault", () => {
  expect(findings(report({
    buildParents: [
      { name: "Board wipes", count: 2, target: 2, leaves: [] },
      { name: "Interaction", count: 15, target: 10, leaves: [] },
    ],
  }))).toEqual([]);
});

/** THE WHOLE POINT OF THE RANKING: no weight is chosen, so a bigger fraction of a target wins
 *  whatever kind of target it is. Consistency missing 8 of 14 (0.57) must outrank a colour short
 *  10 of 31 (0.32) — and mutating the sort to ascending must flip them. */
test("findings rank by fraction of target missing, across different kinds", () => {
  const rows = findings(report({
    buildParents: [{ name: "Consistency", count: 6, target: 14, leaves: [] }],
    deckMath: {
      colors: [{ color: "W", supplied: 21, worst: { pips: 4, turn: 9, required: 31, requiredRaw: 36, cards: 1, available: 18 } }],
    } as DeckReport["deckMath"],
  }));
  expect(rows.map((r) => r.kind)).toEqual(["build", "colour"]);
  expect(rows[0].shortfall).toBeGreaterThan(rows[1].shortfall);
});

/** A COLOUR THAT MEETS EVERY DEMAND CARRIES NO `worst` AT ALL -- `manaAudit` sets it only from the
 *  UNMET demands, so its absence is the met test and the finding needs no second one. The fixture
 *  used to hand-build a `worst` whose `available` already cleared `required`, which is a row the
 *  engine cannot emit, and the gate written against it read `supplied` -- the deck's whole source
 *  count -- while the colour panel printed `available` and called the same row short. */
test("a colour that meets its own worst requirement is not a finding", () => {
  expect(findings(report({
    deckMath: { colors: [{ color: "B", supplied: 40 }] } as DeckReport["deckMath"],
  }))).toEqual([]);
});

/** THE SUBJECT IS THE CARD. A mono-blue deck running 39 blue sources was told "Blue is short at the
 *  top of your curve" about an MV3 spell, which is false twice and unacceptable once. */
test("a colour finding names the card and reads the deadline count", () => {
  const [row] = findings(report({
    deckMath: {
      colors: [{
        color: "U", supplied: 39,
        worst: { pips: 3, turn: 3, required: 37, requiredRaw: 44, cards: 2, available: 35, names: ["Archmage's Charm", "Mana Sculpt"] },
      }],
    } as DeckReport["deckMath"],
  }));
  expect(row.headline).toBe("Archmage's Charm and Mana Sculpt want three blue on turn 3.");
  expect(row.figure).toBe("35/37");
  // The deck HOLDS enough; they are not online that early, and the sentence has to say which.
  expect(row.detail).toContain("35 of the deck's 39 blue sources");
  expect(row.detail).toContain("timing problem rather than a colour one");
  expect(row.shortfall).toBeCloseTo(2 / 37);
});

/** Too many to list is a count, not a wall of names. */
test("a colour finding past two cards names one and counts the rest", () => {
  const [row] = findings(report({
    deckMath: {
      colors: [{
        color: "B", supplied: 20,
        worst: { pips: 2, turn: 2, required: 30, requiredRaw: 36, cards: 5, available: 18, names: ["Bitterblossom", "Dark Confidant"] },
      }],
    } as DeckReport["deckMath"],
  }));
  expect(row.headline).toBe("Bitterblossom and 3 other cards want two black on turn 2.");
  // Not a timing problem: the deck does not hold the sources at all.
  expect(row.detail).not.toContain("timing problem");
});

/** Five thin classes are ONE finding, not five rows: the fix is one card that hits any permanent,
 *  and five near-identical rows is the wall of equal panels this list exists to replace. */
test("thin answer classes collapse into a single finding", () => {
  const rows = findings(report({
    deckMath: {
      turn: 6,
      answers: [
        { class: "creature", count: 5, required: 5, available: 0.51, exiling: 2, recurring: 0, fromCommandZone: false, pool: 1 },
        { class: "artifact", count: 2, required: 5, available: 0.25, exiling: 1, recurring: 0, fromCommandZone: false, pool: 1 },
        { class: "enchantment", count: 2, required: 5, available: 0.25, exiling: 1, recurring: 0, fromCommandZone: false, pool: 1 },
        { class: "planeswalker", count: 2, required: 5, available: 0.25, exiling: 1, recurring: 0, fromCommandZone: false, pool: 1 },
        { class: "land", count: 1, required: 5, available: 0.13, exiling: 1, recurring: 0, fromCommandZone: false, pool: 1 },
        // Hate, not removal — a Naturalize does not answer it, so it must not join the count.
        { class: "graveyard", count: 1, required: 5, available: 0.13, exiling: 0, recurring: 0, fromCommandZone: false, pool: 1 },
      ],
    } as DeckReport["deckMath"],
  }));
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe("answers");
  // THE FIGURE MUST MEASURE WHAT THE HEADLINE IS ABOUT. It used to be the single worst class's
  // availability (LAND, 13%) under a headline about four classes — a number a reader cannot check
  // against the sentence above it. It counts the classes covered now.
  expect(rows[0].figure).toBe("1/5");
  // AND THE FIGURE SAYS WHAT IT COUNTS (S16). `0/5 answer types covered` sat beside a Roles table
  // of SIX rows including graveyard, so a judge read the pair as an off-by-one and could not tell
  // whether graveyard is an answer type. The exclusion is right; it just was not stated.
  expect(rows[0].figureLabel).toBe("permanent answer types covered");
  // Graveyard is still out of the COUNTS -- it is hate, not removal -- and the detail now says so
  // rather than leaving its absence to be discovered.
  expect(rows[0].detail).not.toContain("1 for graveyards");
  expect(rows[0].detail).toContain("Graveyard hate is counted separately");
  // The thinnest class is still named, but as the DETAIL's own clause rather than as the headline
  // figure, so the two cannot disagree.
  expect(rows[0].detail).toContain("the thinnest is land");
});

/** THE DEFECT THE 2026-08-27 PERSONA RUN FOUND ON THE PAGE'S FOCAL ELEMENT, pinned in both
 *  directions. The headline printed "Your removal only answers creatures" on a deck holding two
 *  artifact, two enchantment and two planeswalker answers — which its OWN detail line then listed.
 *  "Only" is a claim about ZERO and is now spelled from the counts. */
const answers = (counts: Record<string, number>) => ({
  turn: 6,
  answers: Object.entries(counts).map(([cls, count]) => ({
    class: cls, count, required: 5, available: 0.25, exiling: 0, recurring: 0,
    fromCommandZone: false, pool: 1,
  })),
}) as DeckReport["deckMath"];

test("THIN is not NONE: a deck with two of each does not read as creature-only", () => {
  const [f] = findings(report({
    deckMath: answers({ creature: 5, artifact: 2, enchantment: 2, planeswalker: 2, land: 1 }),
  }));
  expect(f.headline).not.toContain("only answers creatures");
  expect(f.headline).toBe("Your answers outside creatures are thin.");
  // The detail must still list what it DOES have, and the headline must not contradict it.
  expect(f.detail).toContain("2 for artifacts");
});

test("ONLY is earned when every other class is genuinely zero", () => {
  const [f] = findings(report({
    deckMath: answers({ creature: 5, artifact: 0, enchantment: 0, planeswalker: 0, land: 0 }),
  }));
  expect(f.headline).toBe("Your removal only answers creatures.");
});

test("a partial hole is named as a hole, not generalised", () => {
  const [f] = findings(report({
    deckMath: answers({ creature: 5, artifact: 2, enchantment: 0, planeswalker: 0, land: 3 }),
  }));
  expect(f.headline).toBe("You have no answer at all for enchantments and planeswalkers.");
});

test("lands are a finding in BOTH directions", () => {
  const lands = (actual: number) => ({
    lands: { actual, target: 36, avgManaValue: 3.29, targetSource: "flat", rawTarget: 40, archetypeDelta: 0, rampPlusDraw: 6, fastMana: 0, mdfc: 0 },
  }) as DeckReport["deckMath"];
  expect(findings(report({ deckMath: lands(30) }))[0].headline).toContain("short");
  expect(findings(report({ deckMath: lands(42) }))[0].headline).toContain("more");
  expect(findings(report({ deckMath: lands(36) }))).toEqual([]);
  // AND THE SAME BAND THE DIAL USES, or the two surfaces contradict each other (S16). `bandState`
  // calls anything within `LAND_BAND` "on the modelled count"; this used to fire on any non-zero
  // delta, so a deck at 38 against 36 was simultaneously on the modelled count and two lands over.
  // Three of three judges filed it. The band wins, and this finding's own body is the argument:
  // the published formulas disagree by about four lands on the same deck.
  expect(findings(report({ deckMath: lands(38) })), "38 vs 36 is inside the band").toEqual([]);
  expect(findings(report({ deckMath: lands(39) })), "39 vs 36 is on the band edge").toEqual([]);
  expect(findings(report({ deckMath: lands(40) }))[0].headline).toContain("more");
  expect(findings(report({ deckMath: lands(32) }))[0].headline).toContain("short");
});

test("the slot trade names the category and never a card, and stays silent with nothing short", () => {
  const r = report({
    buildParents: [{ name: "Consistency", count: 6, target: 14, leaves: [] }],
    slack: [{ category: "Interaction", count: 15, target: 10, over: 5 }],
  });
  const trade = slotTrade(r, findings(r))!;
  expect(trade).toContain("Interaction sits at 15 against a target of 10");
  // The surplus must read as a SURPLUS. "5 of those slots are the ones you need" said the opposite.
  expect(trade).toContain("5 more slots than it needs");
  expect(trade).not.toContain("are the ones you need");
  expect(slotTrade(report({ slack: [{ category: "Interaction", count: 15, target: 10, over: 5 }] }), [])).toBeNull();
});

test("the cap is a stated presentational constant, not a threshold on the data", () => {
  expect(FINDING_CAP).toBe(3);
  // Every shortfall is still RETURNED — slicing is the caller's job, so a persona re-run or the
  // CLI can read the whole list.
  expect(findings(report({
    buildParents: [
      { name: "Consistency", count: 1, target: 14, leaves: [] },
      { name: "Ramp", count: 1, target: 10, leaves: [] },
      { name: "Interaction", count: 1, target: 10, leaves: [] },
      { name: "Board wipes", count: 0, target: 3, leaves: [] },
    ],
  }))).toHaveLength(4);
});

/** THE ONE FINDING THAT COMES FROM THE SYNERGY ENGINE. Before it, every source in this file was
 *  printed-data arithmetic and the product's differentiator never reached the focal surface. */
const demand = (rows: { key: string; consumers: number; suppliers: number; available: number | null }[]) =>
  ({ demand: rows.map((r) => ({ ...r, fromCommandZone: false })) }) as DeckReport["deckMath"];

test("a demand nothing supplies becomes a finding, ranked by how much of the deck is idle", () => {
  const [f] = findings(report({
    cards: Array.from({ length: 100 }, (_, i) => ({ name: `c${i}` })) as DeckReport["cards"],
    deckMath: demand([{ key: "dies:type:creature", consumers: 4, suppliers: 0, available: 0.2 }]),
  }));
  expect(f.kind).toBe("synergy");
  expect(f.figure).toBe("4");
  expect(f.shortfall).toBeCloseTo(0.04);
});

/** A SELF TRIGGER NEEDS NO SUPPLIER, and reading it as an unmet demand is how the panel printed
 *  "a creature entering the battlefield — 4 want · 0 supply" over a 51-creature deck.
 *  `available === null` is the engine's own refusal and must not become a finding. */
test("a self-supplied row is never a finding, however many cards want it", () => {
  expect(findings(report({
    cards: Array.from({ length: 100 }, (_, i) => ({ name: `c${i}` })) as DeckReport["cards"],
    deckMath: demand([{ key: "enters:type:creature", consumers: 40, suppliers: 0, available: null }]),
  }))).toEqual([]);
});

test("a demand WITH a supplier is not a finding", () => {
  expect(findings(report({
    cards: [{ name: "x" }] as DeckReport["cards"],
    deckMath: demand([{ key: "dies:type:creature", consumers: 4, suppliers: 2, available: 0.3 }]),
  }))).toEqual([]);
});

/** IT MUST NOT AUTOMATICALLY TOP THE LIST. One orphaned trigger is not worse than being eight cards
 *  short of card draw, which is what ranking it at "1.0, nothing supplies it" would have claimed. */
test("one idle card ranks below a large build shortfall", () => {
  const rows = findings(report({
    cards: Array.from({ length: 100 }, (_, i) => ({ name: `c${i}` })) as DeckReport["cards"],
    buildParents: [{ name: "Consistency", count: 6, target: 14, leaves: [] }],
    deckMath: demand([{ key: "attacks:any", consumers: 1, suppliers: 0, available: 0.1 }]),
  }));
  expect(rows.map((r) => r.kind)).toEqual(["build", "synergy"]);
});

/** S16, 2026-09-02: THE ASK AND THE SURPLUS WERE THE SAME CATEGORY AND NEITHER DEFERRED. The top
 *  finding asked for "two or three pieces that hit a permanent of any type" while the callout 300px
 *  below called Interaction 19/10 the deck's spare room. Both true, and they are one instruction:
 *  the count is fine and what those cards can answer is not, so it is a swap inside the category. */
test("the slot trade says so when the surplus is the category a finding asks for", () => {
  const withAnswers = report({
    slack: [{ category: "Interaction", count: 19, target: 10, over: 9 }] as DeckReport["slack"],
    deckMath: {
      turn: 8,
      answers: [
        { class: "creature", count: 4, required: 5, available: 0.5, exiling: 0, recurring: 0, fromCommandZone: false, pool: 1 },
        { class: "artifact", count: 3, required: 5, available: 0.4, exiling: 0, recurring: 0, fromCommandZone: false, pool: 1 },
      ],
    } as DeckReport["deckMath"],
  });
  const trade = slotTrade(withAnswers, findings(withAnswers))!;
  expect(trade).toContain("Interaction sits at 19 against a target of 10");
  expect(trade).toContain("Swap inside Interaction, do not add to it");

  // AND STAYS QUIET WHEN THEY ARE DIFFERENT CATEGORIES, where "add" and "the room is elsewhere" do
  // not conflict and the extra clause would be noise.
  const elsewhere = report({
    slack: [{ category: "Ramp", count: 17, target: 10, over: 7 }] as DeckReport["slack"],
    buildParents: [{ name: "Consistency", count: 6, target: 14, leaves: [] }],
  });
  const other = slotTrade(elsewhere, findings(elsewhere))!;
  expect(other).toContain("Ramp sits at 17");
  expect(other).not.toContain("Swap inside");
});

// --- S10: ranked by what fixing it is worth ---

/** RANKED BY WHAT FIXING IT IS WORTH, not by the size of the hole (roadmap S10). Board wipes is the
 *  known mover: weight 0.5 means a 0/3 gap is 100% missing and still worth less than Consistency's,
 *  so it leads under the old rule and does not under this one. */
test("the scored group is ordered by impact, not by shortfall", () => {
  const { scored } = rankedFindings(report({
    buildParents: [
      { name: "Consistency", count: 6, target: 14, leaves: ["draw"], impact: 0.635 },
      { name: "Board wipes", count: 0, target: 3, leaves: ["boardWipe"], impact: 0.556 },
    ],
  }));
  expect(scored.map((f) => f.figureLabel)).toEqual(["Consistency", "Board wipes"]);
  // And the old rule would have put them the other way round: 1.0 missing beats 0.571.
  expect(scored[1]!.shortfall).toBeGreaterThan(scored[0]!.shortfall);
});

/** COLOUR AND SYNERGY ARE NOT IN `buildScore` AT ALL -- colour is its own axis, synergy is
 *  `synergyOverall`. They carry no impact and rank in their own group rather than being interleaved
 *  by a conversion factor, which is exactly the invented constant this module refuses. */
test("colour and synergy findings never enter the scored group", () => {
  const { scored, unseen } = rankedFindings(report({
    buildParents: [{ name: "Consistency", count: 6, target: 14, leaves: [], impact: 0.635 }],
    cards: Array.from({ length: 100 }, (_, i) => ({ name: `c${i}` })) as DeckReport["cards"],
    deckMath: {
      ...demand([{ key: "dies:type:creature", consumers: 4, suppliers: 0, available: 0.2 }]),
      colors: [{ color: "B", supplied: 21, worst: { pips: 4, turn: 9, required: 31, requiredRaw: 36, cards: 1, available: 18 } }],
    } as DeckReport["deckMath"],
  }));
  expect(scored.every((f) => f.kind === "build" || f.kind === "lands" || f.kind === "answers")).toBe(true);
  expect([...new Set(unseen.map((f) => f.kind))].sort()).toEqual(["colour", "synergy"]);
  expect(unseen.every((f) => f.impact === undefined)).toBe(true);
});

/** AN IMPACT OF 0 IS A STATEMENT, NOT A GAP. It arises for the answers finding when every class is
 *  covered but some are held under `required`, so the multiplier cannot move. Dropping it would make
 *  the scored group mean "findings that happen to score well". */
test("a zero impact stays in the scored group", () => {
  const { scored } = rankedFindings(report({
    deckMath: answers({ creature: 2, artifact: 2, enchantment: 2, planeswalker: 2, land: 2 }),
    answersImpact: 0,
  }));
  const f = scored.find((x) => x.kind === "answers");
  expect(f).toBeDefined();
  expect(f!.impact).toBe(0);
});

/** A 100-CARD DECK CANNOT ADD WITHOUT CUTTING, so the action names the donor. `slack` is the same
 *  source `slotTrade` already reads, and a cut from a parent over its target costs the score nothing
 *  because attainment caps -- which is what makes the +1 side the whole delta. */
test("the action line names the cut when the deck has slack", () => {
  const { scored } = rankedFindings(report({
    buildParents: [{ name: "Consistency", count: 6, target: 14, leaves: ["draw"], impact: 0.635 }],
    suggestions: ["Consistency 6/14 — add ~8, typically 2–4 mana"],
    slack: [{ category: "ramp", count: 17, target: 10, over: 7 }],
  }));
  expect(scored[0]!.action).toContain("cutting from ramp (17/10)");
});

/** No surplus, no donor. Nothing is invented to fill the sentence. */
test("the action line names no cut when the deck has no slack", () => {
  const { scored } = rankedFindings(report({
    buildParents: [{ name: "Consistency", count: 6, target: 14, leaves: ["draw"], impact: 0.635 }],
    suggestions: ["Consistency 6/14 — add ~8, typically 2–4 mana"],
    slack: [],
  }));
  expect(scored[0]!.action).not.toContain("cutting from");
});
