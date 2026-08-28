// DORMANT (2026-07-21): CommanderSalt rank-correlation calibration is no longer the validation
// target — it plateaued at ~0.15 Spearman across every lever. Kept for reference only; it is NOT
// part of the improvement loop and must not be re-fitted. The active harness is the pair-recall
// compass (bin/eval-pairs.ts). See packages/matcher/VALIDATION.md.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistText, docToCard } from "@edh-seer/data";
import { SEED_IMPACT_WEIGHTS, loadImpactWeights, impactEdgeWeight, dampByAlpha, COMMANDER_BOOST, type ImpactWeights } from "@edh-seer/engine";
import type { CardTags } from "@edh-seer/tagger";
import { analyzeDeckStructured } from "../analyze.js";
import { saltCardScores, spearman, meanSpearman, looCV, type SaltPayload, type ScoreDeck } from "./calibrate-core.js";
import type { DeckCard } from "../types.js";

const DECK_DIR = join(process.cwd(), "..", "cli", "decks");
const CONFIG = JSON.parse(
  readFileSync(new URL("../calibration-decks.json", import.meta.url), "utf8"),
) as { name: string; path: string; saltId: string }[];
const ENGINE_JSON = fileURLToPath(new URL("../../../engine/src/impact-weights.json", import.meta.url));

/** Slugify a card name to match CommanderSalt's synergy-list keys (lowercase, underscored):
 *  "Venser, Shaper Savant" -> "venser_shaper_savant". */
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

async function fetchSalt(saltId: string): Promise<SaltPayload> {
  const res = await fetch(`https://api.commandersalt.com/decks?id=${encodeURIComponent(saltId)}`);
  if (!res.ok) throw new Error(`CommanderSalt ${saltId}: HTTP ${res.status}`);
  return (await res.json()) as SaltPayload;
}

