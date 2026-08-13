import { describe, expect, it } from "vitest";
import {
  IDENTITY_HUE, OVERFLOW_HUE, PAINT_MODES, ROLE_HUE, TYPE_HUE, cmcBucket, cmcRamp, paintHues,
  paintLegend, rimArcs, rimHues, subcategoryLabel, type PaintMode,
} from "./presets.js";
import type { GraphNode } from "../types.js";

const node = (over: Partial<GraphNode>): GraphNode => ({
  id: "X", label: "X", copies: 1, types: [], subtypes: [], supertypes: [], colors: [], cmc: 0,
  ...over,
});
const mode = (id: string): PaintMode => PAINT_MODES.find((m) => m.id === id)!;

describe("PAINT_MODES", () => {
  it("ships the four facets a deck is read by, type first", () => {
    expect(PAINT_MODES.map((m) => m.id)).toEqual(["type", "identity", "role", "manaValue"]);
  });

  // Every mode has to answer for every card, or a deck paints holes. Roles are the only optional
  // field on the wire, and the role mode's fallback is what covers it.
  it("gives every mode something to say about a card with no roles and no colours", () => {
    const bare = node({ types: ["artifact"] });
    for (const m of PAINT_MODES) expect(paintHues(m, bare).length).toBeGreaterThan(0);
  });
});

describe("the type mode", () => {
  it("paints an Artifact Creature with one hue per type", () => {
    expect(paintHues(mode("type"), node({ types: ["artifact", "creature"] })))
      .toEqual([TYPE_HUE.artifact, TYPE_HUE.creature]);
  });

  // A fixed table, not hue-by-frequency: a creature is the same colour in every deck.
  it("gives a type the same hue whatever else the deck holds", () => {
    const m = mode("type");
    expect(m.hue("creature")).toBe(TYPE_HUE.creature);
  });

  it("falls back to the overflow hue for a type it has never heard of", () => {
    expect(mode("type").hue("kindred")).toBe(OVERFLOW_HUE);
  });
});

describe("the identity mode", () => {
  it("paints a Golgari card in both its colours, WUBRG order as the wire gives them", () => {
    expect(paintHues(mode("identity"), node({ colors: ["B", "G"] })))
      .toEqual([IDENTITY_HUE.B, IDENTITY_HUE.G]);
  });

  // Colourless is a VALUE, not an absence -- otherwise every artifact drops out of a legend it is
  // a real member of.
  it("paints a colourless card as colourless rather than leaving it bare", () => {
    expect(paintHues(mode("identity"), node({ colors: [] }))).toEqual([IDENTITY_HUE.C]);
    expect(mode("identity").valueLabel("C")).toBe("Colourless");
  });
});

describe("the role mode", () => {
  it("groups a build category into the role it belongs to", () => {
    expect(paintHues(mode("role"), node({ roles: ["targetedRemoval"] }))).toEqual([ROLE_HUE.interaction]);
  });

  it("paints a card in two different roles once for each", () => {
    expect(paintHues(mode("role"), node({ roles: ["ramp", "draw"] })))
      .toEqual([ROLE_HUE.ramp, ROLE_HUE.cardAdvantage]);
  });

  // Two categories of one role are one hue, not two identical arcs.
  it("does not repeat a role a card reaches by two categories", () => {
    expect(paintHues(mode("role"), node({ roles: ["targetedRemoval", "protection"] })))
      .toEqual([ROLE_HUE.interaction]);
  });

  it("sends a card no role claims to the strategy fallback", () => {
    expect(paintHues(mode("role"), node({}))).toEqual([ROLE_HUE.strategy]);
    expect(paintHues(mode("role"), node({ roles: [] }))).toEqual([ROLE_HUE.strategy]);
  });

  // The palette is the retired rooms' ROOM_HUE verbatim -- a validated set, not seven picked hues.
  it("keeps the validated palette values", () => {
    expect(ROLE_HUE).toEqual({
      strategy: "#1c8db7", wincons: "#b08e1d", cardAdvantage: "#5b40f6", ramp: "#146d9e",
      lands: "#21a28f", interaction: "#277310", boardWipes: "#6b89f9",
    });
  });
});

