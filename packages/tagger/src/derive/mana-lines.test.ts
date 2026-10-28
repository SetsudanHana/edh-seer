/** `manaLines` (#1169): the mana production of a card, read once in derive. EVERY CARD HERE IS REAL INPUT:
 *  `mana-lines.fixtures.json` holds the card document fields and the clause records derive used, dumped from Mongo
 *  by `research/mana/dump-mana-fixtures.mts`, so an assertion is about what the corpus carries and not about a card
 *  as remembered. The fixtures are not the production tags (no Mongo in the suite); they are its input. */
import { describe, expect, it } from "vitest";
import { deriveInputOf } from "../derive-input.js";
import { deriveCardTags } from "./derive.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import type { CardTags, ManaLine } from "../schema.js";
import { replacementAddedToken, scaleBounds, selfPutReady as selfPut, unpricedLoyaltyLines } from "./mana-lines.js";
import { COMMANDER_OPPONENTS, COMMANDER_PLAYERS } from "../table.js";
import fixtures from "./mana-lines.fixtures.json" with { type: "json" };

const WUBRG = ["W", "U", "B", "R", "G"];
const tagsOf = (name: string): CardTags => {
  const fx = (fixtures as unknown as Record<string, { card: Record<string, unknown> & { _id: string; name: string }; clauses: never[] }>)[
    Object.keys(fixtures).find((k) => k === name || k.startsWith(`${name} //`)) ?? name]!;
  expect(fx, `fixture for ${name}`).toBeDefined();
  return deriveCardTags(deriveInputOf(fx.card as never, fx.card._id, fx.card.name, fx.clauses));
};
const selfPutReady = (...a: Parameters<typeof selfPut>): number | null => selfPut(...a)?.readyTurn ?? null;
const linesOf = (name: string, source?: ManaLine["source"]): ManaLine[] =>
  (tagsOf(name).manaLines ?? []).filter((l) => source === undefined || l.source === source);
const only = (name: string, source?: ManaLine["source"]): ManaLine => {
  const ls = linesOf(name, source);
  expect(ls, `${name} lines`).toHaveLength(1);
  return ls[0]!;
};
const FREE_TAP = { mana: 0, tap: true, sacrificeSelf: false, sacrificeOther: false, life: 0, counters: null, tapOther: false, loyalty: null, consumes: [], other: [] };

describe("tap abilities: cost, colours and amount", () => {
  it("Sol Ring taps for two colourless, free", () => {
    expect(only("Sol Ring")).toMatchObject({ face: 0, source: "activated", repeats: "per-cycle", cost: FREE_TAP, colours: [], colourless: 2,
      anyColour: null, amount: { fixed: 2, scales: null }, net: 2, gate: null, restriction: null, timing: "now", producesToken: null });
  });
  it("Arcane Signet chooses within the commander's identity, which the text does not name", () => {
    expect(only("Arcane Signet")).toMatchObject({ source: "activated", anyColour: "identity", colours: [], amount: { fixed: 1, scales: null }, net: 1 });
  });
  it("Cascade Bluffs: the filter line pays 1 and makes 2 of its two colours, the plain line is colourless", () => {
    const [plain, filter] = linesOf("Cascade Bluffs");
    expect(plain).toMatchObject({ colours: [], colourless: 1, cost: FREE_TAP, net: 1 });
    expect(filter).toMatchObject({ source: "activated", cost: { mana: 1, tap: true }, colours: ["U", "R"], amount: { fixed: 2, scales: null }, net: 1, restriction: null });
  });
  it("Cascading Cataracts: five mana in any colour for {5} nets nothing", () => {
    const [plain, five] = linesOf("Cascading Cataracts");
    expect(plain).toMatchObject({ colourless: 1, net: 1 });
    expect(five).toMatchObject({ cost: { mana: 5, tap: true }, anyColour: "any", colours: WUBRG, amount: { fixed: 5, scales: null }, net: 0 });
  });
  it("Tainted Peak: the coloured line is gated on a Swamp; Exotic Orchard is bounded by the opponents' lands", () => {
    const [plain, gated] = linesOf("Tainted Peak");
    expect(plain.gate).toBeNull();
    expect(gated).toMatchObject({ colours: ["B", "R"], gate: { kind: "control", text: "you control a swamp" }, amount: { fixed: 1, scales: null } });
    expect(only("Exotic Orchard")).toMatchObject({ anyColour: "opponent-lands", colours: [], face: 0 });
  });
  it("Llanowar Elves is a one-colour tap", () => {
    expect(only("Llanowar Elves")).toMatchObject({ colours: ["G"], colourless: 0, cost: FREE_TAP, net: 1 });
  });
});

describe("a tap whose mana depends on something the line must state (#1188)", () => {
  it("Selvala, Explorer Returned: 'for each nonland card revealed this way, add {G}' scales, it is not a fixed 1", () => {
    expect(only("Selvala, Explorer Returned")).toMatchObject({ colours: ["G"], amount: { fixed: null, scales: "for each nonland card revealed this way" }, gate: null });
  });
  it("Deathrite Shaman needs a land card in a graveyard to target, so the line is gated on it (CR 602.2b, 601.2c); its other two abilities add nothing", () => {
    expect(only("Deathrite Shaman")).toMatchObject({ anyColour: "any", amount: { fixed: 1, scales: null }, gate: { kind: "unknown", text: "a legal target exists: target land card from a graveyard" } });
  });
  it("Red Death, Shipwrecker needs a target creature an opponent controls", () => {
    expect(only("Red Death, Shipwrecker")).toMatchObject({ colours: ["R"], gate: { kind: "unknown", text: "a legal target exists: target creature an opponent controls" } });
  });
  it("Corrupted Grafstone makes no mana with an empty graveyard", () => {
    expect(only("Corrupted Grafstone")).toMatchObject({ anyColour: "among", gate: { kind: "threshold", need: 1, text: "there is a card in your graveyard" } });
  });
  it("Rite of Flame: '{R}{R}, then {R} for each ...' scales but its net keeps the printed floor of 2 (net 1 on a 1-mana spell); Bloom Tender keeps the ceiling of 1", () => {
    // #1265: the model reads two adds; the {R}{R} is a FIXED sibling line (it keeps its 2, net 1 on the 1-mana spell) and only the "{R} for each" add scales (net 0)
    const [first, second] = linesOf("Rite of Flame");
    expect(first).toMatchObject({ amount: { fixed: 2, scales: null }, cost: { mana: 1 }, net: 1 });
    expect(second).toMatchObject({ amount: { fixed: null, scales: "for each card named ~ in each graveyard" }, cost: { mana: 1 }, net: 0 });
    expect(only("Bloom Tender")).toMatchObject({ amount: { fixed: null }, net: 1 });
  });
  it("'for each color among permanents you control' is guaranteed the card's own colours: Faeburrow Elder (G, W) nets 2, Bloom Tender (G) nets 1", () => {
    expect(only("Faeburrow Elder")).toMatchObject({ amount: { fixed: null, scales: "for each color among permanents you control" }, net: 2 });
    expect(only("Bloom Tender")).toMatchObject({ amount: { fixed: null, scales: "for each color among permanents you control" }, net: 1 });
  });
  it("a plain tap stays ungated and fixed (Llanowar Elves, Birds of Paradise)", () => {
    expect(only("Llanowar Elves")).toMatchObject({ amount: { fixed: 1, scales: null }, gate: null });
    expect(only("Birds of Paradise")).toMatchObject({ amount: { fixed: 1, scales: null }, gate: null });
  });
});

describe("a cost the segmenter did not split", () => {
  it("Wall of Roots pays with a counter (typed static by the model); Contamination's replacement is no line", () => {
    expect(only("Wall of Roots")).toMatchObject({ source: "activated", colours: ["G"], cost: { mana: 0, tap: false, counters: "put", other: [] } });
    expect(tagsOf("Contamination").manaLines).toBeUndefined();
  });
  it("Aether Hub's second line pays {E} beside the tap", () => {
    const [plain, energy] = linesOf("Aether Hub");
    expect(plain).toMatchObject({ colourless: 1, cost: { other: [] } });
    expect(energy).toMatchObject({ anyColour: "any", cost: { tap: true, other: ["Pay {E}"], consumes: ["energy"] } });
  });
});

describe("restricted mana", () => {
  it("Smokebraider: two mana of any colour, spent only on Elementals", () => {
    expect(only("Smokebraider")).toMatchObject({ anyColour: "any", amount: { fixed: 2, scales: null },
      restriction: { spend: "to cast elemental spells or activate abilities of elementals", typeName: "elemental" } });
  });
  it("Omen Hawker: {C}{U} that only activates abilities", () => {
    const l = only("Omen Hawker");
    expect(l).toMatchObject({ colours: ["U"], colourless: 1, amount: { fixed: 2, scales: null } });
    expect(l.restriction).toEqual({ spend: "to activate abilities", minManaValue: null });
  });
  it("Cavern of Souls: the coloured line spends on the chosen type; Ancient Ziggurat on creature spells", () => {
    const [plain, coloured] = linesOf("Cavern of Souls");
    expect(plain.restriction).toBeNull();
    expect(coloured).toMatchObject({ anyColour: "any", restriction: { typeName: "chosen" } });
    expect(only("Ancient Ziggurat").restriction).toMatchObject({ spend: "to cast a creature spell", typeName: "creature" });
  });
});

describe("what using the line consumes", () => {
  it("Phyrexian Altar sacrifices something else, not itself, and does not tap", () => {
    expect(only("Phyrexian Altar")).toMatchObject({ source: "activated", repeats: "repeatable", anyColour: "any",
      cost: { mana: 0, tap: false, sacrificeSelf: false, sacrificeOther: true, life: 0, counters: null, tapOther: false, loyalty: null, consumes: [], other: [] } });
  });
  it("Priest of Forgotten Gods taps and sacrifices two others for {B}{B}", () => {
    expect(only("Priest of Forgotten Gods")).toMatchObject({ source: "activated", colours: ["B"], amount: { fixed: 2, scales: null }, gate: null,
      cost: { tap: true, sacrificeSelf: false, sacrificeOther: true } });
  });
  it("Cryptic Trilobite pays with a counter, and the mana only activates abilities", () => {
    const l = only("Cryptic Trilobite");
    expect(l).toMatchObject({ colourless: 2, repeats: "repeatable", cost: { mana: 0, tap: false, counters: "remove", tapOther: false, other: [] } });
    expect(l.restriction).toEqual({ spend: "to activate abilities", minManaValue: null });
  });
  it("Lotus Petal sacrifices itself: a one-shot", () => {
    expect(only("Lotus Petal")).toMatchObject({ cost: { tap: true, sacrificeSelf: true, sacrificeOther: false }, repeats: "once" });
    expect(tagsOf("Lotus Petal").isOneShot).toBe(true);
    expect(tagsOf("Phyrexian Altar").isOneShot).toBeUndefined();
    expect(tagsOf("Sol Ring").isOneShot).toBeUndefined();
  });
});

