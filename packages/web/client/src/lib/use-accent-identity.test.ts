import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { useAccentIdentity } from "./use-accent-identity.js";
import { NEUTRAL_ACCENT, identityColor } from "./color-identity.js";

const STORAGE_KEY = "mtg-synergy:preferred-identity";

beforeEach(() => localStorage.clear());
afterEach(() => document.documentElement.style.removeProperty("--accent"));

test("with no analyzed deck and no stored pick, the accent is the neutral old-gold", () => {
  renderHook(() => useAccentIdentity(undefined));
  expect(document.documentElement.style.getPropertyValue("--accent")).toBe(NEUTRAL_ACCENT);
});

test("a manual pick sets the accent when no deck has been analyzed", () => {
  const { result } = renderHook(() => useAccentIdentity(undefined));
  act(() => result.current.setManualPick(["U", "R"]));
  expect(document.documentElement.style.getPropertyValue("--accent")).toBe(identityColor(["U", "R"]));
});

test("an analyzed deck's identity wins over a manual pick", () => {
  const { result, rerender } = renderHook(({ analyzed }) => useAccentIdentity(analyzed), {
    initialProps: { analyzed: undefined as string[] | undefined },
  });
  act(() => result.current.setManualPick(["G"]));
  expect(document.documentElement.style.getPropertyValue("--accent")).toBe(identityColor(["G"]));

  rerender({ analyzed: ["W", "B"] });
  expect(document.documentElement.style.getPropertyValue("--accent")).toBe(identityColor(["W", "B"]));
});

test("an analyzed colorless commander falls back to the neutral accent, not the manual pick", () => {
  const { result, rerender } = renderHook(({ analyzed }) => useAccentIdentity(analyzed), {
    initialProps: { analyzed: undefined as string[] | undefined },
  });
  act(() => result.current.setManualPick(["G"]));
  rerender({ analyzed: [] });
  expect(document.documentElement.style.getPropertyValue("--accent")).toBe(NEUTRAL_ACCENT);
});

test("manual pick persists to localStorage and seeds the next mount", () => {
  const { result, unmount } = renderHook(() => useAccentIdentity(undefined));
  act(() => result.current.setManualPick(["B", "R"]));
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(["B", "R"]);
  unmount();

  const { result: result2 } = renderHook(() => useAccentIdentity(undefined));
  expect(result2.current.manualPick).toEqual(["B", "R"]);
});
