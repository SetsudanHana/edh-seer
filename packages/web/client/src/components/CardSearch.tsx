import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { matchNames, needleOf } from "../lib/name-match.js";
import { sharedFacetIndex, sharedNameIndex, type FacetRow, type NameIndexEntry } from "../lib/partners.js";
import { DOES, STRATEGIES, applyFacets, facetsFromParams, facetsToParams, matchedTerms, type FacetQuery } from "../lib/facets.js";
import { LegacyDeckRedirect } from "./LegacyDeckRedirect.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { PageFoot } from "./PageFoot.js";
import { CardPeek } from "./CardPeek.js";
import { PeekContext, peekOnPlainClick, usePeekState } from "./peek.js";
import type { CardPageData } from "../lib/partners.js";

/** HOW MANY ROWS ONE QUERY MAY DRAW. A readability choice and a jank one at once: "a" matches most
 *  of the corpus, and 15,350 links is a page nobody scrolls and a frame nobody gets back. The count
 *  above the list says what was found, so the cap withholds rows and not the answer. */
export const SEARCH_LIMIT = 50;

/** THE CARD SEARCH, and the landing point for a share link copied before the surfaces moved.
 *
 *  `/cards` used to BE the report's card list. A share link is `path + #deck=<payload>` and the
 *  hash never reaches the server, so no Cloudflare rule can tell such a link from someone who typed
 *  `/cards` -- `LegacyDeckRedirect` makes that call in the client, and is a no-op without `#deck=`.
 *
 *  THE INDEX IS ONE FILE, 1.39 MB and 320 KB over the wire (measured 2026-09-04, 15,350 cards). It
 *  is fetched once and read from the Cache API afterwards, under the version directory, so a second
 *  visit pays nothing.
 *  CEILING: at three times the corpus this stops being a reasonable download. Upgrade path: shard
 *  the index by first slug character, the way the card and partner artifacts already shard. */
/** THE FIVE COLOURS, IN WUBRG ORDER, which is the order every Magic interface prints them in and
 *  the order a player reads without thinking about it. */
const COLOURS: [code: string, label: string][] = [
  ["W", "White"], ["U", "Blue"], ["B", "Black"], ["R", "Red"], ["G", "Green"],
  // COLOURLESS IS A REAL IDENTITY AND WAS UNREACHABLE (owner-reported 2026-09-04). 13 of the 2,428
  // commanders have an empty identity -- Ulamog, Kozilek, Emrakul, Galactus -- and no combination of
  // the five colours could ask for them. `C` narrows to exactly them, and is EXCLUSIVE of the five:
  // every identity already contains the colourless cards, so "Red and colourless" is either a
  // redundant question or an empty one. Ticking a colour unticks it, and it unticks every colour.
  ["C", "Colorless"],
];

