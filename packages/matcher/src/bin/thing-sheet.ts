/** A JUDGING SHEET FOR "DOES THIS CARD DO THE DECK'S THING" — a NEW CLAIM TYPE. Free: Mongo reads
 *  only, no model. Roadmap K3.
 *
 *  **THE PANEL CANNOT GRADE THIS AND THAT IS WHY THIS EXISTS.** `verdictKey` (`bin/panel-core.ts`)
 *  is `producer|consumer|tag|implied` — PAIRWISE — and "card X counts toward deck D's thing" is a
 *  `(deck, card, theme)` claim its cache cannot look up. The research package originally claimed the
 *  panel already judged such claims; it was wrong, Fable caught it, and this is the replacement.
 *
 *  TWO STRATA, AND THE SECOND ONE IS NOT IN THE REGISTERED CRITERION ON PURPOSE.
 *  - **IN**: cards `report.thing` counts. Judging these gives PRECISION, which is what K3 registers
 *    (>= 75% on a blind owner-judged draw of ~10 decks).
 *  - **OUT**: cards it does NOT count. Nothing in the criterion asks for these, and a list that
 *    silently OMITS the deck's obvious payoffs is wrong in a direction precision can never see —
 *    the same reason the recall frame exists beside the panel. Scored separately; it never moves the
 *    precision figure.
 *
 *  **THE SHEET IS BLIND IN THE ONE WAY THAT MATTERS**: it shows the deck, the theme phrase, the card
 *  and the card's printed text, and NEVER the tag, the stratum or why the engine decided. Seeing
 *  what the engine believes anchors the verdict to it — `Calibrate.tsx` settled that, and the
 *  cost-reduction sheet re-learned it.
 *
 *  **DO NOT PUT THE OUTPUT IN `docs/measurements/panel/`.** `panel-build.ts` folds in every file
 *  matching `verdicts-*.jsonl` BY PREFIX; these are a different claim type with a different key and
 *  would corrupt the pairwise cache. They live in `docs/measurements/thing/` as `thing-*.jsonl`.
 *
 *    npx tsx --env-file=packages/tagger/.env packages/matcher/src/bin/thing-sheet.ts --out /tmp/thing-draw
 *    npx tsx --env-file=packages/tagger/.env packages/matcher/src/bin/thing-sheet.ts --score /tmp/thing-draw.jsonl
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames } from "@mtg/data";
import { ComboIndex } from "@mtg/engine";
import { createTagsLookup } from "@mtg/tagger";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "../index.js";
import { renderThingSheet } from "./thing-sheet-html.js";

const arg = (f: string): string | undefined => {
  const i = process.argv.indexOf(f);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const DECKS = "packages/cli/decks/calibration";
const OUT = arg("--out") ?? "/tmp/thing-draw";
const SCORE = arg("--score");
const SEED = Number(arg("--seed") ?? 20260822);
const N_DECKS = Number(arg("--decks") ?? 10);
const N_IN = Number(arg("--in") ?? 4);
const N_OUT = Number(arg("--out-rows") ?? 2);

interface ThingClaim {
  deck: string; card: string; theme: string; tag: string;
  /** "in" = the engine counts it, "out" = it does not. NOT shown on the sheet. */
  stratum: "in" | "out";
  typeLine: string; manaCost: string; oracleText: string;
  verdict: "" | "real" | "false" | "uncertain";
  note?: string;
}

/** Seeded so a draw is recheckable and a re-run is the same draw. `Math.random` would make the
 *  sample unreproducible, which is the defect that made the first BETA sweep's family table
 *  unrecheckable. */
function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const take = <T>(xs: readonly T[], n: number, rand: () => number): T[] => {
  const pool = xs.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, n);
};

/** Wilson score interval — the same one `panel-score.ts` reports, so the two figures are comparable
 *  as intervals rather than as bare percentages. */
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

