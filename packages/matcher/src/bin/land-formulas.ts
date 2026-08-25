import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections,
} from "@mtg/data";
import { createTagsLookup } from "@mtg/tagger";
import { detectBuildCategories, gatedLandsTarget } from "../build.js";
import { landInputs, recommendedLands } from "../land-count.js";
import { STANDARD_KEEP, pLandDrops } from "../mulligan.js";
import type { DeckCard } from "../types.js";

/** Five published land-count formulas against what the 71 calibration decks actually run.
 *
 *  WHAT THIS MEASURES AND WHAT IT DOES NOT. It scores each formula on AGREEMENT with one owner's
 *  71 decks -- the self-comparison trap `BASE_TARGETS` already carries. A formula that fits best
 *  here is the one that best DESCRIBES how these decks were built; it is not thereby correct, and
 *  a formula that disagrees may be right about a deck nobody in this corpus built. Read it as a
 *  descriptive fit test.
 *
 *  Karsten is the incumbent (`land-count.ts`, a published regression). The other four come from
 *  community sources collected 2026-08-23 and are transcribed here verbatim from their posts, with
 *  every interpretation of an ambiguous term written down beside it.
 *
 *  Free: Mongo reads only, no derive, no spend.
 *
 *    npx tsx packages/matcher/src/bin/land-formulas.ts */
const DECK_DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");

const isLand = (dc: DeckCard): boolean => dc.card.typeLine.toLowerCase().includes("land");
const producesMana = (dc: DeckCard): boolean => (dc.card.producedMana ?? []).length > 0;

interface Facts {
  actual: number;
  avgManaValue: number;
  colors: number;
  commanderCount: number;
  commanderMV: number;
  /** Nonland mana producers at mana value 0, excluding Mana Crypt (priced separately below). */
  rocks0: number;
  /** Nonland mana producers at mana value 1. */
  rocks1: number;
  /** Nonland mana producers at mana value 2-3. */
  rocks23: number;
  manaCrypt: number;
  draw: number;
  /** Every nonland mana source, for RambIe's "mana" total. */
  accel: number;
}

const FORMULAS: { name: string; source: string; f: (x: Facts) => number }[] = [
  // "28 + (2 × number of colors) + average mana value" -- threeforonetrading.com
  { name: "ThreeForOne", source: "28 + 2C + avgMV", f: (x) => 28 + 2 * x.colors + x.avgManaValue },

  // "30 + CMC of commander + average CMC of deck - reductions for mana rocks/dorks/spells",
  // Mana Crypt -1.0, Sol Ring (0-1 CMC rocks) -0.5, 2-3 CMC rocks -0.25, draw spells -0.10 each.
  // AMBIGUITY, recorded rather than resolved silently: the post prices Mana Crypt at -1.0 AND puts
  // "0-1 CMC rocks" at -0.5 with Sol Ring as its example -- but Mana Crypt is itself mana value 0,
  // so the two buckets overlap. Read here as Mana Crypt -1.0 and every OTHER 0-1 rock -0.5, which
  // is the only reading under which both lines do work.
  {
    name: "Azdranax", source: "30 + cmdrMV + avgMV - rocks - draw",
    f: (x) => 30 + x.commanderMV + x.avgManaValue
      - 1.0 * x.manaCrypt - 0.5 * (x.rocks0 + x.rocks1) - 0.25 * x.rocks23 - 0.10 * x.draw,
  },

  // "average cmc x 15 to decide how much mana to put in the deck" -- and mana explicitly INCLUDES
  // dorks, rocks and fetches, so the land count is that total minus the nonland sources.
  { name: "RambIe", source: "avgMV x 15 - nonland sources", f: (x) => x.avgManaValue * 15 - x.accel },

  // "Total Lands = 37 - Y", Y = number of commanders. The only source with a partner adjustment.
  { name: "MagicalHacker", source: "37 - commanders", f: (x) => 37 - x.commanderCount },

  // The flat consensus of the twelve sources read, as a control: a constant should be hard to beat
  // if the corpus is as convention-bound as the 36-38 agreement suggests.
  { name: "Flat37", source: "37", f: () => 37 },
];

