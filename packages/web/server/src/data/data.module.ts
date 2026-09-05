import { Module, type OnModuleDestroy, Inject } from "@nestjs/common";
import type { Db } from "mongodb";
import type { AnalysisSources } from "@edh-seer/matcher/orchestrate";
import { ANALYZE_DEPS, type AnalyzeDeps } from "../analyze/analyze.service.js";
import { CALIBRATE_DEPS, type CalibrateDeps } from "../calibrate/calibrate.service.js";
import { makeCalibrateDeps } from "../calibrate/calibrate.deps.js";

export const STORE = "MONGO_STORE";

@Module({
  providers: [
    {
      provide: STORE,
      useFactory: async () => {
        const data = await import("@edh-seer/data");
        return data.connect(data.loadConfig());
      },
    },
    {
      provide: CALIBRATE_DEPS,
      inject: [STORE],
      // The calibration tool WRITES to the repository, so it needs the repo root. `process.cwd()`
      // is where the dev server is started from, which is the package or the root; both resolve
      // because the paths are anchored at `packages/`.
      useFactory: async (store: { db: unknown }): Promise<CalibrateDeps> =>
        makeCalibrateDeps(store as never, process.cwd().replace(/\/packages\/.*$/, "")),
    },
    {
      provide: ANALYZE_DEPS,
      inject: [STORE],
      useFactory: async (store: { cards: unknown; combos: unknown; db: unknown }): Promise<AnalyzeDeps> => {
        const data = await import("@edh-seer/data");
        const matcher = await import("@edh-seer/matcher");
        const orchestrate = await import("@edh-seer/matcher/orchestrate");
        const tagger = await import("@edh-seer/tagger");
        // The Mongo-backed half of `AnalysisSources` — the orchestration in
        // `@edh-seer/matcher/orchestrate` is the one copy of the analysis pipeline (commander
        // fallback, colour identity, copy expansion, face splitting, token node collection, token
        // art joining), shared with the static/browser build; this factory supplies its lookups.
        const sources: AnalysisSources = {
          lookup: data.mongoLookup(store as never),
          tagsLookup: tagger.createTagsLookup(store.db as Db),
          tokenTags: await matcher.loadTokenTags(store.db as Db),
          tokenArt: async (oracleIds: string[]) => {
            const rows = await (store.db as Db)
              .collection<{ _id: string; artCrop?: string }>("tokens")
              .find({ _id: { $in: oracleIds } }, { projection: { artCrop: 1 } })
              .toArray();
            return new Map(rows.filter((r) => r.artCrop).map((r) => [r._id, r.artCrop!] as const));
          },
        };
        return {
          parseDecklistSections: data.parseDecklistSections,
          parseLines: data.parseDecklistText,
          makeLookup: () => data.mongoLookup(store as never),
          resolveDeck: (commanderNames, deckNames, lookup) =>
            orchestrate.resolveDeck(commanderNames, deckNames, lookup as never),
          graph: (cardNames, rolesByName, copiesByName, report) =>
            orchestrate.buildWireGraph(cardNames, rolesByName, copiesByName, sources, report as never),
          analyze: (cards, combos, commanderNames, state) =>
            orchestrate.analyzeResolvedDeck(cards as never, combos as never, commanderNames, sources, state),
        };
      },
    },
  ],
  exports: [ANALYZE_DEPS, CALIBRATE_DEPS],
})
export class DataModule implements OnModuleDestroy {
  constructor(@Inject(STORE) private readonly store: { close(): Promise<void> }) {}
  async onModuleDestroy(): Promise<void> {
    await this.store.close();
  }
}
