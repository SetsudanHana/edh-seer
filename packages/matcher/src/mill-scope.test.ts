import { describe, expect, test } from "vitest";
import type { Ability } from "@edh-seer/tagger";
import { joinMillScopes, millScopeOf } from "./mill-scope.js";

const mill = (eff?: "you" | "opp" | "any", emit?: "you" | "opp" | "any"): Pick<Ability, "effect" | "emits"> => ({
  effect: { kind: "mill", ...(eff ? { subject: { control: eff, token: null } } : {}) },
  ...(emit ? { emits: [{ verb: "mill" as const, subject: { control: emit, token: null } }] } : {}),
});

describe("millScopeOf (#721, #1663)", () => {
  test("a mill replacement names its miller on the effect subject alone (Bruvac the Grandiloquent: 'if an opponent would mill')", () => {
    expect(millScopeOf(mill("opp"))).toBe("opp");
  });
  test("no player read at all is undefined", () => expect(millScopeOf(mill())).toBeUndefined());
  test("the effect subject and the emit join: you + any = any, you + you = you", () => {
    expect(millScopeOf(mill("any", "you"))).toBe("any");
    expect(millScopeOf(mill("you", "you"))).toBe("you");
  });
  test("a non-mill effect has no scope", () => expect(millScopeOf({ effect: { kind: "draw-card" } })).toBeUndefined());
  test("several abilities join to the sides they hit together", () => expect(joinMillScopes(["you", "opp"])).toBe("any"));
});
