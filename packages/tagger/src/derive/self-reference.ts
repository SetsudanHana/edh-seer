/** The card talking about itself — self-reference is this project's largest historical false-edge
 *  family (74% of all false edges: "this creature", "this spell", the card's own name, all read as a
 *  CLASS rather than the one card). One word list, exported from one place, so `derive.ts` (which
 *  tests whether a whole, STRUCTURED subject field IS the self-reference) and `threshold.ts` (which
 *  scans a free-text noun phrase for an EMBEDDED one) can't drift into two competing definitions. */
import { SUBTYPES } from "./subtypes.js";

/** The card talking about itself. Anchored at the start, because a self-reference anywhere else is
 *  part of a larger subject ("creatures other than this one"), and confined to the noun so the rest
 *  of the sentence cannot leak in. */
export const SELF_REFERENCE =
  /^this (?:spell|card|creature|artifact|enchantment|permanent|land|planeswalker|equipment|vehicle|token)\b/i;

/** The same word list, UNANCHORED — for scanning a free-text phrase for a self-reference embedded
 *  anywhere in it, rather than testing whether the whole phrase IS one. A threshold's noun phrase is
 *  scraped from prose by `threshold.ts` and can carry the self-reference mid-sentence: Colfenor's
 *  Urn's "cards have been exiled with this artifact" does not begin with "this", but it names the
 *  Urn partway through, and reading it as {type: "artifact"} counts the Urn itself as the class it
 *  counts.
 *
 *  Deliberately NOT built from `isSelfSubject`'s bare `/^this\b/` branch, which that function's own
 *  comment documents as unsafe outside a structured subject field: "this turn ...", "this combat" and
 *  "this game" are conditions, not self-references, and a scan across free prose hits them constantly
 *  (134 corpus threshold nouns contain the word "this", and the great majority are one of those three
 *  — measured 2026-08-15 while fixing this file). The type-word list above never matches "this turn"
 *  because "turn" is not a permanent type, which is exactly why it is the safe list to scan with. */
const SELF_REFERENCE_ANYWHERE = new RegExp(SELF_REFERENCE.source.slice(1), "i"); // drop the leading ^
export function mentionsSelf(text: string): boolean {
  return SELF_REFERENCE_ANYWHERE.test(text);
}

/** Does this TRIGGER subject name the card itself? "When THIS creature enters" watches one
 *  permanent -- its own -- while "whenever another creature you control enters" watches the deck,
 *  and `parseSubject` reduces both to {type: creature}. The clause text is the only place the
 *  difference survives, so it is recovered here.
 *
 *  A subject mentioning "another" or "other" is NOT self even when it opens with a self-reference:
 *  Zulaport Cutthroat's "this creature or another creature you control" is a real aristocrats
 *  payoff, and marking it self would delete the edge this engine most wants to find. */
export function isSelfSubject(text: string, cardName?: string): boolean {
  const t = text.trim().toLowerCase();
  if (t === "") return false;
  if (/\banother\b|\bother\b/.test(t)) return false;
  // Bare "this" with no noun after it — how Bojuka Bog and Zhalfirin Void record their own entry.
  // Checked HERE rather than by widening SELF_REFERENCE, which effect subjects also use: a trigger
  // subject of "this" is unambiguous, while an effect object beginning "this turn ..." is not.
  if (/^this\b/.test(t)) return true;
  if (SELF_REFERENCE.test(t)) return true;
  if (!cardName) return false;
  const name = cardName.toLowerCase();
  // The model names the card either in full ("Urza, Lord High Artificer") or by the short name a
  // card's own text uses ("Urza"), which is everything before the first comma or face divider.
  if (t === name || t === name.split(/[,/]/)[0].trim()) return true;
  // A card with no comma in its name still shortens itself: Imskir Iron-Eater's own text says
  // "Imskir". Accept the FIRST WORD — but never when that word is a creature type, because
  // "whenever a Goblin enters" on a card named Goblin Bombardment is a real typal payoff and
  // marking it self would delete the edges a Goblin deck is made of.
  const first = name.split(/\s+/)[0];
  return t === first && !SUBTYPES.has(first);
}
