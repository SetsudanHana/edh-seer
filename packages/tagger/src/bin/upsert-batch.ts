import { readFileSync } from "node:fs";
import { connect, loadConfig, docToCard } from "@mtg/data";
import { upsertCardTags, type TagCollection } from "../store.js";
import { cardTagsFromRawAbilities, expectsAbilities } from "./corpus-core.js";

const MODEL = "claude-haiku-4-5-subagent";

// Usage: upsert-batch <batch-file.json> <subagent-out.json>
// batch file: [{ oracleId, name, oracleText }]; out file: [{ oracleId, abilities }]
async function main(): Promise<void> {
  const [batchFile, outFile] = process.argv.slice(2);
  if (!batchFile || !outFile) throw new Error("usage: upsert-batch <batch-file> <out-file>");
  const results = JSON.parse(readFileSync(outFile, "utf8")) as { oracleId: string; abilities: unknown[] }[];

  const store = await connect(loadConfig());
  const cardTags = store.db.collection("cardTags") as unknown as TagCollection;
  let ok = 0; const failed: string[] = [];
  for (const r of results) {
    const doc = await store.cards.findOne({ _id: r.oracleId });
    if (!doc) { failed.push(`${r.oracleId} (card doc missing)`); continue; }
    // A genuinely omitted/non-array `abilities` is a subagent flake — leave it untagged so it
    // re-queues, rather than persisting an empty tag that reads as a vanilla card forever. A real
    // empty array (a vanilla card) is fine and still tags as [].
    if (!Array.isArray(r.abilities)) { failed.push(`${doc.name} (no abilities array in output)`); continue; }
    // ...and an EMPTY array is the same flake whenever the card has real rules text. That case used
    // to pass straight through, persisting a tag that reads as a vanilla card; because
    // selectUntagged counts any current-version tag doc as done, the card then never re-queued.
    // 1003 cards reached that state, Supreme Verdict and Bitterblossom among them.
    if (r.abilities.length === 0 && expectsAbilities(doc as unknown as { oracleText?: string; keywords?: string[] })) {
      failed.push(`${doc.name} (empty abilities but card has rules text)`);
      continue;
    }
    try {
      await upsertCardTags(cardTags, cardTagsFromRawAbilities(r.oracleId, docToCard(doc), r.abilities, MODEL));
      ok++;
    } catch (e) { failed.push(`${doc.name}: ${(e as Error).message}`); }
  }
  console.log(`upserted ${ok}/${results.length}; ${failed.length} failed (left untagged, will re-queue).`);
  for (const f of failed) console.log(`  FAILED ${f}`);
  await store.close();
}

main().catch((e) => { console.error("upsert-batch failed:", e); process.exit(1); });
