import { useState } from "react";
import type { DeckReport } from "../types.js";
import { BUILD_CATEGORY_LABEL } from "../lib/build-category-labels.js";
import type { CutChoice } from "../lib/cut-choice.js";
import { listNames, type EngineCard } from "../lib/engine-model.js";
import { CardName } from "./card-drawer.js";
import { CardMenuButton } from "./card-menu.js";
import { CardFace } from "./engine-parts.js";
import type { SuggestedPair } from "@edh-seer/matcher/suggest-static";
import { SwapLine } from "./SuggestedPairs.js";

/** THE CUT LIST — "which cards is the deck not using?" — and the deck-level slack beside it.
 *
 *  Every row states its own argument, because the engine's three failure directions all point the
 *  same way: a relation it cannot express looks exactly like a card doing nothing (see matcher's
 *  `cut-list.ts`). The caption is not decoration — it is the difference between a tool that helps
 *  and one that confidently deletes a player's best card. */
/** Scrolls to a role's shelf on the Roles chapter, or to the chapter when the shelf is not drawn.
 *  Never through the URL: the report's hash holds the deck. */
function toShelf(shelf: string | undefined): void {
  const at = (shelf && document.getElementById(`shelf-${shelf}`)) || document.getElementById("roles");
  at?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** A role group over its target, with the cards in it: where the rest of a trim comes from. */
export interface Surplus {
  name: string; count: number; target: number; over: number; cards: EngineCard[];
  /** The build category of the role's first shelf, which carries the role's heading on Roles. */
  shelf?: string;
}

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
    <div className="flex flex-col gap-2" data-testid="cut-list">
      <h3 className="eyebrow">Possible cuts</h3>
      {over ? (
        <section aria-labelledby="cuts-over" className="flex flex-col gap-2">
          <p id="cuts-over" className="text-sm max-w-[65ch]" data-testid="cuts-over">
            Your list has <b className="tabular-nums">{deckSize}</b> cards, <b className="tabular-nums">{over}</b> over 100.{" "}
            {toCut.length === over
              ? <>These {over} are doing the least here, weakest first: take them out and it is 100.</>
              // "A ROLE YOU RUN MORE OF THAN YOU NEED" ONLY WHEN ONE IS (persona round 2026-09-27: the
              // first-cuts seat looked below for a role over its target and every role was short or
              // on target, a dead end).
              : toCut.length
                ? <>These {toCut.length} are doing the least here. The other {over - toCut.length} have to come from {hasSurplus ? "a role you run more of than you need, below, or from " : ""}the cards you like least.</>
                : <>Every card here fills a role or works with your themes, so the {over} have to come from {hasSurplus ? "a role you run more of than you need, below, or from " : ""}the cards you like least.</>}
          </p>
          {toCut.length ? (
            <ol className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,25rem),1fr))]">
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
            The cards working with the fewest others. Suggestions, not verdicts: a link we can&apos;t read
            looks like one that isn&apos;t there.
          </p>
          {clear.length ? (
            <section aria-labelledby="cuts-clear" className="flex flex-col gap-2">
              <h4 id="cuts-clear" className="text-base font-semibold">Nothing argues for keeping these</h4>
              <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,25rem),1fr))]">
                {clear.map((c) => <CutCard key={c.name} c={c} swap={swapFor(c)} />)}
              </ul>
            </section>
          ) : null}
          {maybe.length ? (
            <section aria-labelledby="cuts-maybe" className="flex flex-col gap-2">
              <h4 id="cuts-maybe" className="text-base font-semibold">{clear.length ? "Weak here, but something argues for them" : "The weakest here, though something argues for each"}</h4>
              <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,25rem),1fr))]">
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
          <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,25rem),1fr))]">
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
          {/* ONE LINE PER ROLE (owner, 2026-09-27: one place per fact). The cards are on the Roles
            *  shelves, which now say how many are over; they were repeated here as card images.
            *
            *  EACH ROLE IS ITS OWN WAY TO ITS SHELF (owner, 2026-09-29: "this looks ugly and if I click
            *  it it does not work"). Four identical "Pick them on the shelf" links followed the rows,
            *  and each was `href="#roles"`: the report keeps the deck in the URL's hash, so a click
            *  replaced the deck instead of scrolling. The whole row is now one button, and it scrolls
            *  to that role's own shelf, not to the top of the chapter. */}
          <p className="text-sm text-(--muted) max-w-[65ch]">Pick a role to choose its cards on the shelf.</p>
          <ul className="flex flex-wrap gap-2 text-sm">
            {surplus!.map((g) => (
              <li key={g.name}>
                <button
                  type="button"
                  onClick={() => toShelf(g.shelf)}
                  className="flex min-h-11 items-baseline gap-2 rounded-(--radius) border border-(--separator) px-3 py-2 text-left hover:border-(--foreground)"
                >
                  <b>{BUILD_CATEGORY_LABEL[g.name] ?? g.name}</b>
                  <span className="tabular-nums text-(--muted)">{g.count} against {g.target}: up to {g.over} can go</span>
                  <span aria-hidden="true" className="text-(--accent)">&darr;</span>
                </button>
              </li>
            ))}
          </ul>
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
          . The next place to look for a slot, unless {offTheme!.length === 1 ? "it is" : "they are"} removal or protection.
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
            {" "}— not read yet, so not a reason to cut.
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

/** One cut: the card, why it is here, and what argues it stays. */
function CutCard({ c, swap }: { c: CutChoice; swap?: SuggestedPair }) {
  const r = c.row;
  return (
    <li className="flex flex-col gap-3 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm">
      <div className="flex items-start gap-3">
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
          {c.keeps.length ? (
            <p><span className="font-medium text-(--success)">Why you might keep it:</span> {c.keeps.join(" · ")}</p>
          ) : null}
          {c.twins.length ? (
            <p className="text-(--muted)">Stands in for {listNames(c.twins)}: the same cards use {c.twins.length === 1 ? "both" : "all of them"}.</p>
          ) : null}
        </div>
      </div>
      {swap ? <SwapLine p={swap} /> : null}
    </li>
  );
}

const capitalFirst = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);
