/** `manaLines` (#1169): the mana production of a card, read once in derive. EVERY CARD HERE IS REAL INPUT:
 *  `mana-lines.fixtures.json` holds the card document fields and the clause records derive used, dumped from Mongo
 *  by `research/mana/dump-mana-fixtures.mts`, so an assertion is about what the corpus carries and not about a card
 *  as remembered. The fixtures are not the production tags (no Mongo in the suite); they are its input. */
import { describe, expect, it } from "vitest";
import { deriveInputOf } from "../derive-input.js";
import { deriveCardTags } from "./derive.js";
import type { CardTags, ManaLine } from "../schema.js";
import { unpricedLoyaltyLines } from "./mana-lines.js";
import fixtures from "./mana-lines.fixtures.json" with { type: "json" };

const WUBRG = ["W", "U", "B", "R", "G"];
const tagsOf = (name: string): CardTags => {
  const fx = (fixtures as unknown as Record<string, { card: Record<string, unknown> & { _id: string; name: string }; clauses: never[] }>)[
    Object.keys(fixtures).find((k) => k === name || k.startsWith(`${name} //`)) ?? name]!;
  expect(fx, `fixture for ${name}`).toBeDefined();
  return deriveCardTags(deriveInputOf(fx.card as never, fx.card._id, fx.card.name, fx.clauses));
};
const linesOf = (name: string, source?: ManaLine["source"]): ManaLine[] =>
  (tagsOf(name).manaLines ?? []).filter((l) => source === undefined || l.source === source);
const only = (name: string, source?: ManaLine["source"]): ManaLine => {
  const ls = linesOf(name, source);
  expect(ls, `${name} lines`).toHaveLength(1);
  return ls[0]!;
};
const FREE_TAP = { mana: 0, tap: true, sacrificeSelf: false, sacrificeOther: false, life: 0, counters: null, tapOther: false, other: [] };

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
    expect(gated).toMatchObject({ colours: ["B", "R"], gate: "you control a swamp", amount: { fixed: 1, scales: null } });
    expect(only("Exotic Orchard")).toMatchObject({ anyColour: "opponent-lands", colours: [], face: 0 });
  });
  it("Llanowar Elves is a one-colour tap", () => {
    expect(only("Llanowar Elves")).toMatchObject({ colours: ["G"], colourless: 0, cost: FREE_TAP, net: 1 });
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
    expect(energy).toMatchObject({ anyColour: "any", cost: { tap: true, other: ["Pay {E}"] } });
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
    expect(l.restriction).toEqual({ spend: "to activate abilities" });
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
      cost: { mana: 0, tap: false, sacrificeSelf: false, sacrificeOther: true, life: 0, counters: null, tapOther: false, other: [] } });
  });
  it("Priest of Forgotten Gods taps and sacrifices two others for {B}{B}", () => {
    expect(only("Priest of Forgotten Gods")).toMatchObject({ source: "activated", colours: ["B"], amount: { fixed: 2, scales: null },
      cost: { tap: true, sacrificeSelf: false, sacrificeOther: true } });
  });
  it("Cryptic Trilobite pays with a counter, and the mana only activates abilities", () => {
    const l = only("Cryptic Trilobite");
    expect(l).toMatchObject({ colourless: 2, repeats: "repeatable", cost: { mana: 0, tap: false, counters: "remove", tapOther: false, other: [] } });
    expect(l.restriction).toEqual({ spend: "to activate abilities" });
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
    expect(speed).toMatchObject({ amount: { fixed: 2, scales: null }, gate: "speed 4" });
  });
});

