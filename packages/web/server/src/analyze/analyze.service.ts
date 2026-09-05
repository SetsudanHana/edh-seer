import { Inject, Injectable } from "@nestjs/common";
import type { DeckReport, GameState } from "@edh-seer/engine";
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
  analyze(cards: unknown[], combos: unknown[], commanderNames: string[], state?: GameState): Promise<DeckReport>;
  graph(
    cardNames: string[],
    rolesByName: Map<string, string[]>,
    copiesByName: Map<string, number>,
    report: DeckReport,
  ): Promise<WireGraph>;
}

@Injectable()
export class AnalyzeService {
  constructor(@Inject(ANALYZE_DEPS) private readonly deps: AnalyzeDeps) {}

  async analyze(decklist: string, commanders?: string, state?: GameState): Promise<AnalyzeResponse> {
    const sections = this.deps.parseDecklistSections(decklist);
    const commanderNames =
      commanders && commanders.trim() !== "" ? this.deps.parseLines(commanders) : sections.commanders;

    const { cards, combos, missing, commanderResolved, commanderColorIdentity } = await this.deps.resolveDeck(
      commanderNames,
      sections.deck,
      this.deps.makeLookup(),
    );
    const report = await this.deps.analyze(cards, combos, commanderResolved, state);
    // Keyed by raw report name, not a normalized one: the dep already normalizes both sides of
    // this join off its own `docs` array (the ESM `@edh-seer/data` it dynamically imports), so doing
    // it again here would just be a second, easy-to-drift copy of the same normalization.
    //
    // KEYED ON THE PHYSICAL CARD, because `attachRolesAndArt` looks a node's roles up under
    // `normalize(n.cardName ?? n.id)` -- physical on BOTH faces. `report.cards[].name` is a FACE
    // name (Task 7, faces-as-nodes), so keying on it put every multi-face card's roles under a key
    // no node ever asks for: both faces counted as `unjoined`, dropping their role chips, their
    // role rooms and the role paint mode, announced only by a `console.warn`. Review fix,
    // 2026-08-27 (the ninth consumer of this family, after the eight the 08-27 wave fixed).
    // Collapsing the two face rows onto one key is safe rather than lossy: `roles` is read from
    // `buildRoles.get(physical)` in analyze.ts, so both of a card's face rows carry the identical
    // array.
    const rolesByName = new Map(
      report.cards.filter((c) => c.roles && c.roles.length > 0).map((c) => [c.cardName ?? c.name, c.roles!] as const),
    );
    // resolveDeck returns one entry per COPY, so this is where multiplicity still exists -- the
    // graph builder keys nodes by card id and collapses it. Count before it is lost.
    const names = (cards as Array<{ name: string }>).map((c) => c.name);
    const copiesByName = new Map<string, number>();
    for (const n of names) copiesByName.set(n, (copiesByName.get(n) ?? 0) + 1);
    const graph = await this.deps.graph(names, rolesByName, copiesByName, report);
    const totalCount = commanderNames.length + sections.deck.length;
    return { report, missing, resolvedCount: cards.length, totalCount, commanderColorIdentity, graph };
  }
}
