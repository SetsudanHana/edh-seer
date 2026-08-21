// @vitest-environment node
//
// The rest of this component's tests live in `components.test.tsx`, which runs under
// `environment: "jsdom"` (client/vitest.config.ts) so React components can render. `@mtg/tagger`
// and `@mtg/matcher`'s barrels both eagerly `readFileSync(new URL(..., import.meta.url))` at
// import time (tagger's otag loader, matcher's `@mtg/engine` dependency reading its tag-weight
// corpus) -- fine under a real node process, but under jsdom's module environment
// `import.meta.url` does not resolve to a `file:` URL and the read throws ("The URL must be of
// scheme file"), taking the whole test FILE down with it, not just the import. This file's own
// `// @vitest-environment node` docblock (Vitest's per-file override) runs it as plain node, so
// the engine's own vocabulary can be imported freely -- which is what the task 8 brief means by
// "the test runs in node, so it may import from `@mtg/tagger` / `@mtg/matcher` freely": that is
// true of a real node environment, not of this package's default jsdom one.
import { expect, test } from "vitest";
import { VERB_VOCAB } from "@mtg/tagger";
import { PHASE_VERBS } from "@mtg/matcher";
import { DEMAND_VERB, DEMAND_PHASE } from "./BuildBenchmarks.js";

// A completeness ratchet, derived from the engine's own vocabulary rather than from this file's
// map -- `VERB_VOCAB` is every verb a consumer's trigger can carry (buildCensus reads
// `Ability.trigger.verb`, typed to that exact union), and `PHASE_VERBS` (`availability.ts`'s own
// authority on what a phase is) is the subset the GAME supplies rather than a card, so it needs a
// `DEMAND_PHASE` entry instead of a `DEMAND_VERB` one. Neither list lives in BuildBenchmarks.tsx,
// so this test moves when the engine's vocabulary does, unlike the map it is checking -- exactly
// the shape `sentence.test.ts` already uses for `VERB_PHRASES` against this same `VERB_VOCAB`.
//
// PROVEN TO FIRE (verified by hand while implementing task 8, not shipped as a second test):
// deleting the `leaves` entry from `DEMAND_VERB` and re-running failed this test with
// `missing = ["leaves"]`; restoring the entry made it pass again.
test("every VERB_VOCAB member the engine can put on a consumer's trigger has a demand phrase", () => {
  const missing = VERB_VOCAB.filter((v) => !(PHASE_VERBS.has(v) ? v in DEMAND_PHASE : v in DEMAND_VERB));
  expect(missing).toEqual([]);
});
