import type { AnalyzeResponse } from "../types.js";
import { ReportTabs } from "./ReportTabs.js";

/** Tunable copy: qualitative read-band for the 0-5 positiveCoherence number. Thresholds and
 *  labels are product copy, not scoring — adjust freely without touching the rating math. */
function coherenceBand(score: number): string {
  if (score < 1.5) return "Unfocused";
  if (score < 3) return "Loose theme";
  if (score < 4) return "Focused";
  return "Tight engine";
}

export function ReportView({ data }: { data: AnalyzeResponse }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="eyebrow">
        Resolved <span className="pip">{data.resolvedCount}/{data.totalCount}</span>
      </p>
      {data.report.positiveCoherence !== undefined ? (
        <p className="eyebrow">
          Synergy <span className="pip">{data.report.positiveCoherence.toFixed(1)}</span> / 5{" "}
          <span className="text-(--muted)">{coherenceBand(data.report.positiveCoherence)}</span>
        </p>
      ) : null}
      <ReportTabs data={data} />
    </div>
  );
}
