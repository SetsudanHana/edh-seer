import { themeName } from "./theme-names.js";
import { describeTag, tagFamily, type Tag } from "./tags.js";

// Re-exported for callers that historically imported it from here (e.g. this file's own test)
// and for parity with globalIDF/rankThemes/etc. below — tagFamily itself now lives in tags.js,
// next to describeTag, the other tag-string-splitter.
export { tagFamily };

export interface TagStats {
  N: number;
  counts: Record<string, number>;
}

export interface Cohesion {
  /** describeTag of the primary theme tag. */
  theme: string;
  tag: Tag;
  /** describeTag of the secondary theme, or null when the deck has only one theme. */
  secondary: string | null;
  secondaryTag: Tag | null;
  /** Share of nonland cards touching the PRIMARY THEME ITSELF, in [0,1]. Hand-checkable against the
   *  decklist: for `enters:wizard` it is the deck's Wizard count over its nonland count. */
  score: number;
  /** THE TWO NUMBERS `score` IS THE RATIO OF (roadmap T4). A share with no denominator on screen is
   *  not a figure -- the owner read "focused · 0.47" and asked what it even meant, and the answer
   *  was never printed. Both halves ship so a reader can check the fraction against their own list,
   *  and `onThemeCount` counts the commander when the commander is on theme, exactly as `score`
   *  does. */
  onThemeCount: number;
  nonlandCount: number;
  /** Share of nonland cards touching the primary's folded FAMILY. Equals `score` when the primary is
   *  already general — `enters:creature` IS its family. The pair is the point (roadmap A10): a name
   *  can be specific while the plan is broad, and one number cannot say both. `cult-of-clones` reads
   *  "daleks entering" at theme 0.08 and family 0.46 — five Daleks inside a creature deck, which is
   *  a real and actionable thing to be told. */
  familyScore: number;
  /** THE PLAYER'S NAME FOR THE THEME (roadmap T2): "Enchantress" where `theme` says "enchantments
   *  entering". Equal to `theme` when no name is known, so a reader is never shown a blank and a
   *  caller never has to choose. */
  name: string;
  /** The secondary theme's player name, null exactly when `secondary` is. */
  secondaryName: string | null;
  label: string;
  /** Whether this theme is strong enough to NAME the deck (roadmap A15). False when the primary
   *  touches less than `THEME_NAME_FLOOR` of the nonlands: the tag is still the deck's
   *  best-supported theme and every other reader keeps using it, but a report that leads with it is
   *  telling a player their deck is about something 3 cards do.
   *
   *  THE BAR IS NOT A CORRECTNESS PREDICTION, and it must not be read as one. Measured over the 71
   *  calibration decks, cohesion does NOT separate right headlines from wrong ones -- against the
   *  owner's own deck names the hits have median cohesion 0.31 and the MISSES 0.33, and the worst
   *  wrong headline (`naya-spellslinger`, "creatures entering") sits at 0.70 and is a perfectly TRUE
   *  sentence. What this bar catches is a different thing: a headline with no support at all. */
  dominant: boolean;
}

/** Share of nonlands the primary theme must touch before the report leads with it. Chosen from the
 *  distribution rather than from correctness: cohesion over the 71 decks runs min 0.02, p10 0.08,
 *  median 0.33, max 1.00, and the tail below 0.10 is `venser` 0.02, `mishra-claimed-by-tokens` 0.03
 *  and four decks at 0.05-0.06 -- headlines carried by one or two cards. */
export const THEME_NAME_FLOOR = 0.1;

export const COMBO_EDGE_WEIGHT = 1000;

/** Geometric decay applied per theme rank: weight = THEME_DECAY^(rank-1). */
export const THEME_DECAY = 2 / 3;

/** Cached max-observed idf per stats object -- one pass over `counts`, reused for every lookup. */
const maxObservedIDFCache = new WeakMap<TagStats, number>();

/** The idf of the RAREST tag the corpus actually observed. An absent tag is clamped to this. */
function maxObservedIDF(stats: TagStats): number {
  const cached = maxObservedIDFCache.get(stats);
  if (cached !== undefined) return cached;
  let min = Infinity;
  for (const c of Object.values(stats.counts)) if (c < min) min = c;
  // Empty corpus (UNIFORM_STATS): nothing observed, so there is nothing to clamp to and every
  // tag scores the same log(N+1) constant -- the deliberate deckFreq-only fallback.
  const idf = Math.log((stats.N + 1) / (min === Infinity ? 1 : min + 1));
  maxObservedIDFCache.set(stats, idf);
  return idf;
}

