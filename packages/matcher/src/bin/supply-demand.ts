/** IS A DECK LOPSIDED ON A SHAPE, AND BY HOW MUCH? Free: Mongo reads only, no model.
 *
 *  The measurement that has to come before the edge-magnitude curve. The claim behind that work is
 *  that synergy has degree and an edge is binary — thirty token makers against one payoff means the
 *  thirtieth maker is marginal — but nobody has ever measured the supply:demand ratios the 71
 *  calibration decks actually run. A curve fitted before that is a guess, and this repo's own
 *  method note says the obvious fix was measurably wrong four times in one session.
 *
 *  Three weightings per shape, each answering a different question:
 *    cards  — how many cards are on each side. If this is already ~1:1, a balance term corrects
 *             nothing and the whole item is inert.
 *    rate   — weighted by `Ability.repeats` x `amount`. The magnitude axis proper, and the first
 *             reader `repeats` has ever had outside its own report.
 *    avail  — rate x P(the card is available by the turn). A commander is available in every game
 *             and weighs its full rate; a single copy in the 99 weighs seen(turn)/library.
 *
 *  Counted over the deck's REASONS — the population the product ships — and not over `buildCensus`,
 *  which was the obvious reuse and reads a different model: it finds ZERO suppliers for
 *  `naya-spellslinger`'s `cast:-creature` demand. Reads the DERIVED tags for the same reason;
 *  `bin/deck-availability.ts` still reads the flat `cardTags` collection, which is the stale-source
 *  shape CLAUDE.md records for `build-population.ts`. Do not copy it.
 *
 *  A reason exists only where an edge formed, so a shape with no supply at all is ABSENT here
 *  rather than zero — that is an availability question and `deckAvailability` answers it.
 *
 *    npx tsx --env-file=packages/tagger/.env packages/matcher/src/bin/supply-demand.ts [--verbose] [deck.txt]
 */
import { readFileSync, readdirSync, writeFileSync, readFileSync as readJson } from "node:fs";
import { isAbsolute, join } from "node:path";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames } from "@mtg/data";
import { ComboIndex } from "@mtg/engine";
import { createTagsLookup } from "@mtg/tagger";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags, type CardTagsLookup } from "../index.js";
import { countInversions, diffInversions, type InversionReport } from "../rank-inversions.js";
import { buildSupplyDemand, ratio, type SupplyDemandRow } from "../supply-demand.js";

const DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const INVERSIONS = args.includes("--inversions");
const SAVE = flag("--save");
const AGAINST = flag("--against");
const glutFlag = flag("--glut");
const GLUT = glutFlag === undefined ? 3 : Number(glutFlag);
// `r <= NaN` is always false, so an unparseable --glut silently reads EVERY row as glutted rather
// than failing loudly.
if (!Number.isFinite(GLUT) || GLUT <= 0) {
  throw new Error(`--glut must be a finite positive number, got ${JSON.stringify(glutFlag)}`);
}
const flagValues = new Set([SAVE, AGAINST, glutFlag].filter(Boolean) as string[]);
const only = args.find((a) => !a.startsWith("--") && !flagValues.has(a));
const TURN = 5;

/** Ratio buckets, symmetric about parity. The question they answer is whether the mass sits near
 *  1:1 (nothing to correct) or out in the tails (a curve has real work to do). */
const BUCKETS: [string, (r: number) => boolean][] = [
  ["demand-starved  >3x demand", (r) => r < 1 / 3],
  ["                1.5-3x demand", (r) => r < 1 / 1.5],
  ["BALANCED        within 1.5x", (r) => r <= 1.5],
  ["                1.5-3x supply", (r) => r <= 3],
  ["                3-10x supply", (r) => r <= 10],
  ["supply-glutted  >10x supply", () => true],
];

const bucketOf = (r: number): string => BUCKETS.find(([, test]) => test(r))![0];

type Weighting = "cards" | "rate" | "avail";
const WEIGHTINGS: Weighting[] = ["cards", "rate", "avail"];

interface Row extends SupplyDemandRow { deck: string }

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags: CardTagsLookup = createTagsLookup(store.db, "derived-first");
const tokenTags = await loadTokenTags(store.db);

const files = only
  ? [isAbsolute(only) ? only : join(process.cwd(), only)]
  : readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort().map((f) => join(DIR, f));

