import { useEffect, useState } from "react";
import { Link } from "react-router";
import { preconSets, year, type PreconIndexEntry } from "../lib/precon-html.js";
import { loadPreconIndex } from "../lib/precons.js";
import { ManaSymbols } from "./ManaSymbols.js";

/** `/precons`: every Commander precon, newest set first, each with its commander and theme. */
export function PreconIndex() {
  const [list, setList] = useState<PreconIndexEntry[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadPreconIndex().then((l) => { if (live) setList(l); });
    return () => { live = false; };
  }, []);
  return (
    <div className="flex flex-col gap-8 py-6" data-testid="precon-index">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold tracking-[-0.02em]">Commander precons</h1>
        <p className="max-w-[65ch] text-(--muted)">Every Commander precon, read card by card: its theme, how well its cards work together, and the swaps that make them work together more.</p>
      </div>
      {list === undefined ? <p role="status" className="text-(--muted)">Loading the precons</p>
        : list === null || list.length === 0 ? <p className="text-(--muted)">No precons are here yet.</p>
        : preconSets(list).map((s) => (
          <section key={s.setCode} className="flex flex-col gap-2" aria-labelledby={`set-${s.setCode}`}>
            <h2 id={`set-${s.setCode}`} className="text-lg font-bold">{s.setName}{s.releaseDate ? <span className="font-normal text-(--muted)"> · {year(s.releaseDate)}</span> : null}</h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {s.decks.map((d) => (
                <li key={d.slug}>
                  <Link to={`/precons/${d.slug}`} className="flex min-h-11 flex-col rounded-(--radius) border border-(--separator) bg-(--surface) px-3 py-2 hover:border-(--foreground)">
                    <span className="flex items-center gap-2 font-semibold">{d.name}
                      {d.identity.length ? <span aria-hidden="true" className="inline-flex"><ManaSymbols cost={d.identity.map((c) => `{${c}}`).join("")} /></span> : null}</span>
                    <span className="text-sm text-(--muted)">{d.commanders.join(" and ")}{d.theme ? ` · ${d.theme}` : ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
