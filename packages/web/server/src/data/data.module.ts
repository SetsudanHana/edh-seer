import { Module, type OnModuleDestroy, Inject } from "@nestjs/common";
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
      useFactory: async (store: { cards: unknown; combos: unknown }): Promise<AnalyzeDeps> => {
        const data = await import("@mtg/data");
        const engine = await import("@mtg/engine");
        return {
          parseDecklistSections: data.parseDecklistSections,
          parseLines: data.parseDecklistText,
          makeLookup: () => data.mongoLookup(store as never),
          resolveDeck: async (commanderNames: string[], deckNames: string[], lookup: unknown) => {
            const names = [...commanderNames, ...deckNames];
            const { cards, combos, missing } = await data.resolveNames(names, lookup as never);
            const cmdNorm = new Set(commanderNames.map(data.normalizeName));
            const commanderResolved = (cards as Array<{ name: string }>)
              .filter((c) => cmdNorm.has(data.normalizeName(c.name)))
              .map((c) => c.name);
            return { cards, combos, missing, commanderResolved };
          },
          analyze: (cards, combos, commanderNames) =>
            engine.analyzeDeck(cards as never, new engine.ComboIndex(combos as never), commanderNames as string[]),
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
