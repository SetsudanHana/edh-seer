import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections,
} from "@mtg/data";
import type { CardTags } from "@mtg/tagger";
import { detectAnswerClasses, detectBuildCategories, BUILD_CATEGORIES } from "../build.js";
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

async function main(): Promise<void> {
  if (process.argv[2] === "--diff") {
    diff(process.argv[3], process.argv[4]);
    return;
  }

  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = store.db.collection("cardTags");
  const out: Snapshot = {};

  for (const file of readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort()) {
    const sections = parseDecklistSections(readFileSync(join(DECK_DIR, file), "utf8"));
    const inputs: DeckCard[] = [];
    for (const name of [...sections.commanders, ...sections.deck]) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      const tags = (await cardTags.findOne({ oracleId: doc._id })) as CardTags | null;
      inputs.push({ card: docToCard(doc), tags });
    }
    const members = detectBuildCategories(inputs);
    const deck: Record<string, string[]> = {};
    // Answer classes ride in the same snapshot under an `answer:` prefix, so the coverage axis is
    // under the same gate as the categories. They are a different axis, not finer categories: a
    // card is in both.
    for (const [cls, names] of detectAnswerClasses(inputs)) deck[`answer:${cls}`] = [...names].sort();
    // Every known category, including empty ones: a category that stops matching anything is the
    // failure this gate exists to catch, and an absent key would read as "not measured".
    for (const cat of BUILD_CATEGORIES) deck[cat] = [...(members.get(cat) ?? [])].sort();
    for (const [cat, set] of members) if (!(cat in deck)) deck[cat] = [...set].sort();
    out[file.replace(/\.txt$/, "")] = deck;
  }

  console.log(JSON.stringify(out, null, 1));
  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("build-population failed:", err);
    process.exit(1);
  });
}
