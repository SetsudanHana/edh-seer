import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useListboxKeys } from "./listbox-keys.js";

const press = (k: string) => ({ key: k, preventDefault: vi.fn() }) as never;

/** THE COMBOBOX KEYBOARD, ONCE (roadmap AJ3). Extracted from `HeaderSearch`, which shipped it
 *  first; the event pickers need the identical contract and two hand-written copies of an
 *  accessibility rule drift the first time one of them is fixed. */
test("arrows move and wrap in both directions", () => {
  const { result } = renderHook(() => useListboxKeys({ count: 3, onChoose: vi.fn() }));
  act(() => result.current.onKey(press("ArrowDown")));
  expect(result.current.active).toBe(0);
  act(() => result.current.onKey(press("ArrowDown")));
  expect(result.current.active).toBe(1);
  act(() => result.current.onKey(press("ArrowUp")));
  expect(result.current.active).toBe(0);
  act(() => result.current.onKey(press("ArrowUp")));
  expect(result.current.active).toBe(2);
});

test("Enter takes the active row", () => {
  const onChoose = vi.fn();
  const { result } = renderHook(() => useListboxKeys({ count: 3, onChoose }));
  act(() => result.current.onKey(press("ArrowDown")));
  act(() => result.current.onKey(press("ArrowDown")));
  act(() => result.current.onKey(press("Enter")));
  expect(onChoose).toHaveBeenCalledWith(1);
});

/** ENTER WITH NOTHING ACTIVE TAKES THE FIRST ROW, which is what a reader who typed and hit Enter
 *  means, and what `HeaderSearch` has always done. */
test("Enter with nothing active takes the first row", () => {
  const onChoose = vi.fn();
  const { result } = renderHook(() => useListboxKeys({ count: 2, onChoose }));
  act(() => result.current.onKey(press("Enter")));
  expect(onChoose).toHaveBeenCalledWith(0);
});

test("Escape clears the active row and closes", () => {
  const onClose = vi.fn();
  const { result } = renderHook(() => useListboxKeys({ count: 2, onChoose: vi.fn(), onClose }));
  act(() => result.current.onKey(press("ArrowDown")));
  act(() => result.current.onKey(press("Escape")));
  expect(result.current.active).toBe(-1);
  expect(onClose).toHaveBeenCalled();
});

/** AN EMPTY LIST CHOOSES NOTHING. Arrows on no rows used to be the one way a combobox could report
 *  an option that is not there. */
test("an empty list swallows the arrows and refuses Enter", () => {
  const onChoose = vi.fn();
  const { result } = renderHook(() => useListboxKeys({ count: 0, onChoose }));
  act(() => result.current.onKey(press("ArrowDown")));
  expect(result.current.active).toBe(-1);
  act(() => result.current.onKey(press("Enter")));
  expect(onChoose).not.toHaveBeenCalled();
});

test("reset clears the active row", () => {
  const { result } = renderHook(() => useListboxKeys({ count: 3, onChoose: vi.fn() }));
  act(() => result.current.onKey(press("ArrowDown")));
  act(() => result.current.reset());
  expect(result.current.active).toBe(-1);
});
