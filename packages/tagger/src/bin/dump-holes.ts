import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig, type CardDoc, scratchDir } from "@edh-seer/data";
import { expectsAbilities, renderPreamble } from "./corpus-core.js";

/** Dumps the cards `dump-untagged` structurally cannot see: those that DO have a cardTags document
 *  but recorded zero abilities despite having real rules text. `selectUntagged` counts any
 *  current-version tag doc as done, so these never re-queue no matter how long the grind runs —
 *  they are invisible to the structured matcher, which reads abilities and nothing else.
 *
 *  Same output contract as dump-untagged (batch-N.json of {oracleId,name,oracleText}), so
 *  tag-batch-api and upsert-batch consume it unchanged. Most-played first, so a partial run fixes
 *  the cards that matter most.
 *
 *  Usage: dump-holes [--batches K] [--size N] [--out DIR] */
async function main(): Promise<void> {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
  const batches = Number(args.get("batches") ?? 6);
  const size = Number(args.get("size") ?? 40);
  const outDir = args.get("out") ?? scratchDir("mtg-tag-holes");

  const store = await connect(loadConfig());
  const emptyIds = new Set<string>();
  for (const t of await store.db
    .collection("cardTags")
    .find({ $or: [{ abilities: { $size: 0 } }, { abilities: { $exists: false } }] }, { projection: { oracleId: 1 } })
    .toArray()) {
    emptyIds.add((t as unknown as { oracleId: string }).oracleId);
  }

  const cards = (await store.db.collection("cards").find({ _id: { $in: [...emptyIds] as never[] } }).toArray()) as unknown as CardDoc[];
  const rank = (c: CardDoc): number => c.edhrecRank ?? Number.POSITIVE_INFINITY;
  const holes = cards
    .filter((c) => expectsAbilities(c))
    .sort((x, y) => rank(x) - rank(y) || x._id.localeCompare(y._id))
    .slice(0, batches * size);

  const keywordOnly = cards.length - cards.filter((c) => expectsAbilities(c)).length;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "preamble.txt"), holes.length ? renderPreamble(holes[0]) : "");
  let written = 0;
  for (let i = 0; i < holes.length; i += size) {
    const batch = holes.slice(i, i + size).map((c) => ({ oracleId: c._id, name: c.name, oracleText: c.oracleText }));
    writeFileSync(join(outDir, `batch-${written}.json`), JSON.stringify(batch, null, 1));
    written++;
  }
  console.log(`empty-ability tag docs: ${emptyIds.size} (${keywordOnly} legitimately vanilla/keyword-only)`);
  console.log(`dumped ${holes.length} holes into ${written} batch file(s) at ${outDir}`);
  if (holes.length) console.log(`most-played first: ${holes.slice(0, 3).map((c) => c.name).join(", ")}`);
  await store.close();
}

main().catch((e) => { console.error("dump-holes failed:", e); process.exit(1); });
