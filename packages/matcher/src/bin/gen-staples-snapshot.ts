/** A ONE-TIME SNAPSHOT OF EDHTop16's STAPLES (owner, 2026-09-27: "use it as one time off calibration
 *  ... so we know what players actually consider staple"). Writes `packages/matcher/staples-edhtop16.json`:
 *  every card on https://edhtop16.com/staples with its play rate over the last year, keyed by Scryfall
 *  oracle id. Run deliberately to take a new snapshot -- never from a build.
 *
 *    tsx src/bin/gen-staples-snapshot.ts
 *
 *  One request to the public GraphQL API (`robots.txt` allows all). Free. */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://edhtop16.com/api/graphql";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "staples-edhtop16.json");

async function main(): Promise<void> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "edh-seer (https://edhseer.cards)" },
    body: JSON.stringify({ query: "{ staples { oracleId playRateLastYear } }" }),
  });
  if (!res.ok) throw new Error(`EDHTop16 answered ${res.status}`);
  const body = await res.json() as { data?: { staples?: { oracleId: string | null; playRateLastYear: number | null }[] } };
  const rows = (body.data?.staples ?? []).filter((s): s is { oracleId: string; playRateLastYear: number } =>
    typeof s.oracleId === "string" && typeof s.playRateLastYear === "number" && s.playRateLastYear > 0);
  if (rows.length === 0) throw new Error("EDHTop16 returned no staples -- not overwriting the snapshot");
  const cards = Object.fromEntries(rows.sort((a, b) => a.oracleId.localeCompare(b.oracleId))
    .map((s) => [s.oracleId, Math.round(s.playRateLastYear * 10000) / 10000] as const));
  const snapshot = { fetchedAt: new Date().toISOString().slice(0, 10), source: "https://edhtop16.com/staples (playRateLastYear, competitive EDH tournaments)", cards };
  writeFileSync(out, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`wrote ${rows.length} staples to ${out}`);
}

main().catch((err) => { console.error("gen-staples-snapshot failed:", err); process.exit(1); });
