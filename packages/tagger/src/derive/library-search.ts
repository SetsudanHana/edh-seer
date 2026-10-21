import type { Action } from "../canonicalize.js";

/** WHOSE LIBRARY A PRINTED SEARCH READS (#1266): `Ability.librarySearch`. Pure; `derive.ts` calls it for a `search` action only (a typed dig is a `put`).
 *  Returns undefined when no library is searched (a graveyard or hand only).
 *  The owner phrase in the object outranks the searcher: "your library" is yours, a possessive naming someone else is other. An unnamed owner ("a card",
 *  fromZone library: Rhystic Tutor) is the searcher's: the word before "search" in the clause, "you" or nobody = you, anyone else = other.
 *  Every scan is a split or an anchored test over short strings; no pattern here has an unbounded quantifier next to another. */
const OWN = /^(?:your|my)\b/i;
const OTHER_OWNER = /^(?:that player's|those players'|target (?:opponent|player)'s|each (?:player|opponent)'s|an opponent's|its controller's|its owner's|defending player's|their|his or her)\b/i;
const ADVERBS = new Set(["may", "also", "then", "instead"]);
const YOU = new Set(["you"]);

const SEARCH_WORD = /\bsearch(?:es)?\b/gi;
/** Where the nth search verb of the clause starts (the last one when the clause has fewer); -1 with none.
 *  CEILING: the nth search ACTION is paired with the nth printed "search"/"searches" word. Prose that says the word without an action ("for each opponent who
 *  searches a library") adds a word with no action, and the clamp to the last word when there are fewer words than actions can misalign the pairing.
 *  Witness: Tempt with Discovery (4 printed matches, 3 actions); it reads right only because its object says "your library". */
function searchAt(clauseText: string, nth: number): number {
  const all = [...clauseText.matchAll(SEARCH_WORD)];
  return all.length === 0 ? -1 : all[Math.min(nth, all.length - 1)]!.index;
}

/** Whether the printed clause says "search" at all. A stored model answer writes a dig ("look at the top six cards ... put one onto the battlefield": Winota, Tunnel Vision) as a `search` action too. */
export function printsSearch(clauseText: string): boolean {
  return searchAt(clauseText, 0) >= 0;
}

function searcherIsYou(clauseText: string, nth: number): boolean {
  const at = searchAt(clauseText, nth);
  if (at < 0) return true;
  // The sentence the search is in, up to the verb; its last non-adverb word is the actor.
  const head = clauseText.slice(0, at);
  // A comma before the verb ends a lead-in ("Whenever ... deals combat damage to a player, search your library"): imperative, yours.
  if (head.trimEnd().endsWith(",")) return true;
  const sentence = head.slice(Math.max(head.lastIndexOf(". "), head.lastIndexOf(": "), head.lastIndexOf("; "), -1) + 1);
  const words = sentence.toLowerCase().split(/[\s,]+/).filter((w) => w !== "");
  while (words.length > 0 && ADVERBS.has(words[words.length - 1]!)) words.pop();
  const last = words[words.length - 1];
  // Nobody stated (imperative), or "you"; a lead-in word ("do", "then", "if") is not an actor.
  return last === undefined || YOU.has(last) || !/^(?:them|friend|friends|opponent|opponents|player|players|controller|owner|owners|everyone)$/.test(last);
}

/** The owner phrase the PRINTED text puts right after the verb: derive's stored action often has it stripped ("a card", fromZone library) when the grammar read the sentence.
 *  `nth` is the action's place among the clause's search actions, matched to the nth printed search verb (Demolition Field searches their library, then yours).
 *  The probe is the 24 characters after the verb, matched against anchored alternations. */
function ownerAfterVerb(clauseText: string, nth: number): "yours" | "other" | undefined {
  const at = searchAt(clauseText, nth);
  if (at < 0) return undefined;
  const probe = clauseText.slice(at).replace(/^\w+\s+/, "").slice(0, 24);
  if (OWN.test(probe)) return "yours";
  return OTHER_OWNER.test(probe) ? "other" : undefined;
}

/** The words the printed verb puts before its "for": "search your graveyard, hand, and/or library for an Aura card". Derive rewrites such an action to fromZone graveyard with the zones stripped from the object. */
function printedZones(clauseText: string, nth: number): string {
  const at = searchAt(clauseText, nth);
  if (at < 0) return "";
  const zones = clauseText.slice(at, at + 100);
  const cut = zones.indexOf(" for ");
  return cut < 0 ? zones : zones.slice(0, cut);
}
const LIBRARY_WORD = /\blibrar(?:y|ies)\b/i;
/** "Search the other pile for a card" (Phyrexian Portal): a pile cut from the top of the library is a dig, not a search of the library. */
const PILE_WORD = /\bpiles?\b/i;
/** "the graveyard, hand, and library OF that spell's controller" (Invasive Surgery): the owner comes after the zone list. Anchored on the first word after the last " of ". */
const OF_OTHER = /^(?:that|those|target|each|an opponent|its|defending|their|his or her)\b/i;
function ownerOfZones(zones: string): "yours" | "other" | undefined {
  const at = zones.lastIndexOf(" of ");
  if (at < 0) return undefined;
  const owner = zones.slice(at + 4);
  if (/^you\b/i.test(owner)) return "yours";
  return OF_OTHER.test(owner) ? "other" : undefined;
}

export function librarySearchOwner(action: Action, clauseText: string, nth = 0): "yours" | "other" | undefined {
  const object = (action.object ?? "").trim();
  const zones = printedZones(clauseText, nth);
  if (PILE_WORD.test(zones) && !LIBRARY_WORD.test(zones) && !LIBRARY_WORD.test(object)) return undefined;
  const libraryNamed = action.fromZone === "library" || LIBRARY_WORD.test(object) || LIBRARY_WORD.test(zones);
  if (!libraryNamed) return undefined;
  const named = OWN.test(object) ? "yours" : OTHER_OWNER.test(object) ? "other" : ownerAfterVerb(clauseText, nth) ?? ownerOfZones(zones);
  if (named === "other") return "other";
  if (named === "yours") return searcherIsYou(clauseText, nth) ? "yours" : "other";
  return searcherIsYou(clauseText, nth) ? "yours" : "other";
}
