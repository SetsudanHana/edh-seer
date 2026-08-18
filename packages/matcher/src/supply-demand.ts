/** DECK-LEVEL SUPPLY AGAINST DEMAND, PER EVENT SHAPE — the census the edge-magnitude work needs
 *  before it can pick a curve.
 *
 *  An edge is binary; synergy has degree, and degree has two halves nothing here has ever measured
 *  together:
 *
 *  - **RATE.** A token engine feeds "another creature enters" every turn; a plain body feeds it
 *    once, on the way in. `Ability.repeats` has carried that distinction since 2026-08-11 and is
 *    read by NOTHING but its own report — `reason.repeatability` reads `Ability.kind`, which puts
 *    Gogo's `{X}{X}, {T}:` and a free sacrifice outlet in the same class.
 *  - **BALANCE.** Thirty token makers against one payoff means the thirtieth maker is marginal and
 *    the payoff is precious; one maker against thirty payoffs is the mirror image. `dampByAlpha`
 *    already divides a card's score by its partner count, but partner count is blind to WHICH SIDE
 *    of a shape the card is on, so it cannot say a deck is lopsided.
 *
 *  Balance is a ratio of summed rates, so rate is the primitive and this module computes both.
 *  It computes NO curve and changes NO score: the shape of the diminishing-returns term is the
 *  open question, and it is answered from the measured distribution rather than guessed at.
 *
 *  COUNTED OVER REASONS, NOT OVER A CENSUS. `buildCensus` was the obvious reuse and is the wrong
 *  population: on `naya-spellslinger` it reads ZERO suppliers for the deck's `cast:-creature`
 *  demand, because its producer/consumer matching is not the one `edges.ts` ships. A balance term
 *  will multiply reason weights, so it has to be measured on the reasons — the same mistake
 *  `build-population.ts` made by reading the flat collection while the product read the derived one.
 *
 *  A reason exists only where an edge formed, so every row here has both sides by construction.
 *  Shapes with no supply at all are therefore ABSENT rather than zero — that is an availability
 *  question, and `deckAvailability` already answers it.
 */
import { seen } from "@mtg/engine";
import type { Reason } from "@mtg/engine";
import type { Ability, CardTags } from "@mtg/tagger";

/** Events a labelled ability contributes PER ROUND of the pod, as a provisional reading of the
 *  `Repeats` taxonomy. These are the axis, not the answer: the curve that turns a supply:demand
 *  ratio into a weight is the open design question, and nothing downstream reads these numbers.
 *
 *  `once` is the honest ceiling here — it fires once per GAME, not once per round, and a single
 *  number cannot say both. It is given 1 so a one-shot never outweighs a repeatable engine; the
 *  cost is that a 60-round game and a 3-round game read the same.
 *  ponytail: flat per-round reading, replace with a game-length integral if the census says the
 *  once/per-cycle collision is actually deciding rows. */
export const EVENTS_PER_ROUND: Record<string, number> = {
  once: 1,
  "per-cycle": 1,
  "per-turn": 4,
  repeatable: 6,
  continuous: 1,
};

/** An ability whose `repeats` the rules could not read. Weighted neutral rather than zero — an
 *  unlabelled ability still supplies the event — and counted, because a side that is mostly
 *  refusals is a row nobody should draw a curve through. */
export const UNSET_RATE = 1;

/** A card supplying a shape only by existing (every nonland is cast, every permanent enters) has
 *  no ability to read a rate off. That is a real once: the body enters the battlefield one time. */
export const IMPLIED_RATE = 1;

/** Ceiling on a parsed `amount`. "Create X tokens" is unbounded and "create twenty" is a real
 *  card; without a cap one outlier decides its deck's whole ratio.
 *  ponytail: flat cap, revisit if the census shows rows hitting it. */
const AMOUNT_CAP = 10;

export interface SupplyDemandInput {
  name: string;
  tags: CardTags | null;
  isCommander: boolean;
}

export interface SideTotals {
  /** Distinct cards on this side. The unweighted baseline: if the ratio is already ~1:1 here, a
   *  balance term corrects nothing. */
  cards: number;
  /** Σ over cards of (events per round × amount). The magnitude axis. */
  rate: number;
  /** Σ over cards of (rate × P(the card is available)). A commander is available in EVERY game, so
   *  it weighs 1 while a single copy in the 99 weighs seen(turn)/library — which is the whole
   *  reason this column exists beside `rate`. */
  avail: number;
  /** A commander is on this side, so the side is available from turn one whatever `avail` says. */
  commander: boolean;
  /** Cards whose relevant ability carried no `repeats` label. */
  refused: number;
  /** Token NODES on this side. A token is not a deck card and has no draw probability of its own —
   *  it is as available as whatever makes it — so it is counted at the implied rate and reported
   *  separately rather than folded in silently.
   *  ponytail: tokens at implied rate, join `loadTokenTags` here if the tails turn out to be token
   *  rows. */
  tokens: number;
  /** `repeats` label → cards, plus `implied` for a card supplying the shape merely by existing and
   *  `token` for a token node. */
  labels: Record<string, number>;
}

