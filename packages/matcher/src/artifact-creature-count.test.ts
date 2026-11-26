import { expect, test } from "vitest";
import { ComboIndex } from "@edh-seer/engine";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { analyzeDeckStructured } from "./analyze.js";
import { loadHierarchy, pairReasons } from "./index.js";
import { boardCountsOf, fodderDemandsOf, supplyKeysOf } from "./partners-core.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/artifact-creature-1813.json" with { type: "json" };

/** #1813, owner ruling 2026-11-26: a count, sacrifice outlet or tap cost over "artifact creatures" (both types at once: `allTypes`, a conjunction) keys on that narrow class. It pairs only with cards that ARE, or MAKE, artifact creatures (an Ornithopter, a Thopter
 *  maker) and never with a plain artifact or a plain creature. The gates read a type LIST as a disjunction (`types.length === 1`, `types.every(!WHOLE)`), so the conjunction got no key and no edge. Stored documents and clauses of the production corpus, 2026-11-26. */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] | null };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => {
  const src = F[name]!.source;
  const g = F[name]!.canonical === null ? grammarClauseRecords(src as never) : undefined;
  return { card: src as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(src as never, name, name, g ? g.records : F[name]!.canonical!, undefined, g?.readings)) as CardTags };
};
const tokens = (F as unknown as Record<string, Record<string, { ref: unknown; tags: CardTags }>>)["__tokens"]!;
const thopter = (): DeckCard => ({ card: { name: "Thopter", typeLine: "Token Artifact Creature — Thopter", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: Object.values(tokens).find((t) => t.tags.characteristics.subtypes.includes("thopter"))!.tags, isToken: true });
const tags = (p: DeckCard, c: DeckCard, opts = {}) => pairReasons(p, c, loadHierarchy(), opts).filter((r) => r.consumer === c.card.name && r.producer === p.card.name).map((r) => r.tag);
const CLASS = "artifact+creature";

test("the cards print artifact creatures", () => {
  expect(String(F["Collective Drone"]!.source.oracleText)).toBe("Collective Drone's power is equal to the number of artifact creatures you control.");
  expect(String(F["Reclamation Specialist"]!.source.oracleText)).toContain("Sacrifice an artifact creature: Draw a card.");
  expect(String(F["Collation Trimatrix"]!.source.oracleText)).toContain("Tap three untapped artifact creatures you control");
});

test.each([
  ["count", "Collective Drone", `scales:${CLASS}`],
  ["count", "Battle of Wolf 359", `scales:${CLASS}`],
  ["outlet", "Reclamation Specialist", `fodder:${CLASS}`],
  ["outlet", "Jan Jansen, Chaos Crafter", `fodder:${CLASS}`],
  ["tap cost", "Collation Trimatrix", `scales:${CLASS}`],
])("%s: %s pairs with an artifact creature and a Thopter, not with a plain artifact or a plain creature", (_k, c, tag) => {
  expect(tags(dc("Ornithopter"), dc(c)), `Ornithopter -> ${c}`).toContain(tag);
  expect(tags(thopter(), dc(c)), `Thopter -> ${c}`).toContain(tag);
  expect(tags(dc("Sol Ring"), dc(c)).filter((t) => t.includes(CLASS)), `Sol Ring -> ${c}`).toEqual([]);
  expect(tags(dc("Grizzly Bears"), dc(c)).filter((t) => t.includes(CLASS)), `Grizzly Bears -> ${c}`).toEqual([]);
});

test("a maker of an artifact creature (Harried Dronesmith, Thopters) is on the page of the count and of the outlet", () => {
  for (const [c, tag] of [["Collective Drone", `scales:${CLASS}`], ["Reclamation Specialist", `fodder:${CLASS}`]] as const) {
    expect(tags(dc("Harried Dronesmith"), dc(c), { tokensMediate: false }), c).toContain(tag);
    expect(tags(dc("Nim Lasher"), dc(c), { tokensMediate: false }).filter((t) => t.includes(CLASS)), `a plain artifact counter -> ${c}`).toEqual([]);
  }
});

test("in a deck, the Thopter node carries the maker to the count", () => {
  const MOUNTAIN = { card: { name: "Mountain", typeLine: "Basic Land — Mountain", oracleText: "{T}: Add {R}.", keywords: [], colors: [], manaValue: 0 }, tags: null } as unknown as DeckCard;
  const r = analyzeDeckStructured([dc("Collective Drone"), dc("Harried Dronesmith"), dc("Sol Ring"), ...Array.from({ length: 12 }, () => MOUNTAIN)], [], loadHierarchy(), undefined, new ComboIndex([]), undefined,
    (ref) => tokens[ref.printingId ?? ""]?.tags ?? null, undefined, [], [], { skipSimulation: true });
  const partner = (name: string) => r.cards.find((c) => c.name === "Collective Drone")!.topPartners!.find((p) => p.name === name);
  expect(partner("Harried Dronesmith")?.reasons.some((x) => x.tag === `scales:${CLASS}`)).toBe(true);
  expect(partner("Sol Ring")?.reasons.some((x) => x.tag === `scales:${CLASS}`) ?? false).toBe(false);
});

test("keys: the conjunction is asked for under its own key, and supplied by what is, or makes, an artifact creature", () => {
  expect(boardCountsOf(dc("Collective Drone")).map((b) => b.key)).toEqual([`counts|-|${CLASS}|-`]);
  expect(boardCountsOf(dc("Collation Trimatrix")).map((b) => b.key)).toContain(`counts|-|${CLASS}|-`);
  expect(fodderDemandsOf(dc("Reclamation Specialist")).map((k) => k.key)).toEqual([`fodder|-|${CLASS}|-`]);
  for (const k of [`counts|-|${CLASS}|-`, `fodder|-|${CLASS}|-`]) {
    expect(supplyKeysOf(dc("Ornithopter")), "Ornithopter").toContain(k);
    expect(supplyKeysOf(dc("Sol Ring")), "Sol Ring").not.toContain(k);
    expect(supplyKeysOf(dc("Grizzly Bears")), "Grizzly Bears").not.toContain(k);
  }
  expect(supplyKeysOf(dc("Harried Dronesmith"))).toContain(`fodder|-|${CLASS}|-`);
});

// REVIEW OF #1813: a token emit that is not an artifact creature must not stand in for one. The maker test reused the loose token-count one, so a Role token (Cut In), a copy of "artifact or creature" (Stolen Identity) and a typeless copy all paired. Only an emit whose `allTypes` holds EVERY member of the counted conjunction is a maker.
test.each(["Cut In", "Unassuming Sage", "Stolen Identity", "Vesuvan Duplimancy", "Relm's Sketching"])("%s makes no artifact creature: it pairs with neither the count, the tap cost nor the outlet", (maker) => {
  for (const c of ["Collective Drone", "Collation Trimatrix", "Battle of Wolf 359", "Reclamation Specialist", "Jan Jansen, Chaos Crafter"]) {
    for (const opts of [{}, { tokensMediate: false }]) {
      expect(tags(dc(maker), dc(c), opts).filter((t) => t.includes(CLASS)), `${maker} -> ${c} ${JSON.stringify(opts)}`).toEqual([]);
    }
  }
});

test("a copier of an artifact OR a creature supplies no conjunction key (and not artifact+land either)", () => {
  for (const n of ["Stolen Identity", "Vesuvan Duplimancy", "Relm's Sketching", "Cut In"]) {
    expect(supplyKeysOf(dc(n)).filter((k) => k.includes("+")), n).toEqual([]);
  }
});

test("Robobrain War Mind counts artifact creatures: an Ornithopter and a Thopter feed it, Sol Ring and Grizzly Bears do not", () => {
  expect(tags(dc("Ornithopter"), dc("Robobrain War Mind"))).toContain(`scales:${CLASS}`);
  expect(tags(thopter(), dc("Robobrain War Mind"))).toContain(`scales:${CLASS}`);
  for (const p of ["Sol Ring", "Grizzly Bears"]) expect(tags(dc(p), dc("Robobrain War Mind")).filter((t) => t.includes(CLASS)), p).toEqual([]);
});

test("an edict (Arcum Dagsson, Perilous Predicament) is no outlet of the card's own: no fodder key", () => {
  for (const c of ["Arcum Dagsson", "Perilous Predicament"]) {
    expect(fodderDemandsOf(dc(c)).filter((k) => k.key.includes("+")), c).toEqual([]);
    expect(tags(dc("Ornithopter"), dc(c)).filter((t) => t.includes(CLASS)), `Ornithopter -> ${c}`).toEqual([]);
  }
});

test("PROBE (reported, pre-existing): Saheeli, the Sun's Brilliance sacrifices its own token copies and keeps its fodder:creature tag", () => {
  expect(tags(dc("Grizzly Bears"), dc("Saheeli, the Sun's Brilliance")).filter((t) => t.includes(CLASS))).toEqual([]);
});
