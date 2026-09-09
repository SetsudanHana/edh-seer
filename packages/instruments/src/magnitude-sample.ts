/** Draws the blinded worksheet for the MAGNITUDE measurement -- roadmap AE4, spec
 *  `docs/superpowers/specs/2026-09-09-edge-magnitude-design.md` §4.
 *
 *  FREE: no API key, no model. Reads the 71 calibration decks through the same `analyzeDeckStructured`
 *  call the panel uses, takes every payoff with at least three real-card feeders, buckets payoffs by
 *  the WIDTH of their narrowest demand (narrow / type / wide), samples N of each, three feeders per
 *  payoff, and writes:
 *
 *    <out>/worksheet.jsonl   what the owner ranks -- payoff, three feeders, oracle text, nothing else
 *    <out>/key.json          per row: the deck, the width, today's weight and the §2 product per feeder
 *    <out>/sheet.html        the ranking page (magnitude-sheet-html.ts)
 *
 *  The key is a SEPARATE file: the engine's orderings must not be on the sheet, and the feeders are
 *  shuffled so their order on the page says nothing. Usage:
 *
 *    npx tsx packages/instruments/src/magnitude-sample.ts [--n 20] [--seed 20260909] [--out DIR] */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames, scratchDir } from "@edh-seer/data";
import { ComboIndex, impactEdgeWeight, loadImpactWeights, type Reason } from "@edh-seer/engine";
import { createTagsLookup, type CardTags } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "@edh-seer/matcher";
import { sample, seededRng } from "./precision-core.js";
import { AXIS_BOOST, edgeTerms, narrowestWidth, productEdgeWeight, type Width } from "./magnitude-core.js";
import { renderMagnitudeSheet, type MagnitudeRow } from "./magnitude-sheet-html.js";
import type { SheetCard } from "./rejudge-sheet-html.js";

const DIR = "packages/cli/decks/calibration";
const arg = (flag: string, fallback: string): string => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1]! : fallback; };
const N = Number(arg("--n", "20"));
const SEED = Number(arg("--seed", "20260909"));
const OUT = arg("--out", scratchDir("magnitude"));

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tagsLookup = createTagsLookup(store.db, "derived");
const tokenTags = await loadTokenTags(store.db);
const weights = loadImpactWeights();

interface Candidate {
  deck: string; consumer: string; width: Width;
  feeders: Map<string, Reason[]>;
  axis: Map<string, number>;
  tags: Map<string, CardTags | null>;
  cards: Map<string, SheetCard>;
}
const pools: Record<Width, Candidate[]> = { narrow: [], type: [], wide: [] };

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const deck = file.replace(/\.txt$/, "");
  const sections = parseDecklistSections(readFileSync(join(DIR, file), "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmd = new Set(sections.commanders.map(normalizeName));
  const deckCards = await buildDeckCards(cards, lookup, tagsLookup);
  const report = analyzeDeckStructured(deckCards, cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name), undefined, undefined, new ComboIndex(combos), undefined, tokenTags);
  const axis = new Map((report.axis ?? []).map((x: { tag: string; weight: number }) => [x.tag, x.weight]));
  const tags = new Map(deckCards.map((dc) => [dc.card.name, dc.tags ?? null]));
  const sheet = new Map<string, SheetCard>(cards.map((c) => [c.name, {
    name: c.name, cost: (c as { manaCost?: string }).manaCost ?? "", typeLine: (c as { typeLine?: string }).typeLine ?? "",
    colors: (c as { colors?: string[] }).colors ?? [], oracle: (c as { oracleText?: string }).oracleText ?? "",
  }]));
  const byConsumer = new Map<string, Map<string, Reason[]>>();
  for (const e of report.edges) for (const r of e.reasons) {
    if (!r.producer || !r.consumer || r.producerIsToken || r.consumerIsToken || r.tag === "combo") continue;
    if (!sheet.has(r.producer) || !sheet.has(r.consumer)) continue; // a face or a name the decklist does not carry
    if (!byConsumer.has(r.consumer)) byConsumer.set(r.consumer, new Map());
    const m = byConsumer.get(r.consumer)!;
    m.set(r.producer, [...(m.get(r.producer) ?? []), r]);
  }
  for (const [consumer, feeders] of byConsumer) {
    if (feeders.size < 3) continue;
    const width = narrowestWidth([...feeders.values()].flat().map((r) => r.tag));
    if (!width) continue;
    pools[width].push({ deck, consumer, width, feeders, axis, tags, cards: sheet });
  }
}
console.log(`payoffs with 3+ real-card feeders:  narrow ${pools.narrow.length}  type ${pools.type.length}  wide ${pools.wide.length}`);

