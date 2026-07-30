import type { AnalyzeResponse } from "../types.js";
import { CardBucketBoard } from "./CardBucketBoard.js";
import { ComboList } from "./ComboList.js";
import { ThemeBars } from "./ThemeBars.js";
import { MissingCards } from "./MissingCards.js";

export function ReportView({ data }: { data: AnalyzeResponse }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-default-500">
        Resolved {data.resolvedCount} / {data.totalCount} cards
      </p>
      <CardBucketBoard cards={data.report.cards} commanders={data.report.commanders} />
      <ComboList combos={data.report.combos} />
      <ThemeBars themes={data.report.themes} />
      <MissingCards missing={data.missing} />
    </div>
  );
}
