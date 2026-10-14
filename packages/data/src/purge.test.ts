import { expect, test } from "vitest";
import { junkCardFilter } from "./purge.js";

test("junk filter selects doubled-name and face-join-sentinel docs", () => {
  const f = junkCardFilter();
  expect(f).toEqual({
    $or: [
      { typeLine: "Card // Card" },
      { oracleText: { $in: ["//", "\n//\n"] } },
    ],
  });
});

test("junk filter does not match a vanilla card (empty oracleText, real typeLine)", () => {
  const f = junkCardFilter() as { $or: Array<{ oracleText?: { $in: string[] } }> };
  const oracleBranch = f.$or.find((b) => b.oracleText);
  expect(oracleBranch?.oracleText?.$in).not.toContain("");
});

test("sticker purge reaches every per-card collection by the field that keys it", async () => {
  const { stickerPurgeFilters } = await import("./purge.js");
  const f = stickerPurgeFilters(["a", "b"]);
  expect(f.map((x) => x.collection)).toEqual(["cards", "cardOtags", "cardClauses", "cardTags", "cardTagsDerived"]);
  expect(f[0].filter).toEqual({ _id: { $in: ["a", "b"] } });
  expect(f[2].filter).toEqual({ oracleId: { $in: ["a", "b"] } });
  expect(f.map((x) => x.collection)).not.toContain("tokens");
});
