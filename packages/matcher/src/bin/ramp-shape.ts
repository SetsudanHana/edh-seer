import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections,
} from "@edh-seer/data";
import { createTagsLookup } from "@edh-seer/tagger";
import { detectBuildRules } from "../build.js";
import type { DeckCard } from "../types.js";

/** TWO OWNER CLAIMS ABOUT RAMP, TESTED AGAINST THE 71 DECKS BEFORE ANY TARGET MOVES (2026-08-23).
 *
 *  (1) "My Samut deck needs a lot of ramp because the commander is 6 mana. A 1-2 mana commander
 *      needs none to cast it early." -- a claim that the RAMP target should read commander mana
 *      value. `commanderMV` reaches nothing in this engine today; the Ramp parent is a flat 10 for
 *      every deck. If the claim holds, these decks should already show it.
 *
 *  (2) "In green your best ramp is land ramp, not rocks, because lands are the most resilient mana
 *      source -- mass land denial is bracket 4-5 only." -- a claim about the SHAPE of the package,
 *      which the category count cannot express: a Signet and a Cultivate are both `ramp`. The rule
 *      table already separates them, so this needs no new detector, only `detectBuildRules`.
 *
 *  WHAT THIS CANNOT SETTLE. These are one owner's decks, so a correlation here is evidence about
 *  how THEY build, not about the format -- the self-comparison trap `BASE_TARGETS` carries. It can
 *  refute a claim (no correlation means the corpus does not support it) more strongly than confirm
 *  one.
 *
 *  Free: Mongo reads only.
 *
 *    npx tsx packages/matcher/src/bin/ramp-shape.ts */
const DECK_DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");

/** THE FRAGILITY ORDER IS MEASURED, NOT ASSERTED -- `answer-pool.json`, the same generated artifact
 *  the Interaction coverage axis scores against, counts how many cards in the format answer each
 *  permanent class: creature 1,839 · artifact 755 · land 306 (in green alone: 209 artifact against
 *  71 land). So a mana dork sits in the most-answered class in Magic, a rock in one answered 2.5x
 *  as often as a land, and a fetched Forest in the least-answered of the three. That is the owner's
 *  ruling ("lands are the most resilient sources of mana, mass land denial is bracket 4-5")
 *  reproduced from the engine's own numbers.
 *
 *  A board wipe widens the same gap again and is NOT in those counts: it takes every dork at once
 *  and no rock and no land. */
const LAND_SHAPED = new Set(["ramp.land.fetchesTwo", "ramp.land.bigMana", "ramp.landFetchSpell"]);
const ROCK_SHAPED = new Set(["ramp.effect", "ramp.manaToken"]);

interface Row {
  deck: string; commanderMV: number; ramp: number; resilient: number; fragile: number;
  green: boolean; colors: number; avgManaValue: number; dork: number;
}

/** Pearson r, with the n it was computed over -- a correlation quoted without its n is not a
 *  measurement. */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const dx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
  return dx === 0 || dy === 0 ? 0 : num / (dx * dy);
}

const median = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

