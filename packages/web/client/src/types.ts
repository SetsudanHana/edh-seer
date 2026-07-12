import type { DeckReport } from "@mtg/engine";

export type { DeckReport };

export interface AnalyzeResponse {
  report: DeckReport;
  missing: string[];
  resolvedCount: number;
  totalCount: number;
}
