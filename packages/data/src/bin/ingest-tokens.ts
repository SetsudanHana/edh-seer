/** Fills a `tokens` collection from Scryfall, so a deck can be shown the tokens it needs.
 *
 *  FREE: ~32 paginated requests, ~3,100 printings collapsing to ~995 tokens. Scryfall rather than
 *  MTGJSON because this exists for the UI and Scryfall ships IMAGES; MTGJSON's tokens carry
 *  characteristics but no art, and are keyed by a uuid we would then have to translate.
 *
 *  `unique=prints`, NOT `unique=cards` — verified live: `unique=cards` returns 995 rows, one
 *  Scryfall-chosen representative printing per oracle_id, and that representative is not guaranteed
 *  to be the printing id any given card's `allParts` entry points at (Kuja, Genome Sorcerer's Wizard
 *  part names a printing id `unique=cards` does not even fetch). `unique=prints` returns all 3,114 and
 *  `mergeTokenDocs` collapses them back to one row per oracle_id, unioning every printing id onto
 *  `printingIds` — the set a card's `allParts[].printingId` is joined against.
 *
 *  Tokens stay OUT of `cards`: the non-gameplay layout filter that excludes them is right, because
 *  the engine analyses a decklist and nobody puts a token in one. They get their own collection, and
 *  the link is already in the corpus — `scryfall.ts` parses `all_parts` into `allParts`, so 5,640
 *  cards already reference 440 distinct token names with `component: "token"`.
 *
 *  Usage: tsx src/bin/ingest-tokens.ts [--dry-run]
 */
import { fileURLToPath } from "node:url";
import { connect, loadConfig } from "@edh-seer/data";
import { mergeTokenDocs, tokenDoc, tokenKey, type ScryfallToken } from "./ingest-tokens-core.js";

const SEARCH = "https://api.scryfall.com/cards/search?q=is%3Atoken&unique=prints&order=name";
const HEADERS = { "User-Agent": "edh-seer/0.1", Accept: "application/json" };
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

async function fetchAll(): Promise<ScryfallToken[]> {
  const out: ScryfallToken[] = [];
  let url: string | undefined = SEARCH;
  while (url) {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`Scryfall search failed: ${res.status}`);
    const page = await res.json() as { data: ScryfallToken[]; has_more?: boolean; next_page?: string };
    out.push(...page.data);
    url = page.has_more ? page.next_page : undefined;
    // Scryfall asks for 50-100ms between requests.
    if (url) await sleep(100);
  }
  return out;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const raw = await fetchAll();
  const perPrinting = raw.map(tokenDoc).filter((d): d is NonNullable<typeof d> => d !== null);
  const docs = mergeTokenDocs(perPrinting);
  console.log(`fetched ${raw.length} printings | merged to ${docs.length} tokens | with an image ${docs.filter((d) => d.image).length}`);

  const store = await connect(loadConfig());
  // How much of what our decks actually reference is covered — the number that decides whether a
  // token list can be rendered at all.
  const byKey = new Set(docs.map((d) => tokenKey(d.name, d.typeLine)));
  const cards = store.db.collection("cards");
  const referencing = await cards.find(
    { allParts: { $exists: true } }, { projection: { allParts: 1 } },
  ).toArray() as unknown as { allParts: { component?: string; name: string; typeLine?: string }[] }[];
  const wanted = new Set<string>();
  for (const c of referencing) {
    for (const p of c.allParts) if (p.component === "token") wanted.add(tokenKey(p.name, p.typeLine));
  }
  const covered = [...wanted].filter((k) => byKey.has(k));
  console.log(`token references in the corpus: ${wanted.size} distinct | resolvable: ${covered.length} (${(100 * covered.length / wanted.size).toFixed(1)}%)`);

  if (dryRun) {
    console.log("DRY RUN — nothing written.");
    for (const d of docs.slice(0, 3)) console.log(`  ${d.name} | ${d.typeLine} | ${d.image ? "image" : "NO IMAGE"}`);
  } else {
    const tokens = store.db.collection("tokens");
    await tokens.bulkWrite(
      docs.map((d) => ({ replaceOne: { filter: { _id: d._id as never }, replacement: d as never, upsert: true } })),
      { ordered: false },
    );
    await tokens.createIndex({ name: 1, typeLine: 1 });
    await tokens.createIndex({ printingIds: 1 }); // the exact join, keyed off allParts[].printingId
    console.log(`wrote ${docs.length} token(s)`);
  }
  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
