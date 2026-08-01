import type { AnalyzeResponse } from "../types.js";
import { DeckIdentity } from "./DeckIdentity.js";
import { HeadlineScores } from "./HeadlineScores.js";
import { BuildBenchmarks } from "./BuildBenchmarks.js";
import { SuggestionsList } from "./SuggestionsList.js";
import { StatTiles } from "./StatTiles.js";
import { ManaCurveChart } from "./ManaCurveChart.js";
import { LandMathChart } from "./LandMathChart.js";
import { HighSynergyCards } from "./HighSynergyCards.js";

export function OverviewTab({ data }: { data: AnalyzeResponse }) {
  return (
    <div className="flex flex-col gap-6">
      <DeckIdentity cohesion={data.report.cohesion} colorIdentity={data.commanderColorIdentity} strategies={data.report.strategies} />
      <HeadlineScores report={data.report} />
      <BuildBenchmarks categories={data.report.buildCategories} />
      <SuggestionsList suggestions={data.report.suggestions} />
      <HighSynergyCards cards={data.report.cards} />
      <StatTiles
        avgManaValue={data.report.avgManaValue}
        landCount={data.report.landCount}
      />
      <ManaCurveChart curve={data.report.manaCurve} />
      <LandMathChart landCount={data.report.landCount} deckSize={data.resolvedCount} />
    </div>
  );
}
