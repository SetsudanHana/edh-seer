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
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
