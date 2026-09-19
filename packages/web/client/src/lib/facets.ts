import type { RateFamily, RateSpan } from "@edh-seer/matcher/rate";
export type { RateFamily } from "@edh-seer/matcher/rate";

/** FIND BY WHAT A CARD CAUSES AND WHAT IT ASKS FOR (spec 2026-09-19, roadmap AJ3).
 *
 *  THE SEARCH IS ASKED IN THE ENGINE'S OWN VOCABULARY, and in no second one. The owner's ruling:
 *  "we should base ourselves on our events not on the does and theme, cause events are does and
 *  theme basically". Measured before it was taken -- lifegain against `gain-life|*` agrees on
 *  1.00, draw on 0.98, tokens on 0.95 -- and where a pair disagrees the ENGINE is wrong and gets
 *  fixed on its own line (mill reads 0.70; roadmap AK1), rather than a second vocabulary living
 *  beside this one under one heading.
 *
 *  WHAT WENT WITH THEM. The `DOES` chips, the strategy select and `applyFacets` are deleted here,
 *  and `facet-index.json` with them. The rate ORDER went too: it was defined only for a single
 *  Does chip carrying a rate family, and no event names one (roadmap AK3). The rate LABELS stay --
 *  `HighSynergyCards` prints them -- and the card pages still ship their rates.
 *
 *  WHAT NO EVENT CAN ASK, and it is the ruling's measured cost (roadmap AK2): mana-generation
 *  (1,702 cards), drain (270), copy-spell (198), clone (169), trigger-doubling (46), extra-turn
 *  (39). Adding mana triggers nothing, so the trigger vocabulary has no word for it. Ramp is
 *  reachable by name and on the report, and is unaskable here until AK2. */
export interface EventQuery {
  /** Events the card can CAUSE. Every one must match. */
  produce: string[];
  /** Events the card ASKS FOR. Every one must match. */
  consume: string[];
  colours: string[];
}

/** REPEATED PARAMS, NEVER A JOINED LIST. 274 of the 1,187 keys contain a comma
 *  (`fills|creature,enchantment|-|-`, measured 2026-09-19), so a split cannot recover what a join
 *  destroyed -- and the longest key is 118 characters, which three of still fits any URL.
 *
 *  `does` AND `theme` ARE NOT READ. An old link carrying them lands on an unfiltered page, which
 *  is a smaller lie than answering a question the vocabulary no longer has. */
export function eventsFromParams(p: URLSearchParams): EventQuery {
  return {
    produce: p.getAll("produce").filter((k) => k.length > 0),
    consume: p.getAll("consume").filter((k) => k.length > 0),
    colours: [...(p.get("colors") ?? "")].filter((c) => "WUBRGC".includes(c)),
  };
}

export function eventsToParams(q: EventQuery, p: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(p);
  for (const k of ["produce", "consume", "colors"]) out.delete(k);
  for (const k of q.produce) out.append("produce", k);
  for (const k of q.consume) out.append("consume", k);
  if (q.colours.length > 0) out.set("colors", q.colours.join(""));
  return out;
}

/** WHAT A COLOUR CHIP MEANS, AND IT IS NOT THE SAME QUESTION ON THE TWO PAGES (owner 2026-09-19).
 *
 *  A card list is read while BUILDING a deck, so `colors=RG` means "playable in a RG deck": the
 *  card's identity sits inside the chosen one, and a colourless card sits inside every one. A
 *  commander list is read to CHOOSE a commander, where a mono-red commander is a different deck
 *  from a RG one -- so it stays EXACT.
 *
 *  THIS REVERSES THE 2026-09-08 RULING, FOR CARDS ONLY. That ruling read "EXACT IDENTITY ON BOTH
 *  PAGES ... a fits-in subset was built first and rejected on sight", and it is written here
 *  rather than deleted so the next reader knows it was decided twice and why it changed.
 *
 *  `C` IS UNCHANGED BY THE REVERSAL: colourless only, on both pages, and exclusive of the five.
 *  Every identity already contains the colourless cards, so "red and colourless" is a redundant
 *  question and not a wider one. */
export function coloursFit(identity: string, colours: string[], mode: "cards" | "commanders"): boolean {
  if (colours.length === 0) return true;
  if (colours.includes("C")) return identity === "";
  if (mode === "commanders") return identity.length === colours.length && colours.every((c) => identity.includes(c));
  return [...identity].every((c) => colours.includes(c));
}

/** THE AND. Every event narrows; the shortest list leads, so the walk is over the smallest input
 *  rather than over the 24,982-member one. No lists at all is not "everything" -- the caller asks
 *  only when it has events, and an empty answer for an empty question would hide that. */
export function intersect(lists: number[][]): Set<number> {
  if (lists.length === 0) return new Set();
  const sorted = [...lists].sort((a, b) => a.length - b.length);
  const rest = sorted.slice(1).map((l) => new Set(l));
  return new Set(sorted[0]!.filter((id) => rest.every((s) => s.has(id))));
}

/** THE RATE, BOTH ENDS PRINTED (owner 2026-09-17: floor and ceiling, never one number): "3 cards
 *  / 1 mana", "0–9 cards / 3 mana", "0+ damage / 4 mana" for an open ceiling, and for a repeatable
 *  activation whose first yield includes the cast, "1 card / 8 mana, then 1 / 4"; Sol Ring reads
 *  "2 mana / 1 mana, then 2 / 0", Llanowar Elves "1 mana / 1 mana, then 1 / 0, from next turn". */
/** The unit each family prints, singular and plural. Mill counts cards; life loss prints as life
 *  and the chip label in front says whose. */
const UNIT: Record<RateFamily, [string, string]> = {
  cards: ["card", "cards"], damage: ["damage", "damage"], mana: ["mana", "mana"], life: ["life", "life"],
  "life-loss": ["life", "life"], mill: ["card", "cards"], tokens: ["token", "tokens"], counters: ["counter", "counters"],
  search: ["card", "cards"], recursion: ["card", "cards"], untap: ["permanent", "permanents"], flicker: ["permanent", "permanents"], copies: ["copy", "copies"],
};
/** The family in a player's words, for "top 5% of draw rates". */
export const RATE_FAMILY_LABEL: Record<RateFamily, string> = {
  cards: "draw", damage: "damage", mana: "mana", life: "lifegain", "life-loss": "life loss", mill: "mill",
  tokens: "token", counters: "counter", search: "tutor", recursion: "recursion", untap: "untap", flicker: "flicker", copies: "copy",
};
export function rateLabel([floor, floorMana, ceiling, ceilingMana, delayed]: RateSpan, family: RateFamily, size?: string): string {
  const span = ceiling === null ? `${floor}+` : ceiling === floor ? `${floor}` : `${floor}–${ceiling}`;
  const [singular, plural] = UNIT[family];
  // THE TOKEN'S SIZE beside the count: "2 1/1 tokens / 2 mana". A 1/1 and a 4/4 are not the same token.
  const unit = `${size ? `${size} ` : ""}${ceiling === 1 && floor === 1 ? singular : plural}`;
  const then = ceiling !== null && ceilingMana !== floorMana ? `, then ${ceiling} / ${ceilingMana}` : "";
  // SUMMONING SICKNESS (CR 302.6) is printed, not priced: a turn has no exchange rate in mana.
  return `${span} ${unit} / ${floorMana} mana${then}${delayed ? ", from next turn" : ""}`;
}
