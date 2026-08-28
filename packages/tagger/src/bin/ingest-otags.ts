import type { AnyBulkWriteOperation } from "mongodb";
import { connect, loadConfig } from "@edh-seer/data";
import { loadDescriptorOtags, loadFunctionalOtags } from "../otags/functional.js";
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
            "User-Agent": "edh-seer/1.0 (otag ingest)",
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

// Usage: ingest-otags [--full] [--limit N]
//   default (incremental): fetch only slugs not yet in the collection, append with $addToSet.
//   --full: refetch every slug and overwrite each card's otags ($set rebuild).
async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const full = process.argv.includes("--full");
  const limitIdx = process.argv.indexOf("--limit");
  let slugs = loadFunctionalOtags();
  if (limitIdx >= 0) slugs = slugs.slice(0, Number(process.argv[limitIdx + 1]));

  const cards = await store.cards.find({}).toArray();
  const corpusIds = new Set(cards.map((c) => c._id));
  const nameById = new Map(cards.map((c) => [c._id, c.name]));
  const col = store.db.collection<CardOtagDoc>("cardOtags");

  // Skip slugs already ingested (present on any card) unless doing a full rebuild.
  const existing = new Set<string>(full ? [] : ((await col.distinct("otags")) as string[]));
  const toFetch = slugs.filter((s) => !existing.has(s));
  if (!toFetch.length) {
    console.log("no new otags to ingest (use --full to rebuild).");
    await store.close();
    return;
  }
  console.log(`${full ? "full rebuild" : "incremental"}: fetching ${toFetch.length}/${slugs.length} slugs`);

  async function write(tagToIds: Map<string, string[]>): Promise<void> {
    const cardOtags = buildCardOtags(tagToIds, corpusIds);
    const ops: AnyBulkWriteOperation<CardOtagDoc>[] = [...cardOtags].map(([id, otags]) => ({
      updateOne: {
        filter: { _id: id },
        update: full
          ? { $set: { name: nameById.get(id) ?? null, otags } }
          : { $set: { name: nameById.get(id) ?? null }, $addToSet: { otags: { $each: otags } } },
        upsert: true,
      },
    }));
    if (ops.length) await col.bulkWrite(ops, { ordered: false });
  }

  const tagToIds = new Map<string, string[]>();
  const emptyTags: string[] = [];
  for (const slug of toFetch) {
    // fetchTagOracleIds either returns a fully paginated tag or throws — never a partial list,
    // so persisting here can't commit truncated tag data.
    const ids = await fetchTagOracleIds(slug);
    if (ids.length === 0) emptyTags.push(slug);
    process.stdout.write(`  ${slug}: ${ids.length}\n`);
    // Incremental appends per slug, so an interrupted run keeps finished slugs and the
    // next run's `distinct` skips them. --full rebuilds whole otag arrays, so it can only
    // write once every slug is in hand.
    if (full) tagToIds.set(slug, ids);
    else await write(new Map([[slug, ids]]));
  }
  if (full) await write(tagToIds);

  console.log(`\n=== otag ingest coverage ===`);
  console.log(`  corpus cards: ${corpusIds.size}`);
  const withOtag = await col.countDocuments({ "otags.0": { $exists: true } });
  // Headline is signal-bearing coverage; descriptors sit on a quarter of the corpus and
  // would mask whether we actually gained pairing vocabulary.
  const descriptors = loadDescriptorOtags();
  const withSignal = await col.countDocuments({ otags: { $elemMatch: { $nin: descriptors } } });
  const pct = (n: number) => `${((100 * n) / corpusIds.size).toFixed(0)}%`;
  console.log(`  cards with >=1 non-descriptor otag: ${withSignal} (${pct(withSignal)})`);
  console.log(`  cards with >=1 otag of any kind:    ${withOtag} (${pct(withOtag)})`);
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
