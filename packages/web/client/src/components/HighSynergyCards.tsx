import type { DeckReport } from "../types.js";
import { CardName, ReasonText } from "./card-drawer.js";
import { distinctiveReason, reasonShapes } from "../lib/reason-shape.js";
import { CATEGORY_LABELS } from "./CardList.js";

const ANCHOR_SHARE = 0.75; // tunable: a card is an "anchor" if its authority ≥ this share of the deck max.

export function HighSynergyCards({ cards }: { cards: DeckReport["cards"] }) {
  const ranked = cards
    .filter((c) => (c.synergyRating ?? 0) > 0)
    .slice()
    .sort((a, b) => (b.synergyRating ?? 0) - (a.synergyRating ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 8);
  if (ranked.length === 0) return null;
  const maxAuthority = cards.reduce((m, c) => Math.max(m, c.authority ?? 0), 0);
  // The same fold the Cards table uses, over the RANKED EIGHT rather than the whole deck: six of
  // these eight rows used to print one sentence with the names swapped.
  const shapes = reasonShapes(ranked);
  const names = new Set(cards.map((c) => c.name));
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">High synergy cards</h3>
      {shapes.shared.map((sh) => (
        <p key={sh.template} className="text-xs text-(--muted) max-w-[65ch]">
          <span className="tabular-nums">{sh.count}</span> of these connect the same way —{" "}
          <span className="text-(--foreground)">{sh.sample}</span>.
        </p>
      ))}
      <ul className="flex flex-col">
        {ranked.map((c) => {
          const topReason = distinctiveReason(c, shapes.shared, names);
          const isAnchor = maxAuthority > 0 && (c.authority ?? 0) >= ANCHOR_SHARE * maxAuthority;
          return (
            <li key={c.name} className="flex items-center gap-3 py-1.5 border-b border-(--separator)">
              <span className="pip shrink-0">{(c.synergyRating ?? 0).toFixed(1)}</span>
              <span className="flex-1 min-w-0">
                <span className="block truncate">
                  <CardName name={c.name} />
                  {/* AN AUTHORED SVG, NEVER A GLYPH. `⚡` is an emoji, which `DESIGN.md` bans as an
                    *  icon outright ("draw a small SVG in one consistent stroke"), and it rendered
                    *  at whatever weight the reader's emoji font chose. */}
                  {isAnchor ? (
                    <span className="ml-2 text-xs text-(--warning) inline-flex items-center gap-1 align-baseline">
                      <svg aria-hidden="true" width="9" height="11" viewBox="0 0 9 11" fill="none"
                        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
                        <path d="M5.2 1 1.4 6.2h2.6L3.8 10l3.8-5.2H5z" />
                      </svg>
                      anchor
                    </span>
                  ) : null}
                  {/* THE FIELD NAME ESCAPED INTO THE SENTENCE. This printed "pulls double duty
                    *  (ramp, targetedRemoval)" — the brief's own "single clearest nobody-read-this-
                    *  out-loud tell" — while the human label for the same value was rendering
                    *  "Removal" in the Cards table on the same screen. One map, one file over. */}
                  {c.doubleDuty ? (
                    <span className="ml-2 text-xs text-(--success)">
                      pulls double duty{c.doubleDutyRoles?.length
                        ? ` (${c.doubleDutyRoles.map((r) => CATEGORY_LABELS[r as keyof typeof CATEGORY_LABELS] ?? r).join(", ")})`
                        : ""}
                    </span>
                  ) : null}
                </span>
                {/* THE SENTENCE IS EVIDENCE ONLY IF ITS NOUNS CAN BE CHECKED (roadmap S18). Both
                  *  names are live now: a card opens its own text in the drawer, and a token says
                  *  it is one and whose. NOT `truncate` any more -- a claim cut off mid-sentence is
                  *  the same unverifiable line, and the row already earns two lines. */}
                {topReason ? (
                  <ReasonText text={topReason} className="block text-xs text-(--muted)" />
                ) : null}
                {/* AND THE SENTENCE IS ONE OF MANY, which is what made three identical lines with
                  *  three different numbers read as a contradiction. Measured on the example deck:
                  *  Protean Thaumaturge, Fear of Sleep Paralysis and Doomwake Giant all print
                  *  "When Mark of the Rani enters, X triggers" and score 4.1 / 3.8 / 3.5. The
                  *  scores are not computed from THIS sentence -- they aggregate every partner --
                  *  and the row never said so.
                  *
                  *  THE COUNT IS NOT OFFERED AS THE EXPLANATION, because it is not one: those three
                  *  cards have 36, 38 and 38 partners, so the number does not order them either.
                  *  What it does is stop the single sentence from reading as the whole case. */}
                {(c.partnerCount ?? 0) > 1 ? (
                  <span className="block text-xs text-(--muted)">
                    one of <span className="stat-num">{c.partnerCount}</span> connections behind this
                    score
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