function report(rows: { deck: string; facts: Facts; karsten: number }[]): void {
  // THE INCUMBENT IS THE GATED TARGET, NOT RAW KARSTEN. `gatedLandsTarget` already refuses an
  // extrapolation and falls back to the flat 36, so scoring the raw regression would measure a
  // number the product never shows anyone. Both are reported: the gap between them IS the gate.
  const cols = ["Gated", "KarstenRaw", ...FORMULAS.map((f) => f.name)];
  const preds = (r: typeof rows[number]): number[] =>
    [gatedLandsTarget(r.karsten).target, r.karsten, ...FORMULAS.map((f) => Math.round(f.f(r.facts)))];

  console.log(`  ${"deck".padEnd(30)} ${"runs".padStart(4)} ${cols.map((c) => c.padStart(13)).join("")}`);
  for (const r of rows) {
    const p = preds(r);
    console.log(
      `  ${r.deck.padEnd(30)} ${String(r.facts.actual).padStart(4)} ` +
      p.map((v) => `${String(v).padStart(6)}${(v - r.facts.actual >= 0 ? "+" : "")}${v - r.facts.actual}`
        .padStart(13)).join(""),
    );
  }

  console.log(`\n  ${rows.length} decks · signed delta is FORMULA MINUS ACTUAL\n`);
  console.log(`  ${"formula".padEnd(16)} ${"source".padEnd(32)} ${"MAE".padStart(6)} ${"bias".padStart(7)} ${"within2".padStart(8)} ${"range".padStart(10)}`);
  for (let i = 0; i < cols.length; i++) {
    const d = rows.map((r) => preds(r)[i] - r.facts.actual);
    const abs = d.map(Math.abs);
    const mae = abs.reduce((a, b) => a + b, 0) / d.length;
    const bias = d.reduce((a, b) => a + b, 0) / d.length;
    const within = abs.filter((v) => v <= 2).length;
    const all = rows.map((r) => preds(r)[i]);
    const src = i === 0 ? "SHIPPED: karsten, flat 36 if outside" : i === 1 ? "published regression, ungated" : FORMULAS[i - 2].source;
    console.log(
      `  ${cols[i].padEnd(16)} ${src.padEnd(32)} ${mae.toFixed(2).padStart(6)} ` +
      `${(bias >= 0 ? "+" : "") + bias.toFixed(2)}`.padStart(8) +
      `${String(within).padStart(8)} ${`${Math.min(...all)}-${Math.max(...all)}`.padStart(10)}`,
    );
  }
  // KARSTEN IS FITTED ON avgMV 1.8-3.5 AND THIS CORPUS RUNS PAST IT. Splitting on the published
  // arms separates "the regression is worse" from "the regression is being extrapolated", which
  // are different verdicts: a formula asked a question outside its domain has not been beaten.
  const inArm = (r: typeof rows[number]): boolean =>
    r.facts.avgManaValue >= 1.8 && r.facts.avgManaValue <= 3.5;
  for (const [label, subset] of [["inside arms 1.8-3.5", rows.filter(inArm)], ["outside", rows.filter((r) => !inArm(r))]] as const) {
    if (subset.length === 0) continue;
    console.log(`\n  ${label} (${subset.length} decks)`);
    for (let i = 0; i < cols.length; i++) {
      const d = subset.map((r) => preds(r)[i] - r.facts.actual);
      const abs = d.map(Math.abs);
      console.log(
        `    ${cols[i].padEnd(16)} MAE ${(abs.reduce((a, b) => a + b, 0) / d.length).toFixed(2).padStart(5)}` +
        `  bias ${((d.reduce((a, b) => a + b, 0) / d.length) >= 0 ? "+" : "") + (d.reduce((a, b) => a + b, 0) / d.length).toFixed(2)}` +
        `  within2 ${abs.filter((v) => v <= 2).length}/${d.length}`,
      );
    }
  }

  const actuals = rows.map((r) => r.facts.actual);
  console.log(`\n  actual land counts: ${Math.min(...actuals)}-${Math.max(...actuals)}, mean ${(actuals.reduce((a, b) => a + b, 0) / actuals.length).toFixed(1)}`);
}


