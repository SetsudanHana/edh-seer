import { expect, test } from "vitest";
import { junkCardFilter } from "./purge.js";

test("junk filter selects doubled-name and blank-oracle docs", () => {
  const f = junkCardFilter();
  expect(f).toEqual({
    $or: [
      { typeLine: "Card // Card" },
      { oracleText: { $in: ["", "//", "\n//\n"] } },
    ],
  });
});
