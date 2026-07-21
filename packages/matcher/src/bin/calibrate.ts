import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistText, docToCard } from "@mtg/data";
import { SEED_IMPACT_WEIGHTS, loadImpactWeights, impactEdgeWeight, dampByAlpha, type ImpactWeights } from "@mtg/engine";
import type { CardTags } from "@mtg/tagger";
import { analyzeDeckStructured } from "../analyze.js";
import { saltCardScores, meanSpearman, looCV, type SaltPayload, type ScoreDeck } from "./calibrate-core.js";
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
    const saltScores = saltCardScores(await fetchSalt(d.saltId));
    const names = inputs.map((i) => i.card.name).filter((n) => saltScores.has(slug(n)));
    const salt = names.map((n) => saltScores.get(slug(n))!);
    salts.push(salt);
    // Edges/reasons are WEIGHT-INDEPENDENT — form them once here, not on every optimizer eval.
    // (Re-running analyzeDeckStructured per candidate weight re-does O(n²) edge formation
    //  ~1.7M times over a full LOO fit; precomputing collapses that to one analysis per deck.)
    const edges = analyzeDeckStructured(inputs).edges;
    const allNames = inputs.map((i) => i.card.name);
    // Cheap re-scorer over the fixed edges: mirrors analyzeDeckStructured's aggregation
    // (no commander boost — matches passing no commander names).
    scoreDecks.push((w: ImpactWeights) => {
      const weighted = new Map<string, number>(allNames.map((n) => [n, 0]));
      const partners = new Map<string, number>(allNames.map((n) => [n, 0]));
      for (const e of edges) {
        const ew = impactEdgeWeight(e.reasons, w);
        weighted.set(e.a, (weighted.get(e.a) ?? 0) + ew);
        weighted.set(e.b, (weighted.get(e.b) ?? 0) + ew);
        partners.set(e.a, (partners.get(e.a) ?? 0) + 1);
        partners.set(e.b, (partners.get(e.b) ?? 0) + 1);
      }
      return names.map((n) => dampByAlpha(weighted.get(n) ?? 0, partners.get(n) ?? 0, w.damping));
    });
  }

  process.stdout.write(`\rloaded ${decks.length} decks${" ".repeat(30)}\n`);

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
