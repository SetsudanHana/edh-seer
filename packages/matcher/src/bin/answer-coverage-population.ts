/** The registered criteria of `2026-08-21-answer-coverage-design.md` §5, measured over the 71
 *  calibration decks. Free: Mongo reads only. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections } from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
import { analyzeDeckStructured } from "../index.js";
import { ANSWER_BASELINE } from "../answer-coverage.js";
import { loadHierarchy } from "../hierarchy.js";
import { loadTokenTags } from "../token-tags.js";
import type { DeckCard } from "../types.js";

const DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tagsCol = store.db.collection("cardTagsDerived");
const hierarchy = loadHierarchy();
const tokenTags = await loadTokenTags(store.db);

const rows: { deck: string; score: number; coverage: number; covAtV0: number; interaction: number; identity: string }[] = [];
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const s = parseDecklistSections(readFileSync(join(DIR, file), "utf8"));
  const deck: DeckCard[] = [];
  for (const name of [...s.commanders, ...s.deck]) {
    const doc = await lookup.findByName(normalizeName(name));
    if (!doc) continue;
    deck.push({ card: docToCard(doc), tags: (await tagsCol.findOne({ oracleId: doc._id })) as unknown as CardTags | null });
  }
  const rep = analyzeDeckStructured(deck, s.commanders, hierarchy, undefined, undefined, undefined, tokenTags);
  const inter = rep.buildParents!.find((p) => p.name === "Interaction")!;
  const coverage = rep.answerCoverage!;
  // CRITERION 4: the same deck with vulnerability forced to 0, to isolate the blend's effect.
  // `coverage.rows` is always `COVERAGE_CLASSES.length` (5) -- `answerCoverage` builds one row per
  // class unconditionally -- so the `.length ? ... : 1` guard this used to carry was dead (MINOR 3,
  // whole-branch review).
  // Imported, never restated -- a second copy of the table is a second thing to get wrong.
  const w = coverage.rows.map((r) => ({ ...r, weight: r.poolShare * (ANSWER_BASELINE[r.class] ?? 0) }));
  const tot = w.reduce((x, r) => x + r.weight, 0);
  const covAtV0 = tot > 0 ? w.reduce((x, r) => x + (r.covered ? r.weight : 0), 0) / tot : 1;
  rows.push({
    deck: file.replace(/\.txt$/, ""), score: rep.buildScore!, coverage: coverage.coverage,
    covAtV0, interaction: Math.min(inter.count / inter.target, 1),
    identity: coverage.source,
  });
  process.stdout.write(".");
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
console.log(`\n\nbuildScore  mean ${mean(rows.map((r) => r.score)).toFixed(3)}  median ${median(rows.map((r) => r.score)).toFixed(3)}  perfect ${rows.filter((r) => r.score >= 4.999).length}`);
console.log(`coverage    mean ${mean(rows.map((r) => r.coverage)).toFixed(3)}  median ${median(rows.map((r) => r.coverage)).toFixed(3)}  ==1 ${rows.filter((r) => r.coverage >= 0.999).length} of 71`);
console.log(`CRITERION 2 -- decks at full Interaction attainment (count alone, BEFORE): ${rows.filter((r) => r.interaction >= 0.999).length} of 71`);
// AFTER: build.ts:364 multiplies `counted * coverage.coverage` for this parent, and a product of
// two factors each <= 1 reaches ~1 only when both do -- so "full attainment" now needs the count
// target met AND every participating class answered.
console.log(`CRITERION 2 -- decks at full Interaction attainment (coverage-weighted, AFTER): ${rows.filter((r) => r.interaction >= 0.999 && r.coverage >= 0.999).length} of 71`);
console.log(`CRITERION 4 -- vulnerability effect: max |coverage - coverage(v=0)| = ${Math.max(...rows.map((r) => Math.abs(r.coverage - r.covAtV0))).toFixed(4)}, decks over 0.01: ${rows.filter((r) => Math.abs(r.coverage - r.covAtV0) > 0.01).length}`);
console.log(`unweighted identity (should be 0): ${rows.filter((r) => r.identity === "unweighted").length}`);
console.log("\nlowest coverage:");
for (const r of [...rows].sort((a, b) => a.coverage - b.coverage).slice(0, 10)) console.log(`  ${r.coverage.toFixed(3)}\t${r.score.toFixed(2)}\t${r.deck}`);
await store.close();
