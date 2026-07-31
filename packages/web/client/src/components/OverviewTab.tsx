import type { AnalyzeResponse } from "../types.js";
import { DeckIdentity } from "./DeckIdentity.js";
import { StatTiles } from "./StatTiles.js";
import { ManaCurveChart } from "./ManaCurveChart.js";
import { LandMathChart } from "./LandMathChart.js";

export function OverviewTab({ data }: { data: AnalyzeResponse }) {
  return (
    <div className="flex flex-col gap-6">
      <DeckIdentity cohesion={data.report.cohesion} />
      <StatTiles
        roles={data.report.roles}
        avgManaValue={data.report.avgManaValue}
        landCount={data.report.landCount}
      />
      <ManaCurveChart curve={data.report.manaCurve} />
      <LandMathChart landCount={data.report.landCount} deckSize={data.resolvedCount} />
    </div>
  );
}
