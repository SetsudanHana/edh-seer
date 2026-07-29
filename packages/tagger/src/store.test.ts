import { expect, test, vi } from "vitest";
import { upsertCardTags, needsRetag, type TagCollection } from "./store.js";
import { SCHEMA_VERSION } from "./schema.js";
import { PROMPT_VERSION } from "./llm/prompt.js";

const sample = {
  oracleId: "oid-1",
  schemaVersion: SCHEMA_VERSION,
  promptVersion: PROMPT_VERSION,
  model: "m",
  characteristics: {
    types: ["enchantment"], subtypes: [], colors: ["R"], identity: ["R"],
    cmc: 2, power: null, toughness: null, token: false, keywords: [],
  },
  abilities: [],
};

test("upsert writes keyed by oracleId", async () => {
  const updateOne = vi.fn(async () => ({}));
  const col = { updateOne, findOne: vi.fn() } as unknown as TagCollection;
  await upsertCardTags(col, sample);
  const [filter, update, opts] = (updateOne as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(filter).toEqual({ oracleId: "oid-1" });
  expect((update as { $set: unknown }).$set).toEqual(sample);
  expect(opts).toEqual({ upsert: true });
});

test("needsRetag true when nothing stored", () => {
  expect(needsRetag(null, SCHEMA_VERSION, PROMPT_VERSION)).toBe(true);
});

test("needsRetag true on version mismatch", () => {
  expect(needsRetag({ ...sample, schemaVersion: 0 }, SCHEMA_VERSION, PROMPT_VERSION)).toBe(true);
  expect(needsRetag({ ...sample, promptVersion: 0 }, SCHEMA_VERSION, PROMPT_VERSION)).toBe(true);
});

test("needsRetag false when versions match", () => {
  expect(needsRetag(sample, SCHEMA_VERSION, PROMPT_VERSION)).toBe(false);
});

test("needsRetag false when pinned, even on version mismatch", () => {
  const pinned = { ...sample, pinned: true, schemaVersion: 0, promptVersion: 0 };
  expect(needsRetag(pinned, SCHEMA_VERSION, PROMPT_VERSION)).toBe(false);
});

test("needsRetag still true on version mismatch when pinned is false or absent", () => {
  expect(needsRetag({ ...sample, pinned: false, schemaVersion: 0 }, SCHEMA_VERSION, PROMPT_VERSION)).toBe(true);
  expect(needsRetag({ ...sample, schemaVersion: 0 }, SCHEMA_VERSION, PROMPT_VERSION)).toBe(true);
});
