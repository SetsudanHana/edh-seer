/** Read-only view of a normalize-corpus run. Touches nothing the run uses — it reads `cardClauses`
 *  and counts deck files — so it is safe to run repeatedly while the run is in flight.
 *
 *  Usage:
 *    tsx src/bin/normalize-progress.ts            # one snapshot
 *    tsx src/bin/normalize-progress.ts --watch    # refresh every 15s until done
 *    tsx src/bin/normalize-progress.ts --watch 5  # refresh every 5s */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig, normalizeName, parseDecklistText } from "@mtg/data";
import { CLAUSES_COLLECTION, type CardClausesDoc } from "../clause-store.js";
import { NORMALIZE_VERSION } from "../normalize-prompt.js";

const CAL = new URL("../../../cli/decks/calibration/", import.meta.url).pathname;
const watchIdx = process.argv.indexOf("--watch");
const WATCH = watchIdx > 0;
const EVERY = Number(process.argv[watchIdx + 1]) || 15;

/** Scope size from the deck files alone — no per-card database round trip, so this stays cheap
 *  enough to call every few seconds. */
function scopeSize(): number {
  const names = new Set<string>();
  for (const f of readdirSync(CAL).filter((n) => n.endsWith(".txt"))) {
    for (const n of parseDecklistText(readFileSync(join(CAL, f), "utf8"))) names.add(normalizeName(n));
  }
  return names.size;
}

const TOTAL = scopeSize();
const store = await connect(loadConfig());
const col = store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION);
const bar = (pct: number): string => {
  const filled = Math.round(pct / 2.5);
  return `[${"#".repeat(filled)}${".".repeat(40 - filled)}]`;
};

async function snapshot(): Promise<boolean> {
  const done = await col.countDocuments({ normalizeVersion: NORMALIZE_VERSION });
  const stale = await col.countDocuments({ normalizeVersion: { $ne: NORMALIZE_VERSION } });
  const pct = (100 * done) / TOTAL;

  // Rate from the last 200 writes rather than since-start, so a restart at a different concurrency
  // shows up immediately instead of being averaged away.
  const recent = await col.find({}, { projection: { updatedAt: 1, name: 1 } })
    .sort({ updatedAt: -1 }).limit(200).toArray();
  const stamps = recent.map((d) => +new Date(d.updatedAt)).sort((a, b) => a - b);
  const spanMin = stamps.length > 1 ? (stamps[stamps.length - 1] - stamps[0]) / 60000 : 0;
  const rate = spanMin > 0 ? (stamps.length - 1) / spanMin : 0;
  const remaining = TOTAL - done;
  const eta = rate > 0 ? Math.ceil(remaining / rate) : Infinity;
  const idleSec = stamps.length ? Math.round((Date.now() - stamps[stamps.length - 1]) / 1000) : Infinity;

  const warnKinds = await col.aggregate([
    { $unwind: "$warnings" },
    { $group: { _id: "$warnings.kind", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray() as { _id: string; n: number }[];
  const warnedCards = await col.countDocuments({ "warnings.0": { $exists: true } });

  console.log(`\n${bar(pct)} ${done}/${TOTAL}  ${pct.toFixed(1)}%`);
  console.log(`  rate ${rate.toFixed(0)}/min   eta ${eta === Infinity ? "—" : `${eta} min`}   remaining ${remaining}`);
  console.log(`  last write ${idleSec === Infinity ? "never" : `${idleSec}s ago`}${idleSec > 120 ? "   <-- STALLED?" : ""}`);
  console.log(`  warnings: ${warnedCards} card(s) = ${((100 * warnedCards) / (done || 1)).toFixed(1)}%` +
    (warnKinds.length ? `  [${warnKinds.map((k) => `${k._id} ${k.n}`).join(", ")}]` : ""));
  if (stale) console.log(`  docs on an OLDER NORMALIZE_VERSION (will re-queue): ${stale}`);
  console.log(`  latest: ${recent.slice(0, 3).map((d) => d.name).join(", ")}`);
  // Refused and failed cards are never persisted, so they are absent by construction rather than
  // countable here -- that gap is the run's stdout, which is why the log path matters.
  return done >= TOTAL;
}

if (!WATCH) {
  await snapshot();
} else {
  for (;;) {
    if (await snapshot()) { console.log(`\ndone.`); break; }
    await new Promise((r) => setTimeout(r, EVERY * 1000));
  }
}
await store.close();
