import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig, type CardDoc } from "@edh-seer/data";
import { needsRetag } from "../store.js";
import { SCHEMA_VERSION } from "../schema.js";
import { PROMPT_VERSION } from "../llm/prompt.js";
import { selectUntagged, renderPreamble } from "./corpus-core.js";

// Usage: dump-untagged [--batches K] [--size N] [--out DIR]
async function main(): Promise<void> {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
  const batches = Number(args.get("batches") ?? 6);
  const size = Number(args.get("size") ?? 40);
  const outDir = args.get("out") ?? "/tmp/mtg-tag-batches";

  const store = await connect(loadConfig());
  const cards = (await store.db.collection("cards").find({}).toArray()) as unknown as CardDoc[];

  // Done set: current-version cardTags.
  const doneIds = new Set<string>();
  for (const t of await store.db.collection("cardTags").find({}).toArray()) {
    if (!needsRetag(t as never, SCHEMA_VERSION, PROMPT_VERSION)) doneIds.add((t as unknown as { oracleId: string }).oracleId);
  }

  const picked = selectUntagged(cards, doneIds, batches * size);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "preamble.txt"), picked.length ? renderPreamble(picked[0]) : "");
  let written = 0;
  for (let i = 0; i < picked.length; i += size) {
    const batch = picked.slice(i, i + size).map((c) => ({ oracleId: c._id, name: c.name, oracleText: c.oracleText }));
    writeFileSync(join(outDir, `batch-${written}.json`), JSON.stringify(batch, null, 1));
    written++;
  }
  console.log(`dumped ${picked.length} cards into ${written} batch file(s) at ${outDir} (preamble.txt written).`);
  // Free to dump; the spend happens in tag-batch-api, which refuses without ALLOW_DEPRECATED_GRIND.
  // Say so here, because this is where the stale count first looks alarming and invites a re-grind.
  if (picked.length) {
    console.log(
      `NOTE: these batches feed the DEPRECATED flat extractor (43/43/13 correct/partial/wrong, ` +
      `30% reproducible). tag-batch-api will refuse to spend without ALLOW_DEPRECATED_GRIND=1.`,
    );
  }
  if (picked.length) console.log(`next edhrecRank window starts at ${picked[0].edhrecRank ?? "unranked"}.`);
  await store.close();
}

main().catch((e) => { console.error("dump-untagged failed:", e); process.exit(1); });
