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
  /** PRINTED KEYWORD ABILITIES, all of them -- the same AND as `types`. 811 distinct over 16,302
   *  cards, which is a typeahead and not a row of chips, exactly like the subtypes. */
  keywords: string[];
  /** THE CARD'S OWN COLOURS, which is NOT `colours` above. That one is colour IDENTITY and asks
   *  what deck a card is legal in; this asks what the card IS. 1,751 of 32,334 cards answer the
   *  two differently, which is why Scryfall splits `c:` from `id:` and why this is a second row
   *  rather than a rename -- `colors` in the URL was identity the day it shipped. */
  cardColours: string[];
  /** MANA VALUE AS A RANGE, both ends inclusive, either end optional (owner, 2026-09-21: "not
   *  everyone looks for just X or less"). It was a bare ceiling until then, and `?mv=N` still
   *  reads as `mvMax` so no link already shared changes meaning.
   *
   *  ZERO IS A REAL BOUND, which is why every one of these is `undefined`-checked and never tested
   *  for truthiness: "power 0 to 0" asks for the Ornithopters. */
  mvMin?: number;
  mvMax?: number;
  powMin?: number;
  powMax?: number;
  touMin?: number;
  touMax?: number;
  /** How the kept rows are ordered. `partners` is the artifact's own order (best connected first)
   *  and stays the default -- the sort exists so a reader can ESCAPE that ranking, not because it
   *  is wrong. The deck-build run's complaint: rare events outranked good cards, so it found
   *  staples "only by already knowing their names and typing them in". */
  sort?: "partners" | "mv" | "name" | "pow" | "tou";
  /** Which end comes first. Absent means the order's own natural direction (`NATURAL_DIR`), so a
   *  link written before the control existed still reads the way it did. */
  dir?: "asc" | "desc";
}

/** EACH ORDER'S NATURAL END. Connections, power and toughness read biggest first; mana value
 *  cheapest first; names A to Z. The URL carries `dir` only when the reader turned it round. */
export const NATURAL_DIR: Record<NonNullable<EventQuery["sort"]>, "asc" | "desc"> = {
  partners: "desc", mv: "asc", name: "asc", pow: "desc", tou: "desc",
};

/** REPEATED PARAMS, NEVER A JOINED LIST. 274 of the 1,187 keys contain a comma
 *  (`fills|creature,enchantment|-|-`, measured 2026-09-19), so a split cannot recover what a join
 *  destroyed -- and the longest key is 118 characters, which three of still fits any URL.
 *
 *  `does` AND `theme` ARE NOT READ. An old link carrying them lands on an unfiltered page, which
 *  is a smaller lie than answering a question the vocabulary no longer has. */
const SORTS = new Set(["partners", "mv", "name", "pow", "tou"]);

/** ONE BOUND OUT OF THE URL. A BAD ONE IS NO FILTER, NOT ZERO: `?mvmax=abc` reading as "at most 0
 *  mana" would answer a question nobody asked with a confident empty list. Zero itself IS allowed,
 *  which is the whole reason this returns an object to spread rather than a number. */
const bound = (raw: string | null): number | undefined => {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
};

export function eventsFromParams(p: URLSearchParams): EventQuery {
  const sort = p.get("sort") ?? "";
  const dir = p.get("dir") ?? "";
  // THE OLD CEILING, STILL READ. `?mv=3` is live on the deployed site and in every link shared
  // since #423; it meant "3 or less" and it still does. `mvmax` wins where both are present.
  const legacyMv = bound(p.get("mv"));
  const mvMax = bound(p.get("mvmax")) ?? legacyMv;
  const ranges = {
    mvMin: bound(p.get("mvmin")), mvMax,
    powMin: bound(p.get("powmin")), powMax: bound(p.get("powmax")),
    touMin: bound(p.get("toumin")), touMax: bound(p.get("toumax")),
  };
  return {
    produce: p.getAll("produce").filter((k) => k.length > 0),
    consume: p.getAll("consume").filter((k) => k.length > 0),
    colours: [...(p.get("colors") ?? "")].filter((c) => "WUBRGC".includes(c)),
    types: p.getAll("type").filter((k) => k.length > 0),
    subtypes: p.getAll("subtype").filter((k) => k.length > 0),
    keywords: p.getAll("keyword").filter((k) => k.length > 0),
    cardColours: [...(p.get("cardcolors") ?? "")].filter((c) => "WUBRGC".includes(c)),
    ...Object.fromEntries(Object.entries(ranges).filter(([, v]) => v !== undefined)),
    ...(SORTS.has(sort) ? { sort: sort as EventQuery["sort"] } : {}),
    ...(dir === "asc" || dir === "desc" ? { dir } : {}),
  };
}

