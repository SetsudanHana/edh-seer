import type { Db } from "mongodb";
import { DERIVED_COLLECTION, SCHEMA_VERSION, extractCharacteristics, type CardTags } from "@mtg/tagger";
import type { TokenRef } from "./tokens.js";

/** The `tokens` collection's own shape (packages/data/src/bin/ingest-tokens-core.ts's `TokenDoc`),
 *  restated here rather than imported cross-package for the handful of fields this file reads. */
export interface TokenDocShape {
  _id: string;
  name: string;
  typeLine?: string;
  oracleText?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  colorIdentity?: string[];
  keywords?: string[];
  layout?: string;
  printingIds: string[];
}

/** A VANILLA token -- no `cardTagsDerived` row, because Task 5 only bought the 94 tokens carrying
 *  oracle text (Finding 3, owner review 2026-08-16). Synthesized rather than dropped: the spec
 *  requires a node for every token the deck can make, and Task 7's mediation needs a Bird/Soldier/
 *  Zombie node to reroute a landfall-style relation onto -- with no node the relation isn't
 *  rerouted, it is deleted.
 *
 *  Same shape `tokenCharsFrom` builds at derive time (tagger/bin/derive-corpus.ts): printed
 *  characteristics via `extractCharacteristics`, `token` flipped to true, `abilities: []`. A vanilla
 *  token really has no abilities -- that is honest, not a gap. What it has is a type line, and its
 *  ENTRY is what an implied event already reads (see `implied.ts`'s `selfSubject`). */
export function synthesizeTokenTags(t: TokenDocShape): CardTags {
  const characteristics = {
    ...extractCharacteristics({
      name: t.name,
      typeLine: t.typeLine ?? "",
      oracleText: t.oracleText ?? "",
      keywords: t.keywords ?? [],
      colors: t.colors ?? [],
      colorIdentity: t.colorIdentity,
      manaValue: 0,
      power: t.power ?? null,
      toughness: t.toughness ?? null,
      layout: t.layout,
    }),
    token: true as const,
  };
  return { oracleId: t._id, schemaVersion: SCHEMA_VERSION, promptVersion: 0, model: "synthesized", characteristics, abilities: [] };
}

/** Builds the SYNCHRONOUS `tokenTags` lookup `analyzeDeckStructured` takes (Task 6, tokens-as-nodes).
 *
 *  `analyzeDeckStructured` is pure -- no network -- so it cannot resolve a `TokenRef` itself; every
 *  caller that wants token nodes must pre-fetch. The whole `tokens` collection fits in memory (a few
 *  hundred rows), so the join is: `tokens.printingIds` -> the token's own oracle `_id` -> either its
 *  `cardTagsDerived` row (94 tokens with oracle text) or a synthesized one (every other resolvable
 *  token). `printingId` is the ONLY key read -- (name, typeLine) is the ambiguous fallback Task 3/4a
 *  exists to retire, so an unresolved `printingId` returns null rather than guessing by name; that
 *  refusal is real (the `tokens` row itself is missing) and stays a refusal, never synthesized. */
export async function loadTokenTags(db: Db): Promise<(ref: TokenRef) => CardTags | null> {
  const tokens = await db.collection<TokenDocShape>("tokens").find({}).toArray();
  const derivedRows = await db.collection<CardTags & { isToken?: boolean }>(DERIVED_COLLECTION)
    .find({ isToken: true }).toArray();
  const tagsByOracle = new Map(derivedRows.map((r) => [r.oracleId, r]));
  const tagsByPrintingId = new Map<string, CardTags>();
  for (const t of tokens) {
    const tags = tagsByOracle.get(t._id) ?? synthesizeTokenTags(t);
    for (const pid of t.printingIds) tagsByPrintingId.set(pid, tags);
  }
  return (ref: TokenRef): CardTags | null =>
    ref.printingId !== undefined ? tagsByPrintingId.get(ref.printingId) ?? null : null;
}
