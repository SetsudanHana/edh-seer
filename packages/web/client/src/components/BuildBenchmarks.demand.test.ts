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
import { DEMAND_VERB, DEMAND_PHASE, DEMAND_SUBJECTLESS } from "./BuildBenchmarks.js";

// A completeness-AND-disjointness ratchet, derived from the engine's own vocabulary rather than
// from this file's maps -- `VERB_VOCAB` is every verb a consumer's trigger can carry (buildCensus
// reads `Ability.trigger.verb`, typed to that exact union), and `PHASE_VERBS`
// (`availability.ts`'s own authority on what a phase is) is the subset the GAME supplies rather
// than a card. Neither list lives in BuildBenchmarks.tsx, so this test moves when the engine's
// vocabulary does, unlike the maps it is checking -- exactly the shape `sentence.test.ts` already
// uses for `VERB_PHRASES` against this same `VERB_VOCAB`.
//
// THREE tables now, not two (review finding F1, task 8 fix round 1): `DEMAND_SUBJECTLESS` holds
// the player-action verbs (draw, gain-life, lose-life, dice-rolled, proliferate) that have no true
// passive reading once glued to a permanent subject. A verb must land in EXACTLY ONE of the three
// -- zero is a silent raw-key fallback, two is a bug nobody would notice because both branches
// would return something plausible.
const TABLES = [DEMAND_VERB, DEMAND_PHASE, DEMAND_SUBJECTLESS] as const;

// PROVEN TO FIRE (verified by hand while implementing task 8, not shipped as a second test):
// deleting the `leaves` entry from `DEMAND_VERB` and re-running failed this test with
// `missing = ["leaves"]`; restoring the entry made it pass again.
test("every VERB_VOCAB member the engine can put on a consumer's trigger has a demand phrase", () => {
  const missing = VERB_VOCAB.filter((v) => !TABLES.some((t) => v in t));
  expect(missing).toEqual([]);
});

// PROVEN TO FIRE (fix round 1): duplicating `draw` into `DEMAND_VERB` (already present in
// `DEMAND_SUBJECTLESS`) failed this test with `duplicated = ["draw"]`; removing the duplicate made
// it pass again.
test("no VERB_VOCAB member sits in more than one of the three demand tables", () => {
  const duplicated = VERB_VOCAB.filter((v) => TABLES.filter((t) => v in t).length > 1);
  expect(duplicated).toEqual([]);
});

// PHASE_VERBS is the one sub-list an outside authority (availability.ts) pins down exactly: a verb
// the GAME supplies, never a card, must land in DEMAND_PHASE specifically, not merely somewhere
// among the three (the two tests above would pass even if `upkeep` were misfiled into
// DEMAND_SUBJECTLESS, since that is still "exactly one").
test("every PHASE_VERBS member lands in DEMAND_PHASE, not DEMAND_VERB or DEMAND_SUBJECTLESS", () => {
  const misfiled = [...PHASE_VERBS].filter((v) => !(v in DEMAND_PHASE));
  expect(misfiled).toEqual([]);
});
