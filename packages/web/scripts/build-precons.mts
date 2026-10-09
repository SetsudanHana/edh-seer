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
 *  pages against a deployed corpus. An explicit `--out` writes the files flat into that directory and
 *  nothing else.
 *
 *  THE PAGES' URL IS THEIR BYTES (#1121). Locally they are built into `<version>/precons/.staging`,
 *  and a clean run renames that to `<version>/precons/p-<hash of the output>`, which `manifest.json`
 *  names as `precons`. `<version>` hashes the DATA, so an engine-only change rebuilds the pages
 *  under the same version, and `/static/v-*` is served immutable for a year and cached first by the
 *  service worker: a fixed URL would keep the old bytes in every returning browser. Same principle
 *  as the shards; the manifest is the one revalidated file. The build stamp only decides whether to
 *  rebuild. A failed or `--only` run promotes nothing and leaves the manifest as it was: on the last
 *  good directory if one exists, but `build-static` wipes `static-out` (and rewrites the manifest as
 *  `{version}`), so straight after it there is none. A local failure therefore exits non-zero, so the
 *  `npm run deploy` chain stops rather than shipping a site with no precon pages. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { preconDecklist, type Precon } from "@edh-seer/data/precons";
import { slugOf } from "@edh-seer/matcher/slug";
import { suggestForDeck } from "@edh-seer/matcher/suggest-static";
import { analyzeDeckStatic, readDeckStatic } from "../client/src/api.static.ts";
import { buildEngineModel } from "../client/src/lib/engine-model.ts";
import { chooseCuts, swapCandidates } from "../client/src/lib/cut-choice.ts";
import { gapsOf, preconPage, type PreconPage } from "../client/src/lib/precon-page.ts";
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
const explicitOut = arg("--out");
const preconsRoot = join(source, version, "precons");
const stagingDir = join(preconsRoot, ".staging");
const outDir = explicitOut ?? stagingDir;
const manifestPath = join(source, "manifest.json");
/** Point the manifest at a precon directory, keeping every other key (`build-static` writes `{version}` only). */
const pointManifest = (dir: string) => {
  const m = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  writeFileSync(manifestPath, JSON.stringify({ ...m, precons: dir }));
};

