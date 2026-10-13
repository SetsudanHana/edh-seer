/** Generate `derive/starting-loyalty.json` -- each planeswalker's printed STARTING LOYALTY, per face -- from MTGJSON's AtomicCards. Free: no key, no
 *  model, no Mongo write, the one cached download (`packages/data/.mtgjson-cache`, fetched by `ingest-mtgjson.ts`).
 *
 *  WHY A CHECKED-IN TABLE: the `cards` documents carry no loyalty (Scryfall's `loyalty` is not read by `normalize`, and the MTGJSON merge that carries it has
 *  not been run into Mongo), and derive needs it to say whether a planeswalker's "-1: Add {R}{R}" can be activated the turn the walker is cast (CR 606.6:
 *  a loyalty cost needs that many counters; a planeswalker enters with its printed loyalty, CR 306.5b). Same arrangement as `cr-keywords.json`: a small generated
 *  JSON is committed so the derive test needs no gitignored download.
 *
 *  Keyed by Scryfall oracle id (every face of a double-faced card shares it), valued by one entry per face in face order: the loyalty as a number, or null
 *  for a face that has none (the creature front of Valki) or a non-numeric one ("X").
 *
 *    tsx src/bin/gen-starting-loyalty.ts           # regenerate
 *    tsx src/bin/gen-starting-loyalty.ts --check   # non-zero exit if the committed file has drifted */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const CACHE = "packages/data/.mtgjson-cache/AtomicCards.json.gz";
const OUT = "packages/tagger/src/derive/starting-loyalty.json";
const CHECK = process.argv.includes("--check");

interface Face { identifiers?: { scryfallOracleId?: string }; loyalty?: string }

/** oracleId -> loyalty per face, only for a card with at least one numeric loyalty. */
export function loyaltyTable(data: Record<string, Face[]>): Record<string, (number | null)[]> {
  const byId = new Map<string, (number | null)[]>();
  for (const faces of Object.values(data)) {
    for (const f of faces) {
      const id = f.identifiers?.scryfallOracleId;
      if (!id) continue;
      const n = f.loyalty !== undefined && /^\d+$/.test(f.loyalty) ? Number(f.loyalty) : null;
      byId.set(id, [...(byId.get(id) ?? []), n]);
    }
  }
  const out: Record<string, (number | null)[]> = {};
  for (const id of [...byId.keys()].sort()) if (byId.get(id)!.some((n) => n !== null)) out[id] = byId.get(id)!;
  return out;
}

if (process.argv[1]?.endsWith("gen-starting-loyalty.ts")) {
  if (!existsSync(CACHE)) throw new Error(`no cached MTGJSON in ${CACHE} -- run packages/data/src/bin/ingest-mtgjson.ts --dry-run first`);
  const data = (JSON.parse(gunzipSync(readFileSync(CACHE)).toString("utf8")) as { data: Record<string, Face[]> }).data;
  const table = loyaltyTable(data);
  const text = "{\n" + Object.entries(table).map(([id, v]) => `${JSON.stringify(id)}:${JSON.stringify(v)}`).join(",\n") + "\n}\n";
  if (CHECK) {
    if (readFileSync(OUT, "utf8") !== text) { console.error(`${OUT} has drifted -- regenerate with gen-starting-loyalty.ts`); process.exit(1); }
    console.log("starting-loyalty.json is current");
  } else {
    writeFileSync(OUT, text);
    console.log(`${Object.keys(table).length} planeswalkers -> ${OUT}`);
  }
}