export function CardSearch({
  load = sharedNameIndex, facets = sharedFacetIndex, peekLoad, hash, replace, mode = "cards",
}: {
  load?: (baseUrl: string) => Promise<NameIndexEntry[]>;
  /** The facet rows (spec 2026-09-08 part 4), asked for on the first facet interaction only. */
  facets?: (baseUrl: string) => Promise<FacetRow[]>;
  /** The peek's own loader; tests pass one, the page reads the shard. */
  peekLoad?: (slug: string) => Promise<CardPageData | null>;
  hash?: string;
  replace?: (url: string) => void;
  /** ONE COMPONENT, TWO ROUTES. The commander list is the same index, the same box and the same cap
   *  with three differences -- it keeps only the 2,423 cards that can lead a deck, it links to
   *  `/commanders/:slug`, and it offers colour-identity facets. A second component would have been
   *  forty lines of copy that drift apart the first time one of them is fixed. */
  mode?: "cards" | "commanders";
}) {
  const commanderMode = mode === "commanders";
  // THE RESULT LIST PEEKS (owner 2026-09-08): a click on a result used to leave the filtered list
  // and Back rebuilt it. Same stack, same panel, same click rule as the card pages.
  const peek = usePeekState();
  const [index, setIndex] = useState<NameIndexEntry[] | null>(null);
  // THE QUERY LIVES IN THE URL, so a search is a link. `/cards/krenko-mob` is a slug nobody minted;
  // its page cannot guess what was meant, but it CAN hand the reader here with what they typed
  // already in the box -- which is the whole recovery from a truncated or misremembered name.
  // Shareable for free, and `replace` keeps a keystroke out of the back button.
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const setQuery = (next: string) => {
    setParams(next ? { q: next } : {}, { replace: true });
  };
  // THE FACETS LIVE IN THE URL (spec 2026-09-08 part 4), so a result set is a link and the back
  // button is honest; the colour chips moved here from local state for the same reason.
  const facetQuery = useMemo(() => facetsFromParams(params), [params]);
  const setFacets = (next: FacetQuery) => setParams(facetsToParams(next, params), { replace: true });
  const colours = facetQuery.colours;
  const setColours = (f: (cs: string[]) => string[]) => setFacets({ ...facetQuery, colours: f(colours) });
  useEffect(() => {
    let live = true;
    void load("/static").then((i) => { if (live) setIndex(i); });
    return () => { live = false; };
  }, [load]);
  // THE FACET ROWS ARE READ ONLY WHEN A FACET NEEDS THEM: the name index answers a name and the
  // exact-identity chips on both pages. Does and Strategy need what the rows carry, and that file
  // is not fetched on a page that never asks.
  const needsFacets = facetQuery.does.length > 0 || facetQuery.strategy !== undefined;
  const [facetRows, setFacetRows] = useState<FacetRow[] | null>(null);
  useEffect(() => {
    if (!needsFacets || facetRows !== null) return;
    let live = true;
    void facets("/static").then((r) => { if (live) setFacetRows(r); });
    return () => { live = false; };
  }, [needsFacets, facetRows, facets]);

  // MATCHED THE WAY THE URL IS BUILT. `slugOf` folds diacritics and drops apostrophes, so "jotun"
  // finds `Jötun Grunt` and "ajanis" finds `Ajani's Chosen` -- and finds them under the spelling the
  // link will use. Reusing the build's own function is also what keeps the two from drifting.
  const needle = needleOf(query);
  // A FACET IS A COMPLETE QUESTION ON ITS OWN. "Show me red commanders" needs no text, so the
  // empty-query gate lifts as soon as one is chosen -- browsing by colour is what this page is for.
  const asked = needle.length > 0 || colours.length > 0 || needsFacets;
  // ONE RULE WITH THE HEADER FIELD. `matchNames` is the rule (and carries the exact-identity ruling
  // the colour chips answer with); this page adds the commander and colour predicates the header
  // does not offer, and the facets narrow that answer by slug. `null` while the rows are read.
  const rowBySlug = useMemo(() => new Map((facetRows ?? []).map((r) => [r.s, r])), [facetRows]);
  const matches = useMemo((): NameIndexEntry[] | null => {
    if (index === null || !asked) return [];
    // A FACET IS A COMPLETE QUESTION ON ITS OWN: with no name typed, the facets narrow the whole
    // index, not the empty answer `matchNames` gives an empty needle.
    const byName = needle.length === 0 && needsFacets && colours.length === 0
      ? index.filter((e) => !commanderMode || e.commander)
      : matchNames(index, { query, colours, ...(commanderMode ? { commanders: true } : {}) });
    if (!needsFacets) return byName;
    if (facetRows === null) return null;
    const kept = applyFacets(facetRows, facetQuery, mode);
    const order = new Map(kept.map((r, i) => [r.s, i]));
    return byName.filter((e) => order.has(e.slug)).sort((a, b) => order.get(a.slug)! - order.get(b.slug)!);
  }, [index, query, asked, colours, commanderMode, needsFacets, facetRows, facetQuery, mode]);

  return (
    <PeekContext.Provider value={peek}>
    <div className="lg:grid lg:grid-cols-[minmax(0,68ch)_20rem] lg:gap-x-10 lg:items-start">
    <section className="flex flex-col gap-6 max-w-[68ch]">
      {/* ONLY `/cards` EVER CARRIED A SHARE LINK. `/commanders` is a new path, so there is no
        * stale link to catch and nothing to redirect. */}
      {!commanderMode && (
        <LegacyDeckRedirect to="/analysis/cards" {...(hash !== undefined ? { hash } : {})}
          {...(replace !== undefined ? { replace } : {})} />
      )}
      <header className="flex flex-col gap-3">
        {/* THE LABEL IS NOT THE PAGE. "Cards" at 48px was the largest thing on a screen whose real
          * lead is the box you type in -- a generic noun out-ranking the only control that does
          * anything. */}
        <h2 className="text-2xl font-bold tracking-[-0.01em]">
          {commanderMode ? "Commanders" : "Cards"}
        </h2>
        <p className="text-(--muted) max-w-[65ch]">
          {commanderMode
            ? "Every legendary creature the engine has read that can lead a deck, with the cards inside its colour identity it is most specifically connected to."
            : "Every card the engine has read, with what it produces, what it cares about, and the cards it is most specifically connected to."}
        </p>
      </header>

      {/* ON BOTH PAGES NOW (spec part 4), and EXACT on both (owner 2026-09-08): Green and White list
        *  green-white cards. A "fits in" subset was built first for the Cards page and rejected. */}
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="eyebrow">Colour identity</legend>
          {COLOURS.map(([code, label]) => {
            const on = colours.includes(code);
            return (
              // FILTER CHIP, the system's own: `--separator` border at rest, `--accent` border and
              // text when selected -- the same grammar the tabs use, so a selected filter and an
              // active tab read as the same kind of state.
              <button
                key={code} type="button" aria-pressed={on}
                // COLOURLESS UNTICKS THE COLOURS AND THEY UNTICK IT. Every identity already contains
                // the colourless cards, so the two questions cannot be asked at once -- holding both
                // selected would only ever draw an empty list.
                onClick={() => setColours((cs) => on
                  ? cs.filter((c) => c !== code)
                  : code === "C" ? ["C"] : [...cs.filter((c) => c !== "C"), code])}
                className={`inline-flex items-center gap-1.5 min-h-11 rounded-(--radius) border px-3 text-sm ${on
                  ? "border-(--accent) text-(--accent)"
                  : "border-(--separator) text-(--muted) hover:text-(--foreground)"}`}
              >
                {/* DECORATIVE HERE, and marked so: the chip's own word is its accessible name, and
                  * letting the symbol contribute one turns "Red" into "one red mana Red". */}
                <span aria-hidden="true" className="text-base leading-none">
                  <ManaSymbols cost={`{${code}}`} />
                </span>
                {label}
              </button>
            );
          })}
      </fieldset>

      {/* WHAT IT DOES. Curated chips with player labels (`lib/facets.ts`); the rest of the effect
        *  kinds stay reachable by name, and the line under the chips says so. OR within the group. */}
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="eyebrow">Does</legend>
        {DOES.map((d) => {
          const on = facetQuery.does.includes(d.kind);
          return (
            <button
              key={d.kind} type="button" aria-pressed={on}
              onClick={() => setFacets({ ...facetQuery, does: on
                ? facetQuery.does.filter((k) => k !== d.kind)
                : [...facetQuery.does, d.kind] })}
              className={`inline-flex items-center min-h-11 rounded-(--radius) border px-3 text-sm ${on
                ? "border-(--accent) text-(--accent)"
                : "border-(--separator) text-(--muted) hover:text-(--foreground)"}`}
            >
              {d.label}
            </button>
          );
        })}
        <p className="basis-full text-(--muted) text-sm">Anything else a card does is reachable by name.</p>
      </fieldset>

      {/* THE STRATEGY: the report's own archetype dictionary, one at a time. A native select, because
        *  121 strategies are not a chip row; grouped by the vocabulary's class. On Commanders it reads
        *  "Supports", and askers come before suppliers (`applyFacets`). */}
      <label className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="eyebrow text-(--muted)">{commanderMode ? "Supports" : "Strategy"}</span>
        <select
          value={facetQuery.strategy ?? ""}
          onChange={(e) => setFacets({ ...facetQuery, strategy: e.target.value || undefined })}
          className="min-h-11 max-w-full rounded-md border border-(--field-border) bg-(--field-background) text-(--field-foreground) px-3"
        >
          <option value="">any strategy</option>
          {[...new Set(STRATEGIES.map((s) => s.cls))].map((cls) => (
            <optgroup key={cls} label={cls}>
              {STRATEGIES.filter((s) => s.cls === cls).map((s) => <option key={s.slug} value={s.slug}>{s.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>

      {/* NO KICKER: the label pairs INLINE with the field rather than stacking above it. */}
      <label className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="eyebrow text-(--muted)">{commanderMode ? "find a commander" : "find a card"}</span>
        <input
          type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={commanderMode ? "Kess, Dissident Mage" : "Krenko, Mob Boss"}
          // A CONTROL'S BOUNDARY IS `--field-border`, which is the 3:1 one (WCAG 1.4.11).
          // `--border` does not exist: it was absorbed into `--separator`, the decorative hairline,
          // and `css-tokens.test.ts` caught this line naming it.
          className="w-full max-w-lg rounded-md border border-(--field-border) bg-(--field-background)
            text-(--field-foreground) placeholder:text-(--field-placeholder) px-3 py-2"
        />
      </label>

      {index === null
        ? <p className="text-(--muted)">Reading the index…</p>
        : !asked
        // AN EMPTY QUERY IS NOT AN EMPTY PAGE and not the whole corpus either: it says what is here
        // and waits. A bare box with nothing under it reads as a page that failed to load.
        // AN EMPTY QUERY OWNS THE SPACE IT IS IN rather than leaving a bare box above a screen of
        // nothing. It says what is here, in the figure that makes the claim concrete.
        ? <div className="min-h-[30svh] flex flex-col justify-center gap-2">
            <p className="text-3xl font-bold tracking-[-0.01em] tabular-nums">
              {(commanderMode ? index.filter((e) => e.commander).length : index.length).toLocaleString("en-US")}
            </p>
            <p className="text-(--muted) max-w-[55ch]">
              {commanderMode
                ? "commanders the engine has read. Pick a colour, or type a name."
                : "cards the engine has read. Type a name to find one."}
            </p>
          </div>
        : matches === null
        ? <p className="eyebrow text-(--muted)">reading what cards do</p>
        : matches.length === 0
        ? <p className="text-(--muted)">
            No {commanderMode ? "commander" : "card"} matches. The engine has read{" "}
            {index.length.toLocaleString("en-US")} cards; one it has never read has no page.
          </p>
        : (
          <div className="flex flex-col gap-2">
            <p className="text-(--muted) text-sm">
              {matches.length.toLocaleString("en-US")}{" "}
              {matches.length === 1
                ? (commanderMode ? "commander matches" : "card matches")
                : (commanderMode ? "commanders match" : "cards match")}
              {matches.length > SEARCH_LIMIT ? `, showing the first ${SEARCH_LIMIT}` : ""}.
            </p>
            {/* IDENTITY IS THE ROW'S DIFFERENTIATOR. Fifty near-identical lines of blue text is a
              * list nobody scans; the mana symbols give the eye something that varies, and they are
              * the one thing a player reads before the name when choosing a card. Present colours
              * only -- five fixed slots is the rule for a TABLE, and this list has no column to
              * align to. */}
            {/* WIDTH BUYS COLUMNS HERE TOO: a single 685px column of names left the right half of a
              * 1920px screen black and showed twelve results where two columns show twenty-four. */}
            <ul aria-label="Results" className="flex flex-col lg:block lg:columns-2 lg:gap-x-10">
              {matches.slice(0, SEARCH_LIMIT).map((e) => (
                <li key={e.slug} className="border-t border-(--separator) first:border-t-0 break-inside-avoid">
                  <Link
                    className="flex items-baseline gap-3 py-2.5 hover:text-(--accent) group"
                    to={`${commanderMode ? "/commanders" : "/cards"}/${e.slug}`}
                    onClick={(ev) => { peekOnPlainClick(peek, e.slug, ev); }}
                  >
                    <span className="group-hover:underline underline-offset-2">{e.name}</span>
                    {/* AN EMPTY IDENTITY IS COLOURLESS, NOT ABSENT. Rendering nothing there made
                      * 1,354 cards look like rows whose identity had failed to load. */}
                    <span className="text-sm shrink-0">
                      <ManaSymbols cost={e.identity.length > 0
                        ? e.identity.map((c) => `{${c}}`).join("")
                        : "{C}"} />
                    </span>
                    {!commanderMode && e.commander && (
                      <span className="eyebrow text-(--muted) shrink-0">commander</span>
                    )}
                  </Link>
                  {/* WHY IT IS ON THE LIST: the chip labels that hit. A list with no reason is what
                    *  this product refuses everywhere else. */}
                  {(() => {
                    const row = rowBySlug.get(e.slug);
                    const terms = row ? matchedTerms(row, facetQuery) : [];
                    return terms.length > 0
                      ? <p className="text-(--muted) text-sm pb-2">{terms.join(" · ")}</p>
                      : null;
                  })()}
                </li>
              ))}
            </ul>
          </div>
        )}
      <PageFoot />
    </section>
    {/* The peek beside the list on a wide viewport; below `lg` `.peek` is a fixed bottom sheet, so
      * the aside's position does not matter there. Rendered only while a card is being looked at,
      * so the list keeps its measure the rest of the time. */}
    {peek.stack.length > 0 && (
      <aside className="lg:sticky lg:top-[calc(var(--site-header-h,0px)+1.5rem)]">
        <CardPeek load={peekLoad} />
      </aside>
    )}
    </div>
    </PeekContext.Provider>
  );
}