export function eventsToParams(q: EventQuery, p: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(p);
  for (const k of [
    "produce", "consume", "colors", "type", "subtype", "keyword", "cardcolors", "sort", "dir",
    // `mv` IS DELETED AND NEVER WRITTEN. It is read for the links that already carry it and
    // rewritten as `mvmax`, so the legacy spelling does not propagate into new ones.
    "mv", "mvmin", "mvmax", "powmin", "powmax", "toumin", "toumax",
  ]) out.delete(k);
  for (const k of q.produce) out.append("produce", k);
  for (const k of q.consume) out.append("consume", k);
  if (q.colours.length > 0) out.set("colors", q.colours.join(""));
  for (const k of q.types) out.append("type", k);
  for (const k of q.subtypes) out.append("subtype", k);
  for (const k of q.keywords) out.append("keyword", k);
  if (q.cardColours.length > 0) out.set("cardcolors", q.cardColours.join(""));
  for (const [name, v] of [
    ["mvmin", q.mvMin], ["mvmax", q.mvMax], ["powmin", q.powMin],
    ["powmax", q.powMax], ["toumin", q.touMin], ["toumax", q.touMax],
  ] as const) if (v !== undefined) out.set(name, String(v));
  // THE DEFAULT IS NOT WRITTEN DOWN. `?sort=partners` in every shared link is noise, and it would
  // pin the order against a future change of default.
  if (q.sort && q.sort !== "partners") out.set("sort", q.sort);
  if (q.dir && q.dir !== NATURAL_DIR[q.sort ?? "partners"]) out.set("dir", q.dir);
  return out;
}

/** Does this card pass the characteristic half of the query? The event half is answered from the
 *  membership index; this is answered from the row itself, which is why it lives here. */
