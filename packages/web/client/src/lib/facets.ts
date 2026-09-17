import { ARCHETYPE_SIGNATURE, ARCHETYPE_VOCABULARY } from "@edh-seer/matcher/archetypes";
import type { FacetRow } from "@edh-seer/matcher/partners-core";
import { compareRates, type RateFamily, type RateSpan } from "@edh-seer/matcher/rate";

/** FIND BY WHAT IT DOES (spec 2026-09-08 part 4). Three facets over the facet index: colours, what
 *  the card does (effect kinds, curated to the chips a player would reach for), and the strategy
 *  it belongs to (the report's own archetype dictionary). Groups AND; chips within a group OR. */

/** THE CHIPS A PLAYER REACHES FOR, in this order. Not all 39 kinds earn one; the rest stay
 *  reachable by name. Player labels, not engine names. A renamed kind fails `facets.test.ts`. */
export const DOES: { kind: string; label: string; rate?: RateFamily }[] = [
  { kind: "draw-card", label: "draws cards", rate: "cards" },
  { kind: "token-generation", label: "makes tokens", rate: "tokens" },
  { kind: "counter-placement", label: "puts counters", rate: "counters" },
  { kind: "proliferate", label: "proliferates" },
  { kind: "mana-generation", label: "adds mana", rate: "mana" },
  { kind: "lifegain", label: "gains life", rate: "life" },
  { kind: "graveyard-recursion", label: "returns from the graveyard", rate: "recursion" },
  { kind: "search", label: "searches the library", rate: "search" },
  { kind: "damage", label: "deals damage", rate: "damage" },
  { kind: "drain", label: "drains" },
  { kind: "player-life-loss", label: "makes opponents lose life", rate: "life-loss" },
  { kind: "mill", label: "mills", rate: "mill" },
  { kind: "untap", label: "untaps", rate: "untap" },
  { kind: "flicker", label: "flickers", rate: "flicker" },
  { kind: "exile-processing", label: "processes exiled cards" },
  { kind: "copy-spell", label: "copies spells", rate: "copies" },
  { kind: "copy-ability", label: "copies abilities" },
  { kind: "clone", label: "copies permanents" },
  { kind: "keyword-grant", label: "grants keywords" },
  { kind: "pump", label: "pumps" },
  { kind: "cost-reduction", label: "reduces costs" },
  { kind: "trigger-doubling", label: "doubles triggers" },
  { kind: "extra-turn", label: "takes extra turns" },
  { kind: "extra-combat", label: "takes extra combats" },
];

/** The strategies a card can belong to: vocabulary members that carry a signature, so membership
 *  is computable. Labelled as the report labels them. */
export const STRATEGIES: { slug: string; label: string; cls: string }[] = ARCHETYPE_VOCABULARY
  .filter((a) => a.slug in ARCHETYPE_SIGNATURE)
  .map((a) => ({ slug: a.slug, label: a.label, cls: a.class }));

export interface FacetQuery { colours: string[]; does: string[]; strategy?: string }

/** EXACT IDENTITY ON BOTH PAGES (owner 2026-09-08, the same ruling the Commanders chips carried
 *  since 2026-09-04): Green and White list green-white cards, not everything a green-white deck
 *  could play. A "fits in" subset was built first and rejected on sight. `C` chosen means
 *  colourless only. The `mode` stays in the signature because the caller passes it. */
export function coloursFit(identity: string, colours: string[], _mode: "cards" | "commanders"): boolean {
  if (colours.length === 0) return true;
  if (colours.includes("C")) return identity === "";
  return identity.length === colours.length && colours.every((c) => identity.includes(c));
}

const strategyHit = (r: FacetRow, q: FacetQuery): boolean => q.strategy === undefined || r.t.includes(q.strategy);
/** How many of the chosen Does chips the card satisfies. OR within the group, so one is enough to
 *  list it; the count is the order (owner 2026-09-08): a card that does three of the chosen things
 *  sits above one that does one. */
const doesHits = (r: FacetRow, q: FacetQuery): number => q.does.filter((k) => r.e.includes(k)).length;

/** THE RATE A QUERY SORTS BY (spec 2026-09-04 step 3): a SINGLE Does chip with a family. Two chips
 *  get no rate order -- cards per mana and damage per mana are two rates, and a constant that
 *  trades one for the other is what killed edge magnitude three times (log 2026-08-16). */
const rateFamily = (q: FacetQuery): RateFamily | undefined =>
  q.does.length === 1 ? DOES.find((d) => d.kind === q.does[0])?.rate : undefined;
