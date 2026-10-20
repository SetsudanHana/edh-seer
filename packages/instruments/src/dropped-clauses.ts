/** FREE. By-name ratchet over clauses derive drops silently (#1299). Fails in BOTH directions: a clause that
 *  starts or stops deriving an ability turns this red. See dropped-clauses-core.ts for what counts and what
 *  is excluded. Same population as role-ratchet: every commander-legal card, sticker cards skipped.
 *
 *  The clause records are the ones derive used (derive-corpus / derive-worker): a row derived with
 *  `clauseSource: "grammar"` read `grammarClauseRecords(card).records`, a model row the stored
 *  `cardClauses.canonical`.
 *
 *  Usage: npx tsx packages/instruments/src/dropped-clauses.ts [--bank] [--silent]
 *    (--silent lists every SILENT drop: a clause derive lost without saying so)
 *    (exit 1 on any change; `card  +key` is a new drop, `card  -key` a fixed one; --bank rewrites the snapshot) */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { connect, isStickerCard, loadConfig, type CardDoc } from "@edh-seer/data";
import { DERIVE_VERSION, grantedTokenClauses, grammarClauseRecords, type ClauseRecord } from "@edh-seer/tagger";
import { diffMembership, serialiseSnapshot, versionDrift, type VersionGroup } from "./role-ratchet-core.js";
import { droppedKeys, groupSplit, splitReported, type Dropped } from "./dropped-clauses-core.js";

const SNAPSHOT = "packages/instruments/dropped-clauses.json";
const { values } = parseArgs({ options: { bank: { type: "boolean", default: false }, silent: { type: "boolean", default: false } }, strict: true });

const store = await connect(loadConfig());
const derivedCol = store.db.collection("cardTagsDerived");
const groups = await derivedCol.aggregate<VersionGroup>([{ $group: { _id: "$deriveVersion", n: { $sum: 1 } } }]).toArray();
const drift = versionDrift(groups, DERIVE_VERSION);
if (drift.length > 0) {
  console.error(`cardTagsDerived is not at DERIVE_VERSION ${DERIVE_VERSION}: ${drift.map((g) => `v${g._id ?? "none"} x${g.n}`).join(", ")}. Re-run derive-corpus.`);
  await store.close();
  process.exit(1);
}

interface Row { oracleId: string; clauseSource?: "grammar" | "model"; abilities?: { clause?: number }[]; unclaimed?: { clause: number | string }[]; manaLines?: unknown[] }
const rows = new Map((await derivedCol.find({}, { projection: { oracleId: 1, clauseSource: 1, "abilities.clause": 1, "unclaimed.clause": 1, "manaLines.source": 1 } }).toArray() as unknown as Row[]).map((r) => [r.oracleId, r]));
const canonical = new Map((await store.db.collection("cardClauses").find({}, { projection: { oracleId: 1, canonical: 1 } }).toArray() as unknown as { oracleId: string; canonical: ClauseRecord[] }[])
  .map((d) => [d.oracleId, d.canonical]));
const docs = await store.db.collection<CardDoc>("cards").find({ "legalities.commander": "legal" }).sort({ name: 1 }).toArray();
const inEngine = docs.filter((d) => !isStickerCard(d));
await store.close();

const measured: Dropped = {};
/** Per card, the clause ids derive REPORTED in `CardTags.unclaimed` (task 2). */
const reportedBy: Record<string, ReadonlySet<string>> = {};
let underived = 0, noRecords = 0, actions = 0;
for (const d of inEngine) {
  const row = rows.get(d._id);
  if (!row) { underived++; continue; }
  const records = row.clauseSource === "grammar" ? grammarClauseRecords(d as never).records : canonical.get(d._id);
  if (!records) { noRecords++; continue; }
  const keys = droppedKeys(records, {
    abilityClauses: new Set((row.abilities ?? []).flatMap((a) => (a.clause === undefined ? [] : [a.clause]))),
    granted: grantedTokenClauses(d as never),
    hasManaLines: (row.manaLines?.length ?? 0) > 0,
  });
  if (keys.length > 0) {
    measured[d.name] = keys; actions += keys.length;
    reportedBy[d.name] = new Set((row.unclaimed ?? []).map((u) => String(u.clause)));
  }
}
const cards = Object.keys(measured).length;
const summary = `${cards} cards, ${actions} dropped actions, of ${inEngine.length} commander-legal cards (${docs.length - inEngine.length} stickers skipped); ${underived} underived, ${noRecords} with no clause records`;
// REPORTED = derive named the clause in `unclaimed`; SILENT = nothing said it was lost. Summary only, never in the snapshot.
const split = splitReported(measured, reportedBy);
const count = (d: Dropped): string => `${Object.keys(d).length} cards, ${Object.values(d).reduce((n, k) => n + k.length, 0)} actions`;
console.log(`REPORTED by derive (unclaimed): ${count(split.reported)}\nSILENT (no ability, no unclaimed): ${count(split.silent)}`);
if (values.silent) for (const [c, k] of Object.entries(split.silent)) console.log(`silent  ${c}  ${k.join(" ")}`);
const table = groupSplit(measured, reportedBy);
console.log(`${"actions".padStart(7)} ${"report".padStart(6)} ${"silent".padStart(6)} ${"cards".padStart(6)}  shape / examples`);
for (const g of table.slice(0, 20)) console.log(`${String(g.actions).padStart(7)} ${String(g.reported).padStart(6)} ${String(g.silent).padStart(6)} ${String(g.cards).padStart(6)}  ${g.shape}  [${g.examples.join("; ")}]`);

if (values.bank) {
  writeFileSync(SNAPSHOT, serialiseSnapshot(measured));
  console.log(`banked ${summary}`);
} else {
  const d = diffMembership(measured, JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Dropped);
  for (const [c, k] of d.gained) console.log(`${c}  +${k}`);
  for (const [c, k] of d.lost) console.log(`${c}  -${k}`);
  console.log(`${summary}; new drops ${d.gained.length}, fixed ${d.lost.length}`);
  if (d.gained.length + d.lost.length > 0) {
    console.error("dropped clauses moved. If intended, re-run with --bank and explain every line in the commit.");
    process.exit(1);
  }
}
