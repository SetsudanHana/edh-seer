import { Inject, Injectable } from "@nestjs/common";
import type { DeckReport } from "@mtg/engine";
import type { CardGraph } from "@mtg/matcher";
import type { AnalyzeResponse } from "./analyze.types.js";

export const ANALYZE_DEPS = "ANALYZE_DEPS";

export interface AnalyzeDeps {
  parseDecklistSections(text: string): { commanders: string[]; deck: string[] };
  parseLines(text: string): string[];
  makeLookup(): unknown;
  resolveDeck(
    commanderNames: string[],
    deckNames: string[],
    lookup: unknown,
  ): Promise<{
    cards: unknown[];
    combos: unknown[];
    missing: string[];
    commanderResolved: string[];
    commanderColorIdentity: string[];
  }>;
  analyze(cards: unknown[], combos: unknown[], commanderNames: string[]): Promise<DeckReport>;
  graph(cardNames: string[]): Promise<CardGraph>;
}

@Injectable()
export class AnalyzeService {
  constructor(@Inject(ANALYZE_DEPS) private readonly deps: AnalyzeDeps) {}

  async analyze(decklist: string, commanders?: string): Promise<AnalyzeResponse> {
    const sections = this.deps.parseDecklistSections(decklist);
    const commanderNames =
      commanders && commanders.trim() !== "" ? this.deps.parseLines(commanders) : sections.commanders;

    const { cards, combos, missing, commanderResolved, commanderColorIdentity } = await this.deps.resolveDeck(
      commanderNames,
      sections.deck,
      this.deps.makeLookup(),
    );
    const report = await this.deps.analyze(cards, combos, commanderResolved);
    const graph = await this.deps.graph((cards as Array<{ name: string }>).map((c) => c.name));
    const totalCount = commanderNames.length + sections.deck.length;
    return { report, missing, resolvedCount: cards.length, totalCount, commanderColorIdentity, graph };
  }
}
