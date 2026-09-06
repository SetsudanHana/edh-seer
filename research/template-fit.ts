/** THE TEMPLATE'S DATA FILE, regenerated from the EDHREC population (spec
 *  `2026-09-06-theme-template-proposal.md` §3.1). One row per theme directory under `--dir`: the
 *  theme's MEDIAN count per parent over its decks (the themed average deck plus one real deck per
 *  top-5 commander, n=10), rounded to the half. `boardWipes` is written only where the theme leans
 *  by more than one from the population (owner ruling: wipes stay doctrine otherwise); lands never
 *  (Karsten prices the curve, land themes keep the `lands` delta). `goodstuff` is skipped: its
 *  population is cEDH midrange and must not be the fallback for a casual deck (spec §5).
 *
 *  Free: Mongo reads plus `computeBuild` per deck, no analysis run. Writes JSON to stdout:
 *
 *    tsx research/template-fit.ts --dir packages/cli/decks/edhrec > packages/matcher/src/template-targets.json
 *
 *  `--fit` is the out-of-sample check (spec §4.1): rows from the `.avg` decks only, scored on the
 *  `.real` decks -- the share within ±2 of the theme row, against the same share for the population
 *  row and for the old flat floors (14/10/10/3). */
import { readFileSync, readdirSync } from "node:fs";
import { connect, loadConfig, mongoLookup, parseDecklistSections, resolveNames } from "@edh-seer/data";
import { createTagsLookup } from "@edh-seer/tagger";
import { buildDeckCards } from "../packages/matcher/src/index.js";
import { computeBuild } from "../packages/matcher/src/build.js";

const argv = process.argv;
const DIR = argv.includes("--dir") ? argv[argv.indexOf("--dir") + 1]! : "packages/cli/decks/edhrec";
const FIT = argv.includes("--fit");
const PARENTS = { Consistency: "consistency", Ramp: "ramp", Interaction: "interaction", "Board wipes": "boardWipes" } as const;
type Key = (typeof PARENTS)[keyof typeof PARENTS];
const KEYS = Object.values(PARENTS) as Key[];
const FLAT: Record<Key, number> = { consistency: 14, ramp: 10, interaction: 10, boardWipes: 3 };

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db);
/** theme -> one count vector per deck, with the file so `--fit` can split avg from real. */
const counts = new Map<string, { file: string; c: Record<Key, number> }[]>();
for (const theme of readdirSync(DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
  for (const f of readdirSync(`${DIR}/${theme}`).filter((f) => f.endsWith(".txt")).sort()) {
    const { commanders, deck } = parseDecklistSections(readFileSync(`${DIR}/${theme}/${f}`, "utf8"));
    const { cards } = await resolveNames([...commanders, ...deck], lookup);
    const dcs = await buildDeckCards(cards, lookup, tags);
    const c = {} as Record<Key, number>;
    for (const p of computeBuild(dcs, undefined).buildParents) c[PARENTS[p.name as keyof typeof PARENTS]] = p.count;
    (counts.get(theme) ?? counts.set(theme, []).get(theme)!).push({ file: f, c });
  }
}
await store.close?.();

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!)) / 2;
};
const rowOf = (decks: { c: Record<Key, number> }[]): Record<Key, number> =>
  Object.fromEntries(KEYS.map((k) => [k, median(decks.map((d) => d.c[k]))])) as Record<Key, number>;
const all = [...counts.values()].flat();
const population = rowOf(all);

if (FIT) {
  // Within ±2 on the real decks, per parent, for three targets: the theme's avg-only row, the
  // population row, and the flat floor. The theme row is what a detected primary would apply.
  const within = { theme: {} as Record<Key, number>, population: {} as Record<Key, number>, flat: {} as Record<Key, number> };
  let n = 0;
  for (const [theme, decks] of counts) {
    if (theme === "goodstuff") continue;
    const avg = decks.filter((d) => d.file.endsWith(".avg.txt"));
    const real = decks.filter((d) => d.file.endsWith(".real.txt"));
    if (avg.length === 0 || real.length === 0) continue;
    const row = rowOf(avg);
    for (const d of real) {
      n++;
      for (const k of KEYS) {
        within.theme[k] = (within.theme[k] ?? 0) + (Math.abs(d.c[k] - row[k]) <= 2 ? 1 : 0);
        within.population[k] = (within.population[k] ?? 0) + (Math.abs(d.c[k] - population[k]) <= 2 ? 1 : 0);
        within.flat[k] = (within.flat[k] ?? 0) + (Math.abs(d.c[k] - FLAT[k]) <= 2 ? 1 : 0);
      }
    }
  }
  console.log(`real decks scored: ${n}; share within ±2 of the target`);
  console.log("parent        | theme row (avg-only) | population | flat floor");
  for (const k of KEYS) console.log(`${k.padEnd(13)} | ${(within.theme[k]! / n * 100).toFixed(1).padStart(20)}% | ${(within.population[k]! / n * 100).toFixed(1).padStart(9)}% | ${(within.flat[k]! / n * 100).toFixed(1).padStart(9)}%`);
  process.exit(0);
}

const themes: Record<string, Record<string, number>> = {};
const range = Object.fromEntries(KEYS.map((k) => [k, [Infinity, -Infinity]])) as Record<Key, [number, number]>;
for (const [theme, decks] of counts) {
  if (theme === "goodstuff" || decks.length < 5) continue;
  const row = rowOf(decks);
  const out: Record<string, number> = { consistency: row.consistency, ramp: row.ramp, interaction: row.interaction };
  if (Math.abs(row.boardWipes - population.boardWipes) > 1) out.boardWipes = row.boardWipes;
  out.n = decks.length;
  themes[theme] = out;
  for (const k of KEYS) { range[k][0] = Math.min(range[k][0], row[k]); range[k][1] = Math.max(range[k][1], row[k]); }
}
console.log(JSON.stringify({
  version: 1,
  source: `${DIR}, ${all.length} decks over ${counts.size} themes, regenerated ${new Date().toISOString().slice(0, 10)} by research/template-fit.ts`,
  population, range, themes,
}, null, 1));
