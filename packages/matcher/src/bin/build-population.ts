import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections,
} from "@mtg/data";
import type { CardTags } from "@mtg/tagger";
import { createTagsLookup } from "@mtg/tagger";
import { detectAnswerClasses, detectBuildCategories, BUILD_CATEGORIES, BUILD_PARENTS } from "../build.js";
import { recommendedLands } from "../land-count.js";
import { winconReport } from "../wincon.js";
import { measuredClock, pressureCurve } from "../pressure.js";
import { manaModel } from "../goldfish.js";
import type { DeckCard } from "../types.js";

/** Build-category membership across the calibration decks, as one number per category plus the
 *  full membership sets.
 *
 *  THE GATE FOR ANY DETECTOR CHANGE. `population-compare.ts` watches edges and `panel-score.ts`
 *  watches edge precision; neither can see build categories at all, so a detector edit could
 *  reclassify a third of the corpus with every test green -- which is exactly how `hierarchy.json`
 *  sat at 16 of 527 subtypes for the project's whole life.
 *
 *  Free: Mongo reads only. Write a baseline before the change, diff after:
 *
 *    npx tsx packages/matcher/src/bin/build-population.ts > before.json
 *    ...edit rules...
 *    npx tsx packages/matcher/src/bin/build-population.ts > after.json
 *    npx tsx packages/matcher/src/bin/build-population.ts --diff before.json after.json */
const DECK_DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");

type Snapshot = Record<string, Record<string, string[]>>;

function diff(beforePath: string, afterPath: string): void {
  const before = JSON.parse(readFileSync(beforePath, "utf8")) as Snapshot;
  const after = JSON.parse(readFileSync(afterPath, "utf8")) as Snapshot;
  const cats = new Set([...Object.values(before), ...Object.values(after)].flatMap((d) => Object.keys(d)));

  let moved = 0;
  for (const cat of [...cats].sort()) {
    const b = new Set(Object.values(before).flatMap((d) => (d[cat] ?? []).map((n) => n)));
    const a = new Set(Object.values(after).flatMap((d) => (d[cat] ?? []).map((n) => n)));
    const gained = [...a].filter((n) => !b.has(n));
    const lost = [...b].filter((n) => !a.has(n));
    if (gained.length === 0 && lost.length === 0) {
      console.log(`  ${cat.padEnd(18)} ${String(b.size).padStart(5)}  unchanged`);
      continue;
    }
    moved += gained.length + lost.length;
    console.log(`  ${cat.padEnd(18)} ${String(b.size).padStart(5)} -> ${String(a.size).padStart(5)}  +${gained.length} -${lost.length}`);
    for (const n of gained.slice(0, 8)) console.log(`      + ${n}`);
    for (const n of lost.slice(0, 8)) console.log(`      - ${n}`);
    if (gained.length + lost.length > 16) console.log(`      ... ${gained.length + lost.length - 16} more`);
  }
  console.log(`\n${moved} distinct card-category memberships moved.`);
}

/** `--lands`: Karsten's target against what each deck actually runs.
 *
 *  The formula is Tier B and already verified; what this checks is the INPUT DERIVATION, which is
 *  ours. A regression fitted on real decks should land near real decks -- a systematic bias across
 *  71 of them means the ramp/fast-mana split is reading the wrong cards, not that 71 deckbuilders
 *  are wrong. */
function landReport(rows: { deck: string; actual: number; target: number; avg: number; ramp: number; fast: number }[]): void {
  const deltas = rows.map((r) => r.actual - r.target).sort((a, b) => a - b);
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const median = deltas[Math.floor(deltas.length / 2)];
  for (const r of rows.sort((a, b) => (a.actual - a.target) - (b.actual - b.target))) {
    const d = r.actual - r.target;
    console.log(
      `  ${r.deck.padEnd(24)} runs ${String(r.actual).padStart(2)}  wants ${String(r.target).padStart(2)}  ` +
      `${d >= 0 ? "+" : ""}${d}   avgMV ${r.avg.toFixed(2)}  ramp ${String(r.ramp).padStart(2)}  fast ${r.fast}`,
    );
  }
  console.log(
    `\n${rows.length} decks · mean actual-minus-target ${mean.toFixed(2)} · median ${median} · ` +
    `within 2: ${deltas.filter((d) => Math.abs(d) <= 2).length}`,
  );
}

/** Recompute `BuildParentSpec.costBand` from the decks and fail on drift.
 *
 *  The band is HAND-TRANSCRIBED into `BUILD_PARENTS`, and a hand-transcribed table drifting from
 *  the population it claims to describe is a defect this repo has already shipped once:
 *  `GRAVEYARD_HATE_SHARE` sat at 36/16/6 against a stated source that measured 39/19/8, because
 *  nothing recomputed it. This is that check, in the gate that already sweeps these decks. */
