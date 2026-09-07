/** Recomputes `canonical` from the stored raw `clauses` for every card in the corpus.
 *
 *  FREE: `canonicalize` is a pure function and the RAW model output is persisted beside the
 *  canonical form, so a change to the canonical encoding costs no model calls -- only this pass and
 *  a `derive-corpus` re-run. That is the whole reason the raw clauses are kept.
 *
 *  Written for the 2026-09-07 encoding change, where an unstated `fromZone` stopped being folded
 *  into `library` (CR 400.1 makes library a zone; CR 400.7 makes the move the event). `derive-corpus`
 *  reads `doc.canonical`, so without this pass the corpus keeps the old encoding and the new derive
 *  rules see nothing.
 *
 *  Idempotent: a doc whose canonical already matches is skipped, so it is safe to re-run and safe to
 *  interrupt. DRY RUN by default; `--run` writes.
 *
 *  Usage: tsx src/bin/recanonicalize-corpus.ts [--run] */
import { connect, loadConfig } from "@edh-seer/data";
import { canonicalize } from "../canonicalize.js";
import { CLAUSES_COLLECTION, type CardClausesDoc } from "../clause-store.js";

const RUN = process.argv.includes("--run");
const store = await connect(loadConfig());
const col = store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION);
const docs = await col.find({}).toArray();
console.log(`clause docs: ${docs.length}${RUN ? "" : "  (DRY RUN — pass --run to write)"}`);

let changed = 0, same = 0;
const examples: string[] = [];
for (const doc of docs) {
  const next = canonicalize(doc.clauses);
  if (JSON.stringify(next) === JSON.stringify(doc.canonical)) { same++; continue; }
  changed++;
  if (examples.length < 5) examples.push(doc.name);
  if (RUN) await col.updateOne({ _id: doc._id }, { $set: { canonical: next } });
}
console.log(`  canonical changed: ${changed}\n  unchanged:         ${same}`);
if (examples.length) console.log(`  e.g. ${examples.join(", ")}`);
if (!RUN && changed > 0) console.log(`\nnothing written. Re-run with --run, then derive-corpus.ts.`);
await store.close();