function report(rows: Row[]): void {
  console.log("=== CLAIM 1: does commander mana value predict ramp count? ===\n");
  const buckets: [string, (r: Row) => boolean][] = [
    ["cmdr MV <= 3", (r) => r.commanderMV <= 3],
    ["cmdr MV 4",    (r) => r.commanderMV === 4],
    ["cmdr MV 5",    (r) => r.commanderMV === 5],
    ["cmdr MV >= 6", (r) => r.commanderMV >= 6],
  ];
  console.log(`  ${"bucket".padEnd(14)} ${"decks".padStart(5)} ${"median ramp".padStart(12)} ${"mean ramp".padStart(10)} ${"median avgMV".padStart(13)}`);
  for (const [label, f] of buckets) {
    const b = rows.filter(f);
    if (!b.length) continue;
    const ramps = b.map((r) => r.ramp);
    console.log(
      `  ${label.padEnd(14)} ${String(b.length).padStart(5)} ${String(median(ramps)).padStart(12)} ` +
      `${(ramps.reduce((a, c) => a + c, 0) / b.length).toFixed(1).padStart(10)} ${median(b.map((r) => r.avgManaValue)).toFixed(2).padStart(13)}`,
    );
  }
  console.log(
    `\n  r(commanderMV, ramp) = ${pearson(rows.map((r) => r.commanderMV), rows.map((r) => r.ramp)).toFixed(3)}  (n=${rows.length})`,
  );
  // The confound that has to be ruled out: an expensive commander usually sits in an expensive
  // deck, and a deck's own curve is the thing every published formula already scales ramp by. If
  // avgMV correlates and commanderMV does not, the claim is about the curve, not the commander.
  console.log(
    `  r(deck avgMV,   ramp) = ${pearson(rows.map((r) => r.avgManaValue), rows.map((r) => r.ramp)).toFixed(3)}  (the confound: an expensive commander sits in an expensive deck)`,
  );

  console.log("\n=== CLAIM 2: is green's ramp land-shaped? ===\n");
  for (const [label, subset] of [["green", rows.filter((r) => r.green)], ["non-green", rows.filter((r) => !r.green)]] as const) {
    const res = subset.reduce((a, r) => a + r.resilient, 0);
    const fra = subset.reduce((a, r) => a + r.fragile, 0);
    const dk = subset.reduce((a, r) => a + r.dork, 0);
    console.log(
      `  ${label.padEnd(10)} ${String(subset.length).padStart(2)} decks · land ${String(res).padStart(3)} · rock ${String(fra - dk).padStart(3)} · dork ${String(dk).padStart(3)} · ` +
      `land share ${(100 * res / (res + fra)).toFixed(1)}%  (median per deck: ${median(subset.map((r) => r.resilient))} land / ${median(subset.map((r) => r.fragile))} rock+dork)`,
    );
  }
  const allRock = rows.filter((r) => r.resilient === 0 && r.fragile > 0);
  console.log(`\n  decks whose ramp is 100% rock-shaped: ${allRock.length} of ${rows.length}${allRock.length ? ` -- ${allRock.slice(0, 8).map((r) => r.deck).join(", ")}` : ""}`);

  console.log("\n=== per deck ===\n");
  console.log(`  ${"deck".padEnd(30)} ${"cmdrMV".padStart(6)} ${"ramp".padStart(5)} ${"land".padStart(5)} ${"rock".padStart(5)} ${"land%".padStart(6)}  colors`);
  for (const r of [...rows].sort((a, b) => b.commanderMV - a.commanderMV || b.ramp - a.ramp)) {
    const tot = r.resilient + r.fragile;
    console.log(
      `  ${r.deck.padEnd(30)} ${String(r.commanderMV).padStart(6)} ${String(r.ramp).padStart(5)} ` +
      `${String(r.resilient).padStart(5)} ${String(r.fragile).padStart(5)} ` +
      `${(tot ? `${Math.round(100 * r.resilient / tot)}%` : "-").padStart(6)}  ${r.colors}${r.green ? " G" : ""}`,
    );
  }
}

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = createTagsLookup(store.db);
  const rows: Row[] = [];

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
    const byRule = detectBuildRules(library);
    // A card matching two ramp rules is counted once per SHAPE, not once per rule, so a land that
    // is both big-mana and fetches two cannot inflate the land side.
    const named = (ids: Set<string>): Set<string> =>
      new Set([...ids].flatMap((id) => [...(byRule.get(id) ?? [])]));
    const landShaped = named(LAND_SHAPED);
    // A dork is a rock that also dies to every board wipe. Split off the rock side by TYPE LINE, so
    // the tier follows what the card is rather than which rule happened to catch it.
    const rockShaped = named(ROCK_SHAPED);
    const isCreature = new Map(library.map((dc) => [dc.card.name, /\bcreature\b/i.test(dc.card.typeLine)]));
    const dorks = new Set([...rockShaped].filter((n) => isCreature.get(n)));
    const identity = new Set(cmdrCards.flatMap((dc) => dc.card.colorIdentity ?? []));
    const nonland = library.filter((dc) => !dc.card.typeLine.toLowerCase().includes("land"));

    rows.push({
      deck: file.replace(/\.txt$/, ""),
      // A partner pair is TWO cards to cast, so the cost of deploying the command zone is the sum.
      commanderMV: cmdrCards.reduce((s, dc) => s + dc.card.manaValue, 0),
      ramp: new Set([...landShaped, ...rockShaped]).size,
      resilient: landShaped.size,
      fragile: rockShaped.size,
      dork: dorks.size,
      green: identity.has("G"),
      colors: identity.size,
      avgManaValue: nonland.reduce((s, dc) => s + dc.card.manaValue, 0) / Math.max(1, nonland.length),
    });
  }

  report(rows);
  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
