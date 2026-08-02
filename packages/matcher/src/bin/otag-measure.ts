import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig, mongoLookup, normalizeName, docToCard, parseDecklistText } from "@mtg/data";
import { loadOtagSemantics } from "@mtg/tagger";
import type { CardTags } from "@mtg/tagger";
import { loadHierarchy, pairReasons } from "../index.js";
import type { DeckCard } from "../types.js";
import { buildOtagEdges, pairKey, undirectedPairs, type OtagEdge } from "../otag-edges.js";
import type { GoldPair } from "./eval-pairs-core.js";

const DECK_DIR = new URL("../../../cli/decks/", import.meta.url).pathname;

const DECKS = JSON.parse(
  readFileSync(new URL("../calibration-decks.json", import.meta.url), "utf8"),
) as Array<{ name: string; path: string; saltId: string }>;

const GOLD = JSON.parse(
  readFileSync(new URL("../goldpairs.json", import.meta.url), "utf8"),
) as GoldPair[];

interface Loaded {
  name: string;
  cards: DeckCard[];
  otagsByCard: Map<string, string[]>;
}

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = store.db.collection("cardTags");
  const cardOtags = store.db.collection("cardOtags");
  const hierarchy = loadHierarchy();
  const semantics = loadOtagSemantics();

  // ---- load decks -------------------------------------------------------
  const loaded: Loaded[] = [];
  for (const d of DECKS) {
    const cards: DeckCard[] = [];
    const otagsByCard = new Map<string, string[]>();
    for (const name of parseDecklistText(readFileSync(join(DECK_DIR, d.path), "utf8"))) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      const tags = (await cardTags.findOne({ oracleId: doc._id })) as CardTags | null;
      const card = docToCard(doc as never);
      cards.push({ card, tags });
      const od = (await cardOtags.findOne({ _id: doc._id } as never)) as { otags?: string[] } | null;
      otagsByCard.set(card.name, od?.otags ?? []);
    }
    if (!cards.length) throw new Error(`deck "${d.name}" resolved zero cards -- wrong corpus?`);
    loaded.push({ name: d.name, cards, otagsByCard });
  }

  // ---- M1: floor test against the 55 verified gold pairs -----------------
  // Each gold pair is judged on its own two cards, not inside a deck.
  let goldHit = 0;
  let goldTotal = 0;
  const goldMisses: string[] = [];
  for (const g of GOLD) {
    if (!g.verified) continue;
    const da = await lookup.findByName(normalizeName(g.a));
    const db = await lookup.findByName(normalizeName(g.b));
    if (!da || !db) continue;
    goldTotal++;
    const oa = ((await cardOtags.findOne({ _id: da._id } as never)) as { otags?: string[] } | null)?.otags ?? [];
    const ob = ((await cardOtags.findOne({ _id: db._id } as never)) as { otags?: string[] } | null)?.otags ?? [];
    const edges = buildOtagEdges([g.a, g.b], new Map([[g.a, oa], [g.b, ob]]), semantics);
    if (edges.length) goldHit++;
    else goldMisses.push(`${g.a} / ${g.b} (${g.category})`);
  }
  console.log(`=== M1: otag edges vs verified gold pairs ===`);
  console.log(`  ${goldHit}/${goldTotal} (${((100 * goldHit) / goldTotal).toFixed(0)}%)`);
  console.log(`  NOTE: a low number here is informative, not a failure -- many gold pairs rely`);
  console.log(`  on a structural producer this model deliberately excludes.`);
  if (goldMisses.length) {
    console.log(`  missed:`);
    for (const m of goldMisses) console.log(`    ${m}`);
  }

  // ---- M2: reproduction against the engine ------------------------------
  console.log(`\n=== M2: reproduction vs engine edges ===`);
  console.log(`  recall    = otag∩engine / engine  (share of engine edges otags reproduce)`);
  console.log(`  agreement = otag∩engine / otag  (share of otag edges the engine confirms)\n`);
  console.log(`  ${"deck".padEnd(12)} ${"engine".padStart(7)} ${"otag".padStart(7)} ${"both".padStart(7)} ${"recall".padStart(8)} ${"agree".padStart(8)}`);

  const perVerb = new Map<string, { otag: number; both: number }>();
  for (const l of loaded) {
    const names = l.cards.map((c) => c.card.name);
    const otagEdges = buildOtagEdges(names, l.otagsByCard, semantics);
    const otagSet = undirectedPairs(otagEdges);

    const engineSet = new Set<string>();
    for (let i = 0; i < l.cards.length; i++) {
      for (let j = i + 1; j < l.cards.length; j++) {
        if (pairReasons(l.cards[i], l.cards[j], hierarchy).length) {
          engineSet.add(pairKey(l.cards[i].card.name, l.cards[j].card.name));
        }
      }
    }
    const both = [...otagSet].filter((k) => engineSet.has(k)).length;
    const recall = engineSet.size ? (100 * both) / engineSet.size : 0;
    const agree = otagSet.size ? (100 * both) / otagSet.size : 0;
    console.log(
      `  ${l.name.padEnd(12)} ${String(engineSet.size).padStart(7)} ${String(otagSet.size).padStart(7)} ` +
        `${String(both).padStart(7)} ${recall.toFixed(0).padStart(7)}% ${agree.toFixed(0).padStart(7)}%`,
    );

    for (const e of otagEdges) {
      const r = perVerb.get(e.verb) ?? { otag: 0, both: 0 };
      r.otag++;
      if (engineSet.has(pairKey(e.a, e.b))) r.both++;
      perVerb.set(e.verb, r);
    }
  }

  console.log(`\n  per-verb agreement (otag edges the engine confirms):`);
  for (const [verb, r] of [...perVerb].sort((a, b) => b[1].otag - a[1].otag)) {
    console.log(`    ${verb.padEnd(20)} ${String(r.both).padStart(6)}/${String(r.otag).padEnd(6)} ${((100 * r.both) / r.otag).toFixed(0).padStart(3)}%`);
  }

  await store.close();
}

main().catch((err) => {
  console.error("otag-measure failed:", err);
  process.exit(1);
});
