import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";

const ANCHOR_SHARE = 0.75; // tunable: a card is an "anchor" if its authority ≥ this share of the deck max.

export function HighSynergyCards({ cards }: { cards: DeckReport["cards"] }) {
  const ranked = cards
    .filter((c) => (c.synergyRating ?? 0) > 0)
    .slice()
    .sort((a, b) => (b.synergyRating ?? 0) - (a.synergyRating ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 8);
  if (ranked.length === 0) return null;
  const maxAuthority = cards.reduce((m, c) => Math.max(m, c.authority ?? 0), 0);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">High synergy cards</h3>
      <ul className="flex flex-col">
        {ranked.map((c) => {
          const topReason = c.topPartners?.[0]?.reasons?.[0]?.text;
          const isAnchor = maxAuthority > 0 && (c.authority ?? 0) >= ANCHOR_SHARE * maxAuthority;
          return (
            <li key={c.name} className="flex items-center gap-3 py-1.5 border-b border-(--separator)">
              <span className="pip shrink-0 tabular-nums">{(c.synergyRating ?? 0).toFixed(1)}</span>
              <span className="flex-1 min-w-0">
                <span className="block truncate">
                  <CardName name={c.name} />
                  {isAnchor ? <span className="ml-2 text-xs text-(--warning)">⚡ anchor</span> : null}
                  {c.doubleDuty ? (
                    <span className="ml-2 text-xs text-(--success)">
                      pulls double duty{c.doubleDutyRoles?.length ? ` (${c.doubleDutyRoles.join(", ")})` : ""}
                    </span>
                  ) : null}
                </span>
                {topReason ? <span className="block text-xs text-(--muted) truncate">{topReason}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
