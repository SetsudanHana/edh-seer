import type { GameState } from "@edh-seer/engine";
import type { AnalyzeResponse } from "../types.js";
import type { RunDiff } from "../lib/run-diff.js";
import { ReportShell } from "./ReportShell.js";

export function ReportView({ data, diff, state, onState, stateBusy }: {
  data: AnalyzeResponse; diff?: RunDiff | null;
  state?: GameState; onState?: (state: GameState) => void; stateBusy?: boolean;
}) {
  // THE DIFF IS THE HEADER'S STATE NOW (roadmap S9), not a strip above the report. It used to live
  // here, which meant the one fact a returning tuner opened the page for was the first thing to
  // scroll off the screen. `ReportShell` hands it to the header, the two score dials, the ranked
  // diagnosis and the pin set.
  //
  // The wrapping flex column went with the strip: with one child it was spacing for a sibling that
  // no longer exists.
  return <ReportShell data={data} diff={diff ?? null} state={state} onState={onState} stateBusy={stateBusy} />;
}
