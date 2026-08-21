import type { Reason, ArchetypeGroup } from "@mtg/engine";

/** Closed set of synergy mechanism categories, derived from EDHREC's most popular themes with
 *  kindred/tribal dropped (kindred is a "same creature type" axis, not a synergy mechanism this
 *  harness targets). Provisional membership — tune by reading real emitted reasons during eval. */
export const MECHANISM_CATEGORIES = [
  "aristocrats",
  "tokens-go-wide",
  "spellslinger",
  "reanimator",
  "voltron-auras",
  "lifegain-payoff",
  "landfall",
  "counters-plus1",
  "mana-ramp-payoff",
  "graveyard-matters",
  "attack-matters",
  "blink-etb",
  "mill-self",
  "wheels-draw",
  "toughness-matters",
  "power-matters",
] as const;

export type MechanismCategory = (typeof MECHANISM_CATEGORIES)[number];

/** A category's accepted reason signatures. A reason matches the category if its `tag` is in
 *  `tags` OR its `effectKind` is in `effectKinds`. `effectKinds` values are EFFECT_KINDS members;
 *  `tags` values are matcher reason tags of the form `${verb}:${subjectKey}` or `static:${kind}`. */
export interface CategoryMatchEntry {
  tags?: string[];
  effectKinds?: string[];
  /** Kinds that let a pair JOIN the category but never count toward its RANK.
   *
   *  `damage` and `pump` are how the compass's gold pairs reach tokens-go-wide and voltron-auras —
   *  the payoff side of go-wide triggers on a creature ENTERING and never says "token" — and they
   *  are also the two widest kinds in the corpus, so ranking by them made a burn package outrank
   *  the deck's actual engine. Ranking on the DEFINING signals only separates the two: on the
   *  review deck, tokens-go-wide's 440 pairs collapse to its handful of real token pairs and
   *  Spellslinger's 373 `cast:-creature` pairs lead, which is what that deck is. */
  supportingKinds?: string[];
  /** When true, a matching tag/effectKind is not enough — the Reason must also carry
   *  hasStatPredicate:true. Used for categories whose whole point is a StatPredicate gate
   *  (power-matters, toughness-matters), where the linking tag alone is shared with
   *  unconditional producers of the same event. */
  requireStatPredicate?: boolean;
}

/** Category -> accepted reason signatures. This table is the ONLY coupling between the gold set
 *  and engine internals — on a tag rename, only this table changes.
 *
 *  A CATEGORY MATCHES ITS DEFINING SIGNAL, NEVER A SHARED PAYOFF KIND. `damage` used to sit in
 *  FOUR entries (aristocrats, tokens-go-wide, spellslinger, attack-matters) and `token-generation`
 *  in landfall, so any burn card joined four archetypes at once and any token maker was "Landfall"
 *  — measured across the 71 calibration decks, 439 of 860 groups claimed more than 60% of their
 *  deck. `archetypes.ts` had already learned this for the CARD-based signatures ("damage was
 *  excluded from every ARCHETYPE_SIGNATURE entry deliberately — it used to mesh aristocrats/tokens/
 *  spellslinger/attack-matters together via CATEGORY_MATCH"); the edge-group table kept the defect
 *  for another three weeks because nothing measured it.
 *  → `specs/2026-08-20-report-usability-review.md` §3 F2 */
