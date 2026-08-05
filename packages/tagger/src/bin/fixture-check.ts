/** THE SMALLEST SPEND THAT PROVES THE PIPELINE. ~$0.25, 58 cards.
 *
 *  Re-normalizes the gold-fixture cards through the NEW path (normalize-card + the persist gate)
 *  and compares against `gold-clauses.json`. That fixture is the only set in the project where
 *  known-good output already exists, which makes it the one place a $0.25 run can answer questions
 *  a $9.07 run would otherwise answer expensively:
 *
 *    - what fraction of real cards does the gate REFUSE? (too strict = re-queue forever, paying
 *      every run; the fixture calibration put this at 1.7%, but on stored output, not a live call)
 *    - how far does a fresh run drift from a stored one, measured on `canonicalSignature`, which is
 *      what the derivation layer actually consumes?
 *    - do the warn-severity findings stay rare, or was 1.7% luck?
 *
 *  Writes NOTHING. It is a measurement, so it can be re-run after the structured-outputs change and
 *  compared directly.
 *
 *  Usage: set -a && source .env && set +a && TAGGER_PROVIDER=anthropic \
 *           npx tsx src/bin/fixture-check.ts */
import { readFileSync } from "node:fs";
import { connect, loadConfig } from "@mtg/data";
import { canonicalSignature, type ClauseRecord } from "../canonicalize.js";
import { loadTaggerConfig } from "../config.js";
import { createProvider } from "../llm/factory.js";
import { normalizeCard } from "../normalize-card.js";

const FIXTURE = JSON.parse(readFileSync(
  new URL("../../../matcher/src/fixtures/gold-clauses.json", import.meta.url), "utf8",
)) as { name: string; clauses: ClauseRecord[] }[];

const cfg = loadTaggerConfig();
if (cfg.provider !== "anthropic") {
  console.error(`provider is "${cfg.provider}" (${cfg.model}); source .env and set TAGGER_PROVIDER=anthropic`);
  process.exit(1);
}

const store = await connect(loadConfig());
const provider = createProvider({ ...cfg, maxTokens: 3000 });
console.log(`re-normalizing ${FIXTURE.length} fixture cards on ${provider.model}...\n`);

let refused = 0, warned = 0, failed = 0, identical = 0;
const byKind = new Map<string, number>();
const drifted: string[] = [];

for (const fx of FIXTURE) {
  const doc = await store.cards.findOne({ name: fx.name } as never) as
    { name: string; oracleText?: string; keywords?: string[]; typeLine?: string } | null;
  if (!doc) { console.log(`MISSING ${fx.name}`); continue; }

  try {
    const res = await normalizeCard(provider, doc);
    for (const v of res.violations) byKind.set(`${v.severity}/${v.kind}`, (byKind.get(`${v.severity}/${v.kind}`) ?? 0) + 1);

    if (res.rejected.length) {
      refused++;
      console.log(`REFUSED ${fx.name}: ${res.rejected.map((v) => `${v.kind} — ${v.detail}`).join(" | ")}`);
      continue;
    }
    if (res.violations.length) warned++;

    // The fixture stores canonical clauses, so compare canonical-to-canonical.
    if (canonicalSignature(res.canonical) === canonicalSignature(fx.clauses)) identical++;
    else drifted.push(fx.name);
  } catch (e) {
    failed++;
    console.log(`FAILED  ${fx.name}: ${(e as Error).message.slice(0, 160)}`);
  }
  process.stdout.write(".");
}

const n = FIXTURE.length;
console.log(`\n\n--- gate ---`);
console.log(`  refused (would re-queue): ${refused}/${n} = ${(100 * refused / n).toFixed(1)}%`);
console.log(`  persisted with warnings:  ${warned}/${n}`);
console.log(`  call failures:            ${failed}/${n}`);
for (const [k, c] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${c}`);

const compared = n - refused - failed;
console.log(`\n--- drift vs the stored fixture (canonicalSignature) ---`);
console.log(`  identical: ${identical}/${compared} = ${compared ? (100 * identical / compared).toFixed(1) : "-"}%`);
if (drifted.length) console.log(`  drifted: ${drifted.join(", ")}`);
console.log(`\nnothing was written.`);
await store.close();
