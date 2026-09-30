/** Writes one page file per Commander precon, plus an index, for `/precons/<slug>` (Precon mockup,
 *  2026-09-27). Each page is the precon's own report, cut down to what the page shows
 *  (`lib/precon-page.ts`), computed by the SAME code the report runs in a browser: the analysis,
 *  the page's cut list and the suggestions made against it.
 *
 *  Run after `build-static` (it reads the card shards it wrote) and before `assemble-deploy`:
 *
 *    npx tsx packages/web/scripts/build-precons.mts [--static static-out] [--precons packages/data/precons.json]
 *
 *  `--static` may also be a URL (`https://edhseer.cards/static`) with `--out <dir>`, to try the
 *  pages against a deployed corpus. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { preconDecklist, type Precon } from "@edh-seer/data/precons";
import { slugOf } from "@edh-seer/matcher/slug";
import { suggestForDeck } from "@edh-seer/matcher/suggest-static";
import { analyzeDeckStatic } from "../client/src/api.static.ts";
import { buildEngineModel } from "../client/src/lib/engine-model.ts";
import { chooseCuts, swapCandidates } from "../client/src/lib/cut-choice.ts";
import { preconPage, type PreconPage } from "../client/src/lib/precon-page.ts";
import { encodeShare, shareUrl } from "../client/src/lib/share-link.ts";
import { preconPackages } from "../client/src/lib/precon-packages.ts";
import { StaticLookup } from "@edh-seer/matcher/static-lookup";

const arg = (name: string, fallback?: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const repo = resolve(import.meta.dirname, "..", "..", "..");
const source = arg("--static", join(repo, "static-out"))!;
const preconsPath = arg("--precons", join(repo, "packages", "data", "precons.json"))!;
const onlyIdx = arg("--only");

// A DIRECTORY IS SERVED AS IF IT WERE THE SITE: the same URLs `StaticLookup` asks a host for.
const remote = /^https?:\/\//.test(source);
const baseUrl = remote ? source.replace(/\/$/, "") : "http://static.local";
const fetchImpl: typeof fetch = remote ? fetch : (async (input: string | URL | Request) => {
  const path = join(source, new URL(String(input)).pathname);
  if (!existsSync(path)) return new Response("not found", { status: 404 });
  return new Response(readFileSync(path), { headers: { "content-type": "application/json" } });
}) as typeof fetch;

const version = (await (await fetchImpl(`${baseUrl}/manifest.json`)).json() as { version: string }).version;
const outDir = arg("--out") ?? join(source, version, "precons");
mkdirSync(outDir, { recursive: true });

// ONE LOOKUP FOR EVERY PRECON'S UPGRADE PACKAGES: their candidate pools overlap almost entirely, so
// each card shard is read once for the whole build.
const packageLookup = new StaticLookup(baseUrl, fetchImpl);
const precons = (JSON.parse(readFileSync(preconsPath, "utf8")) as Precon[]).filter((p) => !onlyIdx || p.name === onlyIdx);
const taken = new Set<string>();
const index: Pick<PreconPage, "slug" | "name" | "setCode" | "setName" | "releaseDate" | "commanders" | "identity" | "theme">[] = [];
let failed = 0;
for (const p of precons) {
  // THE SET IN THE SLUG: a deck name is reprinted across products ("Draconic Domination").
  let slug = slugOf(`${p.name} ${p.setName}`);
  for (let n = 2; taken.has(slug); n++) slug = `${slugOf(`${p.name} ${p.setName}`)}-${n}`;
  taken.add(slug);
  try {
    const data = await analyzeDeckStatic(preconDecklist(p), p.commanders.join("\n"), baseUrl, fetchImpl);
    const model = data.graph ? buildEngineModel(data.report, data.graph) : null;
    const cuts = chooseCuts(data.report, model && model.totalLinks ? model : null);
    const suggestions = await suggestForDeck({
      report: data.report, commanderColorIdentity: data.commanderColorIdentity, baseUrl, fetchImpl,
      cuts: [...cuts.map((c) => c.name), ...swapCandidates(data.report, cuts)],
    });
    const page = preconPage({ slug, name: p.name, setCode: p.setCode, setName: p.setName, releaseDate: p.releaseDate, commanders: p.commanders }, data, suggestions);
    const pk = await preconPackages({
      lookup: packageLookup, commanders: p.commanders, deckNames: [...p.commanders, ...p.cards.map((c) => c.name)],
      data, model: model && model.totalLinks ? model : null, suggestions, cards: p.cards,
      // THE REPORT'S OWN READING OF THE SWAPPED LIST, so a package is held to the numbers the site
      // would show for it, not to the builder's estimate of them.
      analyse: async (list) => {
        const r = (await analyzeDeckStatic(list, p.commanders.join("\n"), baseUrl, fetchImpl)).report;
        return { band: r.bracket?.band ?? "1-2", mana: r.deckMath?.lands.manaBase?.total ?? 0, synergy: r.synergyOverall ?? 0 };
      },
    });
    page.packages = pk.packages;
    if (pk.unreachable.length) page.unreachable = pk.unreachable;
    page.packageCards = pk.cards;
    // THE FULL REPORT IS ONE LINK AWAY, the same link "Copy link" makes, so it opens the list ready to edit.
    const payload = await encodeShare({ commanders: p.commanders.join("\n"), decklist: p.cards.map((c) => `${c.count} ${c.name}`).join("\n") });
    if (payload) page.report = shareUrl("", "/", payload);
    writeFileSync(join(outDir, `${slug}.json`), JSON.stringify(page));
    index.push({ slug, name: p.name, setCode: p.setCode, setName: p.setName, releaseDate: p.releaseDate, commanders: p.commanders, identity: page.identity, theme: page.theme });
    // A NAME THAT DID NOT RESOLVE IS A CARD THE PAGE SILENTLY LACKS (a meld card listed with its
    // back did, 2026-09-27): said on every line, so the log shows it.
    const counts = pk.packages.map((k) => `${k.target}:${k.bringDown.length + k.sections.reduce((n, x) => n + x.swaps.length, 0)}`).join(" ");
    console.log(`${slug}: ${page.swaps.length} swaps, packages ${counts}${pk.unreachable.length ? ` (unreachable ${pk.unreachable.join(",")})` : ""}, synergy ${page.synergy?.score.toFixed(1) ?? "-"}${data.missing.length ? ` | UNRESOLVED ${data.missing.join("; ")}` : ""}`);
  } catch (err) {
    failed++;
    console.warn(`${slug}: failed`, err);
  }
}
writeFileSync(join(outDir, "index.json"), JSON.stringify(index));
console.log(`${index.length} precon pages in ${outDir}${failed ? `, ${failed} failed` : ""}`);
