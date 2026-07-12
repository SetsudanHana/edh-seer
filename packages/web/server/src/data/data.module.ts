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
          parseDecklistText: data.parseDecklistText,
          makeLookup: () => data.mongoLookup(store as never),
          resolveNames: (names, lookup) => data.resolveNames(names, lookup as never),
          analyze: (cards, combos) =>
            engine.analyzeDeck(cards as never, new engine.ComboIndex(combos as never)),
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
