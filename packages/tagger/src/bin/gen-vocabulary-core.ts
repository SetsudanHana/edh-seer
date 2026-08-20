/** Turns MTGJSON's type/keyword catalogues into the closed vocabularies this engine parses against.
 *
 *  FREE: no API key, no model, no spend — two static JSON files from mtgjson.com.
 *
 *  Why generate rather than hand-maintain: `hierarchy.json` sat at 16 of 527 subtypes for the whole
 *  life of this project with every test green and the compass at 55/55, and nothing noticed. A
 *  vocabulary is exactly the kind of artifact that rots silently, because a MISSING member does not
 *  throw — it just quietly fails to match, and a subject that fails to match deletes an edge rather
 *  than announcing itself.
 *
 *  Pure, so the shaping can be tested without the network.
 */

import crKeywords from "../derive/cr-keywords.json" with { type: "json" };

/** CR 702 headings, normalized to the keyword as a card PRINTS it.
 *
 *  MTGJSON LAGS THE RULES, and until 2026-08-20 that lag was tracked by hand in
 *  `cr-completeness.test.ts` as a shrink-only list — five entries deep and growing every set, each
 *  one a keyword `SubjectFilter.keyword` could not see. The rules text is itself a generated,
 *  committed artifact here (`cr-keywords.json`), so the honest fix is to UNION the two sources and
 *  make the lag structurally impossible rather than re-typing whatever MTGJSON is behind on.
 *
 *  Three heading shapes need normalizing, and all three are in the rules today:
 *  - "Daybound and Nightbound" is ONE heading for TWO keywords.
 *  - "∞ (Infinity)" glosses a symbol; the card prints the symbol, so the parenthetical goes.
 *  - Everything else is the keyword verbatim, including the exclamation in "Start Your Engines!". */
function crKeywordAbilities(): string[] {
  return crKeywords.abilities.flatMap((heading) =>
    heading
      .replace(/\s*\([^)]*\)\s*$/, "")
      .split(/\s+and\s+/)
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 0));
}

/** The shape of mtgjson.com/api/v5/CardTypes.json. */
export interface CardTypesPayload {
  data: Record<string, { subTypes: string[]; superTypes: string[] }>;
}

/** The shape of the parts of mtgjson.com/api/v5/EnumValues.json we read. */
export interface EnumValuesPayload {
  data: {
    card: { subtypes: string[]; supertypes: string[]; types: string[] };
    keywords: { abilityWords: string[]; keywordAbilities: string[]; keywordActions: string[] };
  };
}

export interface Vocabulary {
  /** Subtypes of the PERMANENT types, which is what `parseSubject` may safely match in free text. */
  permanentSubtypes: string[];
  /** Planeswalker subtypes, kept SEPARATE rather than dropped.
   *
   *  They are real typal identities — Chandra tribal is a deck someone owns — but several are
   *  ordinary English words ("will", "comet") that would match inside any sentence mentioning them.
   *  Merging them into the free-text set trades a real edge for a silent false one, so they are
   *  emitted for a caller that knows it is looking at a planeswalker and can afford the collision. */
  planeswalkerSubtypes: string[];
  /** CREATURE subtypes alone. A subset of `permanentSubtypes`, emitted separately because
   *  CHANGELING is a characteristic-defining ability: a card with it has every creature type in
   *  every zone, and "every creature type" needs the creature list specifically — the permanent set
   *  would hand a changeling Equipment and Aura, which it is not. */
  creatureSubtypes: string[];
  /** Instant/sorcery subtypes: arcane, lesson, trap, adventure, ... */
  spellSubtypes: string[];
  /** Plane/phenomenon subtypes. Planechase only; emitted for completeness. */
  planeSubtypes: string[];
  /** LAND subtypes alone. A subset of `permanentSubtypes`, emitted separately because a land
   *  subtype is the one kind that means "mana base" rather than "typal" — a fetchland naming Swamp
   *  is ramp, not a Swamp-tribal payoff. */
  landSubtypes: string[];
  /** THE AUTHORITATIVE SUBTYPE -> CARD TYPE MAP (CR 205.3). Every subtype, lowercased, against the
   *  card type(s) whose list CR puts it on. This is an ASSIGNMENT and not a co-occurrence count:
   *  `matcher/hierarchy.json` is built by scraping printed type lines, so it records every card
   *  type a subtype has ever been PRINTED BESIDE -- `forest` reaches `creature` through Dryad Arbor
   *  ("Land Creature -- Forest Dryad") and `treasure` reaches it through artifact creatures -- which
   *  is the right question for "what can this subject denote" and the WRONG one for "what type is
   *  this subtype".
   *
   *  Nearly every subtype has exactly one type: measured against CardTypes.json, the ONLY subtypes
   *  claimed by more than one card type are the six that are both instant and sorcery (adventure,
   *  arcane, chorus, lesson, omen, trap), which is CR's spell-type list by design. In particular
   *  LAND and CREATURE subtypes are DISJOINT -- 0 of 18 x 350. */
  subtypeTypes: Record<string, string[]>;
  /** The closed six: Basic, Host, Legendary, Ongoing, Snow, World. */
  supertypes: string[];
  keywordActions: string[];
  keywordAbilities: string[];
  abilityWords: string[];
}

