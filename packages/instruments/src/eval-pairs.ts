import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connect, loadConfig, mongoLookup, normalizeName, docToCard } from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
import { createTagsLookup } from "@edh-seer/tagger";
import { ComboIndex } from "@edh-seer/engine";
import { resolveNames } from "@edh-seer/data";
import { analyzeDeckStructured, buildDeckCards, loadHierarchy, loadTokenTags, pairReasons } from "@edh-seer/matcher";
import type { DeckCard } from "@edh-seer/matcher/types";
import { classifyAntiPair, classifyPair, deckJoins, modeDisagreements, type AntiPair, type CompassPair, type ModeRow } from "@edh-seer/matcher/eval-pairs-core";
import { buildReport, formatReport, type PairResult } from "./compass-report.js";

const GOLD = JSON.parse(
  readFileSync(new URL("../../matcher/src/compass-pairs.json", import.meta.url), "utf8"),
) as CompassPair[];

/** THE OTHER HALF OF THE COMPASS. `compass-pairs.json` only ever asked "did we find the edge", and
 *  a full score is a score an engine that joined EVERY pair would also get. These are the pairs that must
 *  NEVER join, one representative per CLASS of false edge, each taken from a judged FALSE verdict.
 *  `knownDefects` are rows the engine STILL gets wrong: they are listed rather than hidden, and the
 *  list is capped so it cannot grow quietly -- the same shape as `pair-calibration.test.ts`. */
const ANTI = JSON.parse(
  readFileSync(new URL("../../matcher/src/compass-anti-pairs.json", import.meta.url), "utf8"),
) as { pairs: AntiPair[]; knownDefects: AntiPair[] };

/** One of each basic plus Wastes, six times over: 36 slots. A 2-card deck throws in `manaAuditFull`
 *  (hypergeometric minCopies), so the pair is padded. Lands carry no theme tags a compass pair
 *  depends on, and `deckJoins` only counts an edge whose two ENDS are the pair, so no basic can
 *  supply the join. */
