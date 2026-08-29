import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test } from "vitest";

/** DOES THE ANALYSIS ENGINE BUNDLE FOR A BROWSER? — the ratchet for roadmap P2.
 *
 *  Static-first hosting means `analyzeDeckStructured` runs in the client, so every module on its
 *  graph has to survive a browser bundle. This asks esbuild directly, which is the only thing that
 *  actually answers it: a green `tsc` does NOT, and stopped being evidence entirely on 2026-08-29
 *  when `"node"` went into `web/client`'s `types` to clear 32 errors that said nothing about this
 *  repo. Reading imports does not answer it either — `edges.ts` is one of the modules that used to
 *  pull the Node-side barrel and it does NOT appear in a plain `grep`, only in `grep -a`.
 *
 *  AN EXACT SET, NOT A CAP, and it fails in BOTH directions on purpose — the same shape as
 *  `KNOWN_DEFECT_CAP`. A new entry means someone put a Node builtin back on the analysis path and
 *  the static build got bigger. A missing entry means P2 landed one and the win has to be BANKED
 *  here, or the list quietly stops meaning anything.
 *
 *  MEASURED 2026-08-29: this was TEN modules until eight value-imports of the `@edh-seer/tagger`
 *  BARREL were pointed at `@edh-seer/tagger/{subtypes,subject,schema}` instead. The barrel drags
 *  `otags/functional.ts` and `otags/semantics.ts`, which `readFileSync` AT MODULE LOAD rather than
 *  lazily, plus `clause-store.ts` (`node:crypto`) and `derive/token-types.ts` — four modules
 *  reached for two constants. */
const REMAINING = [
  // Each loads a JSON artifact from disk at call time. P2 turns these into JSON imports.
  "packages/engine/src/analyze.ts", //     tag-weights.json
  "packages/engine/src/impact.ts", //      impact-weights.json
  "packages/matcher/src/answer-pool.ts", //answer-pool.json
  "packages/matcher/src/hierarchy.ts", //  hierarchy.json
  "packages/matcher/src/rules.ts", //      rules.json
  "packages/matcher/src/theme-stats.ts", //theme-stats.json
];

/** `absWorkingDir` is PINNED to the repo root, and it is load-bearing rather than tidy: esbuild
 *  reports every path relative to its working directory, so without it this list reads
 *  `packages/matcher/src/...` under `vitest --root packages/matcher` and `src/...` under
 *  `npm test -w @edh-seer/matcher` — the test passed alone and failed in the suite. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("only the six known JSON-loading modules keep the analysis engine out of a browser", async () => {
  const errors = await build({
    entryPoints: [fileURLToPath(new URL("./analyze.ts", import.meta.url))],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
    absWorkingDir: ROOT,
  }).then(
    () => [] as { location?: { file?: string } | null }[],
    (e: { errors?: { location?: { file?: string } | null }[] }) => e.errors ?? [],
  );

  const offenders = [...new Set(
    errors.map((e) => e.location?.file).filter((f): f is string => typeof f === "string"),
  )].sort();

  expect(offenders).toEqual(REMAINING);
});
