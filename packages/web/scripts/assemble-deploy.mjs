/** Puts `static-out/` inside the built client as `/static`, which is where `StaticLookup` looks,
 *  and refuses to hand Cloudflare a deploy that cannot work.
 *
 *  WHY THIS IS NOT THE VITE CONFIG'S JOB. `publicDir` would do the copy, but Vite serves publicDir
 *  in dev too and re-copies the whole tree on every build; the dev path already has a middleware
 *  that serves `static-out/` in place, and a build should not depend on 98 MB having been copied
 *  into the client package. The dev server reads the artifacts where they are built; the deploy
 *  copies them once, here.
 *
 *  WHY THE ARTIFACTS ARE NOT BUILT IN CI. `build-static.ts` reads Mongo, which exists on the
 *  owner's machine and nowhere else — no GitHub Action and no Cloudflare build container can
 *  produce `static-out/`. That is the whole reason this deploys by direct upload from a laptop
 *  rather than from a git push, and it is a fact about the data plane, not a preference.
 *
 *  Usage: `npm run deploy -w @edh-seer/web` (see that script; this runs after the client build). */
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { serviceWorkerSource } from "./sw-template.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const staticOut = join(repoRoot, "static-out");
const dist = join(repoRoot, "packages/web/client/dist");
const target = join(dist, "static");

/** Cloudflare's free tier rejects a deployment over this, and it is why the corpus is sharded at
 *  all (`build-static-core.ts`). Checked as a count here rather than trusted: a build that quietly
 *  produced 20,001 files would otherwise fail in the upload, minutes later, against a message
 *  about the platform rather than about the artifacts. */
const FREE_TIER_FILE_CAP = 20_000;

if (!existsSync(staticOut)) {
  console.error(
    "static-out/ is missing. It is gitignored and built from Mongo — run:\n" +
      "  set -a && source packages/tagger/.env && set +a\n" +
      "  npx tsx packages/matcher/src/bin/build-static.ts",
  );
  process.exit(1);
}
if (!existsSync(join(dist, "index.html"))) {
  console.error("client/dist/index.html is missing — the client build did not run.");
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(staticOut, target, { recursive: true });

// `/how-it-works` IS SERVED, NOT REDIRECTED. Vite emits the second entry as
// `how-it-works/index.html`, and Pages answers the extensionless URL for a directory index with a
// 308 to the slash form -- so the canonical URL, the sitemap URL and every inbound link took a
// redirect on each visit (measured 2026-09-08). Pages serves `<name>.html` at `/<name>` directly and
// 308s `/<name>/` and `/<name>.html` back to it, which is the shape the canonical tag already
// states. Renamed here rather than in the Vite config because the config's input path is what
// gives the dev server the same URL, and the dev server has no such redirect to avoid.
const docsDir = join(dist, "how-it-works");
if (existsSync(join(docsDir, "index.html"))) {
  renameSync(join(docsDir, "index.html"), join(dist, "how-it-works.html"));
  rmSync(docsDir, { recursive: true, force: true });
}

// THE SERVICE WORKER IS WRITTEN HERE because only now do the shell's filenames exist: Vite content-
// hashes its output, so the precache list cannot be typed into a file checked into `public/`. The
// worker's own cache name is derived from that same list, which makes a deploy that changed nothing
// reuse the cache and a deploy that changed the bundle drop it.
// EVERYTHING THE APP IS, MINUS ITS DATA. The 99 MB of card shards under `static/` are cached on
// demand as decks are analysed; the shell is small enough to take whole (~700 KB) and is what makes
// a cold offline start work at all.
//
// `_headers` is Cloudflare's own config and is never served. `sw.js` must not precache ITSELF: the
// worker is the thing that decides what everything else may serve, so a cached copy is the one
// failure that cannot fix itself on the next load.
// `sitemap.xml` IS EXCLUDED FOR THE SAME REASON `static/` IS: it is ~900 KB of URLs written for
// crawlers, and no reader offline or online ever opens it. Precaching it would more than double the
// shell a cold start pays for, to cache a file the app itself never reads.
const shellFiles = (dir, prefix = "") => readdirSync(dir).flatMap((entry) => {
  if (prefix === "" && (entry === "static" || entry === "sw.js" || entry === "_headers"
    || entry === "sitemap.xml")) return [];
  const path = join(dir, entry);
  return statSync(path).isDirectory()
    ? shellFiles(path, `${prefix}/${entry}`)
    : [`${prefix}/${entry}`];
});
// AND THE DATA MANIFEST, which lives under `static/` but is not data: it names the version
// directory every card URL hangs off, so a client that cannot read it falls back to a layout the
// build no longer writes. Measured offline before this line existed: the fallback turned one
// missing 30-byte file into 91 failed shard requests and an unanalysable deck, with every shard
// still sitting correctly in the cache beside it.
const shell = [...shellFiles(dist), "/static/manifest.json"];
if (!shell.includes("/index.html") || !shell.some((f) => f.startsWith("/assets/"))) {
  console.error("no built shell found — refusing to write a service worker that precaches nothing.");
  process.exit(1);
}
const swVersion = createHash("sha256").update(shell.join("\n")).digest("hex").slice(0, 12);
writeFileSync(join(dist, "sw.js"), serviceWorkerSource({ version: swVersion, shell }));
console.log(`service worker: precaches ${shell.length} shell files (${shell.filter((f) => !f.startsWith("/assets/")).join(", ")}), cache edh-seer-shell-${swVersion}`);

// THE SITEMAP IS GENERATED, NOT WRITTEN BY HAND. Two URLs were fine to maintain; 17,775 are not,
// and a hand-written one drifts from the artifact the moment the corpus grows -- into promising
// pages that 404, which is worse than having no sitemap at all.
//
// THE ORIGIN COMES FROM THE CANONICAL TAG, not from a constant here. `seo.test.ts` derives it the
// same way on purpose, so the day a custom domain replaces this one it is changed in `index.html`
// and nowhere else. A second copy in this file would be the one nobody remembers to edit.
//
// LISTS ONLY WHAT THE ARTIFACT HOLDS. `name-index.json` is every SUBSTANTIVE card -- one with at
// least one emit or one trigger -- so a card the engine has never read is not promised a page here.
// The index lives under the version directory, which `manifest.json` names.
//
// AND ONLY WHAT THE SITE WILL LET BE INDEXED. A card page below the partner floor
// (`MIN_INDEXABLE_PARTNERS`, three since 2026-09-08) is served `<meta name="robots"
// content="noindex">` at the edge (spec D5, `render.ts`), and a sitemap that submits a page the
// site then refuses to have indexed is a Search Console error per URL. Measured on the deployed
// artifact 2026-09-08 with the floor at zero: 1,779 card and 1,044 commander URLs -- 2,823 of
// 20,161, 14% of this file -- were exactly that. `thin` / `thinCommander` come off the same shard
// record the edge reads, so the two cannot drift.
const canonical = /<link rel="canonical" href="([^"]+)"/.exec(readFileSync(join(dist, "index.html"), "utf8"))?.[1];
if (!canonical) {
  console.error("no canonical link in index.html — refusing to write a sitemap with a guessed origin.");
  process.exit(1);
}
const origin = canonical.replace(/\/$/, "");
const version = JSON.parse(readFileSync(join(target, "manifest.json"), "utf8")).version;
const nameIndex = JSON.parse(readFileSync(join(target, version, "name-index.json"), "utf8"));
const indexableCards = nameIndex.filter((e) => !e.thin);
const indexableCommanders = nameIndex.filter((e) => e.commander && !e.thinCommander);
// THE BROWSE PAGES, WHICH ARE THE ONLY ROUTE FROM THIS SITE INTO THE CARD PAGES. `/cards` and
// `/commanders` were not listed here at all until 2026-09-08 -- two real pages the sitemap never
// mentioned -- and the letter pages under them did not exist. Read off the artifact rather than
// generated from a hard-coded alphabet, so a letter with no file cannot be promised a page.
//
// AND AN EMPTY LETTER IS NOT PROMISED, the same rule the thin card pages are held to since #245:
// the page renders, carries the alphabet and stays walkable, but it is served `noindex` and so must
// not be submitted. The commander side empties letters the card side fills, so the two are counted
// separately off the slices themselves rather than from the file list.
const browseRows = readdirSync(join(target, version, "browse"))
  .filter((f) => f.endsWith(".json")).sort()
  .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(target, version, "browse", f), "utf8"))]);
