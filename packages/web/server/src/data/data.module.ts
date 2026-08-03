import { Module, type OnModuleDestroy, Inject } from "@nestjs/common";
import type { Db } from "mongodb";
import type { CardTags } from "@mtg/tagger";
import type { CardGraph, CardTagsLookup } from "@mtg/matcher";
import { ANALYZE_DEPS, type AnalyzeDeps } from "../analyze/analyze.service.js";
import type { WireGraph } from "../analyze/analyze.types.js";

export const STORE = "MONGO_STORE";

/** The report keys cards by name; the graph keys nodes by oracleId (`card:<oracleId>`). Join
 *  through `docs` -- the same array `buildGraph` read -- rather than re-resolving names again,
 *  so the mapping cannot drift from what's actually in the graph. `normalize` is injected rather
 *  than imported so this stays a plain, deterministic function of its arguments, testable without
 *  touching `@mtg/data` -- it does `console.warn` on an unjoined count, so not literally pure.
 *
 *  Also strips node props down to `roles`/`artCrop` for the wire: the browser view otherwise
 *  reads id/kind/label only, while `legalities` alone (24 formats on every card node) is 81KB of
 *  the 269KB graph.
 *
 *  A card the report gave roles to should always resolve to a node here (same corpus, same
 *  names) -- when it doesn't, that's a data gap (stale report, name drift), not a caller bug
 *  worth failing the whole request over, so it's logged rather than thrown. Contrast
 *  `addEventEdges`'s own throw: that mismatch would mean the caller built two card lists that
 *  disagree with each other, which is always a bug in the caller. */
export function attachRolesAndArt(
  graph: CardGraph,
  docs: Array<{ _id: string; name: string }>,
  rolesByName: Map<string, string[]>,
  normalize: (name: string) => string,
): WireGraph {
  const oracleIdByName = new Map(docs.map((d) => [normalize(d.name), d._id]));
  const rolesByOracleId = new Map<string, string[]>();
  let unjoined = 0;
  for (const [name, roles] of rolesByName) {
    const oracleId = oracleIdByName.get(normalize(name));
    if (oracleId) rolesByOracleId.set(oracleId, roles);
    else unjoined++;
  }
  if (unjoined > 0) {
    console.warn(`graph: ${unjoined} card(s) with report roles did not join to a graph node`);
  }

  const nodes = graph.nodes.map(({ id, kind, label, props }) => {
    const roles = kind === "card" ? rolesByOracleId.get(id.slice("card:".length)) : undefined;
    const artCrop = props?.artCrop as string | undefined;
    return {
      id,
      kind,
      label,
      ...(roles && roles.length > 0 ? { roles } : {}),
      ...(artCrop !== undefined ? { artCrop } : {}),
    };
  });
  return { nodes, edges: graph.edges };
}

@Module({
  providers: [
    {
      provide: STORE,
      useFactory: async () => {
        const data = await import("@mtg/data");
        return data.connect(data.loadConfig());
      },
    },
    {
      provide: ANALYZE_DEPS,
      inject: [STORE],
      useFactory: async (store: { cards: unknown; combos: unknown; db: unknown }): Promise<AnalyzeDeps> => {
        const data = await import("@mtg/data");
        const engine = await import("@mtg/engine");
        const matcher = await import("@mtg/matcher");
        return {
          parseDecklistSections: data.parseDecklistSections,
          parseLines: data.parseDecklistText,
          makeLookup: () => data.mongoLookup(store as never),
          resolveDeck: async (commanderNames: string[], deckNames: string[], lookup: unknown) => {
            const names = [...commanderNames, ...deckNames];
            const { cards, combos, missing } = await data.resolveNames(names, lookup as never);
            const allCards = cards as Array<Parameters<typeof data.detectCommanders>[0][number]>;
            const cmdNorm = new Set(commanderNames.map(data.normalizeName));
            let commanderCards = allCards.filter((c) => cmdNorm.has(data.normalizeName(c.name)));
            // No explicit commander (no Commander section, no commander field, or it didn't
            // resolve): a Commander deck still has one, and exports that omit the section list
            // it first — detect it from the head of the decklist. `cards` preserves paste order,
            // and with no explicit commander names it is exactly the decklist in order.
            if (commanderCards.length === 0) {
              commanderCards = data.detectCommanders(allCards);
            }
            const commanderResolved = commanderCards.map((c) => c.name);
            // Deck color identity comes from the commander(s) only, per MTG rules — never a
            // union of every card's colors, which would drift from what a player calls "on-color".
            const commanderColorIdentity = [...new Set(commanderCards.flatMap((c) => c.colorIdentity ?? []))];
            return { cards, combos, missing, commanderResolved, commanderColorIdentity };
          },
          graph: async (cardNames: string[], rolesByName: Map<string, string[]>) => {
            // Re-reads the card DOCUMENTS: resolveDeck hands back engine `Card`s, and buildGraph
            // needs the full CardDoc (faces, all_parts, legalities) that only the corpus row carries.
            const lookup = data.mongoLookup(store as never);
            const cardTagsCol = (store.db as Db).collection<CardTags>("cardTags");
            const docs: Array<{ _id: string; name: string }> = [];
            const deckCards = [];
            for (const name of new Set(cardNames)) {
              const doc = await lookup.findByName(data.normalizeName(name));
              if (!doc) continue;
              docs.push(doc);
              deckCards.push({ card: data.docToCard(doc as never), tags: await cardTagsCol.findOne({ oracleId: doc._id }) });
            }
            // Same card list feeds both halves -- addEventEdges throws if they ever diverge.
            const graph = matcher.addEventEdges(matcher.buildGraph(docs as never), deckCards as never, matcher.loadHierarchy());
            return attachRolesAndArt(graph, docs, rolesByName, data.normalizeName);
          },
          analyze: async (cards, combos, commanderNames) => {
            const lookup = data.mongoLookup(store as never);
            const cardTagsCol = (store.db as Db).collection<CardTags>("cardTags");
            const tagsLookup: CardTagsLookup = { findOne: (oracleId) => cardTagsCol.findOne({ oracleId }) };
            const deckCards = await matcher.buildDeckCards(cards as never, lookup, tagsLookup);
            return matcher.analyzeDeckStructured(
              deckCards,
              commanderNames,
              undefined,
              undefined,
              new engine.ComboIndex(combos as never),
            );
          },
        };
      },
    },
  ],
  exports: [ANALYZE_DEPS],
})
export class DataModule implements OnModuleDestroy {
  constructor(@Inject(STORE) private readonly store: { close(): Promise<void> }) {}
  async onModuleDestroy(): Promise<void> {
    await this.store.close();
  }
}
