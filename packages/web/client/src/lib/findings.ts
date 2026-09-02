import { LAND_BAND } from "@edh-seer/matcher/build";
import type { DeckReport } from "../types.js";
import { demandSentence } from "./demand-sentence.js";

/** WHAT IS WRONG WITH THIS DECK — the report's eight diagnostic panels, ranked.
 *
 *  THE DEFECT THIS CLOSES IS SEQUENCING, NOT CONTENT. Every number below already shipped: build
 *  benchmarks, answers-by-turn, the colour audit, land maths. What they never had was an ORDER, so
 *  the Overview rendered eight equal-weight blocks and left the reader to work out which one
 *  mattered. Four persona reviews on 2026-08-26 converged on the same finding — the page leads with
 *  its weakest answer and buries its strongest — and both expert personas used exactly these panels
 *  and nothing else.
 *
 *  THE RANKING INVENTS NO THRESHOLD, which is the whole reason it is defensible. Every source here
 *  already carries its own TARGET, computed by the engine: a build parent's `target`, an answer
 *  class's `required`, a colour's `worst.required`, the land regression's `target`. The score is
 *  the same arithmetic in all four cases — **what fraction of that target is missing** — so a
 *  Consistency gap of 8 against 14 (0.57) outranks a colour short 10 sources against 31 (0.32)
 *  without anyone choosing a weight. Nothing is normalised by taste and no constant is introduced
 *  except the row cap.
 *
 *  IT NAMES SHORTFALLS ONLY. A surplus is not a fault — the deck is spending slots somewhere, which
 *  is a trade rather than a problem — so `deckSlack` rides beside the list as the answer to "where
 *  do the slots come from" instead of competing for a rank inside it.
 *
 *  A FINDING IS A CLAIM ABOUT A NUMBER THE READER CAN CHECK. Each row carries the figure and its
 *  target verbatim, so the row can be audited against the panel it came from — the skeptic
 *  persona's standing test: "can I check this claim from the screen it appears on."
 */

/** Rows shown before the rest collapse into a count. A ranked list that always runs eight rows is
 *  the wall of equal panels again with numbers down the side; three is what fits above the fold at
 *  390px and still leaves the deck's own read visible underneath. Presentational, and the only
 *  constant in this file. */
export const FINDING_CAP = 3;

export type FindingKind = "build" | "answers" | "colour" | "lands" | "synergy";

export interface Finding {
  kind: FindingKind;
  /** Stable across renders so React keys and the persona re-runs can name a row. */
  id: string;
  /** The claim, in the player's words. A sentence, never a label. */
  headline: string;
  /** Why it is true, and what the number means. */
  detail: string;
  /** What to do about it. Absent when the honest answer is "nothing, or accept it". */
  action?: string;
  /** The proving figure, e.g. `6/14`. Mono, tabular, rendered beside the row. */
  figure: string;
  /** What the figure counts, e.g. `Consistency`. */
  figureLabel: string;
  /** 0–1: how much of the target is present. Drives the row's bar. */
  filled: number;
  /** 0–1: the fraction of the target that is MISSING. The sort key for the UNSCORED group, and the
   *  figure `slotTrade` and the header count still read. */
  shortfall: number;
  /** WHAT FIXING THIS IS WORTH TO THE BUILD SCORE (roadmap S10) -- the whole gap, not one card, and
   *  a LOWER BOUND, because a real card often carries two of a parent's leaves.
   *
   *  ABSENT, never 0, on the kinds `buildScore` cannot express: colour is its own axis and synergy
   *  is `synergyOverall`. The distinction is load-bearing -- 0 means "fixing this does not move
   *  Build", which is a claim, and `undefined` means the score has nothing to say. */
  impact?: number;
}

const pct = (n: number): number => Math.round(n * 100);

/** A build parent under its target. The largest single source of findings, and the one the
 *  suggestions list already speaks to — so the action is taken from `report.suggestions` when it
 *  names the same parent, rather than being written a second time here. Two copies of a sentence is
 *  how two surfaces start disagreeing, which this repo has now measured twice. */
