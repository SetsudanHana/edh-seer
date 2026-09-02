import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections,
} from "@edh-seer/data";
import { createTagsLookup } from "@edh-seer/tagger";
import { ComboIndex } from "@edh-seer/engine";
import { analyzeDeckStructured } from "../analyze.js";
import { loadTokenTags } from "../token-tags.js";
import type { DeckCard } from "../types.js";

/** DOES RANKING ARCHETYPE GROUPS ON EARNED MEMBERSHIP REORDER ANYTHING? (roadmap T15.)
 *
 *  `ArchetypeBoard` ranks and sizes its groups on `cards.length`, which counts a card that joined by
 *  being PLAYED -- the matcher synthesises "any nonland is cast" and "any permanent enters" so that
 *  a payoff has something to feed on. On the deck that raised this, an Enchantress list, that put
 *  `Spellslinger` at 61 of 99 cards and at the top of the panel.
 *
 *  Three numbers over the 71 calibration decks:
 *    1. how many decks change their TOP group
 *    2. how many change the top THREE (as a set, not merely the order)
 *    3. what share of all memberships are implied, which is the size of the thing being removed
 *
 *  LOADED BY URL for the same reason `finding-rank.ts` is: the split lives in the client, which is
 *  the only surface that renders it, and a second copy here would be two definitions that can
 *  disagree. A static import would also put a client file inside this package's `rootDir`, which
 *  `tsc --noEmit` rejects (TS6059).
 *
 *  Free: Mongo reads only, no API, no writes.
 *
 *    set -a && source packages/tagger/.env && set +a
 *    npx tsx packages/matcher/src/bin/archetype-earned.ts
 */
const DECK_DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");
const MATRIX_PATH = join(process.cwd(), "packages", "web", "client", "src", "lib", "theme-matrix.ts");

interface Column { category: string; label: string; earned: number; total: number }
type MatrixModule = {
  themeMatrix: (a: unknown, n: readonly string[]) => { columns: Column[]; earnedTotal: number; impliedTotal: number } | null;
};

async function main(): Promise<void> {
  const { themeMatrix } = await import(pathToFileURL(MATRIX_PATH).href) as MatrixModule;
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = createTagsLookup(store.db);
  const tokenTags = await loadTokenTags(store.db);

  let decks = 0, topChanged = 0, setChanged = 0, earned = 0, implied = 0;
  const examples: string[] = [];
  const winBefore = new Map<string, number>();
  const winAfter = new Map<string, number>();

  // ONE DECK, EVERY COLUMN. The sweep answers "does the ranking move"; a single deck is how the
  // question that started T2d is checked -- whether this deck's grid has a column for what the deck
  // actually is.
  const only = process.argv[2];
  for (const file of readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort()
    .filter((f) => only === undefined || f.replace(/\.txt$/, "") === only)) {
    const sections = parseDecklistSections(readFileSync(join(DECK_DIR, file), "utf8"));
    const inputs: DeckCard[] = [];
    for (const name of [...sections.commanders, ...sections.deck]) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      inputs.push({ card: docToCard(doc), tags: await cardTags.findOne(String(doc._id)) });
    }
    const r = analyzeDeckStructured(
      inputs, sections.commanders, undefined, undefined, new ComboIndex([]), undefined, tokenTags,
    ) as unknown as { archetypes?: { category: string; label: string; cards: string[] }[] };
    if (!r.archetypes || r.archetypes.length === 0) continue;

    const nonland = inputs.filter((dc) => !/\bland\b/i.test((dc.card.typeLine ?? "").split(" // ")[0]))
      .map((dc) => dc.card.name);
    const m = themeMatrix(r.archetypes, nonland);
    if (!m) continue;
    decks++;
    if (only !== undefined) {
      console.log(`${file.replace(/\.txt$/, "")} columns, in the engine's own order:`);
      for (const c of m.columns) console.log(`  ${c.label.padEnd(20)} ${c.earned} of ${c.total} cards earn it`);
    }
    earned += m.earnedTotal;
    implied += m.impliedTotal;

    // The incumbent order is the engine's own, which `ArchetypeBoard` renders as given.
    const before = m.columns.map((c) => c.label);
    const after = m.columns.slice().sort((a, b) => b.earned - a.earned || b.total - a.total).map((c) => c.label);
    if (before[0] !== after[0]) {
      topChanged++;
      if (examples.length < 8) examples.push(`${file.replace(/\.txt$/, "")}: ${before[0]} -> ${after[0]}`);
    }
    winBefore.set(before[0]!, (winBefore.get(before[0]!) ?? 0) + 1);
    winAfter.set(after[0]!, (winAfter.get(after[0]!) ?? 0) + 1);
    const key = (xs: string[]): string => JSON.stringify(xs.slice(0, 3).slice().sort());
    if (key(before) !== key(after)) setChanged++;
  }
  await store.close();

  console.log(`decks with groups: ${decks}`);
  console.log(`top group changes: ${topChanged} (${(topChanged / decks * 100).toFixed(1)}%)`);
  console.log(`top three change:  ${setChanged} (${(setChanged / decks * 100).toFixed(1)}%)`);
  console.log(`memberships: ${earned} earned, ${implied} implied (${(implied / (earned + implied) * 100).toFixed(1)}% implied)`);
  const table = (m: Map<string, number>): string =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  console.log(`\nmodal winner, by pair count (today): ${table(winBefore)}`);
  console.log(`modal winner, by earned cards:       ${table(winAfter)}`);
  console.log(`\nexamples:`);
  for (const e of examples) console.log(`  ${e}`);
}

void main();
