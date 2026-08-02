import { expect, test } from "vitest";
import { buildCardOtags } from "./build.js";

test("inverts tag->ids into id->tags, intersected with the corpus, deduped + sorted", () => {
  const tagToIds = new Map<string, string[]>([
    ["death-trigger", ["blood", "gravepact", "OFFCORPUS"]],
    ["sacrifice-outlet-creature", ["viscera", "gravepact"]],
  ]);
  const corpus = new Set(["blood", "gravepact", "viscera"]);
  const out = buildCardOtags(tagToIds, corpus);
  expect(out.get("gravepact")).toEqual(["death-trigger", "sacrifice-outlet-creature"]); // sorted, both tags
  expect(out.get("blood")).toEqual(["death-trigger"]);
  expect(out.has("OFFCORPUS")).toBe(false); // off-corpus dropped
});
