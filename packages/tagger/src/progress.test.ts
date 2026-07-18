import { expect, test } from "vitest";
import { startProgress } from "./progress.js";

test("renders 0/total immediately and increments on tick", () => {
  const out: string[] = [];
  const { tick } = startProgress(3, (s) => out.push(s));
  expect(out[0]).toContain("0/3"); // shown before any work completes
  tick();
  expect(out.at(-1)).toContain("1/3");
  tick();
  tick();
  expect(out.some((s) => s.includes("3/3"))).toBe(true);
  expect(out.at(-1)).toBe("\n"); // newline when complete
});
