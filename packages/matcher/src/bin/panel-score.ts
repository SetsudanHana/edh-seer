/** FREE. Re-scores the frozen panel against the CURRENT engine. Run after every change.
 *
 *  Spec: `docs/superpowers/specs/2026-08-05-edge-precision-measurement-design.md` §23-24.
 *
 *  This is the paired replacement for fresh sampling. The pairs never change, so a difference between
 *  two runs is the ENGINE, not a new draw of the dice — which is what three consecutive "no
 *  measurable change" verdicts and one 6-point move on an untouched population were really saying.
 *
 *  Prints precision on the panel, and the JUDGING DEBT: claims the engine makes today that no verdict
 *  covers. The debt is the honest part. A change that adds claims cannot flatter itself, because its
 *  new claims count as owed rather than as real, and the precision figure is explicitly conditional
 *  on the debt being small.
 *
 *  Usage: tsx src/bin/panel-score.ts [--worksheet out.jsonl] */
import { readFileSync, writeFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, resolveNames } from "@mtg/data";
import { createTagsLookup } from "@mtg/tagger";
import { buildDeckCards, loadHierarchy, pairReasons, type CardTagsLookup } from "../index.js";
import { claimFor } from "./precision-core.js";
import { scorePanel, wilsonPanel, type PanelClaim, type PanelVerdict } from "./panel-core.js";

const PANEL = "docs/measurements/panel";
const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const pairs = (JSON.parse(readFileSync(`${PANEL}/pairs.json`, "utf8")) as {
  pairs: { producer: string; consumer: string }[];
}).pairs;
const cache = readFileSync(`${PANEL}/verdicts.jsonl`, "utf8").split("\n")
  .filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as PanelVerdict);

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags: CardTagsLookup = createTagsLookup(store.db, "derived");
const h = loadHierarchy();

// Every card the panel names, resolved once. A pair is scored only if both its cards resolve, and
// any that do not are reported rather than skipped silently.
const wanted = new Set(pairs.flatMap((p) => [p.producer, p.consumer]));
const { cards } = await resolveNames([...wanted], lookup);
const byName = new Map((await buildDeckCards(cards, lookup, tags)).map((d) => [d.card.name, d]));

const current: PanelClaim[] = [];
let unresolved = 0;
for (const p of pairs) {
  const a = byName.get(p.producer), b = byName.get(p.consumer);
  if (!a || !b) { unresolved++; continue; }
  // Directed, matching how the claims were judged: only reasons where THIS producer supplies THIS
  // consumer belong to this pair's entry.
  for (const r of pairReasons(a, b, h)) {
    if (r.producer === p.producer && r.consumer === p.consumer) {
      current.push({ producer: p.producer, consumer: p.consumer, tag: r.tag });
    }
  }
}

// One claim, one verdict, one count. `pairReasons` can return the same (producer, consumer, tag)
// twice -- two reasons differing only by effectKind, the known display-layer duplicate -- and the
// panel keys verdicts by claim, so counting both would weight that claim double for no reason.
// (The sampling instrument counted reasons, duplicates included; the panel counts claims. The two
// measures are therefore not identical, which is one more reason not to compare their levels.)
const seenClaim = new Set<string>();
const distinct = current.filter((c) => {
  const k = `${c.producer}|${c.consumer}|${c.tag}`;
  if (seenClaim.has(k)) return false;
  seenClaim.add(k);
  return true;
});
console.log(`  (${current.length - distinct.length} duplicate claims collapsed)`);

const s = scorePanel(distinct, cache);
const [lo, hi] = wilsonPanel(s.real, s.real + s.false);
console.log(`frozen panel — ${pairs.length} pairs, ${cache.length} cached verdicts`);
if (unresolved) console.log(`  UNRESOLVED pairs (card missing from the corpus): ${unresolved}`);
console.log(`  claims the engine makes on the panel today: ${distinct.length}`);
console.log(`  real ${s.real} | false ${s.false} | uncertain ${s.uncertain}`);
console.log(`  PRECISION ${s.precision === null ? "n/a" : `${(s.precision * 100).toFixed(1)}% [${lo.toFixed(1)}, ${hi.toFixed(1)}]`}`);
console.log(`  judging DEBT (claims with no verdict): ${s.unjudged.length}`);
// The debt is not a footnote: until it is judged, precision is only bounded. Printing the bound
// stops the headline being read as settled when a third of the claims are unaccounted for.
if (s.unjudged.length) {
  const worst = s.real / (s.real + s.false + s.unjudged.length);
  const best = (s.real + s.unjudged.length) / (s.real + s.false + s.unjudged.length);
  console.log(`    -> until it is judged, true panel precision is bounded [${(worst * 100).toFixed(1)}, ${(best * 100).toFixed(1)}]`);
}
console.log(`  cached verdicts the engine no longer claims: ${s.dropped}`);

const out = arg("--worksheet");
if (out && s.unjudged.length) {
  const oracle = new Map(cards.map((c) => [c.name, (c as { oracleText?: string }).oracleText ?? ""]));
  writeFileSync(out, `${s.unjudged.map((c, id) => JSON.stringify({
    id, producer: c.producer, consumer: c.consumer, tag: c.tag,
    claim: claimFor(c.tag, c.producer, c.consumer),
    producerOracle: oracle.get(c.producer) ?? "", consumerOracle: oracle.get(c.consumer) ?? "",
  })).join("\n")}\n`);
  console.log(`\n  wrote the debt as a worksheet -> ${out}`);
}
await store.close();
