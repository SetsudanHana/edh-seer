import { expect, test } from "vitest";
import { loadDescriptorOtags, loadFunctionalOtags } from "./functional.js";

test("functional otag list is a non-empty deduped slug array covering the core families", () => {
  const slugs = loadFunctionalOtags();
  expect(slugs.length).toBeGreaterThan(30);
  expect(new Set(slugs).size).toBe(slugs.length); // deduped
  for (const s of ["creaturefall", "death-trigger", "sacrifice-outlet-creature", "landfall", "cast-trigger"]) {
    expect(slugs).toContain(s);
  }
});

test("descriptors are a strict subset of the functional list and exclude synergy events", () => {
  const all = loadFunctionalOtags();
  const descriptors = loadDescriptorOtags();
  expect(descriptors.length).toBeGreaterThan(0);
  expect(descriptors.every((s) => all.includes(s))).toBe(true);
  // near-universal qualifiers belong in descriptors, so coverage stays signal-bearing
  for (const s of ["triggered-ability", "activated-ability", "virtual-vanilla"]) {
    expect(descriptors).toContain(s);
  }
  // event slugs that drive pairing must never be classed as descriptors
  for (const s of ["death-trigger", "creaturefall", "drain-life"]) {
    expect(descriptors).not.toContain(s);
  }
});
