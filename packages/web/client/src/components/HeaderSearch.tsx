import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useListboxKeys } from "../lib/listbox-keys.js";
import { matchNames } from "../lib/name-match.js";
import type { NameIndexEntry } from "../lib/partners.js";

/** SEARCH IN THE HEADER, ON EVERY APP PAGE (spec 2026-09-08 part 1).
 *
 *  From any card page the only route to another card by name was the foot link to `/cards`: a
 *  second page, a field, a click. The owner's words were that jumping between pages is not user
 *  friendly, and search being a separate trip was one of the three jumps named.
 *
 *  A PORTAL INTO THE STATIC HEADER, the way `InstallButton` mounts, so the header HTML in
 *  `index.html` and `how-it-works/index.html` stays byte-identical (`seo.test.ts` asserts it) and
 *  the docs page, which runs no bundle, simply has no field.
 *
 *  THE INDEX LOADS ON FIRST FOCUS, never on page load: it is 349 KB gzipped and most page views
 *  never search. `sharedNameIndex` makes it one load for the header and the Cards page together.
 *
 *  A COMBOBOX, per the ARIA pattern: the field owns `aria-activedescendant`, the list is a
 *  `listbox` of `option`s, arrows move, Enter opens, Escape closes. The "reading" and "no match"
 *  rows are deliberately not options, so the arrow keys never land on them. */
const LIMIT = 8;
const LIST_ID = "site-search-list";
const optId = (i: number): string => `site-search-opt-${i}`;
// Module-level, so the default is one stable function and the mount effect runs once, not per render.
const defaultHost = (): Element | null => document.querySelector(".site-header");

/* NOTHING HERE IS NEEDED UNTIL THE FIELD IS FOCUSED, and it all sat in the entry chunk: `partners.js`
 * pulls `@edh-seer/matcher/static-lookup` (edges, sentences, partner shards) and the two symbol
 * components pull the mana-font tables -- on every page view, for a field most never use. The index
 * is fetched on first focus anyway, so the code travels with it: `defaultLoad` starts all three
 * imports together, and the rows that need the symbols cannot render before the index arrives. */
const ManaSymbols = lazy(() => import("./ManaSymbols.js").then((m) => ({ default: m.ManaSymbols })));
const CardSymbol = lazy(() => import("./CardSymbol.js").then((m) => ({ default: m.CardSymbol })));
const defaultLoad = (baseUrl: string): Promise<NameIndexEntry[]> => {
  void import("./ManaSymbols.js");
  void import("./CardSymbol.js");
  return import("../lib/partners.js").then((m) => m.sharedNameIndex(baseUrl));
};

