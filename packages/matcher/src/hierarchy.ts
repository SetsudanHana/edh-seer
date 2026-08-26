import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { joinMultiWordSubtypes } from "@mtg/tagger";
import type { Hierarchy } from "./types.js";

const CARD_TYPES = [
  "creature", "artifact", "enchantment", "instant", "sorcery",
  "planeswalker", "land", "battle", "tribal", "kindred",
];

/** Parse "Legendary Creature — Human Wizard" into { wizard:["creature"], human:["creature"] }.
 *  The part after the em dash lists subtypes; the part before lists card types they belong to. */
export function buildHierarchy(typeLines: string[]): Hierarchy {
  const h: Hierarchy = {};
  for (const line of typeLines) {
    const [left, right] = line.split(/\s[—–-]\s/); // em dash, en dash, or hyphen with spaces
    if (!right) continue;
    const types = left.toLowerCase().split(/\s+/).filter((w) => CARD_TYPES.includes(w));
    if (types.length === 0) continue;
    // "Time Lord" is ONE subtype, not two -- see joinMultiWordSubtypes. Without this the scraped
    // map grows `time` and `lord` keys that are subtypes of nothing.
    for (const sub of joinMultiWordSubtypes(right.toLowerCase().split(/\s+/).filter(Boolean))) {
      const set = new Set(h[sub] ?? []);
      for (const t of types) set.add(t);
      h[sub] = [...set];
    }
  }
  return h;
}

/** True iff `subtype` is a recorded member of card type `type` (both matched case-insensitively). */
export function impliesType(h: Hierarchy, subtype: string, type: string): boolean {
  return (h[subtype.toLowerCase()] ?? []).includes(type.toLowerCase());
}

/** The eight concrete card types a subject's `type` can denote. (tribal/kindred are supertypes,
 *  never producer concrete types, so they are intentionally excluded.) */
export const ALL_CARD_TYPES = [
  "creature", "artifact", "enchantment", "instant", "sorcery", "planeswalker", "land", "battle",
] as const;

/** Pseudo-type tokens the tagger emits, each expanded to the concrete card types it denotes.
 *  Positive umbrellas (permanent/spell) list their members; negations (noncreature/nonland) are
 *  every card type except the excluded one. */
export const PSEUDO_TYPE_SETS: Record<string, string[]> = {
  permanent: ["creature", "artifact", "enchantment", "planeswalker", "land", "battle"],
  spell: ["creature", "artifact", "enchantment", "planeswalker", "instant", "sorcery", "battle"],
  noncreature: ALL_CARD_TYPES.filter((t) => t !== "creature"),
  nonland: ALL_CARD_TYPES.filter((t) => t !== "land"),
};

/** Expand a subject's type tokens (concrete or pseudo) plus its subtype-implied card types into
 *  the set of concrete card types it can denote. A concrete type contributes itself, a pseudo-type
 *  its member set, an unknown token nothing.
 *
 *  Subtypes are a FALLBACK, not an addition. `h[subtype]` records every card type that subtype has
 *  ever been printed on, which is a fact about the OTHER cards sharing it: `human` reaches
 *  `enchantment` because Theros printed "Enchantment Creature — Human Warrior", and `construct`
 *  reaches `land`. When the subject already states its types — `characteristicsSubject` reads them
 *  off a printed type line, so they are complete — adding those is not a widening but an error:
 *  it put plain "Creature — Human Warrior" Setessan Champion inside Weaver of Harmony's
 *  enchantment-creature anthem, and "Artifact Creature — Construct" Metalwork Colossus inside a
 *  LAND graveyard fill. Both were false claims on the panel.
 *
 *  The test is the expanded SET rather than the token list, so a subject whose tokens are real but
 *  unrecognisable here ("kindred") still falls back to its subtypes instead of matching nothing. */
export function expandTypes(tokens: string[], subtypes: string[], h: Hierarchy): Set<string> {
  const out = new Set<string>();
  for (const raw of tokens) {
    const t = raw.toLowerCase();
    if ((ALL_CARD_TYPES as readonly string[]).includes(t)) out.add(t);
    else for (const m of PSEUDO_TYPE_SETS[t] ?? []) out.add(m);
  }
  if (out.size > 0) return out;
  for (const raw of subtypes) {
    for (const t of h[raw.toLowerCase()] ?? []) out.add(t);
  }
  return out;
}