const PAD = Array.from({ length: 6 }, () => ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"]).flat();

/** THE REAL PIPELINE ON A SYNTHETIC DECK (#728): the two cards plus `PAD`, through
 *  `analyzeDeckStructured`. `pairReasons` alone is a pair in isolation; the product never runs it
 *  that way, so a compass that only reads isolation can pass while the deck path loses the edge.
 *  Null when a name does not resolve. */
async function deckModeJoin(
  a: string, b: string,
  ctx: { lookup: ReturnType<typeof mongoLookup>; tags: ReturnType<typeof createTagsLookup>; tokenTags: Awaited<ReturnType<typeof loadTokenTags>> },
): Promise<boolean | null> {
  const { cards } = await resolveNames([a, b, ...PAD], ctx.lookup);
  const na = cards.find((c) => normalizeName(c.name) === normalizeName(a))?.name;
  const nb = cards.find((c) => normalizeName(c.name) === normalizeName(b))?.name;
  if (!na || !nb) return null;
  const report = analyzeDeckStructured(
    await buildDeckCards(cards, ctx.lookup, ctx.tags), [], undefined, undefined, new ComboIndex([]), undefined, ctx.tokenTags,
  );
  return deckJoins(report.edges, na, nb);
}

/** Resolve a card name to a DeckCard (card + tags), or null when the name is unknown. */
async function resolveCard(
  name: string,
  lookup: { findByName(n: string): Promise<{ _id: string } | null> },
  cardTags: { findOne(q: object): Promise<unknown> },
): Promise<DeckCard | null> {
  const doc = await lookup.findByName(normalizeName(name));
  if (!doc) return null;
  const tags = (await cardTags.findOne({ oracleId: doc._id })) as CardTags | null;
  return { card: docToCard(doc as never), tags };
}

async function main(): Promise<void> {
  const jsonOut = process.argv.includes("--json");
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  // THE SHIPPED ENGINE, NOT THE RETIRED ONE. This read `store.db.collection("cardTags")` -- the
  // FLAT collection -- until 2026-09-07, while the product has defaulted to `derived` since
  // TAGS_SOURCE flipped on 2026-08-06 (`tags-lookup.ts:43`). All 58 compass cards carry BOTH, so
  // nothing failed; the compass simply scored an engine that no longer ships.
  const cardTags = { findOne: (q: object) => store.db.collection("cardTagsDerived").findOne(q) };
  const hierarchy = loadHierarchy();

  const results: PairResult[] = [];
  const skipped: string[] = [];
  for (const pair of GOLD) {
    if (!pair.verified) continue;
    const a = await resolveCard(pair.a, lookup as never, cardTags as never);
    const b = await resolveCard(pair.b, lookup as never, cardTags as never);
    if (!a || !b) {
      skipped.push(`${pair.a} / ${pair.b}`);
      continue;
    }
    const reasons = pairReasons(a, b, hierarchy);
    results.push({ pair, outcome: classifyPair(pair, reasons, a, b) });
  }
  // ---- the negative half, BEFORE the connection closes ----
  const check = async (p: AntiPair): Promise<"clean" | "false-edge" | "unresolved"> => {
    const a = await resolveCard(p.a, lookup, cardTags);
    const b = await resolveCard(p.b, lookup, cardTags);
    if (!a || !b) return "unresolved";
    return classifyAntiPair(p, pairReasons(a, b, hierarchy));
  };
  const newFalse: AntiPair[] = [];
  for (const p of ANTI.pairs) if (await check(p) === "false-edge") newFalse.push(p);
  const fixed: AntiPair[] = [];
  for (const p of ANTI.knownDefects) if (await check(p) === "clean") fixed.push(p);

  // ---- deck mode: EVERY row (verified positives, anti pairs, known defects) through the real
  //      pipeline. A row's join / no-join answer must be the same as in isolation. ----
  const t0 = Date.now();
  const ctx = { lookup, tags: createTagsLookup(store.db), tokenTags: await loadTokenTags(store.db) };
  const modeRows: ModeRow[] = [];
  for (const [kind, list] of [["pos", GOLD.filter((p) => p.verified)], ["anti", ANTI.pairs], ["known", ANTI.knownDefects]] as const) {
    for (const p of list) {
      const a = await resolveCard(p.a, lookup, cardTags);
      const b = await resolveCard(p.b, lookup, cardTags);
      const deck = a && b ? await deckModeJoin(p.a, p.b, ctx) : null;
      if (!a || !b || deck === null) continue; // unresolved rows are already reported above
      modeRows.push({ label: `[${kind}] ${p.a} / ${p.b}`, iso: pairReasons(a, b, hierarchy).length > 0, deck });
    }
  }
  const deckSeconds = ((Date.now() - t0) / 1000).toFixed(1);

  await store.close();

  const report = buildReport(results);
  if (jsonOut) {
    const path = fileURLToPath(new URL("../../matcher/compass-report.json", import.meta.url));
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
    console.log(`wrote ${path}`);
  }
  console.log(formatReport(report));

  // Per-miss detail, for the compass.
  for (const { pair, outcome } of results) {
    if (outcome.status === "PASS") continue;
    const cause = outcome.status === "NO-EDGE" ? outcome.noEdgeCause : "WRONG-REASON";
    const detail =
      outcome.status === "WRONG-REASON"
        ? ` got: ${outcome.reasons.map((r) => r.tag || r.effectKind).join(", ")}`
        : "";
    console.log(`  MISS [${pair.category}] ${pair.a} / ${pair.b}: ${cause}${detail}`);
  }
  if (skipped.length) console.log(`\nskipped (name unresolved): ${skipped.join("; ")}`);

  console.log(`\nanti-compass: ${ANTI.pairs.length - newFalse.length}/${ANTI.pairs.length} pairs correctly NOT joined`
    + ` · ${ANTI.knownDefects.length} known defect(s) still open`);
  for (const p of newFalse) {
    console.log(`  FALSE EDGE [${p.class}] ${p.a} / ${p.b} on ${p.tag}`);
    console.log(`      ${p.why}`);
  }
  for (const p of fixed) {
    console.log(`  FIXED [${p.class}] ${p.a} / ${p.b} on ${p.tag} — move it out of knownDefects so the gain is banked`);
  }
  // THE ISOLATION CAVEAT: every number above is `pairReasons` on two cards ALONE. This line is the
  // same rows through `analyzeDeckStructured`; any difference in join / no-join fails the run.
  const disagree = modeDisagreements(modeRows);
  console.log(`\ndeck-mode agreement: ${modeRows.length - disagree.length}/${modeRows.length} (${deckSeconds}s)`);
  for (const r of disagree) console.log(`  DISAGREE ${r.label}: isolated=${r.iso ? "join" : "no-join"} deck=${r.deck ? "join" : "no-join"}`);
  if (newFalse.length || fixed.length || disagree.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("eval-pairs failed:", err);
    process.exit(1);
  });
}
