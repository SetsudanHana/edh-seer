import { renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useBoardMode } from "./use-board-mode.js";

function stubPointer(coarse: boolean, anyFine: boolean, width = coarse ? 390 : 1440) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("any-pointer: fine") ? anyFine : q.includes("pointer: coarse") ? coarse : false,
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", 844);
}
afterEach(() => vi.unstubAllGlobals());

test("a thumb on a real deck gets the ego view", () => {
  stubPointer(true, false);
  expect(renderHook(() => useBoardMode(73)).result.current).toBe("ego");
});

// THE DEFECT THIS CONDITION EXISTS TO PREVENT. Desktop discs measure 20.1px, UNDER the 24px floor,
// so a size-only rule flips desktop into the ego view too. The floor is a THUMB constraint: on a
// mouse the 38.1px separation clears 2.5.8's spacing exception and hover names what is under it.
test("a mouse keeps the whole board even though its discs are under the floor", () => {
  stubPointer(false, true);
  expect(renderHook(() => useBoardMode(73)).result.current).toBe("board");
});

test("a touchscreen laptop keeps the board, because it also has a precise pointer", () => {
  stubPointer(true, true, 1440);
  expect(renderHook(() => useBoardMode(73)).result.current).toBe("board");
});

test("a small enough graph keeps the board even on a thumb", () => {
  stubPointer(true, false);
  expect(renderHook(() => useBoardMode(8)).result.current).toBe("board");
});

test("no matchMedia means the board, which is what every existing test was written against", () => {
  vi.stubGlobal("matchMedia", undefined);
  expect(renderHook(() => useBoardMode(73)).result.current).toBe("board");
});
