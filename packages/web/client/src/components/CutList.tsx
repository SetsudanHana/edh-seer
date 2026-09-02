import { useState } from "react";
import type { DeckReport } from "../types.js";
import { BUILD_CATEGORY_LABEL } from "../lib/build-category-labels.js";
import { CardName } from "./card-drawer.js";

/** THE CUT LIST — "which cards is the deck not using?" — and the deck-level slack beside it.
 *
 *  Every row states its own argument, because the engine's three failure directions all point the
 *  same way: a relation it cannot express looks exactly like a card doing nothing (see matcher's
 *  `cut-list.ts`). The caption is not decoration — it is the difference between a tool that helps
 *  and one that confidently deletes a player's best card. */
export function CutList({ cutList, unjudged, coverage, slack, trim }:
  {
    cutList: DeckReport["cutList"];
    /** Cards the engine REFUSED to judge because it never read them. See `report.unjudged`. */
    unjudged?: DeckReport["unjudged"];
    /** Only to say "12 OF THE 48". The tuner persona asked outright why twelve, when the gate at the
     *  top of the page says forty-eight are unread (2026-08-27) — both lists are about the same
     *  unread set, and this one is the subset that would OTHERWISE have been cut candidates. A
     *  number without its denominator invites exactly that question. */
    coverage?: DeckReport["coverage"];
    slack: DeckReport["slack"];
    trim?: DeckReport["trim"];
  }) {
  // TRIM MODE is opt-in and client-side. The server ships the WHOLE ranked order, so changing N is
  // a slice and never a round trip; and it stays behind a click because a list that always has an
  // answer reads as a verdict when nobody asked for it.
  const [trimN, setTrimN] = useState(0);
  const hasTrim = !!trim && trim.length > 0;
  const hasCuts = !!cutList && cutList.length > 0;
  const hasUnjudged = !!unjudged && unjudged.length > 0;
  const hasSlack = !!slack && slack.length > 0;
  if (!hasCuts && !hasSlack && !hasTrim && !hasUnjudged) return null;
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
                  <span className="text-xs stat-num text-(--muted)">
                    {c.manaValue} mana · {c.rating.toFixed(1)}
                  </span>
                </div>
                <p className="text-xs text-(--muted)">{c.reasons.join(" · ")}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      {/* AN EMPTY CUT LIST IS AN ANSWER AND HAS TO SAY SO. It used to render nothing at all, which
        *  reads as a missing panel rather than as "nothing here is dead weight" — and once the
        *  underived gate landed this became the COMMON case on a partly-read deck. */}
      {!hasCuts && (hasUnjudged || hasTrim) ? (
        <div className="rounded-(--radius) border border-dashed border-(--separator) px-4 py-5 text-center">
          <p className="text-sm">No card here is unconnected.</p>
          <p className="text-xs text-(--muted) mt-1">
            Every card the engine could read has at least one connection or fills a role it is measured on
            {/* AND THE TRIM CONTROL BELOW IS NOT A CONTRADICTION OF THAT (S16, 2026-09-02). The
              *  panel used to say "Nothing here is safe to call dead weight" directly above a
              *  `Trim 3 5 10` control and three over-quota chips; both a tuner and a beginner
              *  stopped on the pair, and it was the tuner's whole job ("stopped my job"). They
              *  answer DIFFERENT questions -- this list ranks by CONNECTION, trim ranks by
              *  category SURPLUS -- and saying so is the whole fix. */}
            {hasTrim ? <> — so the trim list below ranks by which category is
              <span className="text-(--foreground)"> over its target</span>, not by which card is weak</> : null}.
          </p>
        </div>
      ) : null}
      {/* THE REFUSAL, NAMED. Measured 2026-08-27 on a real precon: 12 of 12 shipped cut candidates
        *  were cards the engine had never read, so every row of that list was the corpus's own gap
        *  wearing a dead card's clothes. The gate now removes them — and removing them SILENTLY
        *  would tell the reader less than this does, because these really are the cards a player is
        *  eyeing. They arrive with the correct sentence attached instead of the wrong one. */}
      {hasUnjudged && (
        <div className="flex gap-3 items-start rounded-(--radius) border border-dashed border-(--separator) px-3 py-2.5">
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor"
            strokeWidth="1.5" className="text-(--warning) shrink-0 mt-0.5">
            <path d="M1.6 12.4h11.8L7.5 2.1z" /><path d="M7.5 6.2v3" />
            <circle cx="7.5" cy="10.9" r=".7" fill="currentColor" stroke="none" />
          </svg>
          <p className="text-xs text-(--muted)">
            <span className="text-(--foreground)">
              {unjudged!.length}{coverage ? ` of the ${coverage.resolved - coverage.derived} unread` : ""}{" "}
              {unjudged!.length === 1 ? "card looks" : "cards look"} unconnected and{" "}
              {unjudged!.length === 1 ? "is" : "are"} not judged.
            </span>{" "}
            {unjudged!.map((n, i) => (
              <span key={n}>{i > 0 && ", "}<CardName name={n} /></span>
            ))}
            {" "}— the engine has not read {unjudged!.length === 1 ? "it" : "them"} yet.
            &ldquo;Nothing connects to it&rdquo; and &ldquo;we could not read it&rdquo; are different
            sentences, and only the first is a reason to cut.
            {coverage ? " The rest of the unread fill a role, or are lands, so they were never cut candidates anyway." : ""}
          </p>
        </div>
      )}
      {hasTrim && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-sm text-(--muted)">Over on cards? Trim</span>
            {[3, 5, 10].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={trimN === n}
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
                      <span className="text-xs stat-num text-(--muted)">
                        {t.manaValue} mana &middot; {t.rating.toFixed(1)}
                      </span>
                    </div>
                    <p className="text-xs text-(--muted)">{t.reasons.join(" \u00b7 ")}</p>
                    {/* THE KEEP SIDE IS NOT FINE PRINT. A row that says "fills none of the roles"
                      *  above "its best edge is on your main theme" is arguing with itself, and the
                      *  second line is the one that decides — so it reads at the page's normal
                      *  weight with a success-toned label, not as a footnote to the cut. */}
                    <p className="text-xs">
                      <span className="font-medium text-(--success)">keeps it:</span>{" "}
                      <span className={t.protections.length > 0 ? "text-(--foreground)" : "text-(--muted)"}>
                        {t.protections.length > 0 ? t.protections.join(" \u00b7 ") : "\u2014 nothing"}
                      </span>
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
            You carry more of these than the Command Zone template asks for. The category, never a
            card &mdash; nothing here ranks two ramp cards against each other.
          </p>
          <ul className="flex flex-wrap gap-2">
            {slack!.map((s) => (
              <li key={s.category} className="text-sm rounded-full border border-(--separator) px-3 py-1 text-(--muted)">
                {BUILD_CATEGORY_LABEL[s.category] ?? s.category}{" "}
                <span className="stat-num">{s.count}/{s.target} (+{s.over})</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
