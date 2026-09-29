/** The per-deck half of `population-compare.ts`, run in a worker thread (see `@edh-seer/data/parallel`).
 *  Each worker opens its own connection and lookups once and reuses them for every deck it is given. */
import { readFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames } from "@edh-seer/data";
import { serveWorker } from "@edh-seer/data/parallel";
import { ComboIndex } from "@edh-seer/engine";
import { createTagsLookup } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags, type CardTagsLookup } from "@edh-seer/matcher";
import { meshReport, type MeshGroup } from "@edh-seer/matcher/mesh";

export interface Row {
  deck: string; edges: [number, number]; reasons: [number, number]; theme: [string, string];
  covered: number; total: number;
  /** Reason counts split by mesh.ts, so the comparison is not decided by whichever population
   *  produces the widest whole-deck fans. */
  clean: [number, number]; meshed: [number, number];
}
export interface DeckResult { row: Row; mesh: [MeshGroup[], MeshGroup[]] }

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const flat: CardTagsLookup = createTagsLookup(store.db, "flat");
const derived: CardTagsLookup = createTagsLookup(store.db, "derived-first");
// Task 6 (tokens-as-nodes): both populations get the SAME token lookup -- the 94 rows Task 5 derived
// live in `cardTagsDerived` regardless of which population (flat/derived) the CARD side reads from.
const tokenTags = await loadTokenTags(store.db);

serveWorker(async ({ dir, file }: { dir: string; file: string }): Promise<DeckResult> => {
  const sections = parseDecklistSections(readFileSync(`${dir}/${file}`, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmdNorm = new Set(sections.commanders.map(normalizeName));
  const commanderNames = cards.filter((c) => cmdNorm.has(normalizeName(c.name))).map((c) => c.name);

  const run = async (tags: CardTagsLookup) => {
    const deckCards = await buildDeckCards(cards, lookup, tags);
    const report = analyzeDeckStructured(
      deckCards, commanderNames, undefined, undefined, new ComboIndex(combos), undefined, tokenTags,
    );
    return { report, deckCards };
  };
  const a = await run(flat);
  const b = await run(derived);

  // How much of this deck the derived population actually covers, so a null delta can be told apart
  // from a deck the corpus simply does not reach.
  const derivedCol = store.db.collection("cardTagsDerived");
  let covered = 0;
  for (const dc of b.deckCards) {
    const t = dc.tags as { oracleId?: string } | null;
    if (t?.oracleId && await derivedCol.countDocuments({ oracleId: t.oracleId }, { limit: 1 })) covered++;
  }

  const themeOf = (r: ReturnType<typeof analyzeDeckStructured>): string =>
    (r.axis ?? []).slice(0, 1).map((x: { tag: string }) => x.tag).join(",") || "(none)";
  const allReasons = (r: ReturnType<typeof analyzeDeckStructured>) => r.edges.flatMap((e) => e.reasons);
  const mesh = ([a.report, b.report] as const).map((r) => meshReport(allReasons(r), cards.length));

  return {
    row: {
      deck: file.replace(/\.txt$/, ""),
      edges: [a.report.edges.length, b.report.edges.length],
      reasons: [allReasons(a.report).length, allReasons(b.report).length],
      clean: [mesh[0]!.clean, mesh[1]!.clean],
      meshed: [mesh[0]!.meshed, mesh[1]!.meshed],
      theme: [themeOf(a.report), themeOf(b.report)],
      covered, total: b.deckCards.length,
    },
    mesh: [mesh[0]!.groups, mesh[1]!.groups],
  };
});
