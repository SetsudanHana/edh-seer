/** Free text from a canonical clause into the structured SubjectFilter the engine matches on.
 *
 *  This is the load-bearing part of derivation: if `control` and `type` cannot be recovered, no
 *  edge forms and the compass suite goes red for reasons unrelated to the rest of the layer. */
import type { Control, StatPredicate, SubjectFilter } from "../schema.js";
import { SUBTYPES } from "./subtypes.js";

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

function parseTypes(t: string): { type?: string | string[]; plural: boolean } {
  const found: string[] = [];
  let plural = false;
  for (const ty of TYPES) {
    // "token" and "card" are not card types on their own; they only qualify another noun.
    if (ty === "token" || ty === "card") continue;
    if (new RegExp(`\\b${ty}s\\b`).test(t)) { found.push(ty); plural = true; }
    else if (new RegExp(`\\b${ty}\\b`).test(t)) found.push(ty);
  }
  if (found.length === 0) return { plural: /\bopponents\b|\bplayers\b/.test(t) };
  // "spell" and "permanent" are umbrella nouns, not constraints -- matcher's PSEUDO_TYPE_SETS
  // expands "spell" to every non-land type, so "instant or sorcery spell" collecting all three
  // words made every nonland card match. Drop the umbrella word once a concrete type narrows it,
  // the same move already made for "token"/"card" above; keep it only when it's all there is.
  const concrete = found.filter((f) => f !== "spell" && f !== "permanent");
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

function parseStats(t: string): StatPredicate[] {
  const out: StatPredicate[] = [];
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

export function parseSubject(text: string): SubjectFilter {
  const t = text.toLowerCase().trim();
  const { type, plural } = parseTypes(t);
  const { subtype, plural: subtypePlural } = parseSubtypes(t);
  const scope = parseScope(t, plural || subtypePlural);
  const stats = parseStats(t);
  const colors = parseColors(t);
  const out: SubjectFilter = { control: parseControl(t), token: parseToken(t) };
  if (colors) out.colors = colors;
  if (type) out.type = type;
  if (subtype) out.subtype = subtype;
  if (scope) out.scope = scope;
  if (stats.length) out.stats = stats;
  return out;
}
