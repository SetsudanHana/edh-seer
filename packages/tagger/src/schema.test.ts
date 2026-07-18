import { expect, test } from "vitest";
import { VERB_VOCAB, SCHEMA_VERSION } from "./schema.js";

test("verb vocabulary is the closed 17-verb list", () => {
  expect(VERB_VOCAB).toHaveLength(17);
  expect(VERB_VOCAB).toContain("enters");
  expect(VERB_VOCAB).toContain("create-token");
  expect(VERB_VOCAB).toContain("land-play");
  expect(new Set(VERB_VOCAB).size).toBe(VERB_VOCAB.length);
});

test("schema version starts at 1", () => {
  expect(SCHEMA_VERSION).toBe(1);
});
