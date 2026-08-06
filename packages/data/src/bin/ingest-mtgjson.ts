/** Merges MTGJSON's AtomicCards fields onto our Scryfall-based `cards`, joined on oracle id.
 *
 *  FREE: one 50MB gzipped file, no API key, no model, no spend. Cached on disk, so re-running costs
 *  nothing.
 *
 *  ADDS ONLY. Nothing Scryfall already gives us is touched — not keywords, colors, legalities or
 *  layout. Two sources silently disagreeing is worse than one source and a missing field.
 *
 *  What it brings that we had no way to know:
 *    types/supertypes/subtypes  as ARRAYS, where we regex-split a type line
 *    producedMana               which mana a card makes, for ramp and fixing roles
 *    rulings                    official disambiguation of the semantics we infer
 *    edhrecSaltiness, leadershipSkills, loyalty, defense, isFunny, isOnlineOnly
 *
 *  NOT here: `cardParts`, the meld relation. It is a PRINTING-level field, absent from AtomicCards,
 *  and needs the per-set files or AllPrintings. `relatedCards` in AtomicCards is only
 *  {tokens, spellbook}.
 *
 *  Usage: tsx src/bin/ingest-mtgjson.ts [--dry-run]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, loadConfig } from "@mtg/data";
import { buildMerge, type AtomicFace } from "./ingest-mtgjson-core.js";

const URL = "https://mtgjson.com/api/v5/AtomicCards.json.gz";

async function cachedPayload(cachePath: string): Promise<Record<string, AtomicFace[]>> {
  if (!existsSync(cachePath)) {
    mkdirSync(dirname(cachePath), { recursive: true });
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`MTGJSON fetch failed: ${res.status}`);
    writeFileSync(cachePath, Buffer.from(await res.arrayBuffer()));
  }
  return (JSON.parse(gunzipSync(readFileSync(cachePath)).toString("utf8")) as {
    data: Record<string, AtomicFace[]>;
  }).data;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const cache = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".mtgjson-cache", "AtomicCards.json.gz");
  const data = await cachedPayload(cache);
  const merge = buildMerge(data);
  console.log(`atomic entries ${Object.keys(data).length} | faces with mergeable fields ${merge.size}`);

  const store = await connect(loadConfig());
  const cards = store.db.collection("cards");
  const ids = new Set((await cards.find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
  const matched = [...merge.keys()].filter((id) => ids.has(id));
  console.log(`our cards ${ids.size} | matched by oracle id ${matched.length} (${(100 * matched.length / ids.size).toFixed(1)}%)`);

  if (dryRun) {
    console.log("DRY RUN — nothing written. Sample:");
    for (const id of matched.slice(0, 3)) console.log(`  ${id}: ${JSON.stringify(merge.get(id)).slice(0, 160)}`);
    await store.close();
    return;
  }

  const ops = matched.map((id) => ({
    updateOne: { filter: { _id: id as never }, update: { $set: merge.get(id)! } },
  }));
  for (let i = 0; i < ops.length; i += 2000) {
    await cards.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
  }
  console.log(`merged ${ops.length} card(s)`);
  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