describe("triggers, auras and spells", () => {
  it("Birgi's front face adds {R} when you cast a spell: trigger mana, no tap line; the back face has no line", () => {
    const ls = linesOf("Birgi, God of Storytelling");
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ face: 0, source: "trigger", timing: "on-trigger", colours: ["R"], cost: { mana: 0, tap: false }, repeats: "repeatable" });
  });
  it("Utopia Sprawl adds one of the chosen colour, Wild Growth {G}, each time the land taps", () => {
    expect(only("Utopia Sprawl")).toMatchObject({ source: "aura-trigger", anyColour: "chosen", colours: [], amount: { fixed: 1, scales: null }, timing: "on-trigger", cost: { mana: 0, tap: false } });
    expect(only("Wild Growth")).toMatchObject({ source: "aura-trigger", colours: ["G"], amount: { fixed: 1, scales: null } });
  });
  it("Dark Ritual is a one-shot spell: {B}{B}{B} for its {B}, net +2", () => {
    expect(only("Dark Ritual")).toMatchObject({ source: "one-shot-spell", repeats: "once", colours: ["B"], amount: { fixed: 3, scales: null },
      cost: { mana: 1, tap: false }, net: 2, timing: "now" });
    expect(tagsOf("Dark Ritual").isOneShot).toBe(true);
  });
});

describe("amounts and gates the goldfish reads (DERIVE_VERSION 302)", () => {
  it("Relic of Sauron: two mana in any combination of three colours is an amount of 2, not 1", () => {
    expect(only("Relic of Sauron")).toMatchObject({ colours: ["U", "B", "R"], anyColour: null, amount: { fixed: 2, scales: null }, net: 2 });
  });
  it("Muraganda Raceway: the Max speed line is gated, the plain one is not", () => {
    const [plain, speed] = linesOf("Muraganda Raceway");
    expect(plain).toMatchObject({ amount: { fixed: 1, scales: null }, gate: null });
    expect(speed).toMatchObject({ amount: { fixed: 2, scales: null }, gate: { kind: "speed", n: 4 } });
  });
});

describe("what fires a trigger line (DERIVE_VERSION 302)", () => {
  it("Lotus Cobra is landfall: `enters` on a land you control", () => {
    expect(only("Lotus Cobra", "trigger")).toMatchObject({ trigger: { event: "enters", text: "a land you control", subject: { control: "you", type: "land" } }, anyColour: "any", amount: { fixed: 1, scales: null } });
  });
  it("Burning-Tree Emissary's enters trigger is `enters` on the card itself, not landfall", () => {
    const l = only("Burning-Tree Emissary", "trigger");
    expect(l.trigger?.event).toBe("enters");
    expect(l.trigger?.subject).toMatchObject({ self: true });
    expect(l.trigger?.subject?.type).not.toBe("land");
  });
  it("a beginning-of-phase adder names the phase: Hulking Raptor and Eladamri's Vineyard `main-phase`", () => {
    expect(only("Hulking Raptor", "trigger")).toMatchObject({ trigger: { event: "main-phase" }, amount: { fixed: 2, scales: null }, gate: null, restriction: null });
    expect(only("Eladamri's Vineyard", "trigger")).toMatchObject({ trigger: { event: "main-phase" }, amount: { fixed: 2, scales: null } });
  });
  it("Birgi's cast trigger is `cast`", () => {
    expect(only("Birgi, God of Storytelling", "trigger")).toMatchObject({ trigger: { event: "cast", text: "a spell", subject: { type: "spell" } } });
  });
  it("an Aura's line is `tapped-for-mana` on the enchanted land; so is Forsaken Monument's, which is no Aura", () => {
    expect(only("Wild Growth", "aura-trigger")).toMatchObject({ trigger: { event: "tapped-for-mana", text: "enchanted land", subject: { type: "land" } } });
    expect(only("Forsaken Monument", "trigger")).toMatchObject({ trigger: { event: "tapped-for-mana" } });
  });
  it("only a trigger or aura-trigger line names an event", () => {
    for (const n of ["Sol Ring", "Dark Ritual", "Pitiless Plunderer", "Cultivate", "Chromatic Lantern"]) {
      for (const l of linesOf(n)) expect([l.source, l.trigger]).toEqual([l.source, null]);
    }
  });
  it("Ashling, Rimebound: one add fired by a transform AND the first main phase is named for the phase, and its two mana are read through the restriction sentence", () => {
    const ls = linesOf("Ashling, Rekindled", "trigger");
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ face: 1, trigger: { event: "main-phase", text: "your first main phase" }, anyColour: "any", amount: { fixed: 2, scales: null },
      restriction: { spend: "to cast spells with mana value 4 or greater", minManaValue: 4 } });
  });
  it("a transform trigger alone stays a transform trigger (Alluring Suitor's back)", () => {
    expect(linesOf("Ashling, Flame Dancer", "trigger").every((l) => l.trigger?.event === "cast" || l.trigger?.event === "copy")).toBe(true);
  });
  it("Ashling's two clauses (cast, copy) are one printed add and keep the first event", () => {
    const ls = linesOf("Ashling, Flame Dancer", "trigger");
    expect(new Set(ls.map((l) => JSON.stringify({ ...l, trigger: null }))).size).toBe(ls.length);
  });
});

describe("faces", () => {
  it("Treasure Map // Treasure Cove: the land back's {T}: Add {C} is on face 1, the front makes Treasures", () => {
    const tap = only("Treasure Map", "activated");
    expect(tap).toMatchObject({ face: 1, colourless: 1, cost: FREE_TAP });
    expect(only("Treasure Map", "token-maker")).toMatchObject({ face: 0, producesToken: "treasure", cost: { mana: 1, tap: true } });
  });
});

describe("tokens that are mana sources, and fetches", () => {
  it("Pitiless Plunderer makes Treasures and taps for nothing", () => {
    const ls = linesOf("Pitiless Plunderer");
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ source: "token-maker", producesToken: "treasure", repeats: "repeatable", anyColour: "any", amount: { fixed: 1, scales: null } });
  });
  it("Cultivate fetches two lands, one onto the battlefield tapped", () => {
    expect(tagsOf("Cultivate").landFetch).toEqual({ kind: "spell", tapped: true, reach: WUBRG });
    expect(only("Cultivate")).toMatchObject({ source: "fetch", repeats: "once", colours: WUBRG, amount: { fixed: 1, scales: null }, cost: { mana: 3 } });
    expect(tagsOf("Cultivate").isOneShot).toBeUndefined();
  });
  it("Farseek reaches four colours; Evolving Wilds is a permanent that fetches", () => {
    expect(tagsOf("Farseek").landFetch).toEqual({ kind: "spell", tapped: true, reach: ["W", "U", "B", "R"] });
    expect(tagsOf("Evolving Wilds").landFetch).toEqual({ kind: "permanent", tapped: true, reach: WUBRG });
  });
  it("Kodama's Reach and Path to the Festival fetch (the grammar path drops the library origin); Expand the Sphere digs and does not", () => {
    expect(tagsOf("Kodama's Reach").landFetch).toEqual({ kind: "spell", tapped: true, reach: WUBRG });
    expect(tagsOf("Path to the Festival").landFetch).toEqual({ kind: "spell", tapped: true, reach: WUBRG });
    expect(tagsOf("Expand the Sphere").landFetch).toBeUndefined();
    expect(tagsOf("Expand the Sphere").manaLines).toBeUndefined();
  });
  it("a card that fetches nothing carries none", () => {
    expect(tagsOf("Sol Ring").landFetch).toBeUndefined();
  });
});

describe("static fixers and suspend", () => {
  it("Chromatic Lantern gives lands the ability; its own tap is a second line", () => {
    expect(tagsOf("Chromatic Lantern").staticFixer).toEqual({ covers: "lands", colours: WUBRG });
    expect(linesOf("Chromatic Lantern").map((l) => l.source)).toEqual(["static-grant", "activated"]);
  });
  it("Chromatic Orrery lets any mana be spent as any colour; Prismatic Omen makes lands every type", () => {
    expect(tagsOf("Chromatic Orrery").staticFixer).toEqual({ covers: "all", colours: WUBRG });
    expect(tagsOf("Prismatic Omen").staticFixer).toEqual({ covers: "lands", colours: WUBRG });
    expect(tagsOf("Urborg, Tomb of Yawgmoth").staticFixer).toEqual({ covers: "lands", colours: ["B"] });
    expect(tagsOf("Sol Ring").staticFixer).toBeUndefined();
  });
  it("Pulse of Llanowar fixes BASIC lands in every colour and is no mana source itself (#1210 task 4); Mirri (vanguard) is dropped by type", () => {
    const text = "If a basic land you control is tapped for mana, it produces mana of a color of your choice instead of any other type.";
    const of = (name: string, typeLine: string) => {
      const card = { name, typeLine, oracleText: text, keywords: [] as string[] };
      const g = grammarClauseRecords(card);
      return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings));
    };
    const pulse = of("Pulse of Llanowar", "Enchantment");
    expect(pulse.staticFixer).toEqual({ covers: "basics", colours: WUBRG });
    expect(pulse.manaLines).toBeUndefined();
    expect(of("Mirri", "Vanguard").staticFixer).toBeUndefined();
  });
  it("Mox Tantalite and Lotus Bloom are suspend-only; a Mox with a cost is not", () => {
    expect(tagsOf("Mox Tantalite").suspendOnly).toBe(true);
    expect(tagsOf("Lotus Bloom").suspendOnly).toBe(true);
    expect(only("Mox Tantalite")).toMatchObject({ anyColour: "any", cost: FREE_TAP });
    expect(tagsOf("Sol Ring").suspendOnly).toBeUndefined();
  });
});

describe("a card with no mana carries none of it", () => {
  it("writes nothing for Urborg's lines and nothing at all on a card that has none", () => {
    expect(tagsOf("Urborg, Tomb of Yawgmoth").manaLines).toBeUndefined();
    // `unclaimed` (#1299) is not a mana key: Urborg's "each land is a Swamp" is an action nothing claims, and says nothing about mana.
    expect(Object.keys(tagsOf("Urborg, Tomb of Yawgmoth")).filter((k) => k !== "unclaimed").sort()).toEqual(
      ["abilities", "characteristics", "model", "oracleId", "promptVersion", "schemaVersion", "staticFixer"]);
  });
});

