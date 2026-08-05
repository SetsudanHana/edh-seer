import { expect, test } from "vitest";
import { actionEmits } from "./emits.js";

test("removal emits a death event even though it has no payoff kind", () => {
  const e = actionEmits({ verb: "destroy", object: "target creature" });
  expect(e).toHaveLength(1);
  expect(e[0].verb).toBe("dies");
  expect(e[0].subject).toEqual({ control: "any", token: null, type: "creature", scope: "target" });
});

test("a token maker emits both the creation and the entry", () => {
  const e = actionEmits({ verb: "create", object: "a 1/1 white Soldier creature token" });
  expect(e.map((x) => x.verb)).toEqual(["create-token", "enters"]);
});

test("life change emits with the affected player as subject", () => {
  expect(actionEmits({ verb: "lose-life", object: "each opponent" })[0])
    .toEqual({ verb: "lose-life", subject: { control: "opp", token: null, scope: "each" } });
});

test("an action with no event contributes nothing rather than a guess", () => {
  expect(actionEmits({ verb: "other", object: "flip a coin" })).toEqual([]);
  expect(actionEmits({ verb: "none", object: "" })).toEqual([]);
});
