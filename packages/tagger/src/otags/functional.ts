import { readFileSync } from "node:fs";

const groups = JSON.parse(
  readFileSync(new URL("./functional-otags.json", import.meta.url), "utf8"),
) as Record<string, string[]>;

/** Flat, deduped set of functional otag slugs from the grouped config. */
export function loadFunctionalOtags(): string[] {
  return [...new Set(Object.values(groups).flat())];
}
