/** The ratings axis, which nothing watched until now (ROADMAP Track 3, named twice: `322d129`'s
 *  duplicate-copy fix and the tokens-as-nodes mediation both changed per-card partner counts and
 *  said so in their commit messages, both asserting it from the code path because no instrument
 *  could read it).
 *
 *  Pure on purpose: `bin/ratings-compare.ts` does the Mongo reads and hands two snapshots here, so
 *  the comparison itself is testable without a database.
 *
 *  READ THE DECK-RELATIVE CAVEAT BEFORE TRUSTING A NULL RESULT. `computeSynergyRatings` divides
 *  every score by the deck's own max, so a change that lifts EVERY card's score by the same factor
 *  moves no rating at all. A zero here means "the ordering and the relative distances held", never
 *  "no score changed" -- that is what `score` is carried for. */

/** One card's four rated figures. `score` is the raw damped synergy score the rating normalizes;
 *  it is snapshotted alongside so a null rating delta can be told apart from a null score delta. */
export interface CardRating {
  rating: number;
  score: number;
  partners: number;
  authority: number;
}

export interface DeckRatings {
  deck: string;
  /** Deck-level facets from the same report: `positiveCoherence`, `anchoring`, `synergyOverall`. */
  breadth: number;
  anchoring: number;
  synergyOverall: number;
  cards: Record<string, CardRating>;
}

export type Snapshot = DeckRatings[];

export interface Mover {
  deck: string;
  name: string;
  from: number;
  to: number;
}

export interface FacetMove {
  deck: string;
  facet: "breadth" | "anchoring" | "synergyOverall";
  from: number;
  to: number;
}

export interface RatingsDiff {
  decks: number;
  /** Decks present in one snapshot only -- a deck list that changed between runs. */
  decksOnlyInA: string[];
  decksOnlyInB: string[];
  cardsCompared: number;
  cardsOnlyInA: number;
  cardsOnlyInB: number;
  ratingsMoved: number;
  scoresMoved: number;
  partnersMoved: number;
  /** Mean |Δrating| over compared cards, including the unmoved ones -- the honest denominator. */
  meanAbsRatingDelta: number;
  topMovers: Mover[];
  /** Decks whose highest-rated card changed identity: the loudest signal here, because that card
   *  is what the report leads with. */
  decksTopCardChanged: string[];
  /** Decks whose top-10 by rating changed MEMBERSHIP (order within it is not counted). */
  decksTopTenChanged: string[];
  facetMoves: FacetMove[];
}

/** Ratings are rounded to one decimal by `computeSynergyRatings`, so anything at all is a visible
 *  step and this threshold only guards float residue. */
const EPS = 1e-9;

const moved = (a: number, b: number): boolean => Math.abs(a - b) > EPS;

/** Cards ordered the way the report orders them, so "the top card" here is the top card there:
 *  rating first, then partner count, then name -- the tie-break `analyzeDeckStructured` uses. */
function ranked(cards: Record<string, CardRating>): string[] {
  return Object.entries(cards)
    .sort((x, y) => y[1].rating - x[1].rating || y[1].partners - x[1].partners || x[0].localeCompare(y[0]))
    .map(([name]) => name);
}

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;