const browseCardLetters = browseRows.filter(([, r]) => r.length > 0).map(([l]) => l);
const browseCommanderLetters = browseRows.filter(([, r]) => r.some((e) => e.commander)).map(([l]) => l);
const sitemapUrls = [
  `${origin}/`,
  `${origin}/how-it-works`,
  `${origin}/cards`,
  `${origin}/commanders`,
  ...browseCardLetters.map((l) => `${origin}/browse/cards/${l}`),
  ...browseCommanderLetters.map((l) => `${origin}/browse/commanders/${l}`),
  ...indexableCards.map((e) => `${origin}/cards/${e.slug}`),
  ...indexableCommanders.map((e) => `${origin}/commanders/${e.slug}`),
];
const expectedUrls = 4 + browseCardLetters.length + browseCommanderLetters.length
  + indexableCards.length + indexableCommanders.length;
// ASSERTED HERE RATHER THAN TRUSTED: a half-built artifact should fail the deploy, not publish a
// sitemap full of URLs with nothing behind them.
if (sitemapUrls.length !== expectedUrls) {
  console.error(`sitemap: built ${sitemapUrls.length} URLs, expected ${expectedUrls}`);
  process.exit(1);
}
writeFileSync(
  join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + sitemapUrls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")
  + `\n</urlset>\n`,
);
console.log(`sitemap: ${sitemapUrls.length} URLs (${indexableCards.length} cards, `
  + `${indexableCommanders.length} commanders, `
  + `${browseCardLetters.length + browseCommanderLetters.length} browse; `
  + `${nameIndex.length - indexableCards.length} + `
  + `${nameIndex.filter((e) => e.commander).length - indexableCommanders.length} withheld as noindex)`);

const countFiles = (dir) =>
  readdirSync(dir).reduce(
    (n, e) => n + (statSync(join(dir, e)).isDirectory() ? countFiles(join(dir, e)) : 1),
    0,
  );
const files = countFiles(dist);
const bytes = (function size(dir) {
  return readdirSync(dir).reduce((n, e) => {
    const p = join(dir, e);
    const s = statSync(p);
    return n + (s.isDirectory() ? size(p) : s.size);
  }, 0);
})(dist);

console.log(`deploy directory: ${dist}`);
console.log(`files: ${files} (cap ${FREE_TIER_FILE_CAP})`);
console.log(`bytes: ${(bytes / 1024 / 1024).toFixed(1)} MB`);

if (files > FREE_TIER_FILE_CAP) {
  console.error(
    `\n${files} files exceeds Cloudflare's free-tier cap of ${FREE_TIER_FILE_CAP}. ` +
      "Lower SHARD_COUNT in packages/matcher/src/bin/build-static-core.ts and rebuild the artifacts.",
  );
  process.exit(1);
}
