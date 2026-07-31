import { Module, type OnModuleDestroy, Inject } from "@nestjs/common";
import type { Db } from "mongodb";
import type { CardTags } from "@mtg/tagger";
import type { CardTagsLookup } from "@mtg/matcher";
import { ANALYZE_DEPS, type AnalyzeDeps } from "../analyze/analyze.service.js";

export const STORE = "MONGO_STORE";

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