if (SCORE) {
  let rows: ThingClaim[] = readFileSync(SCORE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  // THE PAGE EMITS ONLY WHAT IT SHOWED — deck, card, verdict, note — because a page that carried
  // `stratum` in its payload could leak it to a reader who opens devtools, and the stratum is the
  // one thing the sheet is blind about. Rejoin it from the draw by (deck, card).
  const DRAW = arg("--draw") ?? SCORE.replace(/\.judged\.jsonl$|\.jsonl$/, ".jsonl");
  if (rows.some((r) => r.stratum === undefined)) {
    const draw: ThingClaim[] = readFileSync(DRAW, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const by = new Map(draw.map((d) => [`${d.deck}|${d.card}`, d]));
    const missing = rows.filter((r) => !by.has(`${r.deck}|${r.card}`));
    if (missing.length > 0) {
      console.error(`REFUSED: ${missing.length} judged rows are not in the draw at ${DRAW} — scoring them would invent a stratum.`);
      process.exit(1);
    }
    rows = rows.map((r) => ({ ...by.get(`${r.deck}|${r.card}`)!, verdict: r.verdict, note: r.note }));
  }
  const judged = rows.filter((r) => r.verdict);
  const inRows = judged.filter((r) => r.stratum === "in");
  const outRows = judged.filter((r) => r.stratum === "out");
  const real = inRows.filter((r) => r.verdict === "real").length;
  const decided = inRows.filter((r) => r.verdict !== "uncertain").length;
  const [lo, hi] = wilson(real, decided);
  console.log(`rows ${rows.length} | judged ${judged.length} | UNJUDGED ${rows.length - judged.length}`);
  console.log(`\nIN stratum (the registered figure): real ${real} / decided ${decided}`);
  console.log(`  PRECISION ${(real / (decided || 1) * 100).toFixed(1)}% [${(lo * 100).toFixed(1)}, ${(hi * 100).toFixed(1)}]`);
  console.log(`  REGISTERED: >= 75%. ${real / (decided || 1) >= 0.75 ? "PASS" : "FAIL — membership is a RUBRIC property; K2 demotes to a neutral tag count with no 'does the thing' phrasing"}`);
  const missed = outRows.filter((r) => r.verdict === "real").length;
  const outDecided = outRows.filter((r) => r.verdict !== "uncertain").length;
  console.log(`\nOUT stratum (not registered, and precision cannot see it): ${missed} of ${outDecided} excluded cards the owner says DO the thing`);
  if (outDecided > 0) console.log(`  omission rate ${(missed / outDecided * 100).toFixed(1)}% — a list that misses the deck's obvious payoffs is wrong in a way the IN figure never reports`);
  process.exit(0);
}

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db, "derived");
const tokenTags = await loadTokenTags(store.db);
const rand = rng(SEED);
const files = readdirSync(DECKS).filter((f) => f.endsWith(".txt")).sort();

const claims: ThingClaim[] = [];
let abstained = 0;
for (const file of take(files, files.length, rand)) {
  if (claims.length >= N_DECKS * (N_IN + N_OUT)) break;
  const sections = parseDecklistSections(readFileSync(`${DECKS}/${file}`, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmdNorm = new Set(sections.commanders.map(normalizeName));
  const commanderNames = cards.filter((c) => cmdNorm.has(normalizeName(c.name))).map((c) => c.name);
  const deckCards = await buildDeckCards(cards, lookup, tags);
  const report = analyzeDeckStructured(deckCards, commanderNames, undefined, undefined, new ComboIndex(combos), undefined, tokenTags);
  const thing = report.thing;
  if (!thing) { abstained++; continue; }

  const inSet = new Set(thing.cards);
  const isLand = (dc: typeof deckCards[number]) => dc.card.typeLine.toLowerCase().includes("land");
  const outPool = deckCards.filter((dc) => !isLand(dc) && !inSet.has(dc.card.name) && !cmdNorm.has(normalizeName(dc.card.name)));
  const byName = new Map(deckCards.map((dc) => [dc.card.name, dc.card]));
  const row = (name: string, stratum: "in" | "out"): ThingClaim | null => {
    const c = byName.get(name);
    if (!c) return null;
    return {
      deck: file.replace(".txt", ""), card: name, theme: thing.theme, tag: thing.tag, stratum,
      typeLine: c.typeLine, manaCost: c.manaCost ?? "", oracleText: c.oracleText ?? "", verdict: "",
    };
  };
  for (const n of take(thing.cards, N_IN, rand)) { const r = row(n, "in"); if (r) claims.push(r); }
  for (const dc of take(outPool, N_OUT, rand)) { const r = row(dc.card.name, "out"); if (r) claims.push(r); }
  process.stderr.write(".");
}
process.stderr.write("\n");

// Shuffled so the sheet does not read IN, IN, IN, IN, OUT, OUT per deck -- the order alone would
// tell the judge the stratum, which is the whole thing the sheet is blind about.
const sheet = take(claims, claims.length, rand);
writeFileSync(`${OUT}.jsonl`, sheet.map((c) => JSON.stringify(c)).join("\n") + "\n");
const md = [
  `# Does this card do the deck's thing? — blind draw, seed ${SEED}`,
  ``,
  `${sheet.length} claims over ${new Set(sheet.map((c) => c.deck)).size} decks. ${abstained} sampled decks abstained and were skipped.`,
  ``,
  `For each row: **does this card do the thing named in the heading?** Answer \`real\`, \`false\` or`,
  `\`uncertain\` in the \`verdict\` field of the matching line in \`${OUT}.jsonl\`.`,
  ``,
  `The rows are shuffled and do NOT say whether the engine counted the card. That is deliberate —`,
  `seeing the engine's answer first anchors the verdict to it.`,
  ``,
].concat(sheet.map((c, i) => [
  `## ${i + 1}. ${c.deck} — "${c.theme}"`,
  ``,
  `**${c.card}** ${c.manaCost}  ·  ${c.typeLine}`,
  ``,
  c.oracleText.split("\n").map((l) => `> ${l}`).join("\n"),
  ``,
].join("\n"))).join("\n");
writeFileSync(`${OUT}.md`, md);
writeFileSync(`${OUT}.html`, renderThingSheet(
  sheet.map((c) => ({ deck: c.deck, card: c.card, theme: c.theme, cost: c.manaCost, typeLine: c.typeLine, oracle: c.oracleText })),
  SEED,
));
console.log(`wrote ${sheet.length} claims (${sheet.filter((c) => c.stratum === "in").length} in / ${sheet.filter((c) => c.stratum === "out").length} out) over ${new Set(sheet.map((c) => c.deck)).size} decks`);
console.log(`  ${OUT}.html  — open this: click a verdict per claim, then "copy JSONL"`);
console.log(`  ${OUT}.md    — the same sheet as plain text`);
console.log(`  ${OUT}.jsonl — fill the verdict field, then: --score ${OUT}.jsonl`);
await store.close();
