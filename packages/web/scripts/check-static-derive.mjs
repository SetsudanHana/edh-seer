/** `static-out/` MUST BE BUILT AT THE SOURCE'S DERIVE_VERSION (#1264 review). `build-static` stamps `deriveVersion` into
 *  `manifest.json`; this compares it with the constant in `derive.ts`, read as TEXT (plain node: no TS loader, no Mongo, no network).
 *  Run first by `npm run deploy` (before the ~16 min precon build) and again by `assemble-deploy.mjs`: one module, two callers. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const DERIVE_SOURCE = "packages/tagger/src/derive/derive.ts";

/** The number in `export const DERIVE_VERSION = N;`, or undefined when the line has another shape. */
export function parseDeriveVersion(source) {
  const m = /^export const DERIVE_VERSION = (\d+);/m.exec(source);
  return m ? Number(m[1]) : undefined;
}

/** A refusal message, or null when static-out matches the source. */
export function staticDeriveProblem(repoRoot) {
  const current = parseDeriveVersion(readFileSync(join(repoRoot, DERIVE_SOURCE), "utf8"));
  if (current === undefined) return `could not parse DERIVE_VERSION from ${DERIVE_SOURCE}`;
  const manifest = join(repoRoot, "static-out", "manifest.json");
  if (!existsSync(manifest)) return "static-out/manifest.json is missing: build static-out first (npx tsx packages/matcher/src/bin/build-static.ts)";
  const built = JSON.parse(readFileSync(manifest, "utf8")).deriveVersion;
  if (built === current) return null;
  return `static-out/ was built at DERIVE_VERSION ${built ?? "(not recorded)"}, the source is at ${current}. Rebuild it:\n`
    + "  npx tsx packages/tagger/src/bin/derive-corpus.ts --force\n  npx tsx packages/matcher/src/bin/build-static.ts";
}

/** The search pointer in `manifest.json` must name a built catalogue stamped with the manifest's own version and
 *  deriveVersion (#1781). NOT run at the top of `npm run deploy`: `build:search` has not run there yet. Called by
 *  `assemble-deploy.mjs`, after the builds. A refusal message, or null. */
export function staticSearchProblem(repoRoot) {
  const manifestPath = join(repoRoot, "static-out", "manifest.json");
  if (!existsSync(manifestPath)) return "static-out/manifest.json is missing: build static-out first (npx tsx packages/matcher/src/bin/build-static.ts)";
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const fix = "\n  npm run build:search -w @edh-seer/web";
  if (!manifest.search) return `manifest.json has no \`search\` pointer: the search artifact was not built.${fix}`;
  const dir = join(repoRoot, "static-out", String(manifest.version), "search", String(manifest.search));
  if (!existsSync(dir)) return `manifest.json points search at ${manifest.search}, but ${dir} does not exist.${fix}`;
  const cataloguePath = join(dir, "catalogue.json");
  if (!existsSync(cataloguePath)) return `${manifest.search} has no catalogue.json.${fix}`;
  const catalogue = JSON.parse(readFileSync(cataloguePath, "utf8"));
  if (catalogue.version !== manifest.version) return `search catalogue is stamped version ${catalogue.version}, the manifest says ${manifest.version}.${fix}`;
  if (catalogue.deriveVersion !== manifest.deriveVersion) return `search catalogue is stamped deriveVersion ${catalogue.deriveVersion}, the manifest says ${manifest.deriveVersion}.${fix}`;
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problem = staticDeriveProblem(fileURLToPath(new URL("../../../", import.meta.url)));
  if (problem) { console.error(problem); process.exit(1); }
}
