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
