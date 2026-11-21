import { describe, expect, test } from "vitest";
import { unstatedCreates } from "./recipient.js";

// #1728 review: the two refusals of `unstatedCreates` (no fixture card reaches them today).
describe("unstatedCreates refuses what it cannot align", () => {
  test("two creates in one sentence are not told apart", () =>
    expect(unstatedCreates("Create a 1/1 white Soldier creature token, then create a Treasure token.", 2)).toBeNull());
  test("printed and stored create counts differ (a model that stored one printed create twice)", () =>
    expect(unstatedCreates("Create a 1/1 white Soldier creature token.", 2)).toBeNull());
  test("aligned: each sentence answers its own create", () =>
    expect(unstatedCreates("Create a 2/2 Bear creature token. Each opponent may create a Treasure token.", 2)).toEqual([true, false]));
});