/** `--probability`: the same recommendations, priced as what they DELIVER rather than as how closely
 *  they resemble 71 decks (roadmap L1).
 *
 *  THIS IS A SENSITIVITY AND NOT A CONTEST, and the distinction is the item's own correction.
 *  `P` is a monotone function of `L` at a fixed deck size, so ranking formulas by distance in
 *  probability is ranking them by distance in lands with a squash applied -- the probability scale
 *  cannot create discriminating information the land scale lacks. What it DOES buy is an absolute
 *  reading with no fit in it: "this deck makes its first three land drops 88% of the time" is a
 *  statement about the deck, not about how much it looks like the others, which is the target
 *  contamination `report()` above cannot escape.
 *
 *  L1's OTHER PROPOSAL IS REFUSED HERE RATHER THAN BUILT. Scoring formulas by MAE against
 *  `landsForDrops(...)` cannot work: that function takes no deck argument (`DECK`/`HAND` are module
 *  constants), so its answer varies only through `need`, and the step is enormous -- 37 lands for
 *  three drops at 90%, 49 for four. Either every deck's target is 37, in which case `Flat37` scores
 *  a perfect zero and the metric is the constant it was written to expose, or a deck's target is 49
 *  and no Commander deck can reach it. Spec §10.1. */
const NEEDS = [3, 4] as const;