function buildFindings(report: DeckReport): Finding[] {
  const parents = report.buildParents ?? [];
  const suggestions = report.suggestions ?? [];
  const out: Finding[] = [];
  for (const p of parents) {
    if (p.target <= 0 || p.count >= p.target) continue;
    const missing = p.target - p.count;
    // The engine's own sentence for this parent, if it wrote one. It carries the cost band
    // (`typically 2–4 mana`) that this module has no business recomputing.
    const suggestion = suggestions.find((s) => s.startsWith(`${p.name} `));
    // THE DONOR, NAMED. A 100-card deck cannot add without cutting, so a bare "add ~8" is a move no
    // reader can make. `report.slack` is the same surplus `slotTrade` reads for "where the slots come
    // from", and a cut from a parent over its target costs the score NOTHING -- attainment is
    // `min(count / target, 1)` and stays capped all the way down to the target. That is what makes
    // the add side the whole delta, and what makes the impact figure true of a legal deck.
    const donor = (report.slack ?? [])[0];
    const cut = donor ? `, cutting from ${donor.category} (${donor.count}/${donor.target})` : "";
    out.push({
      kind: "build",
      id: `build:${p.name}`,
      headline: p.name === "Consistency"
        ? "You will run out of cards before you run out of turns."
        : `You are ${missing} short on ${p.name.toLowerCase()}.`,
      detail: `${p.count} ${p.count === 1 ? "card fills" : "cards fill"} this role against a target of ${p.target}.`
        + " The target is a deckbuilding convention, not a number measured from any deck.",
      // Strip the leading "Name 6/14 — " the CLI sentence carries, since the figure is rendered
      // beside the row already.
      action: suggestion
        ? `${suggestion.replace(/^[^—]*—\s*/, "").replace(/^add/, "Add")}${cut}`
        : undefined,
      figure: `${p.count}/${p.target}`,
      figureLabel: p.name,
      filled: p.count / p.target,
      shortfall: missing / p.target,
      impact: p.impact,
    });
  }
  return out;
}

/** ANSWERS THE DECK CANNOT REACH. `deckMath.answers` prices each permanent class by how likely you
 *  are to be HOLDING one by the deck's own clock turn, against the copies it takes to call an
 *  answer reliable. Grouped into ONE finding rather than five, because five rows saying "artifact
 *  removal is thin, enchantment removal is thin…" is the wall of panels again — and the fix is one
 *  card that hits any permanent, not five separate cards. */
function answerFinding(report: DeckReport): Finding | null {
  const answers = report.deckMath?.answers ?? [];
  // The classes a permanent-agnostic answer would cover at once. `graveyard` is excluded: it is
  // hate rather than removal, and a Naturalize does not answer it.
  const permanent = answers.filter((a) => a.class !== "graveyard");
  // AND THE FIGURE SAYS SO (S16, 2026-09-02). `0/5 answer types covered` sat beside a Roles table
  // listing SIX rows, graveyard among them at `none · 5 short` — so the skeptic found the thinnest
  // class on the page excluded from the finding that calls land the thinnest, and read the pair as
  // an off-by-one: *"either graveyard is an answer type or it is not, and the page takes both
  // positions on the same scroll."* The exclusion is deliberate and defensible; what was missing is
  // that it was never said where the figure is read.
  if (permanent.length === 0) return null;
  const short = permanent.filter((a) => a.count < a.required);
  if (short.length === 0) return null;
  // The worst class carries the figure; the shortfall is the mean across the short ones, so a deck
  // missing one class does not outrank a deck missing four.
  const worst = short.reduce((a, b) => (a.available <= b.available ? a : b));
  const shortfall = short.reduce((sum, a) => sum + (a.required - a.count) / a.required, 0) / permanent.length;
  const turn = report.deckMath?.turn;
  // THIN IS NOT NONE, AND THE FIRST VERSION OF THIS HEADLINE CONFLATED THEM. It printed
  // "Your removal only answers creatures" whenever four of five classes sat under target — on a
  // deck holding 2 artifact, 2 enchantment, 2 planeswalker and 1 land answer, which its OWN next
  // line then listed. Both expert personas caught it on 2026-08-27 as the page's focal element
  // contradicting itself one line down.
  //
  // "ONLY" IS A CLAIM ABOUT ZERO, so it is now spelled from the counts rather than from how many
  // classes happen to be under a threshold. The same shape as `connectionReason` in the matcher's
  // cut list, which learned this on 2,955 rows saying "only N cards connect to it" about
  // well-connected cards.
  const absent = short.filter((a) => a.count === 0);
  const names = (rows: readonly typeof short[number][]) =>
    rows.map((a) => `${a.class}s`).join(", ").replace(/, ([^,]*)$/, " and $1");
  const headline = absent.length === short.length && short.length >= permanent.length - 1
    ? "Your removal only answers creatures."
    : absent.length > 0
      ? `You have no answer at all for ${names(absent)}.`
      : `Your answers outside creatures are thin.`;
  // THE HEADLINE, THE FIGURE AND THE DETAIL MUST MEASURE THE SAME THING. The figure was
  // `worst.available` — the single worst class, LAND at 13% — under a headline about four classes
  // whose other three read 25%, and a detail that switched subject mid-sentence ("2 for artifacts …
  // about a 13% chance of holding the LAND answer"). A reader cannot check a claim whose number is
  // about a different quantity from its sentence, which is the one thing this surface owes them.
  // The figure now counts the classes the headline is about.
  return {
    kind: "answers",
    id: "answers",
    headline,
    detail: `${short.map((a) => `${a.count} for ${a.class}s`).join(", ")}`
      + `, against the ${worst.required} copies it takes to call an answer reliable`
      + `${turn ? ` — the thinnest is ${worst.class}, about a ${pct(worst.available)}% chance of holding one by turn ${turn}` : ""}.`
      + " Graveyard hate is counted separately: it is hate rather than removal, and a Naturalize does not answer it.",
    action: "Two or three pieces that hit a permanent of any type.",
    figure: `${permanent.length - short.length}/${permanent.length}`,
    figureLabel: "permanent answer types covered",
    filled: (permanent.length - short.length) / permanent.length,
    shortfall,
    impact: report.answersImpact,
  };
}