describe("what fires a trigger line (DERIVE_VERSION 302)", () => {
  it("Lotus Cobra is landfall: `enters` on a land you control", () => {
    expect(only("Lotus Cobra", "trigger")).toMatchObject({ trigger: "enters", triggerSubject: "a land you control", anyColour: "any", amount: { fixed: 1, scales: null } });
  });
  it("Burning-Tree Emissary's enters trigger is `enters` on the card itself, not landfall", () => {
    const l = only("Burning-Tree Emissary", "trigger");
    expect(l.trigger).toBe("enters");
    expect(l.triggerSubject).not.toMatch(/\bland\b/);
  });
  it("a beginning-of-phase adder names the phase: Hulking Raptor and Eladamri's Vineyard `main-phase`", () => {
    expect(only("Hulking Raptor", "trigger")).toMatchObject({ trigger: "main-phase", amount: { fixed: 2, scales: null }, gate: null, restriction: null });
    expect(only("Eladamri's Vineyard", "trigger")).toMatchObject({ trigger: "main-phase", amount: { fixed: 2, scales: null } });
  });
  it("Birgi's cast trigger is `cast`", () => {
    expect(only("Birgi, God of Storytelling", "trigger")).toMatchObject({ trigger: "cast", triggerSubject: "a spell" });
  });
  it("an Aura's line is `tapped-for-mana` on the enchanted land; so is Forsaken Monument's, which is no Aura", () => {
    expect(only("Wild Growth", "aura-trigger")).toMatchObject({ trigger: "tapped-for-mana", triggerSubject: "enchanted land" });
    expect(only("Forsaken Monument", "trigger")).toMatchObject({ trigger: "tapped-for-mana" });
  });
  it("only a trigger or aura-trigger line names an event", () => {
    for (const n of ["Sol Ring", "Dark Ritual", "Pitiless Plunderer", "Cultivate", "Chromatic Lantern"]) {
      for (const l of linesOf(n)) expect([l.source, l.trigger, l.triggerSubject]).toEqual([l.source, null, null]);
    }
  });
  it("Ashling, Rimebound: one add fired by a transform AND the first main phase is named for the phase, and its two mana are read through the restriction sentence", () => {
    const ls = linesOf("Ashling, Rekindled", "trigger");
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ face: 1, trigger: "main-phase", triggerSubject: "your first main phase", anyColour: "any", amount: { fixed: 2, scales: null },
      restriction: { spend: "to cast spells with mana value 4 or greater" } });
  });
  it("a transform trigger alone stays a transform trigger (Alluring Suitor's back)", () => {
    expect(linesOf("Ashling, Flame Dancer", "trigger").every((l) => l.trigger === "cast" || l.trigger === "copy")).toBe(true);
  });
  it("Ashling's two clauses (cast, copy) are one printed add and keep the first event", () => {
    const ls = linesOf("Ashling, Flame Dancer", "trigger");
    expect(new Set(ls.map((l) => JSON.stringify({ ...l, trigger: null, triggerSubject: null }))).size).toBe(ls.length);
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
    expect(Object.keys(tagsOf("Urborg, Tomb of Yawgmoth")).sort()).toEqual(
      ["abilities", "characteristics", "model", "oracleId", "promptVersion", "schemaVersion", "staticFixer"]);
  });
});

