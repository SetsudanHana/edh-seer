import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { slugOf } from "@edh-seer/matcher/partners-core";
import { loadNameIndex, type NameIndexEntry } from "../lib/partners.js";
import { LegacyDeckRedirect } from "./LegacyDeckRedirect.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { PageFoot } from "./PageFoot.js";

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
  // the five colours could ask for them: an empty identity is a SUBSET of every filter, so they
  // appeared under "Red" and under nothing of their own. `C` narrows to exactly them.
  ["C", "Colorless"],
];

export function CardSearch({
  load = loadNameIndex, hash, replace, mode = "cards",
}: {
  load?: (baseUrl: string) => Promise<NameIndexEntry[]>;
  hash?: string;
  replace?: (url: string) => void;
  /** ONE COMPONENT, TWO ROUTES. The commander list is the same index, the same box and the same cap
   *  with three differences -- it keeps only the 2,423 cards that can lead a deck, it links to
   *  `/commanders/:slug`, and it offers colour-identity facets. A second component would have been
   *  forty lines of copy that drift apart the first time one of them is fixed. */
  mode?: "cards" | "commanders";
}) {
  const commanderMode = mode === "commanders";
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
  const [colours, setColours] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void load("/static").then((i) => { if (live) setIndex(i); });
    return () => { live = false; };
  }, [load]);

  // MATCHED THE WAY THE URL IS BUILT. `slugOf` folds diacritics and drops apostrophes, so "jotun"
  // finds `Jötun Grunt` and "ajanis" finds `Ajani's Chosen` -- and finds them under the spelling the
  // link will use. Reusing the build's own function is also what keeps the two from drifting.
  const needle = slugOf(query);
  // A FACET IS A COMPLETE QUESTION ON ITS OWN. "Show me red commanders" needs no text, so the
  // empty-query gate lifts as soon as one is chosen -- browsing by colour is what this page is for.
  const asked = needle.length > 0 || (commanderMode && colours.length > 0);
  const matches = useMemo(() => {
    if (index === null || !asked) return [];
    const chosen = new Set(colours);
    return index.filter((e) =>
      (!commanderMode || e.commander)
      && e.slug.includes(needle)
      // WITHIN the chosen colours, not overlapping them: a Grixis commander cannot be built in a
      // mono-red deck. Same subset rule the artifact ranks a commander's own partners by, so a
      // colourless commander fits inside every identity.
      // COLOURLESS IS EXACT; THE FIVE COLOURS ARE A CEILING. "Red" asks what a red deck may lead
      // with, and an empty identity is inside every one of those -- the same subset rule the
      // artifact ranks a commander's own partners by. "Colorless" asks for the cards that ARE
      // colourless, which is a different question and the only way to reach those 13 commanders.
      && (!commanderMode || colours.length === 0
        || (chosen.has("C") && e.identity.length === 0)
        || (colours.some((c) => c !== "C") && e.identity.every((c) => chosen.has(c)))));
  }, [index, needle, asked, colours, commanderMode]);

  return (
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

      {commanderMode && (
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
                onClick={() => setColours((cs) => on ? cs.filter((c) => c !== code) : [...cs, code])}
                className={`inline-flex items-center gap-1.5 rounded-(--radius) border px-3 py-1.5 text-sm ${on
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
      )}

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
                </li>
              ))}
            </ul>
          </div>
        )}
      <PageFoot />
    </section>
  );
}
