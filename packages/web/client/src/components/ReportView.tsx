import type { AnalyzeResponse } from "../types.js";
import type { RunDiff } from "../lib/run-diff.js";
import { ReportTabs } from "./ReportTabs.js";
import { RunDiffStrip } from "./RunDiffStrip.js";
import { CoveragePanel } from "./CoveragePanel.js";

export function ReportView({ data, diff }: { data: AnalyzeResponse; diff?: RunDiff | null }) {
  // WHETHER THE DECK'S DEFINING CARD IS ONE OF THE UNREAD. Both facts are already on every rated
  // row, so this is a read and not a new field — and it is the single thing all four personas
  // reached independently on 2026-08-27, because the gate's name list is alphabetical and capped at
  // eight, which put `Nalia de'Arnise` inside "and 40 more".
  const commanderUnread = data.report.cards
    .filter((c) => c.isCommander && c.derived === false)
    .map((c) => c.name);
  return (
    <div className="flex flex-col gap-4">
      {/* ABOVE THE TABS, because what your edit did is not a property of any one section -- and it
        *  is the thing a tuner opened the page for on every run after the first. */}
      <RunDiffStrip diff={diff ?? null} />
      {/* THE GATE, AND IT IS ABOVE THE TABS FOR THE SAME REASON: how much of the deck the engine
        *  could read is not a property of the Overview, it qualifies every tab under it. Inside the
        *  Overview's column flow it was, in the skeptic persona's words, "prominent, honestly
        *  worded, and joined to nothing" — a reader had no way to tell which numbers it limited.
        *
        *  IT CARRIES THE RESOLVED COUNT NOW. That count used to print as its own line directly
        *  below this panel: "52 of 100 cards read" over "Resolved 100/100", two counters with two
        *  meanings and the same denominator, four inches apart. Three of four personas stopped on
        *  the pair. One question, one place.
        *
        *  IT RENDERS NOTHING WHEN THE ENGINE READ EVERYTHING, which is why the resolved count keeps
        *  its own line below for that case — a fully covered deck still deserves to be told its
        *  lines all matched a card. */}
      <CoveragePanel
        coverage={data.report.coverage}
        resolved={data.resolvedCount}
        total={data.totalCount}
        commanderUnread={commanderUnread}
      />
      {data.report.coverage ? null : (
        <p className="eyebrow">
          Resolved <span className="pip">{data.resolvedCount}/{data.totalCount}</span>
        </p>
      )}
      <ReportTabs data={data} />
    </div>
  );
}