const lower = (xs: readonly string[]): string[] => [...new Set(xs.map((s) => s.toLowerCase()))].sort();

/** Which card types contribute subtypes that `parseSubject` is allowed to match in free text.
 *  Permanents only: a subject filters permanents, and matching a spell subtype would let "arcane"
 *  in a sentence narrow a subject that is about creatures. */
const PERMANENT_TYPES = ["artifact", "battle", "creature", "enchantment", "land"] as const;

/** Invert CardTypes' per-type subtype lists into subtype -> the card types that claim it. */
function subtypeTypes(types: CardTypesPayload): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of SUBTYPE_BEARING_TYPES) {
    for (const s of types.data[t]?.subTypes ?? []) {
      const k = s.toLowerCase();
      (out[k] ??= []).push(t);
    }
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

/** Card types whose subtype lists we record. Excludes the formats nobody puts in a decklist
 *  (plane, phenomenon, scheme, vanguard, conspiracy) and `tribal`, which has no list of its own --
 *  a Kindred card carries CREATURE subtypes. */
const SUBTYPE_BEARING_TYPES = [
  "creature", "land", "artifact", "enchantment", "battle", "planeswalker", "instant", "sorcery",
] as const;

export function buildVocabulary(types: CardTypesPayload, enums: EnumValuesPayload): Vocabulary {
  const sub = (k: string): string[] => types.data[k]?.subTypes ?? [];
  return {
    permanentSubtypes: lower(PERMANENT_TYPES.flatMap(sub)),
    creatureSubtypes: lower(sub("creature")),
    planeswalkerSubtypes: lower(sub("planeswalker")),
    spellSubtypes: lower([...sub("instant"), ...sub("sorcery")]),
    planeSubtypes: lower([...sub("plane"), ...sub("phenomenon")]),
    landSubtypes: lower(sub("land")),
    subtypeTypes: subtypeTypes(types),
    supertypes: lower(enums.data.card.supertypes),
    keywordActions: lower(enums.data.keywords.keywordActions),
    keywordAbilities: lower([...enums.data.keywords.keywordAbilities, ...crKeywordAbilities()]),
    abilityWords: lower(enums.data.keywords.abilityWords),
  };
}

/** The generated `subtypes.ts`. Codegen rather than a JSON import so the runtime module shape does
 *  not change and the diff stays reviewable: a vocabulary change should be readable in a pull
 *  request, not hidden inside a minified artifact. */
export function renderSubtypesModule(v: Vocabulary): string {
  const lines: string[] = [];
  for (let i = 0; i < v.permanentSubtypes.length; i += 8) {
    lines.push(`  ${v.permanentSubtypes.slice(i, i + 8).map((s) => JSON.stringify(s)).join(", ")},`);
  }
  return `/** Every artifact, battle, creature, enchantment and land subtype, lowercased.
 *
 *  GENERATED by \`gen-vocabulary.ts\` from MTGJSON's CardTypes catalogue. Do not edit by hand —
 *  re-run the generator, which is free.
 *
 *  A CLOSED list rather than a head-noun heuristic: \`parseSubject\` reads free text, and any word it
 *  guesses to be a subtype becomes a filter \`edges.ts\` matches against another card's type line —
 *  so a wrong guess silently DELETES an edge rather than widening one.
 *
 *  Planeswalker, plane and spell subtypes are deliberately absent from THIS set, and are emitted to
 *  \`vocabulary.json\` instead. They are real typal identities, but several planeswalker types are
 *  ordinary English words ("will", "comet") and matching them in free text would trade a real edge
 *  for a silent false one. A caller that knows it is looking at a planeswalker can read them there.
 */
export const SUBTYPES: ReadonlySet<string> = new Set([
${lines.join("\n")}
]);

/** The LAND subtypes among them. A land subtype means MANA BASE, not typal: a fetchland naming Swamp
 *  is ramp, and a tutor that finds one is a land-fixing card rather than a Swamp-tribal payoff. */
export const LAND_SUBTYPES: ReadonlySet<string> = new Set([
${v.landSubtypes.map((s) => JSON.stringify(s)).join(", ")},
]);

/** Every CREATURE subtype, for CHANGELING — a characteristic-defining ability, so a card with it has
 *  every creature type in EVERY ZONE, not only on the battlefield. The permanent set is the wrong
 *  list here: it would hand a changeling Equipment and Aura, which it is not. */
export const CREATURE_SUBTYPES: readonly string[] = [
${v.creatureSubtypes.map((s) => JSON.stringify(s)).join(", ")},
];

/** THE AUTHORITATIVE SUBTYPE -> CARD TYPE MAP (CR 205.3), subtype lowercased.
 *
 *  Ask this when the question is "what card type IS this subtype". Do NOT ask
 *  \`matcher/hierarchy.json\`: that is built by scraping printed type lines, so it answers "what
 *  card types has this subtype been printed beside", and the two differ on 19 of 453 subtypes --
 *  \`treasure\`, \`clue\`, \`food\`, \`equipment\` and \`book\` read as CREATURE types there, as do
 *  \`forest\`, \`island\`, \`locus\` and \`mountain\`, \`saga\`, \`background\` and \`shrine\`, while
 *  \`vehicle\` reads as a LAND type.
 *
 *  A list rather than a single type because six subtypes really are two: adventure, arcane, chorus,
 *  lesson, omen and trap are both instant and sorcery. Every other subtype has exactly one, and
 *  LAND and CREATURE subtypes are disjoint. */
export const SUBTYPE_TYPES: Readonly<Record<string, readonly string[]>> = {
${Object.entries(v.subtypeTypes).map(([k, ts]) => `  ${JSON.stringify(k)}: [${ts.map((t) => JSON.stringify(t)).join(", ")}],`).join("\n")}
};

/** Every KEYWORD ABILITY, for subjects narrowed by one — "creatures you control with flying".
 *
 *  A keyword is not a type, so none of the lists above can carry it, and without a slot for it
 *  "creatures you control with flying" derives as EVERY creature: Favorable Winds pumped the whole
 *  board and Stalwart Shield-Bearers anthemed creatures that have no defender. Same over-wide
 *  subject the \`legendary\` and \`basic\` supertypes had before they got filters.
 *
 *  Longest-first at the point of use, so "first strike" is never read as the "strike" of another
 *  keyword, and always anchored on a preceding "with" — several of these are ordinary English
 *  words ("fear", "shadow", "storm", "echo", "flash") and matching them loose in a sentence is the
 *  planeswalker-subtype trap the SUBTYPES comment above describes. */
export const KEYWORD_ABILITIES: readonly string[] = [
${v.keywordAbilities.map((s) => JSON.stringify(s)).join(", ")},
];

/** MULTI-WORD SUBTYPES, derived from \`SUBTYPE_TYPES\` rather than hand-listed so the generator stays
 *  the single source. Exactly ONE exists in all of Magic today: "Time Lord". */
const MULTI_WORD_SUBTYPES: readonly string[] = Object.keys(SUBTYPE_TYPES).filter((s) => s.includes(" "));
const MAX_SUBTYPE_WORDS = Math.max(1, ...MULTI_WORD_SUBTYPES.map((s) => s.split(" ").length));

/** Re-join the words of a type line's subtype part into real subtypes, longest match first.
 *
 *  Every type-line splitter in this repo split the subtype part on whitespace, so "Legendary
 *  Creature — Time Lord Doctor" produced \`["time", "lord", "doctor"]\` — two subtypes that do not
 *  exist and one that does. Measured: 23 derived rows carried the split \`time\`/\`lord\`, and it
 *  reached the product, where \`it-is-time\` themed \`enters:time\`, a subtype of nothing. (The 36 rows
 *  that already carry the joined "time lord" are CHANGELINGS, which take the whole
 *  \`CREATURE_SUBTYPES\` list and never go through a splitter.)
 *
 *  Longest-match-first over the real vocabulary, so a hypothetical three-word subtype works without
 *  a code change and an ordinary "Human Wizard" is untouched.
 *
 *  RENDERED BY THE GENERATOR, not hand-written into the generated file. It lived in \`subtypes.ts\`
 *  as hand-edited code from 2026-08-19 until 2026-08-20, when the first re-run of
 *  \`gen-vocabulary.ts\` since then DELETED it — three importers and 20 tests went red at once. A
 *  generated file cannot hold hand edits; anything that belongs beside the data belongs in the
 *  renderer. */
export function joinMultiWordSubtypes(words: readonly string[]): string[] {
  if (MULTI_WORD_SUBTYPES.length === 0) return [...words];
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    let take = 1;
    for (let n = Math.min(MAX_SUBTYPE_WORDS, words.length - i); n > 1; n--) {
      if (MULTI_WORD_SUBTYPES.includes(words.slice(i, i + n).join(" "))) { take = n; break; }
    }
    out.push(words.slice(i, i + take).join(" "));
    i += take;
  }
  return out;
}
`;
}
