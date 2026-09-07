import { expect, test } from "vitest";
import { stateFromSearch, searchWithState } from "./game-state.js";

/** THE STATE LIVES IN THE QUERY so a shared link carries it: `?speed=4&monarch=1`. */
test("a query round-trips through the state", () => {
  expect(stateFromSearch("?speed=4&monarch=1&dungeon=1&x=y")).toEqual({ speed: 4, monarch: true, dungeon: true });
  expect(stateFromSearch("?speed=7&monarch=0")).toEqual({});
  expect(searchWithState("?x=y&speed=2", { monarch: true, initiative: true })).toBe("?x=y&monarch=1&initiative=1");
  expect(searchWithState("?speed=2", {})).toBe("");
});
