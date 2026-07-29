import type { CardTags } from "./schema.js";

/** The subset of a mongodb Collection<CardTags> this module needs. */
export interface TagCollection {
  updateOne(
    filter: { oracleId: string },
    update: { $set: CardTags },
    opts: { upsert: true },
  ): Promise<unknown>;
  findOne(filter: { oracleId: string }): Promise<CardTags | null>;
}

export async function upsertCardTags(col: TagCollection, tags: CardTags): Promise<void> {
  await col.updateOne({ oracleId: tags.oracleId }, { $set: tags }, { upsert: true });
}

export function needsRetag(
  existing: CardTags | null,
  schemaVersion: number,
  promptVersion: number,
): boolean {
  if (!existing) return true;
  if (existing.pinned) return false;
  return existing.schemaVersion !== schemaVersion || existing.promptVersion !== promptVersion;
}
