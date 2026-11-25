import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import { abilityRowsOf, boardCountsOf, demandKeysOf } from "./partners-core.js";
import { segment } from "@edh-seer/tagger/segment";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/artifact-cost-1804.json" with { type: "json" };

/** #1804, owner ruling 2026-11-24: a cost that gets cheaper with, or is paid with, artifacts you control is an artifact demand: it asks for `counts|-|artifact|-` and pairs with artifact producers (the board-count reader, as "for each artifact you control" does).
 *  Affinity (CR 702.41a), improvise (702.126a), "This ability costs {1} less to activate for each other artifact you control" and "Tap X untapped artifacts you control" (`payment.tapOther`). Stored documents and clauses of the production corpus, 2026-11-25. */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] | null; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => {
  const src = F[name]!.source;
  // A card the grammar reads completely has no stored clauses: read it from its printed text, as derive-corpus does.
  const g = F[name]!.canonical === null ? grammarClauseRecords(src as never) : undefined;
  return { card: src as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(src as never, name, name, g ? g.records : F[name]!.canonical!, undefined, g?.readings)) as CardTags };
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

// THE SENTENCE SAYS WHAT THE COST DOES (#1804 review). A tap cost, an activation discount and a spell discount are not a count that makes the card "grow": "counts it and <grows>" was empty for a blanked effect (Whirler Rogue, Scotty)
// and false for a tap-cost loot (Network Terminal draws no more cards) or an ability discount (Pteramander's card costs the same).
const text = (p: string, c: string) => pairReasons(dc(p), dc(c), loadHierarchy()).filter((r) => r.tag === "scales:artifact" && r.producer === p && r.consumer === c).map((r) => r.text);
test.each([
  ["Whirler Rogue", "Whirler Rogue can tap Sol Ring to help pay for its ability"],
  ["Scotty, Chief Engineer", "Scotty, Chief Engineer can tap Sol Ring to help pay for its ability"],
  ["Network Terminal", "Network Terminal can tap Sol Ring to help pay for its ability"],
  ["Belisarius Cawl", "Belisarius Cawl can tap Sol Ring to help pay for its ability"],
  ["Merchant's Dockhand", "Merchant's Dockhand can tap Sol Ring to help pay for its ability"],
  ["Etherium Pteramander", "Sol Ring makes Etherium Pteramander's ability cheaper"],
  ["Tamiyo's Logbook", "Sol Ring makes Tamiyo's Logbook's ability cheaper"],
  ["Frogmite", "Sol Ring makes Frogmite cheaper to cast"],
  ["Fen Hauler", "Sol Ring makes Fen Hauler cheaper to cast"],
])("%s: the pair with Sol Ring says what the cost does", (c, want) => {
  expect(text("Sol Ring", c)).toEqual([want]);
});

test("no board-count sentence ends in a dangling 'and'", () => {
  for (const c of SHAPES.map(([n]) => n)) for (const t of text("Sol Ring", c)) expect(t, c).not.toMatch(/\b(?:and|so)\s*$/);
});

// THE SYNTHESIZED ROW SITS UNDER THE PRINTED CLAUSE IT IS READ FROM, or the card page, which joins rows to clauses by id, never shows it.
test("Pteramander's and Logbook's activation discount carries the id of the clause that prints it", () => {
  for (const n of ["Etherium Pteramander", "Tamiyo's Logbook"]) {
    const c = dc(n).card as { oracleText: string; keywords: string[]; typeLine: string };
    const printed = segment(c.oracleText, c.keywords, c.typeLine);
    const row = abilityRowsOf(dc(n)).find((r) => r.effect === "cost-reduction")!;
    expect(row, n).toBeDefined();
    expect(printed.find((x) => x.id === row.clause)?.text, n).toContain("This ability costs {1} less to activate");
  }
});
test("affinity and improvise rows sit under their keyword line", () => {
  for (const n of ["Frogmite", "Fen Hauler"]) {
    const c = dc(n).card as { oracleText: string; keywords: string[]; typeLine: string };
    const row = abilityRowsOf(dc(n)).find((r) => r.effect === "cost-reduction")!;
    expect(segment(c.oracleText, c.keywords, c.typeLine).find((x) => x.id === row.clause)?.text, n).toMatch(/^(?:Affinity for artifacts|Improvise)/);
  }
});
