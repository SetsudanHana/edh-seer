/** THE SUGGESTION ANTI-LIST (see `suggestion-anti-core.ts`): for each deck in
 *  `packages/instruments/data/suggestion-anti.json`, run the real suggestion pipeline against a local
 *  static build and fail when a card listed `never` shows up on a synergy list.
 *
 *    npx tsx packages/instruments/src/suggestion-anti.ts [--static static-out]
 *
 *  Free: files only (the static build, no Mongo). Exits 1 on any violation. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { suggestForDeck } from "@edh-seer/matcher/suggest-static";
import { analyzeStaticDeck, STATIC_BASE, staticFetch } from "./static-deck.js";
import { suggestionViolations } from "./suggestion-anti-core.js";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1]! : fallback; };
const repo = resolve(import.meta.dirname, "..", "..", "..");
const source = arg("--static", join(repo, "static-out"));

const rows = JSON.parse(readFileSync(join(repo, "packages", "instruments", "data", "suggestion-anti.json"), "utf8")) as { deck: string; commander?: string; never: string[] }[];
let failed = 0;
for (const row of rows) {
  const data = await analyzeStaticDeck(join(repo, row.deck), source, row.commander);
  const s = await suggestForDeck({ report: data.report, commanderColorIdentity: data.commanderColorIdentity, baseUrl: STATIC_BASE, fetchImpl: staticFetch(source) });
  const v = suggestionViolations(s, row.never);
  failed += v.length;
  console.log(`${row.deck}: ${v.length ? v.map((x) => `${x.card} on ${x.list}`).join("; ") : `none of ${row.never.length} suggested`}`);
}
if (failed) { console.error(`${failed} drawback(s) suggested as synergy`); process.exit(1); }