/**
 * Rarity weight of a tag. An ABSENT tag is CLAMPED to the rarest OBSERVED tag rather than scoring
 * the unreachable log(N+1) ceiling: absence is not evidence of extreme rarity. Two ways a tag is
 * absent while being nothing of the kind -- a chosen-type-RESOLVED tag (`attacks:lord`) that
 * `gen-theme-stats` computes over raw card documents can never see, and a tag whose generator ran
 * before the derivation that produces it (the `combat-damage` staleness of 2026-08-18). Unclamped,
 * both out-rank every real theme in the deck, which is how a 3-card fragment became a headline.
 */
export function globalIDF(stats: TagStats, tag: Tag): number {
  const count = stats.counts[tag];
  if (count === undefined) return maxObservedIDF(stats);
  return Math.log((stats.N + 1) / (count + 1));
}

/**
 * Order a deck's tags into themes. A tag's ranking strength is its own deckFreq × globalIDF,
 * plus its `:any` sibling's strength when the deck also has one — subsumption of a specific
 * subject by the general form of the same mechanism (`counter-added:creature` picks up
 * `counter-added:any`), so a deck whose counters split 17/16 across `:creature` and `:any`
 * still outranks a single `draw:any` of 18. `:any` never folds a second copy of itself. Two
 * DIFFERENT subjects of the same verb — `tribe:wizard` vs `tribe:goblin`, `static:pump` vs
 * `static:cost-reduction` — are different themes and are NEVER summed; only the literal `:any`
 * tag folds. Within that, individual deckFreq × globalIDF breaks the tie — dense AND rare wins
 * over a dense-but-common staple (mana) or a rare-but-incidental one-off — then lexical order
 * for determinism.
 */
/** How a deck's themes are grouped and named. Absent (or `alpha: 0`) reproduces the per-tag
 *  ranking exactly, which is the wiring acceptance test — see
 *  `specs/2026-08-19-theme-family-ranking-design.md`. */
export interface ThemeRankOptions {
  /** Maps a tag to the family key it is COUNTED under (matcher's `makeFold`). */
  fold: (tag: Tag) => Tag;
  /** How much of the rest of a family's strength is added to its strongest member. 0 = today. */
  alpha: number;
  /** Share of a family's tf-idf MASS its top member must hold to NAME the family. Mass rather than
   *  count because rarity concentrates it: a tribe's rare tag holds most of its family's mass while
   *  a 22-way token split holds ~10% of its own. Count share is the rule MEASURED to fail — it
   *  generalised nine of twelve decks to "creatures entering" (reverted 2026-08-18). */
  massShare: number;
}

export function rankThemes(deckFreq: Map<Tag, number>, stats: TagStats, opts?: ThemeRankOptions): Tag[] {
  const scored = [...deckFreq.entries()]
    .map(([tag, freq]) => ({ tag, key: freq * globalIDF(stats, tag) }));
  const keyByTag = new Map(scored.map((s) => [s.tag, s.key]));

  // Subsumption key: a tag's own strength, plus its ":any" sibling's strength if the deck has
  // one. NOT the whole family's sum — `tribe:goblin` gets no credit from `tribe:wizard`, and
  // `:any` doesn't add a second copy of itself.
  const subsumedKey = (tag: string): number => {
    const anyTag = `${tagFamily(tag)}:any`;
    const own = keyByTag.get(tag) ?? 0;
    return anyTag === tag ? own : own + (keyByTag.get(anyTag) ?? 0);
  };

  const perTag = scored
    .sort((a, b) => {
      const fa = subsumedKey(a.tag);
      const fb = subsumedKey(b.tag);
      // subsumed strength first, then the tag's own strength, then lexical for determinism
      return fb - fa || b.key - a.key || a.tag.localeCompare(b.tag);
    })
    .map((r) => r.tag);
  if (!opts || opts.alpha === 0) return perTag;

  // FAMILIES RANK, THE MASS-DOMINANT CHILD NAMES.
  const members = new Map<Tag, Tag[]>();
  for (const tag of deckFreq.keys()) {
    const key = opts.fold(tag);
    members.set(key, [...(members.get(key) ?? []), tag]);
  }
  const mass = (tag: Tag): number => (deckFreq.get(tag) ?? 0) * globalIDF(stats, tag);
  const ranked: { key: Tag; score: number; name: Tag }[] = [];
  for (const [key, ms] of members) {
    const strengths = ms.map(subsumedKey).sort((a, b) => b - a);
    const score = strengths[0] + opts.alpha * strengths.slice(1).reduce((a, b) => a + b, 0);
    const total = ms.reduce((sum, t) => sum + mass(t), 0);
    const top = ms.reduce((best, t) => (mass(t) > mass(best) || (mass(t) === mass(best) && t < best) ? t : best), ms[0]);
    // A family whose members carry no mass at all (every idf 0) cannot be named by one of them.
    const name = total > 0 && mass(top) / total >= opts.massShare ? top : key;
    ranked.push({ key, score, name });
  }
  return ranked
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .map((r) => r.name);
}

