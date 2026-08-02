import type { SaltPayload } from "./calibrate-core.js";
import { ARCHETYPE_SIGNATURE, type Archetype } from "../archetypes.js";

/** Slugify a card name to CommanderSalt's key format (lowercase, underscored):
 *  "Venser, Shaper Savant" -> "venser_shaper_savant".
 *
 *  Apostrophes are STRIPPED, not replaced: CS emits "an_offer_you_cant_refuse" and
 *  "vivis_persistence", verified against a live payload 2026-08-02. calibrate.ts's local
 *  `slug()` replaces them instead, producing "an_offer_you_can_t_refuse" -- so it silently
 *  drops every apostrophe card from its CS correlation. Do not copy that helper. */
export function csSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The 30 card categories CommanderSalt emits under cards.<slug>.categories.stats,
 *  observed live on 2026-08-02. Kept explicit so a new upstream category surfaces as an
 *  unmapped-list failure rather than being silently ignored. */
export const CS_CATEGORIES: readonly string[] = [
  "anthem", "aristocrats", "blink", "boardWipes", "burn", "cantrip", "cheat", "clone",
  "combat", "costReduction", "counterspell", "discard", "enchantress", "fastmana",
  "graveyard", "groupslug", "kindred", "landsmatter", "manafixing", "multipliers",
  "otherControl", "plusOnePlusOneCounters", "ramp", "reanimator", "recursion", "slow",
  "spotRemoval", "tokens", "topdeck", "tutor",
];

/** CS slug -> the set of categories CS labelled that card with. Cards present but unlabelled
 *  map to an empty set, so "CS saw this card and gave it nothing" stays distinguishable from
 *  "CS never saw this card". */
export function csCardCategories(payload: SaltPayload): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [slug, card] of Object.entries(payload.cards ?? {})) {
    const stats = card?.categories?.stats ?? {};
    out.set(slug, new Set(Object.entries(stats).filter(([, v]) => v === true).map(([k]) => k)));
  }
  return out;
}

export interface CsDeckArchetype {
  major: string;
  minor: string;
  /** Sub-archetype name -> percentage, flattened across majors. */
  subPercentages: Map<string, number>;
}

/** Deck-level archetype labels, or null when the payload has no archetype block. */
export function csDeckArchetype(payload: SaltPayload): CsDeckArchetype | null {
  const a = payload.details.archetypes;
  if (!a) return null;
  const subPercentages = new Map<string, number>();
  for (const major of Object.values(a.percentages ?? {})) {
    for (const [name, sub] of Object.entries(major.subArchetypes ?? {})) {
      if (typeof sub.percentage === "number") subPercentages.set(name, sub.percentage);
    }
  }
  return { major: a.dominantArchetype ?? "", minor: a.dominantSubArchetype ?? "", subPercentages };
}

/** The "typal" group from functional-otags.json, copied verbatim (all 40 slugs, all
 *  classifier-eligible per otag-semantics.json). Not re-read from the JSON at runtime because
 *  this module's only sanctioned otag dependency is loadOtagSemantics (see Interfaces); the
 *  values below were sourced by reading functional-otags.json directly, not from memory. */
const TYPAL_SLUGS: readonly string[] = [
  "noncreature-typal", "typal-coupling", "typal-choose", "typal-share",
  "typal-dragon", "typal-elf", "typal-spirit", "typal-zombie", "typal-sliver", "typal-goblin",
  "typal-human", "typal-vampire", "typal-ally", "typal-merfolk", "typal-wizard", "typal-army",
  "typal-dinosaur", "typal-warrior", "typal-soldier", "typal-knight", "typal-elemental",
  "typal-pirate", "typal-hero", "typal-bird", "typal-rat", "typal-mount", "typal-villain",
  "typal-assassin", "typal-giant", "typal-cleric", "typal-faerie", "typal-demon", "typal-spider",
  "typal-non-human", "typal-squirrel", "typal-kithkin", "typal-lupine", "typal-beast",
  "typal-dwarf", "typal-treefolk",
];

/** CS category -> the otag classifier slugs that should select the same cards. Hand-authored
 *  against cards CS actually labels (see the plan's Task 2 Step 1: sampled live from all 6
 *  calibration decks' cards.<slug>.categories.stats), NOT from name similarity and NOT derived
 *  from co-occurrence in the corpus this is then scored against. Every slug here carries
 *  "classifier" in its otag-semantics.json `uses` (enforced by test) -- several slugs that read
 *  as an obvious fit by name (death-trigger, landfall-other, land-count-matters, cantrip,
 *  spot-removal, tutor-to-hand, board-wipe, ramp) are edge/weight-only or bare and were dropped;
 *  see task-2-report.md for the by-category reasoning and the sampled cards that drove each
 *  choice. */
