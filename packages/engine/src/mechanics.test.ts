import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { MECHANICS, mechanicCoverageSummary } from "./mechanics.js";
import { PATTERNS } from "./patterns.js";

const catalog = JSON.parse(
  readFileSync(fileURLToPath(new URL("./mechanics.catalog.json", import.meta.url)), "utf8"),
) as Record<"keyword-ability" | "keyword-action" | "ability-word", string[]> & { fetchedAt: string };

const SOURCES = ["keyword-ability", "keyword-action", "ability-word"] as const;

test("snapshot is present and well-formed", () => {
  expect(typeof catalog.fetchedAt).toBe("string");
  for (const s of SOURCES) expect(Array.isArray(catalog[s]) && catalog[s].length > 0).toBe(true);
});

test("every snapshot keyword is triaged in the registry (no untriaged)", () => {
  const names = new Set(MECHANICS.map((m) => m.mechanic));
  const untriaged: string[] = [];
  for (const s of SOURCES) for (const kw of catalog[s]) if (!names.has(kw)) untriaged.push(`${s}:${kw}`);
  expect(untriaged).toEqual([]);
});

test("no registry keyword entry is stale (missing from the snapshot)", () => {
  const catalogNames = new Set(SOURCES.flatMap((s) => catalog[s]));
  const stale = MECHANICS.filter((m) => m.source !== "archetype" && !catalogNames.has(m.mechanic)).map((m) => m.mechanic);
  expect(stale).toEqual([]);
});

test("each keyword entry's source matches the catalog it appears in", () => {
  const mismatched: string[] = [];
  for (const m of MECHANICS) {
    if (m.source === "archetype") continue;
    if (!catalog[m.source].includes(m.mechanic)) mismatched.push(`${m.mechanic} labeled ${m.source}`);
  }
  expect(mismatched).toEqual([]);
});

test("registry integrity: no dupes; covered/tighten wire real patterns; planned/skip omit patterns", () => {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const m of MECHANICS) {
    if (seen.has(m.mechanic)) dupes.push(m.mechanic);
    seen.add(m.mechanic);
  }
  expect(dupes).toEqual([]);

  const patternNames = new Set(PATTERNS.map((p) => p.name));
  for (const m of MECHANICS) {
    if (m.status === "covered" || m.status === "tighten") {
      expect(m.tags && m.tags.length > 0, `${m.mechanic} needs tags`).toBe(true);
      expect(m.patterns && m.patterns.length > 0, `${m.mechanic} needs patterns`).toBe(true);
      for (const pn of m.patterns!) expect(patternNames.has(pn), `${m.mechanic} -> unknown pattern ${pn}`).toBe(true);
    } else {
      expect(m.patterns, `${m.mechanic} (${m.status}) must omit patterns`).toBeUndefined();
    }
  }
});

test("coverage summary counts add up", () => {
  const s = mechanicCoverageSummary();
  expect(s.byStatus.covered + s.byStatus.tighten + s.byStatus.planned + s.byStatus.skip).toBe(s.total);
  expect(s.total).toBe(MECHANICS.length);
});