function probabilityReport(rows: { deck: string; facts: Facts; karsten: number }[]): void {
  const cols = ["Gated", ...FORMULAS.map((f) => f.name)];
  const preds = (r: typeof rows[number]): number[] =>
    [gatedLandsTarget(r.karsten).target, ...FORMULAS.map((f) => Math.round(f.f(r.facts)))];
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

  for (const need of NEEDS) {
    console.log(`\n  === P(first ${need} land drops), under the free-mulligan policy (mulligan.ts) ===\n`);
    console.log(`  ${"deck".padEnd(32)} ${"runs".padStart(4)} ${"ACTUAL".padStart(7)}   `
      + cols.map((c) => c.padStart(9)).join("") + `   ${"spread".padStart(7)}`);
    const spreads: number[] = [];
    for (const r of rows) {
      const ps = preds(r).map((l) => pLandDrops(l, need));
      const spread = Math.max(...ps) - Math.min(...ps);
      spreads.push(spread);
      console.log(`  ${r.deck.padEnd(32)} ${String(r.facts.actual).padStart(4)} `
        + `${pct(pLandDrops(r.facts.actual, need)).padStart(7)}   `
        + ps.map((v) => pct(v).padStart(9)).join("") + `   ${`${(spread * 100).toFixed(1)}pp`.padStart(7)}`);
    }
    const q = [...spreads].sort((a, b) => a - b);
    const at = (f: number): number => q[Math.min(q.length - 1, Math.floor(f * q.length))];
    const actuals = rows.map((r) => pLandDrops(r.facts.actual, need)).sort((a, b) => a - b);
    console.log(`\n  THE DECKS' OWN ANSWER: median ${pct(actuals[Math.floor(actuals.length / 2)])}`
      + ` · p25 ${pct(actuals[Math.floor(actuals.length * 0.25)])} · p75 ${pct(actuals[Math.floor(actuals.length * 0.75)])}`
      + ` · range ${pct(actuals[0])}-${pct(actuals[actuals.length - 1])}`);
    console.log(`  SPREAD ACROSS THE SIX RECOMMENDATIONS: median ${(at(0.5) * 100).toFixed(1)}pp`
      + ` · p25 ${(at(0.25) * 100).toFixed(1)}pp · p75 ${(at(0.75) * 100).toFixed(1)}pp`
      + ` · max ${(Math.max(...spreads) * 100).toFixed(1)}pp`);
    // WITHOUT RambIe, whose 20-74 range is an outlier the other five do not share: a median spread
    // set by one formula nobody would follow describes that formula, not the genre.
    const i = cols.indexOf("RambIe");
    const five = rows.map((r) => { const ps = preds(r).filter((_, k) => k !== i).map((l) => pLandDrops(l, need)); return Math.max(...ps) - Math.min(...ps); }).sort((a, b) => a - b);
    console.log(`  ... excluding RambIe (range 20-74 lands): median ${(five[Math.floor(five.length / 2)] * 100).toFixed(1)}pp`
      + ` · max ${(Math.max(...five) * 100).toFixed(1)}pp`);
    console.log(`  THE CONVERSION RATE: around 36-38 lands one land is worth `
      + `${((pLandDrops(37, need) - pLandDrops(36, need)) * 100).toFixed(2)}pp here.`);
  }

  // P3: L1's own prediction. A rank is the MAE-in-lands order, which no keep band can touch --
  // what a band moves is the PROBABILITY each recommendation delivers, so that is what is swept.
  console.log(`\n  === keep-band sensitivity (L1 predicted no rank flip) ===\n`);
  const bands: [string, ReadonlySet<number>][] = [
    ["{2,3,4}", STANDARD_KEEP], ["{2,3,4,5}", new Set([2, 3, 4, 5])], ["{3,4}", new Set([3, 4])],
  ];
  // THE ORDER IS GENEROSITY, NOT QUALITY, and it must be labelled as such or the row reads as a
  // ranking with `Flat37` winning. More probability is not better -- a 60-land deck makes every
  // land drop and loses every game. What this column tests is only whether the ORDER is stable when
  // the keep band moves, which is L1's registered prediction.
  console.log(`  ${"band".padEnd(12)} ${"median ACTUAL P(3)".padStart(20)} ${"median spread".padStart(14)}   most generous -> least (NOT best -> worst)`);
  for (const [label, keep] of bands) {
    const acts = rows.map((r) => pLandDrops(r.facts.actual, 3, keep)).sort((a, b) => a - b);
    const sp = rows.map((r) => { const ps = preds(r).map((l) => pLandDrops(l, 3, keep)); return Math.max(...ps) - Math.min(...ps); }).sort((a, b) => a - b);
    const order = cols.map((c, k) => ({ c, m: rows.reduce((a, r) => a + pLandDrops(preds(r)[k], 3, keep), 0) / rows.length }))
      .sort((a, b) => b.m - a.m).map((x) => x.c).join(" > ");
    console.log(`  ${label.padEnd(12)} ${pct(acts[Math.floor(acts.length / 2)]).padStart(20)} `
      + `${`${(sp[Math.floor(sp.length / 2)] * 100).toFixed(1)}pp`.padStart(14)}   ${order}`);
  }
}

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = createTagsLookup(store.db);
  const rows: { deck: string; facts: Facts; karsten: number }[] = [];

  for (const file of readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort()) {
    const sections = parseDecklistSections(readFileSync(join(DECK_DIR, file), "utf8"));
    const deck: DeckCard[] = [];
    for (const name of [...sections.commanders, ...sections.deck]) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      deck.push({ card: docToCard(doc), tags: await cardTags.findOne(String(doc._id)) });
    }
    const commanders = new Set(sections.commanders);
    const cmdrCards = deck.filter((dc) => commanders.has(dc.card.name));
    const library = deck.filter((dc) => !commanders.has(dc.card.name));
    const nonland = library.filter((dc) => !isLand(dc));
    const rocks = nonland.filter(producesMana);
    const members = detectBuildCategories([...library]);

    const rec = recommendedLands(deck, { commanderNames: sections.commanders });
    // Karsten's own inputs supply avgManaValue, so the curve every formula reads is the same one --
    // an MDFC counts as a spell here too, and the formulas cannot disagree about the input.
    const inputs = landInputs(deck, { commanderNames: sections.commanders });

    rows.push({
      deck: file.replace(/\.txt$/, ""),
      karsten: rec.target,
      facts: {
        actual: rec.actual,
        avgManaValue: inputs.avgManaValue,
        // A deck's colours are its COMMANDER's identity (CR 903.4), not the union of what it plays.
        colors: new Set(cmdrCards.flatMap((dc) => dc.card.colorIdentity ?? [])).size,
        commanderCount: Math.max(1, cmdrCards.length),
        commanderMV: cmdrCards.reduce((s, dc) => s + dc.card.manaValue, 0),
        rocks0: rocks.filter((dc) => dc.card.manaValue === 0 && dc.card.name !== "Mana Crypt").length,
        rocks1: rocks.filter((dc) => dc.card.manaValue === 1).length,
        rocks23: rocks.filter((dc) => dc.card.manaValue >= 2 && dc.card.manaValue <= 3).length,
        manaCrypt: rocks.filter((dc) => dc.card.name === "Mana Crypt").length,
        draw: (members.get("draw") ?? new Set()).size,
        accel: rocks.length,
      },
    });
  }

  if (process.argv.includes("--probability")) probabilityReport(rows);
  else report(rows);
  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
