import { Link } from "react-router";
import type { SimilarItem } from "@edh-seer/matcher/similar-shard";

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
];

export function SimilarCards({ items, note }: { items: readonly SimilarItem[]; note?: string }) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-5" aria-labelledby="similar-cards">
      <div className="flex flex-col gap-2 max-w-[68ch]">
        <h2 id="similar-cards" className="t-section">Similar cards</h2>
        <p className="text-(--muted) max-w-[65ch]">
          Similar means it produces the same thing first, then the same trigger, amount and how
          often it happens. Each card says where it differs.{note ? ` ${note}` : ""}
        </p>
      </div>
      <div className="grid gap-x-8 gap-y-5 grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))]">
        {GROUPS.map(({ tier, heading }) => {
          const rows = items.filter((i) => i.tier === tier);
          if (rows.length === 0) return null;
          return (
            <div key={tier} className="flex flex-col gap-2 min-w-0">
              <h3 className="font-semibold">{heading}</h3>
              <ul className="flex flex-col">
                {rows.map((r) => (
                  <li key={r.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-(--separator) py-2 first:border-t-0 min-h-11">
                    <Link to={`/cards/${r.slug}`} className="text-(--accent) hover:underline inline-flex items-center min-h-6 [@media(pointer:coarse)_and_(not_(any-pointer:fine))]:min-h-11">{r.name}</Link>
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
            </div>
          );
        })}
      </div>
    </section>
  );
}