const rng = seededRng(SEED);
const rows: MagnitudeRow[] = [];
const key: { seed: number; n: number; drawnAt: string; population: Record<Width, number>; rows: unknown[] } = {
  seed: SEED, n: N, drawnAt: new Date().toISOString(),
  population: { narrow: pools.narrow.length, type: pools.type.length, wide: pools.wide.length }, rows: [],
};
const maxAxis = (reasons: Reason[], axis: Map<string, number>): number => Math.max(0, ...reasons.map((r) => axis.get(r.tag) ?? 0));
for (const width of ["narrow", "type", "wide"] as Width[]) {
  for (const c of sample(pools[width], N, rng)) {
    // A TRIPLE THE CANDIDATE CAN ORDER, where the payoff has one. Three random feeders of a spell
    // payoff are three one-shot instants at identical weight under BOTH models (the first draw tied
    // 47 of 60 rows under the product, 53 under today's), and a row where the engine ties every
    // pair is half credit by construction and tests nothing. So the draw takes feeders with
    // DISTINCT product weights first and fills from the rest at random; `discriminated` in the key
    // says which rows the candidate could order at all. Pre-registered as the sampling rule (§4.1).
    const productOf = (p: string) => productEdgeWeight(c.feeders.get(p)!, { kinds: weights.kinds, producer: c.tags.get(p), consumer: c.tags.get(c.consumer), axis: c.axis });
    const shuffled = sample([...c.feeders.keys()], c.feeders.size, rng);
    const picked: string[] = [];
    const seenW = new Set<number>();
    for (const p of shuffled) { const w = Math.round(productOf(p) * 1e6); if (!seenW.has(w)) { seenW.add(w); picked.push(p); } if (picked.length === 3) break; }
    for (const p of shuffled) { if (picked.length === 3) break; if (!picked.includes(p)) picked.push(p); }
    const discriminated = seenW.size === 3;
    const id = rows.length;
    rows.push({ id, deck: c.deck, payoff: c.cards.get(c.consumer)!, feeders: picked.map((p) => c.cards.get(p)!) });
    key.rows.push({
      id, deck: c.deck, consumer: c.consumer, width, discriminated,
      feeders: picked.map((p) => {
        const reasons = c.feeders.get(p)!;
        const today = impactEdgeWeight(reasons, weights) * (1 + AXIS_BOOST * maxAxis(reasons, c.axis));
        const product = productEdgeWeight(reasons, { kinds: weights.kinds, producer: c.tags.get(p), consumer: c.tags.get(c.consumer), axis: c.axis });
        const terms = edgeTerms(reasons, { kinds: weights.kinds, producer: c.tags.get(p), consumer: c.tags.get(c.consumer), axis: c.axis });
        return { name: p, tags: [...new Set(reasons.map((r) => r.tag))], today, product, terms };
      }),
    });
  }
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "worksheet.jsonl"), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
writeFileSync(join(OUT, "key.json"), `${JSON.stringify(key, null, 1)}\n`);
writeFileSync(join(OUT, "sheet.html"), renderMagnitudeSheet(rows, `Magnitude — ${rows.length} payoffs, rank the feeders`));
console.log(`drew ${rows.length} rows -> ${OUT}/worksheet.jsonl, sheet.html (key sealed in key.json)`);
await store.close();
process.exit(0);