const rateOf = (r: FacetRow, q: FacetQuery): RateSpan | undefined => {
  const f = rateFamily(q);
  return f === undefined ? undefined : r.r?.[f];
};

export function applyFacets(rows: FacetRow[], q: FacetQuery, mode: "cards" | "commanders"): FacetRow[] {
  const out = rows.filter((r) =>
    (mode !== "commanders" || r.c === 1) && coloursFit(r.i, q.colours, mode)
    && (q.does.length === 0 || doesHits(r, q) > 0) && strategyHit(r, q));
  // THE ORDER: on a single Does chip with a rate, the best rate first (floor per mana, ceiling to
  // break it) and every card that states one above every card that does not; then most chosen
  // chips matched first; then the cards that ASK for the strategy (its
  // payoffs) before the ones that merely supply it (measured on the first artifact, 2026-09-08:
  // the unranked list for "draws cards, +1/+1 Counters" opened with ten cards that merely enter
  // with a counter); then partner count, the best-connected card first (owner 2026-09-17: "makes
  // tokens, in red" opened on three Aether cards with nothing but the alphabet between 467 equal
  // rows); then slug, so two equal rows print the same way round every time.
  const s = q.strategy;
  const byRate = (a: FacetRow, b: FacetRow): number => {
    const ra = rateOf(a, q), rb = rateOf(b, q);
    if (ra === undefined || rb === undefined) return Number(ra === undefined) - Number(rb === undefined);
    return compareRates(ra, rb);
  };
  out.sort((a, b) =>
    byRate(a, b)
    || doesHits(b, q) - doesHits(a, q)
    || (s === undefined ? 0 : Number(b.d.includes(s)) - Number(a.d.includes(s)))
    || (b.p ?? 0) - (a.p ?? 0)
    || a.s.localeCompare(b.s));
  return out;
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
export function rateLabel([floor, floorMana, ceiling, ceilingMana, delayed]: RateSpan, family: RateFamily, size?: string): string {
  const span = ceiling === null ? `${floor}+` : ceiling === floor ? `${floor}` : `${floor}–${ceiling}`;
  const [singular, plural] = UNIT[family];
  // THE TOKEN'S SIZE beside the count: "2 1/1 tokens / 2 mana". A 1/1 and a 4/4 are not the same token.
  const unit = `${size ? `${size} ` : ""}${ceiling === 1 && floor === 1 ? singular : plural}`;
  const then = ceiling !== null && ceilingMana !== floorMana ? `, then ${ceiling} / ${ceilingMana}` : "";
  // SUMMONING SICKNESS (CR 302.6) is printed, not priced: a turn has no exchange rate in mana.
  return `${span} ${unit} / ${floorMana} mana${then}${delayed ? ", from next turn" : ""}`;
}

/** The labels that hit, for the line under a result that says why it is on the list, and on a
 *  single rated chip the rate the card charges. */
export function matchedTerms(row: FacetRow, q: FacetQuery): string[] {
  const terms = DOES.filter((d) => q.does.includes(d.kind) && row.e.includes(d.kind)).map((d) => d.label);
  const rate = rateOf(row, q);
  if (rate !== undefined) terms.push(rateLabel(rate, rateFamily(q)!, rateFamily(q) === "tokens" ? row.z : undefined));
  if (q.strategy !== undefined && row.t.includes(q.strategy)) {
    const label = STRATEGIES.find((s) => s.slug === q.strategy)?.label ?? q.strategy;
    terms.push(row.d.includes(q.strategy) ? `${label} (asks for it)` : label);
  }
  return terms;
}

export function facetsFromParams(p: URLSearchParams): FacetQuery {
  const colours = [...(p.get("colors") ?? "")].filter((c) => "WUBRGC".includes(c));
  const does = (p.get("does") ?? "").split(",").filter((k) => DOES.some((d) => d.kind === k));
  const theme = p.get("theme") ?? undefined;
  return { colours, does, strategy: theme && STRATEGIES.some((s) => s.slug === theme) ? theme : undefined };
}

export function facetsToParams(q: FacetQuery, p: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(p);
  for (const k of ["colors", "does", "theme"]) out.delete(k);
  if (q.colours.length > 0) out.set("colors", q.colours.join(""));
  if (q.does.length > 0) out.set("does", q.does.join(","));
  if (q.strategy !== undefined) out.set("theme", q.strategy);
  return out;
}
