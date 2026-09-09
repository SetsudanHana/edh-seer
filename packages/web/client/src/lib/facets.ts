import { ARCHETYPE_SIGNATURE, ARCHETYPE_VOCABULARY } from "@edh-seer/matcher/archetypes";
import type { FacetRow } from "@edh-seer/matcher/partners-core";

/** FIND BY WHAT IT DOES (spec 2026-09-08 part 4). Three facets over the facet index: colours, what
 *  the card does (effect kinds, curated to the chips a player would reach for), and the strategy
 *  it belongs to (the report's own archetype dictionary). Groups AND; chips within a group OR. */

/** THE CHIPS A PLAYER REACHES FOR, in this order. Not all 39 kinds earn one; the rest stay
 *  reachable by name. Player labels, not engine names. A renamed kind fails `facets.test.ts`. */
export const DOES: { kind: string; label: string }[] = [
  { kind: "draw-card", label: "draws cards" },
  { kind: "token-generation", label: "makes tokens" },
  { kind: "counter-placement", label: "puts counters" },
  { kind: "proliferate", label: "proliferates" },
  { kind: "mana-generation", label: "adds mana" },
  { kind: "lifegain", label: "gains life" },
  { kind: "graveyard-recursion", label: "returns from the graveyard" },
  { kind: "search", label: "searches the library" },
  { kind: "damage", label: "deals damage" },
  { kind: "drain", label: "drains" },
  { kind: "player-life-loss", label: "makes opponents lose life" },
  { kind: "mill", label: "mills" },
  { kind: "untap", label: "untaps" },
  { kind: "flicker", label: "flickers" },
  { kind: "copy-spell", label: "copies spells" },
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

export function applyFacets(rows: FacetRow[], q: FacetQuery, mode: "cards" | "commanders"): FacetRow[] {
  const out = rows.filter((r) =>
    (mode !== "commanders" || r.c === 1) && coloursFit(r.i, q.colours, mode)
    && (q.does.length === 0 || doesHits(r, q) > 0) && strategyHit(r, q));
  // THE ORDER: most chosen chips matched first; then the cards that ASK for the strategy (its
  // payoffs) before the ones that merely supply it (measured on the first artifact, 2026-09-08:
  // the unranked list for "draws cards, +1/+1 Counters" opened with ten cards that merely enter
  // with a counter); then slug, so two equal rows print the same way round every time.
  const s = q.strategy;
  out.sort((a, b) =>
    doesHits(b, q) - doesHits(a, q)
    || (s === undefined ? 0 : Number(b.d.includes(s)) - Number(a.d.includes(s)))
    || a.s.localeCompare(b.s));
  return out;
}

/** The labels that hit, for the line under a result that says why it is on the list. */
export function matchedTerms(row: FacetRow, q: FacetQuery): string[] {
  const terms = DOES.filter((d) => q.does.includes(d.kind) && row.e.includes(d.kind)).map((d) => d.label);
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