export function diffRatings(a: Snapshot, b: Snapshot, topMoverLimit = 20): RatingsDiff {
  const byDeckA = new Map(a.map((d) => [d.deck, d] as const));
  const byDeckB = new Map(b.map((d) => [d.deck, d] as const));

  const out: RatingsDiff = {
    decks: 0,
    decksOnlyInA: [...byDeckA.keys()].filter((d) => !byDeckB.has(d)).sort(),
    decksOnlyInB: [...byDeckB.keys()].filter((d) => !byDeckA.has(d)).sort(),
    cardsCompared: 0, cardsOnlyInA: 0, cardsOnlyInB: 0,
    ratingsMoved: 0, scoresMoved: 0, partnersMoved: 0,
    meanAbsRatingDelta: 0,
    topMovers: [],
    decksTopCardChanged: [],
    decksTopTenChanged: [],
    facetMoves: [],
  };

  let absSum = 0;
  const movers: Mover[] = [];

  for (const [deck, da] of byDeckA) {
    const db = byDeckB.get(deck);
    if (!db) continue;
    out.decks++;

    for (const facet of ["breadth", "anchoring", "synergyOverall"] as const) {
      if (moved(da[facet], db[facet])) {
        out.facetMoves.push({ deck, facet, from: da[facet], to: db[facet] });
      }
    }

    for (const [name, ca] of Object.entries(da.cards)) {
      const cb = db.cards[name];
      if (!cb) { out.cardsOnlyInA++; continue; }
      out.cardsCompared++;
      absSum += Math.abs(ca.rating - cb.rating);
      if (moved(ca.rating, cb.rating)) {
        out.ratingsMoved++;
        movers.push({ deck, name, from: ca.rating, to: cb.rating });
      }
      if (moved(ca.score, cb.score)) out.scoresMoved++;
      if (ca.partners !== cb.partners) out.partnersMoved++;
    }
    for (const name of Object.keys(db.cards)) if (!(name in da.cards)) out.cardsOnlyInB++;

    const rankA = ranked(da.cards), rankB = ranked(db.cards);
    if (rankA[0] !== rankB[0]) out.decksTopCardChanged.push(deck);
    if (!sameSet(rankA.slice(0, 10), rankB.slice(0, 10))) out.decksTopTenChanged.push(deck);
  }

  out.meanAbsRatingDelta = out.cardsCompared === 0 ? 0 : absSum / out.cardsCompared;
  out.topMovers = movers
    .sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from) || x.name.localeCompare(y.name))
    .slice(0, topMoverLimit);
  return out;
}

export function formatRatingsDiff(d: RatingsDiff, labelA: string, labelB: string): string {
  const lines: string[] = [];
  lines.push(`\n${d.decks} decks compared  (${labelA}  ->  ${labelB})`);
  if (d.decksOnlyInA.length || d.decksOnlyInB.length) {
    lines.push(`  DECK LIST DIFFERS: ${d.decksOnlyInA.length} only in ${labelA}, ${d.decksOnlyInB.length} only in ${labelB}`);
  }
  lines.push(`  cards compared            ${d.cardsCompared}` +
    (d.cardsOnlyInA || d.cardsOnlyInB ? `  (only in ${labelA}: ${d.cardsOnlyInA}, only in ${labelB}: ${d.cardsOnlyInB})` : ""));
  lines.push(`  RATINGS moved             ${d.ratingsMoved}  (mean |delta| ${d.meanAbsRatingDelta.toFixed(4)})`);
  lines.push(`  raw scores moved          ${d.scoresMoved}`);
  lines.push(`  partner counts moved      ${d.partnersMoved}`);
  lines.push(`  decks whose TOP card changed      ${d.decksTopCardChanged.length}/${d.decks}`);
  for (const deck of d.decksTopCardChanged.slice(0, 10)) lines.push(`      ${deck}`);
  lines.push(`  decks whose TOP-10 membership moved ${d.decksTopTenChanged.length}/${d.decks}`);
  for (const deck of d.decksTopTenChanged.slice(0, 10)) lines.push(`      ${deck}`);
  lines.push(`  deck facet moves          ${d.facetMoves.length}`);
  for (const f of d.facetMoves.slice(0, 15)) {
    lines.push(`      ${f.deck.padEnd(38)} ${f.facet.padEnd(14)} ${f.from} -> ${f.to}`);
  }
  if (d.topMovers.length > 0) {
    lines.push(`  biggest rating movers:`);
    for (const m of d.topMovers) {
      lines.push(`      ${m.deck.padEnd(30)} ${m.name.padEnd(34)} ${m.from} -> ${m.to}`);
    }
  }
  // Stated every run, not only when the result is null: a reader who forgets this reads a zero as
  // "nothing changed" when it means "nothing changed RELATIVE to the deck's own best card".
  lines.push(`  NOTE: a rating is deck-relative (score / deck max), so a uniform lift moves no rating.`);
  lines.push(`        Read "raw scores moved" beside "RATINGS moved" before calling a change inert.`);
  return lines.join("\n");
}