export function compileCharacteristics(
  q: Pick<EventQuery, "types" | "subtypes" | "keywords" | "cardColours"
    | "mvMin" | "mvMax" | "powMin" | "powMax" | "touMin" | "touMax">,
  /** WHAT THIS ARTIFACT CAN ANSWER, not only what the words are. `colours` says whether its rows
   *  carry `c` at all -- see the colourless branch below for why that needs saying out loud. */
  vocab: { types: string[]; subtypes: string[]; keywords: string[]; colours?: boolean },
): (card: { t?: number[]; s?: number[]; k?: number[]; mv?: number; pow?: number; tou?: number; c?: number }) => boolean {
  // THE NAMES BECOME CODES ONCE, NOT ONCE PER CARD. Resolving them inside the predicate meant a
  // 488-entry `indexOf` scan per card per chosen subtype, over 25,582 rows, re-run on every
  // keystroke of the name field -- about twelve million string comparisons to answer one letter.
  //
  // A NAME THE VOCABULARY DOES NOT KNOW YIELDS -1 AND MATCHES NOTHING, deliberately: the tables
  // load asynchronously, and a filter that silently stopped applying while they were in flight
  // would show cards that do not answer the question.
  const types = q.types.map((n) => vocab.types.indexOf(n));
  const subtypes = q.subtypes.map((n) => vocab.subtypes.indexOf(n));
  const keywords = q.keywords.map((n) => vocab.keywords.indexOf(n));
  const { mvMin, mvMax, powMin, powMax, touMin, touMax } = q;
  // THE CARD IS AT LEAST THESE COLOURS, which is Scryfall's `c:` and not the identity row's
  // fits-in: "Blue" answers every blue card including Dimir, "Blue, Black" answers the ones that
  // are both. Colourless is exclusive of the five, as it is in the identity row.
  const wantColourless = q.cardColours.includes("C");
  const colourMask = wantColourless ? 0 : COLOUR_BIT_MASK(q.cardColours);
  // AN ARTIFACT WITHOUT COLOURS ANSWERS NO COLOUR QUESTION. This is the one of the four new
  // dimensions that does not fail closed on its own: a missing `c` means colourless on a fresh
  // artifact -- the build omits the field only when the mask is 0 -- but EVERY row of an artifact
  // built before today is missing it, so "Colourless" would answer with the whole corpus. The
  // keyword row fails closed for free (an unknown word is -1 and matches nothing) and so do
  // `pow`/`tou` (absent is excluded); this one has to be told.
  //
  // NOT HYPOTHETICAL: `npm run deploy` ships `static-out/` and nothing rebuilds it, and code has
  // already gone out against a stale artifact once (Samut, 2026-09-05). A silent wrong answer is
  // worse than a missing one, which is the rule this repo keeps.
  const canAnswerColours = vocab.colours !== false;
  return (card) => {
    // EVERY CHOSEN TYPE MUST MATCH, the same AND the event chips use -- "artifact creature" is a
    // real question and two chips is how it is asked.
    for (const code of types) if (code < 0 || !(card.t ?? []).includes(code)) return false;
    for (const code of subtypes) if (code < 0 || !(card.s ?? []).includes(code)) return false;
    for (const code of keywords) if (code < 0 || !(card.k ?? []).includes(code)) return false;
    if (q.cardColours.length > 0 && !canAnswerColours) return false;
    if (wantColourless) { if ((card.c ?? 0) !== 0) return false; }
    else if (colourMask !== 0 && ((card.c ?? 0) & colourMask) !== colourMask) return false;
    // ABSENT `mv` IS ZERO, which is what the artifact means by leaving it out.
    const mv = card.mv ?? 0;
    if (mvMin !== undefined && mv < mvMin) return false;
    if (mvMax !== undefined && mv > mvMax) return false;
    // AN ABSENT POWER IS NOT ZERO, unlike an absent mana value. 242 cards print `*`, `1+*` or `X`
    // and the build omits the field for them, along with everything that prints no power at all:
    // answering "power 0" for a Tarmogoyf or an Island would be a claim, and this engine says
    // nothing instead. A VEHICLE DOES print one and does answer, which is Scryfall's rule too.
    if (powMin !== undefined || powMax !== undefined) {
      if (card.pow === undefined) return false;
      if (powMin !== undefined && card.pow < powMin) return false;
      if (powMax !== undefined && card.pow > powMax) return false;
    }
    if (touMin !== undefined || touMax !== undefined) {
      if (card.tou === undefined) return false;
      if (touMin !== undefined && card.tou < touMin) return false;
      if (touMax !== undefined && card.tou > touMax) return false;
    }
    return true;
  };
}

/** THE WUBRG BITS, and the browser's copy of the build's table. `identityMask` in `partners-core`
 *  is the original; importing it here would drag the matcher graph into a Cloudflare Function that
 *  has no node types, which is the `inject.ts` trap CLAUDE.md records. Five constants, pinned by a
 *  test on both sides rather than by an import. */
const COLOUR_BIT_MASK = (colours: readonly string[]): number => {
  const bit: Record<string, number> = { W: 1, U: 2, B: 4, R: 8, G: 16 };
  return colours.reduce((m, c) => m | (bit[c] ?? 0), 0);
};

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

