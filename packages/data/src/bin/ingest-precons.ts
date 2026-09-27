/** Writes every Commander precon MTGJSON knows to `packages/data/precons.json` (see `precons.ts`).
 *
 *  FREE: MTGJSON's `DeckList.json`, `SetList.json` and one small file per deck, no key, no spend.
 *  Every download is cached under `.mtgjson-cache/`, so a re-run only fetches decks it has not seen
 *  -- a new set's precons, not the ~200 it already has.
 *
 *  A FILE IN THE REPO, NOT A COLLECTION: a precon's list never changes once printed, so the list is
 *  data to review in a diff, and the static build reads it without Mongo.
 *
 *  Usage: tsx src/bin/ingest-precons.ts [--limit N] */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SAFE_FILE_NAME, commanderDecks, preconOf, type MtgjsonDeck, type MtgjsonDeckListEntry, type MtgjsonSetEntry, type Precon } from "../precons.js";

const API = "https://mtgjson.com/api/v5";
const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "..", "..", ".mtgjson-cache");
const outPath = join(here, "..", "..", "precons.json");

/** A cached GET: the file on disk when there is one, the network otherwise. `fresh` re-fetches the
 *  two list files, which grow with every set; a deck file never changes. */
async function cached<T>(path: string, rel: string, fresh = false): Promise<T> {
  // THE CACHE STAYS IN ITS FOLDER: `rel` carries a name read from MTGJSON's list.
  const file = resolve(cacheDir, rel);
  if (!file.startsWith(resolve(cacheDir) + sep)) throw new Error(`refusing a cache path outside ${cacheDir}: ${rel}`);
  if (fresh || !existsSync(file)) {
    const res = await fetch(`${API}/${path}`);
    if (!res.ok) throw new Error(`MTGJSON ${path}: ${res.status}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return (JSON.parse(readFileSync(file, "utf8")) as { data: T }).data;
}

async function main(): Promise<void> {
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : Infinity;
  const list = commanderDecks(await cached<MtgjsonDeckListEntry[]>("DeckList.json", "DeckList.json", true)).slice(0, limit);
  const sets = new Map((await cached<MtgjsonSetEntry[]>("SetList.json", "SetList.json", true)).map((s) => [s.code.toUpperCase(), s.name]));
  const out: Precon[] = [];
  let skipped = 0;
  for (const entry of list) {
    // One at a time: MTGJSON is a free host, and the cache makes every later run near-instant.
    if (!SAFE_FILE_NAME.test(entry.fileName)) continue; // `commanderDecks` already drops these; checked again where it is used
    const deck = await cached<MtgjsonDeck>(`decks/${encodeURIComponent(entry.fileName)}.json`, `decks/${entry.fileName}.json`);
    const p = preconOf(entry, deck, sets);
    if (p) out.push(p); else skipped++;
  }
  writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`${out.length} Commander precons written to ${outPath}${skipped ? ` (${skipped} without a commander skipped)` : ""}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
