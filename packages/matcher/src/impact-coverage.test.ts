import { expect, test } from "vitest";
import { EFFECT_KINDS } from "@edh-seer/tagger";
import { loadImpactWeights, SEED_IMPACT_WEIGHTS } from "@edh-seer/engine";

test("every tagger EFFECT_KINDS member has a SEED_IMPACT_WEIGHTS.kinds entry", () => {
  const missing = EFFECT_KINDS.filter((k) => !(k in SEED_IMPACT_WEIGHTS.kinds));
  expect(missing).toEqual([]);
});

// THE SHIPPED FILE IS WHAT SCORES, AND ONLY IT. `loadImpactWeights()` returns
// impact-weights.json, so a kind present in SEED and absent from the JSON is not a fallback -- it
// scores at UNKNOWN_KIND_WEIGHT (0.2) in production while the test above stays green. That is
// exactly what happened: the JSON shipped 27 kinds against SEED's 34, and the seven it lacked
// carried 1,411 of the 71 decks' 40,563 reasons (3.48%), led by keyword-grant 846 (45 decks) and
// type-grant 419 (11 decks). Assert the file the product reads, not only the prior.
test("every tagger EFFECT_KINDS member has an entry in the SHIPPED impact-weights.json", () => {
  const shipped = loadImpactWeights();
  const missing = EFFECT_KINDS.filter((k) => !(k in shipped.kinds));
  expect(missing).toEqual([]);
});
