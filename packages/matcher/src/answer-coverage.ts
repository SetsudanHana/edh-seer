import { poolShare } from "./answer-pool.js";

/** The classes coverage is scored over.
 *
 *  `graveyard` IS DELIBERATELY ABSENT and this is not an oversight (design §3). Two reasons, either
 *  sufficient: it is a ZONE rather than a card type, so the `gameChanger` list that sets every
 *  baseline below says nothing about it; and its demand is purely OPPONENT-facing -- our graveyard
 *  hate answers THEIR graveyard, so the vulnerability signal runs the wrong way entirely. A
 *  reanimator deck is not made to want Rest in Peace by being a reanimator deck, it is made to fear
 *  it. Inventing a baseline for it would be the Tier C guess the 2026-08-11 answer-modes design
 *  refused. It still counts inside the Interaction COUNT through the `graveyardHate` leaf. */
export const COVERAGE_CLASSES = ["creature", "artifact", "enchantment", "planeswalker", "land"] as const;

/** How often each class appears among cards the format says you MUST answer.
 *
 *  Measured from `gameChanger: true` -- WotC's Commander Bracket list, 53 cards, of which 33 are
 *  permanents or lands: creature 10 · artifact 8 · enchantment 7 · land 7 · planeswalker 1.
 *  Renormalised over these five so the table is a distribution.
 *
 *  `edhrecRank` WAS MEASURED AND REFUSED as the source (design §2.3): its permanent split flips
 *  with the cutoff -- artifact 56% at top 200, creature 61% at top 3000 -- because the top of
 *  EDHREC is mana rocks. Rank measures inclusion, not menace, and a table built on it would name
 *  Arcane Signet the format's principal artifact threat. */
export const ANSWER_BASELINE: Record<string, number> = {
  creature: 10 / 33, artifact: 8 / 33, enchantment: 7 / 33, land: 7 / 33, planeswalker: 1 / 33,
};

/** Where recurring graveyard hate actually lives, measured over the corpus cards matching
 *  `graveyardHateRecurring`: creature 36 · artifact 16 · enchantment 6, n = 58 typed.
 *
 *  So a deck whose plan runs through the graveyard needs creature and artifact removal
 *  specifically -- Scavenging Ooze and Grafdigger's Cage, not a Naturalize.
 *
 *  KNOWN CEILING, and it bounds how much weight this table can ever carry: the corpus can COUNT
 *  hate pieces and cannot RANK them. Rest in Peace and Scavenging Ooze are both one row of the 58,
 *  though the first turns a reanimator deck off completely and the second eats one card a turn.
 *  Nothing derived separates a total shutoff from incremental exile.
 *  ponytail: count-weighted, upgrade when a severity field exists. */
export const GRAVEYARD_HATE_SHARE: Record<string, number> = {
  creature: 36 / 58, artifact: 16 / 58, enchantment: 6 / 58, land: 0, planeswalker: 0,
};

export interface CoverageResult {
  /** The multiplier applied to `Interaction`'s count attainment. */
  coverage: number;
  /** The CLAMPED vulnerability this coverage was built with -- carried because the panel needs it
   *  and it cannot be recovered from the rows. */
  graveyardVulnerability: number;
  /** `unweighted` when no colour identity was supplied -- every `poolShare` is forced to 1 and the
   *  panel says so. A deck whose identity is unknown must not be told its colours are thin. */
  source: "weighted" | "unweighted";
  rows: { class: string; poolShare: number; demand: number; weight: number; covered: boolean }[];
}

/** `coverage` = the pool-and-demand-weighted share of the classes this deck answers at all.
 *
 *  A BLEND, NEVER A SUM (design §4). `(1-v)·baseline + v·hateShare` keeps total demand mass at 1,
 *  so vulnerability SHIFTS demand toward the hate profile. An additive bump would raise creature
 *  demand by 0.62 at the same moment it raised artifact by 0.28, and since the denominator is a sum
 *  over all classes, inflating every term leaves each class's SHARE almost exactly where it started
 *  -- which is the whole term doing nothing.
 *
 *  There is no free coefficient here: `v` is the archetype confidence, already bounded [0,1], and
 *  `hateShare` is already a share. Nothing to sweep, and therefore nothing to tune until a gate
 *  goes green.
 *
 *  `covered` is BINARY (`count >= 1`), never `count >= required`: the caller multiplies this by a
 *  count attainment, and a count-based `covered` would make the product roughly count squared -- a
 *  magnitude claim wearing a coverage costume. Coverage says BREADTH, the count says ENOUGH. */
export function answerCoverage(
  colorIdentity: string[] | undefined,
  coveredClasses: Set<string>,
  graveyardVulnerability: number,
): CoverageResult {
  const v = Math.min(1, Math.max(0, graveyardVulnerability));
  const weighted = colorIdentity !== undefined;
  const rows = COVERAGE_CLASSES.map((cls) => {
    const share = colorIdentity === undefined ? 1 : poolShare(colorIdentity, cls);
    const demand = (1 - v) * (ANSWER_BASELINE[cls] ?? 0) + v * (GRAVEYARD_HATE_SHARE[cls] ?? 0);
    return { class: cls as string, poolShare: share, demand, weight: share * demand, covered: coveredClasses.has(cls) };
  });
  const total = rows.reduce((s, r) => s + r.weight, 0);
  // Unreachable with the shipped tables (creature's weight is positive in every identity), but a
  // zero denominator must read as "we cannot say", never as a deck that answers nothing.
  const coverage = total > 0 ? rows.reduce((s, r) => s + (r.covered ? r.weight : 0), 0) / total : 1;
  return { coverage, source: weighted ? "weighted" : "unweighted", graveyardVulnerability: v, rows };
}
