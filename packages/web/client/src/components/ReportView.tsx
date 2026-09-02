import type { AnalyzeResponse } from "../types.js";
import type { RunDiff } from "../lib/run-diff.js";
import { ReportShell } from "./ReportShell.js";
import { RunDiffStrip } from "./RunDiffStrip.js";

export function ReportView({ data, diff }: { data: AnalyzeResponse; diff?: RunDiff | null }) {
  return (
    <div className="flex flex-col gap-4">
      {/* ABOVE THE REPORT, because what your edit did is not a property of any one chapter -- and it
        *  is the thing a tuner opened the page for on every run after the first. It scrolls away
        *  with the entry screen; folding the diff into the sticky header is S9's, along with the
        *  ghost ticks and the pre-pinned changed cards. */}
      <RunDiffStrip diff={diff ?? null} />
      {/* THE GATE AND THE UNRESOLVED BANNER BOTH MOVED INTO THE REPORT (S7). They used to sit here,
        *  above the tab strip, because they qualify every tab; with one scroll and a sticky header
        *  there is no "above the tabs" to sit in. The coverage FIGURE now rides the header on every
        *  surface, and both panels in full are chapter 1 -- the chapter whose question is exactly
        *  theirs. */}
      <ReportShell data={data} />
    </div>
  );
}
