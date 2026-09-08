import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { loadCardPage, type CardPageData } from "../lib/partners.js";
import { AbilityTable } from "./AbilityTable.js";
import { CardArt } from "./CardArt.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { usePeek } from "./peek.js";

/** THE PEEK (spec 2026-09-08 part 3). What a partner click shows instead of a new page: the card,
 *  what the engine reads on it, its own first partners, and one control to go there for real.
 *
 *  ON A WIDE VIEWPORT IT IS THE RAIL. `CardShell` renders this where the page's own image sits,
 *  because two cards side by side was measured on the report board as the one-covers-the-other
 *  problem, and the card being looked at is the one that matters while it is open.
 *
 *  ON A PHONE IT IS A SHEET, capped at 60svh, the shape `CardInspector`'s half mode already uses,
 *  with the page behind it locked against scrolling by `html.peek-open` (`index.css`).
 *
 *  `aria-modal="false"`: the list behind stays reachable on a wide viewport, which is the point.
 *  Focus goes to Close on open and back to the opening row on close (`usePeekState`). */
const PEEK_PARTNERS = 5;

export function CardPeek({ load }: { load?: (slug: string) => Promise<CardPageData | null> }) {
  const peek = usePeek();
  const slug = peek?.stack.at(-1);
  const [page, setPage] = useState<CardPageData | null | undefined>(undefined);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!slug) return;
    let live = true;
    setPage(undefined);
    void (load ? load(slug) : loadCardPage(slug, "/static")).then((p) => { if (live) setPage(p); });
    return () => { live = false; };
  }, [slug, load]);

  useEffect(() => {
    if (!slug) return;
    document.documentElement.classList.add("peek-open");
    closeButton.current?.focus();
    return () => { document.documentElement.classList.remove("peek-open"); };
  }, [slug]);

  if (!peek || !slug) return null;
  const deeper = peek.stack.length > 1;

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="peek-title"
      className="peek"
      onKeyDown={(ev) => { if (ev.key === "Escape") { ev.stopPropagation(); peek.close(); } }}
    >
      <div className="peek-bar">
        {deeper && <button type="button" className="peek-btn" onClick={() => peek.back()}>Back</button>}
        <button ref={closeButton} type="button" className="peek-btn ml-auto" onClick={() => peek.close()}>Close</button>
      </div>
      {page === undefined && <p id="peek-title" className="eyebrow text-(--muted)">reading the corpus</p>}
      {page === null && (
        <p id="peek-title" className="text-(--muted)">This card is not in the corpus the engine has read.</p>
      )}
      {page && (
        <div className="peek-body">
          <div className="peek-art">
            <CardArt artCrop={page.artCrop} backArtCrop={page.backArtCrop} name={page.name} />
          </div>
          <h3 className="text-xl font-bold tracking-[-0.01em] flex flex-wrap items-baseline gap-x-3">
            {/* The dialog's name is the card's name alone: the mana symbols carry their own label
              *  and would otherwise be read as part of it. */}
            <span id="peek-title">{page.name}</span>
            {page.manaCost && <span className="text-base"><ManaSymbols cost={page.manaCost} /></span>}
          </h3>
          <p className="text-(--muted) text-sm">{page.typeLine}</p>
          <div className="flex flex-col gap-2">
            <h4 className="eyebrow text-(--muted)">how the engine reads this card</h4>
            <AbilityTable rows={page.abilities} stacked />
          </div>
          {page.partners.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="eyebrow text-(--muted)">its own first partners</h4>
              <ul className="flex flex-col">
                {page.partners.slice(0, PEEK_PARTNERS).map((p) => (
                  <li key={p.slug} className="border-t border-(--separator) py-2 first:border-t-0 first:pt-0 flex flex-col gap-0.5">
                    {/* A BUTTON, NOT A LINK: inside the peek a name looks further. The full page is
                      *  one click away on the primary control below. */}
                    <button
                      type="button"
                      className="self-start min-h-11 text-left font-semibold text-(--accent) hover:underline underline-offset-2"
                      onClick={(ev) => peek.push(p.slug, ev.currentTarget)}
                    >
                      {p.name}
                    </button>
                    <p className="text-(--muted) text-sm">{p.payoff ?? p.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link
            className="inline-flex items-center justify-center min-h-11 rounded-(--radius) border border-(--accent) px-4 text-(--accent) hover:bg-(--surface-secondary)"
            to={`/cards/${slug}`}
            onClick={() => peek.close()}
          >
            Open {page.name}
          </Link>
        </div>
      )}
    </section>
  );
}