describe("review fixes (#1169 task 1)", () => {
  it("a scaling amount the grammar path puts in action.amount is still a scaling amount", () => {
    expect(only("Gaea's Cradle").amount).toMatchObject({ fixed: null, scales: "for each creature you control" });
    expect(only("Priest of Titania").amount).toMatchObject({ fixed: null, scales: "for each elf on the battlefield" });
    // and the model path, which keeps it in the object
    expect(only("Selvala, Eager Trailblazer").amount.fixed).toBeNull();
    for (const n of ["Overgrown Battlement", "Cloudpost", "Gyre Sage", "Bighorner Rancher", "Karametra's Acolyte", "Rite of Flame", "Inner Fire"]) {
      expect(linesOf(n).some((l) => l.amount.scales !== null), n).toBe(true);
    }
  });
  it("a land fetch needs the printed 'search your library' and you as the searcher", () => {
    for (const n of ["Zimone's Experiment", "Bounty of Skemfar", "Old-Growth Dryads", "Hired Giant", "Turtle Tracks"]) {
      expect(tagsOf(n).landFetch, n).toBeUndefined();
      expect(linesOf(n, "fetch"), n).toHaveLength(0);
    }
    expect(tagsOf("Alpine Guide").landFetch).toMatchObject({ reach: ["R"] });
  });
  it("the misses are closed: Myriad Landscape, Shefet Monitor, Dance of the Tumbleweeds, Titania's Command, Travel Through Caradhras", () => {
    for (const n of ["Myriad Landscape", "Shefet Monitor", "Dance of the Tumbleweeds", "Titania's Command", "Travel Through Caradhras", "Space Marine Scout", "Deep Gnome Terramancer"]) {
      expect(tagsOf(n).landFetch, n).toBeDefined();
    }
    // KNOWN GAP: a creature-or-land search that puts the land only conditionally.
    expect(tagsOf("Archdruid's Charm").landFetch).toBeUndefined();
  });
  it("a fetch never carries an empty reach", () => {
    for (const fx of Object.keys(fixtures)) {
      const t = tagsOf(fx.split(" // ")[0]!);
      for (const l of t.manaLines ?? []) if (l.source === "fetch") expect(l.colours.length, fx).toBeGreaterThan(0);
      if (t.landFetch) expect(t.landFetch.reach.length, fx).toBeGreaterThan(0);
    }
  });
  it("Cabal Ritual's threshold line is gated, the plain line is not", () => {
    const [plain, threshold] = linesOf("Cabal Ritual");
    expect(plain.gate).toBeNull();
    expect(threshold).toMatchObject({ amount: { fixed: 5 }, gate: { kind: "threshold", need: 7, text: "there are seven or more cards in your graveyard" } });
  });
  it("counters and tapping other permanents are structured", () => {
    expect(only("Cryptic Trilobite").cost).toMatchObject({ counters: "remove", other: [] });
    expect(linesOf("Springleaf Drum")[0]!.cost).toMatchObject({ tap: true, tapOther: true, other: [] });
  });
  it("a line whose production cannot be read says so", () => {
    // Chrome Mox, Bloom Tender and Meteor Crater are bounded now (`among`, task 2a review); a mill-for-colours line is still unread.
    for (const n of ["Charmed Pendant"]) expect(only(n).unread, n).toBe(true);
    expect(only("Sol Ring").unread).toBe(false);
    expect(only("Arcane Signet").unread).toBe(false);
  });
});

describe("review round 2 (#1169 task 1)", () => {
  it("a number word on action.amount is a fixed amount, not a scaling one", () => {
    expect(only("Cosmic Crucible").amount).toEqual({ fixed: 4, scales: null });
    expect(only("Cosmic Crucible").net).toBe(4);
    expect(only("Omnath, Locus of All").amount).toEqual({ fixed: 3, scales: null });
  });
  it("Halo Forager's {X} is deliberately a scaling amount named x (chosen when paid)", () => {
    expect(only("Halo Forager").amount).toEqual({ fixed: null, scales: "x" });
  });
  it("'If <condition>, add Y instead' gates the instead line and leaves the plain line alone", () => {
    for (const n of ["Urza's Tower", "Leafkin Druid", "Raucous Audience", "Ilysian Caryatid", "Incubation Druid", "Orochi Merge-Keeper"]) {
      const ls = linesOf(n);
      const last = ls[ls.length - 1]!;
      expect(last.gate, n).not.toBeNull();
      expect(ls[0]!.gate, n).toBeNull();
    }
    expect(linesOf("Urza's Tower")[1]).toMatchObject({ colourless: 3, gate: { kind: "tron", names: ["urza's mine", "urza's power-plant"] } });
  });
  it("typed gates (#1191): a basic-land count (Gleaming Bastion) and a power count (Fanatic of Rhonas) are control gates, no longer unknown", () => {
    expect(linesOf("Gleaming Bastion").map((l) => l.gate)).toContainEqual(expect.objectContaining({ kind: "control", need: 1, nouns: ["land"], basic: true }));
    expect(linesOf("Fanatic of Rhonas").map((l) => l.gate)).toContainEqual(expect.objectContaining({ kind: "control", need: 1, nouns: ["creature"], minPower: 4 }));
  });
  it("#1267 the 18 gated lines the owner made estimable (2026-10-17): each real card's gate parses to its kind, from the card's own derive", () => {
    const gates = (n: string): ManaLine["gate"][] => linesOf(n).map((l) => l.gate).filter((g) => g !== null);
    const kinds: [string, string, Record<string, unknown>][] = [
      ["Cabal Ritual", "threshold", { need: 7 }], ["Far Wanderings", "threshold", { need: 7 }], ["Corrupted Grafstone", "threshold", { need: 1 }], ["The Grey Havens", "threshold", { need: 1, types: ["creature"], supertypes: ["legendary"] }],
      ["Dark Petition", "threshold", { need: 2, types: ["instant", "sorcery"] }], ["Lys Alana Dignitary", "threshold", { need: 1, subtypes: ["elf"] }],
      ["Charitable Levy", "counter", { counter: "collection", need: 3 }], ["Gemstone Caverns", "counter", { counter: "luck", need: 1 }], ["Incubation Druid", "counter", { counter: "+1/+1", need: 1 }],
      ["Pyramid of the Pantheon", "counter", { counter: "brick", need: 3 }], ["Tablet of Compleation", "counter", { counter: "oil", need: 2 }],
      ["Famished Foragers", "turn-event", { event: "opponent-lost-life" }], ["Flamecache Gecko", "turn-event", { event: "opponent-lost-life" }], ["Mirrex", "turn-event", { event: "entered-this-turn" }],
      ["Hidden Herbalists", "turn-event", { event: "permanent-left" }], ["Mardu Warshrieker", "turn-event", { event: "attacked" }], ["River of Tears", "turn-event", { event: "land-played" }],
    ];
    for (const [n, kind, rest] of kinds) expect(gates(n), n).toContainEqual(expect.objectContaining({ kind, ...rest }));
  });
  it("#1267 a counter gate says where its counters come from, read off the card's own words (reminder text stripped), with the REAL ready turn of each card", () => {
    const counter = (n: string) => linesOf(n).map((l) => l.gate).find((g) => g?.kind === "counter");
    // Pyramid (mana value 1): cast turn 1; its put costs {2}, so the first put is turn 2, then 3 and 4 -- three counters, ready turn 5.
    expect(counter("Pyramid of the Pantheon")).toMatchObject({ put: { by: "self", readyTurn: 5 } });
    // Tablet (mana value 2): a free {T} put, cast turn 2, puts on turns 2 and 3, ready turn 4.
    expect(counter("Tablet of Compleation")).toMatchObject({ put: { by: "self", readyTurn: 4 } });
    // Charitable Levy's counters come from a TRIGGER on every noncreature spell anyone casts: not an activation a turn, so it has no put and the gate is unmet (owner review 2026-10-17).
    expect((counter("Charitable Levy") as { put?: unknown }).put).toBeUndefined();
    expect(counter("Gemstone Caverns")).toMatchObject({ put: { by: "opening-hand" } });
    // Incubation Druid's "{3}{G}{G}: Adapt 3" puts its own counters on it when {3}{G}{G} is PAID (turn 5, after the turn after its cast, mana value 2): the counter is there the turn AFTER, turn 6
    expect(counter("Incubation Druid")).toMatchObject({ put: { by: "self", readyTurn: 6 } });
    expect(counter("The Grey Havens")).toBeUndefined();
  });
  it("#1267 Incubation Druid's 'three mana of that type instead' is READ: the type is the line before's, any a land you control could produce", () => {
    const [plain, instead] = linesOf("Incubation Druid");
    expect(plain).toMatchObject({ anyColour: "lands-you-could", unread: false, amount: { fixed: 1 }, gate: null });
    expect(instead).toMatchObject({ anyColour: "lands-you-could", unread: false, amount: { fixed: 3 }, gate: { kind: "counter" } });
  });
  it("#1267 keyword self-puts of +1/+1 counters: Adapt and Monstrosity at the activation, Outlast one counter per activation, Evolve not at all", () => {
    // mana value 2 => cast turn 2, first activation turn 3 at the earliest; Adapt and Monstrosity resolve on the activation, so the counters are there the turn AFTER it is paid
    expect(selfPutReady("{3}{g}{g}: adapt 3", "+1/+1", 2, 1, false)).toBe(6);
    expect(selfPutReady("{1}{g}: adapt 3", "+1/+1", 2, 1, false)).toBe(4);
    expect(selfPutReady("{3}{g}{g}: adapt 3", "+1/+1", 2, 4, false)).toBeNull();
    expect(selfPutReady("{5}{r}{r}: monstrosity 3", "+1/+1", 3, 2, false)).toBe(8);
    expect(selfPutReady("{4}{r}, {t}: monstrosity 2", "+1/+1", 1, 2, false)).toBe(6);
    // Outlast {W}: one counter per {T} activation, so need 2 is two activations: 3, 4 => ready 5 (mana value 2)
    expect(selfPutReady("outlast {w}", "+1/+1", 2, 2, true)).toBe(5);
    expect(selfPutReady("outlast {3}{w}", "+1/+1", 2, 1, true)).toBe(5);
    // Evolve needs a LARGER creature to enter: no put, the gate stays unmet
    expect(selfPutReady("evolve", "+1/+1", 2, 1, true)).toBeNull();
    // a trigger's put (Charitable Levy) is no activation; an activated put with a cost waits for the cost
    expect(selfPutReady("whenever a player casts a noncreature spell, put a collection counter on this enchantment.", "collection", 3, 3, false)).toBeNull();
    expect(selfPutReady("{2}, {t}: add one mana of any color. put a brick counter on this artifact.", "brick", 1, 3, false)).toBe(5);
    expect(selfPutReady("{t}: put an oil counter on this artifact.", "oil", 2, 2, false)).toBe(4);
    // a creature's free {T} put waits out summoning sickness
    expect(selfPutReady("{t}: put a luck counter on this creature.", "luck", 2, 1, true)).toBe(4);
  });
  it("#1279 a self put carries what ONE activation costs, refunds, whether it taps and how many reach the gate", () => {
    const druid = "{t}: add one mana of any type that a land you control could produce. if this creature has a +1/+1 counter on it, add three mana of that type instead.\n{3}{g}{g}: adapt 3.";
    expect(selfPut(druid, "+1/+1", 2, 1, true)).toEqual({ readyTurn: 6, activation: { mana: 5, refund: 0, taps: false, activations: 1 } });
    const pyramid = "{2}, {t}: add one mana of any color. put a brick counter on this artifact.\n{t}: add three mana of any one color. activate only if there are three or more brick counters on this artifact.";
    expect(selfPut(pyramid, "brick", 1, 3, false)).toEqual({ readyTurn: 5, activation: { mana: 2, refund: 1, taps: true, activations: 3 } });
    const tablet = "{t}: put an oil counter on this artifact.\n{t}: add {c}. activate only if this artifact has two or more oil counters on it.";
    expect(selfPut(tablet, "oil", 2, 2, false)).toEqual({ readyTurn: 4, activation: { mana: 0, refund: 0, taps: true, activations: 2 } });
    expect(selfPut("{2}, {t}: add {g}{g}. put a luck counter on this artifact.", "luck", 1, 1, false)?.activation).toEqual({ mana: 2, refund: 2, taps: true, activations: 1 });
    expect(selfPut("outlast {w}", "+1/+1", 2, 2, true)).toEqual({ readyTurn: 5, activation: { mana: 1, refund: 0, taps: true, activations: 2 } });
    expect(selfPut("{4}{r}, {t}: monstrosity 2", "+1/+1", 1, 2, false)).toEqual({ readyTurn: 6, activation: { mana: 4 + 1, refund: 0, taps: true, activations: 1 } });
    expect(selfPut("{5}{r}{r}: monstrosity 3", "+1/+1", 3, 2, false)).toEqual({ readyTurn: 8, activation: { mana: 7, refund: 0, taps: false, activations: 1 } });
  });
  it("'as long as ...' on a granted ability gates the grant", () => {
    expect(only("Honored Hierarch").gate?.text).toBe("this creature is renowned");
    expect(only("Mul Daya Channelers").gate?.text).toBe("the top card of your library is a land card");
  });
  it("a fetch that lands only under a condition keeps its line and carries the condition", () => {
    for (const n of ["Embermouth Sentinel", "Ruin in Their Wake", "Scholar of New Horizons", "Stoic Farmer", "Natural Balance", "Elemental Teachings"]) {
      expect(tagsOf(n).landFetch, n).toBeDefined();
      expect(linesOf(n, "fetch")[0]!.gate, n).not.toBeNull();
    }
    expect(linesOf("Stoic Farmer", "fetch")[0]!.gate?.text).toBe("an opponent controls more lands than you");
    expect(linesOf("Cultivate", "fetch")[0]!.gate).toBeNull();
  });
  it("every player searching includes you; a target player may not", () => {
    for (const n of ["New Frontiers", "Collective Voyage", "Veteran Explorer"]) expect(tagsOf(n).landFetch, n).toBeDefined();
    expect(tagsOf("Veteran Explorer").landFetch?.kind).toBe("permanent");
    for (const n of ["Turtle Tracks", "Restorative Technique", "Fertilid's Favor"]) expect(tagsOf(n).landFetch, n).toBeUndefined();
  });
});

