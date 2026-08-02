import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig, mongoLookup, normalizeName, docToCard, parseDecklistText } from "@mtg/data";
import { loadOtagSemantics } from "@mtg/tagger";
import type { CardTags } from "@mtg/tagger";
import { cardThemeTags } from "../index.js";
import { ARCHETYPE_SIGNATURE, type Archetype } from "../archetypes.js";
import type { SaltPayload } from "./calibrate-core.js";
import {
  CS_CATEGORIES, CS_CATEGORY_TO_ARCHETYPE, CS_CATEGORY_TO_OTAGS, CS_CATEGORY_TO_SUBARCHETYPE, CS_UNMAPPED,
  ENGINE_ARCHETYPES_WITHOUT_CS, bucketFor, csCardCategories, csDeckArchetype, csSlug, csSubArchetypeCards,
  scoreCategory,
} from "./cs-categories.js";

/** Mirrors analyze.ts's local `isLand` (not exported there): typeLine substring match. Not
 *  imported because analyze.ts's version takes a DeckCard wrapper, not the bare Card we have
 *  here from docToCard. */
const isLand = (typeLine: string): boolean => typeLine.toLowerCase().includes("land");

const DECK_DIR = new URL("../../../cli/decks/", import.meta.url).pathname;
const CACHE_DIR = new URL("../../.cs-cache/", import.meta.url).pathname;

const DECKS = JSON.parse(
  readFileSync(new URL("../calibration-decks.json", import.meta.url), "utf8"),
) as Array<{ name: string; path: string; saltId: string }>;

/** CS is the reference here, so a fetch failure is fatal -- there is no partial result worth
 *  printing. (Contrast edhrec-pairs, where the oracle was one of three sets and could degrade.) */
async function fetchSalt(saltId: string): Promise<SaltPayload> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = `${CACHE_DIR}${saltId}.json`;
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8")) as SaltPayload;
  const res = await fetch(`https://api.commandersalt.com/decks?id=${encodeURIComponent(saltId)}`, {
    headers: { "User-Agent": "mtg-synergy-engine/1.0 (category comparison)" },
  });
  if (!res.ok) throw new Error(`CommanderSalt ${saltId}: HTTP ${res.status}`);
  const payload = (await res.json()) as SaltPayload;
  writeFileSync(cacheFile, JSON.stringify(payload));
  await new Promise((r) => setTimeout(r, 300));
  return payload;
}

/** Does this card match the engine's signature for `arch`? Mirrors analyze.ts's CardSignal
 *  construction (themeTags + effect kinds + voltron subtypes) and archetypes.ts's matcher. */
