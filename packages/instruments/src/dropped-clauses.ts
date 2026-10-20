/** FREE. By-name ratchet over clauses derive drops silently (#1299). Fails in BOTH directions: a clause that
 *  starts or stops deriving an ability turns this red. See dropped-clauses-core.ts for what counts and what
 *  is excluded. Same population as role-ratchet: every commander-legal card, sticker cards skipped.
 *
 *  The clause records are the ones derive used (derive-corpus / derive-worker): a row derived with
 *  `clauseSource: "grammar"` read `grammarClauseRecords(card).records`, a model row the stored
 *  `cardClauses.canonical`.
 *
 *  KEYS REPEAT WITHIN A CARD and the diff is set-based (diffMembership): a second identical drop on a card that already has
 *  one does not move the ratchet. The records are only comparable to the derived row when it was derived from them, so a row
 *  whose normalizeVersion / segmentHash differs from the clause doc (or, for a grammar row, from the card's own text) REFUSES the run.
 *
 *  Usage: npx tsx packages/instruments/src/dropped-clauses.ts [--bank] [--silent]
 *    (--silent lists every SILENT drop: a clause derive lost without saying so)
 *    (exit 1 on any change; `card  +key` is a new drop, `card  -key` a fixed one; --bank rewrites the snapshot) */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { connect, isStickerCard, loadConfig, type CardDoc } from "@edh-seer/data";
import { DERIVE_VERSION, deriveAbilitiesOf, deriveInputOf, clauseTexts, grantedTokenClauses, grammarClauseRecords, segmentHash, type ClauseRecord } from "@edh-seer/tagger";
import { diffMembership, listSome, serialiseSnapshot, versionDrift, type VersionGroup } from "./role-ratchet-core.js";
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

interface Row { oracleId: string; normalizeVersion?: number; segmentHash?: string; clauseSource?: "grammar" | "model"; abilities?: { clause?: number }[]; unclaimed?: { clause: number | string }[]; manaLines?: unknown[] }
const rows = new Map((await derivedCol.find({}, { projection: { oracleId: 1, normalizeVersion: 1, segmentHash: 1, clauseSource: 1, "abilities.clause": 1, "unclaimed.clause": 1, "manaLines.source": 1 } }).toArray() as unknown as Row[]).map((r) => [r.oracleId, r]));
const clauseDocs = new Map((await store.db.collection("cardClauses").find({}, { projection: { oracleId: 1, canonical: 1, normalizeVersion: 1, segmentHash: 1 } }).toArray() as unknown as { oracleId: string; canonical: ClauseRecord[]; normalizeVersion: number; segmentHash: string }[])
  .map((d) => [d.oracleId, d] as const));
const docs = await store.db.collection<CardDoc>("cards").find({ "legalities.commander": "legal" }).sort({ name: 1 }).toArray();
const inEngine = docs.filter((d) => !isStickerCard(d));
await store.close();

// STALENESS: the derived row must have been derived from the records read here. A model row from the clause doc it stored (normalizeVersion +
// segmentHash), a grammar row from the card's own text. After a normalize --run or an erratum ingest they differ and the ratchet would print
// spurious keys, so refuse like the version check.
const stale: string[] = [];
for (const d of inEngine) {
  const row = rows.get(d._id);
  if (!row) continue;
  const cd = clauseDocs.get(d._id);
  const fresh = row.clauseSource === "grammar"
    ? row.segmentHash === segmentHash(d.oracleText ?? "", d.typeLine ?? "", d.keywords ?? [])
    : cd !== undefined && row.normalizeVersion === cd.normalizeVersion && row.segmentHash === cd.segmentHash;
  if (!fresh && (row.clauseSource === "grammar" || cd !== undefined)) stale.push(d.name);
}
if (stale.length > 0) {
  console.error(`${stale.length} derived row(s) were not derived from the current clause records or card text: ${listSome(stale, 5)}. Re-run derive-corpus.`);
  process.exit(1);
}

const measured: Dropped = {};
const underivedNames: string[] = [], noRecordNames: string[] = [];
/** Per card, the clause ids derive REPORTED in `CardTags.unclaimed` (task 2). */
const reportedBy: Record<string, ReadonlySet<string>> = {};
let underived = 0, noRecords = 0, actions = 0;
for (const d of inEngine) {
  const row = rows.get(d._id);
  if (!row) { underived++; underivedNames.push(d.name); continue; }
  const g = row.clauseSource === "grammar" ? grammarClauseRecords(d as never) : undefined;
  const records = g ? g.records : clauseDocs.get(d._id)?.canonical;
  if (!records) { noRecords++; noRecordNames.push(d.name); continue; }
  const abilityClauses = new Set((row.abilities ?? []).flatMap((a) => (a.clause === undefined ? [] : [a.clause])));
  const granted = grantedTokenClauses(d as never);
  const hasManaLines = (row.manaLines?.length ?? 0) > 0;
  const texts = clauseTexts(d as never);
  const isLand = /\bLand\b/.test(d.typeLine ?? "");
  // The twin map is derive's own: it is only needed when something would be reported, so derive again just for those cards.
  const plain = droppedKeys(records, { abilityClauses, granted, hasManaLines, spliced: new Set(), isLand, texts, cardName: d.name });
  if (plain.length === 0) continue;
  const { spliced } = deriveAbilitiesOf(deriveInputOf(d as never, d._id, d.name, records, undefined, g?.readings));
  const keys = droppedKeys(records, { abilityClauses, granted, hasManaLines, spliced, isLand, texts, cardName: d.name });
  if (keys.length > 0) {
    measured[d.name] = keys; actions += keys.length;
    reportedBy[d.name] = new Set((row.unclaimed ?? []).map((u) => String(u.clause)));
  }
}
if (underived + noRecords > 0) console.log(`underived: ${listSome(underivedNames)}; no clause records: ${listSome(noRecordNames)}`);
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