/** A COLOUR THE DECK CANNOT PAY FOR AT ITS OWN TOP END. `deckMath.colors[].worst` is the hardest
 *  cost the deck actually prints in that colour, with the sources Karsten's mulligan-corrected
 *  model wants for it. It is deliberately quiet about how MANY cards are affected — `worst.cards`
 *  carries that, and one card is a very different finding from ten, so the row says which. */
function colourFindings(report: DeckReport): Finding[] {
  const colours = report.deckMath?.colors ?? [];
  const out: Finding[] = [];
  for (const c of colours) {
    const worst = c.worst;
    if (!worst || c.supplied >= worst.required) continue;
    out.push({
      kind: "colour",
      id: `colour:${c.color}`,
      headline: `${NAME[c.color] ?? c.color} is short at the top of your curve.`,
      detail: `${worst.cards} ${worst.cards === 1 ? "card wants" : "cards want"} ${worst.pips} `
        + `${NAME[c.color]?.toLowerCase() ?? c.color} ${worst.pips === 1 ? "pip" : "pips"}. `
        + `To cast on turn ${worst.turn} you would want ${worst.required} sources; the deck runs ${c.supplied}.`,
      figure: `${c.supplied}/${worst.required}`,
      figureLabel: `${NAME[c.color]?.toLowerCase() ?? c.color} sources`,
      filled: c.supplied / worst.required,
      shortfall: (worst.required - c.supplied) / worst.required,
    });
  }
  return out;
}

const NAME: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colourless" };

/** A DEMAND NOTHING IN THE DECK SUPPLIES — the one finding that comes from the synergy engine
 *  rather than from printed data, and the reason it exists.
 *
 *  **THE DIAGNOSIS CONTAINED NO SYNERGY FINDINGS AT ALL.** An adversarial IA review put it plainly
 *  (2026-08-27): every other source in this file is build/answers/colour/lands arithmetic, all of it
 *  computable by any hypergeometric deck calculator with a role tagger — so the focal surface of a
 *  product whose whole positioning is "we explain WHY cards work together" was a generic
 *  deckbuilding calculator, and the engine's own output was quarantined below the fold under a
 *  heading that framed it as bookkeeping. That is a defect in the slot inventory, not in the code
 *  that implements it.
 *
 *  `deckMath.demand` already carries the fact: N cards trigger on an event and nothing in the deck
 *  produces it. It shipped as the last block of an evidence panel ("WANTS VS SUPPLIES"), which is
 *  where the strongest claim this engine can make was sitting.
 *
 *  **SELF-SUPPLIED ROWS ARE NOT DEMANDS**, and reading them as such is how this panel printed
 *  "a creature entering the battlefield — 4 want · 0 supply" over a 51-creature deck. A trigger
 *  watching its OWN entry needs no supplier; `available === null` is the engine saying so.
 *
 *  **IT IS RANKED BY HOW MUCH OF THE DECK IS IDLE**, which is the same shape every other finding
 *  uses: a fraction with a real denominator. Not by "1.0, nothing supplies it" — that would top the
 *  list on every deck with one orphaned trigger, and one dead card is not worse than being eight
 *  cards short of card draw. */
