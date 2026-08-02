import { readFileSync } from "node:fs";

const groups = JSON.parse(
  readFileSync(new URL("./functional-otags.json", import.meta.url), "utf8"),
) as Record<string, string[]>;

/** Flat, deduped set of functional otag slugs from the grouped config. */
export function loadFunctionalOtags(): string[] {
  return [...new Set(Object.values(groups).flat())];
}

/**
 * Descriptor slugs — `_descriptor_`-prefixed groups. These qualify a card (ability kind,
 * timing, targeting, rate) rather than naming a synergy event, and several sit on a quarter
 * of the corpus, so counting them would inflate coverage without adding pairing signal.
 */
export function loadDescriptorOtags(): string[] {
  return [
    ...new Set(
      Object.entries(groups)
        .filter(([name]) => name.startsWith("_descriptor_"))
        .flatMap(([, slugs]) => slugs),
    ),
  ];
}
