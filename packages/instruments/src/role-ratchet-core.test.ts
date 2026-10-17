import { expect, test } from "vitest";
import { diffMembership, listSome, mergeMembership, serialiseSnapshot, versionDrift } from "./role-ratchet-core.js";

test("an identical measurement changes nothing", () => {
  const d = diffMembership({ A: ["role:ramp"] }, { A: ["role:ramp"] });
  expect(d).toEqual({ gained: [], lost: [], newCards: [], goneCards: [] });
});

test("a key the measurement has and the snapshot lacks is gained, the reverse is lost", () => {
  const d = diffMembership({ A: ["role:ramp", "role:draw"] }, { A: ["role:ramp", "role:burn"] });
  expect(d.gained).toEqual([["A", "role:draw"]]);
  expect(d.lost).toEqual([["A", "role:burn"]]);
});

test("a card absent from one side is new or gone, and its keys are still gained or lost", () => {
  const d = diffMembership({ A: ["role:ramp"], B: ["role:draw"] }, { A: ["role:ramp"], C: ["role:burn"] });
  expect(d.newCards).toEqual(["B"]);
  expect(d.goneCards).toEqual(["C"]);
  expect(d.gained).toEqual([["B", "role:draw"]]);
  expect(d.lost).toEqual([["C", "role:burn"]]);
});

test("merging unions memberships across decks, sorted and de-duplicated", () => {
  const m = mergeMembership([
    new Map([["A", ["role:ramp"]]]),
    new Map([["A", ["answer:creature", "role:ramp"]], ["B", ["role:draw"]]]),
  ]);
  expect(m).toEqual({ A: ["answer:creature", "role:ramp"], B: ["role:draw"] });
});

test("the serialised snapshot is key-sorted and stable", () => {
  const s = serialiseSnapshot({ B: ["role:draw"], A: ["role:ramp"] });
  expect(s.indexOf('"A"')).toBeLessThan(s.indexOf('"B"'));
  expect(s.endsWith("\n")).toBe(true);
});

test("a corpus at exactly the expected version has no drift", () => {
  expect(versionDrift([{ _id: 339, n: 5000 }], 339)).toEqual([]);
});

test("older, newer and missing versions are all drift", () => {
  const d = versionDrift([{ _id: 339, n: 10 }, { _id: 340, n: 1 }, { _id: null, n: 2 }, { _id: 338, n: 3 }], 339);
  expect(d.map((g) => g._id)).toEqual([null, 338, 340]);
});

test("listSome caps the list and counts the rest", () => {
  expect(listSome(["b", "a"], 10)).toBe("a, b");
  expect(listSome(["a", "b", "c"], 2)).toBe("a, b, ... (+1 more)");
});