export const CATEGORY_MATCH: Record<MechanismCategory, CategoryMatchEntry> = {
  aristocrats: { effectKinds: ["drain", "player-life-loss", "forced-sacrifice"] },
  // `damage` AND `pump` STAY HERE, and the compass is why. Narrowing this entry to the token
  // signals alone costs THREE gold pairs — Purphoros / Krenko, Impact Tremors / Jetmir, Mirkwood
  // Bats / Jetmir — whose only emitted reasons are `enters:creature` and `static:pump`: the payoff
  // side of go-wide triggers on a creature ENTERING and never says "token", so the kind is how this
  // category is actually recognised. Wide by consequence, and the near-duplicate dedupe below plus
  // the reader's own pair counts are what carry it.
  "tokens-go-wide": {
    tags: ["create-token:any"],
    effectKinds: ["token-generation", "token-doubling"],
    supportingKinds: ["pump", "damage"],
  },
  // `cast:-creature` IS the spellslinger trigger and was missing: prowess, magecraft and every
  // "whenever you cast a noncreature spell" derive it, and it is the single commonest cast tag in
  // the calibration decks at 4,212 reasons against `cast:instant`'s 1,952. Without it this category
  // was reached only through `damage`/`draw-card`, i.e. by accident. `cast:noncreature` is the same
  // trigger as the FLAT tag pipeline spells it, which is what the compass runs on — both spellings,
  // or the gold set fails on a rename nobody made. `cast:spell` stays OUT: it is the unnarrowed
  // trigger, which a creature satisfies too.
  spellslinger: {
    tags: ["cast:-creature", "cast:noncreature", "cast:instant", "cast:sorcery"],
    effectKinds: ["copy-spell"],
  },
  reanimator: { effectKinds: ["graveyard-recursion", "animate"] },
  // VOLTRON WAS NARROWED TO ITS OBJECTS AND THE COMPASS REFUSED IT. Gating on `enters:aura` /
  // `enters:equipment` reads better on the calibration decks — this category otherwise claims 69 of
  // 92 cards in decks running no Auras at all, because `pump` is one of the widest kinds in the
  // corpus — but it costs FOUR gold pairs: All That Glitters, Ethereal Armor, Ancestral Mask and
  // Sage's Reverie against Setessan Champion emit `enters:enchantment` and `static:pump`, never an
  // aura-typed tag, so the narrow rule deletes the archetype's own textbook pairs. Left wide, with
  // the loss recorded rather than the ratchet raised.
  "voltron-auras": { tags: ["enters:aura", "enters:equipment"], supportingKinds: ["pump", "counter-placement"] },
  "lifegain-payoff": { tags: ["gain-life:any"], effectKinds: ["drain"] },
  landfall: { tags: ["enters:land"] },
  "counters-plus1": { tags: ["proliferate:any"], effectKinds: ["counter-placement", "enters-with-counters"] },
  "mana-ramp-payoff": { effectKinds: ["mana-generation", "fast-mana", "ritual", "cost-reduction", "tax"] },
  // `top-manipulation` IS NOT A GRAVEYARD KIND, and it was the whole category. `effect-kind.ts`
  // maps search, scry, surveil AND mill to it, so every tutor and every fetchland read as a
  // graveyard card -- measured on `samut-the-driving-force`, a deck with no graveyard theme: 77
  // pairs, ZERO carrying a graveyard-recursion reason, `top-manipulation` 92 and nothing else, every
  // row the mana base ("Arid Mesa can fetch Cinder Glade"). Mill is the one member with a real
  // graveyard claim and the KIND cannot separate it from a fetchland, so it cannot carry the
  // category; a self-mill deck reaches `mill-self` on `enters-graveyard:*` instead.
  "graveyard-matters": { effectKinds: ["graveyard-recursion"] },
  "attack-matters": { tags: ["attacks:creature"] },
  "blink-etb": { effectKinds: ["flicker", "clone"] },
  "mill-self": { tags: ["enters-graveyard:creature", "enters-graveyard:any"] },
  "wheels-draw": { tags: ["draw:any"], effectKinds: ["draw-card"] },
  // Conditional stat edges (Slice 1): the predicate itself isn't in the reason tag — the tag is
  // still `${verb}:${subjectKey}` / `static:${kind}` regardless of any `stats` predicate on the
  // subject, and that linking tag is shared with any unconditional producer of the same event.
  // Unlike every other category in this table, a tag match alone is NOT sufficient here — these
  // two are the exception: requireStatPredicate additionally demands reason.hasStatPredicate,
  // so only a genuinely predicate-gated match (not a coincidental unconditional one) counts.
  "toughness-matters": { tags: ["static:damage-multiplier"], requireStatPredicate: true },
  "power-matters": { tags: ["enters:creature"], requireStatPredicate: true },
};

