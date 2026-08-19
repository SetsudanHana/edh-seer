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
