import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { matchNames } from "../lib/name-match.js";
import { sharedNameIndex, type NameIndexEntry } from "../lib/partners.js";
import { ManaSymbols } from "./ManaSymbols.js";

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

export function HeaderSearch({
  load = sharedNameIndex,
  host = () => document.querySelector(".site-header"),
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
  const [active, setActive] = useState(-1);
  const [revealed, setRevealed] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // A ref, not state: the load is asked for once per mount, and a re-render must not ask again.
  const asked = useRef(false);

  useEffect(() => { setMount(host()); }, [host]);

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
    setQuery(""); setOpen(false); setActive(-1);
    void navigate(`/cards/${e.slug}`);
  };

  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "ArrowDown" && matches.length > 0) {
      ev.preventDefault(); setOpen(true); setActive((a) => (a + 1) % matches.length);
    } else if (ev.key === "ArrowUp" && matches.length > 0) {
      ev.preventDefault(); setOpen(true); setActive((a) => (a <= 0 ? matches.length - 1 : a - 1));
    } else if (ev.key === "Enter") {
      if (!listed) return;
      ev.preventDefault(); go(matches[active >= 0 ? active : 0]);
    } else if (ev.key === "Escape") {
      setOpen(false); setActive(-1);
    }
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
        className="site-search-toggle"
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
          onBlur={() => { setTimeout(() => setOpen(false), 120); }}
        />
        {listed && (
          <ul id={LIST_ID} role="listbox" aria-label="Cards" className="site-search-list">
            {loading && index === null && <li className="site-search-note">Reading the index</li>}
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
                  *  commander word are the accessible content of the row. */}
                <span className="site-search-id" aria-hidden="true">
                  <ManaSymbols cost={e.identity.length > 0 ? e.identity.map((c) => `{${c}}`).join("") : "{C}"} />
                </span>
                {e.commander && <span className="site-search-mark">commander</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>,
    mount,
  );
}
