/** TELL BING, DUCKDUCKGO AND YANDEX WHAT CHANGED (roadmap AI4).
 *
 *  SCOPE IT HONESTLY: **Google ignores IndexNow.** Search Console 2026-09-16 shows 23,754 URLs
 *  "Discovered, currently not indexed" against 5 indexed, and that bucket is Google's -- nothing
 *  here touches it. What this does reach is every other engine that implements the protocol, which
 *  between them crawl the 21,790 card pages this site has never had visited.
 *
 *  THE KEY IS PUBLIC BY DESIGN. IndexNow authenticates by asking the site to serve the key back at
 *  `https://<host>/<key>.txt`, so the key file is checked into `client/public/` like any other
 *  asset. It is not a secret and must not be handled as one -- a key nobody can fetch fails the
 *  protocol's only check.
 *
 *  READS THE SITEMAP, NOT THE ARTIFACT. `assemble-deploy.mjs` has already decided what may be
 *  indexed -- the partner floor, the thin pages, the empty browse letters -- and re-deriving that
 *  here would be a second copy of a rule that has already drifted once.
 *
 *    node scripts/indexnow.mjs            # after a deploy, from packages/web
 *    node scripts/indexnow.mjs --dry-run  # print what would be submitted
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "client", "dist");
const publicDir = join(import.meta.dirname, "..", "client", "public");
const dryRun = process.argv.includes("--dry-run");

const indexPath = join(dist, "sitemap.xml");
if (!existsSync(indexPath)) {
  console.error("no sitemap.xml in client/dist — run the build before submitting.");
  process.exit(1);
}

/** The key file is whatever 32-hex `.txt` sits in `public/`. Found rather than configured: two
 *  places to write the same key is how a key file and a submission stop agreeing.
 *
 *  EXACTLY ONE, AND THAT IS THE HALF A GATE CANNOT COVER. `cache-headers.test.ts` already fails the
 *  build for a key file with no rule in `_headers`, so a rotation that forgets the header is caught
 *  there. What it cannot see is TWO keys present at once mid-rotation, where `readdirSync` order
 *  decides which one gets submitted -- silently, and differently per machine. Refused here instead. */
const keyFiles = readdirSync(publicDir).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (keyFiles.length === 0) {
  console.error("no IndexNow key file in client/public/ — expected a 32-hex <key>.txt.");
  process.exit(1);
}
if (keyFiles.length > 1) {
  console.error(`${keyFiles.length} IndexNow key files in client/public/ (${keyFiles.join(", ")}) — `
    + "which one is live cannot be decided by directory order. Delete the retired key.");
  process.exit(1);
}
const [keyFile] = keyFiles;
const key = keyFile.replace(/\.txt$/, "");
if (readFileSync(join(publicDir, keyFile), "utf8").trim() !== key) {
  console.error(`${keyFile} must contain exactly its own key — that is the protocol's only check.`);
  process.exit(1);
}

const childUrls = [...readFileSync(indexPath, "utf8").matchAll(/<sitemap><loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const urls = childUrls.flatMap((u) => {
  const file = join(dist, new URL(u).pathname.slice(1));
  return [...readFileSync(file, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
});
if (urls.length === 0) {
  console.error("sitemap produced no URLs — refusing to submit an empty list.");
  process.exit(1);
}
const host = new URL(urls[0]).host;

// 10,000 URLs per request is the protocol's cap.
const BATCH = 10000;
const batches = [];
for (let i = 0; i < urls.length; i += BATCH) batches.push(urls.slice(i, i + BATCH));
console.log(`indexnow: ${urls.length} URLs for ${host} in ${batches.length} batch(es), key ${key.slice(0, 8)}…`);
if (dryRun) {
  console.log(`indexnow: dry run — first URL ${urls[0]}, last ${urls[urls.length - 1]}`);
  process.exit(0);
}

let failed = 0;
for (const [i, urlList] of batches.entries()) {
  // A TRANSPORT FAILURE IS THE SAME OUTCOME AS A REFUSAL, and until this caught it the two were
  // not: an HTTP 4xx was logged and survived while a DNS failure threw an unhandled rejection and
  // killed the run mid-batch -- the exact opposite of what the note at the bottom of this file
  // promises. Caught per batch, so one dropped connection does not abandon the batches after it.
  let line;
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation: `https://${host}/${keyFile}`, urlList }),
    });
    // 200 accepted, 202 accepted but the key is still being verified. Both are fine.
    const ok = res.status === 200 || res.status === 202;
    if (!ok) failed++;
    line = `${res.status}${ok ? "" : ` ${(await res.text()).slice(0, 200)}`}`;
  } catch (err) {
    failed++;
    line = `network error: ${err instanceof Error ? err.message : String(err)}`;
  }
  console.log(`indexnow: batch ${i + 1}/${batches.length} (${urlList.length} URLs) -> ${line}`);
}
// A REPORTED FAILURE, NOT A FAILED DEPLOY. The site is already live by the time this runs; a search
// engine declining a ping is not a reason to fail the command that shipped it.
if (failed > 0) console.error(`indexnow: ${failed} batch(es) were not accepted — the deploy itself is unaffected.`);