describe("the mana value mode", () => {
  it("buckets everything from seven upward into 7+", () => {
    expect(cmcBucket(7)).toBe("7+");
    expect(cmcBucket(12)).toBe("7+");
    expect(cmcBucket(6)).toBe("6");
  });

  it("gives a card exactly one hue", () => {
    expect(paintHues(mode("manaValue"), node({ cmc: 3 }))).toHaveLength(1);
  });

  // Ordered data gets a sequential ramp: two adjacent mana values must not be two unrelated hues.
  it("ramps monotonically rather than assigning categorical colours", () => {
    const hues = [0, 1, 2, 3, 4, 5, 6, 7].map(cmcRamp);
    expect(new Set(hues).size).toBe(8);
    expect(cmcRamp(9)).toBe(cmcRamp(7));
  });
});

describe("rimHues", () => {
  it("passes six or fewer through untouched", () => {
    expect(rimHues(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  // Past six the arcs stop being legible, so the sixth says "and more" rather than hues being
  // dropped silently.
  it("caps at six, the last one meaning 'and more'", () => {
    expect(rimHues(["a", "b", "c", "d", "e", "f", "g"]))
      .toEqual(["a", "b", "c", "d", "e", OVERFLOW_HUE]);
  });
});

describe("rimArcs", () => {
  it("splits the full circle into one equal arc per hue", () => {
    const arcs = rimArcs(["a", "b"]);
    expect(arcs).toHaveLength(2);
    expect(arcs[1].to - arcs[0].from).toBeCloseTo(Math.PI * 2);
    expect(arcs[0].to).toBeCloseTo(arcs[1].from);
  });

  it("draws nothing for a card with no hues", () => {
    expect(rimArcs([])).toEqual([]);
  });
});

describe("paintLegend", () => {
  const deck = [
    node({ id: "a", types: ["creature"], colors: ["B"], cmc: 2 }),
    node({ id: "b", types: ["creature"], colors: ["B", "G"], cmc: 4 }),
    node({ id: "c", types: ["land"], colors: [], cmc: 0, copies: 9 }),
  ];

  it("names every value present in the deck, and none that is not", () => {
    expect(paintLegend(mode("type"), deck).map((r) => r.value)).toEqual(["land", "creature"]);
    // Ordered by copies: the 9-copy colourless land outweighs the two black cards.
    expect(paintLegend(mode("identity"), deck).map((r) => r.value)).toEqual(["C", "B", "G"]);
  });

  // COPIES, not distinct names: a 9-land row that reads 1 is the number nobody can check a deck
  // against.
  it("counts copies, not nodes", () => {
    const land = paintLegend(mode("type"), deck).find((r) => r.value === "land")!;
    expect(land.count).toBe(9);
  });

  it("orders a categorical mode by count, descending", () => {
    expect(paintLegend(mode("type"), deck).map((r) => r.count)).toEqual([9, 2]);
  });

  // Role and mana value have an order of their own -- sorting either by popularity would make the
  // legend jump between decks.
  it("keeps the declared order for roles and the number line for mana value", () => {
    const roles = [node({ roles: ["boardWipe"] }), node({ roles: ["ramp"] }), node({ roles: ["ramp"] })];
    expect(paintLegend(mode("role"), roles).map((r) => r.value)).toEqual(["ramp", "boardWipes"]);
    expect(paintLegend(mode("manaValue"), deck).map((r) => r.value)).toEqual(["0", "2", "4"]);
  });

  it("carries a human label and the hue each row is drawn in", () => {
    const black = paintLegend(mode("identity"), deck).find((r) => r.value === "B")!;
    expect(black.label).toBe("Black");
    expect(black.hue).toBe(IDENTITY_HUE.B);
  });
});

describe("subcategoryLabel", () => {
  it("translates the categories whose engine key is jargon", () => {
    expect(subcategoryLabel("cardSelection")).toBe("digging");
    expect(subcategoryLabel("ramp")).toBe("extra mana");
  });

  it("leaves a category that is already plain English alone", () => {
    expect(subcategoryLabel("draw")).toBe("draw");
  });
});