export const CS_CATEGORY_TO_OTAGS: Record<string, string[]> = {
  aristocrats: [
    "sacrifice-outlet-creature", "sacrifice-outlet-artifact", "sacrifice-outlet-token",
    "free-sacrifice-outlet", "repeatable-sacrifice-outlet", "drain-life", "opponent-loses-life",
    "blood-artist-ability",
  ],
  // Measured recall (2026-08-02, all 6 calibration decks): only 20/83 (24%) of CS-tagged `tokens`
  // cards carry one of these 4 slugs. The mapped slugs all require REPEATABLE token generation,
  // but CS also labels one-shot token spells (Secure the Wastes, Empty the Warrens, March of the
  // Multitudes, Chatterstorm, Arachnogenesis, Grand Crescendo) that the otag vocabulary has no
  // classifier for -- only repeatable-* variants exist (a known, previously-documented gap). The
  // engine's own `tokens` ARCHETYPE_SIGNATURE (create-token:any, no repeatable requirement) is
  // strictly broader than this mapping, so a low otag recall on `tokens` in the three-way
  // comparison is this vocabulary ceiling, not a classification failure -- do not read it as
  // "otags under-cover tokens relative to the engine" without this caveat.
  tokens: ["repeatable-token-generator", "repeatable-creature-tokens", "synergy-token", "token-doubler"],
  // Full "typal" group from functional-otags.json -- all 40 slugs.
  kindred: [...TYPAL_SLUGS],
  // `mass-reanimation` is ~15% contaminated (7/56 sampled cards, e.g. Splendid Reclamation,
  // World Shaper, Planar Birth, Summon: Titan): those return only land cards from the graveyard,
  // no creature reanimation -- arguably `landsmatter`, not `reanimator`. Left mapped as-is: the
  // slug is still overwhelmingly mass creature-reanimation, and all CS-sampled `reanimator` cards
  // hit cleanly against it; this is a note for whoever reads the recall numbers next, not a
  // reason to remap.
  reanimator: ["reanimate-creature", "mass-reanimation"],
  recursion: ["recursion", "recursion-any", "regrowth", "regrowth-any", "flashback", "gives-flashback", "cast-from-graveyard"],
  blink: ["flicker-creature", "flicker-slow", "flicker-self"],
  // Measured recall (2026-08-02, all 6 calibration decks): only 4/15 (27%) of CS-tagged
  // `landsmatter` cards carry `landfall`. The misses (Crucible of Worlds, The Reality Chip,
  // Kelpie Guide, Terrain Generator, ...) are land-recursion and extra-land-play cards, not
  // Landfall triggers -- there is no other land-related classifier slug in the otag vocabulary
  // to cover them. Same vocabulary-ceiling shape as `tokens` above: a low recall here reflects a
  // gap in what the otag vocabulary can express, not a mismapping.
  landsmatter: ["landfall"],
  plusOnePlusOneCounters: ["gives-pp-counters", "gains-pp-counters", "counters-matter", "pp-counters-matter"],
  anthem: ["anthem", "keyword-anthem", "power-boost-to-all", "toughness-boost-to-all"],
  clone: ["clone", "copy-creature", "copy-self", "copy-spell", "copy-instant", "copy-sorcery", "copy-artifact", "multi-copy"],
  graveyard: ["hate-graveyard"],
  multipliers: ["trigger-doubler", "mana-increaser", "counter-doubler"],
  burn: ["burn-player", "damage-increaser", "power-doubler"],
};

/** CS categories with no otag counterpart. These are OUR vocabulary gaps, reported as bucket C.
 *  `counterspell` is a deliberate one: counterspells were excluded from the functional otag
 *  list during the vocabulary expansion as "interaction, not synergy", and CS treats them as a
 *  deck-defining CONTROL signal. The rest were sampled and found either (a) genuinely universal
 *  staples the otag vocabulary deliberately keeps out of `classifier` (ramp, ramp-adjacent
 *  manafixing, spotRemoval, boardWipes, tutor), or (b) heterogeneous CS buckets with no single
 *  coherent otag mechanism underneath (cheat, combat, otherControl, groupslug, discard,
 *  topdeck), or (c) a deck-tempo/style label rather than a mechanism (slow), or (d) a name-alike
 *  otag slug that turned out weight-only, not classifier (cantrip). See task-2-report.md. */
export const CS_UNMAPPED: readonly string[] = [
  "counterspell", "fastmana", "slow", "cheat", "enchantress",
  "boardWipes", "cantrip", "combat", "costReduction", "discard", "groupslug", "manafixing",
  "otherControl", "ramp", "spotRemoval", "topdeck", "tutor",
];

/** CS category -> the engine archetype whose ARCHETYPE_SIGNATURE covers the same ground.
 *  Only these can be scored three ways; everything else mapped is otags-vs-CS only. */
export const CS_CATEGORY_TO_ARCHETYPE: Record<string, Archetype> = {
  tokens: "tokens",
  aristocrats: "aristocrats",
  landsmatter: "landfall",
  reanimator: "reanimator",
  plusOnePlusOneCounters: "counters",
};

