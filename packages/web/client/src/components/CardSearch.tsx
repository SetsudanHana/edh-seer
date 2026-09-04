import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { slugOf } from "@edh-seer/matcher/partners-core";
import { loadNameIndex, type NameIndexEntry } from "../lib/partners.js";
import { LegacyDeckRedirect } from "./LegacyDeckRedirect.js";

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
export function CardSearch({
  load = loadNameIndex, hash, replace,
}: {
  load?: (baseUrl: string) => Promise<NameIndexEntry[]>;
  hash?: string;
  replace?: (url: string) => void;
}) {
  const [index, setIndex] = useState<NameIndexEntry[] | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let live = true;
    void load("/static").then((i) => { if (live) setIndex(i); });
    return () => { live = false; };
  }, [load]);

  // MATCHED THE WAY THE URL IS BUILT. `slugOf` folds diacritics and drops apostrophes, so "jotun"
  // finds `Jötun Grunt` and "ajanis" finds `Ajani's Chosen` -- and finds them under the spelling the
  // link will use. Reusing the build's own function is also what keeps the two from drifting.
  const needle = slugOf(query);
  const matches = useMemo(
    () => (needle.length === 0 || index === null ? [] : index.filter((e) => e.slug.includes(needle))),
    [index, needle],
  );

  return (
    <section className="flex flex-col gap-6">
      <LegacyDeckRedirect to="/analysis/cards" {...(hash !== undefined ? { hash } : {})}
        {...(replace !== undefined ? { replace } : {})} />
      <header className="flex flex-col gap-1">
        <h2 className="text-3xl font-semibold">Cards</h2>
        <p className="text-(--muted)">
          Every card the engine has read, with what it produces, what it cares about, and the cards
          it is most specifically connected to.
        </p>
      </header>

      <label className="flex flex-col gap-1">
        <span className="eyebrow">Find a card</span>
        <input
          type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Krenko, Mob Boss"
          // A CONTROL'S BOUNDARY IS `--field-border`, which is the 3:1 one (WCAG 1.4.11).
          // `--border` does not exist: it was absorbed into `--separator`, the decorative hairline,
          // and `css-tokens.test.ts` caught this line naming it.
          className="w-full max-w-lg rounded-md border border-(--field-border) bg-(--field-background)
            text-(--field-foreground) placeholder:text-(--field-placeholder) px-3 py-2"
        />
      </label>

      {index === null
        ? <p className="text-(--muted)">Reading the index…</p>
        : needle.length === 0
        // AN EMPTY QUERY IS NOT AN EMPTY PAGE and not the whole corpus either: it says what is here
        // and waits. A bare box with nothing under it reads as a page that failed to load.
        ? <p className="text-(--muted)">
            {index.length.toLocaleString("en-US")} cards are indexed. Type a name to find one.
          </p>
        : matches.length === 0
        ? <p className="text-(--muted)">
            No card matches “{query}”. The engine has read {index.length.toLocaleString("en-US")} of
            them; a card it has never read has no page.
          </p>
        : (
          <div className="flex flex-col gap-2">
            <p className="text-(--muted) text-sm">
              {matches.length.toLocaleString("en-US")} cards match
              {matches.length > SEARCH_LIMIT ? `, showing the first ${SEARCH_LIMIT}` : ""}.
            </p>
            <ul className="flex flex-col gap-1">
              {matches.slice(0, SEARCH_LIMIT).map((e) => (
                <li key={e.slug}>
                  <Link className="text-(--accent) hover:underline" to={`/cards/${e.slug}`}>{e.name}</Link>
                  {e.commander && <span className="text-(--muted) text-sm"> · can lead a deck</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
    </section>
  );
}
