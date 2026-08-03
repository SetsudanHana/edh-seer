import type { DeckReport } from "@mtg/engine";
import type { CardGraph } from "@mtg/matcher";

export interface AnalyzeResponse {
  report: DeckReport;
  missing: string[];
  resolvedCount: number;
  totalCount: number;
  commanderColorIdentity: string[];
  /** The deck as a graph: card and characteristic nodes, plus reified `event:` nodes carrying the
   *  matcher's synergy edges. Computed alongside the report rather than behind a second endpoint,
   *  because the expensive half -- resolving every card and its tags -- is already done here. */
  graph: CardGraph;
}