/** Shape of details.archetypes.archetypes.<MAJOR>.subArchetypes.<SUB>, observed live on every
 *   2026-08-02 cached payload in .cs-cache/: `list` is CS slugs (same format as csSlug/
 *  csCardCategories keys -- e.g. "heralds_horn"), `total` is a synergy-graph weight emitted as a
 *  STRING ("72.3", not 72.3). Not declared on SaltPayload in calibrate-core.ts (out of scope
 *  here), so read via a local cast. Majors themselves carry a `list` field too but it was empty
 *  ([]) on all 18 major blocks observed (6 decks x 3 majors) -- card membership lives only at
 *  the sub-archetype level, so majors' own lists are not read. */
interface CsSubArchetypeNode {
  list?: string[];
  total?: string;
}
type CsArchetypesTree = Record<string, { subArchetypes?: Record<string, CsSubArchetypeNode> }>;

/** Sub-archetype name (as CS emits it, e.g. "KINDRED") -> the set of CS slugs in its `list`.
 *  This is CS's synergy-graph deck-theme membership -- a structurally different signal from
 *  csCardCategories' per-card `categories.stats` booleans above (confirmed on the `inalla` deck:
 *  KINDRED sub-archetype lists 46 cards while `kindred` category labels only 3). Returns an
 *  empty map when the payload carries no archetypes.archetypes block. */
export function csSubArchetypeCards(payload: SaltPayload): Map<string, Set<string>> {
  const tree = (payload.details.archetypes as { archetypes?: CsArchetypesTree } | undefined)?.archetypes;
  const out = new Map<string, Set<string>>();
  if (!tree) return out;
  for (const major of Object.values(tree)) {
    for (const [subName, sub] of Object.entries(major.subArchetypes ?? {})) {
      const set = out.get(subName) ?? new Set<string>();
      for (const slug of sub.list ?? []) set.add(slug);
      out.set(subName, set);
    }
  }
  return out;
}

/** CS category -> the matching sub-archetype name, for categories where one exists. CS's
 *  sub-archetype keys are the category name uppercased with no separator (verified against the
 *  union of every sub-archetype name observed across all 6 calibration decks' cached payloads,
 *  2026-08-02: TOKENS, GROUPSLUG, STOMPY, REANIMATOR, COMBAT, PLUSONEPLUSONECOUNTERS,
 *  SPOTREMOVAL, BOARDWIPES, STAX, ARISTOCRATS, MILL, ANTHEM, COUNTERS, SUPERFRIENDS, WHEELS,
 *  COMBO, TAXES, THEFT, PILLOWFORT, TURNS, KINDRED, BLINK, STORM). Only 7 of our categories have
 *  a match in that set: the six from the task brief plus `anthem` (ANTHEM was observed twice).
 *  `recursion`, `landsmatter`, `clone`, `graveyard`, `multipliers` and `burn` have no matching
 *  sub-archetype in the observed data and are simply absent here -- not a bug, CS's synergy
 *  graph groups them under other names (or not at all) in these 6 decks. */
export const CS_CATEGORY_TO_SUBARCHETYPE: Record<string, string> = {
  kindred: "KINDRED",
  tokens: "TOKENS",
  aristocrats: "ARISTOCRATS",
  blink: "BLINK",
  reanimator: "REANIMATOR",
  plusOnePlusOneCounters: "PLUSONEPLUSONECOUNTERS",
  anthem: "ANTHEM",
};

export type Bucket = "A" | "B" | "C";

/** A = all three sources speak it; B = otags and CS only; C = neither we nor otags speak it. */
export function bucketFor(category: string): Bucket {
  if (!(category in CS_CATEGORY_TO_OTAGS)) return "C";
  return category in CS_CATEGORY_TO_ARCHETYPE ? "A" : "B";
}

/** Engine archetypes with NO CS category: lifegain, spellslinger, voltron. Recorded so the
 *  findings document reports the asymmetry rather than quietly omitting three of eight. */
export const ENGINE_ARCHETYPES_WITHOUT_CS: readonly Archetype[] = ["lifegain", "spellslinger", "voltron"];

export interface CategoryScore {
  predicted: number;
  labelled: number;
  hit: number;
  precision: number;
  recall: number;
  /** Share of the universe CS labelled with this category — the null a precision figure must
   *  be read against. Predicting at random scores precision ≈ prevalence. */
  prevalence: number;
}

export function scoreCategory(predicted: Set<string>, labelled: Set<string>, universe: number): CategoryScore {
  let hit = 0;
  for (const k of predicted) if (labelled.has(k)) hit++;
  return {
    predicted: predicted.size,
    labelled: labelled.size,
    hit,
    precision: predicted.size ? hit / predicted.size : 0,
    recall: labelled.size ? hit / labelled.size : 0,
    prevalence: universe ? labelled.size / universe : 0,
  };
}