/** ONE FILTER ROW'S IDENTITY. The panel is a list of rows a reader ADDS (owner, 2026-09-21: the
 *  first card sat at 772px of a 930px viewport, so 83% of the screen was chrome before a result).
 *
 *  `typeline` IS ONE KIND OVER TWO PARAMS, which is the owner's question answered ("why type and
 *  subtype is not one like on scryfall"). They were already one question: every term in this query
 *  ANDs, which is exactly what `t:` does on Scryfall, and the 487 words are 13 types and 474
 *  subtypes with NO word in both -- so a merged control resolves each choice to its own param
 *  without ever having to ask which was meant. Only the control merged; the params did not, so
 *  every link shared before today still opens the search it named. */
export type FilterKind =
  | "colours" | "cardColours" | "typeline" | "keywords"
  | "mv" | "power" | "toughness"
  | "produce" | "consume";

/** THE ORDER THE ROWS ARE DRAWN IN, and it is fixed rather than the order they were added: a
 *  reader's own panel and the link they share are the same question, and rows that shuffle between
 *  the two make them look like different ones. Cheapest question first. */
export const FILTER_KINDS: FilterKind[] = [
  // WHAT THE CARD IS, then what it COSTS, then what it DOES. Three groups a player already thinks
  // in, and the events last because they are the question only this engine can answer -- a reader
  // who came for them scrolls past nothing to reach them, since none of this is drawn unasked.
  "colours", "cardColours", "typeline", "keywords",
  "mv", "power", "toughness",
  "produce", "consume",
];

/** WHICH ROWS THE URL IS ALREADY ASKING FOR. Derived, never stored: a link carrying
 *  `?subtype=sliver&mv=3` has to arrive with those two rows open and filled, or a shared search
 *  lands on a page that does not show what it asks. A row the reader has added but not yet filled
 *  has no param to be found in, and is the caller's business to remember.
 *
 *  `sort` IS NOT A KIND. An order applies with nothing asked, so there is no "add" that turns it on
 *  and nothing to remove; it belongs beside the count, not in a list of questions. */
export function filterKindsOf(q: EventQuery): FilterKind[] {
  const asked: Record<FilterKind, boolean> = {
    colours: q.colours.length > 0,
    cardColours: q.cardColours.length > 0,
    typeline: q.types.length > 0 || q.subtypes.length > 0,
    keywords: q.keywords.length > 0,
    // EITHER END IS THE SAME ROW. "3 or more" is a range with no ceiling and still the mana value
    // question; two rows for one dimension would let a reader remove half of it.
    mv: q.mvMin !== undefined || q.mvMax !== undefined,
    power: q.powMin !== undefined || q.powMax !== undefined,
    toughness: q.touMin !== undefined || q.touMax !== undefined,
    produce: q.produce.length > 0,
    consume: q.consume.length > 0,
  };
  return FILTER_KINDS.filter((k) => asked[k]);
}

/** THE ROW'S OWN PARAMS, CLEARED, AND NOBODY ELSE'S. Removing a row is the only way back to "not
 *  asked" for it, so a kind that also clears a neighbour would silently narrow a search the reader
 *  still wanted -- and `sort` survives every removal, because it was never one of the questions. */
export function withoutFilterKind(q: EventQuery, kind: FilterKind): EventQuery {
  switch (kind) {
    case "colours": return { ...q, colours: [] };
    case "cardColours": return { ...q, cardColours: [] };
    case "keywords": return { ...q, keywords: [] };
    // BOTH, because one row asked both. Clearing only the one the reader last typed would leave the
    // row gone from the panel and its other param still narrowing the list, which is the shape of
    // "the filter I removed is still filtering".
    case "typeline": return { ...q, types: [], subtypes: [] };
    // BOTH ENDS, and by DELETING rather than setting 0: a bound of zero is a real question
    // ("power 0 to 0" asks for the Ornithopters) and this is the reader saying they have none.
    case "mv": { const { mvMin: _a, mvMax: _b, ...rest } = q; return rest; }
    case "power": { const { powMin: _a, powMax: _b, ...rest } = q; return rest; }
    case "toughness": { const { touMin: _a, touMax: _b, ...rest } = q; return rest; }
    case "produce": return { ...q, produce: [] };
    case "consume": return { ...q, consume: [] };
  }
}
