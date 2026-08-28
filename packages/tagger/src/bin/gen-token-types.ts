/** Regenerates the token subtype -> card type map from the `tokens` collection.
 *
 *  FREE: one Mongo read, no API key, no model, no spend. Re-run it whenever `ingest-tokens.ts` does.
 *
 *  Writes:
 *    packages/tagger/src/derive/token-types.json
 *
 *  Usage: tsx --env-file=packages/tagger/.env src/bin/gen-token-types.ts [--check]
 *    --check writes nothing and exits non-zero if the artifact is stale, for CI.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, loadConfig } from "@edh-seer/data";
import { buildTokenTypes } from "../derive/token-types.js";

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const store = await connect(loadConfig());
  const lines = (await store.db.collection("tokens").distinct("typeLine")) as string[];
  await store.close();

  const map = buildTokenTypes(lines);
  const rendered = `${JSON.stringify(map, null, 0)}\n`;
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "derive", "token-types.json");

  if (check) {
    const current = readFileSync(path, "utf8");
    if (current !== rendered) {
      console.error("token-types.json is STALE — re-run gen-token-types.ts");
      process.exit(1);
    }
    console.log(`token-types.json is current (${Object.keys(map).length} subtypes)`);
    return;
  }

  writeFileSync(path, rendered);
  console.log(`wrote ${Object.keys(map).length} token subtypes from ${lines.length} type-lines to ${path}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("gen-token-types failed:", err);
    process.exit(1);
  });
}
