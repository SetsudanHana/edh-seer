import { WIN_PHRASE } from "@edh-seer/matcher/deck-sentence";
import type { DeckReport } from "../types.js";
import { cutWeight, displayName, type CutRow, type EngineCard, type EngineModel } from "./engine-model.js";

/** ONE CUT LIST (owner, 2026-09-26: "it does not make any sense to have 2 times the same report").
 *
 *  The report and the Graph tab's Overview each had one, and they never contradicted each other,
 *  but they answered differently (cut comparison, 2026-09-26):
 *  - the report's was strict enough to be right and too strict to use: 0 or 1 rows on most decks;
 *  - the Overview's always had six, and over half of them broke a protection the report applies on
 *    purpose: draw spells and tutors, main-theme Wizards, a two-faced card with a land back.
 *
 *  So this takes WHO IS ELIGIBLE from the report and HOW TO SAY IT from the Overview:
 *  - The universe is the report's trim order: faces merged into one card, lands and commanders out.
 *  - A role (any of them, lands included), half of a combo, a job done without links, links to more
 *    than half the deck, and "not read yet" keep a card off the list outright, as does being a
 *    theme's key card (the Overview's rule: Skullclamp listed while "Creatures dying" named it as
 *    its key card).
 *  - The main theme and a high rating are ARGUMENTS, not gates: they print as "keeps it:" and sort
 *    the card after the ones nothing argues for, so a tight deck still gets rows.
 *  - Ranked and worded by the Overview's link reading (repeating links count, once-only ones count
 *    a quarter unless something brings the card back); the report's unmet conditions ride along.
 *    "Doesn't fill a core role" is dropped: it was true of every row, so it said nothing. */
export interface CutChoice {
  /** The physical card, as the report names it. */
  name: string;
  manaValue: number;
  /** Its front face, when the graph has it, for the picture and the text. */
  card?: EngineCard;
  /** The Overview's reading of it, when the graph has links. */
  row?: CutRow;
  /** What argues it stays. */
  keeps: string[];
  /** "its condition needs …, and nothing in the deck provides that". */
  unmet: string[];
  /** The report's own reasons, for a deck the graph could not read. */
  reasons: string[];
  /** Cards used by exactly the same cards, folded in: they stand in for each other. */
  twins: string[];
}

/** Protections that keep a card off the list rather than argue for it. */
const GATES = [/^fills /, /^half of a combo/, /^does its work without forming edges/, /^not read yet/,
  // A card wired into half the deck is not "doing the least", whatever else is true of it: on
  // Inalla, Ghostly Flicker (30 cards) made the list as an argument rather than a gate.
  /^connects to \d+ cards, more than half this deck/];
const UNMET = /^its condition needs /;

/** THE ENGINE'S ARGUMENTS, IN A PLAYER'S WORDS (appeal review 2026-09-26). "Rates 1.3 of 5" read as
 *  a low mark offered as a reason to keep, because it never said what 5 was; "best edge" is the
 *  graph's word, used nowhere else on the page. */
export function keepWords(p: string): string {
  const rate = /^rates (\d+(?:\.\d+)?) of 5 in this deck$/.exec(p);
  if (rate) return `it scores ${rate[1]} for synergy, where 5 is this deck's best card`;
  if (p === "its best edge is on your main theme") return "its strongest link is to your main theme";
  return p;
}
/** True of every row once role-fillers are gone, so it says nothing. */
const SAYS_NOTHING = /^doesn't fill a core role/;

