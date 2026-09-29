import { expect, test } from "vitest";
import { unaskableNote } from "./unaskable.js";

/** #730: the six effect kinds no event can ask are said where a player types them. */
test("a word for one of the six unaskable effects gets a note naming it", () => {
  expect(unaskableNote("ramp")).toMatch(/^Making mana \(ramp\) can't be searched here yet/);
  expect(unaskableNote("mana rocks")).toMatch(/^Making mana/);
  expect(unaskableNote("clone")).toMatch(/^Clones/);
  expect(unaskableNote("double triggers")).toMatch(/^Doubling triggers/);
  expect(unaskableNote("extra turn")).toMatch(/^Extra turns/);
  // Drain and trigger doubling each have an event beside them.
  expect(unaskableNote("drain")).toMatch(/closest event is "life is lost"/);
  expect(unaskableNote("double triggers")).toMatch(/closest event is "a triggered ability to copy"/);
});

test("anything else, or a word too short to tell, gets no note", () => {
  // Copying a spell IS an event now ("a spell is copied"), so it is askable and gets no note.
  expect(unaskableNote("copy a spell")).toBeNull();
  expect(unaskableNote("graveyard")).toBeNull();
  expect(unaskableNote("gain life")).toBeNull();
  expect(unaskableNote("ma")).toBeNull();
  // "mana value" is a card's cost, not ramp.
  expect(unaskableNote("mana value")).toBeNull();
  expect(unaskableNote("")).toBeNull();
});
