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
  /** WHAT THE CARD IS, added 2026-09-21. The owner asked for two things this could not answer:
   *  Slivers, and "show me mill instants which are blue and cost less than 3 mana".
   *
   *  NOT A SECOND VOCABULARY, and the distinction is the 09-19 ruling's own. That ruling deleted
   *  the `DOES` chips and the strategy select because they said what a card DOES in words the
   *  events already said better. A printed type line does not compete with an event -- it is the
   *  same kind of fact as `colours` above, which has sat beside the event facets since the day
   *  they shipped. The deck-build agent's first run is the measured case: Inalla's whole deck is a
   *  creature type, and with no way to ask for one it abused "provides a Wizard to sacrifice" as a
   *  proxy and took the false positives that brings. */
  types: string[];
  subtypes: string[];
  /** Mana value ceiling, inclusive. `undefined` asks nothing. A CEILING and not a range: "cost
   *  less than 3" is the question people ask; nobody has asked for a floor. */
  maxMv?: number;
  /** How the kept rows are ordered. `partners` is the artifact's own order (best connected first)
   *  and stays the default -- the sort exists so a reader can ESCAPE that ranking, not because it
   *  is wrong. The deck-build run's complaint: rare events outranked good cards, so it found
   *  staples "only by already knowing their names and typing them in". */
  sort?: "partners" | "mv" | "name";
}

/** REPEATED PARAMS, NEVER A JOINED LIST. 274 of the 1,187 keys contain a comma
 *  (`fills|creature,enchantment|-|-`, measured 2026-09-19), so a split cannot recover what a join
 *  destroyed -- and the longest key is 118 characters, which three of still fits any URL.
 *
 *  `does` AND `theme` ARE NOT READ. An old link carrying them lands on an unfiltered page, which
 *  is a smaller lie than answering a question the vocabulary no longer has. */
const SORTS = new Set(["partners", "mv", "name"]);

export function eventsFromParams(p: URLSearchParams): EventQuery {
  const mv = Number(p.get("mv"));
  const sort = p.get("sort") ?? "";
  return {
    produce: p.getAll("produce").filter((k) => k.length > 0),
    consume: p.getAll("consume").filter((k) => k.length > 0),
    colours: [...(p.get("colors") ?? "")].filter((c) => "WUBRGC".includes(c)),
    types: p.getAll("type").filter((k) => k.length > 0),
    subtypes: p.getAll("subtype").filter((k) => k.length > 0),
    // A BAD `mv` IS NO FILTER, NOT ZERO. `?mv=abc` reading as "at most 0 mana" would answer a
    // question nobody asked with a confident empty list.
    ...(Number.isFinite(mv) && mv > 0 ? { maxMv: Math.floor(mv) } : {}),
    ...(SORTS.has(sort) ? { sort: sort as EventQuery["sort"] } : {}),
  };
}

export function eventsToParams(q: EventQuery, p: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(p);
  for (const k of ["produce", "consume", "colors", "type", "subtype", "mv", "sort"]) out.delete(k);
  for (const k of q.produce) out.append("produce", k);
  for (const k of q.consume) out.append("consume", k);
  if (q.colours.length > 0) out.set("colors", q.colours.join(""));
  for (const k of q.types) out.append("type", k);
  for (const k of q.subtypes) out.append("subtype", k);
  if (q.maxMv !== undefined) out.set("mv", String(q.maxMv));
  // THE DEFAULT IS NOT WRITTEN DOWN. `?sort=partners` in every shared link is noise, and it would
  // pin the order against a future change of default.
  if (q.sort && q.sort !== "partners") out.set("sort", q.sort);
  return out;
}

/** Does this card pass the characteristic half of the query? The event half is answered from the
 *  membership index; this is answered from the row itself, which is why it lives here. */
export function compileCharacteristics(
  q: Pick<EventQuery, "types" | "subtypes" | "maxMv">,
  vocab: { types: string[]; subtypes: string[] },
): (card: { t?: number[]; s?: number[]; mv?: number }) => boolean {
  // THE NAMES BECOME CODES ONCE, NOT ONCE PER CARD. Resolving them inside the predicate meant a
  // 488-entry `indexOf` scan per card per chosen subtype, over 25,582 rows, re-run on every
  // keystroke of the name field -- about twelve million string comparisons to answer one letter.
  //
  // A NAME THE VOCABULARY DOES NOT KNOW YIELDS -1 AND MATCHES NOTHING, deliberately: the tables
  // load asynchronously, and a filter that silently stopped applying while they were in flight
  // would show cards that do not answer the question.
  const types = q.types.map((n) => vocab.types.indexOf(n));
  const subtypes = q.subtypes.map((n) => vocab.subtypes.indexOf(n));
  const { maxMv } = q;
  return (card) => {
    // EVERY CHOSEN TYPE MUST MATCH, the same AND the event chips use -- "artifact creature" is a
    // real question and two chips is how it is asked.
    for (const code of types) if (code < 0 || !(card.t ?? []).includes(code)) return false;
    for (const code of subtypes) if (code < 0 || !(card.s ?? []).includes(code)) return false;
    // ABSENT `mv` IS ZERO, which is what the artifact means by leaving it out.
    return maxMv === undefined || (card.mv ?? 0) <= maxMv;
  };
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
