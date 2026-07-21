import { expect, test } from "vitest";
import { parseProposals, pairKey, dedupeAndBuild } from "./propose-pairs-core.js";
import type { GoldPair } from "./eval-pairs-core.js";

test("parseProposals reads a JSON array of {a,b,note}, ignoring extra keys", () => {
  const raw = '[{"a":"Blood Artist","b":"Viscera Seer","note":"sac drain","x":1}]';
  expect(parseProposals(raw)).toEqual([{ a: "Blood Artist", b: "Viscera Seer", note: "sac drain" }]);
});

test("parseProposals also accepts the {pairs:[...]} object form (Anthropic prefill)", () => {
  const raw = '{"pairs":[{"a":"Guttersnipe","b":"Ponder","note":"ping"}]}';
  expect(parseProposals(raw)).toEqual([{ a: "Guttersnipe", b: "Ponder", note: "ping" }]);
});

test("parseProposals throws on non-array / malformed entries", () => {
  expect(() => parseProposals('{"a":"x"}')).toThrow();
  expect(() => parseProposals('[{"a":"only-a"}]')).toThrow();
});

test("pairKey is order-insensitive and normalized", () => {
  expect(pairKey("Blood Artist", "Viscera Seer")).toBe(pairKey("Viscera Seer", "Blood Artist"));
});

test("dedupeAndBuild resolves names, drops unresolved, drops existing duplicates", () => {
  const resolve = (n: string): string | null =>
    n === "Bad Card" ? null : n.replace(/\s+the\s+/i, " The ");
  const existing: GoldPair[] = [
    { a: "Blood Artist", b: "Viscera Seer", category: "aristocrats", note: "", source: "seed", verified: true },
  ];
  const out = dedupeAndBuild(
    [
      { a: "Viscera Seer", b: "Blood Artist", note: "dup reversed" },
      { a: "Bad Card", b: "Blood Artist", note: "unresolved" },
      { a: "Zulaport Cutthroat", b: "Ashnod's Altar", note: "new" },
    ],
    "aristocrats",
    existing,
    resolve,
  );
  expect(out.duplicates).toHaveLength(1);
  expect(out.unresolved).toHaveLength(1);
  expect(out.accepted).toHaveLength(1);
  expect(out.accepted[0]).toMatchObject({
    a: "Zulaport Cutthroat", b: "Ashnod's Altar", category: "aristocrats",
    source: "llm-proposed", verified: false,
  });
});
