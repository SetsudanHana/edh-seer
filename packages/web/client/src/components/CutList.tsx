import { useState } from "react";
import type { DeckReport } from "../types.js";
import { BUILD_CATEGORY_LABEL } from "../lib/build-category-labels.js";
import type { CutChoice } from "../lib/cut-choice.js";
import { listNames, type EngineCard, type EngineModel } from "../lib/engine-model.js";
import { CardName } from "./card-drawer.js";
import { CardMenuButton } from "./card-menu.js";
import { CardFace, ReadCards } from "./engine-parts.js";
import type { SuggestedPair } from "@edh-seer/matcher/suggest-static";
import { SwapLine } from "./SuggestedPairs.js";
import { cutIn, lossIn, lossSplit, pickTogether, tokenMakersOf } from "../lib/cut-together.js";

import { Arrow } from "./icons.js";
import { bandState } from "../lib/deck-gauge.js";
import { LAND_BAND } from "@edh-seer/matcher/build";
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

export function CutList({ cuts, unjudged, coverage, slack, offTheme, offThemeHeld, surplus, pairs, deckSize, fillFrom, model, lands }:
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
    /** How many cards fit no theme but are left off that line (see OFF-THEME below). */
    offThemeHeld?: number;
    /** The over-target role groups with their cards. Replaces the bare slack chips where present. */
    surplus?: readonly Surplus[];
    /** The card that could take each cut's slot, by cut name. Shown on the cut's own card. */
    pairs?: readonly SuggestedPair[];
    /** Cards in the list, commander included and companion not: over 100, the cuts reach 100. */
    deckSize?: number;
    /** Where the rest of an overage can come from when the cuts run short: cards that fit no theme
     *  and are neither interaction nor protection. */
    fillFrom?: readonly string[];
    /** The engine's cards, to put a cut card's text beside the card that covers it. */
    model?: EngineModel | null;
    /** The land count and its target (`deckMath.lands`), to say where the lands stand once an overage is cut. */
    lands?: { actual: number; target: number };
  }) {
  // BY NAME, the way a player cuts: the card, or the front of a double-faced one.
  const textOf = (name: string): EngineCard | undefined => {
    if (!model) return undefined;
    let any: EngineCard | undefined;
    for (const c of model.cards.values()) {
      if (c.name !== name && c.physical !== name) continue;
      if (!c.isFace && !c.faceOf && !c.isToken) return c;
      any ??= c;
    }
    return any;
  };
  const [maybeN, setMaybeN] = useState(MAYBE_STEP);
  // TWO KINDS OF CUT, SAID APART (appeal review 2026-09-26). One list headed "weakest first" whose
  // first row carried a green "Keeps it:" read as the list arguing with itself on three seats. A
  // card nothing argues for is a cut; a card with a reason to stay is a trade-off, and says so.
  // Losing a link nothing else makes argues for keeping a card too (review, #981).
  const argued = (c: CutChoice) => realKeeps(c).length > 0 || (c.row?.loses.length ?? 0) > 0;
  const clear = cuts.filter((c) => !argued(c));
  const maybe = cuts.filter(argued);
  // WEAKEST FIRST BY THE NUMBER ON SCREEN (#981): which cards are cut is the link reading's call; the
  // rows it picked read in the order of the score they print, or "weakest first" measured nothing a
  // reader could see (Krenko: 2.3, 2.6, 2.5, 1.6, 2.9 …).
  // A CUT THAT LOSES NOTHING GOES FIRST (owner 2026-10-07, #981): Roaming Throne led Krenko's
  // cuts at 1.6 while losing 20 links no other card makes, ahead of six that lose nothing. Inside
  // each half, still the score shown.
  const costs = (c: CutChoice) => Number((c.row?.loses.length ?? 0) > 0);
  const byShown = (a: CutChoice, b: CutChoice) => costs(a) - costs(b) || (shownScore(a) ?? 0) - (shownScore(b) ?? 0);
  // OVER 100, THE CUTS ARE THE PLAN (baseline round 2026-09-26). The first-deck seat, 8 over, got 7
  // names, 2 more behind a button, and "Trim 3 5 10", which skips 8. Now the list leads with exactly
  // as many cuts as the deck is over, weakest first (nothing-argues-for-it first, then trade-offs),
  // and says how many are still to find when the list runs short. The trim order is not used for
  // this: it ranks every card, and on that deck its fifth and eighth were Sol Ring and Arcane Signet.
  const over = deckSize !== undefined ? Math.max(0, deckSize - 100) : 0;
  const ordered = [...clear, ...maybe].sort((a, b) => costs(a) - costs(b));
  // ONLY A CUT THAT LOSES NOTHING COUNTS TOWARD 100 (owner 2026-10-07, persona round b): Roaming
  // Throne and Brash Taunter sat in "these 8 are doing the least" with "Why you might keep it:
  // cutting it loses 20 / 4 links", and the seat refused both and took two cards that fit no theme
  // instead. Those come from the fill below; a costly cut is listed after, as costing something.
  // CUT TOGETHER, TWO CARDS THAT COVER EACH OTHER BOTH GO (review): a link is lost when every card
  // that also gives it is on this list too, so the losses are read against the whole cut.
  // A TOKEN COVER IS GONE WHEN EVERY CARD THAT MAKES IT IS CUT (review): `by` names a token by its own
  // name, which no cut list holds, so it is read through `madeBy`.
  const makers = tokenMakersOf(model);
  // PICKED ONE AT A TIME (review): a cut joins the count only while every counted card still loses
  // nothing, so two cards that cover each other never both count and both read "loses a link".
  const chosen = over ? pickTogether(ordered, over, makers) : new Set<string>();
  // AT 100 THE SAME RULE PICKS THE CLEAR GROUP (#1153): "loses nothing" is read against the cards cut
  // with it, so two clear cuts that only cover each other are not both clear. The one left out moves
  // to the trade-offs and says what cutting it too loses.
  const clearTogether = over ? new Set<string>() : pickTogether([...clear].sort(byShown), Infinity, makers);
  const clearShown = over ? clear : clear.filter((c) => clearTogether.has(c.name));
  const maybeShown = over ? maybe : [...maybe, ...clear.filter((c) => !clearTogether.has(c.name))];
  // A card's loss read with the cards cut alongside it, and which of them a together-only loss needs.
  const readIn = (c: CutChoice, set: ReadonlySet<string>): CutRead | undefined => {
    const s = lossSplit(c, new Set([...set, c.name]), makers);
    if (!s) return undefined;
    // A MIXED LOSS KEEPS ITS COUNTS APART: the sentence counts what cutting it alone loses, and what
    // only the other cuts add is a second line.
    if (!s.own.length && s.together.length) return { links: s.together, withCut: s.by };
    // NOTHING LOST BY ITSELF, YET LEFT OUT (#1153): adding it would make a card already picked lose a
    // link (a token two cards make: neither maker's row carries the token link). Say whose.
    if (!s.own.length) return { links: [], breaks: breaks(c, set) };
    return { links: s.own, also: s.together.length ? { links: s.together, by: s.by } : undefined };
  };
  // The picked cards that lose a link they did not lose before once `c` is cut with them, and the links.
  const breaks = (c: CutChoice, set: ReadonlySet<string>): { names: string[]; links: string[] } | undefined => {
    const after = new Set([...set, c.name]);
    const names: string[] = [], links: string[] = [];
    for (const p of cuts) {
      if (!set.has(p.name) || p.name === c.name) continue;
      const was = lossIn(p, set, makers) ?? [];
      const added = [...(lossIn(p, after, makers) ?? [])];
      for (const t of was) { const i = added.indexOf(t); if (i >= 0) added.splice(i, 1); }
      if (added.length) { names.push(p.name); links.push(...added); }
    }
    return names.length ? { names, links } : undefined;
  };
  // What else could be cut for free alongside the count (the "next weakest" line), and what would
  // cost something -- alone, or only cut together with the counted ones.
  const alsoFree = (c: CutChoice) => !chosen.has(c.name) && !costs(c) && !lossIn(c, new Set([...chosen, c.name]), makers)?.length && !(c.row && c.row.partners > 0 && breaks(c, chosen));
  const costly = over ? ordered.filter((c) => !chosen.has(c.name) && !alsoFree(c)) : [];
  const losesWith = (c: CutChoice): string[] | undefined => lossIn(c, chosen, makers);
  const costsTogether = (c: CutChoice) => Number((losesWith(c)?.length ?? 0) > 0);
  // THE CARD THAT COVERS MOST OF IT (persona round 2026-10-07): "loses nothing" named no card, so
  // AT 100 THE PLAN IS THE CLEAR GROUP (#1153): a cover can be a trade-off card, as over 100 it can be a
  // costly one; that card's own row says what cutting it too would lose.
  // the seat could not check it. Never a card this list also proposes cutting (review): over 100
  // that is the cut itself, otherwise every card shown here.
  const listed = new Set(cuts.map((c) => c.name));
  const coverOf = (c: CutChoice): { name: string; n: number; of: number } | undefined => {
    const excluded = over ? chosen : clearTogether;
    // Counted in partner CARDS, the unit of "works with 39 other cards": a link count read 49 beside 39.
    const tally = new Map<string, Set<string>>();
    for (const x of c.row?.covers ?? []) {
      for (const n of x.by) if (!cutIn(n, excluded, makers)) tally.set(n, (tally.get(n) ?? new Set()).add(x.partner));
    }
    const [name, set] = [...tally].sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1))[0] ?? [];
    // THE WHOLE AND THE PART FROM ONE SET (review): the partner cards behind its covered links, so
    // the part can never exceed the whole ("each of the 10 … alone for 12").
    const of = new Set((c.row?.covers ?? []).map((x) => x.partner)).size;
    return name ? { name, n: set!.size, of } : undefined;
  };
  const toCut = over ? ordered.filter((c) => chosen.has(c.name)).sort((a, b) => costsTogether(a) - costsTogether(b) || Number(a.keeps.length > 0) - Number(b.keeps.length > 0) || byShown(a, b)) : [];
  // "EVEN ALL TOGETHER" ONLY OF CARDS THE GRAPH HAS READ, as the line at 100.
  const holds = toCut.every((c) => c.row);
  const spare = over ? ordered.filter(alsoFree) : [];
  const pairOf = new Map((pairs ?? []).map((p) => [p.cut, p] as const));
  // A deck that is over needs cards out, not swaps; the swaps are for a deck at its size.
  const swapFor = (c: CutChoice) => (over ? undefined : pairOf.get(c.name));
  // SWAPS FOR ROLE CARDS, which the cut list never offers (see `swapCandidates`): the role stays
  // filled, by a card that works with more of the deck.
  const roleSwaps = over ? [] : (pairs ?? []).filter((p) => !listed.has(p.cut));
  const hasSurplus = !!surplus && surplus.length > 0;
  const rest = over - toCut.length;
  // NAMED, NOT POINTED AT (persona round 2026-09-29): the first-cuts seat found its eighth card by
  // hand in "Fits no theme". The places are listed in the order to look.
  const fill = (fillFrom ?? []).slice(0, Math.max(rest, 3));
  const elsewhere = (
    <>
      {fill.length ? <>the cards that fit no theme and are neither interaction nor protection ({fill.map((n, i) => <span key={n}>{i > 0 ? ", " : ""}<CardName name={n} /></span>)}), </> : null}
      {hasSurplus ? "a role you run more of than you need, below, " : ""}
      {/* THE COSTLY CUTS ARE THE NEXT PLACE TO LOOK when nothing safe is left (Krenko: every card that
          fits no theme fills a role at or under its target), and the page says so rather than ending
          on "the cards you like least". */}
      {costly.length ? `${costly.length === 1 ? "the one" : `the ${costly.length}`} below that cost${costly.length === 1 ? "s" : ""} something to cut, ` : ""}
      {fill.length || hasSurplus || costly.length ? "or " : ""}the cards you like least
    </>
  );
  // THE LAND TARGET IS FOR THE FINISHED 100 AND THE CUTS ARE ALL SPELLS (#1152): the first-cuts seat
  // could not tell whether "wants 36" came out of the 8 or on top of them. Band read by `bandState`,
  // the one reading of the land count (#759).
  const landsShort = !!over && !!lands && lands.target > 0 && lands.target - lands.actual > LAND_BAND;
  const landsLine = ((): string | undefined => {
    if (!over || !lands || lands.target <= 0) return undefined;
    const { actual, target } = lands;
    const d = actual - target, n = Math.abs(d);
    if (n <= LAND_BAND) {
      const r = bandState(actual, target);
      // ONLY WHEN THE LISTED CUTS COVER THE OVERAGE: the rest comes from `elsewhere`, which can hold land cards.
      const lead = toCut.length === over ? `The cut list's cards are all spells, so your ${actual} lands stay.`
        : toCut.length ? `Take the other ${over - toCut.length} from spells too and your ${actual} lands stay.`
          : `Take all ${over} from spells and your ${actual} lands stay.`;
      return `${lead} A 100-card deck of this curve wants ${target}, and you are ${r.label}.`;
    }
    if (d < 0) return `Your ${actual} lands are ${n} under the ${target} this deck wants: cut ${n} more spells and add ${n} lands, so ${over + n} cards come out in all.`;
    return n <= over
      ? `Your ${actual} lands are ${n} over the ${target} this deck wants: cutting ${n} of them counts toward the ${over}.`
      : `Your ${actual} lands are ${n} over the ${target} this deck wants: cut ${over === 1 ? "1" : `all ${over}`} from your lands to reach 100, and ${n - over} ${n - over === 1 ? "is" : "are"} still over.`;
  })();
  const hasCuts = cuts.length > 0;
  const hasUnjudged = !!unjudged && unjudged.length > 0;
  const hasSlack = !!slack && slack.length > 0;
  const hasOffTheme = !!offTheme && offTheme.length > 0;
  const held = offThemeHeld ?? 0;
  if (!hasCuts && !hasSlack && !hasUnjudged && !hasOffTheme && held === 0 && !over) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="cut-list">
      <h3 className="eyebrow">Possible cuts</h3>
      {over ? (
        <section aria-labelledby="cuts-over" className="flex flex-col gap-2">
          <p id="cuts-over" className="text-sm max-w-[65ch]" data-testid="cuts-over">
            Your list has <b className="tabular-nums">{deckSize}</b> cards, <b className="tabular-nums">{over}</b> over 100.{" "}
            {toCut.length === over
              ? <>{over === 1 ? "This one loses" : `These ${over} lose`} no link when cut{over > 1 && holds ? ", even all together" : ""}: every link {over === 1 ? "it makes" : "they make"}, another card makes too.{landsShort ? "" : <> Take {over === 1 ? "it" : "them"} out and it is 100.</>}</>
              // "A ROLE YOU RUN MORE OF THAN YOU NEED" ONLY WHEN ONE IS (persona round 2026-09-27: the
              // first-cuts seat looked below for a role over its target and every role was short or
              // on target, a dead end).
              : toCut.length
                ? <>{toCut.length === 1 ? "This one loses" : `These ${toCut.length} lose`} no link when cut{toCut.length > 1 && holds ? ", even all together" : ""}: every link {toCut.length === 1 ? "it makes" : "they make"}, another card makes too. The other {rest} {rest === 1 ? "has" : "have"} to come from {elsewhere}.</>
                : <>Every card here fills a role or works with your themes, so the {over} have to come from {elsewhere}.</>}
          </p>
          {landsLine ? <p className="text-sm max-w-[65ch]" data-testid="cuts-lands">{landsLine}</p> : null}
          {toCut.length ? (
            <ol className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,max(25rem,calc((100%_-_2.25rem)/4))),1fr))]">
              {toCut.map((c) => <CutCard key={c.name} c={c} loses={losesWith(c)} cover={coverOf(c)} textOf={textOf} />)}
            </ol>
          ) : null}
          {spare.length ? (
            <p className="text-sm text-(--muted) max-w-[65ch]">
              <span className="text-(--foreground)">If you would rather keep one of these,</span> the next weakest{" "}
              {spare.length === 1 ? "is" : "are"}{" "}
              {spare.map((c, i) => <span key={c.name}>{i > 0 ? ", " : ""}<CardName name={c.name} /></span>)}.
            </p>
          ) : null}
          {costly.length ? (
            <section aria-labelledby="cuts-costly" className="flex flex-col gap-2">
              <h4 id="cuts-costly" className="text-base font-semibold">{costly.length === 1 ? "This one costs" : "These cost"} something to cut, so {costly.length === 1 ? "it is" : "they are"} not counted</h4>
              <ol className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,max(25rem,calc((100%_-_2.25rem)/4))),1fr))]">
                {/* Read with the card itself cut too: a card here only for a cut-together loss shows it. */}
                {costly.map((c) => <CutCard key={c.name} c={c} read={readIn(c, chosen)} />)}
              </ol>
            </section>
          ) : null}
        </section>
      ) : hasCuts && (
        <>
          <p className="text-sm text-(--muted) max-w-[65ch]">
            The cards working with the fewest others. Suggestions, not verdicts: a link we can&apos;t read
            looks like one that isn&apos;t there.
          </p>
          {clearShown.length ? (
            <section aria-labelledby="cuts-clear" className="flex flex-col gap-2">
              <h4 id="cuts-clear" className="text-base font-semibold">Nothing argues for keeping these</h4>
              {clearShown.length > 1 && clearShown.every((c) => c.row) ? <p className="text-sm text-(--muted) max-w-[65ch]">Cut together, these still lose nothing: every link they make, another card makes too.</p> : null}
              <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,max(25rem,calc((100%_-_2.25rem)/4))),1fr))]">
                {[...clearShown].sort(byShown).map((c) => <CutCard key={c.name} c={c} swap={swapFor(c)} cover={coverOf(c)} textOf={textOf} />)}
              </ul>
            </section>
          ) : null}
          {maybeShown.length ? (
            <section aria-labelledby="cuts-maybe" className="flex flex-col gap-2">
              <h4 id="cuts-maybe" className="text-base font-semibold">{clearShown.length ? "Weak here, but something argues for them" : "The weakest here, though something argues for each"}</h4>
              <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,max(25rem,calc((100%_-_2.25rem)/4))),1fr))]">
                {[...maybeShown].sort(byShown).slice(0, maybeN).map((c) => <CutCard key={c.name} c={c} swap={swapFor(c)} read={readIn(c, clearTogether)} cover={coverOf(c)} textOf={textOf} />)}
              </ul>
              {maybeShown.length > maybeN ? (
                <p>
                  <button type="button" className="min-h-11 rounded-(--radius) border border-(--separator) px-4 text-sm" onClick={() => setMaybeN(maybeN + MAYBE_STEP)}>
                    Show {Math.min(MAYBE_STEP, maybeShown.length - maybeN)} more
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
          <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,max(25rem,calc((100%_-_2.25rem)/4))),1fr))]">
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
                  <span className="text-(--accent)"><Arrow dir="down" /></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* OFF-THEME, NOT DEAD (owner, 2026-09-24). These connect to something or fill a role, so they
        *  are not cut candidates -- but no theme uses them, which is the second place a player looks
        *  for a slot.
        *
        *  ONLY THE CARDS A SLOT CAN COME FROM (#1085). The line used to list every card no theme
        *  claims with a hand-written "unless removal or protection", and the first-cuts seat skipped
        *  Sol Ring, Arcane Signet and Patriar's Seal by hand while the Roles page said Ramp 11 of 11.
        *  `offThemeSplit` now does that job: `offTheme` is the free cards, `offThemeHeld` counts the
        *  ones left out (removal, protection, or a role at or under its target). */}
      {hasOffTheme && (
        <p className="text-sm text-(--muted) max-w-[65ch]">
          <span className="text-(--foreground)">Fits no theme:</span>{" "}
          {offTheme!.map((n, i) => (
            <span key={n}>{i > 0 && ", "}<CardName name={n} /></span>
          ))}
          . The next place to look for a slot.
        </p>
      )}
      {held > 0 && (
        <p className="text-sm text-(--muted) max-w-[65ch]">
          {hasOffTheme
            ? `${held} more ${held === 1 ? "fits" : "fit"} no theme but ${held === 1 ? "fills" : "fill"} a role you are at or under target on, or ${held === 1 ? "is" : "are"} interaction or protection, so ${held === 1 ? "it is" : "they are"} not listed.`
            : `${held} ${held === 1 ? "card fits" : "cards fit"} no theme, but ${held === 1 ? "it fills" : "each fills"} a role you are at or under target on, or is interaction or protection.`}
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
              <li key={s.category} className="text-sm rounded-(--radius) border border-(--separator) px-3 py-1 text-(--muted)">
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
function CutCard({ c, swap, loses, read, cover, textOf }: { c: CutChoice; textOf?: (name: string) => EngineCard | undefined; swap?: SuggestedPair; loses?: string[]; read?: CutRead; cover?: { name: string; n: number; of: number } }) {
  const r = c.row;
  const score = shownScore(c);
  return (
    <li className="flex flex-col gap-3 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm">
      <div className="flex items-start gap-3">
        {c.card ? <CardFace card={c.card} className="w-20 sm:w-24" /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div>
            <div className="flex items-center gap-1">
              <h4 className="flex flex-1 items-baseline justify-between gap-3 text-base font-semibold">
                <CardName name={c.name} />
                {/* THE NUMBER "WEAKEST FIRST" ORDERS BY (#1041), here now that the keep line no longer
                    carries it. */}
                <span className="shrink-0 text-xs font-normal stat-num text-(--muted)">{score !== undefined ? `${score.toFixed(1)} synergy · ` : ""}{c.manaValue} mana</span>
              </h4>
              <CardMenuButton name={c.name} />
            </div>
            <p>{r ? r.why : `${capitalFirst(c.reasons.join("; "))}.`}</p>
            {c.unmet.map((u) => <p key={u} className="text-(--muted)">{capitalFirst(u)}.</p>)}
          </div>
          {r && r.partners > 0
            ? <Verdict links={read?.links ?? loses ?? r.loses.map((l) => l.text)} withCut={read?.withCut} also={read?.also} breaks={read?.breaks} cover={cover} keeps={realKeeps(c)} cut={c.name} own={r?.card} textOf={textOf} />
            : realKeeps(c).length ? <p><span className="font-medium text-(--success)">Why you might keep it:</span> {realKeeps(c).join(" · ")}</p> : null}
          {c.twins.length ? (
            <p className="text-(--muted)">Stands in for {listNames(c.twins)}: the same cards use {c.twins.length === 1 ? "both" : "all of them"}.</p>
          ) : null}
        </div>
      </div>
      {swap ? <SwapLine p={swap} /> : null}
    </li>
  );
}

/** ONE VERDICT PER CUT (persona round 2026-10-07, #981): "Cutting it loses nothing" beside a green
 *  "Why you might keep it" read as two verdicts on one card, on both seats. What cutting it loses IS
 *  the reason to keep it; when it loses nothing, its strongest link and its score argue nothing (the
 *  link is covered, the score is the ranking), and only a real argument -- a win plan, a table
 *  warning -- still shows as one. Two lost links are named; the rest open. */
function Verdict({ breaks, links, withCut, also: alsoLost, cover, keeps, cut, own, textOf }: { breaks?: { names: string[]; links: string[] }; withCut?: string[]; also?: { links: string[]; by: string[] }; cut?: string; own?: EngineCard; textOf?: (name: string) => EngineCard | undefined; links: string[]; cover?: { name: string; n: number; of: number }; keeps: string[] }) {
  const keepLabel = <span className="font-medium text-(--success)">Why you might keep it:</span>;
  const also = keeps.length ? <p>{links.length ? "Also: " : <>{keepLabel} </>}{keeps.join(" · ")}</p> : null;
  if (!links.length && breaks) {
    const n = breaks.names.length;
    const who = n > 2 ? `${n} of them lose` : `${breaks.names.join(" and ")} ${n === 1 ? "loses" : "lose"}`;
    const bhead = breaks.links.slice(0, 2), brest = breaks.links.slice(2);
    return (
      <div className="flex flex-col gap-2" data-testid="cut-loses">
        <p>{keepLabel} cut with the cards above, {who} {breaks.links.length === 1 ? "the one link" : `${breaks.links.length} links`} no other card makes: {bhead.join("; ")}{brest.length ? "" : "."}</p>
        {brest.length ? (
          <details>
            <summary className="cursor-pointer py-1 text-(--muted)">and {brest.length} more</summary>
            <ul className="list-disc pl-5">{brest.map((t) => <li key={t}>{t}</li>)}</ul>
          </details>
        ) : null}
        {also}
      </div>
    );
  }
  if (!links.length) {
    // THE COVER'S TEXT BESIDE THE CUT'S (persona round 2026-10-09): "Beetleback Chief alone covers all
    // 28" could not be checked without leaving the page.
    const pair = cover && cut ? [own ?? textOf?.(cut), textOf?.(cover.name)] : [];
    const both = pair.every((x): x is EngineCard => !!x) && pair.length === 2 ? pair as EngineCard[] : undefined;
    return (
      <div className="flex flex-col gap-2" data-testid="cut-loses">
        {/* "EVERY CARD … DOES THE SAME WITH 28 OF THEM" read as 28 is not every (round b): the whole
            and the part, both counted, in that order. */}
        {/* LINKS, NOT "WORKS WITH" (review b): the count beside it is every card it works with,
            background helpers included, and those are not the links a cover is read for. */}
        <p><span className="font-medium">Cutting it loses nothing:</span> another card makes every link it makes{cover ? <>. <CardName name={cover.name} className="underline underline-offset-2" /> alone covers {cover.n === cover.of ? (cover.of === 1 ? "it" : `all ${cover.of} cards involved`) : `${cover.n} of the ${cover.of} cards involved`}</> : null}.</p>
        {both ? <ReadCards cards={both} /> : null}
        {also}
      </div>
    );
  }
  const head = links.slice(0, 2), rest = links.slice(2);
  return (
    <div className="flex flex-col gap-2" data-testid="cut-loses">
      <p>{keepLabel} {withCut?.length ? `${withWords(withCut)} cut too, ` : ""}cutting it loses {links.length === 1 ? "the one link" : `${links.length} links`} no other card makes: {head.join("; ")}{rest.length ? "" : "."}</p>
      {rest.length ? (
        <details>
          <summary className="cursor-pointer py-1 text-(--muted)">and {rest.length} more</summary>
          <ul className="list-disc pl-5">{rest.map((t) => <li key={t}>{t}</li>)}</ul>
        </details>
      ) : null}
      {alsoLost ? <p>{capitalFirst(withWords(alsoLost.by))} cut too, it also loses: {alsoLost.links.join("; ")}</p> : null}
      {also}
    </div>
  );
}

/** A cut's loss as read against the cards cut with it. */
interface CutRead { links: string[]; withCut?: string[]; also?: { links: string[]; by: string[] }; breaks?: { names: string[]; links: string[] } }

/** "with Elf", "with Elf and Druid", "with 3 of these": at most two names. */
const withWords = (by: string[]): string => by.length > 2 ? `with ${by.length} of the cards above` : `with ${by.join(" and ")}`;

/** The keep reasons that argue for a card on their own: not its strongest link (the loss line says
 *  what goes) and not its score (the header shows it, and it is the ranking itself). */
const realKeeps = (c: CutChoice): string[] => c.row
  ? c.keeps.filter((k) => !/^its strongest link: /.test(k) && !/^it scores \d+(?:\.\d+)? for synergy/.test(k))
  : c.keeps;

/** The synergy rating, 0–5, that "weakest first" orders by and the header prints; from a saved report
 *  without one, the rating its keep line printed. Never `card.score`, which is the raw score on
 *  another scale (review). */
function shownScore(c: CutChoice): number | undefined {
  if (c.rating !== undefined) return c.rating;
  for (const k of c.keeps) {
    const m = /scores (\d+(?:\.\d+)?) for synergy/.exec(k);
    if (m) return Number(m[1]);
  }
  return undefined;
}

const capitalFirst = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);
