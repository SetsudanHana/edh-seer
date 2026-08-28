/** Draws the blinded worksheet for the edge-precision measurement.
 *  Spec: `docs/superpowers/specs/2026-08-05-edge-precision-measurement-design.md`.
 *
 *  FREE: no API key, no model, no spend. Reads the 71 calibration decks under BOTH tag sources,
 *  samples each source's own reasons, strips everything identifying, and writes two files:
 *
 *    <out>/worksheet.jsonl   what gets judged — the structured claim plus both cards' oracle text
 *    <out>/key.json          which source each id came from
 *
 *  The key is a SEPARATE file so it can stay unopened until judgments are committed to disk. That
 *  ordering is what makes "I did not tune the verdicts to the answer" a property of the process
 *  rather than a promise.
 *
 *  Usage: tsx src/bin/precision-sample.ts [--n 150] [--seed 20260805] [--out /tmp/precision] */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames,
} from "@edh-seer/data";
import { ComboIndex } from "@edh-seer/engine";
import { createTagsLookup } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, type CardTagsLookup } from "../index.js";
import { blind, claimFor, sample, seededRng, type SampledReason, type Source } from "./precision-core.js";

const DIR = "packages/cli/decks/calibration";
const arg = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const N = Number(arg("--n", "150"));
const SEED = Number(arg("--seed", "20260805"));
const OUT = arg("--out", "/tmp/precision");

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const sources: Record<Source, CardTagsLookup> = {
  flat: createTagsLookup(store.db, "flat"),
  derived: createTagsLookup(store.db, "derived-first"),
};

const pools: Record<Source, SampledReason[]> = { flat: [], derived: [] };
/** oracleId presence per card name, so the report can separate rows where the "derived" arm was
 *  actually serving a FLAT fallback (24 cards still have no clause doc). */
const derivedDoc = new Map<string, boolean>();
const oracle = new Map<string, string>();

const derivedCol = store.db.collection("cardTagsDerived");

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(join(DIR, file), "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmdNorm = new Set(sections.commanders.map(normalizeName));
  const commanderNames = cards.filter((c) => cmdNorm.has(normalizeName(c.name))).map((c) => c.name);
  const deck = file.replace(/\.txt$/, "");

  for (const c of cards) {
    if (!oracle.has(c.name)) oracle.set(c.name, (c as { oracleText?: string }).oracleText ?? "");
  }

  for (const source of ["flat", "derived"] as const) {
    const deckCards = await buildDeckCards(cards, lookup, sources[source]);
    if (source === "derived") {
      for (const dc of deckCards) {
        if (derivedDoc.has(dc.card.name)) continue;
        const t = dc.tags as { oracleId?: string } | null;
        const has = Boolean(t?.oracleId
          && await derivedCol.countDocuments({ oracleId: t.oracleId }, { limit: 1 }));
        derivedDoc.set(dc.card.name, has);
      }
    }
    const report = analyzeDeckStructured(
      deckCards, commanderNames, undefined, undefined, new ComboIndex(combos),
    );
    for (const edge of report.edges) {
      for (const r of edge.reasons) {
        // Only reasons naming both sides are judgeable: the claim IS "this producer supplies
        // something this consumer cares about", so a reason missing either end states nothing to
        // judge. Combo reasons are excluded for the same reason — they come from the combo index,
        // not from either tag population, so they measure neither.
        if (!r.producer || !r.consumer || r.tag === "combo") continue;
        pools[source].push({ source, deck, producer: r.producer, consumer: r.consumer, tag: r.tag });
      }
    }
  }
  process.stdout.write(".");
}

const drawn = [
  ...sample(pools.flat, N, seededRng(SEED)),
  ...sample(pools.derived, N, seededRng(SEED + 1)),
];
const rows = blind(drawn, seededRng(SEED + 2));

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "worksheet.jsonl"),
  `${rows.map((row) => JSON.stringify({
    id: row.id,
    producer: row.producer,
    consumer: row.consumer,
    tag: row.tag,
    // What the reason CLAIMS, in words, built from the tag alone (precision-core.claimFor). Not
    // from the reason's prose, which would leak the code path -- but without it the tag alone does
    // not state direction, and the 2026-08-06 pass misjudged 15 rows for want of it.
    claim: claimFor(row.tag, row.producer, row.consumer),
    producerOracle: oracle.get(row.producer) ?? "",
    consumerOracle: oracle.get(row.consumer) ?? "",
    // Both cards' derived-doc status, so fallback contamination is measurable (spec §6.3).
    derivedDocs: [derivedDoc.get(row.producer) ?? false, derivedDoc.get(row.consumer) ?? false],
  })).join("\n")}\n`,
);
writeFileSync(join(OUT, "key.json"), `${JSON.stringify({
  seed: SEED,
  n: N,
  pool: { flat: pools.flat.length, derived: pools.derived.length },
  bySource: Object.fromEntries(rows.map((r) => [r.id, drawn[r.sourceIndex].source])),
  byDeck: Object.fromEntries(rows.map((r) => [r.id, drawn[r.sourceIndex].deck])),
}, null, 2)}\n`);

console.log(`\npool: flat ${pools.flat.length} reasons, derived ${pools.derived.length}`);
console.log(`drew ${rows.length} rows (seed ${SEED}) -> ${join(OUT, "worksheet.jsonl")}`);
console.log(`key (DO NOT OPEN UNTIL JUDGED) -> ${join(OUT, "key.json")}`);
await store.close();
