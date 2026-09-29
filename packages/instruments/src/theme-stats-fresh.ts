import { fileURLToPath } from "node:url";
import { connect, loadConfig } from "@edh-seer/data";
import { DERIVED_COLLECTION, type CardTags } from "@edh-seer/tagger";
import { computeThemeStats, loadThemeStats } from "@edh-seer/matcher/theme-stats";
import { compareThemeStats, driftReport } from "./theme-stats-fresh-core.js";

/** THE COUNT-FRESHNESS GUARD FOR `theme-stats.json` (#720): recount every theme tag from the corpus
 *  the engine reads and fail when any committed count disagrees.
 *
 *    npx tsx packages/instruments/src/theme-stats-fresh.ts        # exit 1 when stale
 *
 *  It needs Mongo, so it cannot run in CI; it belongs beside the panel and the compass, run after a
 *  re-derive and before the PR that ships it. The population is the one `gen-theme-stats.ts` counts
 *  (`TAGS_SOURCE=flat` for the flat collection), so a fresh artifact passes by construction. */
async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const source = process.env.TAGS_SOURCE === "flat" ? "cardTags" : DERIVED_COLLECTION;
  const docs: CardTags[] = [];
  for await (const d of store.db.collection<CardTags>(source).find({}) as unknown as AsyncIterable<CardTags>) docs.push(d);
  await store.close();
  const drift = compareThemeStats(loadThemeStats(), computeThemeStats(docs));
  console.log(driftReport(drift));
  if (!drift.fresh) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error("theme-stats-fresh failed:", err); process.exit(1); });
}
