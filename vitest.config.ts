import { defineConfig } from "vitest/config";

/** ONE COMMAND FROM THE ROOT, EACH PACKAGE UNDER ITS OWN CONFIG (2026-09-25).
 *
 *  `npx vitest run` from the repository root used to ignore every package's own config -- the web
 *  client's tests ran without jsdom and died on `document is not defined`, and CONTRIBUTING carried
 *  a rule against ever doing it. With `projects`, a root run is the same set of suites `npm test`
 *  runs, each with its own environment, in one process and one report. `npm test` (per workspace)
 *  still works and is what CI runs.
 *
 *  A package with a `vitest.config.ts` is listed by that file; one without is listed by directory
 *  and gets vitest's defaults, which is what it gets under `npm test` too. `research/` is not a
 *  project: nothing there is a test (`lint:bins` fails if one appears). */
export default defineConfig({
  test: {
    projects: [
      "packages/cli",
      "packages/data/vitest.config.ts",
      "packages/engine/vitest.config.ts",
      "packages/import-worker",
      "packages/instruments",
      "packages/matcher",
      "packages/tagger",
      "packages/web/client/vitest.config.ts",
    ],
  },
});