describe("review round 3 (#1169 task 1)", () => {
  it("Verdant Mastery: the opponent's land is the conditional one, your two lands are not", () => {
    expect(linesOf("Verdant Mastery", "fetch")[0]!.gate).toBeNull();
  });
  it("Gemstone Caverns: a plain {C} line and a gated any-colour line", () => {
    const [plain, any] = linesOf("Gemstone Caverns");
    expect(plain).toMatchObject({ colourless: 1, anyColour: null, gate: null });
    expect(any).toMatchObject({ anyColour: "any", gate: { kind: "counter", counter: "luck", need: 1, text: "gemstone caverns has a luck counter on it" } });
  });
  it("an intervening if gates the trigger", () => {
    expect(only("Mardu Warshrieker").gate?.text).toBe("you attacked this turn");
    expect(only("Coal Stoker").gate?.text).toBe("you cast it from your hand");
    expect(only("Realm-Scorcher Hellkite").gate?.text).toBe("it was bargained");
    expect(only("Scattering Stroke").gate?.text).toBe("you win");
  });
  it("'you may <cost>. If you do, add' is a cost, and 'you do' is never a gate", () => {
    expect(only("Yavimaya Bloomsage").cost).toMatchObject({ life: 1 });
    expect(only("Energy Tap").cost).toMatchObject({ tapOther: true });
    expect(only("Fire Lord Ozai").cost).toMatchObject({ sacrificeOther: true });
    expect(only("Cheering Crowd").cost).toMatchObject({ counters: "put" });
    expect(only("Neheb, Dreadhorde Champion").cost.other).toEqual(["discard any number of cards"]);
    expect(linesOf("Springbloom Druid", "fetch")[0]!.cost).toMatchObject({ sacrificeOther: true });
    expect(linesOf("Cartographer's Hawk", "fetch")[0]!.cost.other).toEqual(["return it to its owner's hand"]);
    expect(linesOf("Purestrain Genestealer", "fetch")[0]!.cost).toMatchObject({ counters: "remove" });
    expect(linesOf("Charitable Levy", "fetch")[0]!.cost).toMatchObject({ sacrificeSelf: true });
    for (const fx of Object.keys(fixtures)) for (const l of tagsOf(fx.split(" // ")[0]!).manaLines ?? []) expect(l.gate?.text ?? "", fx).not.toMatch(/^(?:you|they|that player) do$/);
    for (const n of ["Yavimaya Bloomsage", "Energy Tap", "Fire Lord Ozai", "Springbloom Druid"]) expect(linesOf(n)[0]!.gate, n).toBeNull();
  });
  it("'for as long as' is a duration, not a gate", () => {
    expect(linesOf("Ultima, Origin of Oblivion").every((l) => l.gate === null)).toBe(true);
    expect(only("Kitesail Larcenist").gate).toBeNull();
  });
  it("a grant made by a TRIGGERED parent is gated by that trigger, unless it is a duration (#1169 2b-1 review: Princess Yue)", () => {
    // "When Princess Yue dies, ... return this card ... She gains '{T}: Add {C}.'": the mana exists only after the death, not from the card in play.
    const yue = only("Princess Yue");
    expect(yue).toMatchObject({ source: "static-grant", colourless: 1 });
    expect(yue.gate?.text).toBe("when princess yue dies");
    // ...while "for as long as" stays a duration (the test above), and a grant by a STATIC parent has no trigger to gate it.
    expect(only("Abundant Growth").gate).toBeNull();
    expect(linesOf("Chromatic Lantern", "static-grant")[0]!.gate).toBeNull();
    // A trigger that grants for a while is gated (Hydro-Man's end step, Song of Freyalise's chapter "until your next turn"); a grant to ANOTHER card
    // (Vraska, the Silencer's returned Treasure) is no mana of Vraska's; a Saga chapter with no duration (Urza's Saga) stands, as a land's tap does.
    expect(only("Hydro-Man, Fluid Felon", "static-grant").gate?.text).toBe("at the beginning of your end step");
    expect(only("Song of Freyalise", "static-grant").gate?.text).toBe("until your next turn");
    expect(only("Vraska, the Silencer", "static-grant").gate?.text).toBe("whenever a nontoken creature an opponent controls dies");
    expect(only("Urza's Saga", "static-grant").gate).toBeNull();
  });
  it("Ashling's one printed add is one line, not one per cast/copy twin", () => {
    expect(linesOf("Ashling, Flame Dancer")).toHaveLength(1);
  });
});

describe("review round 4 (#1169 task 1)", () => {
  it("Charitable Levy: the 'if' before the comma is the gate, the sacrifice after it is the cost", () => {
    const l = linesOf("Charitable Levy", "fetch")[0]!;
    expect(l.gate?.text).toBe("there are three or more collection counters on it");
    expect(l.cost).toMatchObject({ sacrificeSelf: true, other: [] });
  });
});

describe("review of task 2a (#1169): 'among', unread, self-exile", () => {
  it("'any color among <things you control>' is bounded by the board (anyColour 'among'), and is not unread", () => {
    for (const n of ["Plaza of Heroes", "The Grey Havens", "Mox Amber"]) {
      const ls = linesOf(n).filter((l) => l.anyColour === "among");
      expect(ls.length, n).toBeGreaterThan(0);
      for (const l of ls) expect(l, n).toMatchObject({ unread: false, colours: [] });
    }
    for (const n of ["Faeburrow Elder", "Bloom Tender"]) expect(only(n), n).toMatchObject({ anyColour: "among", unread: false });
  });
  it("the own-colour floor also holds when the grammar path puts the count on action.amount; a colourless permanent nets 0 and an instant gets no floor (review)", () => {
    const of = (typeLine: string, colors: string[]) => {
      const card = { name: "Probe", typeLine, colors, oracleText: "{T}: For each color among permanents you control, add one mana of that color.", keywords: [] as string[] };
      const records = [{ id: 1, abilityType: "activated", actions: [{ verb: "add-mana", object: "one mana of that color", amount: "for each color among permanents you control", optional: false, fromZone: null, toZone: null }] }];
      return deriveCardTags(deriveInputOf(card as never, "x", "Probe", records as never)).manaLines![0]!;
    };
    expect(of("Creature — Treefolk Druid", ["G", "W"])).toMatchObject({ amount: { fixed: null, scales: "for each color among permanents you control" }, net: 2 });
    expect(of("Artifact", [])).toMatchObject({ net: 0 });
    expect(of("Instant", ["G", "W"])).toMatchObject({ net: 1 });
  });
  it("The Grey Havens' 'among legendary creature cards in your graveyard' needs a card there (Fix B); a board-bounded 'among' stays ungated", () => {
    const gated = linesOf("The Grey Havens").filter((l) => l.anyColour === "among");
    expect(gated).toHaveLength(1);
    // the qualifier is KEPT (#1267 review): a legendary creature card, not any card
    expect(gated[0]!.gate).toEqual({ kind: "threshold", zone: "graveyard", need: 1, types: ["creature"], supertypes: ["legendary"], text: "there is a legendary creature card in your graveyard" });
    expect(only("Corrupted Grafstone").gate).toMatchObject({ kind: "threshold", need: 1, text: "there is a card in your graveyard" });
    expect(only("Mox Amber").gate).toBeNull();
  });
  it("a target player or opponent (ALWAYS_THERE) and 'any number of target' (Quintorius Kand's UP_TO) gate nothing", () => {
    expect(only("Witch Engine")).toMatchObject({ colours: ["B"], gate: null });
    expect(linesOf("Quintorius Kand").every((l) => l.gate === null)).toBe(true);
    expect(linesOf("Quintorius Kand").length).toBeGreaterThan(0);
  });
  it("Chrome Mox: the imprinted card's colours are a bound, not an unread line", () => {
    expect(only("Chrome Mox")).toMatchObject({ anyColour: "among", unread: false });
  });
  it("'two mana of different colors' (Guild Globe) is any colour", () => {
    expect(only("Guild Globe")).toMatchObject({ anyColour: "any", unread: false, amount: { fixed: 2, scales: null } });
  });
  it("Plaza of Heroes' unbounded 'any color' line is still any", () => {
    expect(linesOf("Plaza of Heroes").some((l) => l.anyColour === "any" && l.restriction !== null)).toBe(true);
  });
  it("exiling the card itself is a sacrifice of it (Ether), exiling other cards is not", () => {
    expect(linesOf("Ether").find((l) => l.source === "activated")!.cost).toMatchObject({ sacrificeSelf: true, other: [] });
    expect(only("Molt Tender").cost.other).toEqual(["Exile a card from your graveyard"]);
  });
  it("no mana line in the fixtures keeps an unread flag the new reads should have resolved", () => {
    for (const n of ["Plaza of Heroes", "The Grey Havens", "Mox Amber", "Faeburrow Elder", "Bloom Tender", "Chrome Mox", "Guild Globe", "Pit of Offerings"]) {
      for (const l of linesOf(n)) expect(l.unread, n).toBe(false);
    }
  });
});

