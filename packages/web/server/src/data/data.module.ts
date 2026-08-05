import { Module, type OnModuleDestroy, Inject } from "@nestjs/common";
import type { Db } from "mongodb";
import type { CardGraph, CardTagsLookup } from "@mtg/matcher";
import { ANALYZE_DEPS, type AnalyzeDeps } from "../analyze/analyze.service.js";
import { CALIBRATE_DEPS, type CalibrateDeps } from "../calibrate/calibrate.service.js";
import { makeCalibrateDeps } from "../calibrate/calibrate.deps.js";
import type { WireGraph } from "../analyze/analyze.types.js";

export const STORE = "MONGO_STORE";

/** Joins a per-name map onto the graph's own key (oracleId) through `oracleIdByName` -- the one
 *  lookup both `rolesByName` and `copiesByName` need, since the wire node is keyed by oracleId but
 *  both maps arrive keyed by the report/decklist's card name. Shared rather than copy-pasted so a
 *  join-logic fix can't happen to only one of them again; `label` keeps a miss diagnosable as "no
 *  roles for X" vs "no copy count for X" -- different bugs -- since the two are otherwise
 *  identical loops. A miss here is a data gap (stale report, name drift), not a caller bug worth
 *  failing the whole request over, so it's logged rather than thrown -- contrast `addEventEdges`'s
 *  own throw, where a mismatch means the caller built two card lists that disagree with each
 *  other, which IS always a caller bug. */
function joinByOracleId<T>(
  byName: Map<string, T>,
  oracleIdByName: Map<string, string>,
  normalize: (name: string) => string,
  label: string,
): Map<string, T> {
  const byOracleId = new Map<string, T>();
  let unjoined = 0;
  for (const [name, value] of byName) {
    const oracleId = oracleIdByName.get(normalize(name));
    if (oracleId) byOracleId.set(oracleId, value);
    else unjoined++;
  }
  if (unjoined > 0) {
    console.warn(`graph: ${unjoined} card(s) with report ${label} did not join to a graph node`);
  }
  return byOracleId;
}

/** The report keys cards by name; the graph keys nodes by oracleId (`card:<oracleId>`). Join
 *  through `docs` -- the same array `buildGraph` read -- rather than re-resolving names again,
 *  so the mapping cannot drift from what's actually in the graph. `normalize` is injected rather
 *  than imported so this stays a plain, deterministic function of its arguments, testable without
 *  touching `@mtg/data` -- it does `console.warn` on an unjoined count, so not literally pure.
 *
 *  Also strips node props down to `roles`/`artCrop`/`copies` for the wire: the browser view
 *  otherwise reads id/kind/label only, while `legalities` alone (24 formats on every card node) is
 *  81KB of the 269KB graph.
 *
 *  `copiesByName` is required, not optional: an optional param here is exactly the shape of bug
 *  this function exists to avoid -- a call site that quietly stops passing it would render every
 *  multi-copy card as a single copy with no signal anywhere (see the fix-round-1 report). The one
 *  production caller (the `graph` dep below) always has the value in hand from the same place
 *  `rolesByName` comes from, so there's no real caller for whom this is a burden. */
export function attachRolesAndArt(
  graph: CardGraph,
  docs: Array<{ _id: string; name: string; typeLine?: string }>,
  rolesByName: Map<string, string[]>,
  normalize: (name: string) => string,
  copiesByName: Map<string, number>,
): WireGraph {
  const oracleIdByName = new Map(docs.map((d) => [normalize(d.name), d._id]));
  const rolesByOracleId = joinByOracleId(rolesByName, oracleIdByName, normalize, "roles");
  const copiesByOracleId = joinByOracleId(copiesByName, oracleIdByName, normalize, "copy counts");
  // Lands is a TYPE room, not a role room: a card is in it because it IS a land. The engine's
  // role field deliberately excludes basics (build.ts's !isBasicLand guard) because it answers
  // "does this pull double duty?", where "Island fills the lands role" is noise -- and that same
  // field drives doubleDutyRating's 1.15x synergy multiplier, so it must not be widened there.
  // The board asks a different question, and answers it here, where the full doc is in hand.
  const isLandByOracleId = new Map(
    docs.map((d) => [d._id, (d.typeLine ?? "").toLowerCase().includes("land")] as const),
  );

  const nodes = graph.nodes.map(({ id, kind, label, props }) => {
    const oracleId = id.slice("card:".length);
    const base = kind === "card" ? rolesByOracleId.get(oracleId) : undefined;
    const roles =
      kind === "card" && isLandByOracleId.get(oracleId) && !(base ?? []).includes("lands")
        ? [...(base ?? []), "lands"]
        : base;
    const artCrop = props?.artCrop as string | undefined;
    const copies = kind === "card" ? copiesByOracleId.get(oracleId) : undefined;
    return {
      id,
      kind,
      label,
      ...(roles && roles.length > 0 ? { roles } : {}),
      ...(artCrop !== undefined ? { artCrop } : {}),
      ...(copies !== undefined && copies > 1 ? { copies } : {}),
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
        const data = await import("@mtg/data");
        const engine = await import("@mtg/engine");
        const matcher = await import("@mtg/matcher");
        const tagger = await import("@mtg/tagger");
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
          graph: async (
            cardNames: string[],
            rolesByName: Map<string, string[]>,
            copiesByName: Map<string, number>,
          ) => {
            // Re-reads the card DOCUMENTS: resolveDeck hands back engine `Card`s, and buildGraph
            // needs the full CardDoc (faces, all_parts, legalities) that only the corpus row carries.
            const lookup = data.mongoLookup(store as never);
            // Goes through the SAME composed lookup as `analyze` below. It used to query cardTags
            // directly, which meant TAGS_SOURCE could not reach it -- the graph view and the
            // analysis would have rendered different edges for the same deck.
            const tagsLookup = tagger.createTagsLookup(store.db as Db);
            const docs: Array<{ _id: string; name: string; typeLine?: string }> = [];
            const deckCards = [];
            for (const name of new Set(cardNames)) {
              const doc = await lookup.findByName(data.normalizeName(name));
              if (!doc) continue;
              docs.push(doc);
              deckCards.push({ card: data.docToCard(doc as never), tags: await tagsLookup.findOne(doc._id) });
            }
            // Same card list feeds both halves -- addEventEdges throws if they ever diverge.
            const graph = matcher.addEventEdges(matcher.buildGraph(docs as never), deckCards as never, matcher.loadHierarchy());
            return attachRolesAndArt(graph, docs, rolesByName, data.normalizeName, copiesByName);
          },
          analyze: async (cards, combos, commanderNames) => {
            const lookup = data.mongoLookup(store as never);
            const tagsLookup: CardTagsLookup = tagger.createTagsLookup(store.db as Db);
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
  exports: [ANALYZE_DEPS, CALIBRATE_DEPS],
})
export class DataModule implements OnModuleDestroy {
  constructor(@Inject(STORE) private readonly store: { close(): Promise<void> }) {}
  async onModuleDestroy(): Promise<void> {
    await this.store.close();
  }
}
