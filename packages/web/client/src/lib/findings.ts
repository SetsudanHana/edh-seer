import type { DeckReport } from "../types.js";

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

export type FindingKind = "build" | "answers" | "colour" | "lands";

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
  /** 0–1: the fraction of the target that is MISSING. The sort key. */
  shortfall: number;
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
      action: suggestion ? suggestion.replace(/^[^—]*—\s*/, "").replace(/^add/, "Add") : undefined,
      figure: `${p.count}/${p.target}`,
      figureLabel: p.name,
      filled: p.count / p.target,
      shortfall: missing / p.target,
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
  return {
    kind: "answers",
    id: "answers",
    headline,
    detail: `${short.map((a) => `${a.count} for ${a.class}s`).join(", ")}`
      + `${turn ? ` — about a ${pct(worst.available)}% chance of holding the ${worst.class} answer by turn ${turn}` : ""}`
      + `, against the ${worst.required} copies it takes to call an answer reliable.`,
    action: "Two or three pieces that hit a permanent of any type.",
    figure: `${pct(worst.available)}%`,
    figureLabel: turn ? `by turn ${turn}` : "available",
    filled: worst.available,
    shortfall,
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

/** LANDS AGAINST THE REGRESSION'S OWN TARGET. Both directions are a finding — a deck four lands
 *  under floods out on spells it cannot cast, and one four over draws lands instead of action —
 *  which is why this is the one source whose shortfall is an ABSOLUTE distance from target. */
function landFinding(report: DeckReport): Finding | null {
  const lands = report.deckMath?.lands;
  if (!lands || lands.target <= 0) return null;
  const delta = lands.actual - lands.target;
  if (delta === 0) return null;
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
  };
}

/** The ranked diagnosis. Highest shortfall first; ties by kind name so the order is stable across
 *  runs rather than stable to the engine's iteration order — the same rule the cut list keeps. */
export function findings(report: DeckReport): Finding[] {
  const all = [
    ...buildFindings(report),
    ...colourFindings(report),
    ...(answerFinding(report) ? [answerFinding(report)!] : []),
    ...(landFinding(report) ? [landFinding(report)!] : []),
  ];
  all.sort((a, b) => b.shortfall - a.shortfall || a.id.localeCompare(b.id));
  return all;
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
  // "N of those slots are the ones you need" said the OPPOSITE of what it meant — the N are the
  // SURPLUS, which is where the room comes from. The skeptic persona read it three times and stayed
  // unsure (2026-08-27). It names the surplus as a surplus now.
  return `${top.category} sits at ${top.count} against a target of ${top.target}`
    + ` — ${top.over} more ${top.over === 1 ? "slot" : "slots"} than it needs.`
    + " That is where the room is: the deck is not short of space, it is spending it in one place.";
}
