/** OUR PRECON UPGRADES AGAINST WHAT PLAYERS DO (owner, 2026-09-27: "compare what people suggest as
 *  upgrades to each one of those and what we suggest and see if we can use this data for calibration").
 *
 *  EDHREC publishes one page per precon built from the decks people registered with that precon as
 *  their starting point: "Cards to Add" (up to 50, with `num_decks` of `potential_decks`, the
 *  inclusion rate among those decks) and "Cards to Cut" (with `unpopularity`, the share that cut it).
 *  For every precon in `packages/data/precons.json` this runs the SAME code the precon page runs
 *  (`build-precons.mts`: analysis, `chooseCuts`, `suggestForDeck`) against a static build, and prints
 *  how our adds and cuts line up with theirs, per deck and pooled.
 *
 *    npx tsx research/web/precon-vs-edhrec.ts [--static static-out] [--only "<deck name>"] [--out <file.tsv>]
 *
 *  EDHREC pages are cached under `.edhrec-cache/precon/` (gitignored), fetched one at a time with a
 *  pause, and never re-fetched while cached. No key, no model, no spend. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { preconDecklist, type Precon } from "../../packages/data/src/precons.js";
import { suggestForDeck } from "../../packages/matcher/src/suggest-static.js";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";
import { buildEngineModel } from "../../packages/web/client/src/lib/engine-model.js";
import { chooseCuts } from "../../packages/web/client/src/lib/cut-choice.js";

const arg = (name: string, fallback?: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const repo = resolve(import.meta.dirname, "..", "..");
const source = arg("--static", join(repo, "static-out"))!;
const only = arg("--only");
const outFile = arg("--out");
/** Per deck, our lists and theirs by name, for the guide comparison (`--dump <file.json>`). */
const dumpFile = arg("--dump");
const dump: Record<string, unknown> = {};
const baseUrl = "http://static.local";
const fetchImpl: typeof fetch = (async (input: string | URL | Request) => {
  const path = join(source, new URL(String(input)).pathname);
  return existsSync(path) ? new Response(readFileSync(path)) : new Response(null, { status: 404 });
}) as typeof fetch;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const cacheDir = join(repo, ".edhrec-cache", "precon");
mkdirSync(cacheDir, { recursive: true });
const SAFE = /^[a-z0-9-]{1,120}$/;
async function edhrec(path: string): Promise<unknown | null> {
  const file = join(cacheDir, `${path.replace(/[^a-z0-9-]/gi, "_")}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  await new Promise((r) => setTimeout(r, 1200));
  const res = await fetch(`https://json.edhrec.com/pages/${path}.json`, { headers: { "User-Agent": UA } });
  if (!res.ok) { writeFileSync(file, "null"); return null; }
  const json = await res.json();
  writeFileSync(file, JSON.stringify(json));
  return json;
}

interface CardView { name: string; num_decks?: number; potential_decks?: number; unpopularity?: number; url?: string; label?: string }
interface Page { header?: string; container?: { json_dict?: { cardlists?: { header: string; cardviews: CardView[] }[] } } }
const lists = (p: Page | null) => p?.container?.json_dict?.cardlists ?? [];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const front = (s: string) => norm(s.split(" // ")[0]!);

// THE EDHREC INDEX: one list per set, one card per deck, `label` = deck name, `url` = /precon/<slug>.
const index = lists(await edhrec("precon") as Page).flatMap((l) => l.cardviews.map((v) => ({ set: l.header, label: v.label ?? "", slug: (v.url ?? "").replace(/^\/precon\//, "") })));
function edhrecSlug(p: Precon): string | undefined {
  const named = index.filter((e) => norm(e.label) === norm(p.name) && SAFE.test(e.slug));
  if (named.length <= 1) return named[0]?.slug;
  // The same deck name in two products ("Evasive Maneuvers"): the set name decides.
  const set = norm(p.setName);
  return (named.find((e) => norm(e.set).includes(set) || set.includes(norm(e.set).replace(/^secret lair /, ""))) ?? named[0])?.slug;
}

const precons = (JSON.parse(readFileSync(join(repo, "packages", "data", "precons.json"), "utf8")) as Precon[])
  .filter((p) => !only || p.name === only);
const rows: string[] = [["deck", "set", "edhrec", "their_decks", "our_adds", "adds_in_their_top50", "mean_inclusion_of_our_adds", "their_top10_adds_we_offer", "our_cuts", "cuts_in_their_cut_list", "mean_unpopularity_of_our_cuts", "their_top5_cuts_we_offer", "our_swaps_in_hit", "our_swaps_out_hit"].join("\t")];
const pool = { decks: 0, adds: 0, addHits: 0, cuts: 0, cutHits: 0, top10: 0, top10Hit: 0, top5c: 0, top5cHit: 0, inc: [] as number[], unpop: [] as number[] };

for (const p of precons) {
  const slug = edhrecSlug(p);
  const page = slug ? await edhrec(`precon/${slug}`) as Page | null : null;
  const theirAdds = [...(lists(page).find((l) => l.header === "Cards to Add")?.cardviews ?? []), ...(lists(page).find((l) => l.header === "Lands to Add")?.cardviews ?? [])];
  const theirCuts = [...(lists(page).find((l) => l.header === "Cards to Cut")?.cardviews ?? []), ...(lists(page).find((l) => l.header === "Lands to Cut")?.cardviews ?? [])];
  if (!page || theirAdds.length === 0) { console.log(`-- ${p.name} (${p.setName}): no EDHREC precon page${slug ? ` at ${slug}` : ""}`); continue; }
  const potential = Math.max(0, ...theirAdds.map((v) => v.potential_decks ?? 0));
  const addRate = new Map(theirAdds.map((v) => [front(v.name), (v.num_decks ?? 0) / Math.max(1, v.potential_decks ?? potential)] as const));
  const addRank = new Map([...theirAdds].sort((a, b) => (b.num_decks ?? 0) - (a.num_decks ?? 0)).map((v, i) => [front(v.name), i] as const));
  const cutRate = new Map(theirCuts.map((v) => [front(v.name), v.unpopularity ?? 0] as const));
  const topCuts = [...theirCuts].sort((a, b) => (b.unpopularity ?? 0) - (a.unpopularity ?? 0)).slice(0, 5).map((v) => front(v.name));
  const top10 = [...addRank].filter(([, i]) => i < 10).map(([n]) => n);

  const data = await analyzeDeckStatic(preconDecklist(p), p.commanders.join("\n"), baseUrl, fetchImpl);
  const model = data.graph ? buildEngineModel(data.report, data.graph) : null;
  const cuts = chooseCuts(data.report, model && model.totalLinks ? model : null);
  const s = await suggestForDeck({ report: data.report, commanderColorIdentity: data.commanderColorIdentity, baseUrl, fetchImpl, cuts: cuts.map((c) => c.name) });
  // OUR ADDS, EVERY LIST THE REPORT SHOWS: the plan, the routes, the build and answer gaps, the unmet
  // demands and the cut-for-add pairs. One card counted once.
  const ourAdds = [...new Set([
    ...s.plan, ...s.routes, ...Object.values(s.build).flat(), ...Object.values(s.answers).flat(),
    ...Object.values(s.synergy).flat(), ...s.pairs.map((x) => x.add),
  ].map((c) => front(c.name)))];
  const ourCuts = [...new Set(cuts.map((c) => front(c.name)))];
  const swapsIn = s.pairs.map((x) => front(x.add.name));
  const swapsOut = s.pairs.map((x) => front(x.cut));

  dump[p.name] = {
    set: p.setName, slug,
    ourAdds, ourCuts, swapsIn, swapsOut,
    theirAdds: [...theirAdds].sort((a, b) => (b.num_decks ?? 0) - (a.num_decks ?? 0)).map((v) => ({ name: front(v.name), rate: addRate.get(front(v.name)) ?? 0 })),
    theirCuts: [...theirCuts].sort((a, b) => (b.unpopularity ?? 0) - (a.unpopularity ?? 0)).map((v) => ({ name: front(v.name), rate: v.unpopularity ?? 0 })),
  };
  const addHits = ourAdds.filter((n) => addRate.has(n));
  const cutHits = ourCuts.filter((n) => cutRate.has(n));
  const inc = ourAdds.map((n) => addRate.get(n) ?? 0);
  const unpop = ourCuts.map((n) => cutRate.get(n) ?? 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  pool.decks++; pool.adds += ourAdds.length; pool.addHits += addHits.length; pool.cuts += ourCuts.length; pool.cutHits += cutHits.length;
  pool.top10 += top10.length; pool.top10Hit += top10.filter((n) => ourAdds.includes(n)).length;
  pool.top5c += topCuts.length; pool.top5cHit += topCuts.filter((n) => ourCuts.includes(n)).length;
  pool.inc.push(...inc); pool.unpop.push(...unpop);
  rows.push([p.name, p.setName, slug, potential, ourAdds.length, addHits.length, mean(inc).toFixed(3),
    `${top10.filter((n) => ourAdds.includes(n)).length}/${top10.length}`, ourCuts.length, cutHits.length, mean(unpop).toFixed(3),
    `${topCuts.filter((n) => ourCuts.includes(n)).length}/${topCuts.length}`,
    `${swapsIn.filter((n) => addRate.has(n)).length}/${swapsIn.length}`, `${swapsOut.filter((n) => cutRate.has(n)).length}/${swapsOut.length}`].join("\t"));
  console.log(`${p.name}: adds ${addHits.length}/${ourAdds.length} in their list, top-10 ${top10.filter((n) => ourAdds.includes(n)).length}/${top10.length}; cuts ${cutHits.length}/${ourCuts.length} in their cut list, top-5 ${topCuts.filter((n) => ourCuts.includes(n)).length}/${topCuts.length}`);
}

const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
console.log(`\nPOOLED over ${pool.decks} precons with an EDHREC page:`);
console.log(`  our adds in their add lists: ${pool.addHits}/${pool.adds} (${pct(pool.addHits, pool.adds)}); mean inclusion of our adds ${mean(pool.inc).toFixed(3)}`);
console.log(`  their top-10 adds we offer anywhere: ${pool.top10Hit}/${pool.top10} (${pct(pool.top10Hit, pool.top10)})`);
console.log(`  our cuts in their cut lists: ${pool.cutHits}/${pool.cuts} (${pct(pool.cutHits, pool.cuts)}); mean unpopularity of our cuts ${mean(pool.unpop).toFixed(3)}`);
console.log(`  their top-5 cuts we name: ${pool.top5cHit}/${pool.top5c} (${pct(pool.top5cHit, pool.top5c)})`);
if (outFile) writeFileSync(outFile, `${rows.join("\n")}\n`);
if (dumpFile) writeFileSync(dumpFile, JSON.stringify(dump));