export function HeaderSearch({
  load = defaultLoad,
  host = defaultHost,
}: {
  load?: (baseUrl: string) => Promise<NameIndexEntry[]>;
  host?: () => Element | null;
}) {
  const navigate = useNavigate();
  const [mount, setMount] = useState<Element | null>(null);
  const [index, setIndex] = useState<NameIndexEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // A ref, not state: the load is asked for once per mount, and a re-render must not ask again.
  const asked = useRef(false);
  // The blur timer, cleared on unmount and on the next blur, so it never fires into a gone field.
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMount(host()); }, [host]);
  useEffect(() => () => { if (blurTimer.current !== null) clearTimeout(blurTimer.current); }, []);

  const ensureIndex = () => {
    if (asked.current) return;
    asked.current = true;
    setLoading(true);
    load("/static")
      .then(setIndex)
      .catch(() => { asked.current = false; })
      .finally(() => setLoading(false));
  };

  const matches = useMemo(
    () => (index === null ? [] : matchNames(index, { query }, LIMIT)),
    [index, query],
  );
  const listed = open && query.trim().length > 0;

  const go = (e: NameIndexEntry | undefined) => {
    if (!e) return;
    setQuery(""); setOpen(false); reset();
    void navigate(`/cards/${e.slug}`);
  };

  // THE KEYBOARD IS THE SHARED ONE (`lib/listbox-keys.ts`), so this field and the event pickers
  // cannot drift apart. Two rules stay here because they are this field's own: an arrow OPENS the
  // list, and Enter is ignored until the list is actually shown -- an empty box must submit
  // nothing rather than navigate to whatever row 0 happens to be.
  const { active, setActive, onKey: onListKey, reset } = useListboxKeys({
    count: matches.length,
    onChoose: (i) => { if (listed) go(matches[i]); },
    onClose: () => setOpen(false),
  });
  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && matches.length > 0) setOpen(true);
    onListKey(ev);
  };

  if (!mount) return null;
  return createPortal(
    <form
      role="search"
      className="site-search"
      {...(revealed ? { "data-open": "" } : {})}
      onSubmit={(ev) => { ev.preventDefault(); if (listed) go(matches[active >= 0 ? active : 0]); }}
    >
      {/* BELOW 48rem THE FIELD HAS NO ROOM ON THE HEADER'S ROWS, so it is a labelled button first
        *  and a row of its own once pressed (`index.css`, `.site-search-toggle`). A word, not an
        *  icon, for the same reason the More menu is a word. */}
      <button
        type="button"
        className="btn-secondary site-search-toggle"
        aria-expanded={revealed}
        aria-controls="site-search-field"
        onClick={() => {
          const next = !revealed;
          setRevealed(next);
          if (next) setTimeout(() => field.current?.focus(), 0);
        }}
      >
        Search
      </button>
      <div id="site-search-field" className="site-search-field">
        <input
          ref={field}
          type="search"
          role="combobox"
          aria-label="Find a card"
          aria-autocomplete="list"
          aria-expanded={listed}
          aria-controls={LIST_ID}
          {...(listed && active >= 0 ? { "aria-activedescendant": optId(active) } : {})}
          placeholder="Find a card"
          autoComplete="off"
          value={query}
          onFocus={() => { ensureIndex(); setOpen(true); }}
          onChange={(ev) => { setQuery(ev.target.value); setOpen(true); setActive(-1); }}
          onKeyDown={onKey}
          // Late enough for a click on a row to land before the list goes; the row's `mousedown`
          // also keeps focus on the field, so this is the keyboard reader's path only.
          onBlur={() => {
            if (blurTimer.current !== null) clearTimeout(blurTimer.current);
            blurTimer.current = setTimeout(() => { blurTimer.current = null; setOpen(false); }, 120);
          }}
        />
        {listed && (
          <ul id={LIST_ID} role="listbox" aria-label="Cards" className="site-search-list">
            {loading && index === null && <li className="site-search-note">Loading cards…</li>}
            {index !== null && matches.length === 0 && <li className="site-search-note">No card by that name</li>}
            {matches.map((e, i) => (
              <li
                key={e.slug}
                id={optId(i)}
                role="option"
                aria-selected={i === active}
                className="site-search-row"
                onMouseDown={(ev) => { ev.preventDefault(); }}
                onClick={() => go(e)}
                onMouseEnter={() => setActive(i)}
              >
                <span className="site-search-name">{e.name}</span>
                {/* The pips repeat the identity a sighted reader gets from colour; the name and the
                  *  commander MARK are the accessible content of the row. */}
                <span className="site-search-id" aria-hidden="true">
                  <Suspense fallback={null}>
                    <ManaSymbols cost={e.identity.length > 0 ? e.identity.map((c) => `{${c}}`).join("") : "{C}"} />
                  </Suspense>
                </span>
                {/* THE MARK IS CHROME, NOT PROSE, AND THIS IS THE CASE THE RULE NAMED (owner,
                  *  2026-09-20: "if it is part of the whole sentence then do not replace it, but if
                  *  we have the top search, then I would replace that"). `CardShell`'s commander tab
                  *  already carried `ms-commander` while this row still spelled the word, so the two
                  *  surfaces disagreed about the same fact.
                  *  IT KEEPS AN ACCESSIBLE NAME, which the word used to supply on its own: the pips
                  *  beside it are `aria-hidden`, so a bare glyph would leave the row announcing
                  *  nothing but the card's name and a screen-reader user unable to tell a commander
                  *  from a card. `label` is what turns `CardSymbol` from `aria-hidden` into
                  *  `role="img"`. */}
                {e.commander && <Suspense fallback={null}><CardSymbol name="commander" label="Commander" className="site-search-mark" /></Suspense>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>,
    mount,
  );
}
