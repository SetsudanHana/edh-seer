/** Samples tagged cards and prints oracle text beside the recorded tags, for a hand audit of
 *  tagging QUALITY (as distinct from coverage, which tag-vs-otag.ts measures). The empty-abilities
 *  rate is ~3%; the wrong-tag rate is not measured anywhere else and is much higher.
 *
 *  Deterministic under a fixed seed so an audit can be repeated and compared after a prompt change.
 *  Restricted to edhrecRank <= 15000, because an unbiased corpus sample is dominated by cards no
 *  deck runs.
 *
 *  Usage: tsx src/bin/audit-tags.ts [N] [seed] [batchDir]
 *  Passing batchDir also writes the SAME sample as tag-batch-api batch files, so a re-tag scores
 *  against exactly the cards that were judged rather than a fresh draw. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig } from "@mtg/data";

const N = Number(process.argv[2] ?? 50);
const SEED = Number(process.argv[3] ?? 7);
const BATCH_DIR = process.argv[4];
const BATCH_SIZE = 10; // keep each response well inside the model's output budget
const forBatch: { oracleId: string; name: string; oracleText: string }[] = [];

const s = await connect(loadConfig());
const tagged = (await s.db.collection("cardTags")
  .find({ abilities: { $exists: true, $ne: [] } }, { projection: { oracleId: 1, abilities: 1 } })
  .toArray()) as unknown as { oracleId: string; abilities: Record<string, unknown>[] }[];

// Deterministic LCG so the sample is reproducible and re-auditable.
let x = SEED;
const rnd = (): number => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
const pool = [...tagged];
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }

// Restrict to cards that see play — an unbiased corpus sample is dominated by cards no deck runs.
const picked: typeof tagged = [];
for (const t of pool) {
  const c = await s.db.collection("cards").findOne({ _id: t.oracleId as never },
    { projection: { name: 1, oracleText: 1, edhrecRank: 1, typeLine: 1 } }) as
    { name: string; oracleText?: string; edhrecRank?: number; typeLine?: string } | null;
  if (!c || c.edhrecRank === undefined || c.edhrecRank > 15000) continue;
  picked.push(t);
  const summary = t.abilities.map((a) => {
    const eff = a.effect as { kind?: string } | undefined;
    const trig = a.trigger as { verbs?: string[] } | undefined;
    const emits = (a.emits as { verb?: string }[] | undefined) ?? [];
    const parts = [`${a.kind}`];
    if (trig?.verbs) parts.push(`on[${trig.verbs.join("/")}]`);
    parts.push(`-> ${eff?.kind ?? "?"}`);
    if (emits.length) parts.push(`emits[${emits.map((e) => e.verb).join(",")}]`);
    return parts.join(" ");
  }).join("  ||  ");
  forBatch.push({ oracleId: t.oracleId, name: c.name, oracleText: c.oracleText ?? "" });
  console.log(`\n### ${c.name}  (rank ${c.edhrecRank})`);
  console.log(`ORACLE: ${(c.oracleText ?? "").replace(/\n/g, " | ")}`);
  console.log(`TAGS  : ${summary}`);
  if (picked.length >= N) break;
}
console.log(`\n[sampled ${picked.length} of ${tagged.length} tagged cards, seed ${SEED}]`);
if (BATCH_DIR) {
  mkdirSync(BATCH_DIR, { recursive: true });
  let n = 0;
  for (let i = 0; i < forBatch.length; i += BATCH_SIZE) {
    writeFileSync(join(BATCH_DIR, `batch-${n}.json`), JSON.stringify(forBatch.slice(i, i + BATCH_SIZE), null, 1));
    n++;
  }
  console.log(`[wrote ${n} batch file(s) of the SAME sample to ${BATCH_DIR}]`);
}
await s.close();
