import { fileURLToPath } from "node:url";
import { connect } from "../db.js";
import { loadConfig } from "../config.js";

/**
 * Purge digital-only cards (Alchemy/Arena-exclusive) from the corpus.
 *
 * Selection uses `-in:paper`, which is CARD-level: it excludes a card when any of its
 * printings is paper. Do not substitute the printing-level predicates `is:alchemy` or
 * `-game:paper` -- those match a card when a SINGLE printing matches, so paper staples
 * that merely have an Arena rebalance (Kindred Discovery, Blur) get swept in and deleted.
 *
 * Dry-run by default; pass --apply to delete.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function digitalOnlyOracleIds(): Promise<Set<string>> {
  const out = new Set<string>();
  let url = `https://api.scryfall.com/cards/search?unique=cards&q=${encodeURIComponent("-in:paper")}`;
  while (url) {
    let ok = false;
    for (let a = 0; a < 10 && !ok; a++) {
      const res = await fetch(url, {
        headers: { "User-Agent": "mtg-synergy-engine/1.0 (digital purge)", Accept: "application/json" },
      });
      if (res.status === 404) return out;
      if (!res.ok) {
        const ra = Number(res.headers.get("retry-after")) * 1000;
        await sleep(Number.isFinite(ra) && ra > 0 ? ra : 2500);
        continue;
      }
      const j = (await res.json()) as { data?: { oracle_id: string }[]; has_more?: boolean; next_page?: string; object?: string };
      if (j.object === "error") return out;
      for (const c of j.data ?? []) out.add(c.oracle_id);
      url = j.has_more && j.next_page ? j.next_page : "";
      ok = true;
    }
    // A truncated fetch here only shrinks the delete set, but stopping early would
    // silently leave digital cards behind and report success, so fail loudly instead.
    if (!ok) throw new Error("digital-only fetch gave up after retries; refusing to report a partial purge");
    await sleep(130);
  }
  return out;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const store = await connect(loadConfig());
  const cards = store.db.collection("cards");
  const cardTags = store.db.collection("cardTags");
  const cardOtags = store.db.collection("cardOtags");

  console.log("fetching digital-only oracle_ids from Scryfall...");
  const digital = await digitalOnlyOracleIds();
  console.log(`digital-only oracle_ids: ${digital.size}`);

  const all = (await cards.find({}, { projection: { _id: 1 } }).toArray()) as unknown as { _id: string }[];
  const digitalIds = all.map((d) => d._id).filter((id) => digital.has(id));
  // A correct predicate touches a sliver of the corpus; a broad match means the query
  // changed meaning upstream, and deleting on it would gut the paper corpus.
  const share = digitalIds.length / all.length;
  if (share > 0.05) throw new Error(`digital-only set is ${(100 * share).toFixed(1)}% of corpus; refusing to purge`);

  console.log(`\ncards: ${all.length} total, ${digitalIds.length} digital-only`);
  console.log(`cardTags: ${await cardTags.countDocuments({ oracleId: { $in: digitalIds } })} matching`);
  console.log(`cardOtags: ${await cardOtags.countDocuments({ _id: { $in: digitalIds } } as never)} matching`);

  const sample = await cards.find({ _id: { $in: digitalIds.slice(0, 500) } } as never, { projection: { name: 1 } }).limit(8).toArray();
  console.log(`sample: ${(sample as unknown as { name: string }[]).map((c) => c.name).join(", ")}`);

  if (!apply) {
    console.log(`\nDRY RUN -- nothing deleted. Re-run with --apply to delete.`);
    await store.close();
    return;
  }

  const delCards = await cards.deleteMany({ _id: { $in: digitalIds } } as never);
  const delTags = await cardTags.deleteMany({ oracleId: { $in: digitalIds } });
  const delOtags = await cardOtags.deleteMany({ _id: { $in: digitalIds } } as never);
  console.log(`\ndeleted ${delCards.deletedCount} cards, ${delTags.deletedCount} cardTags, ${delOtags.deletedCount} cardOtags`);
  console.log(`cards now: ${await cards.countDocuments()}`);
  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("purge failed:", err);
    process.exit(1);
  });
}
