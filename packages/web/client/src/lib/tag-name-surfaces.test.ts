import { describe, expect, test } from "vitest";
import { computeCohesion } from "@edh-seer/engine";
import type { CardGraph, DeckReport } from "../types.js";
import { buildEngineModel } from "./engine-model.js";
import { mainTheme } from "./main-theme.js";
import { buildOrbit } from "./orbit-model.js";
import { tagName } from "@edh-seer/engine";

/** #1170, owner 2026-11-24: ONE NAME PER KEY. A deck whose theme is `tag` is called one thing by the
 *  headline (cohesion -> mainTheme), the Plan's theme group, and the orbit disc's sector. One deck of
 *  each kind: a creature ETB deck, a cast-trigger deck, an instant deck, a tribe. */
function deckOf(tag: string): { report: DeckReport; graph: CardGraph } {
  const names = ["Hub", ...Array.from({ length: 8 }, (_, i) => `Card ${i + 1}`)];
  const reasons = names.slice(1).map((n) => ({ producer: n, consumer: "Hub", tag, text: `${n} feeds Hub` }));
  const report = {
    commanders: ["Hub"],
    cards: names.map((name) => ({ name, isCommander: name === "Hub", score: 1, manaCost: "" })),
    edges: reasons.map((r) => ({ a: r.producer, b: r.consumer, score: 1, reasons: [r] })),
    cohesion: computeCohesion([tag], new Map([[tag, 8]]), 9),
  } as unknown as DeckReport;
  const graph = {
    nodes: names.map((n) => ({ id: n, label: n, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: [], cmc: 2, roles: [] })),
    edges: [], undirectedReasons: 0, offDeckReasons: 0,
  } as unknown as CardGraph;
  return { report, graph };
}

describe("headline == group name == disc name", () => {
  const cases: [string, string][] = [
    ["enters:creature", "Creature ETBs"],
    ["cast:spell", "Cast triggers"],
    ["cast:instant-sorcery", "Spellslinger"],
    ["enters:wizard", "Wizard ETBs"],
  ];
  test.each(cases)("%s is %s on every surface", (tag, name) => {
    const { report, graph } = deckOf(tag);
    const m = buildEngineModel(report, graph);
    const headline = mainTheme(report);
    expect(headline?.name).toBe(name);
    // The link tag is folded where links are built (#543), so the group is the folded key.
    const group = m.groups.find((g) => !g.helper);
    expect(group?.name).toBe(name);
    const disc = buildOrbit(m, "Hub")!.sectors[0]!.name;
    expect(disc).toBe(name);
    // The card inspector's chip names the same key, so it reads the same name (#1170 PR 2).
    expect(tagName(tag)).toBe(name);
  });
});
