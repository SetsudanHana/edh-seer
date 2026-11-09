import { describe, expect, test } from "vitest";
import { parseSubject } from "../index.js";

/** #1579 part 3 -- A NUMBER PICKED FROM A CLASS IS COUNTED WHATEVER THE CLASS. "Sacrifice two artifacts" (Breya), "any number of creatures" (Plunge into Darkness, Glorious Protector), "up to three Zombies" (Ravenous Rotbelly), "five Illusions" (Preston), "X Zombies" (Empty the Laboratory)
 *  are a pick, not a sweep; only the permanent class was marked before, so the matcher read them as mass removal that may hold a token. */
describe("a number-led or any-number pick is selection counted", () => {
  test.each([
    "two artifacts you control", "three black creatures you control", "any number of creatures you control", "any number of non-Angel creatures you control",
    "up to three Zombies you control", "five Illusions you control", "X Zombies", "two creatures", "one or more artifacts you control", "one or more other artifacts you control",
  ])("%s", (t) => {
    const s = parseSubject(t);
    expect(s.scope).toBe("all");
    expect(s.selection).toBe("counted");
  });
});

describe("CONTROL: a real sweep stays unmarked", () => {
  test.each(["two Treasure tokens", "two 1/1 red Goblin creature tokens", "all creatures", "each creature", "all artifacts you control", "all other creatures", "creatures you control"])("%s", (t) => {
    expect(parseSubject(t).selection).toBeUndefined();
  });
});

/** An "except for ... tokens" sweep spares the tokens (Elspeth Tirel, Elesh Norn // The Argent Etchings), so it is a nontoken class and meets no token payoff. */
describe("a sweep that spares tokens is nontoken", () => {
  test.each(["all other permanents except for lands and tokens", "all other creatures except for tokens"])("%s", (t) => {
    expect(parseSubject(t).token).toBe(false);
  });
  test.each(["all other permanents except for lands", "all permanents except for artifacts and lands", "all tokens"])("CONTROL: %s", (t) => {
    expect(parseSubject(t).token).not.toBe(false);
  });
});
