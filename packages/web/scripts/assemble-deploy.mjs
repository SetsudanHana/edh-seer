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
    // EVERY sitemap file, not just the one: the index gained `sitemap-core`, `-commanders` and
    // `-cards` children (AI5), and a prefix match is what stops the next one being precached by
    // whoever adds it. They are written after this runs, so this is belt and braces -- which is the
    // right amount for a rule whose failure is silently doubling the offline shell.
    || entry.startsWith("sitemap"))) return [];
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
// THE ROWS OUT OF THE FILE, WHICH IS AN OBJECT SINCE 2026-09-21. It was the bare array until the
// type and subtype tables had to ship beside the rows. This reader is BUILD TIME and reads an
// artifact the same tree just produced, so it takes the new shape only -- the browser's reader
// (`static-lookup.ts`) is the one that must also accept a stale cached array.
const nameIndexFile = JSON.parse(readFileSync(join(target, version, "name-index.json"), "utf8"));
const nameIndex = nameIndexFile.cards;
if (!Array.isArray(nameIndex)) {
  console.error(
    "name-index.json has no `cards` array — the artifact in static-out/ predates the 2026-09-21 " +
    "format. Rebuild it: npx tsx packages/matcher/src/bin/build-static.ts",
  );
  process.exit(1);
}
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
// ORDERED BY PARTNER COUNT, AND THAT IS THE WHOLE POINT OF THE SPLIT BELOW (AI5). Search Console
// 2026-09-16: 23,754 URLs "Discovered, currently not indexed", 5 indexed, ~10 crawl requests a day
// and falling. Nothing here raises that number -- it is demand, not a technical block -- but it
// decides WHERE those ten land, and alphabetical order spent them on `/browse/cards/a` and the
// cards whose names start with A. `partners` is the symmetric candidate degree the artifact already
// carries, so the page with the most to say is offered first.
const byPartners = (a, b) => (b.partners ?? 0) - (a.partners ?? 0) || a.slug.localeCompare(b.slug);
const coreUrls = [
  `${origin}/`,
  `${origin}/how-it-works`,
  `${origin}/cards`,
  `${origin}/commanders`,
  ...browseCardLetters.map((l) => `${origin}/browse/cards/${l}`),
  ...browseCommanderLetters.map((l) => `${origin}/browse/commanders/${l}`),
];
const commanderUrls = [...indexableCommanders].sort(byPartners).map((e) => `${origin}/commanders/${e.slug}`);
const cardUrls = [...indexableCards].sort(byPartners).map((e) => `${origin}/cards/${e.slug}`);
const sitemapUrls = [...coreUrls, ...commanderUrls, ...cardUrls];
const expectedUrls = 4 + browseCardLetters.length + browseCommanderLetters.length
  + indexableCards.length + indexableCommanders.length;
// ASSERTED HERE RATHER THAN TRUSTED: a half-built artifact should fail the deploy, not publish a
// sitemap full of URLs with nothing behind them.
if (sitemapUrls.length !== expectedUrls) {
  console.error(`sitemap: built ${sitemapUrls.length} URLs, expected ${expectedUrls}`);
  process.exit(1);
}
// THREE FILES BEHIND ONE INDEX, and it is a measurement instrument rather than a size fix: 24,921
// URLs fit one file twice over (the protocol's limit is 50,000). Search Console reports coverage
// PER SUBMITTED SITEMAP, so a single file can only ever answer "5 indexed of 24,921" -- it cannot
// say whether commanders index better than cards, which is exactly the question AI7 re-measures on
// 2026-10-01. Split, that answer is read straight off the Sitemaps report.
//
// `lastmod` IS ON THE INDEX AND NOT ON THE URLS, and the distinction is the honest one. In a sitemap
// index `lastmod` means "when this sitemap FILE changed", which is true: it was just written. On a
// `<url>` it means the PAGE changed, and this build cannot know that -- the artifact is regenerated
// wholesale, so Sol Ring's page is usually byte-identical across two builds. Stamping every URL with
// the build time would be a claim that everything changed every deploy, which Google discounts on
// exactly the sites that do it. A real per-URL date needs a per-slug content hash carried between
// builds; that is a bigger machine than the signal is worth today.
const lastmod = new Date().toISOString().slice(0, 10);
const urlset = (urls) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")
  + `\n</urlset>\n`;
const children = [
  ["sitemap-core.xml", coreUrls],
  ["sitemap-commanders.xml", commanderUrls],
  ["sitemap-cards.xml", cardUrls],
];
for (const [file, urls] of children) writeFileSync(join(dist, file), urlset(urls));
writeFileSync(
  join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + children.map(([file]) =>
    `  <sitemap><loc>${origin}/${file}</loc><lastmod>${lastmod}</lastmod></sitemap>`).join("\n")
  + `\n</sitemapindex>\n`,
);
console.log(`sitemap: index + ${children.length} children, ${sitemapUrls.length} URLs (${indexableCards.length} cards, `
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
