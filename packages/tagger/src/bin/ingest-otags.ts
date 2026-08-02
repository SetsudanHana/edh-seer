import type { AnyBulkWriteOperation } from "mongodb";
import { connect, loadConfig } from "@mtg/data";
import { loadFunctionalOtags } from "../otags/functional.js";
import { buildCardOtags } from "../otags/build.js";

interface CardOtagDoc {
  _id: string;
  name: string | null;
  otags: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** All oracle_ids Scryfall assigns a given otag (oracle-level, printing-unioned, paper only). */
async function fetchTagOracleIds(slug: string): Promise<string[]> {
  const ids: string[] = [];
  let url =
    `https://api.scryfall.com/cards/search?unique=cards&q=` +
    encodeURIComponent(`otag:${slug} -is:alchemy`);
  while (url) {
    let ok = false;
    for (let a = 0; a < 4 && !ok; a++) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "mtg-synergy-engine/1.0 (otag ingest)",
            "Accept": "application/json",
          },
        });
        if (res.status === 404) return ids; // "no cards match" -> genuine empty tag
        if (!res.ok) {
          // 429 / 5xx -> transient, retry (respect Retry-After if present)
          const ra = Number(res.headers.get("retry-after")) * 1000;
          await sleep(Number.isFinite(ra) && ra > 0 ? ra : 500);
          continue;
        }
        const j = (await res.json()) as {
          data?: { oracle_id: string }[];
          has_more?: boolean;
          next_page?: string;
          object?: string;
        };
        if (j.object === "error") return ids; // rare: 200 with an error body
        for (const c of j.data ?? []) ids.push(c.oracle_id);
        url = j.has_more && j.next_page ? j.next_page : "";
        ok = true;
      } catch {
        await sleep(500);
      }
    }
    if (!ok) throw new Error(`otag fetch for "${slug}" gave up after retries — aborting to avoid committing partial/mislabelled tag data`);
    await sleep(120);
  }
  return ids;
}

// Usage: ingest-otags [--limit N]   (dev: first N functional otags only)
async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const limitIdx = process.argv.indexOf("--limit");
  let slugs = loadFunctionalOtags();
  if (limitIdx >= 0) slugs = slugs.slice(0, Number(process.argv[limitIdx + 1]));

  const cards = await store.cards.find({}).toArray();
  const corpusIds = new Set(cards.map((c) => c._id));
  const nameById = new Map(cards.map((c) => [c._id, c.name]));

  const tagToIds = new Map<string, string[]>();
  const emptyTags: string[] = [];
  for (const slug of slugs) {
    const ids = await fetchTagOracleIds(slug);
    tagToIds.set(slug, ids);
    if (ids.length === 0) emptyTags.push(slug);
    process.stdout.write(`  ${slug}: ${ids.length}\n`);
  }

  const cardOtags = buildCardOtags(tagToIds, corpusIds);
  const col = store.db.collection<CardOtagDoc>("cardOtags");
  const ops: AnyBulkWriteOperation<CardOtagDoc>[] = [...cardOtags].map(([id, otags]) => ({
    updateOne: {
      filter: { _id: id },
      update: { $set: { name: nameById.get(id) ?? null, otags } },
      upsert: true,
    },
  }));
  if (ops.length) await col.bulkWrite(ops, { ordered: false });

  console.log(`\n=== otag ingest coverage ===`);
  console.log(`  corpus cards: ${corpusIds.size}`);
  console.log(`  cards with >=1 otag: ${cardOtags.size} (${((100 * cardOtags.size) / corpusIds.size).toFixed(0)}%)`);
  console.log(`  empty tags (prune candidates): ${emptyTags.length ? emptyTags.join(", ") : "none"}`);
  for (const n of ["Blood Artist", "Viscera Seer", "Impact Tremors"]) {
    const doc = await col.findOne({ name: n });
    console.log(`  ${n}: ${doc?.otags?.join(", ") ?? "(not found)"}`);
  }
  await store.close();
}

main().catch((err) => {
  console.error("ingest-otags failed:", err);
  process.exit(1);
});
