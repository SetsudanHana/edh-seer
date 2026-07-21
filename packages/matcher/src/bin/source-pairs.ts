import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connect, loadConfig, mongoLookup, normalizeName } from "@mtg/data";
import { MECHANISM_CATEGORIES, type MechanismCategory } from "../mechanisms.js";
import { CATEGORY_EDHREC_TAG, parseHighSynergy, pairsFromCards, tagUrl } from "./edhrec-core.js";
import { dedupeAndBuild } from "./propose-pairs-core.js";
import type { GoldPair } from "./eval-pairs-core.js";

const GOLD_URL = new URL("../goldpairs.json", import.meta.url);

async function main(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith("--category="))?.slice("--category=".length);
  const topK = Number(process.argv.find((a) => a.startsWith("--topK="))?.slice("--topK=".length) ?? "6");
  const categories: MechanismCategory[] =
    arg === "all" || arg === undefined
      ? [...MECHANISM_CATEGORIES]
      : (MECHANISM_CATEGORIES.includes(arg as MechanismCategory) ? [arg as MechanismCategory] : []);
  if (categories.length === 0) {
    throw new Error(`--category must be "all" or one of: ${MECHANISM_CATEGORIES.join(", ")}`);
  }

  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  let gold = JSON.parse(readFileSync(GOLD_URL, "utf8")) as GoldPair[];

  for (const category of categories) {
    const slug = CATEGORY_EDHREC_TAG[category];
    const res = await fetch(tagUrl(slug));
    if (!res.ok) {
      console.log(`${category} (${slug}): HTTP ${res.status} — skipped`);
      continue;
    }
    const raw = pairsFromCards(parseHighSynergy(await res.json()), topK, category);

    // Resolve each distinct card name once against Mongo.
    const resolved = new Map<string, string | null>();
    for (const p of raw) {
      for (const name of [p.a, p.b]) {
        if (resolved.has(name)) continue;
        const doc = await lookup.findByName(normalizeName(name));
        resolved.set(name, doc ? (doc as { name: string }).name : null);
      }
    }
    const { accepted, duplicates, unresolved } = dedupeAndBuild(
      raw,
      category,
      gold,
      (name) => resolved.get(name) ?? null,
    );
    gold = [...gold, ...accepted];
    console.log(
      `${category} (${slug}): +${accepted.length} unverified, ${duplicates.length} dup, ${unresolved.length} unresolved`,
    );
  }

  await store.close();
  writeFileSync(fileURLToPath(GOLD_URL), JSON.stringify(gold, null, 2) + "\n");
  console.log(`goldpairs.json now ${gold.length} entries (${gold.filter((p) => p.verified).length} verified).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("source-pairs failed:", err);
    process.exit(1);
  });
}
