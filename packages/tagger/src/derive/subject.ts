/** Free text from a canonical clause into the structured SubjectFilter the engine matches on.
 *
 *  This is the load-bearing part of derivation: if `control` and `type` cannot be recovered, no
 *  edge forms and the compass suite goes red for reasons unrelated to the rest of the layer. */
import type { Control, SubjectFilter } from "../schema.js";

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

function parseTypes(t: string): string | string[] | undefined {
  const found: string[] = [];
  for (const ty of TYPES) {
    // "token" and "card" are not card types on their own; they only qualify another noun.
    if (ty === "token" || ty === "card") continue;
    if (new RegExp(`\\b${ty}s?\\b`).test(t)) found.push(ty);
  }
  if (found.length === 0) return undefined;
  return found.length === 1 ? found[0] : found;
}

export function parseSubject(text: string): SubjectFilter {
  const t = text.toLowerCase().trim();
  const type = parseTypes(t);
  const out: SubjectFilter = { control: parseControl(t), token: parseToken(t) };
  if (type) out.type = type;
  return out;
}