function synergyFinding(report: DeckReport): Finding | null {
  const demand = report.deckMath?.demand ?? [];
  // `available === null` is the engine's own refusal: the game supplies it (a phase), or the card
  // supplies it itself. Only a row with a real probability and no supplier is an unmet demand.
  const unmet = demand.filter((d) => d.available !== null && d.suppliers === 0 && d.consumers > 0);
  if (unmet.length === 0) return null;
  const cards = report.cards?.length ?? 0;
  if (cards === 0) return null;
  const idle = unmet.reduce((n, d) => n + d.consumers, 0);
  const worst = unmet.reduce((a, b) => (a.consumers >= b.consumers ? a : b));
  return {
    kind: "synergy",
    id: "synergy:unmet",
    headline: unmet.length === 1
      ? `${worst.consumers} ${worst.consumers === 1 ? "card is" : "cards are"} waiting for something the deck never does.`
      : `${idle} cards are waiting for things the deck never does.`,
    // HUMANISED THROUGH THE ONE MAP, never the raw census key. The first cut printed
    // "enters:type:land" in a finding's own sentence — an internal identifier rendered as English,
    // the same defect as the `targetedRemoval` that escaped into prose one review earlier. The
    // vocabulary moved to `lib/` rather than being copied so the two surfaces cannot disagree.
    detail: `${unmet.length === 1 ? "One trigger" : `${unmet.length} triggers`} in this deck `
      + `${unmet.length === 1 ? "waits" : "wait"} on `
      + `${unmet.map((d) => demandSentence(d.key)).join(", ")} — and nothing in the deck does it.`,
    action: "Add a source for it, or cut the cards waiting on it.",
    figure: `${idle}`,
    figureLabel: idle === 1 ? "idle card" : "idle cards",
    filled: Math.max(0, 1 - idle / cards),
    shortfall: idle / cards,
  };
}

/** LANDS AGAINST THE REGRESSION'S OWN TARGET. Both directions are a finding — a deck four lands
 *  under floods out on spells it cannot cast, and one four over draws lands instead of action —
 *  which is why this is the one source whose shortfall is an ABSOLUTE distance from target.
 *
 *  AND IT USES THE SAME BAND THE DIAL DOES (S16, 2026-09-02). It used to fire on any non-zero
 *  delta while `bandState` called anything within `LAND_BAND` "on the modelled count" — so a deck
 *  at 38 against a target of 36 was BOTH on the modelled count (chapter 2's tile) and running two
 *  more lands than its curve needs (chapter 6's finding). Three of three judges filed it, one as
 *  *"same deck, same model, opposite verdicts"*.
 *
 *  The band wins, and this finding's own body is the argument for it: the published formulas
 *  disagree with each other by about four lands on the same deck, so a one-land deviation is not a
 *  finding, it is the instrument's resolution. One threshold, imported from the same constant the
 *  dial reads, so the two cannot drift apart again. */
function landFinding(report: DeckReport): Finding | null {
  const lands = report.deckMath?.lands;
  if (!lands || lands.target <= 0) return null;
  const delta = lands.actual - lands.target;
  if (Math.abs(delta) <= LAND_BAND) return null;
  const over = delta > 0;
  return {
    kind: "lands",
    id: "lands",
    headline: over
      ? `You are running ${delta} more ${delta === 1 ? "land" : "lands"} than this curve needs.`
      : `You are ${-delta} ${delta === -1 ? "land" : "lands"} short.`,
    detail: `${lands.actual} lands against a modelled ${lands.target}, at an average cost of `
      + `${lands.avgManaValue.toFixed(2)}. Land counts are a model and the published formulas `
      + "disagree with each other by about four lands on the same deck.",
    figure: `${lands.actual}/${lands.target}`,
    figureLabel: "lands",
    filled: Math.min(1, lands.actual / lands.target),
    shortfall: Math.abs(delta) / lands.target,
    impact: report.landsImpact,
  };
}

/** The ranked diagnosis. Highest shortfall first; ties by kind name so the order is stable across
 *  runs rather than stable to the engine's iteration order — the same rule the cut list keeps. */
export function findings(report: DeckReport): Finding[] {
  const all = [
    ...buildFindings(report),
    ...colourFindings(report),
    ...(answerFinding(report) ? [answerFinding(report)!] : []),
    ...(synergyFinding(report) ? [synergyFinding(report)!] : []),
    ...(landFinding(report) ? [landFinding(report)!] : []),
  ];
  all.sort((a, b) => b.shortfall - a.shortfall || a.id.localeCompare(b.id));
  return all;
}

