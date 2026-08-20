/** FREE, one-off. Builds the frozen panel out of the judging already done.
 *
 *  A panel drawn fresh would start with 100% judging debt AND would not reuse a single existing
 *  verdict: across the three 300-row draws only ONE claim was ever sampled twice, so a new random
 *  panel overlaps them essentially not at all. Building the panel FROM the judged claims inverts
 *  that — every verdict already earned is in the cache on day one, and the panel covers exactly the
 *  region of the population this project actually knows something about.
 *
 *  Usage: tsx src/bin/panel-build.ts */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { claimKey, mergeVerdicts, type PanelVerdict } from "./panel-core.js";

const DRAWS = ["2026-08-06", "2026-08-07", "2026-08-08"];
const OUT = "docs/measurements/panel";

const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as T);

let verdicts: PanelVerdict[] = [];
const pairs = new Map<string, { producer: string; consumer: string; deck: string }>();

for (const draw of DRAWS) {
  const dir = `docs/measurements/${draw}-edge-precision`;
  const worksheet = new Map(
    readJsonl<{ id: number; producer: string; consumer: string; tag: string }>(join(dir, "worksheet.jsonl"))
      .map((r) => [r.id, r]),
  );
  const judged = readJsonl<{ id: number; verdict: PanelVerdict["verdict"]; cause?: string; note: string }>(
    join(dir, "judgments.jsonl"),
  );
    // The DECK each row was sampled from. chosenType resolution is deck-dependent
  // (matcher/src/chosen-type.ts picks the deck's dominant subtype), so a claim only means what it
  // meant when judged if it is re-scored in the same deck. A panel that dropped this would be
  // measuring something adjacent to the engine rather than the engine.
  const byDeck = (JSON.parse(readFileSync(join(dir, "key.json"), "utf8")) as { byDeck: Record<string, string> }).byDeck;
  const incoming: PanelVerdict[] = [];
  for (const j of judged) {
    const w = worksheet.get(j.id);
    if (!w) continue;
    incoming.push({
      producer: w.producer, consumer: w.consumer, tag: w.tag,
      verdict: j.verdict, cause: j.cause ?? "", note: j.note,
    });
    pairs.set(`${w.producer}|${w.consumer}`, { producer: w.producer, consumer: w.consumer, deck: byDeck[String(j.id)] ?? "" });
  }
  verdicts = mergeVerdicts(verdicts, incoming);
  console.log(`  ${draw}: ${incoming.length} verdicts`);
}

// The 2026-08-07 re-judge (spec §22-23) is folded in last. It agreed on all 150 rows, so it changes
// nothing -- but it is the most recent judging of those claims and the merge rule says later wins,
// so applying it keeps the cache's provenance honest rather than convenient.
const rejudgeDir = "docs/measurements/2026-08-07-edge-precision";
const rw = new Map(
  readJsonl<{ id: number; producer: string; consumer: string; tag: string }>(join(rejudgeDir, "worksheet.jsonl"))
    .map((r) => [r.id, r]),
);
const rj = readJsonl<{ id: number; verdict: PanelVerdict["verdict"]; cause?: string; note: string }>(
  join(rejudgeDir, "rejudge.jsonl"),
);
verdicts = mergeVerdicts(verdicts, rj.flatMap((j) => {
  const w = rw.get(j.id);
  return w ? [{ producer: w.producer, consumer: w.consumer, tag: w.tag, verdict: j.verdict, cause: j.cause ?? "", note: j.note }] : [];
}));
console.log(`  2026-08-07 re-judge: ${rj.length} verdicts folded in`);

// Every verdict file that is NOT the generated cache: debt paid against a worksheet, and
// corrections to earlier judging. Kept as their own files so a rebuild cannot silently drop them --
// which it did twice, once for the debt and once for the corrections, each time because the build
// only knew about the three sampled draws. Matching on the prefix rather than an allow-list is the
// point: a new file of verdicts is picked up without editing this.
for (const f of readdirSync(OUT).filter((n) => n.startsWith("verdicts-") && n.endsWith(".jsonl") && n !== "verdicts.jsonl")) {
  const paid = readJsonl<PanelVerdict>(join(OUT, f));
  verdicts = mergeVerdicts(verdicts, paid);
  console.log(`  ${f}: ${paid.length} verdicts folded in`);
}

// THE EXISTING CACHE IS ITSELF A SOURCE, and this is the THIRD time its absence has cost verdicts.
// The comment above says a rebuild dropped them "twice"; on 2026-08-20 a rebuild run to fold in ten
// re-judged claims took judging debt 0 -> 26, because **28 unique verdicts exist ONLY in the
// generated cache** — judgements made in-session and paid against worksheets that were never kept
// as their own `verdicts-*.jsonl`.
//
// (The raw line counts looked far worse, 1,689 -> 1,084, and that number is MOSTLY DUPLICATE LINES
// COLLAPSING: the cache holds 1,689 lines for 1,112 distinct claims. Count unique claims before
// panicking, and before reporting a loss.)
//
// Folding the cache in as the FIRST source makes a rebuild monotonic — it can add and it can
// overwrite, but it can no longer forget. Measured after the fix: a rebuild loses ZERO.
const previous = existsSync(join(OUT, "verdicts.jsonl")) ? readJsonl<PanelVerdict>(join(OUT, "verdicts.jsonl")) : [];
if (previous.length > 0) {
  verdicts = mergeVerdicts(previous, verdicts);
  console.log(`  existing cache: ${previous.length} rows folded in (a rebuild may add, never forget)`);
}
// COUNTED ON DISTINCT CLAIMS, never on rows: the cache is de-duplicated by this rebuild, so a
// row-count comparison fires on every legitimate run and would make the guard noise.
const distinctClaims = (vs: readonly PanelVerdict[]): number =>
  new Set(vs.map((v) => claimKey(v.producer, v.consumer, v.tag))).size;
if (distinctClaims(verdicts) < distinctClaims(previous)) {
  console.error(`REFUSING TO WRITE: rebuild produced ${distinctClaims(verdicts)} distinct claims, `
    + `fewer than the ${distinctClaims(previous)} already cached. A verdict exists that no source file reproduces.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "pairs.json"), `${JSON.stringify({
  builtFrom: DRAWS,
  note: "Frozen. Adding pairs is allowed; removing one deletes evidence and must not happen silently.",
  pairs: [...pairs.values()],
}, null, 1)}\n`);
writeFileSync(join(OUT, "verdicts.jsonl"), `${verdicts.map((v) => JSON.stringify(v)).join("\n")}\n`);

console.log(`\npanel: ${pairs.size} pairs, ${verdicts.length} cached verdicts -> ${OUT}`);