/** Map each deck tag to its theme weight THEME_DECAY^(rank-1) (rank 1 = weight 1). */
export function themeWeights(deckFreq: Map<Tag, number>, stats: TagStats): Map<Tag, number> {
  const weights = new Map<Tag, number>();
  rankThemes(deckFreq, stats).forEach((tag, i) => weights.set(tag, Math.pow(THEME_DECAY, i)));
  return weights;
}

/** Sum theme weights over DISTINCT reason tags; a combo edge is a large constant. */
export function weightedEdge(reasons: { tag: string }[], weightOf: (tag: string) => number): number {
  if (reasons.some((r) => r.tag === "combo")) return COMBO_EDGE_WEIGHT;
  const seen = new Set<string>();
  let sum = 0;
  for (const r of reasons) {
    if (seen.has(r.tag)) continue;
    seen.add(r.tag);
    sum += weightOf(r.tag);
  }
  return sum;
}

/** Damped weighted sum: rewards on-theme breadth while tempering wide hubs. */
export function dampedScore(totalWeighted: number, partnerCount: number): number {
  return partnerCount > 0 ? totalWeighted / Math.sqrt(partnerCount) : 0;
}

/** HOW CONCENTRATED THE DECK IS ON ITS THEME, and the words are deliberately NOT "focused" any more
 *  (roadmap T4). `scoreBand` in the client labels the 0-5 deck score "Focused" at 3.0, and this
 *  labelled the 0-1 theme share "focused" at 0.30 -- two unrelated scales, one word, both printed on
 *  the same screen. The owner read them together and asked which one the deck was. This scale is a
 *  SHARE of the nonlands, so it says how concentrated they are; the 0-5 ladder keeps "Focused",
 *  where it reads as build quality. */
export function cohesionLabel(score: number): string {
  if (score >= 0.6) return "highly concentrated";
  if (score >= 0.3) return "concentrated";
  return "scattered";
}

/**
 * Cohesion from the ranked themes: names the primary (and secondary) theme and scores
 * how much of the deck sits on the primary theme (share of nonland cards carrying it).
 */