/** THE TWO GROUPS (roadmap S10).
 *
 *  `scored` is every finding `buildScore` can price, ordered by what closing it is worth. `unseen` is
 *  colour and synergy, which are not terms in that score at all, kept in the order they always had --
 *  by the fraction of their own target that is missing.
 *
 *  THEY ARE NOT INTERLEAVED, and that is the point. Placing an unpriced finding inside a priced list
 *  needs a conversion from shortfall to score points, which is exactly the constant this module's
 *  own header refuses to introduce. Two headings say the true thing instead: the second group is
 *  real problems the number is structurally blind to.
 *
 *  `findings()` above is UNCHANGED and still returns everything worst-shortfall first -- the sticky
 *  header counts it and `ReportChapters` reads its labels, and neither wants a ranking claim. */
/** WHICH KINDS `buildScore` CAN EXPRESS AT ALL. Membership is a property of the KIND, never of
 *  whether an `impact` number happened to arrive.
 *
 *  Splitting on `impact !== undefined` was the first version and it was wrong in a way the S9 tests
 *  caught immediately: `impact` is optional on the wire, so a report from before it existed -- or any
 *  fixture without it -- put every build finding under "what the build score cannot see", which is a
 *  false claim about the engine rather than a missing number. A build parent is a term in that score
 *  whether or not this report priced it. */
const SCORED_KINDS: ReadonlySet<FindingKind> = new Set<FindingKind>(["build", "lands", "answers"]);

export function rankedFindings(report: DeckReport): { scored: Finding[]; unseen: Finding[] } {
  const all = findings(report);
  const scored = all
    .filter((f) => SCORED_KINDS.has(f.kind))
    // Unpriced rows sort last rather than first, and the id tiebreak keeps the order stable where
    // two impacts are equal -- which two zero-impact findings are.
    .sort((a, b) => (b.impact ?? -1) - (a.impact ?? -1) || a.id.localeCompare(b.id));
  const unseen = all.filter((f) => !SCORED_KINDS.has(f.kind));
  return { scored, unseen };
}

/** WHERE THE SLOTS COME FROM — the biggest surplus, phrased as the trade it is rather than as a
 *  fault. It sits beside the findings and never inside them: a category over target is the deck
 *  spending its slots somewhere, and the engine cannot say which member to cut (nothing here ranks
 *  two ramp cards against each other), so the sentence names the CATEGORY exactly as `slack` does.
 *
 *  Returns null when there is no surplus, or when nothing is short — "you have room" is only worth
 *  saying to a reader who has just been told they need some. */
export function slotTrade(report: DeckReport, shortfalls: readonly Finding[]): string | null {
  const top = (report.slack ?? [])[0];
  if (!top || shortfalls.length === 0) return null;
  /** WHEN THE SURPLUS IS THE THING A FINDING ASKS FOR MORE OF, SAY SO (S16, 2026-09-02).
   *
   *  On the example deck the top finding asks for "two or three pieces that hit a permanent of any
   *  type" and the surplus is `Interaction 19/10 (+9)` — the same category, 300px apart, one asking
   *  for more and the other calling it spare room. Two judges filed it; the tuner: *"both are
   *  instructions and neither defers."*
   *
   *  Both are true and they are ONE instruction: the deck has plenty of interaction and all of it
   *  answers creatures, so the move is a swap inside the category, never an addition to it. The
   *  answers finding is the interaction one — `detectBuildRules` counts removal under Interaction —
   *  and a build finding names its own category in `figureLabel`. */
  const asksForSame = shortfalls.some((f) =>
    (f.kind === "answers" && top.category === "Interaction") || f.figureLabel === top.category);
  // "N of those slots are the ones you need" said the OPPOSITE of what it meant — the N are the
  // SURPLUS, which is where the room comes from. The skeptic persona read it three times and stayed
  // unsure (2026-08-27). It names the surplus as a surplus now.
  return `${top.category} sits at ${top.count} against a target of ${top.target}`
    + ` — ${top.over} more ${top.over === 1 ? "slot" : "slots"} than it needs.`
    + " That is where the room is: the deck is not short of space, it is spending it in one place."
    + (asksForSame
      ? ` And it is the same category the finding above asks for: the count is not the problem, what those ${top.count} cards can answer is. Swap inside ${top.category}, do not add to it.`
      : "");
}