/** True if the reason satisfies the category: its tag is accepted OR its effectKind is accepted.
 *  When the category's entry sets requireStatPredicate, a tag/effectKind match alone is not
 *  enough — the reason must also carry hasStatPredicate:true. */
export function categoryMatches(reason: Reason, category: MechanismCategory): boolean {
  const entry = CATEGORY_MATCH[category];
  const matches =
    categoryDefines(reason, category) ||
    (reason.effectKind !== undefined && (entry.supportingKinds?.includes(reason.effectKind) ?? false));
  if (!matches) return false;
  if (entry.requireStatPredicate && !reason.hasStatPredicate) return false;
  return true;
}

/** True when the reason carries the category's DEFINING signal, i.e. not merely a supporting kind.
 *  This is what a group is ranked and kept by; `categoryMatches` is what a pair joins by. */
export function categoryDefines(reason: Reason, category: MechanismCategory): boolean {
  const entry = CATEGORY_MATCH[category];
  const hit =
    (reason.tag !== undefined && (entry.tags?.includes(reason.tag) ?? false)) ||
    (reason.effectKind !== undefined && (entry.effectKinds?.includes(reason.effectKind) ?? false));
  if (!hit) return false;
  if (entry.requireStatPredicate && !reason.hasStatPredicate) return false;
  return true;
}

export const MECHANISM_LABELS: Record<MechanismCategory, string> = {
  aristocrats: "Aristocrats",
  "tokens-go-wide": "Tokens Go Wide",
  spellslinger: "Spellslinger",
  reanimator: "Reanimator",
  "voltron-auras": "Voltron & Auras",
  "lifegain-payoff": "Lifegain Payoff",
  landfall: "Landfall",
  "counters-plus1": "+1/+1 Counters",
  "mana-ramp-payoff": "Ramp Payoff",
  "graveyard-matters": "Graveyard Matters",
  "attack-matters": "Attack Triggers",
  "blink-etb": "Blink / ETB",
  "mill-self": "Self-Mill",
  "wheels-draw": "Draw Engine",
  "toughness-matters": "Toughness Matters",
  "power-matters": "Power Matters",
};

/** Groups synergy edges by mechanism category. An edge can land in more than one
 *  group (a pair can be both Aristocrats and Tokens); edges matching zero categories
 *  collect into a synthetic "other" group so nothing silently disappears. Categories
 *  with zero matching edges are omitted entirely. Sorted by member-card count
 *  descending (ties: label ascending), except "other" which always sorts last. */