describe("review 2 of task 2a (#1169): colours bounded by what you own, a free colour choice, circled colours", () => {
  it("'any of this creature's colors', 'a color of a permanent you control / a card in your graveyard' are bounded by what you own", () => {
    for (const n of ["Meteor Crater", "Corrupted Grafstone"]) {
      expect(only(n), n).toMatchObject({ anyColour: "among", unread: false });
    }
  });
  it("'Choose a color. Add one mana of that color for each ...' is any colour with a scaling amount (Selvala, Astral Cornucopia, Three Tree City)", () => {
    expect(only("Selvala, Eager Trailblazer")).toMatchObject({ anyColour: "any", unread: false });
    expect(only("Astral Cornucopia")).toMatchObject({ anyColour: "any", unread: false, amount: { fixed: null } });
    expect(linesOf("Three Tree City").find((l) => l.cost.mana === 2)).toMatchObject({ anyColour: "any", unread: false, amount: { fixed: null } });
  });
  it("Cryptic Spires' circled colours are chosen outside the card", () => {
    expect(linesOf("Cryptic Spires").find((l) => l.cost.tap && l.unread === false && l.anyColour === "chosen")).toBeDefined();
  });
});

describe("review 3 of task 2a (#1169): a grantee's colours, a colour chosen as part of the ability", () => {
  it("Katilda's granted 'any of this creature's colors' belongs to each grantee, not to a deck: anyColour 'grantee'", () => {
    expect(only("Katilda, Dawnhart Prime")).toMatchObject({ source: "static-grant", anyColour: "grantee", unread: false });
    expect(only("Tazri, Stalwart Survivor")).toMatchObject({ source: "static-grant", anyColour: "grantee", unread: false });
  });
  it("'Choose a color. Add ... of that color' in the SAME clause is a free choice: any (Loot, Rhystic Cave, Nyx Lotus, Nykthos)", () => {
    expect(only("Loot, the Nexus")).toMatchObject({ anyColour: "any", unread: false });
    expect(only("Rhystic Cave")).toMatchObject({ anyColour: "any", unread: false });
    expect(only("Nyx Lotus")).toMatchObject({ anyColour: "any", unread: false });
    expect(linesOf("Nykthos, Shrine to Nyx").find((l) => l.cost.mana === 2)).toMatchObject({ anyColour: "any", unread: false });
  });
  it("a colour chosen as the permanent enters (a separate clause) stays chosen: Thriving Heath, Utopia Sprawl; circled colours too", () => {
    expect(linesOf("Thriving Heath").find((l) => l.cost.tap)).toMatchObject({ anyColour: "chosen", colours: ["W"] });
    expect(only("Utopia Sprawl")).toMatchObject({ anyColour: "chosen" });
    expect(linesOf("Cryptic Spires").find((l) => l.cost.tap && l.anyColour !== null)).toMatchObject({ anyColour: "chosen" });
  });
});

describe("an Aura's mana counts only if mana is the card's purpose (owner 2026-10-13, #1169 2b-1 review round 2)", () => {
  it("removal Auras make no mana line: one that strips the enchanted permanent's card types, one on an opponent's permanent, a granted combat-damage trigger", () => {
    // Imprisoned in the Moon: "Enchanted permanent is a colorless land with '{T}: Add {C}' and loses all other card types and abilities" -- it removes the
    // permanent; the land it leaves is not ramp. Honest Work: "Enchant creature an opponent controls". Mark of Sakiko: the grant is a combat-damage trigger, no tap.
    for (const n of ["Imprisoned in the Moon", "Honest Work", "Mark of Sakiko"]) expect(tagsOf(n).manaLines, n).toBeUndefined();
  });
  it("a pacifism that also grants a tap ability is removal, not ramp (owner 2026-10-13: Utopia Vow, \"Enchanted creature can't attack or block\"); the plain grants stay", () => {
    expect(tagsOf("Utopia Vow").manaLines).toBeUndefined();
    for (const n of ["Karametra's Favor", "Multani's Harmony"]) expect(linesOf(n, "static-grant").length, n).toBeGreaterThan(0);
  });
  it("an Aura that gives a land (or creature) a tap ability keeps its line: Abundant Growth, Lithoform Blight, Bigger on the Inside, the 'enchanted land' triggers", () => {
    for (const n of ["Abundant Growth", "Gift of Paradise", "Bigger on the Inside", "Grafted Growth", "Karametra's Favor", "Multani's Harmony"]) {
      expect(linesOf(n, "static-grant").length, n).toBeGreaterThan(0);
    }
    expect(linesOf("Lithoform Blight", "static-grant")).toHaveLength(2);
    expect(linesOf("Wild Growth", "aura-trigger")).toHaveLength(1);
    expect(linesOf("Utopia Sprawl", "aura-trigger")).toHaveLength(1);
  });
});

describe("a planeswalker's starting loyalty rides on its loyalty-cost lines (CR 306.5b, 606.6)", () => {
  it("a mana or fetch line costing loyalty carries the walker's printed loyalty", () => {
    expect(only("Chandra, Novice Pyromancer", "activated")).toMatchObject({ cost: { loyalty: -1, other: [] }, startLoyalty: 5 });
    expect(only("Chandra, Torch of Defiance", "activated")).toMatchObject({ cost: { loyalty: 1, other: [] }, startLoyalty: 4 });
    expect(only("Nissa, Worldwaker", "fetch")).toMatchObject({ cost: { loyalty: -7, other: [] }, startLoyalty: 3 });
    expect(linesOf("Nissa, Who Shakes the World", "fetch")[0]).toMatchObject({ cost: { loyalty: -8, other: [] }, startLoyalty: 5 });
    // The BACK face's own loyalty (Arlinn, the Moon's Fury), by face.
    expect(linesOf("Arlinn, the Pack's Hope").find((l) => l.face === 1)).toMatchObject({ startLoyalty: 4 });
  });
  it("no loyalty-cost mana line in the fixtures is left without its starting loyalty (a silent drop otherwise: derive-corpus prints this count, expected 0)", () => {
    const bad = Object.keys(fixtures).filter((n) => unpricedLoyaltyLines(tagsOf(n).manaLines).length > 0);
    expect(bad).toEqual([]);
    // ...and the check itself fires: the same card derived from a document with no loyalty.
    const fx = (fixtures as unknown as Record<string, { card: Record<string, unknown> & { _id: string; name: string }; clauses: never[] }>)["Chandra, Novice Pyromancer"]!;
    const { loyalty: _l, ...bare } = fx.card;
    expect(unpricedLoyaltyLines(deriveCardTags(deriveInputOf(bare as never, fx.card._id, fx.card.name, fx.clauses)).manaLines).length).toBeGreaterThan(0);
  });
  it("a line with no loyalty cost carries none", () => {
    expect(only("Sol Ring")).not.toHaveProperty("startLoyalty");
    expect(only("Llanowar Elves")).not.toHaveProperty("startLoyalty");
  });
});

describe("a one-turn tap bonus is a tap-bonus line, not a net-0 add (owner 2026-10-13, #1169 2b-2 follow-up)", () => {
  it("High Tide: a one-shot spell whose line is the Island tap bonus for the turn", () => {
    const l = only("High Tide");
    expect(l).toMatchObject({ source: "one-shot-spell", trigger: { event: "tapped-for-mana", text: "an Island", subject: { subtype: "island" } }, timing: "on-trigger", untilEndOfTurn: true,
      colours: ["U"], amount: { fixed: 1, scales: null }, cost: { mana: 1 } });
    expect(tagsOf("High Tide").isOneShot).toBe(true);
  });
  it("Bubbling Muck reads the same, for Swamps", () => {
    expect(only("Bubbling Muck")).toMatchObject({ source: "one-shot-spell", trigger: { event: "tapped-for-mana", text: "a Swamp" }, untilEndOfTurn: true, colours: ["B"] });
  });
  it("Molten Tide (Pyre Rhymer // Molten Tide): the add the model filed under effectActions, which the canonical record drops, is read off the printed text", () => {
    expect(only("Pyre Rhymer")).toMatchObject({ face: 1, source: "one-shot-spell", trigger: { event: "tapped-for-mana", text: "a Mountain" }, timing: "on-trigger", untilEndOfTurn: true,
      colours: ["R"], amount: { fixed: 1, scales: null }, cost: { mana: 1 }, net: 0, gate: null });
  });
  it("a spell whose own text is not the tap bonus gets no line from the fallback (the front face's Prowess and prepare)", () => {
    expect(linesOf("Pyre Rhymer")).toHaveLength(1);
  });
  it("a permanent's standing tap bonus is no one-turn line", () => {
    expect(only("Mana Flare", "trigger")).not.toHaveProperty("untilEndOfTurn");
    expect(only("Forsaken Monument", "trigger")).not.toHaveProperty("untilEndOfTurn");
  });
  it("a spell whose tap trigger the reader does not recognise banks NO add line (a guess is worse than a refusal)", () => {
    const fx = (fixtures as unknown as Record<string, { card: Record<string, unknown> & { _id: string; name: string; oracleText: string }; clauses: { trigger?: unknown }[] }>)["Bubbling Muck"]!;
    const card = { ...fx.card, oracleText: "Whenever a player taps a Swamp for mana, that player adds an additional {B}." };
    const clauses = fx.clauses.map((c) => ({ ...c, trigger: { event: "tapped-for-mana", subject: "a Swamp", control: "any" } }));
    expect(deriveCardTags(deriveInputOf(card as never, card._id, card.name, clauses as never)).manaLines).toBeUndefined();
  });
  it("a token's quoted 'Sacrifice this token: Add {C}' is not the spell's own add (Eldrazi Confluence)", () => {
    expect(linesOf("Eldrazi Confluence", "one-shot-spell")).toHaveLength(0);
    expect(linesOf("Eldrazi Confluence", "token-maker")).toHaveLength(1);
  });
});

