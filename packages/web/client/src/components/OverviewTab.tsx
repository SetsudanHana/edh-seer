import type { AnalyzeResponse } from "../types.js";
import { DeckIdentity } from "./DeckIdentity.js";
import { HeadlineScores } from "./HeadlineScores.js";
import { BuildBenchmarks } from "./BuildBenchmarks.js";
import { SuggestionsList } from "./SuggestionsList.js";
import { CutList } from "./CutList.js";
import { StatTiles } from "./StatTiles.js";
import { ManaCurveChart } from "./ManaCurveChart.js";
import { LandMathChart } from "./LandMathChart.js";
import { HighSynergyCards } from "./HighSynergyCards.js";

export function OverviewTab({ data }: { data: AnalyzeResponse }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Full width, both of them: the deck's identity and its two headline scores are the answer
        *  the rest of the page explains, and they read as the page's lead only while nothing sits
        *  beside them. */}
      <DeckIdentity cohesion={data.report.cohesion} colorIdentity={data.commanderColorIdentity} strategies={data.report.strategies} />
      <HeadlineScores report={data.report} />

      {/* NATIVE MULTI-COLUMN, not a grid. These blocks are independent, self-contained and wildly
        *  different in height -- exactly what CSS columns are for, and a grid would need explicit
        *  placement or leave ragged holes. One column below `xl` (nothing moves at the sizes that
        *  were already fine), two at `xl`, three at `2xl`, so each column lands near a readable
        *  measure instead of running 1,600px of 12px prose.
        *
        *  `break-inside-avoid` on every child: a benchmark block split across a column boundary
        *  would put its rows under someone else's heading, which is worse than an uneven column.
        *
        *  TWO COLUMNS IS THE CEILING, measured rather than assumed: at three, the benchmarks panel
        *  is taller than everything else combined and unsplittable, so it took column one, the five
        *  remaining blocks filled column two, and column three rendered empty -- 550px of dead space
        *  where the gutter used to be. */}
      <div className="columns-1 xl:columns-2 gap-6 [&>*]:break-inside-avoid [&>*]:mb-6">
        <BuildBenchmarks categories={data.report.buildCategories} deckMath={data.report.deckMath} />
        <SuggestionsList suggestions={data.report.suggestions} />
        <CutList cutList={data.report.cutList} slack={data.report.slack} />
        <HighSynergyCards cards={data.report.cards} />
        <StatTiles avgManaValue={data.report.avgManaValue} />
        <ManaCurveChart curve={data.report.manaCurve} />
        <LandMathChart landCount={data.report.landCount} deckSize={data.resolvedCount} />
      </div>
    </div>
  );
}
