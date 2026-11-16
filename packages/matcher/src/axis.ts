import { globalIDF, type Reason, type TagStats } from "@edh-seer/engine";
import { tagKey } from "./zones.js";

/** Extra TF mass given to the commander's own theme tags so the commander anchors the axis —
 *  but the weight is still × globalIDF, so a generic commander ability (near-zero idf) can't
 *  define the plan. Tunable starting point (calibrated on real decks). */
export const COMMANDER_TF_BOOST = 8;

/** The deck's strategy axis as a tag→weight map, weighting each theme by TF-IDF: deckFreq
 *  (repetition = intent) × globalIDF (rarity = distinctiveness), normalized so the deck's
 *  strongest theme is 1.0. Universal tags (draw:any, enters:any) have idf≈0 and drop out.
 *  Keeps every tag with weight > 0; the on-axis cutoff is applied by the caller's predicate. */
export function buildAxis(
  commanderThemeTags: Set<string>,
  deckFreq: Map<string, number>,
  stats: TagStats,
  /** The own-theme relation families (#1095): `freq` from `relationThemeFreq`, `stats` the cross-deck
   *  counts. Each is weighed `freq x globalIDF` like a theme but normalized by the THEMES' strongest
   *  tf-idf and capped at 1, so a relation never moves a theme's weight. */
  relation?: { freq: ReadonlyMap<string, number>; stats: TagStats },
): Map<string, number> {
  const tfidf = new Map<string, number>();
  for (const [tag, freq] of deckFreq) {
    const tf = freq + (commanderThemeTags.has(tag) ? COMMANDER_TF_BOOST : 0);
    const w = tf * globalIDF(stats, tag);
    if (w > 0) tfidf.set(tag, w);
  }
  const max = Math.max(0, ...tfidf.values());
  const axis = new Map<string, number>();
  if (max > 0) for (const [tag, w] of tfidf) axis.set(tag, w / max);
  if (relation && max > 0) {
    for (const [tag, freq] of relation.freq) {
      if (!isOwnThemeTag(tag) || axis.has(tag)) continue;
      const w = Math.min(1, (freq * globalIDF(relation.stats, tag)) / max);
      if (w > 0) axis.set(tag, w);
    }
  }
  return axis;
}

/** Relation families (reason tags that are never on the axis) and the axis themes they feed.
 *  `fodder:X` feeds the deck's sacrifice/death theme on X; `scales:X` grows with the board of X;
 *  `cheat:X` puts X onto the battlefield; `creates:X` makes X. Step 1 of #972. Step 2 (#1095, owner
 *  ruling 2026-11-16 "Mixed"): `graveyard-recursion:X` and `recursion-target:X` ride the deck's
 *  death / graveyard-fill theme on X, `threshold:X` its graveyard-fill theme. `prowess` is NOT here:
 *  see `ZERO_ON_PURPOSE`. */
export const RELATION_PARENTS: Record<string, readonly string[]> = {
  fodder: ["sacrifice", "dies"],
  // CEILING: `scales:X` is keyed by the counted class alone, so a TAG cannot say whether the count is of the
  // board or of a graveyard. A REASON can (`scaling: "per-graveyard"`, `GRAVEYARD_SCALING_PARENTS`), and
  // `reasonAxisWeight` reads that; a caller holding only the tag (`axisWeightOf`: the suggestions' pair-tag
  // hint) still gives a graveyard count the board's `enters` / `create-token` weight (#1095).
  scales: ["enters", "create-token"],
  cheat: ["enters"],
  creates: ["create-token", "enters"],
  "graveyard-recursion": ["dies", "enters-graveyard"],
  "recursion-target": ["dies", "enters-graveyard"],
  threshold: ["enters-graveyard"],
};

/** The parents of a `scales:X` reason whose count is of a GRAVEYARD ("each creature card in your
 *  graveyard", Bonehoard): the deck's death and graveyard-fill themes, never the board's. The graveyard
 *  channel (edges.ts, `graveyardScalingEdges`) is the only one that sets `scaling: "per-graveyard"`. */
export const GRAVEYARD_SCALING_PARENTS: readonly string[] = ["dies", "enters-graveyard"];

/** FAMILIES LEFT AT AXIS WEIGHT 0 ON PURPOSE (owner ruling 2026-11-16, #1095): a land finder's target and a
 *  land's own condition are mana-base links, not part of the plan. `prowess` joined them by the owner's
 *  2026-11-16 amendment: a prowess-style self-pump is a helper, not a synergy (#517, owner 2026-09-27),
 *  so it never borrows the noncreature-cast theme's weight (`cast:-creature`) even in a deck built on it. They are named here so the 0 is a
 *  decision a reader can find, and `axisWeightOf` never gives them a weight whatever the axis holds. */
