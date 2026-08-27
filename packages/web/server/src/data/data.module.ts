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
  docs: Array<{
    _id: string; name: string; typeLine?: string; artCrop?: string;
    imageUris?: { art_crop?: string };
    /** Per-face art, which is where a transform or modal_dfc card's images actually live -- and the
     *  rest of each face, so the panel can show the side the board is not drawing. */
    faces?: Array<{ name?: string; typeLine?: string; manaCost?: string; oracleText?: string; artCrop?: string }>;
  }>,
  rolesByName: Map<string, string[]>,
  normalize: (name: string) => string,
  /** Token node id (`token:<name>`) -> art crop, from the `tokens` collection. A token joins no
   *  corpus row, so `docs` can never carry its art; the caller resolves it by the token's ORACLE id
   *  and hands the result in keyed by node id. Defaults to empty so a caller with no token nodes
   *  (and every existing test) is unchanged. */
  tokenArtById: Map<string, string> = new Map(),
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
    // A FACE IS A NODE (Task 5). A BACK face's id carries the `face:<n>:` prefix so it never
    // collides with the physical card's node, which means it also never matches a doc by NAME --
    // `cardName` is the fallback for that case (it's set on the FRONT face too, but there it equals
    // `n.id` already, so the fallback is a no-op rather than a special case). A token has no
    // `cardName`, so it keeps its own id: `n.id`, never `n.label` -- a token's label is its bare
    // name ("Treasure") with the `token:` prefix stripped, and keying on it would rejoin a token to
    // a same-named real card's doc, the exact collision `TOKEN_ID_PREFIX` exists to prevent (see the
    // artCrop comment below).
    const key = normalize(n.cardName ?? n.id);
    const doc = docByName.get(key);
    // THE DOCUMENT IS THE PHYSICAL CARD; THE PICTURE, TYPE LINE AND TEXT ARE THE FACE'S. Without
    // this a back-face node draws with the front face's art and the flip is invisible -- two circles
    // for one card that look like duplicates. Undefined on every node that is not a face.
    const face = n.face !== undefined ? doc?.faces?.[n.face] : undefined;
    // Lands is a TYPE room, not a role room: a card is in it because it IS a land. The engine's
    // role field deliberately excludes basics (build.ts's !isBasicLand guard) because it answers
    // "does this pull double duty?", where "Island fills the lands role" is noise -- and that same
    // field drives doubleDutyRating's 1.15x synergy multiplier, so it must not be widened there.
    // The board asks a different question, and answers it here, where the full doc is in hand.
    const isLand = (doc?.typeLine ?? "").toLowerCase().includes("land");
    const base = rolesByNormalizedName.get(key);
    const roles = isLand && !(base ?? []).includes("lands") ? [...(base ?? []), "lands"] : base;
    // A GENUINELY TWO-FACED CARD HAS NO CARD-LEVEL ART. Scryfall puts `image_uris` on each FACE for
    // transform and modal_dfc layouts and omits the top-level one: 861 corpus cards are double-faced
    // and only 370 (43%) carry a card-level artCrop, so Westvale Abbey, Fell the Profane and 489
    // others drew as a blank disc. The FRONT face is the fallback because it is the side the card is
    // played from and the side the board draws; adventure/split/flip are one physical face and keep
    // their card-level art, which still wins here.
    // A TOKEN'S ART COMES FROM THE `tokens` COLLECTION, NEVER FROM `docs`. Keyed on the node id, not
    // the label: 92 of the corpus's 661 token names are also a real card, and a name key would hand
    // the Treasure token the art of a card called Treasure -- the exact confusion `nodeId` exists to
    // prevent. A token with no row in the map keeps the blank dashed disc, which is honest.
    const artCrop = n.isToken
      ? tokenArtById.get(n.id)
      // The face's own picture wins first. Falls back to the card level, then the front-face
      // finder below, for a face whose doc row has no `faces` entry (a stale or unrefreshed doc) --
      // a fallback beats a blank disc.
      : face?.artCrop ?? doc?.artCrop ?? doc?.imageUris?.art_crop ?? doc?.faces?.find((f) => f.artCrop)?.artCrop;
    return {
      id: n.id,
      label: n.label,
      // A token node joins no card doc by design (its id is `token:<name>`, and there is no corpus
      // row for a token) -- so it carries no roles. Its ART comes from `tokenArtById` above.
      ...(n.isToken ? { isToken: true as const } : {}),
      // FACE AND CARDNAME RIDE THE WIRE TOO (Task 8): the board rims the two faces of one card as a
      // pair and the inspector opens on the face that was clicked, both of which need these on the
      // client, not just here where the doc join uses them.
      ...(n.face !== undefined ? { face: n.face } : {}),
      ...(n.cardName !== undefined ? { cardName: n.cardName } : {}),
      copies: n.copies,
      types: n.types,
      subtypes: n.subtypes,
      supertypes: n.supertypes,
      // THE PRINTED TYPE LINE, AND THE FIFTH FIELD THIS JOIN HAS BEEN CAUGHT DROPPING -- after
      // `producedMana`, `allParts`, `gameChanger` and `faces`. This function rebuilds every wire
      // node from an EXPLICIT field list, so a field added to `ProjectedNode` reaches the client
      // only if it is named here; the projection set it, every unit test passed on a fixture that
      // carried it, and a live run read `typeLine: undefined` on 103 of 103 nodes.
      // ADD A FIELD HERE WHEN YOU ADD ONE TO `ProjectedNode`.
      //
      // The projection's copy wins and the doc is the fallback: a TOKEN node joins no doc at all
      // (see the roles comment above), so reading `doc` alone would leave every token without one.
      ...(face?.typeLine ?? n.typeLine ?? doc?.typeLine
        ? { typeLine: face?.typeLine ?? n.typeLine ?? doc?.typeLine } : {}),
      ...(face?.oracleText ?? n.oracleText ? { oracleText: face?.oracleText ?? n.oracleText } : {}),
      // EVERY FACE, so the panel can show the back. Taken from the DOC rather than the projection:
      // faces are printing data the matcher has no use for, and threading them through
      // `ProjectedNode` would put them in the CLI's graph export too. Only when there is more than
      // one -- a single-face card has nothing to flip to, and an array of one is a control that
      // does nothing.
      ...((doc?.faces?.length ?? 0) > 1
        ? { faces: doc!.faces!.map((f) => ({
            name: f.name ?? "",
            ...(f.typeLine ? { typeLine: f.typeLine } : {}),
            ...(f.manaCost ? { manaCost: f.manaCost } : {}),
            ...(f.oracleText ? { oracleText: f.oracleText } : {}),
            ...(f.artCrop ? { artCrop: f.artCrop } : {}),
          })) }
        : {}),
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
    // ONE TRIGGER WITH A CHAIN OF EFFECTS IS ONE SENTENCE TO A READER. Archon of Cruelty's entry
    // trigger derives six reasons identical in tag and text, differing only in `effectKind`, and the
    // inspector printed the line six times -- seen live on the Treasure token panel (three identical
    // "Nadier's Nightblade triggers on a permanent leaving the battlefield" lines). Deduped HERE, on
    // the wire, and not in the reason set: `effectKind` is load-bearing for archetype detection, so
    // the objects must survive even when their sentences do not. Same collapse `claimCount` applies
    // to the score.
    reasonTexts: [...new Set(e.reasons.map((r) => r.text))],
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
            // `faces` is declared because it is genuinely PRESENT — `findByName` returns the whole
            // corpus row with no projection, and a transform/modal_dfc card's only art lives there.
            // Left off the annotation, `attachRolesAndArt`'s face fallback would look like dead code
            // to every reader even though it fires: the same lie that made `Card.faces` appear alive
            // in graph-projection when `docToCard` never copied it.
            const docs: Array<{
              _id: string; name: string; typeLine?: string; artCrop?: string;
              faces?: Array<{ artCrop?: string }>;
            }> = [];
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
            // Tokens are nodes (tokens-as-nodes, 2026-08-15). Resolved up front because
            // `analyzeDeckStructured` is pure and takes a SYNCHRONOUS lookup; `loadTokenTags` reads
            // the whole `tokens` collection once (a few hundred rows) and joins it to the derived
            // token rows.
            const tokenTags = await matcher.loadTokenTags(store.db as Db);
            const report = matcher.analyzeDeckStructured(
              deckCards as never, undefined, undefined, undefined, undefined, undefined, tokenTags,
            );
            const reasons = report.edges.flatMap((e) => e.reasons);
            // `deckCards` above is deduped by name (one lookup per unique card), but
            // `projectDeckGraph` counts a node's `copies` off how many times its name appears in
            // the deck array it's given -- fed the deduped array directly, every card, including a
            // deck's basic lands, would silently read back as one copy. `copiesByName` already
            // carries the true per-name count (computed upstream, before dedup); it's used here to
            // re-expand the array projectDeckGraph counts from, not forwarded into
            // attachRolesAndArt, which no longer needs it.
            // AFTER the copy-expansion, BEFORE the tokens: `faceDeckCards` reads `dc.card.name` to
            // decide whether a card has more than one printed face, and a split entry's `card.name`
            // becomes the FACE's name ("Fell Mire"), which is not a key in `copiesByName` -- doing
            // this before the expansion would silently zero out every multi-face card's copy count.
            // A single-face card and a token pass through unchanged (`faceDeckCards`'s own contract).
            const projectionDeck = deckCards.flatMap((dc) =>
              Array(copiesByName.get(dc.card.name) ?? 1).fill(dc),
            ).flatMap((dc) => matcher.faceDeckCards(dc as never));
            // The SAME node list the edges above were formed over -- `projectDeckGraph` builds its
            // nodes off this array and counts a reason naming anything else as `offDeckReasons`, so
            // without the tokens here every token edge would be silently dropped from the view.
            // One copy each: a token is not a card slot. A token whose name collides with a real
            // card in the deck stays its OWN node -- `projectDeckGraph` keys on `nodeId`, not on the
            // name, because 92 of the corpus's 661 token names are also a real card.
            //
            // `collectTokenNodes` reads the UNSPLIT `deckCards`, not `projectionDeck`: it works off
            // card-level `allParts`, `faceDeckCards` is a no-op on a token, and feeding it the
            // post-split array would buy nothing while inviting a future reader to think token
            // collection needs face-awareness.
            const tokenNodes = matcher.collectTokenNodes(deckCards as never, tokenTags).nodes;
            projectionDeck.push(...tokenNodes);
            // TOKEN ART, joined on the token's ORACLE id -- `tags.oracleId` on a token node IS the
            // `tokens` row's `_id` (that is what `loadTokenTags` keys its synthesis on), so this is
            // the exact join, not the (name, typeLine) guess Task 3/4a retired. Keyed OUT by node id
            // because that is what `attachRolesAndArt` sees.
            // ponytail: two DIFFERENT tokens sharing a name collapse to one node id already (that is
            // `nodeId`'s granularity, not this join's) -- last one wins here; give a node its oracle
            // id if that ever needs separating.
            const tokenArtById = new Map<string, string>();
            if (tokenNodes.length > 0) {
              const oracleIds = [...new Set(tokenNodes.map((t) => t.tags!.oracleId))];
              const rows = await (store.db as Db).collection<{ _id: string; artCrop?: string }>("tokens")
                .find({ _id: { $in: oracleIds } }, { projection: { artCrop: 1 } })
                .toArray();
              const artByOracle = new Map(rows.map((r) => [r._id, r.artCrop]));
              for (const t of tokenNodes) {
                const art = artByOracle.get(t.tags!.oracleId);
                if (art) tokenArtById.set(matcher.nodeId(t.card.name, true), art);
              }
            }
            const projected = matcher.projectDeckGraph(
              projectionDeck as never, reasons, engine.loadImpactWeights(),
            );
            return attachRolesAndArt(projected, docs, rolesByName, data.normalizeName, tokenArtById);
          },
          analyze: async (cards, combos, commanderNames) => {
            const lookup = data.mongoLookup(store as never);
            const tagsLookup: CardTagsLookup = tagger.createTagsLookup(store.db as Db);
            const deckCards = await matcher.buildDeckCards(cards as never, lookup, tagsLookup);
            // Same token lookup the `graph` dep uses -- the two must agree, or the report's
            // `tokenNodes` (which the view's toggle reads) would describe a different deck than the
            // board draws.
            const tokenTags = await matcher.loadTokenTags(store.db as Db);
            return matcher.analyzeDeckStructured(
              deckCards,
              commanderNames,
              undefined,
              undefined,
              new engine.ComboIndex(combos as never),
              undefined,
              tokenTags,
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