function reportCostBands(
  mvByLeaf: Map<string, number[]>,
): void {
  const q = (a: number[], p: number): number => {
    const sorted = [...a].sort((x, y) => x - y);
    return sorted[Math.floor(sorted.length * p)];
  };
  let drift = 0;
  for (const parent of BUILD_PARENTS) {
    const arr = parent.leaves.flatMap((l) => mvByLeaf.get(l) ?? []);
    if (arr.length === 0) { console.log(`  ${parent.name}: NO CARDS MEASURED`); drift++; continue; }
    const lo = q(arr, 0.25), hi = q(arr, 0.75);
    const inside = arr.filter((v) => v >= lo && v <= hi).length;
    const [tLo, tHi] = parent.costBand;
    const ok = lo === tLo && hi === tHi;
    if (!ok) drift++;
    console.log(
      `  ${parent.name.padEnd(12)} n=${String(arr.length).padStart(4)} measured ${lo}-${hi} ` +
      `(${((inside / arr.length) * 100).toFixed(0)}% inside) · table ${tLo}-${tHi} ${ok ? "ok" : "DRIFT"}`,
    );
  }
  if (drift > 0) {
    console.log(`\n${drift} parent(s) drifted — update BUILD_PARENTS[].costBand and its provenance comment.`);
    process.exitCode = 1;
  } else {
    console.log("\nno drift: every band matches the decks it claims to describe.");
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === "--diff") {
    diff(process.argv[3], process.argv[4]);
    return;
  }
  const landsMode = process.argv[2] === "--lands";
  const bandsMode = process.argv[2] === "--cost-bands";
  const mvByLeaf = new Map<string, number[]>();

  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  // THE SAME POPULATION THE PRODUCT READS. This gate hardcoded the FLAT `cardTags` collection, so
  // once `TAGS_SOURCE` defaulted to `derived` (2026-08-06) it was watching a population nothing
  // ships — a derivation change could reclassify a third of the corpus and this would report
  // "unchanged", which is precisely the failure it exists to catch. Same shape as gen-theme-stats.ts
  // reading flat tags while the axis ranked derived ones.
  const cardTags = createTagsLookup(store.db);
  const out: Snapshot = {};
  const landRows: { deck: string; actual: number; target: number; avg: number; ramp: number; fast: number }[] = [];

  for (const file of readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort()) {
    const sections = parseDecklistSections(readFileSync(join(DECK_DIR, file), "utf8"));
    const inputs: DeckCard[] = [];
    for (const name of [...sections.commanders, ...sections.deck]) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      const tags = await cardTags.findOne(String(doc._id));
      inputs.push({ card: docToCard(doc), tags });
    }
    if (landsMode) {
      const rec = recommendedLands(inputs, { commanderNames: sections.commanders });
      landRows.push({
        deck: file.replace(/\.txt$/, ""), actual: rec.actual, target: rec.target,
        avg: rec.avgManaValue, ramp: rec.rampPlusDraw, fast: rec.fastMana,
      });
      continue;
    }
    const members = detectBuildCategories(inputs);
    if (bandsMode) {
      // Mana value off the CARD, not off a report: this bin never builds one, and `manaValue` is the same
      // field `land-count.ts` prices a curve from.
      const mv = new Map(inputs.map((i) => [i.card.name, i.card.manaValue]));
      for (const [cat, set] of members) {
        const arr = mvByLeaf.get(cat) ?? [];
        for (const n of set) { const v = mv.get(n); if (typeof v === "number") arr.push(v); }
        mvByLeaf.set(cat, arr);
      }
      continue;
    }
    const deck: Record<string, string[]> = {};
    // Answer classes ride in the same snapshot under an `answer:` prefix, so the coverage axis is
    // under the same gate as the categories. They are a different axis, not finer categories: a
    // card is in both.
    for (const [cls, m] of detectAnswerClasses(inputs)) {
      deck[`answer:${cls}`] = [...m.cards].sort();
      // The mode sets ride in the same snapshot so the gate that proves the CLASS sets did not move
      // is also the instrument that measures the modes (design §5). Emitted only when non-empty:
      // an all-zero key on every deck is noise in a diff.
      if (m.exiling.size) deck[`answer:${cls}:exile`] = [...m.exiling].sort();
      if (m.recurring.size) deck[`answer:${cls}:recurring`] = [...m.recurring].sort();
    }
    // Wincon classes ride along too, under their own prefix: same gate, same reason.
    // Through winconReport, not detectWincons: the deck-level gates (a token maker is only a win
    // plan when something pays it off) are the part most likely to regress.
    for (const w of winconReport(inputs).classes) deck[`wincon:${w.class}`] = [String(w.count)];
    // THE CLOCK IS PRICED AGAINST A MANA BUDGET, so this gate has to run the same simulation
    // `analyze.ts` does or it would measure a clock nothing ships (roadmap L4). The commander is
    // priced without being shuffled in (CR 903.6), exactly as `analyze.ts` does it.
    const cmd = new Set(sections.commanders);
    const sim = manaModel(inputs.filter((dc) => !cmd.has(dc.card.name)), {
      alsoPrice: inputs.filter((dc) => cmd.has(dc.card.name)),
    });
    const clockOpts = { commanderNames: sections.commanders, manaBudget: sim.manaMedian };
    const clock = measuredClock(inputs, clockOpts);
    deck["clock"] = [clock === undefined ? "none" : String(clock)];
    deck["power@5"] = [pressureCurve(inputs, clockOpts)[4].power.toFixed(1)];
    // Every known category, including empty ones: a category that stops matching anything is the
    // failure this gate exists to catch, and an absent key would read as "not measured".
    for (const cat of BUILD_CATEGORIES) deck[cat] = [...(members.get(cat) ?? [])].sort();
    for (const [cat, set] of members) if (!(cat in deck)) deck[cat] = [...set].sort();
    out[file.replace(/\.txt$/, "")] = deck;
  }

  if (bandsMode) reportCostBands(mvByLeaf);
  else if (landsMode) landReport(landRows);
  else console.log(JSON.stringify(out, null, 1));
  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("build-population failed:", err);
    process.exit(1);
  });
}