export function computeCohesion(
  ranked: Tag[],
  deckFreq: Map<Tag, number>,
  nonlandCount: number,
  fold: (tag: Tag) => Tag = (t) => t,
  /** Each nonland card's own theme tags. COHESION IS A SHARE OF CARDS, and without this it cannot
   *  be one: the fallback sums `deckFreq` across the family, which counts a card ONCE PER TAG it
   *  carries in that family. A Wizard whose own entry keys `enters:wizard` and which also triggers
   *  on `enters:creature` was counted twice. Measured: 5 of the 71 calibration decks read exactly
   *  1.00 because the sum ran PAST the card count and `Math.min(1, ...)` clamped it -- so the
   *  headline number was an over-count wearing a ceiling, not a share. Supply it and the clamp
   *  becomes unreachable. Absent (the flat engine, which holds no per-card tag sets), the old sum
   *  is kept so that caller's numbers do not silently change. */
  cardThemeTagSets?: readonly ReadonlySet<Tag>[],
  /** For each tag, the tags in its family it SUBSUMES — ones saying something strictly narrower.
   *  Cohesion is a SHARE, so a card whose theme tag sits INSIDE the primary's claim is on theme:
   *  `cast:instant` is inside `cast:-creature`, and counting them apart is what left three decks
   *  the owner named "spellslinger" with no theme at all. Supplied by the caller because the subset
   *  relation lives in `hierarchy.ts`, one layer up.
   *
   *  THE RANKING IS DELIBERATELY NOT GIVEN THIS, and the reason is measured: absorbing the relation
   *  into `rankThemes` eats the family from whichever end it is applied — the narrow end promoted
   *  "instants" onto nine decks, the wide end put "enters" on a dozen and cost `marchesa` its 0.98
   *  legends headline. Cohesion is a SHARE and the axis is a RANKING, which is the same split
   *  recorded when folding the axis was tried in 2026-08-18. */
  subsumes?: ReadonlyMap<Tag, readonly Tag[]>,
): Cohesion | null {
  // `tribe-nontoken:X` is a matching-precision shadow of `tribe:X`, not a distinct
  // theme — drop it from theme naming so cohesion reports "Wizards", not the
  // near-duplicate "nontoken Wizards". It still carries edge weight via rankThemes.
  const themes = ranked.filter((t) => !t.startsWith("tribe-nontoken:"));
  if (themes.length === 0 || nonlandCount === 0) return null;
  const primary = themes[0];
  // Secondary must be a different mechanism, not just the next tag: rankThemes only folds a
  // tag's own weight with its literal ":any" sibling (subsumption), so a same-family pair like
  // counter-added:creature / counter-added:any is not guaranteed to be adjacent in `ranked` —
  // but describeTag has no per-family case for most families, so a same-family secondary would
  // still render the identical label as the primary. Comparing family, not position, catches
  // that wherever in the ranking it falls.
  const secondary = themes.slice(1).find((t) => tagFamily(t) !== tagFamily(primary)) ?? null;
  // COHESION MEASURES THE FAMILY, THE RANKING AND THE AXIS DO NOT (2026-08-18).
  //
  // A deck whose plan is "make tokens" splits across 22 `create-token:<subtype>` tags, so counting
  // only the primary TAG reported the owner's Samut list as 3 of 63 nonlands -- 0.05, "unfocused",
  // for a deck that is plainly focused. Summing whatever folds to the primary's family fixes that
  // number and touches nothing else.
  //
  // FOLDING THE AXIS TOO WAS TRIED THE SAME DAY AND MEASURABLY REGRESSED: collapsing many axis keys
  // into one made that key normalize to 1.0 and pushed every other family down, so the same deck
  // went breadth 4.2 -> 2.0 and SYNERGY 3.8 -> 2.9, while 9 of 12 sampled decks -- every tribal one
  // among them -- themed the identical "creatures entering". Cohesion is a SHARE, which a family
  // answers correctly; the axis is a RANKING, where one universal bucket destroys the signal.
  // A SPECIFIC PRIMARY MEASURES ITSELF; A GENERAL ONE MEASURES ITS FAMILY (2026-08-19, roadmap A10).
  // `fold(tag) === fold(primary)` counted the whole family whatever the primary was. That is right
  // for the case the fold shipped for -- a token deck splitting across 22 `create-token:<subtype>`
  // keys read 3 of 63 nonlands, 0.05 "unfocused" -- and wrong once the primary is already specific:
  // `inalla` read "wizards entering 0.71" where 0.71 was the share of the deck that is CREATURE-ish.
  // The label named one thing and the number measured another.
  //
  // ONE PREDICATE, NO BRANCH. A general primary is its own fold key, so `fold(tag) === primary`
  // still admits every family member and its number is byte-identical. A specific primary is not
  // its own fold key, so nothing folds INTO a leaf and only the tag itself counts.
  const covered = new Set(subsumes?.get(primary) ?? []);
  const onTheme = (tag: Tag): boolean => tag === primary || fold(tag) === primary || covered.has(tag);
  const inFamily = (tag: Tag): boolean => fold(tag) === fold(primary);
  const share = (member: (tag: Tag) => boolean): number => {
    if (cardThemeTagSets) {
      // DISTINCT CARDS, which is what "share of the deck on theme" means.
      let count = 0;
      for (const tags of cardThemeTagSets) {
        for (const t of tags) if (member(t)) { count++; break; }
      }
      return count / nonlandCount;
    }
    let freq = 0;
    for (const [tag, n] of deckFreq) if (member(tag)) freq += n;
    return Math.min(1, freq / nonlandCount);
  };
  const score = share(onTheme);
  const familyScore = share(inFamily);
  // The numerator behind `score`, recovered from the share rather than counted a second way: two
  // counts of one thing is how this repo has produced disagreeing numbers before.
  const onThemeCount = Math.round(score * nonlandCount);
  const theme = describeTag(primary);
  const secondaryTheme = secondary ? describeTag(secondary) : null;
  return {
    theme,
    /** The player's name for the same thing -- see `theme-names.ts`. Carried BESIDE the mechanical
     *  phrase, never instead of it: every edge reason still needs the mechanism. */
    name: themeName(primary, theme),
    tag: primary,
    secondary: secondaryTheme,
    /** The secondary's player name, on the same rule as `name`. Both halves of the theme line are
     *  named or neither is; naming one and leaving "re-firing entry triggers" beside it was the
     *  version of this that shipped for an hour. */
    secondaryName: secondary && secondaryTheme ? themeName(secondary, secondaryTheme) : null,
    secondaryTag: secondary,
    score,
    onThemeCount,
    nonlandCount,
    familyScore,
    label: cohesionLabel(score),
    dominant: score >= THEME_NAME_FLOOR,
  };
}
