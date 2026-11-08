import { expect, test } from "vitest";
import { withoutParentheses } from "./reminder.js";
import { chosenKindOfText } from "./chosen-kind.js";

test("parenthesised spans become one space, nested ones too; an unmatched ) stays", () => {
  expect(withoutParentheses("Flying (a reminder) and more")).toBe("Flying   and more");
  expect(withoutParentheses("a (b (c) d) e")).toBe("a   e");
  expect(withoutParentheses("a ) b")).toBe("a ) b");
});

test("many unclosed ( are linear (CodeQL js/polynomial-redos on the old /\\([^)]*\\)/g)", () => {
  const evil = "(".repeat(200_000);
  const t = Date.now();
  expect(withoutParentheses(evil)).toBe("");
  expect(chosenKindOfText(`${evil} choose a creature type`)).toBeUndefined();
  expect(Date.now() - t).toBeLessThan(1000);
});
