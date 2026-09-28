/** THE SUGGESTION ANTI-LIST (see `suggestion-anti-core.ts`): for each deck in
 *  `packages/instruments/data/suggestion-anti.json`, run the real suggestion pipeline against a local
 *  static build and fail when a card listed `never` shows up on a synergy list.
 *
 *    npx tsx packages/instruments/src/suggestion-anti.ts [--static static-out]
 *
 *  Free: files only (the static build, no Mongo). Exits 1 on any violation. */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyzeDecklist } from "@edh-seer/matcher/orchestrate";
import { StaticLookup } from "@edh-seer/matcher/static-lookup";
import { suggestForDeck } from "@edh-seer/matcher/suggest-static";
import { suggestionViolations } from "./suggestion-anti-core.js";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1]! : fallback; };
const repo = resolve(import.meta.dirname, "..", "..", "..");
const source = arg("--static", join(repo, "static-out"));
const baseUrl = "http://static.local";
const fetchImpl = (async (input: string | URL | Request) => {
  const path = join(source, new URL(String(input)).pathname);
  if (!existsSync(path)) return new Response("not found", { status: 404 });
  return new Response(readFileSync(path), { headers: { "content-type": "application/json" } });
}) as typeof fetch;

const rows = JSON.parse(readFileSync(join(repo, "packages", "instruments", "data", "suggestion-anti.json"), "utf8")) as { deck: string; commander?: string; never: string[] }[];
let failed = 0;
for (const row of rows) {
  const data = await analyzeDecklist(readFileSync(join(repo, row.deck), "utf8"), row.commander, async (names) => {
    const lookup = new StaticLookup(baseUrl, fetchImpl);
    await lookup.prefetch(names);
    return { lookup, tagsLookup: lookup, tokenTags: await lookup.tokenTags(), tokenArt: (ids: string[]) => lookup.tokenArt(ids) };
  });
  const s = await suggestForDeck({ report: data.report, commanderColorIdentity: data.commanderColorIdentity, baseUrl, fetchImpl });
  const v = suggestionViolations(s, row.never);
  failed += v.length;
  console.log(`${row.deck}: ${v.length ? v.map((x) => `${x.card} on ${x.list}`).join("; ") : `none of ${row.never.length} suggested`}`);
}
if (failed) { console.error(`${failed} drawback(s) suggested as synergy`); process.exit(1); }
