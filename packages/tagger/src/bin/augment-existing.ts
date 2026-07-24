import { connect, loadConfig, type CardDoc } from "@mtg/data";
import { upsertCardTags, type TagCollection } from "../store.js";
import type { CardTags } from "../schema.js";
import { augmentKeywordAbilities } from "../keyword-augment.js";

// Usage: augment-existing
// One-off migration: re-applies deterministic keyword augmentation (see keyword-augment.ts) to
// every already-tagged card, upserting only those whose ability set actually grew. Idempotent —
// a second run changes 0. Run with Mongo up, sandbox OFF (operational, main-thread).
async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const cardTags = store.db.collection("cardTags") as unknown as TagCollection;

  // oracleId (== CardDoc._id) -> oracleText, for the keyword match.
  const oracleText = new Map<string, string>();
  for (const c of (await store.db.collection("cards").find({}).toArray()) as unknown as CardDoc[]) {
    oracleText.set(c._id, c.oracleText);
  }

  const all = (await store.db.collection("cardTags").find({}).toArray()) as unknown as CardTags[];
  let changed = 0;
  for (const tags of all) {
    const text = oracleText.get(tags.oracleId);
    if (text === undefined) continue; // tag with no matching card doc — skip
    const augmented = augmentKeywordAbilities(text, tags.abilities);
    if (augmented.length === tags.abilities.length) continue; // no new signal
    await upsertCardTags(cardTags, { ...tags, abilities: augmented });
    changed++;
  }
  console.log(`augment-existing: scanned ${all.length} tagged cards, updated ${changed}.`);
  await store.close();
}

main().catch((e) => { console.error("augment-existing failed:", e); process.exit(1); });
