import type { AnalyzeResponse } from "../types.js";
import { typeSlices, landCount } from "../lib/deck-shape.js";
import { DeckWaffle } from "./DeckWaffle.js";
import { waffleSquares } from "../lib/waffle.js";
import { identityKey, identityLabel } from "../lib/color-identity.js";
import { ManaSymbols } from "./ManaSymbols.js";

/** DID IT READ THE DECK I BUILT?
 *
 *  The report's first question, and until now the page answered it last. The August brief set the
 *  tuner's four questions in order -- did it understand my deck / what IS this deck / what is
 *  wrong / what do I do -- and the implementation shipped 1, 3, 4, 2, because question 2's ANSWER
 *  (`SYNERGY 0.8/5`, breadth, anchor) was unreadable to four of four personas. Moving the question
 *  was the wrong half of the fix. This is the answer rewritten; the scores stay where they were
 *  demoted to.
 *
 *  NO SCORE AND NO TARGET LIVES HERE. A tool that grades a deck before showing it understood it
 *  has not earned the criticism. Everything on this panel is a description. */
export function RecognitionPanel({ data }: { data: AnalyzeResponse }) {
  const { report } = data;
  const nodes = data.graph?.nodes ?? [];
  const slices = typeSlices(nodes);
  const lands = landCount(nodes);
  const colourIdentity = data.commanderColorIdentity ?? [];
  // NAMED, NOT SPELLED (I3, whole-branch review, 2026-09-01). Bare letters ("WUB") shipped here
  // while `DeckIdentity`, twenty lines below on the same page, already ran the same identity
  // through `identityLabel` to print "Esper" -- two readers of the same fact disagreeing about
  // how to say it. `identityLabel` already handles the empty/colorless case, so no bare-letter
  // fallback is needed here either.
  const colours = colourIdentity.length > 0 ? identityLabel(colourIdentity) : "";
  /** AND DRAWN IN THE GAME'S OWN VOCABULARY BESIDE THE NAME (owner review, 2026-09-01). "Grixis" is
   *  a name a player has to have learnt; the three pips are the same fact, readable by anyone who
   *  has held a card. `index.css` has said "identity in the interface uses real mana symbols in
   *  Wizards' own colours" since the `--mana-*` ramp was written -- that ramp is for fills where a
   *  symbol CANNOT be placed, and this is not one of those places. Built through `identityKey` so
   *  the pips come out in WUBRG order whatever order the API sent, and rendered by `ManaSymbols`
   *  (Scryfall's own symbology SVGs, already loaded elsewhere on this page) rather than a second
   *  symbol path. */
  const pipCost = identityKey(colourIdentity)
    .split("")
    .map((c) => `{${c}}`)
    .join("");
  /** THE THEME, FROM `cohesion` AND NOT FROM `identity`. `identity` is three prose slots built by
   *  `deckSentence`, and none of them is a theme: `win` is a win condition, `means` is
   *  "N interaction cards against a target of N" -- an explicit target, which this panel is not
   *  allowed to show -- and only `engine` mentions the theme, wrapped in a sentence.
   *  `cohesion.theme` is the bare thing itself, and it is what `DeckIdentity` prints as its own
   *  headline, so using it here makes the two panels agree instead of contradicting each other.
   *  `dominant === false` is the engine saying it found no dominant theme; that is a real answer
   *  and gets said, not hidden. */
  const cohesion = report.cohesion;
  // THE PLAYER'S NAME FOR IT, NOT THE MECHANISM (roadmap T2). `theme` reads "enchantments entering";
  // `name` reads "Enchantress", which is the word the deck is known by. They are equal wherever no
  // name is known, so this is never a blank. The mechanical phrase is still what every edge reason
  // is built from -- see `theme-names.ts`.
  const theme = cohesion && cohesion.dominant !== false ? (cohesion.name ?? cohesion.theme) : null;
  /** THE SAME COVERAGE QUALIFIER `DeckIdentity` PRINTS (I1, whole-branch review, 2026-09-01). "No
   *  dominant theme" is a verdict about the DECK; on a partly-read deck the true statement is about
   *  the ENGINE, and printing the unqualified string here — ABOVE `DeckIdentity`'s own qualified one
   *  — is what made a Party-themed precon read as themeless a second time, on the panel that leads
   *  the page. Mirrored from `DeckIdentity.tsx` verbatim rather than re-derived, for the same reason
   *  the coverage sentence below is read from the report and not rebuilt here. */
  const noThemeLabel = report.coverage ? "No theme found in the cards read" : "No dominant theme";
  // `DeckIdentity`'s fallback for an unfocused deck ("strongest: {theme}") carried over too — without
  // it this panel would lead with a bare "No dominant theme" and name nothing at all, while the
  // panel one movement down still names the deck's best-supported (if not dominant) theme.
  const strongestTheme = !theme && cohesion?.dominant === false ? (cohesion.name ?? cohesion.theme) : null;
  /** THE COMMANDER (I3). The spec's own ordering is "theme · commander · colour identity" -- for an
   *  EDH player the commander IS the recognition anchor, the first thing checked to see whether the
   *  tool read their deck, and it was missing here entirely. Read from the priced castability row
   *  (`deckMath.castability.commanders`) rather than the bare `report.commanders` list, because that
   *  row is the one place a commander's NAME is already carried alongside data this page trusts
   *  elsewhere (`DeckIdentity`'s own "Commander castable" line reads the same array). Absent when
   *  `deckMath` was not computed — a deck this page could not price is still named by its theme and
   *  colours. */
  const commanders = (report.deckMath?.castability.commanders ?? []).map((c) => c.name);

  return (
    <section className="flex flex-col gap-4">
      {/* The chapter above is titled "Deck at a glance"; an h2 reading "What this deck is" under
        *  it was the same heading twice (T1). The theme line below IS the answer. */}
      {/* THE ANSWER LOOKS LIKE AN ANSWER (owner review, 2026-09-01). The theme shipped as the first
        *  word of a 14px muted metadata run -- "enchantments entering · The Rani · Grixis · read 100
        *  of 100 cards" -- so the panel asked "What this deck is" and then answered it at the same
        *  weight as its own footnotes. It is the one thing this panel exists to say, and the house
        *  rule is that a display line is a different SIZE, not a bolder body: 30px against the 14px
        *  beneath it. The metadata that qualifies the theme stays where it was, small, below.
        *  `recognition-identity` still wraps both, so every guard that reads "the identity" -- theme,
        *  commander, colours, coverage -- keeps reading one element. */}
      <div data-testid="recognition-identity" className="flex flex-col gap-1">
        <p
          data-testid="recognition-theme"
          className="text-2xl sm:text-3xl font-bold leading-tight tracking-[-0.02em] text-(--foreground)"
        >
          {theme ?? noThemeLabel}
        </p>

        <p className="text-sm text-(--muted)">
          {strongestTheme ? <>strongest: {strongestTheme} · </> : null}
          {commanders.length > 0 ? <>{commanders.join(" / ")} · </> : null}
          {colours ? (
            <>
              {/* The word beside them already says "Grixis", so the pips are decoration to a screen
                *  reader -- hidden rather than read out a second time as "one blue mana, one black
                *  mana, one red mana". */}
              <span aria-hidden="true" className="inline-flex items-center align-[-0.15em]">
                <ManaSymbols cost={pipCost} />
              </span>{" "}
              {colours} ·{" "}
            </>
          ) : null}
          {/* CARDS READ, NOT LINES RESOLVED (C2, whole-branch review, 2026-09-01). `resolvedCount`/
          *  `totalCount` are NAME RESOLUTION -- how many CARD SLOTS matched a name, one entry per
          *  copy, so a `3 Plains` line counts three (S12) -- and on a partly-read deck they can
          *  both read 100/100 while the gate strip above this panel
          *  (`CoveragePanel`) truthfully says "52 of 100 cards read". Those are two different
          *  denominators; `report.coverage.derived`/`.resolved` is the SAME figure `CoveragePanel`
          *  shows, so the two counters at the top of the page agree instead of contradicting each
          *  other. Falls back to the resolution counts only when `coverage` is absent (a fully-read
          *  deck, where the engine never computed it and the two figures would coincide anyway). */}
          <span data-testid="recognition-coverage">
            read {report.coverage?.derived ?? data.resolvedCount} of {report.coverage?.resolved ?? data.totalCount} cards
          </span>
        </p>
      </div>

      {/* COMPUTED FROM THE NODES, NOT READ OFF `report.landCount` (Critical finding, whole-branch
        *  review, 2026-09-01, and the defect diagnosed in `docs/engineering-log/2026-08-31.md`):
        *  both halves of a census that claims "nonland + land == the deck" have to come from ONE
        *  traversal, or the page prints two figures from two different rules and sums them.
        *  `typeSlices` and `landCount` are that traversal.
        *  IT NO LONGER DISAGREES WITH THE REPORT (roadmap T3, 2026-09-03). `landCount` counts a
        *  card with a land back as a land, so this figure EQUALS `deckMath.lands.actual` and
        *  `report.landCount` rather than trailing them by `deckMath.lands.mdfc` -- one land count
        *  on every surface, after four phone-judge runs failed "how many lands does this deck
        *  have" against 34 here and 38 everywhere after it. `mdfc` below is composition now.
        *
        *  AND THE BAR BECAME A WAFFLE (roadmap S3). The stacked bar's own argument was that a
        *  shared baseline beats a ring because creature 21 against enchantment 19 is 11 degrees of
        *  arc; one square per card wins the same argument outright, and it is the only shape that
        *  can also carry WHICH cards the engine failed to read. Same `slices` and same counts. */}
      <DeckWaffle
        squares={waffleSquares(nodes, report.cards, data.missing)}
        slices={slices}
        lands={lands}
        mdfc={report.deckMath?.lands.mdfc}
      />
    </section>
  );
}