export function chooseCuts(report: DeckReport, model?: EngineModel | null): CutChoice[] {
  // A saved report from before trim mode: its passive list is the whole answer it has.
  if (!report.trim?.length) {
    return (report.cutList ?? []).map((c) => ({
      name: c.name, manaValue: c.manaValue, keeps: [], twins: [],
      unmet: c.reasons.filter((r) => UNMET.test(r)),
      reasons: c.reasons.filter((r) => !UNMET.test(r) && !SAYS_NOTHING.test(r)),
    }));
  }
  // The Overview's rows by physical card; a card with two readable faces is read by its stronger
  // one, so it is never proposed on its weaker half alone (the report's rule for faces).
  const rowOf = new Map<string, CutRow>();
  const frontOf = new Map<string, EngineCard>();
  const drivers = new Set<string>();
  if (model) {
    for (const r of model.cutRows) {
      const prev = rowOf.get(r.card.physical);
      if (!prev || cutWeight(r) > cutWeight(prev)) rowOf.set(r.card.physical, r);
    }
    for (const c of model.cards.values()) if (!c.isToken && !c.faceOf && !frontOf.has(c.physical)) frontOf.set(c.physical, c);
    for (const g of model.groups) for (const id of g.hubs) { const c = model.cards.get(id); if (c) drivers.add(c.physical); }
  }
  const ranked = report.trim
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !drivers.has(t.name) && !t.protections.some((p) => GATES.some((g) => g.test(p))))
    .sort((a, b) => a.t.protections.length - b.t.protections.length
      || (rowOf.has(a.t.name) && rowOf.has(b.t.name) ? cutWeight(rowOf.get(a.t.name)!) - cutWeight(rowOf.get(b.t.name)!) : 0)
      || a.i - b.i);
  // A CUT THAT IS ALSO A WIN PLAN'S CARD SAYS SO (persona round, 2026-09-27: three of four cuts
  // sat on the win plans two chapters up, and nothing on either said it). An argument to keep, not
  // a gate: the plan counts it by what its text says, not by how much it does here.
  const plansOf = new Map<string, string[]>();
  for (const c of report.deckMath?.wincons.classes ?? []) {
    for (const n of [...(c.cards ?? []), ...(c.payoffs ?? [])]) {
      const phrase = WIN_PHRASE[c.class] ?? c.class;
      if (!(plansOf.get(n) ?? []).includes(phrase)) plansOf.set(n, [...(plansOf.get(n) ?? []), phrase]);
    }
  }
  const out: CutChoice[] = [];
  // Twins: a card that only feeds others, fed by exactly the same cards as one already listed.
  const usersKey = (r: CutRow) => [...r.fedBy].sort().join("\u0001");
  for (const { t } of ranked) {
    const row = rowOf.get(t.name);
    const feeder = row && !row.keepActs && row.fedBy.length ? row : undefined;
    const twin = feeder ? out.find((x) => x.row && !x.row.keepActs && usersKey(x.row) === usersKey(feeder)) : undefined;
    if (twin) { twin.twins.push(displayName(row!.card)); continue; }
    out.push({
      name: t.name, manaValue: t.manaValue, card: frontOf.get(t.name) ?? row?.card, row,
      keeps: [...t.protections.map(keepWords), ...(plansOf.get(t.name) ?? []).map((p) => `it is one of the cards your win plan of ${p} counts`)],
      unmet: t.reasons.filter((r) => UNMET.test(r)),
      reasons: t.reasons.filter((r) => !UNMET.test(r) && !SAYS_NOTHING.test(r)),
      twins: [],
    });
  }
  return out;
}

/** Role cards offered for a swap, beyond the cut list, at most this many. */
export const SWAP_CANDIDATES = 10;

/** ROLE CARDS THAT COULD BE SWAPPED FOR A BETTER CARD IN THE SAME ROLE (owner, 2026-09-26: "we can
 *  suggest additions"; the precon seat wanted five to ten swaps and got three). The cut list never
 *  offers a card that fills a role, which is right for a CUT: the role still needs filling. A SWAP
 *  keeps the role filled, so a role card is fair game as long as the card taking its slot does the
 *  same job and works with more of the deck; `pairReplacements` checks both.
 *
 *  Only cards whose sole protection is a role (a combo half, a theme's key card or an unread card is
 *  never offered), weakest first in the report's trim order, and never cheap ramp: a one- or
 *  two-mana rock is the one role card every list keeps, and trading Sol Ring for a card with more
 *  connections is advice no player would take. */
export function swapCandidates(report: DeckReport, cuts: readonly CutChoice[]): string[] {
  const taken = new Set(cuts.flatMap((c) => [c.name, ...c.twins]));
  const rolesOf = new Map(report.cards.map((c) => [c.cardName ?? c.name, c.roles ?? []] as const));
  return (report.trim ?? [])
    .filter((t) => !taken.has(t.name) && t.protections.length > 0 && t.protections.every((p) => /^fills /.test(p)))
    .filter((t) => !(t.manaValue <= 2 && (rolesOf.get(t.name) ?? []).includes("ramp")))
    .slice(0, SWAP_CANDIDATES)
    .map((t) => t.name);
}

/** THE CARDS A ROLE SECTION OF THE PRECON UPGRADE PACKAGE MAY CUT (#767): every card the report would
 *  keep only for the role it fills, and no theme's key card. `swapCandidates` without its cap and
 *  without its cheap-ramp rule: there a swap only had to work with more of the deck, here the card
 *  coming in must be strictly better at the same job, which no Sol Ring loses to. */
export function roleSwapCuts(report: DeckReport, model?: EngineModel | null): string[] {
  const drivers = new Set<string>();
  if (model) for (const g of model.groups) for (const id of g.hubs) { const c = model.cards.get(id); if (c) drivers.add(c.physical); }
  return (report.trim ?? [])
    .filter((t) => !drivers.has(t.name) && t.protections.length > 0 && t.protections.every((p) => /^fills /.test(p)))
    .map((t) => t.name);
}
