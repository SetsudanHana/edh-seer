/** DO TWO STATIC BUILDS SUGGEST THE SAME CARDS? (#1014, 2026-10-03.) A change to what the corpus
 *  side indexes (`supplyKeysOf`, the event member lists) reaches the report through
 *  `suggestForDeck`, which neither the panel nor the compass reads. This runs the browser's own
 *  analysis and suggestions for every Nth precon against two `static-out`-shaped directories and
 *  prints how much of each list survives.
 *
 *  Free: reads two local builds, no API spend, no writes.
 *
 *    npx tsx research/matcher/suggest-ab.ts <static dir A> <static dir B> [every=10]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { preconDecklist, type Precon } from "../../packages/data/src/precons.js";
import { suggestForDeck, type DeckSuggestions } from "../../packages/matcher/src/suggest-static.js";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";

const [dirA, dirB, everyArg] = process.argv.slice(2);
if (!dirA || !dirB) throw new Error("usage: suggest-ab.ts <static dir A> <static dir B> [every]");
const every = Number(everyArg ?? 10);
const base = "http://static.local";
const fetchFrom = (dir: string): typeof fetch => (async (input: string | URL | Request) => {
  const path = join(dir, new URL(String(input)).pathname);
  if (!existsSync(path)) return new Response("not found", { status: 404 });
  return new Response(readFileSync(path), { headers: { "content-type": "application/json" } });
}) as typeof fetch;

const names = (s: DeckSuggestions): Map<string, string[]> => new Map([
  ["plan", s.plan.map((c) => c.name)],
  ["pairs", s.pairs.map((p) => p.add.name)],
  ["routes", s.routes.map((c) => c.name)],
  ...Object.entries(s.synergy).map(([k, cs]) => [`synergy:${k}`, cs.map((c) => c.name)] as [string, string[]]),
  ...Object.entries(s.build).map(([k, cs]) => [`build:${k}`, cs.map((c) => c.name)] as [string, string[]]),
]);

async function suggestionsFor(p: Precon, dir: string): Promise<DeckSuggestions> {
  const f = fetchFrom(dir);
  const data = await analyzeDeckStatic(preconDecklist(p), p.commanders.join("\n"), base, f);
  return suggestForDeck({ report: data.report, commanderColorIdentity: data.commanderColorIdentity, baseUrl: base, fetchImpl: f });
}

const precons = (JSON.parse(readFileSync("packages/data/precons.json", "utf8")) as Precon[]).filter((_, i) => i % every === 0);
const tally = new Map<string, { a: number; b: number; kept: number }>();
for (const p of precons) {
  const [a, b] = [names(await suggestionsFor(p, dirA)), names(await suggestionsFor(p, dirB))];
  const planA = a.get("plan") ?? [], planB = b.get("plan") ?? [];
  console.log(`${p.name}: plan ${planA.slice(0, 4).join(", ")}  ->  ${planB.slice(0, 4).join(", ")}`);
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const group = key.split(":")[0]!;
    const la = a.get(key) ?? [], lb = new Set(b.get(key) ?? []);
    const t = tally.get(group) ?? { a: 0, b: 0, kept: 0 };
    t.a += la.length; t.b += lb.size; t.kept += la.filter((n) => lb.has(n)).length;
    tally.set(group, t);
  }
}
console.log(`\n${precons.length} precons (every ${every}th)`);
for (const [group, t] of tally) console.log(`  ${group.padEnd(8)} A ${t.a}  B ${t.b}  kept ${t.kept} (${t.a ? (100 * t.kept / t.a).toFixed(1) : "-"}% of A)`);
