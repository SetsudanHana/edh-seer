import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import { boardCountsOf, demandKeysOf } from "./partners-core.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/artifact-cost-1804.json" with { type: "json" };

/** #1804, owner ruling 2026-11-24: a cost that gets cheaper with, or is paid with, artifacts you control is an artifact demand: it asks for `counts|-|artifact|-` and pairs with artifact producers (the board-count reader, as "for each artifact you control" does).
 *  Affinity (CR 702.41a), improvise (702.126a), "This ability costs {1} less to activate for each other artifact you control" and "Tap X untapped artifacts you control" (`payment.tapOther`). Stored documents and clauses of the production corpus, 2026-11-25. */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[]; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => {
  const src = F[name]!.source;
  return { card: src as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(src as never, name, name, F[name]!.canonical, undefined, undefined)) as CardTags };
};
const scales = (p: string, c: string) => pairReasons(dc(p), dc(c), loadHierarchy()).filter((r) => r.tag.startsWith("scales:") && r.producer === p && r.consumer === c).map((r) => r.tag);

const SHAPES: [string, string][] = [
  ["Frogmite", "affinity for artifacts"], ["Refurbished Familiar", "affinity for artifacts"], ["Demonic Junker", "affinity for artifacts"],
  ["Fen Hauler", "improvise"], ["Battle at the Bridge", "improvise"],
  ["Etherium Pteramander", "this ability costs {1} less to activate for each other artifact"], ["Tamiyo's Logbook", "this ability costs {1} less to activate for each other artifact"],
  ["Necron Overlord", "tap x untapped artifacts you control"],
];

test.each(SHAPES)("%s (%s) asks for artifacts you control", (name, printed) => {
  expect(F[name]!.source.oracleText!.toString().toLowerCase()).toContain(printed);
  expect(boardCountsOf(dc(name)).map((b) => b.key)).toContain("counts|-|artifact|-");
  expect(demandKeysOf(dc(name))).toContain("counts|-|artifact|-");
  expect(scales("Sol Ring", name), `Sol Ring -> ${name}`).toContain("scales:artifact");
  expect(scales("Grizzly Bears", name), `Grizzly Bears -> ${name}`).toEqual([]);
});