// #1190 (owner rulings 2026-10-13): the Ramp role reads these lines, so a Treasure or Lander the card makes must be one, and a token an OPPONENT makes must not.
describe("token makers: the Treasure a card really makes, and the one it does not", () => {
  const tokens = (name: string) => linesOf(name, "token-maker").map((l) => l.producesToken);
  it("a CHOICE of tokens that includes a Treasure (Ant-Man's Army, The Third Doctor, Tireless Provisioner) is a Treasure maker", () => {
    for (const n of ["Ant-Man's Army", "The Third Doctor", "Tireless Provisioner"]) expect(tokens(n), n).toEqual(["treasure"]);
  });
  it("a Treasure beside another token (Song of Eärendil chapter II) and one a misread clause hides (Spiked Pit Trap, Smoke Spirits' Aid) are read off the clause", () => {
    for (const n of ["Song of Eärendil", "Spiked Pit Trap", "Smoke Spirits' Aid"]) expect(tokens(n), n).toEqual(["treasure"]);
  });
  it("Tempting Contract (each opponent MAY, and you create one too) and Jolene (that attacking player) make Treasures for you", () => {
    expect(tokens("Tempting Contract")).toEqual(["treasure"]);
    expect(tokens("Jolene, the Plunder Queen")).toEqual(["treasure"]);
  });
  it("a Treasure only an opponent gets is no mana of yours (Ingenious Mastery, Erestor of the Council); a gift is the opponent's too", () => {
    for (const n of ["Ingenious Mastery", "Erestor of the Council", "Bilbo's Gambit"]) expect(tokens(n), n).toEqual([]);
  });
  it("a token the clause's segmenter cut off from \"Its controller creates\" is still the opponent's (Cityscape Leveler's attack trigger, Emergency Eject's Lander)", () => {
    for (const n of ["Cityscape Leveler", "Emergency Eject"]) expect(tokens(n), n).toEqual([]);
  });
  it("a card that makes a Treasure for itself AND hands one to an opponent keeps exactly its own (Generous Plunderer); one that only gives it away has none (Vazi)", () => {
    expect(tokens("Generous Plunderer")).toEqual(["treasure"]);
    expect(tokens("Vazi, Keen Negotiator")).toEqual([]);
  });
  it("a Treasure shared with a table you are at (Marching Duodrone, Thran Spider's Powerstone, Prismari Command's target player) stays", () => {
    expect(tokens("Marching Duodrone")).toEqual(["treasure"]);
    expect(tokens("Thran Spider")).toEqual(["powerstone"]);
    expect(tokens("Prismari Command")).toEqual(["treasure"]);
  });
  it("a replacement that ADDS a Treasure to the creation of another token is a Treasure maker (owner 2026-10-14, #1197: Bilbo, Academy Manufactor)", () => {
    expect(tokens("Bilbo, Fellow Conspirator")).toEqual(["treasure"]);
    expect(tokens("Academy Manufactor")).toEqual(["treasure"]);
  });
  it("a pure Treasure DOUBLER makes none: Xorn has no line, Jolene keeps only the line her attack trigger gives her", () => {
    expect(tokens("Xorn")).toEqual([]);
    expect(tokens("Jolene, the Plunder Queen")).toEqual(["treasure"]);
    expect(linesOf("Jolene, the Plunder Queen", "token-maker")).toHaveLength(1);
  });
  it("SYNTHETIC: a Treasure doubler with qualifiers is still a doubler; a replacement over every token that adds a Treasure is a maker; the passive template is read", () => {
    const oneOf = (t: string) => replacementAddedToken(t);
    expect(oneOf("If you would create one or more Treasure tokens under your control, instead create those tokens plus an additional Treasure token.")).toBeNull();
    expect(oneOf("If you would create one or more tapped Treasure tokens, instead create that many tapped Treasure tokens plus an additional Treasure token.")).toBeNull();
    expect(oneOf("If one or more Treasure tokens would be created under your control, those tokens plus an additional Treasure token are created instead.")).toBeNull();
    expect(oneOf("If you would create one or more tokens, instead create those tokens plus an additional Treasure token.")).toBe("treasure");
    expect(oneOf("If one or more tokens would be created under your control, those tokens plus an additional Treasure token are created instead.")).toBe("treasure");
    expect(oneOf("If you would create one or more Food tokens under your control, instead create those tokens plus an additional Treasure token.")).toBe("treasure");
    // The passive replaced part starts at its own "If": an earlier sentence naming a Food is not what is replaced.
    expect(oneOf("Whenever you sacrifice a Food, draw a card. If one or more Treasure tokens would be created, those tokens plus an additional Treasure token are created instead.")).toBeNull();
  });
  it("a Lander token is a land-fetch token, the way a Treasure is a mana token (Beamsaw Prospector, Divert Disaster)", () => {
    expect(only("Beamsaw Prospector", "token-maker")).toMatchObject({ producesToken: "lander", source: "token-maker", unread: false, colourless: 0 });
    expect(tokens("Divert Disaster")).toEqual(["lander"]);
  });
});

describe("a land fetch whose landing is printed in a LATER clause", () => {
  it("Caravan Vigil puts the land onto the battlefield only if a creature died; Druid of the Emerald Grove only on a high roll", () => {
    expect(tagsOf("Caravan Vigil").landFetch).toMatchObject({ kind: "spell", reach: WUBRG });
    expect(only("Caravan Vigil", "fetch").gate?.text).toMatch(/creature died/);
    expect(tagsOf("Druid of the Emerald Grove").landFetch).toMatchObject({ kind: "permanent", tapped: true });
    expect(only("Druid of the Emerald Grove", "fetch").gate).not.toBeNull();
  });
  it("Omenpath Journey puts a land it exiled onto the battlefield each end step", () => {
    expect(tagsOf("Omenpath Journey").landFetch).toMatchObject({ kind: "permanent", tapped: true });
    expect(only("Omenpath Journey", "fetch").gate).toBeNull();
  });
  it("the ordinary fetches still read (Kodama's Reach, Scholar of New Horizons)", () => {
    expect(tagsOf("Kodama's Reach").landFetch).toBeDefined();
    expect(tagsOf("Scholar of New Horizons").landFetch).toBeDefined();
  });
});

describe("Piracy: mana from lands you do not control", () => {
  it("is a one-shot spell line whose amount derive cannot read, so it is unread rather than a colour", () => {
    expect(only("Piracy")).toMatchObject({ source: "one-shot-spell", unread: true, repeats: "once" });
    expect(tagsOf("Piracy").isOneShot).toBe(true);
  });
});

/** ONE READER OF "HOW MUCH MANA" (#1193, #1187): `Ability.amount` and `ManaLine.amount` come from the same `production()` read, so the two never
 *  disagree on a card with one mana ability. Every card is real corpus input. Each row: the number of mana the printed text adds. */
describe("Ability.amount and ManaLine.amount are one reading (DERIVE_VERSION 311)", () => {
  const manaAbilities = (name: string) => (tagsOf(name).abilities ?? []).filter((a) => a.effect.kind === "mana-generation");
  const CASES: [string, number][] = [
    ["Chandra, Heart of Fire", 6], // "Add six {R}." the clause keeps {R} with amount "6": the line read 1
    ["The Flux", 6],
    ["Irencrag Feat", 7], // "Add seven {R}.": the ability read 1 symbol
    ["Avatar Roku, Firebender", 6],
    ["Terra, Magical Adept", 10], // "{W}{W}, {U}{U}, {B}{B}, {R}{R}, and {G}{G}": a sum, not alternatives, the line read 2
    ["The Aetherspark", 10], // "mana of any one color" with amount "10"
    ["Orcish Lumberjack", 3], // "three mana in any combination of {R} and/or {G}": the ability counted the 2 symbols
    ["Goblin Clearcutter", 3],
    ["Relic of Sauron", 2], // "two mana in any combination of {U}, {B}, and/or {R}": the ability counted 3
    ["Shang-Chi, Master of Kung Fu", 2], // #1187: "two mana of any one color, spendable only to ...": the line read nothing
    ["Valleymaker", 3], // the model keeps "{G}{G}{G}" on amount and "chosen player" on the object
    ["Cosmic Crucible", 4], // amount "four": the ability kept the word
    ["Omnath, Locus of All", 3],
    ["Gilded Lotus", 3],
    ["Smokebraider", 2],
    ["Open the Omenpaths", 4], // "two mana of any one color and two mana of any other color": every "N mana" phrase adds
  ];
  for (const [name, n] of CASES) {
    it(`${name} adds ${n} on the ability and on the line`, () => {
      const abilities = manaAbilities(name);
      expect(abilities, `${name} abilities`).toHaveLength(1);
      expect(abilities[0]!.amount).toBe(String(n));
      const lines = linesOf(name).filter((l) => l.source !== "token-maker");
      expect(lines, `${name} lines`).toHaveLength(1);
      expect(lines[0]!.amount).toEqual({ fixed: n, scales: null });
    });
  }
  it("a scaling amount keeps no number on the ability (its scaling text, #1265) and names what it counts on the line", () => {
    expect(manaAbilities("Axebane Guardian")[0]!.amount).toBe("x");
    expect(linesOf("Axebane Guardian")[0]!.amount).toMatchObject({ fixed: null, scales: "x" });
    expect(linesOf("Radiant Lotus")[0]!.amount.fixed).toBeNull();
    // "up to" / "any number of" target nothing that must exist: no target gate (UP_TO)
    expect(linesOf("Radiant Lotus")[0]!.gate).toBeNull();
  });
  it("Unclaimed Territory's restricted line reads one mana, the rider after the comma is no alternative", () => {
    const lines = linesOf("Unclaimed Territory");
    expect(lines.map((l) => l.amount)).toEqual([{ fixed: 1, scales: null }, { fixed: 1, scales: null }]);
    expect(lines[1]).toMatchObject({ anyColour: "any", restriction: { spend: expect.stringContaining("creature spell") } });
  });
  it("Piracy's line reads no amount and is unread", () => {
    expect(only("Piracy")).toMatchObject({ unread: true, amount: { fixed: null, scales: null } });
  });
});

/** A MANA ADD THAT SCALES STORES NO NUMBER (#1265, DERIVE_VERSION 336): the clause's own "1" ("add one mana of that color", repeated "for each color among permanents you
 *  control") used to fall through onto `Ability.amount`, so Faeburrow Elder was rated a one-mana dork. The census (`research/mana/amount-agreement.ts`) found these four. */
describe("a scaling mana add keeps no fixed number on the ability (#1265)", () => {
  for (const name of ["Bloom Tender", "Charmed Pendant", "Faeburrow Elder", "Selvala, Explorer Returned"]) {
    it(`${name}: the line scales and the ability amount is not a number`, () => {
      const abilities = (tagsOf(name).abilities ?? []).filter((a) => a.effect.kind === "mana-generation");
      expect(abilities, `${name} abilities`).toHaveLength(1);
      expect(abilities[0]!.amount === undefined || !/^\d+$/.test(abilities[0]!.amount), `${name} amount ${abilities[0]!.amount}`).toBe(true);
      expect(linesOf(name).filter((l) => l.source !== "token-maker")[0]!.amount.scales).not.toBeNull();
    });
  }
});

/** THE INTERVAL OF A SCALING MANA ADD (owner ruling 2026-10-17, #1265 task 1): a floor and a ceiling, never a fake fixed 1 and never nothing. Every row is a real corpus card; the expected
 *  numbers are the review's per-card table, each checked against the card's printed text. `floor` of a CARD is what its lines guarantee together: a fixed sibling line (Rite of Flame's {R}{R},
 *  a Battery's first {W}) counts its `fixed`, the scaling line its `floor`. */
