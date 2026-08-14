/** Free text from a canonical clause into the structured SubjectFilter the engine matches on.
 *
 *  This is the load-bearing part of derivation: if `control` and `type` cannot be recovered, no
 *  edge forms and the compass suite goes red for reasons unrelated to the rest of the layer. */
import type { Control, StatPredicate, SubjectFilter } from "../schema.js";
import { KEYWORD_ABILITIES, SUBTYPES } from "./subtypes.js";

/** Card types the engine reasons about, plus the pseudo-types the matcher expands set-wise. */
const TYPES = [
  "creature", "artifact", "enchantment", "land", "instant", "sorcery", "planeswalker",
  "battle", "permanent", "spell", "token", "card",
] as const;

function parseControl(t: string): Control {
  // Negation first: "you don't control" must not fall through to the "you control" branch below.
  if (/\byou (?:don'?t|do not|don’t) control\b/.test(t)) return "opp";
  if (/\byour opponents?\b|\bopponent'?s?\b|\beach opponent\b|\btarget opponent\b/.test(t)) return "opp";
  if (/\byou control\b|\byour\b|^you$/.test(t)) return "you";
  return "any";
}

function parseToken(t: string): boolean | null {
  if (/\bnontoken\b|\b(?:isn'?t|is not|isn’t) a token\b/.test(t)) return false;
  if (/\btokens?\b/.test(t)) return true;
  return null;
}

/** The eight real card types, and what the two umbrella nouns denote. These MIRROR matcher's
 *  `ALL_CARD_TYPES` and `PSEUDO_TYPE_SETS`; they are restated rather than imported because matcher
 *  depends on tagger and not the other way round. `hierarchy.test.ts` asserts the two agree, so the
 *  copy cannot rot silently. */
export const CARD_TYPES = [
  "creature", "artifact", "enchantment", "instant", "sorcery", "planeswalker", "land", "battle",
] as const;
export const UMBRELLA_TYPES: Record<string, readonly string[]> = {
  permanent: ["creature", "artifact", "enchantment", "planeswalker", "land", "battle"],
  spell: ["creature", "artifact", "enchantment", "planeswalker", "instant", "sorcery", "battle"],
};

/** Card types the text NEGATES ("noncreature spell", "nonland permanent"). Only real card types
 *  count: "nontoken" is a token state that `parseToken` already carries, and "nonbasic"/"nonlegendary"
 *  are supertypes the engine has no filter for. */
function negatedTypes(t: string): { negated: string[]; plural: boolean } {
  const negated: string[] = [];
  let plural = false;
  for (const ty of CARD_TYPES) {
    if (new RegExp(`\\bnon-?${ty}s\\b`).test(t)) { negated.push(ty); plural = true; }
    else if (new RegExp(`\\bnon-?${ty}\\b`).test(t)) negated.push(ty);
  }
  return { negated, plural };
}

/** Two real card types written as a COMPOUND NOUN — "artifact creature", "enchantment creature",
 *  "artifact land". The card must be BOTH.
 *
 *  `type` cannot say this: an array there means OR, because that is what "target artifact or
 *  enchantment" needs. So "other artifact creatures you control" derived `["creature","artifact"]`
 *  and Sol Ring satisfied Master of Etherium's anthem, while Goreclaw — a plain Bear — satisfied
 *  Weaver of Harmony's ENCHANTMENT-creature anthem. Exactly the gap `notType` fills for negation,
 *  seen from the other side.
 *
 *  Only the eight real card types take part. The umbrellas are excluded deliberately: "creature
 *  spell" is a creature, and requiring a card to be both a creature AND a `spell` would fail every
 *  producer, since a creature's expanded type set contains `creature` and not `spell`. */
const COMPOUND_TYPE = new RegExp(
  `\\b(${CARD_TYPES.join("|")})\\s+(${CARD_TYPES.join("|")})s?\\b`,
  "i",
);

function compoundTypes(t: string): string[] | undefined {
  const m = t.match(COMPOUND_TYPE);
  if (!m) return undefined;
  const pair = [m[1].toLowerCase(), m[2].toLowerCase()];
  return pair[0] === pair[1] ? undefined : pair;
}

/** The concrete card types a group of umbrella nouns denotes TOGETHER — their intersection.
 *
 *  "Permanent spell" is a spell that is ALSO a permanent, so the two words narrow one another. They
 *  did not: neither is concrete, so the umbrella-dropping rule below left both in place, and a
 *  `type` array is an OR downstream. `expandTypes(["permanent","spell"])` is therefore the UNION of
 *  the two member sets — every card type there is — and Defiler of Flesh's "whenever you cast a
 *  black permanent spell" was fed by every black instant in its deck.
 *
 *  Resolved to concrete types for exactly the reason the negation path resolves to them: the tokens
 *  are ORed downstream, so the intersection has to be computed here or not at all. Undefined when no
 *  umbrella is present; a SINGLE umbrella is left to the caller, which keeps the word itself. */
function umbrellaIntersection(found: string[]): string[] | undefined {
  const [first, ...rest] = found.filter((f) => UMBRELLA_TYPES[f]);
  if (first === undefined) return undefined;
  // Filtered from the FIRST umbrella's own list rather than from CARD_TYPES, so a single umbrella
  // returns its member set in exactly the order it already had. The types are a set and order means
  // nothing to matching, but it means something to `themeSubjectKey`, which joins them into a tag —
  // reordering would churn theme keys and panel claim identities for no gain.
  return [...UMBRELLA_TYPES[first]!].filter((ty) => rest.every((u) => UMBRELLA_TYPES[u]!.includes(ty)));
}

function parseTypes(
  t: string,
): { type?: string | string[]; notType?: string[]; umbrella?: string; plural: boolean } {
  const found: string[] = [];
  let plural = false;
  for (const ty of TYPES) {
    // "token" and "card" are not card types on their own; they only qualify another noun.
    if (ty === "token" || ty === "card") continue;
    if (new RegExp(`\\b${ty}s\\b`).test(t)) { found.push(ty); plural = true; }
    else if (new RegExp(`\\b${ty}\\b`).test(t)) found.push(ty);
  }

  // A negation is resolved to the concrete types it LEAVES, rather than emitted as a `noncreature`
  // token, because matcher's `expandTypes` UNIONS a subject's type tokens: ["permanent","nonland"]
  // would union to every card type and read wider than either word alone. Subtraction here gives the
  // intersection the text actually states.
  //
  // Without it "noncreature spell" collapsed to the bare umbrella `spell`, which expands to every
  // nonland type INCLUDING creature -- so Mystic Remora and Saruman drew an edge from every creature
  // spell in the deck, the exact opposite of what they say. 197 mentions across 185 corpus cards.
  const { negated, plural: negPlural } = negatedTypes(t);
  if (negated.length > 0) {
    const concrete = found.filter((f) => !UMBRELLA_TYPES[f]);
    // Every umbrella present narrows the base, not just the first one found: "nonland permanent
    // spell" is the permanents that are spells, minus lands.
    const base = concrete.length > 0 ? concrete : [...(umbrellaIntersection(found) ?? CARD_TYPES)];
    const kept = base.filter((ty) => !negated.includes(ty));
    // A negation that removes nothing from the base ("nonartifact creature" is still a creature)
    // leaves the subject exactly as it was: the engine cannot say "and not an artifact", and
    // inventing a narrower filter would be a wrong answer rather than a missing one.
    if (kept.length > 0) {
      // Record the negation only when it actually REMOVED something. "Nonartifact creature" is still
      // exactly a creature, so claiming a `notType` there would advertise a constraint the matcher is
      // not applying -- and the tag would read "a nonartifact ..." about a subject that admits every
      // creature, artifact ones included.
      const narrowed = kept.length !== base.length;
      return {
        type: kept.length === 1 ? kept[0] : kept,
        ...(narrowed ? { notType: negated } : {}),
        plural: plural || negPlural,
      };
    }
  }

  if (found.length === 0) return { plural: /\bopponents\b|\bplayers\b/.test(t) };
  // "spell" and "permanent" are umbrella nouns, not constraints -- matcher's PSEUDO_TYPE_SETS
  // expands "spell" to every non-land type, so "instant or sorcery spell" collecting all three
  // words made every nonland card match. Drop the umbrella word once a concrete type narrows it,
  // the same move already made for "token"/"card" above; keep it only when it's all there is.
  const concrete = found.filter((f) => f !== "spell" && f !== "permanent");
  if (concrete.length === 0 && found.length > 1) {
    // Only umbrellas, and more than one of them: they narrow each other. Intersected here because
    // the tokens are ORed downstream, and the umbrella recorded alongside so the tag keeps its name
    // instead of reading as one arbitrary member of the resolved list.
    const kept = umbrellaIntersection(found);
    if (kept && kept.length > 0) {
      return { type: kept.length === 1 ? kept[0] : kept, umbrella: found.find((f) => UMBRELLA_TYPES[f]), plural };
    }
  }
  // A lone umbrella stands for itself: "target spell" really is every nonland type.
  const kept = concrete.length > 0 ? concrete : found;
  return { type: kept.length === 1 ? kept[0] : kept, plural };
}

/** The singular forms to try for a word as written. The vocabulary is closed, so the first hit is
 *  the answer and no ambiguity survives: "elves" reaches "elf" only via the -ves rule, "zombies"
 *  reaches "zombie" by dropping the s before -ies is ever tried, and "merfolk" is its own plural. */
function singulars(w: string): string[] {
  const out = [w];
  if (w.endsWith("s")) out.push(w.slice(0, -1));
  if (w.endsWith("ies")) out.push(`${w.slice(0, -3)}y`);
  if (w.endsWith("ves")) out.push(`${w.slice(0, -3)}f`, `${w.slice(0, -3)}fe`);
  if (w.endsWith("es")) out.push(w.slice(0, -2));
  return out;
}

/** Subtypes named in the object text. `namesItsTargets` (derive.ts) accepts a static effect only
 *  when it names a type OR a subtype, and this half was dead — a kindred anthem ("Zombies you
 *  control get +1/+1") named neither, so its subject was dropped and it formed no edge with any
 *  Zombie in the deck. Matching is against the closed SUBTYPES list rather than a head-noun guess,
 *  because edges.ts matches this value against another card's real type line: a wrong subtype does
 *  not widen the edge, it deletes it. */
function parseSubtypes(t: string): { subtype?: string | string[]; plural: boolean } {
  const found: string[] = [];
  let plural = false;
  for (const w of t.match(/[a-z'-]+/g) ?? []) {
    for (const s of singulars(w)) {
      if (!SUBTYPES.has(s)) continue;
      if (!found.includes(s)) found.push(s);
      if (s !== w) plural = true;
      break;
    }
  }
  return { subtype: found.length === 1 ? found[0] : found.length ? found : undefined, plural };
}

/** The quantifier the text used. An explicit word wins; otherwise a plural noun is a mass effect
 *  ("creatures you control" is an anthem) and a bare singular says nothing, so it stays unset. */
function parseScope(t: string, pluralType: boolean): SubjectFilter["scope"] {
  if (/\btarget\b/.test(t)) return "target";
  if (/\beach\b|\bevery\b/.test(t)) return "each";
  if (/\ball\b/.test(t)) return "all";
  // "OTHER Merfolk you control", "other artifact creatures you control" -- a class minus this card,
  // which is a mass effect however the noun pluralises. Needed because several creature types are
  // their own plural ("Merfolk"), so the plural test below cannot see them and Svyelun's ward grant
  // was dropped by `namesItsTargets` for want of a scope. Checked AFTER `target`, so "another target
  // creature" stays spot-scoped.
  if (/\bother\b/.test(t)) return "all";
  return pluralType ? "all" : undefined;
}

/** Numeric conditions written in the object text ("creatures you control with power 2 or less").
 *  These are what separates a conditional payoff from an unconditional one — the compass's
 *  power-matters and toughness-matters categories accept a reason ONLY when the subject carries a
 *  StatPredicate, because the linking tag alone is shared with every unconditional producer of the
 *  same event. */
const STAT_RE = /\b(power|toughness|mana value)\s+(\d+)\s+or\s+(less|greater|more|fewer|higher|lower|greater than or equal to)\b/g;
const STAT_METRIC: Record<string, StatPredicate["metric"]> = {
  power: "power", toughness: "toughness", "mana value": "mana-value",
};

/** An ENUMERATED mana cost — Urza's Saga's "artifact card with mana cost {0} or {1}". Not a
 *  comparison, so STAT_RE never saw it, and the card derived as a bare artifact tutor
 *  indistinguishable from Fabricate.
 *
 *  Read as `mana value <= max` ONLY when the run starts at zero, where the two are exactly equal.
 *  "{1} or {2}" is NOT "2 or less" — that would admit a 0-cost card the text excludes — so it is
 *  refused instead of widened. A silent wrong answer is worse than a missing one. */
const ENUMERATED_COST = /\bmana cost\s*(\{(?:\d)\}(?:\s*or\s*\{(?:\d)\})+)/i;

function enumeratedCost(t: string): StatPredicate | undefined {
  const m = t.match(ENUMERATED_COST);
  if (!m) return undefined;
  const values = [...m[1].matchAll(/\{(\d)\}/g)].map((x) => Number(x[1])).sort((a, b) => a - b);
  if (values.length === 0 || values[0] !== 0) return undefined;
  // A gap would also widen: "{0} or {2}" is not "2 or less".
  if (values.some((v, i) => v !== i)) return undefined;
  return { metric: "mana-value", op: "lte", value: values[values.length - 1] };
}

function parseStats(t: string): StatPredicate[] {
  const out: StatPredicate[] = [];
  const enumerated = enumeratedCost(t);
  if (enumerated) out.push(enumerated);
  for (const m of t.matchAll(STAT_RE)) {
    const metric = STAT_METRIC[m[1]];
    const op = /less|fewer|lower/.test(m[3]) ? "lte" : "gte";
    out.push({ metric, op, value: Number(m[2]) });
  }
  return out;
}

/** Colour words to the letters `characteristics.colors` carries (Scryfall's own encoding).
 *  "colorless" is a constraint in its own right — C is not a colour, but a subject that says
 *  "colorless artifacts" excludes every coloured card and must not read as unconstrained. */
const COLORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bwhite\b/, "W"], [/\bblue\b/, "U"], [/\bblack\b/, "B"],
  [/\bred\b/, "R"], [/\bgreen\b/, "G"], [/\bcolorless\b|\bcolourless\b/, "C"],
];

/** Colours named in the object text, in WUBRG order. Unset when the text names none: an absent
 *  filter means "any colour", and claiming all five instead would make every subject a constraint
 *  that nothing outside those colours satisfies. */
function parseColors(t: string): string[] | undefined {
  const found = COLORS.filter(([re]) => re.test(t)).map(([, c]) => c);
  return found.length ? found : undefined;
}

/** "of the chosen type", "of the chosen colour" — a subject referring back to a choice made as the
 *  permanent entered (Chronicle of Victory, Morophon, Herald's Horn, Kindred Discovery,
 *  Dawn-Blessed Pennant).
 *
 *  `chosenType` has been in the schema since the flat tagger: `matcher/src/chosen-type.ts` resolves
 *  it against the deck's dominant subtype and `edges.ts` counts it as a real narrowing filter.
 *  parseSubject never set it, so the derived path dropped the constraint and the subject matched
 *  every spell — Chronicle of Victory "triggered" on Stroke of Midnight, Fellwar Stone and Banner of
 *  Kinship, none of which has a creature type at all. */
const CHOSEN = /\bof the chosen\b|\bthe chosen (?:type|color|colour)\b/i;

/** The ORIGIN zone the text names: "casts a spell from a graveyard" (River Kelpie), "casts a
 *  legendary spell from your hand" (Jodah), "a Dragon creature spell from your graveyard" (Rivaz).
 *
 *  "from anywhere" is deliberately absent. It WIDENS rather than narrows — Bloodchief Ascension and
 *  Syr Konrad want the event however it happened — and an unset `fromZone` already means "any
 *  origin", so recording it would add a token nothing reads.
 *
 *  "from the battlefield" is absent for a sharper reason: "is put into a graveyard from the
 *  battlefield" ALREADY normalizes to the `dies` event on all 20 corpus cards that say it, so the
 *  phrase carries no information the verb has not got — and recording it would demand a matching
 *  origin from every `dies` producer, none of which states one, deleting real edges to buy nothing. */
/** "Historic spell", "another nontoken historic permanent you control". A NEGATED mention
 *  ("each nonland permanent that's NOT historic", Desynchronization) is not the constraint, and the
 *  engine cannot express the inverse — better unset than inverted. */
const HISTORIC = /\bhistoric\b/i;

/** The LEGENDARY supertype, and its negation. Helm of the Host, Quantum Misalignment and Vesuvan
 *  Duplimancy all copy something "except it isn't legendary" — reading that as a legendary
 *  constraint inverts the card, the same trap `nontoken` and `notType` exist for. */
const LEGENDARY = /\blegendary\b/i;
const NOT_LEGENDARY = /\b(?:isn'?t|is not|isn’t|non-?)\s*legendary\b/i;
const NOT_HISTORIC = /\b(?:not|non-?)\s*historic\b/i;

/** The BASIC supertype, and the two ways of not meaning it.
 *
 *  `NOT_BASIC` is the Blood Moon family — "nonbasic lands you control" — where reading it as a basic
 *  constraint inverts the card, exactly as a negated legendary does.
 *
 *  `BASIC_LAND_TYPE` is the subtler one and has nothing to do with the supertype: a "basic land
 *  TYPE" is Forest, Island, Swamp, Mountain or Plains, the SUBTYPE. Prismatic Omen's "lands you
 *  control have every basic land type" would otherwise be read as demanding basic lands, which is
 *  the opposite of what it does. 3 corpus actions against 65 in the supertype sense. */
const BASIC = /\bbasic\b/i;
const NOT_BASIC = /\b(?:isn'?t|is not|isn’t|non-?)\s*basic\b/i;
const BASIC_LAND_TYPE = /\bbasic\s+land\s+types?\b/i;

/** Counter kinds, a CLOSED dictionary — the printed keyword counters plus the two power/toughness
 *  ones. Cards either PRODUCE a counter or CARE about one, exactly as they do with tokens, and the
 *  matcher has read `SubjectFilter.counter` since the flat tagger while the derived path never wrote
 *  it: a +1/+1 producer wildcarded onto a poison or time payoff. Commander Salt models the same
 *  thing as a `counter_type` qualifier.
 *
 *  Matched against the closed list rather than "the word before 'counter'", because that phrasing
 *  also catches "those counters" and "twice that many of each of those kinds of counters" — the
 *  proliferate shape, whose kind is board-state dependent and genuinely unknowable. Unset is the
 *  right answer there: an invented kind is consumed as if it were true. */
const COUNTER_KINDS = [
  "+1/+1", "-1/-1", "-0/-1", "-1/-0", "+1/+0", "+0/+1",
  "charge", "loyalty", "poison", "stun", "time", "oil", "experience", "everything", "void",
  "discovery", "lore", "finality", "shield", "energy", "quest", "rad", "blood", "ki", "verse",
  "fade", "age", "spore", "level", "gold", "muster", "page", "brick", "chorus", "incubation",
  "bounty", "corruption", "credit", "death", "delay", "depletion", "despair", "devotion", "divinity",
  "doom", "echo", "egg", "eon", "fate", "feather", "filibuster", "flood", "fungus", "fuse", "gem",
  "glyph", "growth", "hatchling", "healing", "hit", "hoofprint", "hone", "hour", "hourglass",
  "hunger", "ice", "infection", "intervention", "isolation", "javelin", "journey", "judgment",
  "knowledge", "landmark", "lantern", "leaf", "lightning", "luck", "magnet", "manifestation",
  "mannequin", "mask", "matrix", "memory", "mine", "mining", "mire", "music", "nest", "net", "night",
  "omen", "ore", "pain", "petal", "phylactery", "pin", "plague", "plot", "point", "polyp",
  "pressure", "prey", "pupa", "rally", "ribbon", "ritual", "rope", "rust", "scream", "scroll",
  "shell", "shred", "silver", "sleep", "slime", "slumber", "soot", "soul", "spark", "spite",
  "storage", "strife", "study", "task", "theft", "tide", "training", "trap", "treasure", "valor",
  "velocity", "vitality", "vortex", "vow", "voyage", "wage", "wind", "wish",
  // KEYWORD counters, verbatim from Comprehensive Rules 122.1b — "flying, first strike, double
  // strike, deathtouch, decayed, exalted, haste, hexproof, indestructible, lifelink, menace, reach,
  // shadow, trample, and vigilance". The hand-written version of this list invented a `ward` counter,
  // which does not exist, and omitted decayed, exalted and shadow.
  "flying", "first strike", "double strike", "deathtouch", "decayed", "exalted", "haste",
  "hexproof", "indestructible", "lifelink", "menace", "reach", "shadow", "trample", "vigilance",
  // ...and the counters with rules of their own: 122.1c shield, 122.1d stun, 122.1e loyalty,
  // 122.1f poison, 122.1g defense. The rest of this dictionary is NAMED counters, which the rules
  // do not enumerate because a card may name any counter it likes — those come from the corpus.
  "defense",
] as const;

/** The counter kind a subject names, or undefined. Anchored on the word "counter" so a subject that
 *  merely mentions flying or a Blood token is not read as a counter filter. */
function parseCounter(t: string): string | undefined {
  if (!/\bcounters?\b/.test(t)) return undefined;
  for (const k of COUNTER_KINDS) {
    // The kinds contain regex metacharacters (+, /), so match on plain text against the words that
    // precede "counter".
    const i = t.indexOf(k);
    if (i < 0) continue;
    const after = t.slice(i + k.length);
    if (/^\s+counters?\b/.test(after)) return k;
  }
  return undefined;
}

/** The counter kind an `add-counter` action names in its OBJECT, where the object IS the kind
 *  ("everything" on Omo, "+1/+1" on Prowl) rather than a subject describing a permanent. The model
 *  writes the noun both ways, so a trailing "counter"/"counters" is stripped first. Unknown text
 *  ("those counters", "target creature") yields undefined, leaving the untyped counter-added the
 *  matcher already wildcards on purpose. */
export function counterKindOf(object: string): string | undefined {
  const t = object.trim().toLowerCase().replace(/\s+counters?$/, "").trim();
  return (COUNTER_KINDS as readonly string[]).includes(t) ? t : undefined;
}

/** Keyword abilities a subject narrows by: "creatures you control with flying".
 *
 *  Anchored on a preceding "with", never matched loose, because several keywords are ordinary
 *  English words — fear, shadow, storm, echo, flash — and a bare match would narrow any sentence
 *  containing one. That is the planeswalker-subtype trap `subtypes.ts` documents.
 *
 *  Longest-first so "first strike" wins over "strike" and "basic landcycling" over "landcycling".
 *
 *  Two shapes deliberately refused, both measured on the corpus:
 *  - **"with flashback COST equal to its mana cost"** (Snapcaster Mage, Will of the Jeskai) is the
 *    cost of a GRANT, not a subject demanding flashback. Same idea as `BASIC_LAND_TYPE`.
 *  - **"with a flying counter on it"** — 15 keyword abilities are also KEYWORD COUNTERS (CR 122.1b),
 *    and `parseCounter` already owns that sense. The article usually separates them anyway; the
 *    lookahead covers the article-less phrasing.
 *
 *  "and" joins are consumed into one list because that is what the corpus prints (17 cases, against
 *  0 that say "or"): "a 1/1 Bird with flying and vigilance" has both, so the list is ALL-of. */
const KEYWORD_ALT = [...KEYWORD_ABILITIES]
  .sort((a, b) => b.length - a.length)
  .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const KEYWORD_PHRASE = new RegExp(
  `\\bwith ((?:${KEYWORD_ALT})(?:\\s+and\\s+(?:${KEYWORD_ALT}))*)\\b(?!\\s+(?:cost|counters?))`, "gi");

function parseKeywords(t: string): string[] | undefined {
  const found = new Set<string>();
  for (const m of t.matchAll(KEYWORD_PHRASE)) {
    for (const k of m[1].split(/\s+and\s+/)) found.add(k.trim().toLowerCase());
  }
  // Sorted so the same demand written in either order is the same filter, and so a tag key built
  // from it is stable across cards.
  return found.size ? [...found].sort() : undefined;
}

const ORIGIN_ZONE = /\bfrom (?:a|an|your|their|the)?\s*(graveyard|exile|library|hand)\b/i;

export function parseSubject(text: string): SubjectFilter {
  const t = text.toLowerCase().trim();
  const { type, notType, umbrella, plural } = parseTypes(t);
  const { subtype, plural: subtypePlural } = parseSubtypes(t);
  const scope = parseScope(t, plural || subtypePlural);
  const stats = parseStats(t);
  const colors = parseColors(t);
  const out: SubjectFilter = { control: parseControl(t), token: parseToken(t) };
  if (CHOSEN.test(t)) out.chosenType = true;
  const counter = parseCounter(t);
  if (counter) out.counter = counter;
  if (HISTORIC.test(t) && !NOT_HISTORIC.test(t)) out.historic = true;
  if (LEGENDARY.test(t) && !NOT_LEGENDARY.test(t)) out.legendary = true;
  if (BASIC.test(t) && !NOT_BASIC.test(t) && !BASIC_LAND_TYPE.test(t)) out.basic = true;
  // A keyword counter is a counter, so the counter reading wins where both could fire.
  const keywords = counter ? undefined : parseKeywords(t);
  if (keywords) out.keyword = keywords;
  const origin = t.match(ORIGIN_ZONE);
  if (origin) out.fromZone = origin[1].toLowerCase();
  if (colors) out.colors = colors;
  if (type) out.type = type;
  if (notType?.length) out.notType = notType;
  if (umbrella) out.umbrella = umbrella;
  const all = compoundTypes(t);
  if (all) out.allTypes = all;
  if (subtype) out.subtype = subtype;
  if (scope) out.scope = scope;
  if (stats.length) out.stats = stats;
  return out;
}