/** Load the bundled hierarchy.json produced by `gen-hierarchy`. */
export function loadHierarchy(): Hierarchy {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "hierarchy.json");
  return JSON.parse(readFileSync(path, "utf8")) as Hierarchy;
}

/** What a THEME TAG's subject key can denote, as concrete card types — or `undefined` when the key
 *  names something that is not a type at all.
 *
 *  A SUBTYPE RETURNS UNDEFINED ON PURPOSE, and it is the whole safety of this function. `wizard`
 *  really is a subset of `creature`, and folding it that way is the FAMILY ranking that was built,
 *  swept and refused three times — it generalised nine of twelve decks to "creatures entering" and
 *  cost five decks their tribe. This asks a narrower question: whether two tags describe the same
 *  class of CARD TYPES at different widths. A named card and a placeholder are out for the same
 *  reason. */
export function keyDenotes(key: string, family: string): ReadonlySet<string> | undefined {
  // A LAND IS PLAYED, NOT CAST (CR 305.1), so inside the `cast:` family the universe is the castable
  // types and nothing else. Without this the chain breaks at its middle link: `-creature` expands to
  // ALL_CARD_TYPES minus creature, which CONTAINS land and is therefore not a subset of `spell` —
  // and "noncreature spell", the phrase the tag came from, plainly is one. `themeSubjectKey` ranks a
  // negation above an umbrella, so the "spell" half of that subject is dropped from the key and this
  // is where it comes back.
  const universe = family === "cast"
    ? new Set(PSEUDO_TYPE_SETS.spell)
    : new Set<string>(ALL_CARD_TYPES);
  const narrow = (types: Iterable<string>): Set<string> => {
    const out = new Set<string>();
    for (const t of types) if (universe.has(t)) out.add(t);
    return out;
  };
  if (key === "any") return universe;
  if (key.startsWith("-")) {
    const excluded = key.slice(1);
    if (!(ALL_CARD_TYPES as readonly string[]).includes(excluded)) return undefined;
    return narrow([...universe].filter((t) => t !== excluded));
  }
  if (PSEUDO_TYPE_SETS[key] !== undefined) return narrow(PSEUDO_TYPE_SETS[key]);
  if ((ALL_CARD_TYPES as readonly string[]).includes(key)) {
    const one = narrow([key]);
    // A type outside its own family's universe denotes NOTHING there — `cast:land` would be an empty
    // set, which is a subset of everything and would absorb the whole family. Refused rather than
    // ranked.
    return one.size > 0 ? one : undefined;
  }
  return undefined;
}

/** For each tag, the tags in `tags` it ABSORBS: the ones in its family saying something STRICTLY
 *  NARROWER, so the WIDER claim carries the family's combined strength and names it.
 *
 *  THE DIRECTION WAS MEASURED, NOT CHOSEN. Letting the NARROW tag absorb its wider siblings — the
 *  shape the `:any` rule already had — promotes the narrowest tag in every family, because a rarer
 *  key carries a higher idf and then inherits a commoner one's mass on top. Over the 71 decks it
 *  moved 20 headlines and **thirteen more decks stopped being nameable at all**: `birb-control`
 *  went from "draw" (0.43) to **"instants" (0.05)**, `mono-blue-plainswalker-control` from
 *  "planeswalkers entering" (0.28) to "instants" (0.02). That is the universal-bucket failure with
 *  its sign flipped — an over-SPECIFIC bucket — and it is refused for the same reason.
 *
 *  Strict: a tag never absorbs itself, and two tags denoting the SAME set absorb neither — they are
 *  the same claim spelled twice, and crediting both would double-count it. */
export function subsumptionMap(tags: Iterable<string>): Map<string, string[]> {
  const rows: { tag: string; family: string; denotes: ReadonlySet<string> }[] = [];
  for (const tag of tags) {
    const i = tag.indexOf(":");
    if (i === -1) continue;
    const family = tag.slice(0, i);
    const denotes = keyDenotes(tag.slice(i + 1), family);
    if (denotes !== undefined) rows.push({ tag, family, denotes });
  }
  const out = new Map<string, string[]>();
  for (const a of rows) {
    const narrower = rows.filter((b) =>
      b.tag !== a.tag && b.family === a.family
      && b.denotes.size < a.denotes.size
      && [...b.denotes].every((t) => a.denotes.has(t)));
    out.set(a.tag, narrower.map((b) => b.tag));
  }
  return out;
}
