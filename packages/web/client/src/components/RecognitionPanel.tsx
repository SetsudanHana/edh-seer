import type { AnalyzeResponse } from "../types.js";
import { roleBars, typeSlices } from "../lib/deck-shape.js";
import { TypeBar } from "./TypeBar.js";
import { RoleBars } from "./RoleBars.js";
import { identityLabel } from "../lib/color-identity.js";

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
  const slices = typeSlices(data.graph?.nodes ?? []);
  const bars = roleBars(report.buildParents);
  const colourIdentity = data.commanderColorIdentity ?? [];
  // NAMED, NOT SPELLED (I3, whole-branch review, 2026-09-01). Bare letters ("WUB") shipped here
  // while `DeckIdentity`, twenty lines below on the same page, already ran the same identity
  // through `identityLabel` to print "Esper" -- two readers of the same fact disagreeing about
  // how to say it. `identityLabel` already handles the empty/colorless case, so no bare-letter
  // fallback is needed here either.
  const colours = colourIdentity.length > 0 ? identityLabel(colourIdentity) : "";
  /** THE THEME, FROM `cohesion` AND NOT FROM `identity`. `identity` is three prose slots built by
   *  `deckSentence`, and none of them is a theme: `win` is a win condition, `means` is
   *  "N interaction cards against a target of N" -- an explicit target, which this panel is not
   *  allowed to show -- and only `engine` mentions the theme, wrapped in a sentence.
   *  `cohesion.theme` is the bare thing itself, and it is what `DeckIdentity` prints as its own
   *  headline, so using it here makes the two panels agree instead of contradicting each other.
   *  `dominant === false` is the engine saying it found no dominant theme; that is a real answer
   *  and gets said, not hidden. */
  const cohesion = report.cohesion;
  const theme = cohesion && cohesion.dominant !== false ? cohesion.theme : null;
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
  const strongestTheme = !theme && cohesion?.dominant === false ? cohesion.theme : null;
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
      <h2 className="text-lg font-bold tracking-[-0.01em]">What this deck is</h2>

      <p data-testid="recognition-identity" className="text-sm text-(--muted)">
        <span className="text-(--foreground)">{theme ?? noThemeLabel}</span>
        {strongestTheme ? <> · strongest: {strongestTheme}</> : null}
        {commanders.length > 0 ? <> · {commanders.join(" / ")}</> : null}
        {colours ? <> · {colours}</> : null}
        {" · "}
        {/* CARDS READ, NOT LINES RESOLVED (C2, whole-branch review, 2026-09-01). `resolvedCount`/
          *  `totalCount` are NAME RESOLUTION -- how many decklist LINES matched a card -- and on a
          *  partly-read deck they can both read 100/100 while the gate strip above this panel
          *  (`CoveragePanel`) truthfully says "52 of 100 cards read". Those are two different
          *  denominators; `report.coverage.derived`/`.resolved` is the SAME figure `CoveragePanel`
          *  shows, so the two counters at the top of the page agree instead of contradicting each
          *  other. Falls back to the resolution counts only when `coverage` is absent (a fully-read
          *  deck, where the engine never computed it and the two figures would coincide anyway). */}
        <span data-testid="recognition-coverage">
          read {report.coverage?.derived ?? data.resolvedCount} of {report.coverage?.resolved ?? data.totalCount} cards
        </span>
      </p>

      <div className="flex flex-wrap items-start gap-8">
        <TypeBar slices={slices} />
        <RoleBars bars={bars} />
      </div>
    </section>
  );
}