describe("review fixes (#1169 task 1)", () => {
  it("a scaling amount the grammar path puts in action.amount is still a scaling amount", () => {
    expect(only("Gaea's Cradle").amount).toEqual({ fixed: null, scales: "for each creature you control" });
    expect(only("Priest of Titania").amount).toEqual({ fixed: null, scales: "for each elf on the battlefield" });
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
    expect(threshold).toMatchObject({ amount: { fixed: 5 }, gate: "there are seven or more cards in your graveyard" });
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
    expect(linesOf("Urza's Tower")[1]).toMatchObject({ colourless: 3, gate: "you control an urza's mine and an urza's power-plant" });
  });
  it("'as long as ...' on a granted ability gates the grant", () => {
    expect(only("Honored Hierarch").gate).toBe("this creature is renowned");
    expect(only("Mul Daya Channelers").gate).toBe("the top card of your library is a land card");
  });
  it("a fetch that lands only under a condition keeps its line and carries the condition", () => {
    for (const n of ["Embermouth Sentinel", "Ruin in Their Wake", "Scholar of New Horizons", "Stoic Farmer", "Natural Balance", "Elemental Teachings"]) {
      expect(tagsOf(n).landFetch, n).toBeDefined();
      expect(linesOf(n, "fetch")[0]!.gate, n).not.toBeNull();
    }
    expect(linesOf("Stoic Farmer", "fetch")[0]!.gate).toBe("an opponent controls more lands than you");
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
    expect(any).toMatchObject({ anyColour: "any", gate: "gemstone caverns has a luck counter on it" });
  });
  it("an intervening if gates the trigger", () => {
    expect(only("Mardu Warshrieker").gate).toBe("you attacked this turn");
    expect(only("Coal Stoker").gate).toBe("you cast it from your hand");
    expect(only("Realm-Scorcher Hellkite").gate).toBe("it was bargained");
    expect(only("Scattering Stroke").gate).toBe("you win");
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
    for (const fx of Object.keys(fixtures)) for (const l of tagsOf(fx.split(" // ")[0]!).manaLines ?? []) expect(l.gate ?? "", fx).not.toMatch(/^(?:you|they|that player) do$/);
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
    expect(yue.gate).toBe("when princess yue dies");
    // ...while "for as long as" stays a duration (the test above), and a grant by a STATIC parent has no trigger to gate it.
    expect(only("Abundant Growth").gate).toBeNull();
    expect(linesOf("Chromatic Lantern", "static-grant")[0]!.gate).toBeNull();
    // A trigger that grants for a while is gated (Hydro-Man's end step, Song of Freyalise's chapter "until your next turn"); a grant to ANOTHER card
    // (Vraska, the Silencer's returned Treasure) is no mana of Vraska's; a Saga chapter with no duration (Urza's Saga) stands, as a land's tap does.
    expect(only("Hydro-Man, Fluid Felon", "static-grant").gate).toBe("at the beginning of your end step");
    expect(only("Song of Freyalise", "static-grant").gate).toBe("until your next turn");
    expect(only("Vraska, the Silencer", "static-grant").gate).toBe("whenever a nontoken creature an opponent controls dies");
    expect(only("Urza's Saga", "static-grant").gate).toBeNull();
  });
  it("Ashling's one printed add is one line, not one per cast/copy twin", () => {
    expect(linesOf("Ashling, Flame Dancer")).toHaveLength(1);
  });
});

describe("review round 4 (#1169 task 1)", () => {
  it("Charitable Levy: the 'if' before the comma is the gate, the sacrifice after it is the cost", () => {
    const l = linesOf("Charitable Levy", "fetch")[0]!;
    expect(l.gate).toBe("there are three or more collection counters on it");
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
    expect(only("Chandra, Novice Pyromancer", "activated")).toMatchObject({ cost: { other: ["\u22121"] }, startLoyalty: 5 });
    expect(only("Chandra, Torch of Defiance", "activated")).toMatchObject({ cost: { other: ["+1"] }, startLoyalty: 4 });
    expect(only("Nissa, Worldwaker", "fetch")).toMatchObject({ cost: { other: ["\u22127"] }, startLoyalty: 3 });
    expect(linesOf("Nissa, Who Shakes the World", "fetch")[0]).toMatchObject({ cost: { other: ["\u22128"] }, startLoyalty: 5 });
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
    expect(l).toMatchObject({ source: "one-shot-spell", trigger: "tapped-for-mana", triggerSubject: "an Island", timing: "on-trigger", untilEndOfTurn: true,
      colours: ["U"], amount: { fixed: 1, scales: null }, cost: { mana: 1 } });
    expect(tagsOf("High Tide").isOneShot).toBe(true);
  });
  it("Bubbling Muck reads the same, for Swamps", () => {
    expect(only("Bubbling Muck")).toMatchObject({ source: "one-shot-spell", trigger: "tapped-for-mana", triggerSubject: "a Swamp", untilEndOfTurn: true, colours: ["B"] });
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