describe("a scaling mana add carries a floor and a ceiling (#1265)", () => {
  const mg = (name: string) => (tagsOf(name).abilities ?? []).filter((a) => a.effect.kind === "mana-generation");
  const scaling = (name: string) => linesOf(name).filter((l) => l.source !== "token-maker" && l.amount.scales !== null);
  const scalingFloor = (name: string) => scaling(name).reduce((n, l) => n + (l.amount.floor ?? 0), 0);
  /** The fixed sibling line of a "{X}, then add {X} for each" sentence (Rite of Flame, the W/B/G Batteries): the card's floor is it plus the scaling line's. */
  const SIBLING_FIXED: Record<string, number> = { "Rite of Flame": 2, "White Mana Battery": 1, "Black Mana Battery": 1, "Green Mana Battery": 1 };
  const BOUNDED: [string, number, number, "colours" | "basic-land-types"][] = [
    ["Faeburrow Elder", 2, 5, "colours"], // the card is a permanent you control: its own two colours
    ["Bloom Tender", 1, 5, "colours"],
    ["Tarnation Vista", 0, 5, "colours"], // "monocolored permanents": a colourless land is none
    ["Sunbird Standard // Sunbird Effigy", 0, 5, "colours"], // the exiled cards, not the card
    ["Prismatic Geoscope", 0, 5, "basic-land-types"],
  ];
  for (const [name, floor, ceiling, bound] of BOUNDED) {
    it(`${name}: floor ${floor}, ceiling ${ceiling} (${bound})`, () => {
      const lines = scaling(name);
      expect(lines, name).toHaveLength(1);
      expect(lines[0]!.amount).toMatchObject({ fixed: null, floor, ceiling, bound });
      // the ability reads the SAME interval: its count is the line's, its amount is defined text
      const a = mg(name).find((x) => x.amount !== undefined && !/^\d+$/.test(x.amount) && x.count?.ceiling === ceiling);
      expect(a, `${name} ability`).toBeDefined();
      expect(a!.count).toMatchObject({ floor, ceiling });
    });
  }
  const FLOOR_ONLY: [string, number][] = [
    ["Rite of Flame", 2], ["White Mana Battery", 1], ["Black Mana Battery", 1], ["Green Mana Battery", 1], ["Blue Mana Battery", 1], ["Red Mana Battery", 1],
    ["Axebane Guardian", 1], ["Harabaz Druid", 1], ["Sanctum Weaver", 1], ["Sanctum of Fruitful Harvest", 1], ["Wirewood Channeler", 1], ["Kami of Whispered Hopes", 1],
    ["Heronblade Elite", 1], ["Doc Samson, Super Psychiatrist", 3], ["Mona Lisa, Science Geek", 1], ["Helga, Skittish Seer", 1], ["Redshift, Rocketeer Chief", 2],
    ["Vivi Ornitier", 0], ["Woodland Weavemaster", 1], ["Selvala, Heart of the Wilds", 2], ["Klauth, Unrivaled Ancient", 4], ["Empowered Autogenerator", 1],
    ["Food Chain", 1], ["Metamorphosis", 1],
    // the rest: floor 0, ceiling open
    ["Arbor Adherent", 0], ["Baldur's Gate", 0], ["Brigid, Clachan's Heart // Brigid, Doun's Mind", 0], ["Carpet of Flowers", 0], ["Deathbloom Ritualist", 0], ["Haruspex", 0],
    ["Charmed Pendant", 0], ["Burnt Offering", 0], ["Plasm Capture", 0], ["The Eternity Elevator", 0],
    ["White Lotus Tile", 0], ["Dreadship Reef", 0], ["Crucible of the Spirit Dragon", 0], ["Calciform Pools", 0], ["Accomplished Alchemist", 0],
  ];
  for (const [name, floor] of FLOOR_ONLY) {
    it(`${name}: floor ${floor}, ceiling open`, () => {
      const lines = scaling(name);
      expect(lines.length, name).toBeGreaterThan(0);
      for (const l of lines) expect(l.amount, name).toMatchObject({ fixed: null, ceiling: null });
      expect(scalingFloor(name) + (SIBLING_FIXED[name] ?? 0), name).toBe(floor);
      for (const a of mg(name).filter((x) => x.amount !== undefined && !/^\d+$/.test(x.amount))) expect(a.count, `${name} count`).toMatchObject({ ceiling: null });
    });
  }
  it("a fixed sibling add keeps its number: Rite of Flame's {R}{R} and a Battery's first {W} are not overwritten", () => {
    expect(mg("Rite of Flame").map((a) => a.amount)).toContain("2");
    expect(linesOf("Rite of Flame").some((l) => l.amount.fixed === 2)).toBe(true);
    expect(mg("White Mana Battery").map((a) => a.amount)).toContain("1");
    expect(mg("White Mana Battery").find((a) => a.amount === "1")!.count).toEqual({ floor: 1, ceiling: 1 });
  });
  it("the ability's amount is DEFINED text for every scaling add, never a number and never absent", () => {
    for (const name of ["Faeburrow Elder", "Bloom Tender", "Selvala, Explorer Returned", "Charmed Pendant", "Axebane Guardian"]) {
      const a = mg(name).filter((x) => !/^\d+$/.test(x.amount ?? ""));
      expect(a.length, name).toBeGreaterThan(0);
      for (const x of a) expect(x.amount, name).toBeTypeOf("string");
    }
  });
  it("a card whose text adds no mana gets no interval and no amount: 'pay {X}' (Halo Forager, Wildborn Preserver) and energy (Scurry of Gremlins, Aetherflux Conduit)", () => {
    for (const name of ["Halo Forager", "Wildborn Preserver", "Scurry of Gremlins", "Aetherflux Conduit"]) {
      for (const l of linesOf(name)) expect(l.amount, name).not.toHaveProperty("floor");
      for (const a of mg(name)) expect(a.amount === undefined || !/^x$/i.test(a.amount) || a.count === undefined, name).toBe(true);
    }
    for (const a of mg("Halo Forager")) expect(a.amount).toBeUndefined();
  });
  it("one case: the scale text is lowercase on a card the model path and the grammar path both read (Kami of Whispered Hopes, Haruspex)", () => {
    for (const name of ["Kami of Whispered Hopes", "Haruspex"]) for (const a of mg(name)) expect(a.amount, name).toBe((a.amount ?? "").toLowerCase());
  });
});

describe("a count bounded by the players at the table has a ceiling (#1265, bound players)", () => {
  const scaling = (name: string) => linesOf(name).filter((l) => l.source !== "token-maker" && l.amount.scales !== null);
  it("the table is you and three opponents (owner speed ruling 2026-10-06)", () => {
    expect(COMMANDER_OPPONENTS).toBe(3);
    expect(COMMANDER_PLAYERS).toBe(4);
  });
  it("Selvala, Explorer Returned: each player reveals one card, so at most 4 nonland cards, floor 0", () => {
    expect(scaling("Selvala, Explorer Returned")[0]!.amount).toMatchObject({ floor: 0, ceiling: 4, bound: "players" });
    const a = (tagsOf("Selvala, Explorer Returned").abilities ?? []).find((x) => x.effect.kind === "mana-generation")!;
    expect(a.count).toMatchObject({ floor: 0, ceiling: 4 });
  });
  it("Belbe: {C}{C} for each of YOUR opponents who lost life, at most 3 opponents, so 6", () => {
    expect(scaling("Belbe, Corrupted Observer")[0]!.amount).toMatchObject({ floor: 0, ceiling: 6, bound: "players" });
  });
  it("counts of an opponent's cards, life or permanents are not bounded by players (Jeska's Will, Mana Geyser, Neheb the Eternal)", () => {
    for (const n of ["Jeska's Will", "Mana Geyser", "Neheb, the Eternal"]) expect(scaling(n)[0]!.amount, n).toMatchObject({ ceiling: null });
  });
});

describe("scaleBounds guards (#1265 task 1 review)", () => {
  const scaling = (name: string) => linesOf(name).filter((l) => l.source !== "token-maker" && l.amount.scales !== null);
  const chars = (over: Partial<CardTags["characteristics"]> = {}) => ({ types: ["creature"], subtypes: [], colors: ["G"], identity: ["G"], cmc: 2, power: "1", toughness: "1", token: false, ...over }) as CardTags["characteristics"];
  const bounds = (scales: string, c: CardTags["characteristics"], oracle = "", text = "") => scaleBounds(scales, text, c, ["card"], true, oracle, 0);
  it("a PROTOTYPE taps for the smaller power: Cradle Clearcutter (printed 3/6, Prototype {2}{G} -- 1/3) has floor 1, not 3", () => {
    expect(scaling("Cradle Clearcutter")[0]!.amount).toMatchObject({ floor: 1, ceiling: null });
  });
  it("a card with no prototype keeps its printed power (Mona Lisa 1, Doc Samson 3)", () => {
    expect(scaling("Doc Samson, Super Psychiatrist")[0]!.amount.floor).toBe(3);
  });
  it("'each color among monocolored permanents you control' counts the card only when it has exactly one colour (synthetic: no corpus permanent has both)", () => {
    expect(bounds("for each color among monocolored permanents you control", chars()).floor).toBe(1);
    expect(bounds("for each color among monocolored permanents you control", chars({ colors: ["G", "W"] })).floor).toBe(0);
    expect(bounds("for each color among monocolored permanents you control", chars({ colors: [] })).floor).toBe(0);
  });
  it("'other X' is not counted: Baldur's Gate (a Gate) and Brigid floor 0; a synthetic 'other creatures' on a creature too", () => {
    expect(scaling("Baldur's Gate")[0]!.amount.floor).toBe(0);
    expect(bounds("number of other creatures you control", chars()).floor).toBe(0);
    expect(bounds("number of creatures you control", chars()).floor).toBe(1);
  });
  it("'with <keyword>' counts the card only when it prints the keyword: Overgrown Battlement 1; a synthetic creature without defender 0", () => {
    expect(scaling("Overgrown Battlement")[0]!.amount.floor).toBe(1);
    expect(bounds("number of creatures you control with defender", chars(), "Defender").floor).toBe(1);
    expect(bounds("number of creatures you control with defender", chars(), "Flying").floor).toBe(0);
  });
});