export const ZERO_ON_PURPOSE: readonly string[] = ["ramp-target", "land-condition", "prowess"];

/** FAMILIES WEIGHED AS DECK THEMES OF THEIR OWN (owner ruling 2026-11-16, #1095): no parent theme to
 *  borrow, so the weight is how many cards in the deck hold the relation (`relationThemeFreq`) times a
 *  cross-deck rarity (`relation-stats.json`), the TF-IDF `buildAxis` gives every theme. */
export const OWN_THEME_FAMILIES: readonly string[] = [
  "tutor", "copies", "doubles", "play-from-top", "reuse", "keyword-grant", "graveyard-intercept", "pump",
  "extra-loyalty", "clone", "condition", "exile-processing", "imprint", "wincon", "flash", "meld",
];
const OWN_THEME = new Set(OWN_THEME_FAMILIES);
const ZERO = new Set(ZERO_ON_PURPOSE);
const familyOf = (tag: string): string => tag.slice(0, tag.indexOf(":") < 0 ? undefined : tag.indexOf(":"));
/** Is this reason tag one the deck's own-theme statistic weighs? */
// A bare tag is a family too: the meld channel writes plain `"meld"` (edges.ts, `meldReason`).
export const isOwnThemeTag = (tag: string): boolean => OWN_THEME.has(familyOf(tag));

/** How often the deck's cards hold each own-theme relation, per reason tag: the number of DISTINCT
 *  cards on the smaller side of it (producers or consumers). The card that does or asks the thing is
 *  the few (the tutors; the one threshold card; the doubler), the class that satisfies it the many
 *  (every creature a tutor can find), and the few are the deck's intent, as `deckFreq` counts the
 *  cards that carry a theme tag. A reason that names no producer or no consumer counts for nothing.
 *  CEILING: the smaller side stands in for "the card that holds the ability", which each channel in
 *  edges.ts knows and the reason does not carry; a relation both sides of which are many is read as
 *  the smaller many. */
export function relationThemeFreq(reasons: readonly Reason[]): Map<string, number> {
  const sides = new Map<string, { p: Set<string>; c: Set<string> }>();
  for (const r of reasons) {
    if (!isOwnThemeTag(r.tag) || r.producer === undefined || r.consumer === undefined) continue;
    const s = sides.get(r.tag) ?? sides.set(r.tag, { p: new Set(), c: new Set() }).get(r.tag)!;
    s.p.add(r.producer);
    s.c.add(r.consumer);
  }
  return new Map([...sides].map(([tag, s]) => [tag, Math.min(s.p.size, s.c.size)] as const));
}

/** One tag's axis weight: its own entry if present (an explicit entry always wins), else the
 *  strongest parent-theme weight for a mapped relation family, else 0. */
export function axisWeightOf(tag: string, axis: ReadonlyMap<string, number>): number {
  return weightFrom(tag, axis, undefined);
}

function weightFrom(tag: string, axis: ReadonlyMap<string, number>, only: readonly string[] | undefined): number {
  const i = tag.indexOf(":");
  if (i >= 0 && ZERO.has(tag.slice(0, i))) return 0;
  const own = axis.get(tag);
  if (own !== undefined) return own;
  if (i < 0) return 0;
  const parents = only ?? (Object.hasOwn(RELATION_PARENTS, tag.slice(0, i)) ? RELATION_PARENTS[tag.slice(0, i)] : undefined);
  if (!parents) return 0;
  const subject = tag.slice(i + 1);
  let w = 0;
  for (const p of parents) w = Math.max(w, axis.get(tagKey(p, subject)) ?? 0);
  return w;
}

/** A REASON's axis weight: `axisWeightOf`, except that a `scales:X` reason counting a GRAVEYARD reads the
 *  death / graveyard-fill themes (`GRAVEYARD_SCALING_PARENTS`) instead of the board's. */
export function reasonAxisWeight(r: Pick<Reason, "tag" | "scaling">, axis: ReadonlyMap<string, number>): number {
  return r.scaling === "per-graveyard" && r.tag.startsWith("scales:") ? weightFrom(r.tag, axis, GRAVEYARD_SCALING_PARENTS) : axisWeightOf(r.tag, axis);
}

/** The strongest axis weight among an edge's reason tags (0 when none are on-axis). */
export function maxAxisWeight(reasons: Reason[], axis: Map<string, number>): number {
  let maxW = 0;
  for (const r of reasons) {
    const w = reasonAxisWeight(r, axis);
    if (w > maxW) maxW = w;
  }
  return maxW;
}

/** Multiplier for an edge's contribution: 1 when it touches nothing on-axis, up to 1+boost when a
 *  reason is fully on-axis. Uses the strongest on-axis reason. */
export function axisFactor(reasons: Reason[], axis: Map<string, number>, boost: number): number {
  return 1 + boost * maxAxisWeight(reasons, axis);
}
