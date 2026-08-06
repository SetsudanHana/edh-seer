/** Draws the blinded worksheet for the RECALL measurement.
 *  Spec: `docs/superpowers/specs/2026-08-05-edge-precision-measurement-design.md` §25.
 *
 *  FREE: no API key, no model, no spend. Reads the 71 calibration decks, finds every pair the
 *  DERIVED engine says nothing about in either direction, buckets them into the three registered
 *  strata, samples each independently, and writes:
 *
 *    <out>/worksheet.jsonl   what gets judged — two cards and their FULL oracle text, nothing else
 *    <out>/key.json          which stratum and deck each id came from
 *
 *  The key is a SEPARATE file so it stays unopened until judgments are on disk, and the worksheet
 *  carries no stratum, because knowing a row is from the LOST stratum is an invitation to find a
 *  synergy in it.
 *
 *  Usage: tsx src/bin/recall-sample.ts [--n 60] [--seed 20260806] [--out /tmp/recall] */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames,
} from "@mtg/data";
import { ComboIndex } from "@mtg/engine";
import { createTagsLookup } from "@mtg/tagger";
import { analyzeDeckStructured, buildDeckCards, cardThemeTags, type CardTagsLookup } from "../index.js";
import { sample, seededRng } from "./precision-core.js";
import { blindRecall, stratumOf, type SilentPair, type Stratum } from "./recall-core.js";

const DIR = "packages/cli/decks/calibration";
const arg = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const N = Number(arg("--n", "60"));
const SEED = Number(arg("--seed", "20260806"));
const OUT = arg("--out", "/tmp/recall");

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const derivedTags: CardTagsLookup = createTagsLookup(store.db, "derived");
const flatTags: CardTagsLookup = createTagsLookup(store.db, "flat");

const pools: Record<Stratum, SilentPair[]> = { lost: [], plausible: [], base: [] };
const oracle = new Map<string, { typeLine: string; text: string }>();

const decks = readdirSync(DIR).filter((f) => f.endsWith(".txt"));
for (const file of decks) {
  const deck = file.replace(/\.txt$/, "");
  const sections = parseDecklistSections(readFileSync(join(DIR, file), "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  for (const c of cards) {
    oracle.set(c.name, {
      typeLine: (c as { typeLine?: string }).typeLine ?? "",
      text: (c as { oracleText?: string }).oracleText ?? "",
    });
  }
  const commanders = cards
    .filter((c) => new Set(sections.commanders.map(normalizeName)).has(normalizeName(c.name)))
    .map((c) => c.name);
  const index = new ComboIndex(combos);

  const derivedCards = await buildDeckCards(cards, lookup, derivedTags);
  const flatCards = await buildDeckCards(cards, lookup, flatTags);
  const report = analyzeDeckStructured(derivedCards, commanders, undefined, undefined, index);
  const flatReport = analyzeDeckStructured(flatCards, commanders, undefined, undefined, index);

  // Undirected pair keys: a claim in EITHER direction means the engine is not silent about the pair.
  const key = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const claimed = new Set<string>();
  for (const e of report.edges) for (const r of e.reasons) {
    if (r.producer && r.consumer) claimed.add(key(r.producer, r.consumer));
  }
  const flatClaimed = new Set<string>();
  for (const e of flatReport.edges) for (const r of e.reasons) {
    if (r.producer && r.consumer) flatClaimed.add(key(r.producer, r.consumer));
  }

  const themes = new Map<string, Set<string>>();
  for (const dc of derivedCards) themes.set(dc.card.name, cardThemeTags(dc.tags));

  const names = [...new Set(derivedCards.map((c) => c.card.name))].sort();
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const k = key(names[i], names[j]);
      if (claimed.has(k)) continue;
      const shared = [...(themes.get(names[i]) ?? [])].filter((t) => themes.get(names[j])?.has(t));
      const p: SilentPair = {
        deck, a: names[i], b: names[j], flatClaims: flatClaimed.has(k), sharedThemes: shared,
      };
      pools[stratumOf(p)].push(p);
    }
  }
}

console.log("silent-pair population (derived engine says nothing, either direction):");
for (const s of ["lost", "plausible", "base"] as Stratum[]) {
  console.log(`  ${s.padEnd(10)} ${pools[s].length}`);
}

// One rng, drawn in a fixed stratum order, so the whole draw is reproducible from the seed alone.
const rng = seededRng(SEED);
const drawn: SilentPair[] = [];
const stratumById: Record<number, Stratum> = {};
for (const s of ["lost", "plausible", "base"] as Stratum[]) {
  for (const p of sample(pools[s], N, rng)) drawn.push(p);
}
const rows = blindRecall(drawn, rng);
// `blindRecall` shuffles, so recover each row's origin by matching the pair back to the draw.
const byPair = new Map(drawn.map((p) => [`${p.a}|${p.b}`, p]));
for (const r of rows) {
  const p = byPair.get(`${r.a}|${r.b}`)!;
  stratumById[r.id] = stratumOf(p);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "worksheet.jsonl"), `${rows.map((r) => JSON.stringify({
  ...r,
  aTypeLine: oracle.get(r.a)?.typeLine, aOracle: oracle.get(r.a)?.text,
  bTypeLine: oracle.get(r.b)?.typeLine, bOracle: oracle.get(r.b)?.text,
})).join("\n")}\n`);
writeFileSync(join(OUT, "key.json"), `${JSON.stringify({
  seed: SEED, n: N, drawnAt: new Date().toISOString(),
  byStratum: stratumById,
  byDeck: Object.fromEntries(rows.map((r) => [r.id, byPair.get(`${r.a}|${r.b}`)!.deck])),
}, null, 1)}\n`);

console.log(`\ndrew ${rows.length} rows -> ${OUT}/worksheet.jsonl (key sealed in key.json)`);
await store.close();
