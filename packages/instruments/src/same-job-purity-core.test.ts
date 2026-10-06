import { expect, test } from "vitest";
import { purity } from "./same-job-purity-core.js";

test("purity is same over together, unsure pairs are not scored, and one different pair fails the gate", () => {
  const p = purity([
    { label: "same", together: true }, { label: "same", together: true }, { label: "weak", together: true },
    { label: "same", together: false }, { label: "different", together: false }, { label: "different", together: true, excluded: true },
  ]);
  expect(p).toMatchObject({ scored: 5, together: 3, same: 2, weak: 1, different: 0, sameFound: 2, sameTotal: 3 });
  expect(p.purity).toBeCloseTo(2 / 3, 10);
  expect(p.passes).toBe(false);
  expect(purity([{ label: "same", together: true }, { label: "different", together: true }]).passes).toBe(false);
  expect(purity([{ label: "same", together: true }]).passes).toBe(true);
  expect(purity([{ label: "same", together: false }]).purity).toBeNull();
});
