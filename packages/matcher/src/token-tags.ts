import type { Db } from "mongodb";
import { DERIVED_COLLECTION, type CardTags } from "@mtg/tagger";
import type { TokenRef } from "./tokens.js";

/** Builds the SYNCHRONOUS `tokenTags` lookup `analyzeDeckStructured` takes (Task 6, tokens-as-nodes).
 *
 *  `analyzeDeckStructured` is pure -- no network -- so it cannot resolve a `TokenRef` itself; every
 *  caller that wants token nodes must pre-fetch. Only 94 token rows exist (Task 5), so the whole
 *  join fits in memory: `tokens.printingIds` -> the token's own oracle `_id` -> its
 *  `cardTagsDerived` row. `printingId` is the ONLY key read -- (name, typeLine) is the ambiguous
 *  fallback Task 3/4a exists to retire, so an unresolved `printingId` returns null rather than
 *  guessing by name. */
export async function loadTokenTags(db: Db): Promise<(ref: TokenRef) => CardTags | null> {
  const tokens = await db.collection<{ _id: string; printingIds: string[] }>("tokens").find({}).toArray();
  const derivedRows = await db.collection<CardTags & { isToken?: boolean }>(DERIVED_COLLECTION)
    .find({ isToken: true }).toArray();
  const tagsByOracle = new Map(derivedRows.map((r) => [r.oracleId, r]));
  const tagsByPrintingId = new Map<string, CardTags>();
  for (const t of tokens) {
    const tags = tagsByOracle.get(t._id);
    if (!tags) continue; // token exists in Scryfall's corpus but Task 5 never derived it
    for (const pid of t.printingIds) tagsByPrintingId.set(pid, tags);
  }
  return (ref: TokenRef): CardTags | null =>
    ref.printingId !== undefined ? tagsByPrintingId.get(ref.printingId) ?? null : null;
}
