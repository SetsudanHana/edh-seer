import { Inject, Injectable } from "@nestjs/common";
import type { DeckReport } from "@mtg/engine";
import type { AnalyzeResponse } from "./analyze.types.js";

export const ANALYZE_DEPS = "ANALYZE_DEPS";

export interface AnalyzeDeps {
  parseDecklistText(text: string): string[];
  makeLookup(): unknown;
  resolveNames(
    names: string[],
    lookup: unknown,
  ): Promise<{ cards: unknown[]; combos: unknown[]; missing: string[] }>;
  analyze(cards: unknown[], combos: unknown[]): DeckReport;
}

@Injectable()
export class AnalyzeService {
  constructor(@Inject(ANALYZE_DEPS) private readonly deps: AnalyzeDeps) {}

  async analyze(decklist: string): Promise<AnalyzeResponse> {
    const names = this.deps.parseDecklistText(decklist);
    const { cards, combos, missing } = await this.deps.resolveNames(
      names,
      this.deps.makeLookup(),
    );
    const report = this.deps.analyze(cards, combos);
    return { report, missing, resolvedCount: cards.length, totalCount: names.length };
  }
}