export interface SupplyDemandRow {
  /** The reason tag: `enters:creature`, `cast:-creature`, `static:pump`. */
  key: string;
  /** Reasons behind this row. A pair can carry several, so this is not the pair count. */
  reasons: number;
  demand: SideTotals;
  supply: SideTotals;
}

const empty = (): SideTotals => ({ cards: 0, rate: 0, avail: 0, commander: false, refused: 0, tokens: 0, labels: {} });

/** Leading integer of an ability's `amount`, capped. "X" and any wording the parse cannot read
 *  count as one — an unknown count is not a zero, and guessing high is how a magnitude channel
 *  starts inventing engines. */
export function amountOf(a: Ability): number {
  const m = /^\s*(\d+)/.exec(a.amount ?? "");
  return m ? Math.min(Number(m[1]), AMOUNT_CAP) : 1;
}

/** One card's contribution to a shape, taking its BEST matching ability rather than summing them:
 *  a card with two matching abilities is still one card on the side, and a sacrifice outlet printed
 *  twice on one card is still one outlet's worth of throughput. */
export function cardRate(
  tags: CardTags | null,
  verb: string,
  side: "supply" | "demand",
): { rate: number; label: string } {
  const abilities = (tags?.abilities ?? []).filter((a) =>
    side === "supply"
      ? (a.emits ?? []).some((e) => e.verb === verb)
      : (a.trigger?.verbs ?? []).some((v: string) => v === verb),
  );
  if (abilities.length === 0) return { rate: IMPLIED_RATE, label: "implied" };

  let best = { rate: -1, label: "implied" };
  for (const a of abilities) {
    const label = a.repeats ?? "REFUSED";
    const rate = (a.repeats ? (EVENTS_PER_ROUND[a.repeats] ?? UNSET_RATE) : UNSET_RATE) * amountOf(a);
    if (rate > best.rate) best = { rate, label };
  }
  return best;
}

/** Supply and demand for every shape a deck's reasons claim, on three weightings: cards, rate, and
 *  rate × availability. One row per reason tag.
 *
 *  `reasons` is the deck's whole reason population — `report.edges.flatMap(e => e.reasons)`, the
 *  same array `population-compare.ts` counts. */
export function buildSupplyDemand(
  reasons: readonly Reason[],
  inputs: readonly SupplyDemandInput[],
  opts: { turn?: number } = {},
): SupplyDemandRow[] {
  const turn = opts.turn ?? 5;
  // Every physical card takes a slot whether or not the tagger could read it, so the library is
  // the FULL deck minus the command zone — the same convention `deckAvailability` uses.
  const library = Math.max(1, inputs.filter((i) => !i.isCommander).length);
  // P(a specific single copy is among the cards seen) is exactly seen/library. A commander needs
  // no drawing at all.
  const pDrawn = Math.min(1, seen(turn) / library);
  const byName = new Map(inputs.map((i) => [i.name, i]));

  // tag -> side -> distinct card names (tokens tracked apart: a token has no deck slot to draw).
  const rows = new Map<string, { reasons: number; supply: Set<string>; demand: Set<string>; supplyTokens: Set<string>; demandTokens: Set<string> }>();
  for (const r of reasons) {
    if (r.producer === undefined || r.consumer === undefined) continue;
    const row = rows.get(r.tag) ?? { reasons: 0, supply: new Set<string>(), demand: new Set<string>(), supplyTokens: new Set<string>(), demandTokens: new Set<string>() };
    row.reasons++;
    (r.producerIsToken ? row.supplyTokens : row.supply).add(r.producer);
    (r.consumerIsToken ? row.demandTokens : row.demand).add(r.consumer);
    rows.set(r.tag, row);
  }

  const side = (names: Set<string>, tokens: Set<string>, verb: string, which: "supply" | "demand"): SideTotals => {
    const out = empty();
    for (const name of names) {
      const input = byName.get(name);
      const { rate, label } = cardRate(input?.tags ?? null, verb, which);
      out.cards++;
      out.rate += rate;
      out.avail += rate * (input?.isCommander ? 1 : pDrawn);
      out.commander ||= input?.isCommander === true;
      if (label === "REFUSED") out.refused++;
      out.labels[label] = (out.labels[label] ?? 0) + 1;
    }
    for (const _ of tokens) {
      out.tokens++;
      out.cards++;
      out.rate += IMPLIED_RATE;
      out.avail += IMPLIED_RATE * pDrawn;
      out.labels.token = (out.labels.token ?? 0) + 1;
    }
    return out;
  };

  return [...rows].map(([key, r]) => {
    const verb = key.split(":")[0];
    return {
      key,
      reasons: r.reasons,
      supply: side(r.supply, r.supplyTokens, verb, "supply"),
      demand: side(r.demand, r.demandTokens, verb, "demand"),
    };
  });
}

/** Supply per unit of demand. Null when either side is empty, so a row with nothing on one side is
 *  never read as balance. */
export function ratio(row: SupplyDemandRow, weighting: "cards" | "rate" | "avail"): number | null {
  const s = row.supply[weighting];
  const d = row.demand[weighting];
  return s > 0 && d > 0 ? s / d : null;
}