// SKIP WHEN NOTHING THE PAGES READ HAS CHANGED (P5, docs/plans/2026-10-04-precon-build-time.md): a
// UI-only deploy used to pay the whole ~16-minute build. The manifest version covers the DATA but
// not the code (a matcher-only change keeps it), so the stamp is the version plus every file this
// script imports, found by esbuild's import graph rather than a hand list that would go stale. The
// pages' code runs in a browser, so every input is an import; precons.json is read by fs and the
// lockfile pins the dependencies. A failed precon writes no stamp, so the next run retries.
const stampPath = join(explicitOut ?? preconsRoot, "build-stamp.json");
const inputs = Object.keys((await build({
  entryPoints: [fileURLToPath(import.meta.url)], bundle: true, write: false, metafile: true,
  platform: "node", format: "esm", logLevel: "silent", absWorkingDir: repo,
})).metafile.inputs).filter((p) => !p.includes("node_modules")).concat(relative(repo, preconsPath), "package-lock.json").sort();
const hash = createHash("sha256").update(version);
for (const p of inputs) hash.update(p).update(readFileSync(join(repo, p)));
const stamp = hash.digest("hex");
if (!onlyIdx && !process.argv.includes("--force") && existsSync(stampPath)) {
  const saved = JSON.parse(readFileSync(stampPath, "utf8")) as { stamp?: string; dir?: string };
  const dir = explicitOut ? "" : saved.dir;
  const index = explicitOut ? join(explicitOut, "index.json") : dir && join(preconsRoot, dir, "index.json");
  if (saved.stamp === stamp && (explicitOut || dir) && index && existsSync(index)) {
    // The manifest may have been rewritten without wiping this directory (by hand): put the pointer
    // back. After `build-static` the directory and the stamp are gone too, so this path is not taken.
    if (dir) pointManifest(dir);
    console.log(`precon pages in ${explicitOut ?? join(preconsRoot, dir!)} are current (${inputs.length} inputs unchanged): skipped, --force to rebuild`);
    process.exit(0);
  }
}
rmSync(stampPath, { force: true }); // a run that dies, or an `--only` one, leaves no stamp to trust
if (!explicitOut) rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// ONE LOOKUP FOR EVERY PRECON'S UPGRADE PACKAGES: their candidate pools overlap almost entirely, so
// each card shard is read once for the whole build.
const packageLookup = new StaticLookup(baseUrl, fetchImpl);
const precons = (JSON.parse(readFileSync(preconsPath, "utf8")) as Precon[]).filter((p) => !onlyIdx || p.name === onlyIdx);
const pagedIndex = await packageLookup.nameIndex();
const paged = { names: new Set(pagedIndex.map((e) => e.name)), slugs: new Set(pagedIndex.map((e) => e.slug)) };
if (paged.names.size === 0) throw new Error("name-index.json is empty: every card would read as having no page");
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
        // WITHOUT THE MANA SIMULATION OR THE GRAPH (P1): none of the three numbers reads them, and
        // they were about half of every one of the ~36 readings a precon takes.
        const r = await readDeckStatic(list, p.commanders.join("\n"), baseUrl, fetchImpl);
        return { band: r.bracket?.band ?? "1-2", mana: r.deckMath?.lands.manaBase?.total ?? 0, synergy: r.synergyOverall ?? 0, build: r.buildScore ?? 0, short: gapsOf(r) };
      },
    });
    page.packages = pk.packages;
    if (pk.unreachable.length) page.unreachable = pk.unreachable;
    page.packageCards = pk.cards;
    // NO LINK TO A PAGE THAT DOES NOT EXIST (#1003 review): only a substantive card has one, so a
    // basic, a shock land or Command Tower is named as text. Checked by name and by slug, as a
    // double-faced card is indexed by its whole name.
    const named = [...p.cards.map((c) => c.name), ...Object.keys(pk.cards), ...page.swaps.flatMap((w) => [w.out.name, w.in.name]), ...(page.route ? [page.route.name] : [])];
    const unpaged = [...new Set(named)].filter((n) => !paged.names.has(n) && !paged.slugs.has(pk.cards[n]?.slug ?? slugOf(n))).sort();
    if (unpaged.length) page.unpaged = unpaged;
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
if (explicitOut) {
  if (!onlyIdx && !failed) writeFileSync(stampPath, JSON.stringify({ stamp }));
  console.log(`${index.length} precon pages in ${outDir}${failed ? `, ${failed} failed` : ""}`);
} else if (failed || onlyIdx) {
  // NOT PROMOTED: the manifest keeps pointing at the last good directory, which is left alone.
  console.log(`${index.length} precon pages in ${outDir}${failed ? `, ${failed} failed` : ""}: staging kept for inspection, manifest and live pages untouched`);
  if (failed) {
    console.error(`${failed} precon page(s) failed: nothing promoted, and with no earlier build the site would ship without precon pages. Exiting non-zero.`);
    process.exitCode = 1;
  }
} else {
  // NAME THEN BYTES, SORTED (as `build-static` hashes its shards), so two files swapping contents is a different directory.
  const h = createHash("sha256");
  for (const f of readdirSync(stagingDir).sort()) h.update(f).update(readFileSync(join(stagingDir, f)));
  const dir = `p-${h.digest("hex").slice(0, 12)}`;
  rmSync(join(preconsRoot, dir), { recursive: true, force: true });
  renameSync(stagingDir, join(preconsRoot, dir));
  // ONE DIRECTORY SURVIVES: the previous flat layout's files and older `p-*` directories go.
  for (const e of readdirSync(preconsRoot)) if (e !== dir && e !== "build-stamp.json") rmSync(join(preconsRoot, e), { recursive: true, force: true });
  writeFileSync(stampPath, JSON.stringify({ stamp, dir }));
  pointManifest(dir);
  console.log(`${index.length} precon pages in ${join(preconsRoot, dir)}, manifest points at ${dir}`);
}
