/** Free text from a canonical clause into the structured SubjectFilter the engine matches on.
 *
 *  This is the load-bearing part of derivation: if `control` and `type` cannot be recovered, no
 *  edge forms and the compass suite goes red for reasons unrelated to the rest of the layer. */
import type { Control, StatPredicate, SubjectFilter } from "../schema.js";

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
  return { type: found.length === 1 ? found[0] : found, plural };
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

export function parseSubject(text: string): SubjectFilter {
  const t = text.toLowerCase().trim();
  const { type, plural } = parseTypes(t);
  const scope = parseScope(t, plural);
  const stats = parseStats(t);
  const out: SubjectFilter = { control: parseControl(t), token: parseToken(t) };
  if (type) out.type = type;
  if (scope) out.scope = scope;
  if (stats.length) out.stats = stats;
  return out;
}
