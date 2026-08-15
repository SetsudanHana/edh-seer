/** IS THE VOCABULARY COMPLETE AGAINST THE RULES? This test is the answer, and it is the only form of
 *  that answer worth having — the hand reconciliation that preceded it claimed completeness and had
 *  missed NINE keyword actions (cloak, manifest dread, earthbend, waterbend, airbend, venture into
 *  the dungeon, face a villainous choice, the Ring tempts you, assemble).
 *
 *  Every CR 701 keyword action must be accounted for in exactly one way:
 *    - covered by a VERBS member, via the alias map below where our spelling differs; or
 *    - listed in EXCLUDED with a reason.
 *
 *  Anything else fails. When WotC prints a new keyword action, `gen-cr-keywords.ts` picks it up and
 *  this test goes red — BEFORE the corpus is normalized without a word for it, which is the whole
 *  point: normalization is a one-way ratchet and nobody re-runs 36,000 cards to add a word.
 *
 *  Reads the COMMITTED `cr-keywords.json`, never the gitignored rules cache, so it passes in a fresh
 *  clone. */
import { expect, test } from "vitest";
import { VERBS } from "../normalize-prompt.js";
import { KEYWORD_ABILITIES } from "./subtypes.js";
import crKeywords from "./cr-keywords.json" with { type: "json" };

/** CR English -> our engine spelling, only where they differ. */
const ALIASES: Record<string, string> = {
  counter: "counter-spell",
  "tap and untap": "tap",
  "venture into the dungeon": "venture-into-the-dungeon",
  "the ring tempts you": "ring-tempts",
  "time travel": "time-travel",
  "collect evidence": "collect-evidence",
  "manifest dread": "manifest-dread",
  "face a villainous choice": "face-a-villainous-choice",
};

/** Not a gap. Each entry is excluded on LEGALITY — the card can never appear in an EDH decklist —
 *  and never on "no demand", which is the exclusion the vocabulary ruling forbids. */
const EXCLUDED: Record<string, string> = {
  activate: "not an action a card text states; it is what an activated ability IS (ability kind)",
  assemble: "Unstable/silver-bordered. CR 701.45a itself says those cards 'aren't included in these rules'",
  planeswalk: "Planechase. No plane is ever in a decklist",
  "set in motion": "Archenemy scheme. Never in a decklist",
  abandon: "Archenemy scheme. Never in a decklist",
  "open an attraction": "Unfinity Attractions live in a separate deck, never the 99",
  "roll to visit your attractions": "Unfinity Attractions, as above",
};

test("every CR 701 keyword action is covered by a verb or excluded with a reason", () => {
  const verbs = new Set(VERBS.map((v) => v.toLowerCase()));
  const unaccounted: string[] = [];
  for (const raw of crKeywords.actions) {
    const action = raw.toLowerCase();
    if (action in EXCLUDED) continue;
    const ours = ALIASES[action] ?? action;
    if (!verbs.has(ours)) unaccounted.push(`${raw} (looked for "${ours}")`);
  }
  // Named in the failure, not just counted: the point of this test is to say WHICH word is missing.
  expect(unaccounted, `CR keyword actions with no verb and no exclusion:\n  ${unaccounted.join("\n  ")}`)
    .toEqual([]);
});

test("the exclusion list stays honest — every entry is really in the rules", () => {
  // An exclusion for a keyword the CR no longer lists is dead weight that hides a real gap behind a
  // plausible-looking reason.
  const actions = new Set(crKeywords.actions.map((a) => a.toLowerCase()));
  for (const excluded of Object.keys(EXCLUDED)) {
    expect(actions.has(excluded), `EXCLUDED names "${excluded}", which CR 701 does not list`).toBe(true);
  }
});

/** CR 702 abilities absent from `KEYWORD_ABILITIES`, which `gen-vocabulary.ts` generates from
 *  MTGJSON. **MTGJSON LAGS THE RULES**, and its `--check` guards drift from MTGJSON rather than from
 *  the game — so without this ratchet the gap grows silently every set.
 *
 *  A RATCHET, like KNOWN_DEFECT_CAP: the list may only SHRINK. A new keyword arriving in the CR
 *  before MTGJSON catches up fails the test, which is the signal to add it by hand. */
const MTGJSON_LAG = [
  "space sculptor", "visit", "plot", "start your engines!", "∞ (infinity)", "storied",
];

test("every CR 702 keyword ability is known, or is a recorded MTGJSON lag", () => {
  const ours = new Set(KEYWORD_ABILITIES.map((k) => k.toLowerCase()));
  const lag = new Set(MTGJSON_LAG);
  const unaccounted = crKeywords.abilities
    .map((a) => a.toLowerCase())
    // "Daybound and Nightbound" is ONE heading for TWO keywords, which MTGJSON lists separately.
    // A heading naming several keywords is covered when each of its parts is.
    .filter((a) => !a.split(" and ").every((part) => ours.has(part.trim())))
    .filter((a) => !lag.has(a));
  expect(unaccounted, `CR 702 abilities missing from KEYWORD_ABILITIES and not recorded as MTGJSON lag:\n  ${unaccounted.join("\n  ")}`)
    .toEqual([]);
});

test("the MTGJSON lag list only shrinks", () => {
  // If MTGJSON catches up, the entry must be REMOVED rather than left to rot — a stale exemption
  // hides the next real gap behind a plausible-looking reason.
  const ours = new Set(KEYWORD_ABILITIES.map((k) => k.toLowerCase()));
  const caughtUp = MTGJSON_LAG.filter((k) => ours.has(k));
  expect(caughtUp, `MTGJSON now has these — drop them from MTGJSON_LAG: ${caughtUp.join(", ")}`)
    .toEqual([]);
});

test("no alias points at a verb we do not have", () => {
  const verbs = new Set(VERBS.map((v) => v.toLowerCase()));
  for (const [cr, ours] of Object.entries(ALIASES)) {
    expect(verbs.has(ours), `alias ${cr} -> ${ours}, but "${ours}" is not in VERBS`).toBe(true);
  }
});

/** Sections of CR 7xx with a coverage verdict recorded in `bin/cr-section-sweep.ts`. Kept here as a
 *  COUNT rather than a duplicate list: the bin owns the verdicts and their reasoning, this owns the
 *  guarantee that none is missing. */
test("every CR 7xx section has been judged — a new mechanic cannot arrive unnoticed", () => {
  // Everything found before this sweep was found because someone THOUGHT OF IT: a section picked by
  // hand, or a mechanic the owner named. Enumerating the section list turns "did we miss a mechanic?"
  // into a finite checklist. 34 sections at rules 20260807; a 35th must be judged, not ignored.
  // 147 sections across all nine bands at rules 20260807 — extended from the 7xx-only pass once the
  // owner asked for the rest, which is how CR 903 (Commander) got swept in an EDH engine.
  expect(crKeywords.sections.length).toBe(147);
  expect(crKeywords.sections.some((s) => s.rule === "903" && /Commander/.test(s.name))).toBe(true);
  expect(crKeywords.sections.some((s) => s.rule === "714" && /Saga/.test(s.name))).toBe(true);
});
