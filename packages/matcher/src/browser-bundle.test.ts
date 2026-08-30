import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test } from "vitest";

/** DOES THE ANALYSIS ENGINE BUNDLE FOR A BROWSER? — the ratchet for roadmap P2.
 *
 *  Points at `orchestrate.ts`, not `analyze.ts` (Task 3, static-build-data-plane): the client
 *  imports the ORCHESTRATION — `resolveDeck` / `analyzeResolvedDeck` / `buildWireGraph`, the whole
 *  commander-fallback-through-token-art pipeline the Nest server used to be the only copy of — not
 *  the bare analysis function. `analyze.ts` bundling clean says nothing about whether the code path
 *  a browser actually calls does.
 *
 *  Static-first hosting means that pipeline runs in the client, so every module on its graph has to
 *  survive a browser bundle. This asks esbuild directly, which is the only thing that actually
 *  answers it: a green `tsc` does NOT, and stopped being evidence entirely on 2026-08-29 when
 *  `"node"` went into `web/client`'s `types` to clear 32 errors that said nothing about this repo.
 *  Reading imports does not answer it either — `edges.ts` is one of the modules that used to pull
 *  the Node-side barrel and it does NOT appear in a plain `grep`, only in `grep -a`.
 *
 *  AN EXACT SET, NOT A CAP, and it fails in BOTH directions on purpose — the same shape as
 *  `KNOWN_DEFECT_CAP`. A new entry means someone put a Node builtin back on the analysis path and
 *  the static build got bigger. A missing entry means P2 landed one and the win has to be BANKED
 *  here, or the list quietly stops meaning anything.
 *
 *  THE LIST IS EMPTY AND THAT IS THE POINT — measured 2026-08-29, in two steps.
 *  TEN modules -> SIX when eight value-imports of the `@edh-seer/tagger` BARREL were pointed at
 *  `@edh-seer/tagger/{subtypes,subject,schema}` instead (the barrel drags `otags/functional.ts` and
 *  `otags/semantics.ts`, which `readFileSync` AT MODULE LOAD, plus `clause-store.ts` and
 *  `derive/token-types.ts` — four modules reached for two constants).
 *  SIX -> ZERO when the six JSON artifacts became static imports: `tag-weights` · `impact-weights`
 *  · `answer-pool` · `hierarchy` · `rules` · `theme-stats`. */
const REMAINING: string[] = [];

/** `absWorkingDir` is PINNED to the repo root, and it is load-bearing rather than tidy: esbuild
 *  reports every path relative to its working directory, so this list would read
 *  `packages/matcher/src/...` under `vitest --root packages/matcher` and `src/...` under
 *  `npm test -w @edh-seer/matcher` — the test passed alone and failed in the suite. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** A bundle that produced almost nothing would satisfy an EMPTY offender list while checking
 *  nothing at all — the vacuous-pass shape `client-browser-safe.test.ts` guards with its
 *  "found more than 20 files" assertion. Measured at 350 KB on 2026-08-29; the floor is set well
 *  under that so ordinary growth or shrinkage does not fail it, and a resolution failure does. */
const MIN_BUNDLE_BYTES = 200_000;

test("the analysis engine bundles for a browser with no Node-only modules left on its graph", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./orchestrate.ts", import.meta.url))],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
    absWorkingDir: ROOT,
  }).then(
    (r) => ({ errors: [] as { location?: { file?: string } | null }[], bytes: r.outputFiles[0]?.contents.byteLength ?? 0 }),
    (e: { errors?: { location?: { file?: string } | null }[] }) => ({ errors: e.errors ?? [], bytes: 0 }),
  );

  const offenders = [...new Set(
    result.errors.map((e) => e.location?.file).filter((f): f is string => typeof f === "string"),
  )].sort();

  expect(offenders).toEqual(REMAINING);
  expect(result.bytes).toBeGreaterThan(MIN_BUNDLE_BYTES);
});
