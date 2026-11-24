// @vitest-environment node
//
// The rest of this component's tests live in `components.test.tsx`, which runs under
// `environment: "jsdom"` (client/vitest.config.ts) so React components can render. `@edh-seer/tagger`
// and `@edh-seer/matcher`'s barrels both eagerly `readFileSync(new URL(..., import.meta.url))` at
// import time (tagger's otag loader, matcher's `@edh-seer/engine` dependency reading its tag-weight
// corpus) -- fine under a real node process, but under jsdom's module environment
// `import.meta.url` does not resolve to a `file:` URL and the read throws ("The URL must be of
// scheme file"), taking the whole test FILE down with it, not just the import. This file's own
// `// @vitest-environment node` docblock (Vitest's per-file override) runs it as plain node, so
// the engine's own vocabulary can be imported freely -- which is what the task 8 brief means by
// "the test runs in node, so it may import from `@edh-seer/tagger` / `@edh-seer/matcher` freely": that is
// true of a real node environment, not of this package's default jsdom one.
import { expect, test } from "vitest";
import { VERB_VOCAB } from "@edh-seer/tagger";
import { PHASE_VERBS } from "@edh-seer/matcher";
import { VERBS } from "@edh-seer/matcher/verbs";
import { demandSentence } from "./BuildBenchmarks.js";

// #1170 PR 2: the three demand tables became one record, `VERBS`, whose SHAPE (event / player / phase)
// says which table a verb used to sit in. A verb is in exactly one shape by construction, so the
// "exactly one table" ratchets this file held are now `tsc`'s job. What stays here is what the type
// cannot say: that every vocabulary verb READS as English when it reaches `demandSentence`, and that
// the engine's own list of phases (`availability.ts` PHASE_VERBS) is the phase shape.
test("every VERB_VOCAB member the engine can put on a consumer's trigger has a demand phrase", () => {
  const raw = VERB_VOCAB.filter((v) => /[:-]/.test(demandSentence(`${v}:*`)) || demandSentence(`${v}:*`) === v);
  expect(raw).toEqual([]);
});

test("a verb names exactly one demand shape, and every verb has one", () => {
  expect(VERB_VOCAB.filter((v) => !["event", "player", "phase"].includes(VERBS[v]?.shape ?? ""))).toEqual([]);
});

// PHASE_VERBS is the one sub-list an outside authority (availability.ts) pins down exactly: a verb
// the GAME supplies, never a card, must be the phase shape (not an event with an "an upkeep" subject).
test("every PHASE_VERBS member is the phase shape", () => {
  const misfiled = [...PHASE_VERBS].filter((v) => VERBS[v as keyof typeof VERBS]?.shape !== "phase");
  expect(misfiled).toEqual([]);
});
