import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connect, loadConfig, mongoLookup, normalizeName, docToCard } from "@mtg/data";
import type { CardTags } from "@mtg/tagger";
import { loadHierarchy, pairReasons } from "../index.js";
import type { DeckCard } from "../types.js";
import { classifyPair, type GoldPair } from "./eval-pairs-core.js";
import { buildReport, formatReport, type PairResult } from "./compass-report.js";

const GOLD = JSON.parse(
  readFileSync(new URL("../goldpairs.json", import.meta.url), "utf8"),
) as GoldPair[];

/** Resolve a card name to a DeckCard (card + tags), or null when the name is unknown. */
async function resolveCard(
  name: string,
  lookup: { findByName(n: string): Promise<{ _id: string } | null> },
  cardTags: { findOne(q: object): Promise<unknown> },
): Promise<DeckCard | null> {
  const doc = await lookup.findByName(normalizeName(name));
  if (!doc) return null;
  const tags = (await cardTags.findOne({ oracleId: doc._id })) as CardTags | null;
  return { card: docToCard(doc as never), tags };
}

async function main(): Promise<void> {
  const jsonOut = process.argv.includes("--json");
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = store.db.collection("cardTags");
  const hierarchy = loadHierarchy();

  const results: PairResult[] = [];
  const skipped: string[] = [];
  for (const pair of GOLD) {
    if (!pair.verified) continue;
    const a = await resolveCard(pair.a, lookup as never, cardTags as never);
    const b = await resolveCard(pair.b, lookup as never, cardTags as never);
    if (!a || !b) {
      skipped.push(`${pair.a} / ${pair.b}`);
      continue;
    }
    const reasons = pairReasons(a, b, hierarchy);
    results.push({ pair, outcome: classifyPair(pair, reasons, a, b) });
  }
  await store.close();

  const report = buildReport(results);
  if (jsonOut) {
    const path = fileURLToPath(new URL("../../compass-report.json", import.meta.url));
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
    console.log(`wrote ${path}`);
  }
  console.log(formatReport(report));

  // Per-miss detail, for the compass.
  for (const { pair, outcome } of results) {
    if (outcome.status === "PASS") continue;
    const cause = outcome.status === "NO-EDGE" ? outcome.noEdgeCause : "WRONG-REASON";
    const detail =
      outcome.status === "WRONG-REASON"
        ? ` got: ${outcome.reasons.map((r) => r.tag || r.effectKind).join(", ")}`
        : "";
    console.log(`  MISS [${pair.category}] ${pair.a} / ${pair.b}: ${cause}${detail}`);
  }
  if (skipped.length) console.log(`\nskipped (name unresolved): ${skipped.join("; ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("eval-pairs failed:", err);
    process.exit(1);
  });
}
