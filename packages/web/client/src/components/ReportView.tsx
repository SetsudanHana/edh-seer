import type { AnalyzeResponse } from "../types.js";
import type { RunDiff } from "../lib/run-diff.js";
import { ReportTabs } from "./ReportTabs.js";
import { RunDiffStrip } from "./RunDiffStrip.js";

export function ReportView({ data, diff }: { data: AnalyzeResponse; diff?: RunDiff | null }) {
  return (
    <div className="flex flex-col gap-4">
      {/* ABOVE THE TABS, because what your edit did is not a property of any one section -- and it
        *  is the thing a tuner opened the page for on every run after the first. */}
      <RunDiffStrip diff={diff ?? null} />
      <p className="eyebrow">
        Resolved <span className="pip">{data.resolvedCount}/{data.totalCount}</span>
      </p>
      <ReportTabs data={data} />
    </div>
  );
}
