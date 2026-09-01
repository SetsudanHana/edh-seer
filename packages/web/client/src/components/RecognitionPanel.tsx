import type { AnalyzeResponse } from "../types.js";
import { roleBars, typeSlices } from "../lib/deck-shape.js";
import { TypeDonut } from "./TypeDonut.js";
import { RoleBars } from "./RoleBars.js";

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
  const colours = (data.commanderColorIdentity ?? []).join("");
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

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-bold tracking-[-0.01em]">What this deck is</h2>

      <p data-testid="recognition-identity" className="text-sm text-(--muted)">
        <span className="text-(--foreground)">{theme ?? "No dominant theme"}</span>
        {colours ? <> · {colours}</> : null}
        {" · "}
        <span data-testid="recognition-coverage">
          read {data.resolvedCount} of {data.totalCount} cards
        </span>
      </p>

      <div className="flex flex-wrap items-start gap-8">
        <TypeDonut slices={slices} />
        <RoleBars bars={bars} />
      </div>
    </section>
  );
}
