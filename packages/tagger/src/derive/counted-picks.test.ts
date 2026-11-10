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

/** An "except for ... tokens" sweep spares the tokens (Elspeth Tirel), so it is a nontoken class and meets no token payoff. */
describe("a sweep that spares tokens is nontoken", () => {
  test.each(["all other permanents except for lands and tokens", "all other creatures except for tokens"])("%s", (t) => {
    expect(parseSubject(t).token).toBe(false);
  });
  test.each(["all other permanents except for lands", "all permanents except for artifacts and lands", "all tokens"])("CONTROL: %s", (t) => {
    expect(parseSubject(t).token).not.toBe(false);
  });
});

/** #1585 -- A BATCHED TRIGGER SUBJECT IS NOT A PICK. "Whenever one or more creatures you control attack" (Hellrider-style batches), "two or more creatures" name the event's own set; no player counts them out of a class, so they are never `counted`.
 *  `counted` belongs to an effect or cost object (a sacrifice, destroy or exile pick): the same words as an object stay counted. */
describe("a trigger subject is never selection counted", () => {
  test.each([
    "one or more creatures you control", "one or more other creatures you control", "two or more creatures", "three or more creatures you control with flying",
    "one or more nontoken Vampires you control", "one or more artifacts you control", "one or more permanents",
  ])("%s", (t) => {
    const s = parseSubject(t, "event");
    expect(s.scope).toBe("all");
    expect(s.selection).toBeUndefined();
  });
  test.each(["one or more artifacts you control", "one or more other artifacts you control", "two creatures"])("CONTROL: %s as an object is still counted", (t) => {
    expect(parseSubject(t, "pick").selection).toBe("counted");
    expect(parseSubject(t).selection).toBe("counted");
  });
});
