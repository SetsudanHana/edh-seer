import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { SimilarItem } from "@edh-seer/matcher/similar-shard";
import type { DeckChip } from "@edh-seer/matcher/redundancy";

/** SIMILAR CARDS (#1341): the cards whose effect reads like this one's, grouped by how close.
 *
 *  Three groups, plain English, in this order because closeness is the point of the section.
 *  NO PERCENTAGES: rank decides the order and the row says in words how it differs. An empty list
 *  renders nothing at all -- a card the engine does not read as an output (Sol Ring, a plain
 *  lifelink creature) has no honest "similar" and an empty heading would read as the tool failing. */
const GROUPS: { tier: SimilarItem["tier"]; heading: string }[] = [
  { tier: "same", heading: "Same effect" },
  { tier: "close", heading: "Close variants" },
  { tier: "output", heading: "Same result, different trigger" },
  { tier: "outcome", heading: "Same outcome, different event" },
];

/** A row as this list draws it. The redundancy search (#1342) reuses the list: its rows may lack a page
 *  (`slug` absent: a name, no link) and carry what they mean for THIS deck (`deckChips`). */
export type SimilarRow = Omit<SimilarItem, "slug"> & { slug?: string; deckChips?: readonly DeckChip[] };

/** `level` 3 puts the section under a heading of its own (the card drawer); the tiers go one below it. */
export function SimilarCards({ items, note, title = "Similar cards", id = "similar-cards", intro, empty, fold, level = 2 }: {
  items: readonly SimilarRow[]; note?: string;
  title?: string; id?: string;
  /** Replaces the default sentence under the title. */
  intro?: ReactNode;
  /** Said when there are no rows. Without it an empty list renders nothing at all. */
  empty?: string;
  /** Show this many rows of a tier, the rest behind "Show N more". */
  fold?: number;
  level?: 2 | 3;
}) {
  const [opened, setOpened] = useState<ReadonlySet<SimilarItem["tier"]>>(new Set());
  if (items.length === 0 && !empty) return null;
  const Head = level === 3 ? "h3" : "h2", Sub = level === 3 ? "h4" : "h3";
  return (
    <section className="flex flex-col gap-5" aria-labelledby={id}>
      <div className="flex flex-col gap-2 max-w-[68ch]">
        <Head id={id} className="t-section">{title}</Head>
        <p className="text-(--muted) max-w-[65ch]">
          {items.length === 0 ? empty : intro ?? <>
            Similar means it produces the same thing first, then the same trigger, amount and how
            often it happens. Each card says where it differs.{note ? ` ${note}` : ""}
          </>}
        </p>
      </div>
      <div className="grid gap-x-8 gap-y-5 grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))]">
        {GROUPS.map(({ tier, heading }) => {
          const rows = items.filter((i) => i.tier === tier);
          if (rows.length === 0) return null;
          const folded = fold !== undefined && rows.length > fold && !opened.has(tier);
          return (
            <div key={tier} className="flex flex-col gap-2 min-w-0">
              <Sub className="t-subsection">{heading}</Sub>
              <ul className="flex flex-col">
                {(folded ? rows.slice(0, fold) : rows).map((r) => (
                  <li key={r.slug ?? r.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-(--separator) py-2 first:border-t-0 min-h-11">
                    {r.slug !== undefined
                      ? <Link to={`/cards/${r.slug}`} className="text-(--accent) hover:underline inline-flex items-center min-h-6 [@media(pointer:coarse)_and_(not_(any-pointer:fine))]:min-h-11">{r.name}</Link>
                      : <span>{r.name}</span>}
                    {r.deckChips && r.deckChips.length > 0 && (
                      <span className="flex flex-wrap items-center gap-1.5 text-sm">
                        {r.deckChips.map((c, i) => (
                          <span key={i} className="border border-(--accent) rounded-(--radius) px-2 py-0.5 leading-tight">{c.label}</span>
                        ))}
                      </span>
                    )}
                    {r.chips.length > 0 && (
                      <span className="flex flex-wrap items-center gap-1.5 text-sm text-(--muted)">
                        <span>differs by</span>
                        {r.chips.map((c, i) => (
                          <span key={i} className="border border-(--separator) rounded-(--radius) px-2 py-0.5 leading-tight">{c.label}</span>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {folded && (
                <button type="button" className="btn-secondary self-start" onClick={() => setOpened(new Set([...opened, tier]))}>
                  Show {rows.length - (fold ?? 0)} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