/** THE SCALING FLOOR'S MISSING SHAPES (#1285): the card is itself one of the things it counts. Oracle text is the fixture's, read from Mongo. */
describe("scaleBounds reads the card's own contribution (#1285)", () => {
  const scaling = (name: string) => linesOf(name).filter((l) => l.source !== "token-maker" && l.amount.scales !== null);
  it("'for each Elf on the battlefield' counts the Elf itself: Priest of Titania 1; Cloudpost (a Locus) 1", () => {
    expect(scaling("Priest of Titania")[0]!.amount).toMatchObject({ scales: "for each elf on the battlefield", floor: 1 });
    expect(scaling("Cloudpost")[0]!.amount.floor).toBe(1);
  });
  it("'your devotion to green' floors at the green pips of its OWN mana cost: Karametra's Acolyte {3}{G} 1", () => {
    expect(scaling("Karametra's Acolyte")[0]!.amount).toMatchObject({ scales: "your devotion to green", floor: 1 });
  });
  it("devotion counts a hybrid pip for each of its colours (CR 700.5), and no pip of another colour (synthetic)", () => {
    const c = { types: ["creature"], subtypes: [], colors: ["G", "W"], identity: ["G", "W"], cmc: 4, power: "1", toughness: "1", token: false } as unknown as CardTags["characteristics"];
    expect(scaleBounds("your devotion to green", "", c, ["card"], true, "", 0, 1, "{G/W}{G}{2}{W}").floor).toBe(2);
    expect(scaleBounds("your devotion to white", "", c, ["card"], true, "", 0, 1, "{G/W}{G}{2}{W}").floor).toBe(2);
    expect(scaleBounds("your devotion to blue", "", c, ["card"], true, "", 0, 1, "{G/W}{G}{2}{W}").floor).toBe(0);
    expect(scaleBounds("your devotion to green", "", c, ["card"], true, "", 0, 1, undefined).floor).toBe(0);
  });
  it("'<name>'s toughness' is the printed toughness: Vhal 2/3 floors at 3", () => {
    expect(scaling("Vhal, Candlekeep Researcher")[0]!.amount).toMatchObject({ scales: "vhal's toughness", floor: 3 });
  });
  it("'for each creature with power 4 or greater you control' counts a creature with power >= 4: Leafkin Avenger (4/3) 1; a 3-power creature 0 (synthetic)", () => {
    expect(scaling("Leafkin Avenger")[0]!.amount).toMatchObject({ floor: 1 });
    const c = { types: ["creature"], subtypes: [], colors: ["G"], identity: ["G"], cmc: 2, power: "3", toughness: "1", token: false } as unknown as CardTags["characteristics"];
    expect(scaleBounds("for each creature with power 4 or greater you control", "", c, ["card"], true, "", 0).floor).toBe(0);
    expect(scaleBounds("for each creature with power 3 or greater you control", "", c, ["card"], true, "", 0).floor).toBe(1);
  });
  it("'for each creature you control with power 4 or greater' (the other word order) counts a 6/6: Giant-Man, Gargantuan Genius 1; a 3-power creature 0 (synthetic)", () => {
    expect(scaling("Giant-Man, Gargantuan Genius")[0]!.amount).toMatchObject({ scales: "for each creature you control with power 4 or greater", floor: 1 });
    const c = { types: ["creature"], subtypes: [], colors: ["G"], identity: ["G"], cmc: 2, power: "3", toughness: "1", token: false } as unknown as CardTags["characteristics"];
    expect(scaleBounds("for each creature you control with power 4 or greater", "", c, ["card"], true, "", 0).floor).toBe(0);
  });
  it("'for each different power among creatures you control' counts the creature's own power once: Selvala (4/5) 1", () => {
    expect(scaling("Selvala, Eager Trailblazer")[0]!.amount).toMatchObject({ floor: 1 });
  });
  it("the contrast cards stay at floor 0 (Gyre Sage, Gaea's Cradle, Nyx Lotus, Three Tree City)", () => {
    for (const n of ["Gyre Sage", "Gaea's Cradle", "Nyx Lotus", "Three Tree City"]) expect(scaling(n)[0]!.amount.floor, n).toBe(0);
  });
});

/** #1291: a search for two named cards puts two lands. */
describe("a fetch of two cards counts both (#1291)", () => {
  it("Krosan Verge's 'a Forest card and a Plains card' is two lands", () => {
    expect(only("Krosan Verge", "fetch").amount).toEqual({ fixed: 2, scales: null });
    expect(only("Krosan Verge", "fetch").net).toBe(0);
  });
});

/** THE TOKEN-MAKER LINES' AMOUNT (#1265): 7 lines were "unread" (no fixed, no scales). A created token is one unless a number word says more; a "for each" in the creating sentence scales it. */
describe("a token-maker line reads how many it makes (#1265)", () => {
  const amountOf = (name: string, key = "treasure") => linesOf(name, "token-maker").filter((l) => l.producesToken === key).map((l) => l.amount);
  it("one Treasure is one", () => {
    for (const n of ["Bilbo, Retired Burglar", "Song of Eärendil", "Old Rutstein", "Mr. House, President and CEO"]) {
      const a = amountOf(n);
      expect(a.length, n).toBeGreaterThan(0);
      for (const x of a) expect(x, n).toEqual({ fixed: 1, scales: null });
    }
  });
  it("a Treasure made 'for each player who chose money' or 'for each opponent who does' scales", () => {
    expect(amountOf("Master of Ceremonies")).toEqual([{ fixed: null, scales: "for each player who chose money" }]);
    expect(amountOf("Tempting Contract")).toEqual([{ fixed: null, scales: "for each opponent who does" }]);
  });
  it("two Lander tokens are two", () => {
    expect(amountOf("Terrapact Intimidator", "lander")).toEqual([{ fixed: 2, scales: null }]);
  });
});

describe("an energy cost is no mana amount (DERIVE_VERSION 311, 376)", () => {
  it("Blaster Hulk's 'pay eight {E}' is no mana at all: its add-mana action is printed nowhere (#1321), so no mana-generation ability remains", () => {
    expect((tagsOf("Blaster Hulk").abilities ?? []).filter((a) => a.effect.kind === "mana-generation").map((a) => a.amount)).toEqual([]);
  });
});

/** STRUCTURED COST / RESTRICTION / TRIGGER (#1193, finding 5, DERIVE_VERSION 312): derive parses once what the matcher used to re-parse from verbatim strings. */
describe("a mana line states its cost, restriction and trigger as fields (DERIVE_VERSION 312)", () => {
  it("Pili-Pala's {Q} (untap this creature) consumes nothing; its text stays in `other`", () => {
    const l = linesOf("Pili-Pala").find((x) => x.cost.other.includes("{Q}"))!;
    expect(l).toBeDefined();
    expect(l.cost).toMatchObject({ other: ["{Q}"], consumes: [], loyalty: null });
  });
  it("energy, a discard and an exile from a graveyard are consumed; exert and mill are not", () => {
    expect(linesOf("Aether Hub")[1]!.cost).toMatchObject({ other: ["Pay {E}"], consumes: ["energy"] });
    expect(linesOf("Oasis Ritualist").some((l) => l.cost.other.some((o) => /^exert/i.test(o)) && l.cost.consumes.length === 0)).toBe(true);
    expect(linesOf("Millikin")[0]!.cost.consumes).toEqual([]);
  });
  it("a cost piece derive cannot classify is `unknown`, which is consumed (Korlash: the comma in the card's name splits the cost)", () => {
    const l = linesOf("Korlash, Heir to Blackblade").find((x) => x.cost.other.includes("Heir to Blackblade"))!;
    expect(l.cost).toMatchObject({ other: ["Discard another card named Korlash", "Heir to Blackblade"], consumes: ["discard", "unknown"] });
  });
  it("a loyalty cost is `cost.loyalty`, signed, and is not in `other`", () => {
    expect(only("Chandra, Torch of Defiance", "activated").cost).toMatchObject({ loyalty: 1, other: [], consumes: [] });
    expect(only("Nissa, Worldwaker", "fetch").cost).toMatchObject({ loyalty: -7, other: [] });
    expect(only("Sol Ring").cost.loyalty).toBeNull();
  });
  it("a mana-value floor is `restriction.minManaValue`; the same floor with a rider, and any other limit, is null", () => {
    expect(only("Ashling, Rekindled", "trigger").restriction).toMatchObject({ minManaValue: 4 });
    expect(linesOf("Helga, Skittish Seer")[0]!.restriction).toMatchObject({ minManaValue: null });
    expect(only("Smokebraider").restriction).toMatchObject({ minManaValue: null });
  });
  it("a trigger's subject is a SubjectFilter: landfall is a land you control, a card's own enter is `self`", () => {
    expect(only("Lotus Cobra", "trigger").trigger!.subject).toEqual({ control: "you", token: null, type: "land" });
    expect(only("Burning-Tree Emissary", "trigger").trigger!.subject).toMatchObject({ self: true });
  });
});

// #1282: Vibranium and Heartwood are mana tokens (CR 111.10w, 111.10x) like Powerstone (CR 111.10h); the maker lists live in one table.
describe("token makers: Vibranium and Heartwood (#1282)", () => {
  /** Thran Spider's real input with its Powerstone renamed: the corpus holds no Vibranium maker in the fixtures, and the clause shape is the same. */
  const swapped = (token: string): ManaLine[] => {
    const fx = (fixtures as unknown as Record<string, { card: Record<string, unknown> & { _id: string; name: string; oracleText: string }; clauses: never[] }>)["Thran Spider"]!;
    const card = { ...fx.card, oracleText: fx.card.oracleText.replace(/Powerstone/g, token) };
    const clauses = JSON.parse(JSON.stringify(fx.clauses).replace(/Powerstone/g, token)) as never[];
    return (deriveCardTags(deriveInputOf(card as never, card._id, card.name, clauses)).manaLines ?? []).filter((l) => l.source === "token-maker");
  };
  it("a Vibranium maker is a token-maker line with Powerstone's shape", () => {
    const [vib] = swapped("Vibranium");
    const [pow] = swapped("Powerstone");
    expect(vib).toMatchObject({ producesToken: "vibranium", colours: [], colourless: 1, anyColour: null, restriction: { spend: "can't be spent to cast a nonartifact spell", typeName: "artifact", minManaValue: null } });
    expect(vib!.colours).toEqual(pow!.colours);
    expect(vib!.restriction).toEqual(pow!.restriction);
  });
  it("a Heartwood maker taps for R or G, as a non-token {T}: Add {R} or {G} does", () => {
    expect(swapped("Heartwood")[0]).toMatchObject({ producesToken: "heartwood", colours: ["R", "G"], colourless: 0, anyColour: null, restriction: null });
  });
  it("a replacement that adds a Heartwood or a Vibranium to another token's creation is a maker, down to the derived line", () => {
    const fx = (fixtures as unknown as Record<string, { card: Record<string, unknown> & { _id: string; name: string; oracleText: string }; clauses: never[] }>)["Bilbo, Fellow Conspirator"]!;
    const made = (token: string): (string | null)[] => {
      const card = { ...fx.card, oracleText: fx.card.oracleText.replace(/Treasure/g, token) };
      const clauses = JSON.parse(JSON.stringify(fx.clauses).replace(/Treasure/g, token)) as never[];
      return (deriveCardTags(deriveInputOf(card as never, card._id, card.name, clauses)).manaLines ?? []).filter((l) => l.source === "token-maker").map((l) => l.producesToken);
    };
    expect(made("Treasure")).toEqual(["treasure"]);
    expect(made("Powerstone")).toEqual(["powerstone"]);
    expect(made("Heartwood")).toEqual(["heartwood"]);
    expect(made("Vibranium")).toEqual(["vibranium"]);
    expect(replacementAddedToken("If you would create a Food token, instead create a Food token and a Heartwood token.")).toBe("heartwood");
    expect(replacementAddedToken("If you would create a Treasure token, instead create a Treasure token and a Vibranium token.")).toBe("vibranium");
  });
});

// #1376: the textless copy clause of "cast or copy" is folded by derive's twin fold, so it reads no ability of its own (`repeats` null beside the cast clause's value); the merge must still see ONE add.
describe("one printed add across a cast clause and a textless copy clause (#1376)", () => {
  it("Ashling, Flame Dancer: one trigger line", () => {
    const fx = (fixtures as unknown as Record<string, { card: Record<string, unknown> & { _id: string; name: string }; clauses: never[] }>)["Ashling, Flame Dancer"]!;
    const tags = deriveCardTags(deriveInputOf(fx.card as never, fx.card._id, fx.card.name, fx.clauses));
    expect((tags.manaLines ?? []).filter((l) => l.source === "trigger")).toHaveLength(1);
  });
});
