/** Draws the blinded worksheet for the JUDGE-AGREEMENT measurement.
 *  Spec: `docs/superpowers/specs/2026-08-06-judge-agreement-design.md`, registered before drawing.
 *
 *  FREE: no API key, no model, no spend.
 *
 *  Every precision number this project reports is denominated in ONE judge's verdicts, and that
 *  judge is Claude. §22–23 re-judged 150 claims and agreed 150/150, pre-registered as uninformative:
 *  a judge agreeing with itself measures nothing. This draws claims the engine makes TODAY, strips
 *  the cached verdict, and asks the user — the authority — to judge them cold. A disagreement is the
 *  judge's error by definition.
 *
 *  Stratified by MY OWN cached verdict, 25 real / 15 false, because the measured bias is
 *  directional: four of the six corrections on 2026-08-06 were claims I called real that were not.
 *
 *  Writes:
 *    <out>/worksheet.jsonl   what gets judged — two cards, full oracle text, and NO verdict
 *    <out>/key.json          the cached verdict per id, sealed until judgments are on disk
 *
 *  Usage: tsx src/bin/agreement-sample.ts [--real 25] [--false 15] [--seed 20260806] [--out DIR]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames,
} from "@mtg/data";
import { ComboIndex } from "@mtg/engine";
import { createTagsLookup } from "@mtg/tagger";
import { analyzeDeckStructured, buildDeckCards, type CardTagsLookup } from "../index.js";
import { claimFor } from "./precision-core.js";
import { sample, seededRng } from "./precision-core.js";
import type { PanelVerdict } from "./panel-core.js";

const PANEL = "docs/measurements/panel";
const DECKS = "packages/cli/decks/calibration";
const arg = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const N_REAL = Number(arg("--real", "25"));
const N_FALSE = Number(arg("--false", "15"));
const SEED = Number(arg("--seed", "20260806"));
const OUT = arg("--out", "/tmp/agreement");

const pairs = (JSON.parse(readFileSync(`${PANEL}/pairs.json`, "utf8")) as {
  pairs: { producer: string; consumer: string; deck: string }[];
}).pairs;
const cache = readFileSync(`${PANEL}/verdicts.jsonl`, "utf8").split("\n")
  .filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as PanelVerdict);
// Later verdicts win, matching how panel-core resolves the cache.
const verdictOf = new Map<string, PanelVerdict>();
for (const v of cache) verdictOf.set(`${v.producer}|${v.consumer}|${v.tag}`, v);

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags: CardTagsLookup = createTagsLookup(store.db, "derived");
const oracle = new Map<string, string>();

/** Every claim the engine makes on the panel today, deduped, with its cached verdict attached. */
const claims = new Map<string, { producer: string; consumer: string; tag: string; verdict: string; implied: boolean }>();
const byDeck = new Map<string, { producer: string; consumer: string }[]>();
for (const p of pairs) {
  if (!byDeck.has(p.deck)) byDeck.set(p.deck, []);
  byDeck.get(p.deck)!.push({ producer: p.producer, consumer: p.consumer });
}
for (const [deck, wanted] of byDeck) {
  const sections = parseDecklistSections(readFileSync(join(DECKS, `${deck}.txt`), "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  for (const c of cards) oracle.set(c.name, (c as { oracleText?: string }).oracleText ?? "");
  const commanders = cards
    .filter((c) => new Set(sections.commanders.map(normalizeName)).has(normalizeName(c.name)))
    .map((c) => c.name);
  const dc = await buildDeckCards(cards, lookup, tags);
  const report = analyzeDeckStructured(dc, commanders, undefined, undefined, new ComboIndex(combos));
  const want = new Set(wanted.map((w) => `${w.producer}|${w.consumer}`));
  for (const e of report.edges) {
    for (const r of e.reasons) {
      if (!r.producer || !r.consumer) continue;
      const undirected = want.has(`${r.producer}|${r.consumer}`) || want.has(`${r.consumer}|${r.producer}`);
      if (!undirected) continue;
      const key = `${r.producer}|${r.consumer}|${r.tag}`;
      const v = verdictOf.get(key);
      if (!v || (v.verdict !== "real" && v.verdict !== "false")) continue;
      claims.set(key, { producer: r.producer, consumer: r.consumer, tag: r.tag, verdict: v.verdict, implied: r.impliedProducer === true });
    }
  }
}

const all = [...claims.values()];
const pool = {
  real: all.filter((c) => c.verdict === "real"),
  false: all.filter((c) => c.verdict === "false"),
};
console.log(`judged claims the engine still makes: real ${pool.real.length} | false ${pool.false.length}`);

const rng = seededRng(SEED);
const drawn = [...sample(pool.real, N_REAL, rng), ...sample(pool.false, N_FALSE, rng)];
// Shuffle so the worksheet order carries no signal about which stratum a row came from.
for (let i = drawn.length - 1; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1));
  [drawn[i], drawn[j]] = [drawn[j], drawn[i]];
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "worksheet.jsonl"), `${drawn.map((c, id) => JSON.stringify({
  id, producer: c.producer, consumer: c.consumer, tag: c.tag,
  claim: claimFor(c.tag, c.producer, c.consumer, c.implied),
  producerOracle: oracle.get(c.producer) ?? "",
  consumerOracle: oracle.get(c.consumer) ?? "",
})).join("\n")}\n`);
writeFileSync(join(OUT, "key.json"), `${JSON.stringify({
  seed: SEED, drawnAt: new Date().toISOString(),
  cached: Object.fromEntries(drawn.map((c, id) => [id, c.verdict])),
}, null, 1)}\n`);

console.log(`drew ${drawn.length} rows -> ${OUT}/worksheet.jsonl (cached verdicts sealed in key.json)`);
await store.close();
