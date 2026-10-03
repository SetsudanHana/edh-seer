import { useEffect, useState } from "react";
import { Link } from "react-router";
import { preconSets, year, type PreconIndexEntry } from "../lib/precon-html.js";
import { loadPreconIndex } from "../lib/precons.js";
import { ManaSymbols } from "./ManaSymbols.js";

/** `/precons`: every Commander precon, newest set first, each with its commander and theme. */
export function PreconIndex() {
  const [list, setList] = useState<PreconIndexEntry[] | null | undefined>(undefined);
  // FOUND BY TYPING, NOT BY SCROLLING (persona round 2026-09-29): the precon-upgrader seat owned
  // "Party Time" and could not find it in ~50 sets of columns. Deck, commander, theme or set.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = (d: PreconIndexEntry) => !q
    || [d.name, d.setName, d.theme ?? "", ...d.commanders].some((t) => t.toLowerCase().includes(q));
  const sets = list ? preconSets(list.filter(matches)) : [];
  useEffect(() => {
    let live = true;
    void loadPreconIndex().then((l) => { if (live) setList(l); });
    return () => { live = false; };
  }, []);
  return (
    <div className="flex flex-col gap-8 py-6" data-testid="precon-index">
      <div className="flex flex-col gap-2">
        <h1 className="t-title">Commander precons</h1>
        <p className="max-w-[65ch] text-(--muted)">Every Commander precon, read card by card: its theme, how well its cards work together, and the swaps that make them work together more.</p>
      </div>
      {list && list.length > 0 ? (
        <label className="flex flex-col gap-1 max-w-md">
          <span className="eyebrow text-(--muted)">find your precon</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Deck, commander, theme or set"
            className="min-h-11 rounded-(--radius) border border-(--separator) bg-(--surface) px-3 text-base" />
        </label>
      ) : null}
      {q && list && sets.length === 0 ? <p className="text-(--muted)">No precon matches &ldquo;{query.trim()}&rdquo;.</p> : null}
      {list === undefined ? <p role="status" className="text-(--muted)">Loading the precons</p>
        : list === null || list.length === 0 ? <p className="text-(--muted)">No precons are here yet.</p>
        // SETS FLOW IN COLUMNS, EACH KEPT WHOLE (#770, measured 2026-09-29). One set per full-width
        // row put a one-precon set in a third of a 2560 screen and ran 50 sets down 9,500px; as
        // newspaper columns a wide screen shows five or six sets side by side, newest first down
        // the first column. A phone keeps the one column it had.
        : <div className="sm:columns-[22rem] sm:gap-8">{sets.map((s) => (
          <section key={s.setCode} className="flex flex-col gap-2 break-inside-avoid mb-8" aria-labelledby={`set-${s.setCode}`}>
            <h2 id={`set-${s.setCode}`} className="t-subsection">{s.setName}{s.releaseDate ? <span className="font-normal text-(--muted)"> · {year(s.releaseDate)}</span> : null}</h2>
            <ul className="grid gap-2">
              {s.decks.map((d) => (
                <li key={d.slug}>
                  <Link to={`/precons/${d.slug}`} className={`${PRECON_TILE} hover:border-(--foreground)`}><PreconTileBody d={d} /></Link>
                </li>
              ))}
            </ul>
          </section>
        ))}</div>}
    </div>
  );
}

/** ONE PRECON TILE, ON THE INDEX AND ON HOME (designer crawl 2026-10-03, #994 item 8): home drew its
 *  own without the colour identity and with other padding. The wrapper differs -- a link here, a
 *  button that fills the box on home -- so the box's class and the body are what is shared. */
export const PRECON_TILE = "flex w-full min-h-11 flex-col rounded-(--radius) border border-(--separator) bg-(--surface) px-3 py-2 text-left";

export function PreconTileBody({ d }: { d: Pick<PreconIndexEntry, "name" | "identity" | "commanders" | "theme"> }) {
  return (
    <>
      <span className="flex items-center gap-2 font-semibold">{d.name}
        {d.identity.length ? <span aria-hidden="true" className="inline-flex"><ManaSymbols cost={d.identity.map((c) => `{${c}}`).join("")} /></span> : null}</span>
      <span className="text-sm text-(--muted)">{d.commanders.join(" and ")}{d.theme ? ` · ${d.theme}` : ""}</span>
    </>
  );
}
