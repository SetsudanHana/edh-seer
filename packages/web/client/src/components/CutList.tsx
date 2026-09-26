import { useState } from "react";
import type { DeckReport } from "../types.js";
import { BUILD_CATEGORY_LABEL } from "../lib/build-category-labels.js";
import type { CutChoice } from "../lib/cut-choice.js";
import { listNames } from "../lib/engine-model.js";
import { CardName, ReasonText } from "./card-drawer.js";
import { Badge, CardFace, ReadCards } from "./engine-parts.js";

/** THE CUT LIST — "which cards is the deck not using?" — and the deck-level slack beside it.
 *
 *  Every row states its own argument, because the engine's three failure directions all point the
 *  same way: a relation it cannot express looks exactly like a card doing nothing (see matcher's
 *  `cut-list.ts`). The caption is not decoration — it is the difference between a tool that helps
 *  and one that confidently deletes a player's best card. */
export function CutList({ cuts, unjudged, coverage, slack, trim, offTheme }:
  {
    /** The one cut list: the report's eligibility, the Overview's reading. See `chooseCuts`. */
    cuts: readonly CutChoice[];
    /** Cards the engine REFUSED to judge because it never read them. See `report.unjudged`. */
    unjudged?: DeckReport["unjudged"];
    /** Only to say "12 OF THE 48". The tuner persona asked outright why twelve, when the gate at the
     *  top of the page says forty-eight are unread (2026-08-27) — both lists are about the same
     *  unread set, and this one is the subset that would OTHERWISE have been cut candidates. A
     *  number without its denominator invites exactly that question. */
    coverage?: DeckReport["coverage"];
    slack: DeckReport["slack"];
    trim?: DeckReport["trim"];
    /** Read cards that no theme group claims and that are not already cut candidates. */
    offTheme?: readonly string[];
  }) {
  // TRIM MODE is opt-in and client-side. The server ships the WHOLE ranked order, so changing N is
  // a slice and never a round trip; and it stays behind a click because a list that always has an
  // answer reads as a verdict when nobody asked for it.
  const [trimN, setTrimN] = useState(0);
  const [cutN, setCutN] = useState(CUT_STEP);
  const hasTrim = !!trim && trim.length > 0;
  const hasCuts = cuts.length > 0;
  const hasUnjudged = !!unjudged && unjudged.length > 0;
  const hasSlack = !!slack && slack.length > 0;
  const hasOffTheme = !!offTheme && offTheme.length > 0;
  if (!hasCuts && !hasSlack && !hasTrim && !hasUnjudged && !hasOffTheme) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Possible cuts</h3>
      {hasCuts && (
        <>
          <p className="text-sm text-(--muted) max-w-[65ch]">
            The cards doing the least here, weakest first: they keep working with the fewest others.
            A card that fills a role, is a theme&apos;s key card or is half of a combo is never listed.
            Suggestions, not verdicts: a synergy we can&apos;t read looks exactly like one that isn&apos;t there.
          </p>
          <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,25rem),1fr))]">
            {cuts.slice(0, cutN).map((c) => <CutCard key={c.name} c={c} />)}
          </ul>
          {cuts.length > cutN ? (
            <p>
              <button type="button" className="min-h-11 rounded-(--radius) border border-(--separator) px-4 text-sm" onClick={() => setCutN(cutN + CUT_STEP)}>
                Show {Math.min(CUT_STEP, cuts.length - cutN)} more
              </button>
            </p>
          ) : null}
        </>
      )}
      {/* OFF-THEME, NOT DEAD (owner, 2026-09-24). These connect to something or fill a role, so they
        *  are not cut candidates -- but no theme uses them, which is the second place a player looks
        *  for a slot. Said with the usual exception, because removal routinely lands here. */}
      {hasOffTheme && (
        <p className="text-sm text-(--muted) max-w-[65ch]">
          <span className="text-(--foreground)">Fits no theme:</span>{" "}
          {offTheme!.map((n, i) => (
            <span key={n}>{i > 0 && ", "}<CardName name={n} /></span>
          ))}
          . None of your themes use {offTheme!.length === 1 ? "it" : "these"}. That&apos;s normal for
          removal and protection, which do their job on their own; otherwise this is the next place to
          look for a slot.
        </p>
      )}
      {/* AN EMPTY CUT LIST IS AN ANSWER AND HAS TO SAY SO. It used to render nothing at all, which
        *  reads as a missing panel rather than as "nothing here is dead weight" — and once the
        *  underived gate landed this became the COMMON case on a partly-read deck. */}
      {!hasCuts && (hasUnjudged || hasTrim) ? (
        <div className="rounded-(--radius) border border-dashed border-(--separator) px-4 py-5 text-center">
          <p className="text-sm">Nothing here is an easy cut.</p>
          <p className="text-xs text-(--muted) mt-1">
            Every card the engine could read fills a role, is a theme&apos;s key card or is half of a combo
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
            <span className="text-sm text-(--muted)">Over 99? Trim</span>
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
                    <p className="text-xs text-(--muted)">{t.reasons.filter((r) => !/^doesn't fill a core role/.test(r)).join(" \u00b7 ")}</p>
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
            You run more of these than the target. Which card goes is your call: we don&apos;t rank
            the cards inside a role against each other.
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

/** Rows shown before "Show N more": the Overview's six, which every seat read to the end. */
const CUT_STEP = 6;

/** One cut: the card, why it is here, what argues it stays, and its text one tap away. */
function CutCard({ c }: { c: CutChoice }) {
  const r = c.row;
  const short = c.name.split(" // ")[0]!;
  return (
    <li className="flex items-start gap-3 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm">
      {c.card ? <CardFace card={c.card} className="w-20 sm:w-24" /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <h4 className="flex items-baseline justify-between gap-3 text-base font-semibold">
            <CardName name={c.name} />
            <span className="shrink-0 text-xs font-normal stat-num text-(--muted)">{c.manaValue} mana</span>
          </h4>
          <p>{r ? r.why : `${capitalFirst(c.reasons.join("; "))}.`}</p>
          {c.unmet.map((u) => <p key={u} className="text-(--muted)">{capitalFirst(u)}.</p>)}
        </div>
        {r?.keep && r.keepActs ? (
          <p className="text-(--muted)"><span className="eyebrow block">Its strongest link</span><Badge repeat={r.keep.repeat} /><ReasonText text={r.keep.text} /></p>
        ) : r?.keep && r.fedBy.length ? (
          // A FEEDER NAMES WHO USES IT: the line other cards get from it is true of any card of its
          // kind, so it is not this card's strongest link (Overview round 7).
          <p className="text-(--muted)">
            <span className="eyebrow block">Who uses it</span>
            {listNames(r.fedBy, 3)}. None of the links found here use its own abilities.
          </p>
        ) : null}
        {c.keeps.length ? (
          <p><span className="font-medium text-(--success)">Keeps it:</span> {c.keeps.join(" · ")}</p>
        ) : null}
        {c.twins.length ? (
          <p className="text-(--muted)">
            <span className="eyebrow block">Used by exactly the same cards</span>
            {listNames(c.twins)} {c.twins.length === 1 ? "is" : "are"} used by the same cards as {short}, so here {c.twins.length === 1 ? "either can" : "any of them can"} stand in for another: cutting one leaves the rest doing the same job.
          </p>
        ) : null}
        {c.card ? <ReadCards cards={[c.card]} /> : null}
      </div>
    </li>
  );
}

const capitalFirst = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);