function engineMatches(tags: CardTags, oracleText: string, arch: Archetype): boolean {
  const sig = ARCHETYPE_SIGNATURE[arch];
  if (!sig) return false;
  const themeTags = [...cardThemeTags(tags)];
  const effectKinds = tags.abilities.map((a) => a.effect.kind);
  const subtypes = (tags.characteristics?.subtypes ?? []).filter(
    (s) => s === "equipment" || (s === "aura" && /enchant creature/i.test(oracleText)),
  );
  const tagHit = sig.tags?.some((t) =>
    t.endsWith(":") ? themeTags.some((tt) => tt.startsWith(t)) : themeTags.includes(t),
  ) ?? false;
  const kindHit = sig.effectKinds?.some((k) => effectKinds.includes(k)) ?? false;
  const subtypeHit = sig.subtypes?.some((s) => subtypes.includes(s)) ?? false;
  return tagHit || kindHit || subtypeHit;
}

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = store.db.collection("cardTags");
  const cardOtags = store.db.collection("cardOtags");
  const semantics = loadOtagSemantics();

  // Universe keyed by CS slug, so all three sources address the same cards.
  const csLabels = new Map<string, Set<string>>();      // csSlug -> CS categories
  const subArchLabels = new Map<string, Set<string>>(); // csSlug -> CS sub-archetype names (2nd reference)
  const otagSlugs = new Map<string, string[]>();        // csSlug -> otag slugs
  const engineCards = new Map<string, { tags: CardTags; oracleText: string }>();
  const deckRows: Array<{ name: string; csMajor: string; csMinor: string }> = [];

  for (const d of DECKS) {
    const payload = await fetchSalt(d.saltId);
    const cats = csCardCategories(payload);
    const arch = csDeckArchetype(payload);
    if (!arch) throw new Error(`deck "${d.name}" has no CS archetype block`);
    deckRows.push({ name: d.name, csMajor: arch.major, csMinor: arch.minor });

    // Invert sub-archetype -> slugs into slug -> sub-archetypes once per deck.
    const subArchByCard = new Map<string, Set<string>>();
    for (const [subName, slugs] of csSubArchetypeCards(payload)) {
      for (const slug of slugs) {
        const set = subArchByCard.get(slug) ?? new Set<string>();
        set.add(subName);
        subArchByCard.set(slug, set);
      }
    }

    for (const name of new Set(parseDecklistText(readFileSync(join(DECK_DIR, d.path), "utf8")))) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      const card = docToCard(doc as never);
      const key = csSlug(card.name);
      if (!cats.has(key)) continue; // CS never saw this card -- excluded from the universe
      csLabels.set(key, cats.get(key)!);
      subArchLabels.set(key, subArchByCard.get(key) ?? new Set());
      const od = (await cardOtags.findOne({ _id: doc._id } as never)) as { otags?: string[] } | null;
      otagSlugs.set(key, od?.otags ?? []);
      // analyze.ts:262 excludes lands from CardSignal construction (isLand filter) -- match that
      // here so lands are not eligible for engine signature matching, same as the real pipeline.
      if (isLand(card.typeLine)) continue;
      const t = (await cardTags.findOne({ oracleId: doc._id })) as CardTags | null;
      if (t) engineCards.set(key, { tags: t, oracleText: card.oracleText });
    }
  }

  const universe = csLabels.size;
  if (!universe) throw new Error("no cards matched between the decklists and CommanderSalt");

  // Predictions depend only on the category (otag mapping / engine archetype), not on which CS
  // reference is scored against -- computed once, reused by both tables below.
  const otagPredictionFor = (cat: string): Set<string> => {
    const mapped = CS_CATEGORY_TO_OTAGS[cat] ?? [];
    return new Set([...otagSlugs].filter(([, slugs]) => slugs.some((s) => mapped.includes(s))).map(([k]) => k));
  };
  const enginePredictionFor = (arch: Archetype): Set<string> =>
    new Set([...engineCards].filter(([, c]) => engineMatches(c.tags, c.oracleText, arch)).map(([k]) => k));

  console.log(`=== card-level comparison, REFERENCE 1/2: CS categories.stats (${universe} cards CS labelled, across ${DECKS.length} decks) ===`);
  console.log(`precision/recall are against CS as REFERENCE, not truth. Read precision against`);
  console.log(`prevalence: predicting at random scores precision ~= prevalence.\n`);
  console.log(`  ${"category".padEnd(24)} ${"bkt".padEnd(4)} ${"prev".padStart(6)} ${"otag P/R".padStart(14)} ${"engine P/R".padStart(14)}`);

  for (const cat of [...CS_CATEGORIES].sort()) {
    const bucket = bucketFor(cat);
    if (bucket === "C") continue;
    const labelled = new Set([...csLabels].filter(([, v]) => v.has(cat)).map(([k]) => k));
    const o = scoreCategory(otagPredictionFor(cat), labelled, universe);

    let engineCell = "     n/a      ";
    const arch = CS_CATEGORY_TO_ARCHETYPE[cat];
    if (arch) {
      const e = scoreCategory(enginePredictionFor(arch), labelled, universe);
      engineCell = `${(100 * e.precision).toFixed(0).padStart(5)}%/${(100 * e.recall).toFixed(0).padStart(4)}%`;
    }
    console.log(
      `  ${cat.padEnd(24)} ${bucket.padEnd(4)} ${(100 * o.prevalence).toFixed(0).padStart(5)}% ` +
        `${(100 * o.precision).toFixed(0).padStart(5)}%/${(100 * o.recall).toFixed(0).padStart(4)}% ${engineCell}`,
    );
  }

  console.log(`\n  bucket C -- CS categories neither we nor otags express (${CS_UNMAPPED.length}):`);
  console.log(`    ${CS_UNMAPPED.join(", ")}`);
  console.log(`  engine archetypes with no CS category (${ENGINE_ARCHETYPES_WITHOUT_CS.length}):`);
  console.log(`    ${ENGINE_ARCHETYPES_WITHOUT_CS.join(", ")}`);

  // Second reference: CS's synergy-graph sub-archetype `list` membership, a structurally
  // different signal from categories.stats above (see cs-categories.ts docs on
  // csSubArchetypeCards -- confirmed divergent for kindred: 46-card KINDRED list vs. 3
  // category-labelled cards on the inalla deck). Only categories with an observed matching
  // sub-archetype are scored; the rest have no row here (see CS_CATEGORY_TO_SUBARCHETYPE).
  console.log(`\n=== card-level comparison, REFERENCE 2/2: CS sub-archetype list membership (same ${universe}-card universe) ===`);
  console.log(`This is NOT the categories.stats table above -- it is a separate CS signal (deck-level`);
  console.log(`synergy-graph theme membership, not a per-card boolean label). Do not compare rows across`);
  console.log(`the two tables as if they measured the same thing.\n`);
  console.log(`  ${"category".padEnd(24)} ${"sub-archetype".padEnd(24)} ${"prev".padStart(6)} ${"otag P/R".padStart(14)} ${"engine P/R".padStart(14)}`);

  for (const cat of [...CS_CATEGORIES].sort()) {
    if (bucketFor(cat) === "C") continue;
    const subName = CS_CATEGORY_TO_SUBARCHETYPE[cat];
    if (!subName) continue; // no matching sub-archetype observed for this category
    const labelled = new Set([...subArchLabels].filter(([, v]) => v.has(subName)).map(([k]) => k));
    const o = scoreCategory(otagPredictionFor(cat), labelled, universe);

    let engineCell = "     n/a      ";
    const arch = CS_CATEGORY_TO_ARCHETYPE[cat];
    if (arch) {
      const e = scoreCategory(enginePredictionFor(arch), labelled, universe);
      engineCell = `${(100 * e.precision).toFixed(0).padStart(5)}%/${(100 * e.recall).toFixed(0).padStart(4)}%`;
    }
    console.log(
      `  ${cat.padEnd(24)} ${subName.padEnd(24)} ${(100 * o.prevalence).toFixed(0).padStart(5)}% ` +
        `${(100 * o.precision).toFixed(0).padStart(5)}%/${(100 * o.recall).toFixed(0).padStart(4)}% ${engineCell}`,
    );
  }

  console.log(`\n=== deck-level SANITY CHECK (${DECKS.length} decks -- too few to conclude from) ===`);
  for (const r of deckRows) console.log(`  ${r.name.padEnd(12)} CS: ${r.csMajor} / ${r.csMinor}`);

  await store.close();
}

main().catch((err) => {
  console.error("cs-compare failed:", err);
  process.exit(1);
});
