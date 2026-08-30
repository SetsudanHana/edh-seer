import { normalizeName } from "@edh-seer/data/names";
import { resolveNames, type CardLookup } from "@edh-seer/data/resolve";
import { detectCommanders } from "@edh-seer/data/commander";
import { docToCard } from "@edh-seer/data/docs";
import { ComboIndex, loadImpactWeights, type Card, type Combo, type DeckReport } from "@edh-seer/engine";
import type { CardTags } from "@edh-seer/tagger";
import { buildDeckCards, type CardTagsLookup } from "./deck-cards.js";
import { analyzeDeckStructured, collectTokenNodes } from "./analyze.js";
import { faceDeckCards } from "./faces.js";
import { nodeId, projectDeckGraph } from "./graph-projection.js";
import { attachRolesAndArt, type WireGraph } from "./wire-graph.js";
import type { TokenRef } from "./tokens.js";

export interface AnalysisSources {
  lookup: CardLookup;
  tagsLookup: CardTagsLookup;
  /** What `loadTokenTags(db)` returns — resolved up front because `analyzeDeckStructured` is pure
   *  and takes a SYNCHRONOUS lookup. */
  tokenTags: (ref: TokenRef) => CardTags | null;
  /** Token node id (`token:<name>`) -> art crop. The server reads the `tokens` collection; the
   *  client reads the built artifact. */
  tokenArt(oracleIds: string[]): Promise<Map<string, string>>;
}

export async function resolveDeck(
  commanderNames: string[],
  deckNames: string[],
  lookup: CardLookup,
): Promise<{
  cards: Card[];
  combos: Combo[];
  missing: string[];
  commanderResolved: string[];
  commanderColorIdentity: string[];
}> {
  const names = [...commanderNames, ...deckNames];
  const { cards, combos, missing } = await resolveNames(names, lookup);
  const allCards = cards as Array<Parameters<typeof detectCommanders>[0][number]>;
  const cmdNorm = new Set(commanderNames.map(normalizeName));
  let commanderCards = allCards.filter((c) => cmdNorm.has(normalizeName(c.name)));
  // No explicit commander (no Commander section, no commander field, or it didn't
  // resolve): a Commander deck still has one, and exports that omit the section list
  // it first — detect it from the head of the decklist. `cards` preserves paste order,
  // and with no explicit commander names it is exactly the decklist in order.
  if (commanderCards.length === 0) {
    commanderCards = detectCommanders(allCards);
  }
  const commanderResolved = commanderCards.map((c) => c.name);
  // Deck color identity comes from the commander(s) only, per MTG rules — never a
  // union of every card's colors, which would drift from what a player calls "on-color".
  const commanderColorIdentity = [...new Set(commanderCards.flatMap((c) => c.colorIdentity ?? []))];
  return { cards, combos, missing, commanderResolved, commanderColorIdentity };
}

/** NOT called `analyzeDeck`: the client already exports a function by that name from `api.ts`, and
 *  Task 7 imports both into the same neighbourhood. */
export async function analyzeResolvedDeck(
  cards: Card[],
  combos: Combo[],
  commanderNames: string[],
  sources: AnalysisSources,
): Promise<DeckReport> {
  const deckCards = await buildDeckCards(cards, sources.lookup, sources.tagsLookup);
  // Same token lookup `buildWireGraph` uses -- the two must agree, or the report's
  // `tokenNodes` (which the view's toggle reads) would describe a different deck than the
  // board draws.
  return analyzeDeckStructured(
    deckCards,
    commanderNames,
    undefined,
    undefined,
    new ComboIndex(combos),
    undefined,
    sources.tokenTags,
  );
}

export async function buildWireGraph(
  cardNames: string[],
  rolesByName: Map<string, string[]>,
  copiesByName: Map<string, number>,
  sources: AnalysisSources,
): Promise<WireGraph> {
  // Re-reads the card DOCUMENTS: resolveDeck hands back engine `Card`s, and the wire node
  // needs the full CardDoc (typeLine, artCrop) that only the corpus row carries.
  const lookup = sources.lookup;
  // Goes through the SAME composed lookup as `analyzeResolvedDeck` above. It used to query
  // cardTags directly, which meant TAGS_SOURCE could not reach it -- the graph view and the
  // analysis would have rendered different edges for the same deck.
  const tagsLookup = sources.tagsLookup;
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
    const doc = await lookup.findByName(normalizeName(name));
    if (!doc) continue;
    docs.push(doc);
    deckCards.push({ card: docToCard(doc), tags: await tagsLookup.findOne(doc._id) });
  }
  // The report is what carries the reasons; the projection is a join of two outputs that
  // already exist, not new derivation. `buildGraph`/`addEventEdges` stay in the matcher
  // for the census tooling -- they simply no longer feed the view.
  // Tokens are nodes (tokens-as-nodes, 2026-08-15). Already resolved on `sources` --
  // `loadTokenTags` reads the whole `tokens` collection once (a few hundred rows) and joins it
  // to the derived token rows, and `analyzeDeckStructured` is pure and takes a SYNCHRONOUS lookup.
  const tokenTags = sources.tokenTags;
  const report = analyzeDeckStructured(
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
  ).flatMap((dc) => faceDeckCards(dc as never));
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
  const tokenNodes = collectTokenNodes(deckCards as never, tokenTags).nodes;
  projectionDeck.push(...tokenNodes);
  // TOKEN ART, joined on the token's ORACLE id -- `tags.oracleId` on a token node IS the
  // `tokens` row's `_id` (that is what `loadTokenTags` keys its synthesis on), so this is
  // the exact join, not the (name, typeLine) guess Task 3/4a retired. Keyed OUT by node id
  // because that is what `attachRolesAndArt` sees.
  // CEILING: two DIFFERENT tokens sharing a name collapse to one node id already (that is
  // `nodeId`'s granularity, not this join's) -- last one wins here; give a node its oracle
  // id if that ever needs separating.
  const tokenArtById = new Map<string, string>();
  if (tokenNodes.length > 0) {
    const oracleIds = [...new Set(tokenNodes.map((t) => t.tags!.oracleId))];
    const artByOracle = await sources.tokenArt(oracleIds);
    for (const t of tokenNodes) {
      const art = artByOracle.get(t.tags!.oracleId);
      if (art) tokenArtById.set(nodeId(t.card.name, true), art);
    }
  }
  const projected = projectDeckGraph(
    projectionDeck as never, reasons, loadImpactWeights(),
  );
  return attachRolesAndArt(projected, docs, rolesByName, normalizeName, tokenArtById);
}
