import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Chevron } from "./icons.js";
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
  { tier: "outcome", heading: "Same payoff, different trigger" },
];

/** A row as this list draws it. The redundancy search (#1342) reuses the list: its rows may lack a page
 *  (`slug` absent: a name, no link) and carry what they mean for THIS deck (`deckChips`). */
export type SimilarRow = Omit<SimilarItem, "slug"> & { slug?: string; deckChips?: readonly DeckChip[];
  /** How many of the seed's deck partners this card also works with, of how many. Absent: no figure. */
  shared?: { n: number; of: number } };

/** `level` 3 puts the section under a heading of its own (the card drawer); the tiers go one below it. */
export function SimilarCards({ items, note, title = "Similar cards", id = "similar-cards", intro, empty, fold, deckView = false, level = 2, titleClass = "t-section", tierClass = "t-subsection" }: {
  items: readonly SimilarRow[]; note?: string;
  title?: string; id?: string;
  /** Replaces the default sentence under the title. */
  intro?: ReactNode;
  /** Said when there are no rows. Without it an empty list renders nothing at all. */
  empty?: string;
  /** Show this many rows of a tier, the rest behind "Show N more". */
  fold?: number;
  /** The redundancy drawer's reading of `deckChips`: facts as text and a figure, a count in each tier heading. */
  deckView?: boolean;
  /** The title's heading level; the tiers sit one below. */
  level?: 2 | 3 | 4;
  /** The type styles of the title and the tier headings; the page's by default, the drawer's own in the drawer. */
  titleClass?: string; tierClass?: string;
}) {
  const [opened, setOpened] = useState<ReadonlySet<SimilarItem["tier"]>>(new Set());
  const list = useRef<HTMLElement>(null);
  // After "Show N more" focus goes to the first row it revealed, or a keyboard reader is left on a button that is gone.
  const revealed = useRef<SimilarItem["tier"] | null>(null);
  useEffect(() => {
    if (!revealed.current || fold === undefined) return;
    list.current?.querySelector<HTMLElement>(`[data-tier="${revealed.current}"] li:nth-child(${fold + 1}) a`)?.focus();
    revealed.current = null;
  }, [opened, fold]);
  if (items.length === 0 && !empty) return null;
  const Head = `h${level}` as "h2", Sub = `h${level + 1}` as "h3";
  return (
    <section ref={list} className="flex flex-col gap-5" aria-labelledby={id}>
      <div className="flex flex-col gap-2 max-w-[68ch]">
        <Head id={id} className={titleClass} tabIndex={level === 2 ? undefined : -1}>{title}</Head>
        <p className="text-(--muted) max-w-[65ch]">
          {items.length === 0 ? empty : intro ?? <>
            Similar means it does the same thing first, then the same trigger, amount and how
            often it happens. Each card says where it differs.{note ? ` ${note}` : ""}
          </>}
        </p>
        {items.some((i) => i.slug !== undefined) && (
          <p className="text-(--muted) max-w-[65ch]">Right-click or long-press a linked name for its menu: open its card page or copy the name.</p>
        )}
      </div>
      <div className="grid gap-x-8 gap-y-5 grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))]">
        {GROUPS.map(({ tier, heading }) => {
          const rows = items.filter((i) => i.tier === tier);
          if (rows.length === 0) return null;
          const figures = deckView ? rows.map((r) => r.shared ?? null) : [];
          const same = figures.length > 1 && figures.every((f) => f && f.n === figures[0]!.n && f.of === figures[0]!.of);
          const folded = fold !== undefined && rows.length > fold && !opened.has(tier);
          return (
            <div key={tier} data-tier={tier} className="flex flex-col gap-2 min-w-0">
              <Sub className={tierClass}>{heading}{deckView ? ` · ${rows.length}` : ""}{same ? ` · all work with ${figures[0]!.n} of ${figures[0]!.of}` : ""}</Sub>
              <ul className="grid gap-x-8 grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))]">
                {(folded ? rows.slice(0, fold) : rows).map((r) => (
                  <li key={r.slug ?? r.name} className="flex flex-wrap items-center content-center gap-x-3 gap-y-1 border-b border-(--separator) py-2 min-h-11">
                    {r.slug !== undefined
                      ? <Link to={`/cards/${r.slug}`} data-card={r.name} data-card-slug={r.slug} className="text-(--accent) hover:underline inline-flex items-center min-h-6 [@media(pointer:coarse)_and_(not_(any-pointer:fine))]:min-h-11">{r.name}</Link>
                      : <span>{r.name}</span>}
                    {deckView ? <DeckFacts row={r} figure={same ? null : r.shared ?? null} /> : null}
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
                <button type="button" className="self-start inline-flex items-center gap-1.5 min-h-6 rounded-(--radius) border border-(--separator) px-2 py-0.5 text-sm text-(--muted) hover:text-(--foreground)"
                  onClick={() => { revealed.current = tier; setOpened(new Set([...opened, tier])); }}>
                  Show {rows.length - (fold ?? 0)} more <Chevron dir="down" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** WHAT THE ROW MEANS FOR THIS DECK, as the drawer reads it: "in your deck" is a plain fact, the partner count a right-hand figure (said in
 *  words for a screen reader), and an amplifier a warning in chip shape. None of these is a control, so none looks like one. */
function DeckFacts({ row, figure }: { row: SimilarRow; figure: { n: number; of: number } | null }) {
  const chips = row.deckChips ?? [];
  return (
    <>
      {chips.filter((c) => c.dim === "deck").map((c, i) => <span key={`d${i}`} className="text-sm text-(--muted)">{c.label}</span>)}
      {chips.filter((c) => c.dim === "amplifier").map((c, i) => (
        <span key={`a${i}`} className="border border-(--separator) text-(--warning) text-sm rounded-(--radius) px-2 py-0.5 leading-tight">{c.label}</span>
      ))}
      {figure ? (
        <span className="ml-auto text-sm tabular-nums text-(--muted)">
          <span aria-hidden="true">{figure.n}/{figure.of}</span>
          <span className="sr-only">works with {figure.n} of {figure.of} of the same deck cards</span>
        </span>
      ) : null}
    </>
  );
}