const all: Row[] = [];
const inversionTotals: InversionReport = { shapes: 0, inversions: 0, payoffs: [], unmeasurablePayoffs: 0, unmeasurableFeederPairs: 0 };
let totalReasons = 0;
for (const path of files) {
  const deck = path.split("/").pop()!.replace(/\.txt$/, "");
  const sections = parseDecklistSections(readFileSync(path, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmdNorm = new Set(sections.commanders.map(normalizeName));
  const commanderNames = cards.filter((c) => cmdNorm.has(normalizeName(c.name))).map((c) => c.name);
  const deckCards = await buildDeckCards(cards, lookup, tags);

  const report = analyzeDeckStructured(
    deckCards, commanderNames, undefined, undefined, new ComboIndex(combos), undefined, tokenTags,
  );
  const reasons = report.edges.flatMap((e) => e.reasons);
  totalReasons += reasons.length;

  const rows = buildSupplyDemand(
    reasons,
    deckCards.map((dc) => ({
      name: dc.card.name,
      tags: dc.tags ?? null,
      isCommander: cmdNorm.has(normalizeName(dc.card.name)),
    })),
    { turn: TURN },
  );
  if (INVERSIONS || SAVE || AGAINST) {
    // Absent means UNMEASURABLE, never zero: a card with no rating must be skipped and counted,
    // not scored 0 against real feeders (the `?? 0` defect the fix wave removed for tokens).
    //
    // A two-faced card rates TWICE, once per printed face (Task 7, faces-as-nodes) — but `rows`
    // (built from `reasons`, which name the PHYSICAL card) and `deckCards` are both keyed on the
    // physical card. Joining these maps on `c.name` alone missed every back face, AND every front
    // face whose face name differs from the physical name, so a multi-face card's rows fell
    // straight into `unmeasurablePayoffs`. Keyed on `cardName ?? name` and merged like
    // `cut-list.ts`'s `mergeFaces` — the STRONGER face's number stands for the physical card, since
    // a reason names the card and not the face it happened to derive from. Review fix, 2026-08-27.
    const maxByPhysical = (get: (c: (typeof report.cards)[number]) => number | undefined) => {
      const m = new Map<string, number>();
      for (const c of report.cards) {
        const v = get(c);
        if (v === undefined) continue;
        const key = c.cardName ?? c.name;
        const cur = m.get(key);
        if (cur === undefined || v > cur) m.set(key, v);
      }
      return m;
    };
    const ratings = {
      payoff: maxByPhysical((c) => c.payoffRating),
      feeder: maxByPhysical((c) => c.feederRating),
      headline: maxByPhysical((c) => c.synergyRating),
      // The protected set is defined on SCORES, not on the rounded ratings, so a card sitting near
      // the boundary is not misclassified by a 0.05 rounding step.
      //
      // Deliberately NOT `authority >= roleBlend * feederLift`, the formula in analyze.ts:417 — that
      // would be a second copy of the formula reading a second `loadImpactWeights()` call, and both
      // `?? 0` defaults fire together on any `CardSynergy` lacking the fields (`0 >= 0` -> true),
      // defaulting an unmeasured card INTO the protected set. `score = authority + roleBlend *
      // feederLift` makes protected <=> `authority >= score - authority` <=> `2 * authority >=
      // score`, using only shipped fields with no re-read of `roleBlend` and no default-in trap:
      // absent `authority` now means NOT classified, never protected. Either face protecting the
      // physical card is enough — the same "strongest face wins" rule the numeric maps use above.
      majorityPayoff: new Set(
        report.cards.filter((c) => c.authority !== undefined && 2 * c.authority >= c.score).map((c) => c.cardName ?? c.name),
      ),
    };
    const rep = countInversions(rows, ratings, { glut: GLUT });
    inversionTotals.shapes += rep.shapes;
    inversionTotals.inversions += rep.inversions;
    inversionTotals.unmeasurablePayoffs += rep.unmeasurablePayoffs;
    inversionTotals.unmeasurableFeederPairs += rep.unmeasurableFeederPairs;
    inversionTotals.payoffs.push(...rep.payoffs.map((p) => ({ ...p, tag: `${deck}/${p.tag}` })));
  }
  for (const r of rows) all.push({ ...r, deck });
  if (!only) process.stdout.write(".");
}
await store.close();
if (!only) process.stdout.write("\n");

const fmt = (n: number): string => (n >= 100 ? n.toFixed(0) : n.toFixed(1));
const rat = (r: Row, w: Weighting): number => ratio(r, w) ?? 0;

console.log(`\n${all.length} supplied shapes across ${files.length} deck(s), turn ${TURN}`);
console.log(`over ${totalReasons} reasons; a shape with no supply forms no reason and is absent here, not zero\n`);

for (const w of WEIGHTINGS) {
  const counts = new Map<string, number>();
  for (const r of all) counts.set(bucketOf(rat(r, w)), (counts.get(bucketOf(rat(r, w))) ?? 0) + 1);
  const median = [...all].map((r) => rat(r, w)).sort((a, b) => a - b)[Math.floor(all.length / 2)] ?? 0;
  console.log(`— ${w.toUpperCase()} — median supply:demand ${fmt(median)}:1`);
  for (const [name] of BUCKETS) {
    const n = counts.get(name) ?? 0;
    console.log(`   ${name.padEnd(30)} ${String(n).padStart(5)}  ${((n / all.length) * 100).toFixed(1).padStart(5)}%`);
  }
  console.log();
}

/** Where the rate actually comes from. If nearly every side reads `implied`, the magnitude axis is
 *  inert and the balance term has only card counts to work with — which is the first thing a curve
 *  would be fitted through, so it is printed before any tail. */
for (const which of ["supply", "demand"] as const) {
  const labels = new Map<string, number>();
  for (const r of all) for (const [k, n] of Object.entries(r[which].labels)) labels.set(k, (labels.get(k) ?? 0) + n);
  const total = [...labels.values()].reduce((a, b) => a + b, 0);
  const line = [...labels].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n} (${((n / total) * 100).toFixed(1)}%)`).join(" \u00b7 ");
  console.log(`${which.toUpperCase()} card-sides by rate source: ${line}`);
}
console.log();

const refusedSides = all.reduce((n, r) => n + (r.supply.refused > 0 ? 1 : 0) + (r.demand.refused > 0 ? 1 : 0), 0);
const commanderSides = all.reduce((n, r) => n + (r.supply.commander ? 1 : 0) + (r.demand.commander ? 1 : 0), 0);
console.log(`sides carrying at least one unlabelled \`repeats\`: ${refusedSides} of ${all.length * 2}`);
console.log(`sides including a commander: ${commanderSides} of ${all.length * 2}\n`);

const show = (title: string, rows: Row[]): void => {
  console.log(title);
  console.log("  ratio(rate)  cards S:D    rate S:D      avail S:D    deck / shape");
  for (const r of rows) {
    console.log(
      `  ${fmt(rat(r, "rate")).padStart(9)}:1  ` +
      `${`${r.supply.cards}:${r.demand.cards}`.padEnd(10)}  ` +
      `${`${fmt(r.supply.rate)}:${fmt(r.demand.rate)}`.padEnd(12)}  ` +
      `${`${fmt(r.supply.avail)}:${fmt(r.demand.avail)}`.padEnd(11)}  ` +
      `${r.deck} / ${r.key}${r.supply.commander || r.demand.commander ? " (command zone)" : ""}`,
    );
  }
  console.log();
};

/** Rows by verb family. The exclusion question lives here: a `static:` or `tutor:` row is one
 *  anthem or one tutor against everything it reaches, which is deck composition and not imbalance,
 *  and a curve applied to it would crush every anthem in the corpus. */
{
  const fams = new Map<string, Row[]>();
  for (const r of all) {
    const fam = r.key.split(":")[0];
    fams.set(fam, [...(fams.get(fam) ?? []), r]);
  }
  const median = (rows: Row[], w: Weighting): number =>
    [...rows].map((x) => rat(x, w)).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0;
  console.log("BY VERB FAMILY");
  console.log("   rows   median cards  median rate  median avail  >3x supply  >3x demand  family");
  for (const [fam, rows] of [...fams].sort((a, b) => b[1].length - a[1].length)) {
    const glut = rows.filter((r) => rat(r, "avail") > 3).length;
    const starved = rows.filter((r) => rat(r, "avail") < 1 / 3).length;
    console.log(
      `  ${String(rows.length).padStart(5)}  ${fmt(median(rows, "cards")).padStart(12)}  ` +
      `${fmt(median(rows, "rate")).padStart(11)}  ${fmt(median(rows, "avail")).padStart(12)}  ` +
      `${String(glut).padStart(10)}  ${String(starved).padStart(10)}  ${fam}`,
    );
  }
  console.log();
}

const byRate = [...all].sort((a, b) => rat(b, "rate") - rat(a, "rate"));
show("MOST SUPPLY-GLUTTED (many events, few payoffs)", byRate.slice(0, 15));
show("MOST DEMAND-STARVED (many payoffs, thin supply)", byRate.slice(-15).reverse());

/** The rows where weighting CHANGES the verdict are the ones that decide whether `repeats` is
 *  worth reading at all: if cards and rate always agree, the magnitude axis buys nothing. */
const flipped = all.filter((r) => bucketOf(rat(r, "cards")) !== bucketOf(rat(r, "rate")));
console.log(`rows whose bucket MOVES between cards and rate: ${flipped.length} of ${all.length} (${((flipped.length / all.length) * 100).toFixed(1)}%)`);
const flippedAvail = all.filter((r) => bucketOf(rat(r, "rate")) !== bucketOf(rat(r, "avail")));
console.log(`rows whose bucket MOVES between rate and avail: ${flippedAvail.length} of ${all.length} (${((flippedAvail.length / all.length) * 100).toFixed(1)}%)\n`);
if (flipped.length > 0) show("WEIGHTING CHANGED THE VERDICT (cards vs rate)", flipped.slice(0, 15));

if (VERBOSE) {
  const decks = [...new Set(all.map((r) => r.deck))].sort();
  for (const deck of decks) {
    const rows = all.filter((r) => r.deck === deck).sort((a, b) => rat(b, "rate") - rat(a, "rate"));
    show(`${deck} — ${rows.length} shapes`, rows);
  }
}

if (SAVE) {
  writeFileSync(SAVE, JSON.stringify(inversionTotals));
  console.log(`saved ${inversionTotals.payoffs.length} payoff rows (${inversionTotals.inversions} inversions over ${inversionTotals.shapes} glutted shapes, glut ${GLUT}) to ${SAVE}`);
}
if (AGAINST) {
  const before = JSON.parse(readJson(AGAINST, "utf8")) as InversionReport;
  const d = diffInversions(before, inversionTotals);
  console.log(`PART 1 -- INVERSIONS ${d.inversionsBefore} -> ${d.inversionsAfter} over ${d.shapesBefore} -> ${d.shapesAfter} glutted shapes (glut ${GLUT})${d.inversionsAfter < d.inversionsBefore ? "  <- clears" : "  <- FAILS"}`);
  // One row per (deck, shape, payoff); a card in three glutted shapes in one deck counts three
  // times. Print the distinct-card count alongside so the row total is never read as a card total.
  const distinct = (rows: { tag: string; name: string }[]) => new Set(rows.map((p) => `${p.tag.split("/")[0]}::${p.name}`)).size;
  const prot = d.headlineFallenProtected;
  console.log(`PART 2 -- PROTECTED (majority-payoff) HEADLINE FALLS: ${prot.length} row(s) over ${distinct(prot)} distinct card(s)${prot.length === 0 ? "  <- clears" : "  <- FAILS"}`);
  for (const p of prot.slice(0, 20)) console.log(`  ${p.from} -> ${p.to}  ${p.tag.replace("/", " / ")} / ${p.name}`);
  if (prot.length > 20) console.log(`  ... ${prot.length - 20} more`);
  const other = d.headlineFallenOther;
  console.log(`reported, NOT a gate -- majority-feeder headline falls: ${other.length} row(s) over ${distinct(other)} distinct card(s)`);
  console.log(`unmeasurable: ${d.unmeasurablePayoffsBefore} -> ${d.unmeasurablePayoffsAfter} payoff rows, ${d.unmeasurableFeederPairsBefore} -> ${d.unmeasurableFeederPairsAfter} feeder pairs (token nodes carry no synergyRating)`);
} else if (INVERSIONS) {
  console.log(`INVERSIONS ${inversionTotals.inversions} over ${inversionTotals.shapes} glutted shapes (glut ${GLUT})`);
  console.log(`unmeasurable: ${inversionTotals.unmeasurablePayoffs} payoff rows, ${inversionTotals.unmeasurableFeederPairs} feeder pairs (token nodes carry no synergyRating)`);
  const worst = [...inversionTotals.payoffs].sort((a, b) => b.feedersAbove - a.feedersAbove).slice(0, 15);
  console.log("  feedersAbove  rating  deck / shape / payoff");
  for (const p of worst) console.log(`  ${String(p.feedersAbove).padStart(12)}  ${String(p.rating).padStart(6)}  ${p.tag.replace("/", " / ")} / ${p.name}`);
}
