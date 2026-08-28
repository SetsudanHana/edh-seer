/** Tests the slot-filling normalizer against the acceptance gates, BEFORE committing to a re-tag.
 *
 *  The card is segmented mechanically first, and the model is handed a numbered clause list it must
 *  answer one-for-one. It cannot merge, split or drop — the freedom that made two identical runs
 *  disagree on 45% of cards. Every field is a closed vocabulary; only `object` is free text.
 *
 *  Runs twice on the same cards and scores:
 *    DETERMINISM   — structured skeleton identical across runs (baseline today 55%, gate 90%)
 *    COMPLETENESS  — every clause id answered, none invented (gate: 100%)
 *    KNOWN-WRONG   — the four cards today's tagger gets wrong come out right
 *
 *  Usage: tsx src/bin/normalize-experiment.ts [outDir]   (needs ANTHROPIC_API_KEY) */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig } from "@edh-seer/data";
import { loadTaggerConfig } from "../config.js";
import { createProvider } from "../llm/factory.js";
import { canonicalize, type ClauseRecord } from "../canonicalize.js";
import { SYSTEM, listClauses } from "../normalize-prompt.js";
import { segment, type Clause } from "../segment.js";

const OUT = process.argv[2] ?? "/tmp/normalize-exp";
/** `--random N seed` draws a HELD-OUT sample instead of the curated list below. The curated cards
 *  were chosen because they were broken and the prompt was then tuned against them, so they cannot
 *  demonstrate generalisation — only a fresh draw can. The curated 20 are excluded from it. */
/** `--filter <regex>` restricts the draw by type line, so a sample can be aimed at the shapes a
 *  change actually touched — a random 100 contains only a handful of planeswalkers or Sagas. */
const filterIdx = process.argv.indexOf("--filter");
const TYPE_FILTER = filterIdx > 0 ? new RegExp(process.argv[filterIdx + 1], "i") : null;
const randIdx = process.argv.indexOf("--random");
const RANDOM_N = randIdx > 0 ? Number(process.argv[randIdx + 1] ?? 20) : 0;
const RANDOM_SEED = randIdx > 0 ? Number(process.argv[randIdx + 2] ?? 11) : 11;

const CARDS = [
  "Bitterblossom", "Kura, the Boundless Sky", "Cultivate", "Path to Exile", "Swiftfoot Boots",
  "Counterspell", "Supreme Verdict", "Phyrexian Tower", "Sen Triplets", "Heritage Reclamation",
  "Balan, Wandering Knight", "Feeling of Dread", "Crystalline Giant", "The Elderspell",
  "Nervous Gardener", "Contaminated Drink", "Innkeeper's Talent", "Urza's Saga",
  "Yarok, the Desecrated", "Riverglide Pathway // Lavaglide Pathway",
];

const s = await connect(loadConfig());
const cfg = loadTaggerConfig();
const provider = createProvider({ ...cfg, maxTokens: 3000 });
mkdirSync(OUT, { recursive: true });

let cardNames: string[] = CARDS;
if (RANDOM_N > 0) {
  const query: Record<string, unknown> = { oracleText: { $exists: true, $ne: "" }, edhrecRank: { $lte: 15000 } };
  if (TYPE_FILTER) query.typeLine = { $regex: TYPE_FILTER.source, $options: "i" };
  const pool = (await s.db.collection("cards")
    .find(query, { projection: { name: 1 } }).toArray()) as unknown as { name: string }[];
  const curated = new Set(CARDS);
  const eligible = pool.map((p) => p.name).filter((n) => !curated.has(n)).sort();
  if (TYPE_FILTER) console.log(`type filter /${TYPE_FILTER.source}/ matched ${eligible.length} cards`);
  let x = RANDOM_SEED;
  const rnd = (): number => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  for (let i = eligible.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
  cardNames = eligible.slice(0, RANDOM_N);
  console.log(`HELD-OUT sample of ${cardNames.length} (seed ${RANDOM_SEED}), curated cards excluded:`);
  console.log("  " + cardNames.join(", ") + "\n");
}

const prepared: { name: string; clauses: Clause[] }[] = [];
for (const name of cardNames) {
  const c = (await s.db.collection("cards").findOne({ name })) as
    { name: string; oracleText?: string; keywords?: string[]; typeLine?: string } | null;
  if (!c) { console.log(`  (missing: ${name})`); continue; }
  prepared.push({ name: c.name, clauses: segment(c.oracleText ?? "", c.keywords ?? [], c.typeLine ?? "") });
}

for (const run of ["run1", "run2"]) {
  const results: { name: string; clauses: Clause[]; output: unknown }[] = [];
  for (const p of prepared) {
    // keyword / reminder / level clauses state no game action. Asking the model about them
    // produced pure drift (a "Level 2" divider came back add-counter on one run and level-up on
    // the next), so they are answered here and never sent. Their slots are still filled, so the
    // completeness invariant holds.
    const INERT = new Set(["keyword", "reminder", "level", "modal"]);
    const askable = p.clauses.filter((c) => !INERT.has(c.kind));
    const synthesized = p.clauses.filter((c) => INERT.has(c.kind))
      .map((c) => ({ id: c.id, abilityType: "none", actions: [{ verb: "none", object: c.text }] }));
    const listed = listClauses(askable);
    let parsed: unknown;
    try {
      const raw = await provider.chat([
        { role: "system", content: SYSTEM },
        { role: "user", content: `Card: ${p.name}\nClauses:\n${listed}` },
      ]);
      const got = JSON.parse(raw) as { clauses?: unknown[] };
      const clauses = [...(got.clauses ?? []), ...synthesized]
        .sort((a, b) => (a as { id: number }).id - (b as { id: number }).id) as ClauseRecord[];
      // Both forms are written: `clauses` is what the model said, so scoring stays honest and
      // comparable with earlier runs, and `canonical` is what the derivation layer consumes — one
      // encoding per fact, settled in code rather than argued over by two runs.
      parsed = { clauses, canonical: canonicalize(clauses) };
    } catch (e) { parsed = { ERROR: (e as Error).message.slice(0, 200) }; }
    results.push({ name: p.name, clauses: p.clauses, output: parsed });
    process.stdout.write(".");
  }
  writeFileSync(join(OUT, `${run}.json`), JSON.stringify(results, null, 1));
  console.log(` ${run}`);
}
console.log(`\nwrote ${OUT}/run1.json and run2.json — score with: tsx src/bin/normalize-score.ts ${OUT}`);
await s.close();
