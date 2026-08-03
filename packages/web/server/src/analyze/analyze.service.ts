import { Inject, Injectable } from "@nestjs/common";
import type { DeckReport } from "@mtg/engine";
import type { AnalyzeResponse, WireGraph } from "./analyze.types.js";

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
  graph(cardNames: string[], rolesByName: Map<string, string[]>): Promise<WireGraph>;
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
    // Keyed by raw report name, not a normalized one: the dep already normalizes both sides of
    // this join off its own `docs` array (the ESM `@mtg/data` it dynamically imports), so doing
    // it again here would just be a second, easy-to-drift copy of the same normalization.
    const rolesByName = new Map(report.cards.filter((c) => c.roles && c.roles.length > 0).map((c) => [c.name, c.roles!] as const));
    const graph = await this.deps.graph((cards as Array<{ name: string }>).map((c) => c.name), rolesByName);
    const totalCount = commanderNames.length + sections.deck.length;
    return { report, missing, resolvedCount: cards.length, totalCount, commanderColorIdentity, graph };
  }
}
