import { useState } from "react";
import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";

/** THE CUT LIST — "which cards is the deck not using?" — and the deck-level slack beside it.
 *
 *  Every row states its own argument, because the engine's three failure directions all point the
 *  same way: a relation it cannot express looks exactly like a card doing nothing (see matcher's
 *  `cut-list.ts`). The caption is not decoration — it is the difference between a tool that helps
 *  and one that confidently deletes a player's best card. */
export function CutList({ cutList, slack, trim }:
  { cutList: DeckReport["cutList"]; slack: DeckReport["slack"]; trim?: DeckReport["trim"] }) {
  // TRIM MODE is opt-in and client-side. The server ships the WHOLE ranked order, so changing N is
  // a slice and never a round trip; and it stays behind a click because a list that always has an
  // answer reads as a verdict when nobody asked for it.
  const [trimN, setTrimN] = useState(0);
  const hasTrim = !!trim && trim.length > 0;
  const hasCuts = !!cutList && cutList.length > 0;
  const hasSlack = !!slack && slack.length > 0;
  if (!hasCuts && !hasSlack && !hasTrim) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Where the room is</h3>
      {hasCuts && (
        <>
          <p className="text-sm text-(--muted)">
            Cards nothing in the deck connects to, that sit off your main theme and fill no role the deck is
            measured on. Candidates, not a verdict — a synergy the engine can&apos;t read looks the same as
            one that isn&apos;t there.
          </p>
          <ul className="flex flex-col gap-2">
            {cutList!.map((c) => (
              <li key={c.name} className="rounded-lg border border-(--separator) px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm"><CardName name={c.name} /></span>
                  {/* Cost beside the rating, because two cards nothing connects to are different
                    *  cut candidates when one costs 9 and the other 1. It breaks ties in the
                    *  ordering and is never a reason a card appears here at all. */}
                  <span className="text-xs font-mono text-(--muted)">
                    {c.manaValue} mana · {c.rating.toFixed(1)}
                  </span>
                </div>
                <p className="text-xs text-(--muted)">{c.reasons.join(" · ")}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      {hasTrim && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-sm text-(--muted)">Over on cards? Trim</span>
            {[3, 5, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTrimN(trimN === n ? 0 : n)}
                className={`text-xs rounded-full border px-3 py-1 ${
                  trimN === n ? "border-(--accent) text-(--accent)" : "border-(--separator) text-(--muted)"}`}
              >
                {n}
              </button>
            ))}
          </div>
          {trimN > 0 && (
            <>
              <p className="text-sm text-(--muted)">
                Weakest first, with what argues each one STAYS. Rows tied on every measured axis are ordered by
                name &mdash; nothing here ranks two ramp cards against each other.
              </p>
              <ul className="flex flex-col gap-2">
                {trim!.slice(0, trimN).map((t) => (
                  <li key={t.name} className="rounded-lg border border-(--separator) px-3 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm"><CardName name={t.name} /></span>
                      <span className="text-xs font-mono text-(--muted)">
                        {t.manaValue} mana &middot; {t.rating.toFixed(1)}
                      </span>
                    </div>
                    <p className="text-xs text-(--muted)">{t.reasons.join(" \u00b7 ")}</p>
                    <p className="text-xs text-(--muted)">
                      <span className="font-medium">keeps it:</span>{" "}
                      {t.protections.length > 0 ? t.protections.join(" \u00b7 ") : "\u2014 nothing"}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {hasSlack && (
        <>
          <p className="text-sm text-(--muted)">
            You carry more of these than the Command Zone template&rsquo;s floor &mdash; a deckbuilding convention
            someone typed, not a number measured from any deck. The category, never a card &mdash; nothing here
            ranks two ramp cards against each other.
          </p>
          <ul className="flex flex-wrap gap-2">
            {slack!.map((s) => (
              <li key={s.category} className="text-sm rounded-full border border-(--separator) px-3 py-1 text-(--muted)">
                {s.category} {s.count}/{s.target} <span className="text-(--muted)">(+{s.over})</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
