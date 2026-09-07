import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connect, loadConfig, mongoLookup, normalizeName, docToCard } from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "@edh-seer/matcher";
import type { DeckCard } from "@edh-seer/matcher/types";
import { classifyAntiPair, classifyPair, type AntiPair, type CompassPair } from "@edh-seer/matcher/eval-pairs-core";
import { buildReport, formatReport, type PairResult } from "./compass-report.js";

const GOLD = JSON.parse(
  readFileSync(new URL("../../matcher/src/compass-pairs.json", import.meta.url), "utf8"),
) as CompassPair[];

/** THE OTHER HALF OF THE COMPASS. `compass-pairs.json` only ever asked "did we find the edge", and
 *  55/55 is a score an engine that joined EVERY pair would also get. These are the pairs that must
 *  NEVER join, one representative per CLASS of false edge, each taken from a judged FALSE verdict.
 *  `knownDefects` are rows the engine STILL gets wrong: they are listed rather than hidden, and the
 *  list is capped so it cannot grow quietly -- the same shape as `pair-calibration.test.ts`. */
const ANTI = JSON.parse(
  readFileSync(new URL("../../matcher/src/compass-anti-pairs.json", import.meta.url), "utf8"),
) as { pairs: AntiPair[]; knownDefects: AntiPair[] };

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
  // THE SHIPPED ENGINE, NOT THE RETIRED ONE. This read `store.db.collection("cardTags")` -- the
  // FLAT collection -- until 2026-09-07, while the product has defaulted to `derived` since
  // TAGS_SOURCE flipped on 2026-08-06 (`tags-lookup.ts:43`). All 58 compass cards carry BOTH, so
  // nothing failed; the compass simply scored an engine that no longer ships.
  const cardTags = { findOne: (q: object) => store.db.collection("cardTagsDerived").findOne(q) };
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
  // ---- the negative half, BEFORE the connection closes ----
  const check = async (p: AntiPair): Promise<"clean" | "false-edge" | "unresolved"> => {
    const a = await resolveCard(p.a, lookup, cardTags);
    const b = await resolveCard(p.b, lookup, cardTags);
    if (!a || !b) return "unresolved";
    return classifyAntiPair(p, pairReasons(a, b, hierarchy));
  };
  const newFalse: AntiPair[] = [];
  for (const p of ANTI.pairs) if (await check(p) === "false-edge") newFalse.push(p);
  const fixed: AntiPair[] = [];
  for (const p of ANTI.knownDefects) if (await check(p) === "clean") fixed.push(p);

  await store.close();

  const report = buildReport(results);
  if (jsonOut) {
    const path = fileURLToPath(new URL("../../matcher/compass-report.json", import.meta.url));
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

  console.log(`\nanti-compass: ${ANTI.pairs.length - newFalse.length}/${ANTI.pairs.length} pairs correctly NOT joined`
    + ` · ${ANTI.knownDefects.length} known defect(s) still open`);
  for (const p of newFalse) {
    console.log(`  FALSE EDGE [${p.class}] ${p.a} / ${p.b} on ${p.tag}`);
    console.log(`      ${p.why}`);
  }
  for (const p of fixed) {
    console.log(`  FIXED [${p.class}] ${p.a} / ${p.b} on ${p.tag} — move it out of knownDefects so the gain is banked`);
  }
  if (newFalse.length || fixed.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("eval-pairs failed:", err);
    process.exit(1);
  });
}
