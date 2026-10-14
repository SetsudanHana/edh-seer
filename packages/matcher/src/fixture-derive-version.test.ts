/** Every fixture that carries a derived tag row carries it WHOLE and at the CURRENT `DERIVE_VERSION` (#1192). A fixture captured at an old
 *  version, or with only some of a row's fields, exercises the matcher against a derivation production no longer runs: it stays green while
 *  the engine moves. A derive bump therefore fails here until `refresh-fixtures.mts` is re-run. Mongo-free: it reads the committed JSON only. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { DERIVE_VERSION } from "@edh-seer/tagger";

const FIXTURES = [
  "fixtures/goldfish-cards.json",
  "fixtures/mana-colour-sources.json",
  "ramp-colour.fixtures.json",
  "same-job.fixtures.json",
  "quality.fixtures.json",
  "same-job.labels.cards.json",
] as const;
const HERE = dirname(fileURLToPath(import.meta.url));
const REFRESH = "npx tsx research/mana/refresh-fixtures.mts";

/** A card with no derived row is `tags: null` in a fixture. Derive never runs on a card that is not commander-legal (banned or not_legal), so
 *  that is the only legitimate absence; any other null row is a hole. */
const noRowByDesign = (r: Row) => r.tags === null && (r.card.commanderLegality === "banned" || r.card.commanderLegality === "not_legal");

type Row = { card: { name: string; commanderLegality?: string }; tags: { deriveVersion?: number } | null };
/** Every `{card, tags}` entry in a fixture, whichever of its three shapes (array, name-keyed object, `{cards, gisa.deck}`). */
function rows(json: unknown): Row[] {
  if (Array.isArray(json)) return json as Row[];
  const o = json as Record<string, unknown>;
  if (Array.isArray(o.cards)) return [...(o.cards as Row[]), ...((o.gisa as { deck: Row[] }).deck)];
  return Object.values(o) as Row[];
}

describe("fixture derived rows are whole and current", () => {
  for (const file of FIXTURES) {
    test(file, () => {
      const everyRow = rows(JSON.parse(readFileSync(join(HERE, file), "utf8")));
      const all = everyRow.filter((r) => !noRowByDesign(r));
      expect(all.length, `${file} has rows`).toBeGreaterThan(0);
      const missing = all.filter((r) => r.tags?.deriveVersion === undefined).map((r) => r.card.name);
      const stale = all.filter((r) => r.tags?.deriveVersion !== undefined && r.tags.deriveVersion !== DERIVE_VERSION).map((r) => `${r.card.name}@${r.tags!.deriveVersion}`);
      const hint = `packages/matcher/src/${file}: DERIVE_VERSION is ${DERIVE_VERSION}; refresh with \`${REFRESH}\``;
      const some = (xs: string[]) => `${xs.length} of ${all.length}: ${xs.slice(0, 5).join(", ")}`;
      expect(missing.length, `${hint} — rows with no deriveVersion, ${some(missing)}`).toBe(0);
      expect(stale.length, `${hint} — rows at another version, ${some(stale)}`).toBe(0);
    });
  }
});
