import { Module, type OnModuleDestroy, Inject } from "@nestjs/common";
import type { Db } from "mongodb";
import type { CardTagsLookup, ProjectedGraph } from "@mtg/matcher";
import { ANALYZE_DEPS, type AnalyzeDeps } from "../analyze/analyze.service.js";
import { CALIBRATE_DEPS, type CalibrateDeps } from "../calibrate/calibrate.service.js";
import { makeCalibrateDeps } from "../calibrate/calibrate.deps.js";
import type { WireGraph } from "../analyze/analyze.types.js";

export const STORE = "MONGO_STORE";

/** The projection keys every node by card NAME (`ProjectedNode.id`), the same key the report's
 *  `rolesByName` arrives under -- so joining roles no longer needs the oracleId indirection the
 *  old `card:<uuid>`-keyed graph required. `docs` still earns its keep for two facts the
 *  projection doesn't carry: `typeLine` (for the lands room) and the art crop.
 *
 *  `normalize` is injected rather than imported so this stays a plain, deterministic function of
 *  its arguments, testable without touching `@mtg/data` -- it does `console.warn` on an unjoined
 *  roles count, so not literally pure. A miss there is a data gap (stale report, name drift), not
 *  a caller bug worth failing the whole request over.
 *
 *  `copies` needs no join at all: `projectDeckGraph` already counts it off the deck array, so it
 *  rides straight through on the node. */
export function attachRolesAndArt(
  graph: ProjectedGraph,
  docs: Array<{ _id: string; name: string; typeLine?: string; artCrop?: string; imageUris?: { art_crop?: string } }>,
  rolesByName: Map<string, string[]>,
  normalize: (name: string) => string,
): WireGraph {
  const docByName = new Map(docs.map((d) => [normalize(d.name), d] as const));
  const nodeIds = new Set(graph.nodes.map((n) => normalize(n.id)));

  const rolesByNormalizedName = new Map<string, string[]>();
  let unjoined = 0;
  for (const [name, roles] of rolesByName) {
    const key = normalize(name);
    if (nodeIds.has(key)) rolesByNormalizedName.set(key, roles);
    else unjoined++;
  }
  if (unjoined > 0) {
    console.warn(`graph: ${unjoined} card(s) with report roles did not join to a graph node`);
  }

  const nodes = graph.nodes.map((n) => {
    const key = normalize(n.id);
    const doc = docByName.get(key);
    // Lands is a TYPE room, not a role room: a card is in it because it IS a land. The engine's
    // role field deliberately excludes basics (build.ts's !isBasicLand guard) because it answers
    // "does this pull double duty?", where "Island fills the lands role" is noise -- and that same
    // field drives doubleDutyRating's 1.15x synergy multiplier, so it must not be widened there.
    // The board asks a different question, and answers it here, where the full doc is in hand.
    const isLand = (doc?.typeLine ?? "").toLowerCase().includes("land");
    const base = rolesByNormalizedName.get(key);
    const roles = isLand && !(base ?? []).includes("lands") ? [...(base ?? []), "lands"] : base;
    const artCrop = doc?.artCrop ?? doc?.imageUris?.art_crop;
    return {
      id: n.id,
      label: n.label,
      copies: n.copies,
      types: n.types,
      subtypes: n.subtypes,
      supertypes: n.supertypes,
      colors: n.colors,
      cmc: n.cmc,
      ...(roles && roles.length > 0 ? { roles } : {}),
      ...(artCrop !== undefined ? { artCrop } : {}),
    };
  });

  const edges = graph.edges.map((e) => ({
    from: e.from,
    to: e.to,
    weight: e.weight,
    tags: e.tags,
    reasonTexts: e.reasons.map((r) => r.text),
  }));

  return { nodes, edges, undirectedReasons: graph.undirectedReasons, offDeckReasons: graph.offDeckReasons };
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
            // Re-reads the card DOCUMENTS: resolveDeck hands back engine `Card`s, and the wire node
            // needs the full CardDoc (typeLine, artCrop) that only the corpus row carries.
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
            // The report is what carries the reasons; the projection is a join of two outputs that
            // already exist, not new derivation. `buildGraph`/`addEventEdges` stay in the matcher
            // for the census tooling -- they simply no longer feed the view.
            const report = matcher.analyzeDeckStructured(deckCards as never);
            const reasons = report.edges.flatMap((e) => e.reasons);
            // `deckCards` above is deduped by name (one lookup per unique card), but
            // `projectDeckGraph` counts a node's `copies` off how many times its name appears in
            // the deck array it's given -- fed the deduped array directly, every card, including a
            // deck's basic lands, would silently read back as one copy. `copiesByName` already
            // carries the true per-name count (computed upstream, before dedup); it's used here to
            // re-expand the array projectDeckGraph counts from, not forwarded into
            // attachRolesAndArt, which no longer needs it.
            const projectionDeck = deckCards.flatMap((dc) =>
              Array(copiesByName.get(dc.card.name) ?? 1).fill(dc),
            );
            const projected = matcher.projectDeckGraph(
              projectionDeck as never, reasons, engine.loadImpactWeights(),
            );
            return attachRolesAndArt(projected, docs, rolesByName, data.normalizeName);
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