export function groupEdgesByArchetype(
  edges: { a: string; b: string; reasons: Reason[] }[],
): ArchetypeGroup[] {
  // TWO PASSES, because whether a category SURVIVES decides where an edge goes. A category held up
  // entirely by a supporting kind is refused (see below), and its pairs must then fall to "other"
  // rather than vanish — "nothing silently disappears" is this function's oldest contract.
  const defining = new Map<MechanismCategory, number>();
  const matchedBy = new Map<{ a: string; b: string; reasons: Reason[] }, MechanismCategory[]>();
  for (const edge of edges) {
    const matched = MECHANISM_CATEGORIES.filter((cat) => edge.reasons.some((r) => categoryMatches(r, cat)));
    matchedBy.set(edge, matched);
    for (const cat of matched) {
      if (edge.reasons.some((r) => categoryDefines(r, cat))) defining.set(cat, (defining.get(cat) ?? 0) + 1);
    }
  }
  // A GROUP HELD UP ENTIRELY BY A SUPPORTING KIND RANKS LAST — it is not DROPPED, and the browser
  // is what settled that. Refusing it outright reads well on the big calibration decks and deletes
  // "Tokens Go Wide" from a 17-card Krenko goblin deck, whose token pairs are all `enters:creature`
  // + `damage`: token mediation means a maker's `create-token` edge points at the TOKEN node, which
  // `cardEdges` excludes, so a small token deck can carry zero defining token pairs and still be
  // the archetype. Ranked last and then passed through the near-duplicate filter below, such a
  // group survives when it is the only thing describing its pairs and disappears when a
  // better-defined group already covers them.
  const groups = new Map<
    MechanismCategory | "other",
    { cards: Set<string>; pairs: { a: string; b: string; reasons: Reason[] }[] }
  >();
  for (const edge of edges) {
    const matched = matchedBy.get(edge) ?? [];
    const categories: (MechanismCategory | "other")[] = matched.length > 0 ? matched : ["other"];
    for (const category of categories) {
      if (!groups.has(category)) groups.set(category, { cards: new Set(), pairs: [] });
      const g = groups.get(category)!;
      g.cards.add(edge.a);
      g.cards.add(edge.b);
      g.pairs.push({ a: edge.a, b: edge.b, reasons: edge.reasons });
    }
  }

  const result: ArchetypeGroup[] = [...groups.entries()].map(([category, g]) => ({
    category,
    label: category === "other" ? "Other synergies" : MECHANISM_LABELS[category],
    cards: [...g.cards].sort(),
    pairs: g.pairs,
  }));

  // SORTED BY DEFINING PAIRS, NOT BY CARD COUNT. Card count is what a group REACHES and pairs are
  // what it CLAIMS — on the review deck four groups all read "70 cards" while their pair counts ran
  // 334 to 440, so the ranking the reader was shown could not separate them at all. Ranking on the
  // DEFINING pairs additionally stops a category held up by `damage` outranking the deck's own
  // engine: tokens-go-wide's 440 pairs are mostly a burn package, and Spellslinger's 373 are what
  // that deck is.
  const rank = (g: ArchetypeGroup): number =>
    g.category === "other" ? 0 : defining.get(g.category as MechanismCategory) ?? 0;
  result.sort((x, y) => {
    if (x.category === "other") return 1;
    if (y.category === "other") return -1;
    return rank(y) - rank(x) || y.pairs.length - x.pairs.length || x.label.localeCompare(y.label);
  });

  return dedupeNearIdentical(result);
}

/** How much of a group's pair set has to sit inside a bigger group's before it is saying the same
 *  thing twice. Not 1.0: `graveyard-matters` and `reanimator` are both defined by
 *  `graveyard-recursion` and differ only in the handful of pairs one reaches through a second
 *  kind, which is a taxonomy overlap rather than two findings. */
const DUPLICATE_SHARE = 0.9;

/** Drops a group whose pairs are already almost entirely inside a larger group's.
 *
 *  Three categories are defined by `graveyard-recursion` alone, so a deck with a reanimation
 *  package was told the same fact three times under three headings — measured across the 71
 *  calibration decks before this ran, `graveyard-matters`, `mill-self` and `reanimator` each
 *  matched exactly 4,659 reasons, i.e. the identical set. The bigger group wins and the smaller
 *  says nothing, rather than the taxonomy being re-cut: both labels are true of the same pairs, and
 *  which noun a player prefers is not something this engine can know. */
function dedupeNearIdentical(groups: ArchetypeGroup[]): ArchetypeGroup[] {
  const key = (p: { a: string; b: string }): string => `${p.a}\u0000${p.b}`;
  const kept: { group: ArchetypeGroup; keys: Set<string> }[] = [];
  for (const g of groups) {
    const mine = new Set(g.pairs.map(key));
    const duplicate = kept.some(({ keys }) => {
      const shared = [...mine].filter((p) => keys.has(p)).length;
      return mine.size > 0 && shared / mine.size >= DUPLICATE_SHARE;
    });
    if (!duplicate) kept.push({ group: g, keys: mine });
  }
  return kept.map((k) => k.group);
}
