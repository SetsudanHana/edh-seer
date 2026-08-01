import type { AnalyzeResponse } from "../types.js";
import { ReportTabs } from "./ReportTabs.js";

export function ReportView({ data }: { data: AnalyzeResponse }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="eyebrow">
        Resolved <span className="pip">{data.resolvedCount}/{data.totalCount}</span>
      </p>
      <ReportTabs data={data} />
    </div>
  );
}
