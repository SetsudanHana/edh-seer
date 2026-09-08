import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { usePeekState } from "./peek.js";

/** THE PEEK STACK (spec 2026-09-08 part 3): push looks, push again looks further, back returns
 *  one, close returns to the page with focus on the row that opened the first look. */
test("push, push, back, close: a stack, and close returns focus to the first opener", () => {
  const opener = document.createElement("button");
  document.body.appendChild(opener);
  opener.focus();
  const { result } = renderHook(() => usePeekState());
  act(() => { result.current.push("skullclamp", opener); });
  act(() => { result.current.push("impact-tremors"); });
  expect(result.current.stack).toEqual(["skullclamp", "impact-tremors"]);
  act(() => { result.current.back(); });
  expect(result.current.stack).toEqual(["skullclamp"]);
  const other = document.createElement("button");
  document.body.appendChild(other);
  other.focus();
  act(() => { result.current.close(); });
  expect(result.current.stack).toEqual([]);
  expect(document.activeElement).toBe(opener);
  opener.remove(); other.remove();
});

test("back on a one-deep stack empties it", () => {
  const { result } = renderHook(() => usePeekState());
  act(() => { result.current.push("skullclamp"); });
  act(() => { result.current.back(); });
  expect(result.current.stack).toEqual([]);
});
