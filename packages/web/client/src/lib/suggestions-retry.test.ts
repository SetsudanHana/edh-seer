import { renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { AnalyzeResponse } from "../types.js";

/** A CHUNK THAT FAILED TO LOAD ONCE IS TRIED AGAIN (review of Task 8): a deploy rotates the hashed
 *  chunk under an open tab, the first import rejects, and a memoised rejection would fail every later
 *  report in that tab until a reload. Its own file, because it needs a module load that fails. */
const { attempt } = vi.hoisted(() => ({ attempt: { n: 0 } }));
vi.mock("@edh-seer/matcher/suggest-static", () => {
  attempt.n += 1;
  if (attempt.n === 1) throw new Error("Failed to fetch dynamically imported module");
  return { suggestForDeck: async () => ({ build: {}, answers: {}, synergy: {}, plan: [], pairs: [], routes: [] }) };
});

test("after a failed engine load, the next report loads it again", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { useSuggestions } = await import("./suggestions.js");
  const report = (): AnalyzeResponse => ({ report: { cards: [] }, commanderColorIdentity: [] } as unknown as AnalyzeResponse);
  const { result, rerender } = renderHook(({ data }) => useSuggestions(data), { initialProps: { data: report() } });
  await waitFor(() => expect(result.current.state).toBe("error"));
  rerender({ data: report() });
  await waitFor(() => expect(result.current.state).toBe("ready"));
  warn.mockRestore();
});