async function main(): Promise<void> {
  const extra = process.argv.find((a) => a.startsWith("--decks="))?.slice("--decks=".length);
  const decks = [...CONFIG];
  if (extra) for (const id of extra.split(",")) decks.push({ name: id, path: `${id}.txt`, saltId: id });

  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = store.db.collection("cardTags");

  const scoreDecks: ScoreDeck[] = [];
  const salts: number[][] = [];
  const deckNames: string[][] = [];

  let loaded = 0;
  for (const d of decks) {
    process.stdout.write(`\rloading decks ${++loaded}/${decks.length} (${d.name})${" ".repeat(20)}`);
    // Load tagged deck.
    const inputs: DeckCard[] = [];
    for (const name of parseDecklistText(readFileSync(join(DECK_DIR, d.path), "utf8"))) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      const tags = (await cardTags.findOne({ oracleId: doc._id })) as CardTags | null;
      inputs.push({ card: docToCard(doc), tags });
    }
    // CommanderSalt reference, aligned to OUR card order (drop cards salt does not score).
    const payload = await fetchSalt(d.saltId);
    const saltScores = saltCardScores(payload);
    const commanderSet = new Set(payload.commanders ?? []);
    const names = inputs.map((i) => i.card.name).filter((n) => saltScores.has(slug(n)));
    const salt = names.map((n) => saltScores.get(slug(n))!);
    salts.push(salt);
    deckNames.push(names);
    // Edges/reasons are WEIGHT-INDEPENDENT — form them once here, not on every optimizer eval.
    // (Re-running analyzeDeckStructured per candidate weight re-does O(n²) edge formation
    //  ~1.7M times over a full LOO fit; precomputing collapses that to one analysis per deck.)
    const analysis = analyzeDeckStructured(inputs);
    const edges = analysis.edges;
    const allNames = inputs.map((i) => i.card.name);
    // AN EDGE ENDPOINT IS A FACE NAME; EVERY OTHER NAME HERE IS THE PHYSICAL CARD. Task 7
    // (faces-as-nodes) gave each printed face its own node, so `e.a`/`e.b` name a FACE while
    // `allNames`, `names` and CommanderSalt's `commanders` all name the card. Unfolded, every
    // multi-face card's weight accumulated under a key `names` never asks for and the card scored
    // ZERO in the fit — the same defect the 08-27 review found in `isolated-cards.ts` and
    // `graph-modularity.ts`, in a third instrument. Review fix, 2026-08-28. `report.cards` is the
    // cheapest place to read the mapping: it carries `cardName` on both faces of a multi-face card
    // and omits it entirely on a single-faced one, so this Map is empty for most decks.
    const physicalOf = new Map(
      analysis.cards.filter((c) => c.cardName !== undefined).map((c) => [c.name, c.cardName!] as const),
    );
    const phys = (name: string): string => physicalOf.get(name) ?? name;
    // Cheap re-scorer over the fixed edges: mirrors analyzeDeckStructured's aggregation, including
    // COMMANDER_BOOST (a card's edge to the commander is boosted — CS ranks the commander high).
    scoreDecks.push((w: ImpactWeights) => {
      const weighted = new Map<string, number>(allNames.map((n) => [n, 0]));
      const partners = new Map<string, number>(allNames.map((n) => [n, 0]));
      for (const e of edges) {
        const ew = impactEdgeWeight(e.reasons, w);
        // Both endpoints folded to the physical card, so a two-faced card's two nodes accumulate
        // onto the one name the fit scores -- and so the commander test sees a commander whichever
        // face the edge landed on (a card is the commander regardless of which side is up, the
        // ruling `isCommanderNode` already ships).
        const a = phys(e.a);
        const b = phys(e.b);
        const boostA = commanderSet.has(b) ? COMMANDER_BOOST : 1;
        const boostB = commanderSet.has(a) ? COMMANDER_BOOST : 1;
        weighted.set(a, (weighted.get(a) ?? 0) + ew * boostA);
        weighted.set(b, (weighted.get(b) ?? 0) + ew * boostB);
        partners.set(a, (partners.get(a) ?? 0) + 1);
        partners.set(b, (partners.get(b) ?? 0) + 1);
      }
      return names.map((n) => dampByAlpha(weighted.get(n) ?? 0, partners.get(n) ?? 0, w.damping));
    });
  }

  process.stdout.write(`\rloaded ${decks.length} decks${" ".repeat(30)}\n`);

  // Diagnostic: --report prints per-deck Spearman + where our order diverges from CommanderSalt,
  // under the currently-committed weights. No fitting.
  if (process.argv.includes("--report")) {
    const w = loadImpactWeights();
    const rankOf = (xs: number[]): Map<number, number> => {
      const order = xs.map((v, i) => i).sort((a, b) => xs[b] - xs[a]);
      const r = new Map<number, number>();
      order.forEach((idx, pos) => r.set(idx, pos + 1));
      return r;
    };
    for (let di = 0; di < decks.length; di++) {
      const names = deckNames[di];
      const ours = scoreDecks[di](w);
      const cs = salts[di];
      const rho = spearman(ours, cs);
      console.log(`\n===== ${decks[di].name} — ${names.length} scored cards — Spearman ${rho.toFixed(3)} =====`);
      const ourRank = rankOf(ours);
      const csRank = rankOf(cs);
      const rows = names
        .map((n, i) => ({ n, us: ourRank.get(i)!, cs: csRank.get(i)!, uScore: ours[i], cScore: cs[i] }))
        .sort((a, b) => a.cs - b.cs)
        .slice(0, 20);
      console.log("  CS# US#  Δ    ourScore   csScore  card");
      for (const r of rows) {
        const d = r.us - r.cs;
        console.log(
          `  ${String(r.cs).padStart(3)} ${String(r.us).padStart(3)} ${(d >= 0 ? "+" : "") + d}`.padEnd(14) +
          `${r.uScore.toFixed(2).padStart(8)} ${r.cScore.toFixed(1).padStart(9)}  ${r.n}`,
        );
      }
    }
    await store.close();
    return;
  }

  const prior = SEED_IMPACT_WEIGHTS;
  const baseline = meanSpearman(scoreDecks, salts, loadImpactWeights());
  const started = Date.now();
  const { inSample, loo, fitted } = looCV(
    scoreDecks, salts, prior,
    { restarts: 8, iterations: 60, lambda: 0.02, seed: 1 },
    (doneN, totalN) => {
      const width = 30;
      const filled = Math.round((width * doneN) / totalN);
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      process.stdout.write(
        `\rfitting [${"#".repeat(filled)}${"-".repeat(width - filled)}] ${doneN}/${totalN} restarts ${secs}s`,
      );
      if (doneN === totalN) process.stdout.write("\n");
    },
  );

  writeFileSync(ENGINE_JSON, JSON.stringify(fitted, null, 2) + "\n");
  console.log(`baseline (current impact-weights.json) mean Spearman: ${baseline.toFixed(3)}`);
  console.log(`fitted in-sample mean Spearman:                       ${inSample.toFixed(3)}`);
  console.log(`fitted LOO-CV mean Spearman (headline):               ${loo.toFixed(3)}`);
  console.log(`wrote ${ENGINE_JSON}`);
  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error("calibrate failed:", err); process.exit(1); });
}
