import type { GameState } from "@edh-seer/engine";
import { normalizeName } from "@edh-seer/data/names";
import { parseDecklistSections } from "@edh-seer/data/sections";
import { parseDecklistText } from "@edh-seer/data/decklist";
import { StaticLookup } from "@edh-seer/matcher/static-lookup";
import { resolveDeck, analyzeResolvedDeck, buildWireGraph, type AnalysisSources } from "@edh-seer/matcher/orchestrate";
import type { AnalyzeResponse } from "./types.js";

/** Reproduces `AnalyzeService.analyze` exactly -- same ordering, same comments carried with it --
 *  against `StaticLookup` instead of Mongo. No server anywhere on this path. */
export async function analyzeDeckStatic(
  decklist: string, commanders: string | undefined, baseUrl: string, fetchImpl: typeof fetch = fetch,
  state?: GameState,
): Promise<AnalyzeResponse> {
  const sections = parseDecklistSections(decklist);
  const commanderNames = commanders?.trim() ? parseDecklistText(commanders) : sections.commanders;

  // `StaticLookup` binds `fetchImpl` itself now (see its constructor) -- the receiver-check defect
  // this fixed lives at the one place every caller routes through, not at each call site.
  const lookup = new StaticLookup(baseUrl, fetchImpl);
  await lookup.prefetch([...commanderNames, ...sections.deck].map(normalizeName));

  const sources: AnalysisSources = {
    lookup, tagsLookup: lookup,
    tokenTags: await lookup.tokenTags(),
    tokenArt: (ids: string[]) => lookup.tokenArt(ids),
  };
  const { cards, combos, missing, commanderResolved, commanderColorIdentity } =
    await resolveDeck(commanderNames, sections.deck, lookup);
  const report = await analyzeResolvedDeck(cards, combos, commanderResolved, sources, state);
  // KEYED ON THE PHYSICAL CARD (`cardName ?? name`), because `attachRolesAndArt` looks roles up
  // under `normalize(n.cardName ?? n.id)`. `report.cards[].name` is a FACE name, so keying on it
  // drops every multi-face card's roles — announced only by a console.warn nobody reads.
  const rolesByName = new Map(
    report.cards.filter((c) => c.roles?.length).map((c) => [c.cardName ?? c.name, c.roles!] as const),
  );
  // `cards` has one entry per COPY; the graph collapses them. Count before the multiplicity is lost.
  const names = cards.map((c) => c.name);
  const copiesByName = new Map<string, number>();
  for (const n of names) copiesByName.set(n, (copiesByName.get(n) ?? 0) + 1);
  const graph = await buildWireGraph(names, rolesByName, copiesByName, sources, report);
  return { report, missing, resolvedCount: cards.length,
    totalCount: commanderNames.length + sections.deck.length, commanderColorIdentity, graph };
}
