import { useState } from "react";
import type { DeckReport } from "../types.js";
import { BUILD_CATEGORY_LABEL } from "../lib/build-category-labels.js";
import type { CutChoice } from "../lib/cut-choice.js";
import { listNames, type EngineCard } from "../lib/engine-model.js";
import { CardName, ReasonText } from "./card-drawer.js";
import { CardMenuButton } from "./card-menu.js";
import { Badge, CardFace, ReadCards } from "./engine-parts.js";
import type { SuggestedPair } from "@edh-seer/matcher/suggest-static";
import { SwapLine } from "./SuggestedPairs.js";

/** THE CUT LIST — "which cards is the deck not using?" — and the deck-level slack beside it.
 *
 *  Every row states its own argument, because the engine's three failure directions all point the
 *  same way: a relation it cannot express looks exactly like a card doing nothing (see matcher's
 *  `cut-list.ts`). The caption is not decoration — it is the difference between a tool that helps
 *  and one that confidently deletes a player's best card. */
/** A role group over its target, with the cards in it: where the rest of a trim comes from. */
export interface Surplus { name: string; count: number; target: number; over: number; cards: EngineCard[] }

export function CutList({ cuts, unjudged, coverage, slack, offTheme, surplus, pairs, deckSize }:
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
    /** Read cards that no theme group claims and that are not already cut candidates. */
    offTheme?: readonly string[];
    /** The over-target role groups with their cards. Replaces the bare slack chips where present. */
    surplus?: readonly Surplus[];
    /** The card that could take each cut's slot, by cut name. Shown on the cut's own card. */
    pairs?: readonly SuggestedPair[];
    /** Cards in the list, commander included and companion not: over 100, the cuts reach 100. */
    deckSize?: number;
  }) {
  const [maybeN, setMaybeN] = useState(MAYBE_STEP);
  // TWO KINDS OF CUT, SAID APART (appeal review 2026-09-26). One list headed "weakest first" whose
  // first row carried a green "Keeps it:" read as the list arguing with itself on three seats. A
  // card nothing argues for is a cut; a card with a reason to stay is a trade-off, and says so.
  const clear = cuts.filter((c) => c.keeps.length === 0);
  const maybe = cuts.filter((c) => c.keeps.length > 0);
  // OVER 100, THE CUTS ARE THE PLAN (baseline round 2026-09-26). The first-deck seat, 8 over, got 7
  // names, 2 more behind a button, and "Trim 3 5 10", which skips 8. Now the list leads with exactly
  // as many cuts as the deck is over, weakest first (nothing-argues-for-it first, then trade-offs),
  // and says how many are still to find when the list runs short. The trim order is not used for
  // this: it ranks every card, and on that deck its fifth and eighth were Sol Ring and Arcane Signet.
  const over = deckSize !== undefined ? Math.max(0, deckSize - 100) : 0;
  const ordered = [...clear, ...maybe];
  const toCut = over ? ordered.slice(0, over) : [];
  const spare = over ? ordered.slice(over) : [];
  const pairOf = new Map((pairs ?? []).map((p) => [p.cut, p] as const));
  // A deck that is over needs cards out, not swaps; the swaps are for a deck at its size.
  const swapFor = (c: CutChoice) => (over ? undefined : pairOf.get(c.name));
  // SWAPS FOR ROLE CARDS, which the cut list never offers (see `swapCandidates`): the role stays
  // filled, by a card that works with more of the deck.
  const listed = new Set(cuts.map((c) => c.name));
  const roleSwaps = over ? [] : (pairs ?? []).filter((p) => !listed.has(p.cut));
  const hasSurplus = !!surplus && surplus.length > 0;
  const hasCuts = cuts.length > 0;
  const hasUnjudged = !!unjudged && unjudged.length > 0;
  const hasSlack = !!slack && slack.length > 0;
  const hasOffTheme = !!offTheme && offTheme.length > 0;
  if (!hasCuts && !hasSlack && !hasUnjudged && !hasOffTheme && !over) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Possible cuts</h3>
      {over ? (
        <section aria-labelledby="cuts-over" className="flex flex-col gap-2">
          <p id="cuts-over" className="text-sm max-w-[65ch]" data-testid="cuts-over">
            Your list has <b className="tabular-nums">{deckSize}</b> cards, <b className="tabular-nums">{over}</b> over 100.{" "}
            {toCut.length === over
              ? <>These {over} are doing the least here, weakest first: take them out and it is 100.</>
              : toCut.length
                ? <>These {toCut.length} are doing the least here. The other {over - toCut.length} have to come from a role you run more of than you need, below, or from the cards you like least.</>
                : <>Every card here fills a role or works with your themes, so the {over} have to come from a role you run more of than you need, below, or from the cards you like least.</>}
          </p>
          {toCut.length ? (
            <ol className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,25rem),1fr))]">
              {toCut.map((c) => <CutCard key={c.name} c={c} />)}
            </ol>
          ) : null}
          {spare.length ? (
            <p className="text-sm text-(--muted) max-w-[65ch]">
              <span className="text-(--foreground)">If you would rather keep one of these,</span> the next weakest{" "}
              {spare.length === 1 ? "is" : "are"}{" "}
              {spare.map((c, i) => <span key={c.name}>{i > 0 ? ", " : ""}<CardName name={c.name} /></span>)}.
            </p>
          ) : null}
        </section>
      ) : hasCuts && (
        <>
          <p className="text-sm text-(--muted) max-w-[65ch]">
            The cards doing the least here: they keep working with the fewest others. A card that fills
            a role, is a theme&apos;s key card or is half of a combo is never listed. Suggestions, not
            verdicts: a synergy we can&apos;t read looks exactly like one that isn&apos;t there.
            {pairOf.size ? " Where a card from outside the deck connects to more of it, the cut comes with that card to put in its place." : ""}
          </p>
          {clear.length ? (
            <section aria-labelledby="cuts-clear" className="flex flex-col gap-2">
              <h4 id="cuts-clear" className="text-base font-semibold">Nothing argues for keeping these</h4>
              <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,25rem),1fr))]">
                {clear.map((c) => <CutCard key={c.name} c={c} swap={swapFor(c)} />)}
              </ul>
            </section>
          ) : null}
          {maybe.length ? (
            <section aria-labelledby="cuts-maybe" className="flex flex-col gap-2">
              <h4 id="cuts-maybe" className="text-base font-semibold">{clear.length ? "Weak here, but something argues for them" : "The weakest here, though something argues for each"}</h4>
              <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,25rem),1fr))]">
                {maybe.slice(0, maybeN).map((c) => <CutCard key={c.name} c={c} swap={swapFor(c)} />)}
              </ul>
              {maybe.length > maybeN ? (
                <p>
                  <button type="button" className="min-h-11 rounded-(--radius) border border-(--separator) px-4 text-sm" onClick={() => setMaybeN(maybeN + MAYBE_STEP)}>
                    Show {Math.min(MAYBE_STEP, maybe.length - maybeN)} more
                  </button>
                </p>
              ) : null}
            </section>
          ) : null}
        </>
      )}
      {roleSwaps.length ? (
        <section aria-labelledby="cuts-role-swaps" className="flex flex-col gap-2 pt-2">
          <h4 id="cuts-role-swaps" className="text-base font-semibold">Better cards for the same job</h4>
          <p className="text-sm text-(--muted) max-w-[65ch]">
            These fill a role, so they are not cuts. Each card beside them does the same job, or one the
            deck is short of, and works with more of your deck.
          </p>
          <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,25rem),1fr))]">
            {roleSwaps.map((p) => (
              <li key={p.cut} className="flex flex-col gap-2 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm" data-testid="role-swap">
                <p className="flex items-center gap-2"><span><span className="text-(--muted)">Out: </span><CardName name={p.cut} /></span><CardMenuButton name={p.cut} className="ml-auto" /></p>
                <SwapLine p={p} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {/* THE REST OF THE TRIM, WITH ITS CARDS (appeal review 2026-09-26). The tuner asked for five
        *  cuts and got two, then "Consistency 16/13 (+3)" and "which card goes is your call" -- the
        *  count without the cards. The engine still does not rank two draw spells against each other,
        *  so it does not pick; it shows the cards to pick from, cheapest first within each role. */}
      {hasSurplus && (
        <section aria-labelledby="cuts-surplus" className="flex flex-col gap-3 pt-2">
          <h4 id="cuts-surplus" className="text-base font-semibold">Room in your roles</h4>
          {surplus!.map((g) => (
            <div key={g.name} className="flex flex-col gap-2">
              <p className="text-sm max-w-[70ch]">
                <b>{BUILD_CATEGORY_LABEL[g.name] ?? g.name}</b> is <span className="tabular-nums">{g.over}</span> over
                its target (<span className="tabular-nums">{g.count}</span> against <span className="tabular-nums">{g.target}</span>),
                so up to {g.over} of these can go. Which ones is your call: we don&apos;t rank the cards inside a role against each other.
              </p>
              <ul className="flex flex-wrap gap-2" aria-label={`${BUILD_CATEGORY_LABEL[g.name] ?? g.name}: ${g.cards.length} cards`}>
                {g.cards.map((c) => (
                  <li key={c.id} className="flex w-[72px] flex-col gap-1 sm:w-[84px]">
                    <CardFace card={c} className="w-full" />
                    {c.art ? <span className="line-clamp-2 text-xs leading-tight text-(--muted)">{c.name}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
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
      {!hasCuts && !over && hasUnjudged ? (
        <div className="rounded-(--radius) border border-dashed border-(--separator) px-4 py-5 text-center">
          <p className="text-sm">Nothing here is an easy cut.</p>
          <p className="text-xs text-(--muted) mt-1">
            Every card the engine could read fills a role, is a theme&apos;s key card or is half of a combo.
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
      {hasSlack && !hasSurplus && (
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

/** Trade-off rows shown before "Show N more"; the clear cuts always show in full. */
const MAYBE_STEP = 4;

/** One cut: the card, why it is here, what argues it stays, and its text one tap away. */
function CutCard({ c, swap }: { c: CutChoice; swap?: SuggestedPair }) {
  const r = c.row;
  const short = c.name.split(" // ")[0]!;
  return (
    <li className="flex items-start gap-3 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm">
      {c.card ? <CardFace card={c.card} className="w-20 sm:w-24" /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <div className="flex items-center gap-1">
            <h4 className="flex flex-1 items-baseline justify-between gap-3 text-base font-semibold">
              <CardName name={c.name} />
              <span className="shrink-0 text-xs font-normal stat-num text-(--muted)">{c.manaValue} mana</span>
            </h4>
            <CardMenuButton name={c.name} />
          </div>
          <p>{r ? r.why : `${capitalFirst(c.reasons.join("; "))}.`}</p>
          {c.unmet.map((u) => <p key={u} className="text-(--muted)">{capitalFirst(u)}.</p>)}
        </div>
        {r?.keep && r.keepActs ? (
          <p className="text-(--muted)"><span className="eyebrow block">Its strongest link</span><Badge repeat={r.keep.repeat} perTurn={r.keep.perTurn} /><ReasonText text={r.keep.text} /></p>
        ) : r?.keep && r.fedBy.length ? (
          // A FEEDER NAMES WHO USES IT: the line other cards get from it is true of any card of its
          // kind, so it is not this card's strongest link (Overview round 7).
          <p className="text-(--muted)">
            <span className="eyebrow block">Who uses it</span>
            {listNames(r.fedBy, 3)}. None of the links found here use its own abilities.
          </p>
        ) : null}
        {c.keeps.length ? (
          <p><span className="font-medium text-(--success)">Why you might keep it:</span> {c.keeps.join(" · ")}</p>
        ) : null}
        {c.twins.length ? (
          <p className="text-(--muted)">
            <span className="eyebrow block">Used by exactly the same cards</span>
            {listNames(c.twins)} {c.twins.length === 1 ? "is" : "are"} used by the same cards as {short}, so here {c.twins.length === 1 ? "either can" : "any of them can"} stand in for another: cutting one leaves the rest doing the same job.
          </p>
        ) : null}
        {c.card ? <ReadCards cards={[c.card]} /> : null}
        {swap ? <SwapLine p={swap} /> : null}
      </div>
    </li>
  );
}

const capitalFirst = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);
