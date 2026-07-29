import { expect, test } from "vitest";
import { EFFECT_KINDS } from "@mtg/tagger";
import { SEED_IMPACT_WEIGHTS } from "@mtg/engine";

test("every tagger EFFECT_KINDS member has a SEED_IMPACT_WEIGHTS.kinds entry", () => {
  const missing = EFFECT_KINDS.filter((k) => !(k in SEED_IMPACT_WEIGHTS.kinds));
  expect(missing).toEqual([]);
});
