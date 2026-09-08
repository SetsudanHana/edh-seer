import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { peekOnPlainClick, usePeekState, type PeekApi } from "./peek.js";
import { vi } from "vitest";

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

/** THE CLICK RULE, ONCE, for the partner list and the search results alike. */
test("peekOnPlainClick: plain left click peeks and is consumed; anything else is left to the link", () => {
  const push = vi.fn();
  const peek: PeekApi = { stack: [], push, back: vi.fn(), close: vi.fn() };
  const el = document.createElement("a");
  const ev = (over: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, currentTarget: el, preventDefault: vi.fn(), ...over,
  }) as unknown as import("react").MouseEvent<HTMLElement>;
  const plain = ev({});
  expect(peekOnPlainClick(peek, "skullclamp", plain)).toBe(true);
  expect(plain.preventDefault).toHaveBeenCalled();
  expect(push).toHaveBeenCalledWith("skullclamp", el);
  for (const e of [ev({ metaKey: true }), ev({ ctrlKey: true }), ev({ shiftKey: true }), ev({ altKey: true }), ev({ button: 1 })]) {
    expect(peekOnPlainClick(peek, "x", e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  }
  expect(peekOnPlainClick(null, "x", ev({}))).toBe(false);
});
