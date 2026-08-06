import { expect, test } from "vitest";
import { pairReasons, directedReasons, cardThemeTags, themeSubjectKey } from "./edges.js";
import type { CardTags } from "@mtg/tagger";
import type { DeckCard, Hierarchy } from "./types.js";

const H: Hierarchy = { wizard: ["creature"], zombie: ["creature"] };
const base = (name: string, abilities: CardTags["abilities"], subtypes: string[] = []) => ({
  card: { name, typeLine: "", oracleText: "", keywords: [], colors: [], manaValue: 0 } as never,
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["creature"], subtypes, colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
    abilities,
  } as CardTags,
});

test("event edge: a token-maker's emit matches a wizard-ETB payoff trigger", () => {
  const maker = base("Inalla", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "you", token: false } },
    effect: { kind: "token-generation", subject: { subtype: "wizard", control: "you", token: true } },
    emits: [{ verb: "enters", subject: { subtype: "wizard", control: "you", token: true } }],
  }]);
  const payoff = base("Kindred Discovery", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const reasons = pairReasons(maker, payoff, H);
  expect(reasons.some((r) => r.tag === "enters:creature")).toBe(true);
  expect(reasons.some((r) => r.text.includes("Inalla") && r.text.includes("Kindred Discovery"))).toBe(true);
});

test("reason text is human-readable — no raw tag tokens leak", () => {
  const maker = base("Inalla", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "you", token: false } },
    effect: { kind: "token-generation", subject: { subtype: "wizard", control: "you", token: true } },
    emits: [{ verb: "enters", subject: { subtype: "wizard", control: "you", token: true } }],
  }]);
  const etbPayoff = base("Kindred Discovery", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const reasons = pairReasons(maker, etbPayoff, H);
  const etb = reasons.find((r) => r.tag === "enters:creature")!;
  expect(etb.text).not.toMatch(/:/); // no "enters:creature" style token
  expect(etb.text).toContain("a creature entering");
  // both card names still present (CLI + engine rely on this)
  expect(etb.text).toContain(maker.card.name);
  expect(etb.text).toContain(etbPayoff.card.name);
});

test("static edge: a zombie lord matches a zombie by characteristics", () => {
  const lord = base("Death Baron", [{
    kind: "static",
    effect: { kind: "pump", subject: { subtype: "zombie", control: "you", token: null } },
  }]);
  const zombie = base("Gravecrawler", [], ["zombie"]);
  const reasons = pairReasons(lord, zombie, H);
  expect(reasons.some((r) => r.tag === "static:pump")).toBe(true);
});

test("clone edge: an activated copy that names a subtype applies to a card of that subtype", () => {
  // Shapesharer: "{2}{U}: Target Shapeshifter becomes a copy of target creature." The applies-to
  // pass only ever considered STATIC abilities, so a copy that names WHO becomes the copy formed no
  // edge with Universal Automaton, a Shapeshifter in the same deck — a miss the recall measurement
  // found. A clone that names a subtype is typal by construction; one that does not names no
  // subject at all (derive drops it), so widening the pass cannot mesh.
  const H2: Hierarchy = { ...H, shapeshifter: ["creature"] };
  const shapesharer = base("Shapesharer", [{
    kind: "activated",
    cost: "",
    effect: { kind: "clone", subject: { subtype: "shapeshifter", scope: "target", control: "any", token: null } },
  }], ["shapeshifter"]);
  const automaton = base("Universal Automaton", [], ["shapeshifter"]);
  const reasons = pairReasons(shapesharer, automaton, H2);
  const clone = reasons.find((r) => r.tag === "clone:shapeshifter");
  expect(clone).toBeDefined();
  // An activated ability is not a static one, whatever pass it travels through.
  expect(clone?.repeatability).toBe("activated");
});

test("token gate excludes a nontoken-only payoff from token producers", () => {
  // goblin:["creature"] must be present so the type clause passes (goblin implies creature);
  // otherwise the type mismatch alone would exclude the edge and the token gate wouldn't be exercised.
  // The producer is a SORCERY (not a creature via `base`): a creature token-maker would itself
  // imply a nontoken self-`enters:creature` event (Stage 2.1 implied events), which would
  // legitimately satisfy the nontoken payoff and mask the token gate this test targets. As a
  // sorcery, the producer only implies `cast` (no self-`enters`), so the sole `enters`-family
  // event reaching the payoff is the authored token emit (token:true) — isolating the gate.
  const localH: Hierarchy = { ...H, goblin: ["creature"] };
  const maker = {
    card: { name: "Krenko's Command", typeLine: "", oracleText: "", keywords: [], colors: [], manaValue: 0 } as never,
    tags: {
      oracleId: "Krenko's Command", schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: { types: ["sorcery"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
      abilities: [{
        kind: "static",
        effect: { kind: "token-generation", subject: { subtype: "goblin", control: "you", token: true } },
        emits: [{ verb: "enters", subject: { subtype: "goblin", control: "you", token: true } }],
      }],
    } as CardTags,
  };
  const blink = base("Blink Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: false } },
    effect: { kind: "draw-card" },
  }]);
  expect(pairReasons(maker, blink, localH)).toEqual([]);
});

test("a cast Wizard's implied enters event feeds a chosen-type wizard payoff (regression: no edge before implied events)", () => {
  // Producer: a plain Human Wizard creature with NO authored emits.
  const wizard = base("Naban, Dean of Iteration", [], ["human", "wizard"]);
  // Consumer: Kindred Discovery, already chosen-type-resolved to subtype "wizard".
  const kindred = base("Kindred Discovery", [{
    kind: "triggered",
    trigger: { verbs: ["enters", "attacks"], subject: { type: "creature", subtype: "wizard", control: "you", token: false } },
    effect: { kind: "draw-card" },
  }]);
  const localH: Hierarchy = { ...H, human: ["creature"] };
  const reasons = pairReasons(wizard, kindred, localH);
  expect(reasons.some((r) => r.tag === "enters:wizard")).toBe(true);
});

test("an instant does not produce an implied enters edge", () => {
  const bolt = {
    card: { name: "Lightning Bolt", typeLine: "", oracleText: "", keywords: [], colors: [], manaValue: 0 } as never,
    tags: {
      oracleId: "Lightning Bolt", schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: { types: ["instant"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
      abilities: [],
    } as CardTags,
  };
  const etbPayoff = base("Impact Tremors", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "damage" },
  }]);
  const reasons = pairReasons(bolt, etbPayoff, H);
  expect(reasons.some((r) => r.tag.startsWith("enters:"))).toBe(false);
});

test("themeSubjectKey prefers subtype, then type, else any", () => {
  expect(themeSubjectKey({ subtype: "wizard", control: "you", token: null })).toBe("wizard");
  expect(themeSubjectKey({ type: "creature", control: "you", token: null })).toBe("creature");
  expect(themeSubjectKey({ control: "you", token: null })).toBe("any");
});

test("cardThemeTags collects trigger, emit, and static keys", () => {
  const t = base("X", [{
    kind: "triggered",
    trigger: { verbs: ["dies"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "drain" },
  }]).tags;
  expect([...cardThemeTags(t)]).toContain("dies:creature");
});

test("event-edge reason carries the consumer's effectKind and triggered repeatability", () => {
  const maker = base("Inalla", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "you", token: false } },
    effect: { kind: "token-generation", subject: { subtype: "wizard", control: "you", token: true } },
    emits: [{ verb: "enters", subject: { subtype: "wizard", control: "you", token: true } }],
  }]);
  const payoff = base("Kindred Discovery", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const reason = pairReasons(maker, payoff, H).find((r) => r.tag === "enters:creature")!;
  expect(reason.effectKind).toBe("draw-card");
  expect(reason.repeatability).toBe("triggered");
});

test("a bare self-ETB trigger (no type, no subtype) is classified oneshot", () => {
  const maker = base("SomeWizard", [], ["wizard"]); // implies self enters:wizard event
  const dockside = base("Dockside", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: false } }, // "when this enters"
    effect: { kind: "token-generation" },
  }]);
  const reason = pairReasons(maker, dockside, H).find((r) => r.repeatability !== undefined)!;
  expect(reason.effectKind).toBe("token-generation");
  expect(reason.repeatability).toBe("oneshot");
});

test("static-edge reason carries static effectKind and static repeatability", () => {
  const lord = base("Death Baron", [{
    kind: "static",
    effect: { kind: "pump", subject: { subtype: "zombie", control: "you", token: null } },
  }]);
  const zombie = base("Gravecrawler", [], ["zombie"]);
  const reason = pairReasons(lord, zombie, H).find((r) => r.tag === "static:pump")!;
  expect(reason.effectKind).toBe("pump");
  expect(reason.repeatability).toBe("static");
});

test("event-edge reason carries the consumer effect's scaling; absent stays undefined", () => {
  const maker = base("Maker", [], ["wizard"]); // implies self enters:wizard
  const scaler = base("Scaler", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "drain", scaling: "per-creature" },
  }]);
  const flat = base("Flat", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "damage" }, // no scaling
  }]);
  const sReason = pairReasons(maker, scaler, H).find((r) => r.effectKind === "drain")!;
  expect(sReason.scaling).toBe("per-creature");
  const fReason = pairReasons(maker, flat, H).find((r) => r.effectKind === "damage")!;
  expect(fReason.scaling).toBeUndefined();
});

test("static-edge reason carries the static effect's scaling", () => {
  const lord = base("Lord", [{
    kind: "static",
    effect: { kind: "pump", scaling: "per-permanent", subject: { subtype: "zombie", control: "you", token: null } },
  }]);
  const zombie = base("Zombie", [], ["zombie"]);
  const reason = pairReasons(lord, zombie, H).find((r) => r.tag === "static:pump")!;
  expect(reason.scaling).toBe("per-permanent");
});

test("on-cast producer: an on-cast mill emit feeds a mill-payoff trigger", () => {
  const speller = base("Maddening Cacophony", [{
    kind: "on-cast",
    effect: { kind: "top-manipulation", subject: { control: "opp", token: null } },
    emits: [{ verb: "mill", subject: { control: "opp", token: null } }],
  }]);
  const payoff = base("Mill Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["mill"], subject: { control: "opp", token: null } },
    effect: { kind: "drain", subject: { control: "opp", token: null } },
  }]);
  const reasons = pairReasons(speller, payoff, H);
  expect(reasons.some((r) => r.tag.startsWith("mill:"))).toBe(true);
});

test("on-cast is producer-only: two on-cast cards produce no cast:any consumer edge", () => {
  const a = base("Windfall", [{
    kind: "on-cast",
    effect: { kind: "draw-card", subject: { control: "you", token: null } },
    emits: [{ verb: "draw", subject: { control: "you", token: null } }],
  }]);
  const b = base("Maddening Cacophony", [{
    kind: "on-cast",
    effect: { kind: "top-manipulation", subject: { control: "opp", token: null } },
    emits: [{ verb: "mill", subject: { control: "opp", token: null } }],
  }]);
  const reasons = pairReasons(a, b, H);
  // Neither on-cast ability is a consumer, so no spurious cast:* edge forms between them.
  expect(reasons.some((r) => r.tag.startsWith("cast:"))).toBe(false);
});

test("filler -> reanimator: a discard fills the graveyard, feeding a graveyard-recursion effect", () => {
  const filler = base("Faithless Looting", [{
    kind: "on-cast",
    effect: { kind: "draw-card", subject: { control: "you", token: null } },
    emits: [{ verb: "discard", subject: { control: "you", token: null } }],
  }]);
  const reanimator = base("Muldrotha", [{
    kind: "static",
    effect: { kind: "graveyard-recursion", subject: { control: "you", token: null, type: "creature", zone: "graveyard" } },
  }]);
  const reasons = pairReasons(filler, reanimator, H);
  expect(reasons.some((r) => r.tag.startsWith("graveyard-recursion") && r.effectKind === "graveyard-recursion")).toBe(true);
});

test("mill -> Syr Konrad: a mill fills the graveyard, feeding an enters-graveyard:creature trigger", () => {
  const miller = base("Ruin Crab", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "land" } },
    effect: { kind: "top-manipulation", subject: { control: "opp", token: null } },
    emits: [{ verb: "mill", subject: { control: "opp", token: null } }],
  }]);
  const konrad = base("Syr Konrad", [{
    kind: "triggered",
    trigger: { verbs: ["enters-graveyard"], subject: { control: "any", token: null, type: "creature", zone: "graveyard" } },
    effect: { kind: "damage", subject: { control: "opp", token: null } },
  }]);
  const reasons = pairReasons(miller, konrad, H);
  expect(reasons.some((r) => r.tag === "enters-graveyard:creature")).toBe(true);
});

test("mill does NOT feed a Blood-Artist-style dies trigger", () => {
  const miller = base("Ruin Crab", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "land" } },
    effect: { kind: "top-manipulation", subject: { control: "opp", token: null } },
    emits: [{ verb: "mill", subject: { control: "opp", token: null } }],
  }]);
  const bloodArtist = base("Blood Artist", [{
    kind: "triggered",
    trigger: { verbs: ["dies"], subject: { control: "any", token: null, type: "creature" } },
    effect: { kind: "drain", subject: { control: "opp", token: null } },
  }]);
  const reasons = pairReasons(miller, bloodArtist, H);
  expect(reasons.some((r) => r.tag.startsWith("dies:"))).toBe(false);
});

test("ETB regression: a battlefield enters still feeds a wizard-ETB trigger; a graveyard fill does not", () => {
  const maker = base("Wizard Maker", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null } },
    effect: { kind: "token-generation", subject: { subtype: "wizard", control: "you", token: true } },
    emits: [{ verb: "enters", subject: { subtype: "wizard", control: "you", token: true } }],
  }], ["wizard"]);
  const etbPayoff = base("Wizard ETB Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "you", token: null } },
    effect: { kind: "draw-card", subject: { control: "you", token: null } },
  }], ["wizard"]);
  const grave = base("Miller", [{
    kind: "on-cast",
    effect: { kind: "top-manipulation", subject: { control: "opp", token: null } },
    emits: [{ verb: "mill", subject: { control: "opp", token: null } }],
  }]);
  expect(pairReasons(maker, etbPayoff, H).some((r) => r.tag === "enters:wizard")).toBe(true);
  expect(pairReasons(grave, etbPayoff, H).some((r) => r.tag === "enters:wizard")).toBe(false);
  // Mirror: a battlefield enters producer event must NOT feed an enters-graveyard consumer trigger.
  const graveyardPayoff = base("Graveyard ETB Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["enters-graveyard"], subject: { subtype: "wizard", control: "you", token: null, zone: "graveyard" } },
    effect: { kind: "draw-card", subject: { control: "you", token: null } },
  }], ["wizard"]);
  expect(pairReasons(maker, graveyardPayoff, H).some((r) => r.tag === "enters-graveyard:wizard")).toBe(false);
});

test("no double-count: a consumer with both an enters-graveyard trigger AND a graveyard-recursion effect on the same ability is credited exactly once", () => {
  const filler = base("Faithless Looting", [{
    kind: "on-cast",
    effect: { kind: "draw-card", subject: { control: "you", token: null } },
    emits: [{ verb: "discard", subject: { control: "you", token: null } }],
  }]);
  const reanimator = base("Gravecrawler-Style Reanimator", [{
    kind: "triggered",
    trigger: { verbs: ["enters-graveyard"], subject: { control: "you", token: null, type: "creature", zone: "graveyard" } },
    effect: { kind: "graveyard-recursion", subject: { control: "you", token: null, type: "creature", zone: "graveyard" } },
  }]);
  const reasons = pairReasons(filler, reanimator, H);
  const recursionReasons = reasons.filter(
    (r) => r.tag.startsWith("graveyard-recursion") || r.tag.startsWith("enters-graveyard"),
  );
  expect(recursionReasons).toHaveLength(1);
});

test("non-graveyard-trigger reanimator: a triggered graveyard-recursion ability whose trigger verb does NOT match the fill is still fed by the reanimator loop", () => {
  const filler = base("Faithless Looting", [{
    kind: "on-cast",
    effect: { kind: "draw-card", subject: { control: "you", token: null } },
    emits: [{ verb: "discard", subject: { control: "you", token: null } }],
  }]);
  // Trigger verb "attacks" normalizes to a non-graveyard-entry event, so the guard must NOT skip this ability.
  const attackReanimator = base("Attack-Triggered Reanimator", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "you", token: null } },
    effect: { kind: "graveyard-recursion", subject: { control: "you", token: null, type: "creature", zone: "graveyard" } },
  }]);
  const reasons = pairReasons(filler, attackReanimator, H);
  expect(reasons.some((r) => r.tag.startsWith("graveyard-recursion") && r.effectKind === "graveyard-recursion")).toBe(true);
});

test("proliferate source -> proliferate payoff: a source's proliferate feeds Tekuthal's doubler", () => {
  const source = base("Karn's Bastion", [{
    kind: "activated", cost: "{4}, {T}",
    effect: { kind: "proliferate" },
    emits: [{ verb: "proliferate", subject: { control: "you", token: null } }],
  }]);
  const tekuthal = base("Tekuthal", [{
    kind: "triggered",
    trigger: { verbs: ["proliferate"], subject: { control: "you", token: null } },
    effect: { kind: "trigger-doubling" },
  }]);
  const reasons = pairReasons(source, tekuthal, H);
  expect(reasons.some((r) => r.tag === "proliferate:any" && r.effectKind === "trigger-doubling")).toBe(true);
});

test("proliferate -> counter payoff: a proliferate implies a counter-added that feeds a +1/+1 payoff", () => {
  const source = base("Karn's Bastion", [{
    kind: "activated", cost: "{4}, {T}",
    effect: { kind: "proliferate" },
    emits: [{ verb: "proliferate", subject: { control: "you", token: null } }],
  }]);
  const counterPayoff = base("Counter Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["counter-added"], subject: { control: "you", token: null, counter: "+1/+1" } },
    effect: { kind: "draw-card" },
  }]);
  const reasons = pairReasons(source, counterPayoff, H);
  expect(reasons.some((r) => r.tag.startsWith("counter-added") && r.effectKind === "draw-card")).toBe(true);
});

test("no-regression: a normal +1/+1 counter placer still feeds a +1/+1 payoff", () => {
  const placer = base("Placer", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null } },
    effect: { kind: "counter-placement" },
    emits: [{ verb: "counter-added", subject: { control: "you", token: null, counter: "+1/+1" } }],
  }]);
  const counterPayoff = base("Counter Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["counter-added"], subject: { control: "you", token: null, counter: "+1/+1" } },
    effect: { kind: "draw-card" },
  }]);
  const reasons = pairReasons(placer, counterPayoff, H);
  expect(reasons.some((r) => r.tag.startsWith("counter-added") && r.effectKind === "draw-card")).toBe(true);
});

test("no-regression: a card that does NOT proliferate implies no counter-added", () => {
  const plainCreature = base("Bear", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "you", token: null } },
    effect: { kind: "pump", subject: { control: "you", token: null } },
  }]);
  const counterPayoff = base("Counter Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["counter-added"], subject: { control: "you", token: null, counter: "+1/+1" } },
    effect: { kind: "draw-card" },
  }]);
  const reasons = pairReasons(plainCreature, counterPayoff, H);
  expect(reasons.some((r) => r.tag.startsWith("counter-added"))).toBe(false);
});

test("event edge sets hasStatPredicate=true when the consumer trigger has a stats predicate", () => {
  const producer = base("Soul Warden", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: false } },
    effect: { kind: "lifegain" },
    emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: false } }],
  }]);
  const consumer = base("Welcoming Vampire", [{
    kind: "triggered",
    trigger: {
      verbs: ["enters"],
      subject: { type: "creature", control: "you", token: null, stats: [{ metric: "power", op: "lte", value: 2 }] },
    },
    effect: { kind: "draw-card" },
  }]);
  const reasons = pairReasons(producer, consumer, H);
  const matched = reasons.find((r) => r.tag === "enters:creature");
  expect(matched?.hasStatPredicate).toBe(true);
});

test("event edge leaves hasStatPredicate unset when the consumer trigger has no stats predicate", () => {
  const producer = base("Soul Warden", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: false } },
    effect: { kind: "lifegain" },
    emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: false } }],
  }]);
  const consumer = base("Kindred Discovery", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const reasons = pairReasons(producer, consumer, H);
  const matched = reasons.find((r) => r.tag === "enters:creature");
  expect(matched?.hasStatPredicate).toBeUndefined();
});

test("static edge sets hasStatPredicate=true for a toughness-matters marker", () => {
  const doran = base("Doran, the Siege Tower", [{
    kind: "static",
    effect: {
      kind: "damage-multiplier",
      subject: { type: "creature", control: "you", token: null, stats: [{ metric: "toughness", op: "gte", vs: "power" }] },
    },
  }]);
  const wall = base("Wall of Omens", [], []);
  const reasons = pairReasons(doran, wall, H);
  const matched = reasons.find((r) => r.tag === "static:damage-multiplier");
  expect(matched?.hasStatPredicate).toBe(true);
});

test("dedup: a producer with BOTH an authored counter-added emit AND a proliferate emit credits a shared counter payoff exactly once", () => {
  // Two independent abilities on the same producer: one authors a +1/+1 counter-added event
  // directly, the other emits proliferate (which independently implies an untyped counter-added
  // event). Both are byte-distinct-shaped events that satisfy the same consumer trigger, so
  // without dedup they'd produce two byte-identical Reason objects for one payoff.
  const dualSource = base("Dual Source", [
    {
      kind: "triggered",
      trigger: { verbs: ["enters"], subject: { control: "you", token: null } },
      effect: { kind: "counter-placement" },
      emits: [{ verb: "counter-added", subject: { control: "you", token: null, counter: "+1/+1" } }],
    },
    {
      kind: "activated", cost: "{4}, {T}",
      effect: { kind: "proliferate" },
      emits: [{ verb: "proliferate", subject: { control: "you", token: null } }],
    },
  ]);
  const counterPayoff = base("Counter Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["counter-added"], subject: { control: "you", token: null, counter: "+1/+1" } },
    effect: { kind: "draw-card" },
  }]);
  const reasons = pairReasons(dualSource, counterPayoff, H);
  const counterReasons = reasons.filter((r) => r.tag.startsWith("counter-added"));
  expect(counterReasons).toHaveLength(1);
});

// --- combatSelfSupplied gate (Item 2): implied-only, and only when the consumer doesn't narrow ---

test("directedReasons: a bare 'creature attacks' consumer still gets no edge from a plain creature's implied attack", () => {
  const attacker = base("Attacker", []); // implies a bare attacks event (no supplier needed)
  const genericTrigger = base("Generic Trigger", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "you", token: null } },
    effect: { kind: "pump" },
  }]);
  const reasons = directedReasons(attacker, genericTrigger, H);
  expect(reasons.some((r) => r.tag.startsWith("attacks"))).toBe(false);
});

/** Fix 2a: `stats` narrows a combat trigger just as much as `subtype` does -- "power 4 or greater"
 *  (Garruk's Uprising) is not free, so a real supplying creature must produce a real edge. */
test("directedReasons: a stats-narrowed attack trigger (power 4+) DOES receive an edge from a matching creature", () => {
  const bigCreature = {
    card: { name: "Big Creature", typeLine: "", oracleText: "", keywords: [], colors: [], manaValue: 0 } as never,
    tags: {
      oracleId: "Big Creature", schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 0, power: "4", toughness: "4", token: false, keywords: [] },
      abilities: [],
    } as CardTags,
  };
  const statsTrigger = base("Garruk's Uprising", [{
    kind: "triggered",
    trigger: {
      verbs: ["attacks"],
      subject: { type: "creature", control: "you", token: null, stats: [{ metric: "power", op: "gte", value: 4 }] },
    },
    effect: { kind: "pump" },
  }]);
  const reasons = directedReasons(bigCreature, statsTrigger, H);
  expect(reasons.some((r) => r.tag.startsWith("attacks"))).toBe(true);
});

/** Fix 2b: the gate only ever suppresses IMPLIED combat producers. An AUTHORED attacks emit (goad,
 *  Mage Slayer, Saskia and similar) is real information and must still feed a generic combat
 *  consumer, even though a plain creature's implied attack would not. */
test("directedReasons: an authored attacks emit matches a generic combat consumer even though an implied one would not", () => {
  const goader = {
    card: { name: "Goader", typeLine: "", oracleText: "", keywords: [], colors: [], manaValue: 0 } as never,
    tags: {
      oracleId: "Goader", schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: { types: ["sorcery"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
      abilities: [{
        kind: "on-cast",
        effect: { kind: "forced-sacrifice", subject: { control: "opp", token: null } },
        emits: [{ verb: "attacks", subject: { control: "opp", token: null } }],
      }],
    } as CardTags,
  };
  const genericTrigger = base("Generic Trigger", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "any", token: null } },
    effect: { kind: "pump" },
  }]);
  const reasons = directedReasons(goader, genericTrigger, H);
  expect(reasons.some((r) => r.tag.startsWith("attacks"))).toBe(true);

  // Contrast: a plain creature's implied attack does NOT satisfy that same bare consumer.
  const plainCreature = base("Plain Creature", []);
  expect(directedReasons(plainCreature, genericTrigger, H).some((r) => r.tag.startsWith("attacks"))).toBe(false);
});

test("an event reason records which card consumes it and which supplies it", () => {
  const maker = base("Fathom Mage", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
    emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: null } }],
  }]);
  const payoff = base("Warden of the Grove", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "counter-placement" },
  }]);
  const reasons = pairReasons(maker, payoff, H);
  const ev = reasons.find((r) => r.tag === "enters:creature");
  expect(ev).toBeDefined();
  expect(ev!.consumer).toBe("Warden of the Grove");
  expect(ev!.producer).toBe("Fathom Mage");
});

// Reuses the fixture from "filler -> reanimator: a discard fills the graveyard, feeding a
// graveyard-recursion effect" (known to hit edges.ts's reanimator-consumer site, not the
// event-edges site: Faithless Looting's discard normalizes to enters:graveyard, and Muldrotha's
// graveyard-recursion effect has no trigger of its own for the event-edges loop to match).
test("a reanimator-consumer reason records which card fills the graveyard and which recurs from it", () => {
  const filler = base("Faithless Looting", [{
    kind: "on-cast",
    effect: { kind: "draw-card", subject: { control: "you", token: null } },
    emits: [{ verb: "discard", subject: { control: "you", token: null } }],
  }]);
  const reanimator = base("Muldrotha", [{
    kind: "static",
    effect: { kind: "graveyard-recursion", subject: { control: "you", token: null, type: "creature", zone: "graveyard" } },
  }]);
  const reasons = pairReasons(filler, reanimator, H);
  const rec = reasons.find((r) => r.tag.startsWith("graveyard-recursion"));
  expect(rec).toBeDefined();
  expect(rec!.consumer).toBe("Muldrotha");
  expect(rec!.producer).toBe("Faithless Looting");
});

// Reuses the fixture from "static edge: a zombie lord matches a zombie by characteristics"
// (known to hit edges.ts's static-edges site).
test("a static reason records which card supplies the effect and which is affected", () => {
  const lord = base("Death Baron", [{
    kind: "static",
    effect: { kind: "pump", subject: { subtype: "zombie", control: "you", token: null } },
  }]);
  const zombie = base("Gravecrawler", [], ["zombie"]);
  const reasons = pairReasons(lord, zombie, H);
  const stat = reasons.find((r) => r.tag === "static:pump");
  expect(stat).toBeDefined();
  expect(stat!.consumer).toBe("Gravecrawler");
  expect(stat!.producer).toBe("Death Baron");
});

// Fixture shapes below are lifted verbatim from the real corpus (mtg.cardTags in Mongo, checked
// 2026-08-04), not guessed from memory:
//   Hardened Scales   a1f3da21-af6d-450e-bf0b-985d158418e6
//   Inspiring Call    9b9a10ff-5a5d-4df8-88aa-18d84ff9117c
//   Fathom Mage       93d0e129-e3b5-4aff-9e50-f34771ed00ff
//   Primordial Hydra  1c36ed3a-c806-47e5-83f9-e44999c67fe5

test("a card that benefits from creatures carrying counters links to the card adding them", () => {
  // Hardened Scales: static counter-placement that emits counter-added.
  const adder = base("Hardened Scales", [{
    kind: "static",
    effect: { kind: "counter-placement", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } },
    emits: [{ verb: "counter-added", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } }],
  }]);
  // Inspiring Call: cares that creatures HAVE +1/+1 counters; emits nothing.
  const carer = base("Inspiring Call", [{
    kind: "on-cast",
    effect: { kind: "pump", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } },
    emits: [],
  }]);
  const reasons = pairReasons(adder, carer, H);
  const r = reasons.find((x) => x.tag.startsWith("counter-added"));
  expect(r, "no counter reason was produced").toBeDefined();
  expect(r!.consumer).toBe("Inspiring Call");
  expect(r!.producer).toBe("Hardened Scales");
});

test("a mismatched counter kind produces no edge", () => {
  const adder = base("Hardened Scales", [{
    kind: "static",
    effect: { kind: "counter-placement", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } },
    emits: [{ verb: "counter-added", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } }],
  }]);
  const loyalty = base("Loyalty Carer", [{
    kind: "on-cast",
    effect: { kind: "pump", subject: { type: "creature", control: "you", token: null, counter: "loyalty" } },
    emits: [],
  }]);
  expect(pairReasons(adder, loyalty, H).some((x) => x.tag.startsWith("counter-added"))).toBe(false);
});

// Guard 1: an ability whose OWN emits already include counter-added is a producer of that state,
// not a carer of it -- its effect.subject.counter describes what it places, not a condition it
// benefits from. Shape lifted from Fathom Mage's real first ability (evolve: put a +1/+1 counter
// on this creature on a bigger creature entering) rather than invented, per the corpus IDs above.
// Without the guard this pair would gain one counter-added reason from the new pass; with it,
// zero -- neither ability here triggers on counter-added, so the pre-existing event-edge pass
// contributes nothing either.
test("an ability that itself places counters is not also counted as caring about them", () => {
  const adder = base("Hardened Scales", [{
    kind: "static",
    effect: { kind: "counter-placement", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } },
    emits: [{ verb: "counter-added", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } }],
  }]);
  const selfPlacer = base("Evolving Engine", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: false } },
    effect: { kind: "counter-placement", subject: { control: "you", token: null, counter: "+1/+1" } },
    emits: [{ verb: "counter-added", subject: { control: "you", token: null, counter: "+1/+1" } }],
  }]);
  const counterReasons = pairReasons(adder, selfPlacer, H).filter((x) => x.tag.startsWith("counter-added"));
  expect(counterReasons.length).toBe(0);
});

// Guard 2: an ability that already TRIGGERS on counter-added is covered by the existing event-edge
// pass; the new pass must not also match its effect.subject if that happens to carry the same
// counter kind. Shape lifted from Primordial Hydra's real tagged ability (trigger: counter-added
// +1/+1, effect: token-doubling on a +1/+1-counter subject) -- a real case where both the trigger
// and the effect subject name the same counter kind, so the double-count guard is actually live.
test("an ability that already triggers on counter-added does not gain a duplicate reason", () => {
  const adder = base("Hardened Scales", [{
    kind: "static",
    effect: { kind: "counter-placement", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } },
    emits: [{ verb: "counter-added", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } }],
  }]);
  const doubler = base("Counter Doubler", [{
    kind: "triggered",
    trigger: { verbs: ["counter-added"], subject: { control: "you", token: null, counter: "+1/+1" } },
    effect: { kind: "token-doubling", subject: { control: "you", token: null, counter: "+1/+1" } },
    emits: [],
  }]);
  const counterReasons = pairReasons(adder, doubler, H).filter((x) => x.tag.startsWith("counter-added"));
  // exactly the one reason the pre-existing event-edge pass (trigger.verbs includes counter-added)
  // already produces; the new pass must recognize its own would-be match is the same edge and skip.
  expect(counterReasons.length).toBe(1);
  expect(counterReasons[0].consumer).toBe("Counter Doubler");
  expect(counterReasons[0].producer).toBe("Hardened Scales");
});

// Regression: the counter-presence pass must walk producerEvents(p.tags), not raw per-ability
// emits -- two abilities on the same producer that each independently emit the identical
// counter-added event should credit a cares-only consumer exactly once, even measured via
// directedReasons directly (not pairReasons, whose own JSON dedup would mask this: analyze.ts
// calls directedReasons undeduped, so a double credit here inflates topPartners' score and
// duplicates the rendered sentence). producerEvents' JSON-based collapse is what prevents it.
test("two abilities emitting the identical counter-added event credit a cares-only consumer exactly once", () => {
  const dualAdder = base("Twin Counter Source", [
    {
      kind: "triggered",
      trigger: { verbs: ["enters"], subject: { control: "you", token: false } },
      effect: { kind: "counter-placement", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } },
      emits: [{ verb: "counter-added", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } }],
    },
    {
      kind: "activated", cost: "{2}",
      effect: { kind: "counter-placement", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } },
      emits: [{ verb: "counter-added", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } }],
    },
  ]);
  const carer = base("Inspiring Call", [{
    kind: "on-cast",
    effect: { kind: "pump", subject: { type: "creature", control: "you", token: null, counter: "+1/+1" } },
    emits: [],
  }]);
  const counterReasons = directedReasons(dualAdder, carer, H).filter((r) => r.tag.startsWith("counter-added"));
  expect(counterReasons.length).toBe(1);
});

test("reasons record whether the producer side was baseline or authored", () => {
  const payoff = base("ETB Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const vanilla = base("Vanilla Bear", []);
  const maker = base("Token Maker", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "token-generation", subject: { type: "creature", control: "you", token: true } },
    emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: true } }],
  }]);

  const fromVanilla = directedReasons(vanilla, payoff, H);
  expect(fromVanilla.length).toBeGreaterThan(0);
  expect(fromVanilla.every((r) => r.impliedProducer === true)).toBe(true);

  const fromMaker = directedReasons(maker, payoff, H);
  const authored = fromMaker.filter((r) => r.impliedProducer !== true);
  expect(authored.length, "the authored token emit is surplus, not baseline").toBeGreaterThan(0);
});

// Regression: a creature that satisfies a "whenever a creature enters" payoff BOTH by baseline
// (it is a creature) AND by an authored token-generation emit must not double-count. Without
// excluding impliedProducer from pairReasons' dedup key, this pair scores 2 -- a plain creature
// token-maker against a ubiquitous ETB payoff scoring higher than it should purely because it
// also happens to be a creature. See edges.ts pairReasons.
test("pairReasons does not double-count a producer that satisfies one trigger by both baseline and authored emit", () => {
  const maker = base("Token Maker", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "token-generation", subject: { type: "creature", control: "you", token: true } },
    emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: true } }],
  }]);
  const payoff = base("ETB Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  expect(pairReasons(maker, payoff, H).length).toBe(1);
});

test("a static effect is a theme tag even when we cannot say WHO it applies to", () => {
  // Rage Reflection: "Attacking creatures you control have double strike." The clause records
  // grant-ability with object "double strike" -- WHAT is granted, not who receives it -- so the
  // recipient is unrecoverable and derive drops the subject. That is correct for pairwise EDGES:
  // without a subject there is nothing to match against, and inventing one is the mesh this layer
  // keeps fighting.
  //
  // It is wrong for THEME membership. The card is a speed-increase card whether or not we know its
  // targets, and dropping it from cardThemeTags is why derived decks lost their static themes and
  // drifted onto whatever tag had the most volume.
  const tags = {
    oracleId: "x", schemaVersion: 1, promptVersion: 0, model: "derived",
    characteristics: { types: ["enchantment"], subtypes: [], colors: ["R"], identity: ["R"], cmc: 5, power: null, toughness: null, token: false, keywords: [] },
    abilities: [{ kind: "static" as const, effect: { kind: "speed-increase" as const } }],
  };
  expect(cardThemeTags(tags as never).has("static:speed-increase")).toBe(true);
});

test("a bare self-ETB payoff is not supplied by another permanent merely entering", () => {
  // 74% of all false edges in the 2026-08-05 precision measurement were this: "When Urza enters,
  // create a Construct" watches ITSELF entering, and every land, rock and creature in the deck was
  // credited with supplying it. Sol Ring entering does not trigger Urza.
  //
  // The gate is the same shape as combatSelfSupplied: it fires only on IMPLIED producer events --
  // the card merely being a permanent that enters -- so an authored emit still forms edges.
  const rock = base("Sol Ring", []);
  const selfEtb = base("Urza", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "creature", self: true } },
    effect: { kind: "token-generation" },
  }]);
  expect(directedReasons(rock, selfEtb, H).filter((r) => r.tag.startsWith("enters"))).toEqual([]);
});

test("a blink effect DOES supply a bare self-ETB payoff", () => {
  // The other half, and why the gate must not simply drop self-ETB triggers: Blur exiles and
  // returns a creature, so it genuinely makes that permanent re-enter and fire its own ETB. The
  // emit is authored rather than implied, so the edge survives.
  const blink = base("Blur", [{
    kind: "on-cast",
    effect: { kind: "blink" },
    emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: false } }],
  }]);
  const selfEtb = base("Watcher for Tomorrow", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "creature", self: true } },
    effect: { kind: "tutor" },
  }]);
  expect(directedReasons(blink, selfEtb, H).some((r) => r.tag.startsWith("enters"))).toBe(true);
});

test("a TYPED enters trigger is untouched by the gate", () => {
  // "Whenever another creature you control enters" genuinely watches other permanents, so an
  // implied entry is real supply. The gate must not widen to these or it deletes the engine's
  // best edges.
  const creature = base("Llanowar Elves", []);
  const typedPayoff = base("Agate Instigator", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "non-combat-damage" },
  }]);
  expect(directedReasons(creature, typedPayoff, H).some((r) => r.tag.startsWith("enters"))).toBe(true);
});

test("a token entering does not satisfy a payoff watching ITSELF enter", () => {
  // The residual after the self-ETB gate: `create` emits an `enters` event, but the thing that
  // entered is the TOKEN -- a new object. It can never be the card whose trigger watches its own
  // entry, however many tokens are made. The emit is authored rather than implied, so the
  // implied-only gate did not reach it.
  const tokenMaker = base("Tempt with Vengeance", [{
    kind: "on-cast",
    effect: { kind: "token-generation" },
    emits: [{ verb: "enters", subject: { type: "creature", subtype: "elemental", control: "any", token: true } }],
  }]);
  const selfEtb = base("Gray Merchant of Asphodel", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "creature", self: true } },
    effect: { kind: "drain" },
  }]);
  expect(directedReasons(tokenMaker, selfEtb, H).filter((r) => r.tag.startsWith("enters"))).toEqual([]);
});

test("a token entering still satisfies a payoff watching OTHER creatures enter", () => {
  // The bound: tokens are real permanents and this is the whole of go-wide. Only the self case is
  // impossible.
  const tokenMaker = base("Tempt with Vengeance", [{
    kind: "on-cast",
    effect: { kind: "token-generation" },
    emits: [{ verb: "enters", subject: { type: "creature", subtype: "elemental", control: "any", token: true } }],
  }]);
  const payoff = base("Agate Instigator", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "non-combat-damage" },
  }]);
  expect(directedReasons(tokenMaker, payoff, H).some((r) => r.tag.startsWith("enters"))).toBe(true);
});

test("a self-CAST trigger is not supplied by another spell being cast", () => {
  // The same defect one verb over: Nulldrifter's "When you cast this spell, draw two cards" watches
  // ITSELF being cast, and every spell in the deck was credited with supplying it. Skull Storm,
  // Artisan of Kozilek and Warped Tusker are the same shape.
  const otherSpell = base("Lightning Bolt", []);
  const selfCast = base("Nulldrifter", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { control: "you", token: null, self: true } },
    effect: { kind: "draw-card" },
  }]);
  expect(directedReasons(otherSpell, selfCast, H).filter((r) => r.tag.startsWith("cast"))).toEqual([]);
});

test("a card that casts OTHER cards does supply a self-cast trigger", () => {
  // The bound, and the reason this cannot just drop self-cast triggers: Bolas's Citadel casting
  // Nulldrifter off the top genuinely triggers Nulldrifter's own cast ability. An authored cast
  // emit is a card that casts something else; an implied one is only the producer being castable.
  const enabler = base("Bolas's Citadel", [{
    kind: "static",
    effect: { kind: "" },
    emits: [{ verb: "cast", subject: { control: "you", token: null } }],
  }]);
  const selfCast = base("Nulldrifter", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { control: "you", token: null, self: true } },
    effect: { kind: "draw-card" },
  }]);
  expect(directedReasons(enabler, selfCast, H).some((r) => r.tag.startsWith("cast"))).toBe(true);
});

test("a payoff watching OTHER casts is untouched", () => {
  // The bound in the other direction. `base` gives every fixture card types: ["creature"], so the
  // payoff here watches creature casts -- Bontu's Monument's shape rather than Talrand's.
  const spell = base("Grave Titan", []);
  const payoff = base("Bontu's Monument", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "drain" },
  }]);
  expect(directedReasons(spell, payoff, H).some((r) => r.tag.startsWith("cast"))).toBe(true);
});

test("a dying artifact is not described as a dying creature", () => {
  // Scrap Trawler watches its own death AND another artifact hitting the graveyard, so a sac outlet
  // supplies both `dies:creature` and `dies:artifact`. humanizeEvent hardcoded "a creature dying"
  // for every dies event, so the two reasons rendered as identical lines -- which read as a
  // duplicate bug, but is really the reader being told an artifact is a creature.
  const outlet = base("Executioner's Capsule", [{
    kind: "activated",
    effect: { kind: "" },
    emits: [
      { verb: "dies", subject: { type: "creature", control: "you", token: null } },
      { verb: "dies", subject: { type: "artifact", control: "you", token: null } },
    ],
  }]);
  const trawler = base("Scrap Trawler", [
    {
      kind: "triggered",
      trigger: { verbs: ["dies"], subject: { type: "creature", control: "you", token: null } },
      effect: { kind: "graveyard-recursion" },
    },
    {
      kind: "triggered",
      trigger: { verbs: ["dies"], subject: { type: "artifact", control: "you", token: null } },
      effect: { kind: "graveyard-recursion" },
    },
  ]);
  const texts = directedReasons(outlet, trawler, H)
    .filter((r) => r.tag.startsWith("dies")).map((r) => r.text);
  expect(new Set(texts).size).toBe(texts.length);
  expect(texts.some((t) => t.includes("an artifact dying"))).toBe(true);
  expect(texts.some((t) => t.includes("a creature dying"))).toBe(true);
});

test("directedReasons does not repeat a reason it has already made", () => {
  // The card-synergy view calls directedReasons directly (analyze.ts), and only pairReasons deduped
  // -- so a producer with two graveyard-fill events and a consumer with two recursion abilities
  // printed the SAME line four times. Scrap Trawler grew its second recursion ability from the
  // two-condition split, which is what made this visible.
  const filler = base("Trading Post", [{
    kind: "activated",
    effect: { kind: "" },
    emits: [
      { verb: "enters-graveyard", subject: { type: "artifact", control: "you", token: null } },
      { verb: "enters-graveyard", subject: { type: "creature", control: "you", token: null } },
    ],
  }]);
  const recursion = base("Scrap Trawler", [
    {
      kind: "triggered",
      trigger: { verbs: ["dies"], subject: { type: "artifact", control: "you", token: null } },
      effect: { kind: "graveyard-recursion", subject: { type: "artifact", control: "you", token: null, zone: "graveyard" } },
    },
    {
      kind: "triggered",
      trigger: { verbs: ["dies"], subject: { type: "creature", control: "you", token: null } },
      effect: { kind: "graveyard-recursion", subject: { type: "artifact", control: "you", token: null, zone: "graveyard" } },
    },
  ]);
  const reasons = directedReasons(filler, recursion, H);
  const keys = reasons.map((r) => JSON.stringify(r));
  expect(new Set(keys).size).toBe(keys.length);
});

test("every reason tag the engine emits humanizes into prose, never a raw tag", () => {
  // "Nadier's Nightblade triggers on leaves any" reached the web UI verbatim: humanizeEvent had no
  // `leaves` case, so it fell through to the de-slugify default and shipped the tag as English.
  // zoneEventKey turns leaves@battlefield into `dies`, so a bare `leaves` is a permanent going
  // somewhere OTHER than the graveyard -- exile, hand, library.
  const producer = base("Imskir Iron-Eater", [{
    kind: "activated", effect: { kind: "" },
    emits: [{ verb: "leaves", subject: { control: "you", token: null } }],
  }]);
  const consumer = base("Nadier's Nightblade", [{
    kind: "triggered",
    trigger: { verbs: ["leaves"], subject: { control: "you", token: null } },
    effect: { kind: "drain" },
  }]);
  const texts = directedReasons(producer, consumer, H).map((r) => r.text);
  expect(texts.length).toBeGreaterThan(0);
  for (const t of texts) expect(t).not.toMatch(/leaves any|:/);
  expect(texts[0]).toContain("leaving the battlefield");
});

test("a becomes-tapped reason humanizes into prose, never a raw tag", () => {
  // "Unctus, Grand Metatect triggers on taps creature" reached the web UI verbatim -- same defect
  // as the `leaves` case above, in a different verb. Merrow Reejerey ("you may tap or untap target
  // permanent") really does supply Unctus's granted "whenever this creature becomes tapped", so
  // this is a TRUE edge that was merely being described in slug.
  const producer = base("Merrow Reejerey", [{
    kind: "triggered", effect: { kind: "" },
    emits: [{ verb: "taps", subject: { control: "any", token: null, type: "creature" } }],
  }]);
  const consumer = base("Unctus, Grand Metatect", [{
    kind: "triggered",
    trigger: { verbs: ["taps"], subject: { control: "you", token: null, type: "creature" } },
    effect: { kind: "card-draw" },
  }]);
  const texts = directedReasons(producer, consumer, H).map((r) => r.text);
  expect(texts.length).toBeGreaterThan(0);
  for (const t of texts) expect(t).not.toMatch(/taps creature|taps any|:/);
  expect(texts[0]).toContain("becoming tapped");
});

test("a self-recursion is only enabled by a fill that could contain the card itself", () => {
  // Metalwork Colossus returns ITSELF from the graveyard. Buried Ruin sacrifices ITSELF -- a land --
  // which can never put the Colossus there, yet the reanimator-consumer edge fired because the
  // recursion subject carried no self marker and `graveyardFillMatches` wildcards an untyped fill.
  // A sacrifice outlet that CAN eat the Colossus is a real enabler and must survive.
  const colossus: DeckCard = {
    card: { name: "Metalwork Colossus", typeLine: "Artifact Creature", oracleText: "", keywords: [], colors: [], manaValue: 11, colorIdentity: [], power: "10", toughness: "10" },
    tags: {
      oracleId: "c", schemaVersion: 1, promptVersion: 0, model: "derived",
      characteristics: { types: ["artifact", "creature"], subtypes: [], colors: [], identity: [], cmc: 11, power: "10", toughness: "10", token: false, keywords: [] },
      abilities: [{
        kind: "activated",
        effect: { kind: "graveyard-recursion", subject: { control: "you", token: null, self: true, zone: "graveyard" } },
      }],
    },
  };
  const filler = (name: string, type: string): DeckCard => ({
    card: { name, typeLine: type, oracleText: "", keywords: [], colors: [], manaValue: 2, colorIdentity: [], power: null, toughness: null },
    tags: {
      oracleId: name, schemaVersion: 1, promptVersion: 0, model: "derived",
      characteristics: { types: [type.toLowerCase()], subtypes: [], colors: [], identity: [], cmc: 2, power: null, toughness: null, token: false, keywords: [] },
      // A graveyard fill is expressed as a permanent LEAVING the battlefield; impliedGraveyardEvents
      // turns that into the enters@graveyard event the reanimator edge reads.
      abilities: [{
        kind: "activated", effect: { kind: "" },
        emits: [{ verb: "leaves", subject: { control: "you", token: null, zone: "battlefield", type: type.toLowerCase() } }],
      }],
    },
  });

  // A land hitting the graveyard cannot be the Colossus.
  const land = directedReasons(filler("Buried Ruin", "Land"), colossus, H)
    .filter((r) => r.tag.startsWith("graveyard-recursion"));
  expect(land).toEqual([]);

  // An artifact hitting the graveyard could be.
  const artifact = directedReasons(filler("Krark-Clan Ironworks", "Artifact"), colossus, H)
    .filter((r) => r.tag.startsWith("graveyard-recursion"));
  expect(artifact.length).toBeGreaterThan(0);
});

test("a self-ETB is only supplied by an event that could be that card entering", () => {
  // The gate `selfEtbSelfSupplied` excludes IMPLIED and TOKEN producers only, so an AUTHORED emit
  // that puts some OTHER object onto the battlefield still satisfied a consumer's own ETB: Windswept
  // Heath fetching a Forest "triggered" The Grey Havens' self-ETB, and Death Tyrant's Zombie token
  // "triggered" Bastion of Remembrance. The consumer's self subject names no type, so nothing was
  // left to check it against.
  //
  // The rule has to keep the TRUE ones: Bloodstained Mire really does fetch Raucous Theater (Land -
  // Swamp Mountain) and fire its own ETB. So the test is whether the producer's subject could BE the
  // consumer, not whether the producer is authored.
  const selfEtbLand = (name: string, subtypes: string[]): DeckCard => ({
    card: { name, typeLine: `Land ${subtypes.join(" ")}`, oracleText: "", keywords: [], colors: [], manaValue: 0, colorIdentity: [], power: null, toughness: null },
    tags: {
      oracleId: name, schemaVersion: 1, promptVersion: 0, model: "derived",
      characteristics: { types: ["land"], subtypes, colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
      abilities: [{
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: { control: "you", token: null, self: true } },
        effect: { kind: "top-manipulation" },
      }],
    },
  });
  const fetch: DeckCard = {
    card: { name: "Bloodstained Mire", typeLine: "Land", oracleText: "", keywords: [], colors: [], manaValue: 0, colorIdentity: [], power: null, toughness: null },
    tags: {
      oracleId: "f", schemaVersion: 1, promptVersion: 0, model: "derived",
      characteristics: { types: ["land"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
      abilities: [{
        kind: "activated", effect: { kind: "" },
        emits: [{ verb: "enters", subject: { control: "you", token: null, type: "land", subtype: ["swamp", "mountain"] } }],
      }],
    },
  };

  // Raucous Theater IS a Swamp Mountain, so the fetch can put it onto the battlefield. Keep.
  expect(directedReasons(fetch, selfEtbLand("Raucous Theater", ["swamp", "mountain"]), H).length).toBeGreaterThan(0);
  // The Grey Havens is a Legendary Land with no basic types. No fetch can find it.
  expect(directedReasons(fetch, selfEtbLand("The Grey Havens", []), H)).toEqual([]);
});

test("a card re-entering itself does not satisfy another card's own ETB", () => {
  // Reassembling Skeleton returning itself is a real creature entering -- Purphoros should see it --
  // but it can never be the event Boggart Trawler's "when THIS creature enters" watches.
  const skeleton = base("Reassembling Skeleton", [{
    kind: "activated", effect: { kind: "" },
    emits: [{ verb: "enters", subject: { control: "you", token: null, self: true } }],
  }]);
  const selfEtb = base("Boggart Trawler", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null, self: true } },
    effect: { kind: "graveyard-hate" },
  }]);
  expect(directedReasons(skeleton, selfEtb, H).filter((r) => r.tag.startsWith("enters"))).toEqual([]);

  // ...but a payoff watching OTHER creatures enter is untouched.
  const payoff = base("Purphoros, God of the Forge", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "damage" },
  }]);
  expect(directedReasons(skeleton, payoff, H).some((r) => r.tag.startsWith("enters"))).toBe(true);
});

test("a trigger that names an ORIGIN zone is not satisfied by an event from anywhere else", () => {
  // River Kelpie: "whenever this creature or another permanent enters FROM A GRAVEYARD". The origin
  // was dropped, so every permanent entering matched -- Phantasmal Image and Omni-Changeling, which
  // enter from hand, and Trade Routes, which does not put anything into play at all. Three of the
  // frozen panel's false claims are exactly this card.
  const fromHand = base("Phantasmal Image", [{
    kind: "static",
    effect: { kind: "clone" },
    emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: null } }],
  }]);
  const reanimator = base("Persist", [{
    kind: "on-cast",
    effect: { kind: "graveyard-recursion" },
    emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: null, fromZone: "graveyard" } }],
  }]);
  const kelpie = base("River Kelpie", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "permanent", control: "you", token: null, fromZone: "graveyard" } },
    effect: { kind: "draw-card" },
  }]);
  expect(pairReasons(fromHand, kelpie, H).some((r) => r.tag.startsWith("enters:"))).toBe(false);
  // ...and the reanimation it actually wants still forms.
  expect(pairReasons(reanimator, kelpie, H).some((r) => r.tag.startsWith("enters:"))).toBe(true);
});

test("a trigger with no origin is still satisfied by an event that has one", () => {
  // The constraint is opt-in in ONE direction only. An unset trigger `fromZone` means "any origin",
  // so stamping origins onto producer emits must not cost a single edge that exists today.
  const reanimator = base("Persist", [{
    kind: "on-cast",
    effect: { kind: "graveyard-recursion" },
    emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: null, fromZone: "graveyard" } }],
  }]);
  const anyEtb = base("Kindred Discovery", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  expect(pairReasons(reanimator, anyEtb, H).some((r) => r.tag === "enters:creature")).toBe(true);
});

test("an unconstrained cast watcher is not supplied by a card merely being castable", () => {
  // Aetherflux Reservoir, Birgi, Arjun, Managorger Hydra, Liberator, and every "whenever you cast
  // your SECOND spell each turn" card (Ledger Shredder, Taigam, Tomb of Horrors Adventurer,
  // Dreamtide Whale, Rammas Echor). Casting spells is what a deck does; "whenever you cast a spell"
  // is a deck-level state condition, not an event another card supplies. 27 of the frozen panel's
  // 33 `generic` false claims are this one shape.
  //
  // Exactly the rule `combatSelfSupplied` already applies to attacking: keyed on the PRODUCER's
  // `implied` flag, so a card that genuinely CASTS other cards still supplies it.
  const anySpell = base("Frantic Search", []);
  const reservoir = base("Aetherflux Reservoir", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { type: "spell", control: "you", token: null } },
    effect: { kind: "lifegain" },
  }]);
  expect(pairReasons(anySpell, reservoir, H).some((r) => r.tag.startsWith("cast:"))).toBe(false);

  // A consumer that narrows WHICH spell is a real payoff and keeps its IMPLIED suppliers. (`base`
  // types every fixture as a creature, so a creature-spell watcher is the narrowing case here.)
  const creatureSpells = base("Beast Whisperer", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  expect(pairReasons(anySpell, creatureSpells, H).some((r) => r.tag.startsWith("cast:"))).toBe(true);
});

test("a card that CASTS other cards still supplies an unconstrained cast watcher", () => {
  // Bolas's Citadel, Abstract Performance, Impulsivity: an AUTHORED cast emit is a card genuinely
  // putting spells on the stack, which is real supply for a spell-count payoff. The gate is keyed on
  // `implied`, not on the consumer's shape alone, for exactly this reason.
  const citadel = base("Bolas's Citadel", [{
    kind: "static",
    effect: { kind: "" },
    emits: [{ verb: "cast", subject: { type: "creature", control: "you", token: null } }],
  }]);
  const reservoir = base("Aetherflux Reservoir", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { type: "spell", control: "you", token: null } },
    effect: { kind: "lifegain" },
  }]);
  expect(directedReasons(citadel, reservoir, H).some((r) => r.tag.startsWith("cast"))).toBe(true);
});

test("a historic cast watcher narrows, and only historic cards satisfy it", () => {
  // Jhoira, Basim Ibn Ishaq, Glóin, Rona, The Sixth Doctor. Their trigger DOES narrow -- historic is
  // artifact, legendary or Saga -- so `castSelfSupplied` must not gate it, and the cards that
  // satisfy it are exactly the historic ones. 11 of the 20 real claims the cast gate cost were this.
  const legendary = {
    ...base("Aragorn, the Uniter", []),
    tags: { ...base("Aragorn, the Uniter", []).tags,
      characteristics: { ...base("Aragorn, the Uniter", []).tags.characteristics, types: ["legendary", "creature"] } },
  };
  const artifact = {
    ...base("Arcane Signet", []),
    tags: { ...base("Arcane Signet", []).tags,
      characteristics: { ...base("Arcane Signet", []).tags.characteristics, types: ["artifact"] } },
  };
  const plain = base("Llanowar Elves", []);
  const jhoira = base("Jhoira, Weatherlight Captain", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { type: "spell", control: "you", token: null, historic: true } },
    effect: { kind: "draw-card" },
  }]);
  expect(pairReasons(legendary, jhoira, H).some((r) => r.tag.startsWith("cast:"))).toBe(true);
  expect(pairReasons(artifact, jhoira, H).some((r) => r.tag.startsWith("cast:"))).toBe(true);
  // An ordinary creature is not historic, so it does not satisfy the trigger -- the narrowing is
  // real, which is the whole reason the gate must not fire here.
  expect(pairReasons(plain, jhoira, H).some((r) => r.tag.startsWith("cast:"))).toBe(false);
});

test("a negated subject keys and reads as the negation, not as one arbitrary member", () => {
  // `cast:artifact` for a noncreature trigger is not a cosmetic wart: humanizeEvent renders the key
  // into the reason the user reads, so an INSTANT supplying Valley Floodcaller produced "triggers on
  // an artifact being cast". cardThemeTags uses the same key, so those payoffs were grouped with
  // artifact-cast decks on the theme axis.
  const floodcaller = base("Valley Floodcaller", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: {
      type: ["artifact", "enchantment", "planeswalker", "instant", "sorcery", "battle"],
      notType: ["creature"], control: "you", token: null,
    } },
    effect: { kind: "pump" },
  }]);
  expect(themeSubjectKey(floodcaller.tags.abilities[0].trigger!.subject)).toBe("-creature");
  // `base` types every fixture as a creature, and a creature is exactly what this subject excludes.
  const instant = {
    ...base("Rakdos Charm", []),
    tags: { ...base("Rakdos Charm", []).tags,
      characteristics: { ...base("Rakdos Charm", []).tags.characteristics, types: ["instant"] } },
  };
  const reasons = pairReasons(instant, floodcaller, H);
  expect(reasons.some((r) => r.tag === "cast:-creature")).toBe(true);
  expect(reasons.find((r) => r.tag === "cast:-creature")!.text).toContain("a noncreature spell being cast");
});

test("an artifact CREATURE spell does not satisfy a noncreature trigger", () => {
  // The resolved list cannot carry the exclusion. "Noncreature spell" leaves six types INCLUDING
  // artifact, and an artifact creature spell has both types, so the intersection matched a card the
  // text plainly excludes: Valley Floodcaller does not trigger on casting Solemn Simulacrum.
  //
  // So `notType` is load-bearing in MATCHING, not only in the label -- the positive list says what
  // may satisfy the subject, the negation says what may not, and both have to be tested.
  const floodcaller = base("Valley Floodcaller", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: {
      type: ["artifact", "enchantment", "planeswalker", "instant", "sorcery", "battle"],
      notType: ["creature"], control: "you", token: null,
    } },
    effect: { kind: "pump" },
  }]);
  const withTypes = (name: string, types: string[]) => {
    const b = base(name, []);
    return { ...b, tags: { ...b.tags, characteristics: { ...b.tags.characteristics, types } } };
  };
  // `base` fixtures are creatures; an ARTIFACT creature is the case that used to slip through.
  expect(pairReasons(withTypes("Solemn Simulacrum", ["artifact", "creature"]), floodcaller, H)
    .some((r) => r.tag.startsWith("cast:"))).toBe(false);
  // A legendary artifact creature must be excluded too -- the supertype in the type line must not
  // make the producer look unknowable.
  expect(pairReasons(withTypes("Sydri", ["legendary", "artifact", "creature"]), floodcaller, H)
    .some((r) => r.tag.startsWith("cast:"))).toBe(false);
  // A plain artifact is a noncreature spell and still satisfies it.
  expect(pairReasons(withTypes("Sol Ring", ["artifact"]), floodcaller, H)
    .some((r) => r.tag.startsWith("cast:"))).toBe(true);
  expect(pairReasons(withTypes("Rakdos Charm", ["instant"]), floodcaller, H)
    .some((r) => r.tag.startsWith("cast:"))).toBe(true);
});

test("an artifact that is not a creature does not satisfy an artifact-CREATURE anthem", () => {
  // Master of Etherium: "Other ARTIFACT CREATURES you control get +1/+1". Sol Ring is an artifact and
  // not a creature; Goreclaw is a creature and not an enchantment. Both satisfied their anthems
  // because a `type` array means OR. `allTypes` is the conjunction the array cannot express.
  const withTypes = (name: string, types: string[]) => {
    const b = base(name, []);
    return { ...b, tags: { ...b.tags, characteristics: { ...b.tags.characteristics, types } } };
  };
  const master = base("Master of Etherium", [{
    kind: "static",
    effect: { kind: "pump", subject: {
      type: ["creature", "artifact"], allTypes: ["artifact", "creature"],
      control: "you", token: null, scope: "all",
    } },
  }]);
  expect(pairReasons(withTypes("Sol Ring", ["artifact"]), master, H)
    .some((r) => r.tag.startsWith("static:"))).toBe(false);
  // An artifact creature is both, and keeps its edge.
  expect(pairReasons(withTypes("Solemn Simulacrum", ["artifact", "creature"]), master, H)
    .some((r) => r.tag.startsWith("static:"))).toBe(true);
  // A plain creature is not an artifact creature.
  expect(pairReasons(withTypes("Llanowar Elves", ["creature"]), master, H)
    .some((r) => r.tag.startsWith("static:"))).toBe(false);
});

// A fill marked SELF means the producer card itself goes to the graveyard. It can satisfy another
// card's self-recursion only if the two are the same card, which a pair never is. The gate stripped
// `zone` but let `self` ride along in fillIdentity, and subjectMatches ignores it -- so the fill read
// as untyped and wildcarded through the very check that exists to demand proof. Necromancy, whose
// own sacrifice clause is self, thereby "enabled" Eye of Nidhogg returning ITSELF.
test("a self fill does not enable a different card's self-recursion", () => {
  const filler = base("Necromancy", [{
    kind: "triggered",
    effect: { kind: "" },
    emits: [{ verb: "dies", subject: { control: "any", token: null, self: true } }],
  }]);
  const recurser = base("Eye of Nidhogg", [{
    kind: "triggered",
    trigger: { verbs: ["leaves"], subject: { control: "you", token: null, self: true } },
    effect: {
      kind: "graveyard-recursion",
      subject: { control: "any", token: null, self: true, zone: "graveyard" },
    },
  }]);
  const reasons = pairReasons(filler, recurser, H);
  expect(reasons.some((r) => r.tag.startsWith("graveyard-recursion"))).toBe(false);
});

// COST REDUCTION IS RAMP, NOT SYNERGY (user ruling, 2026-08-06). A Medallion's value is "how many
// blue spells do I run" - a property of deck CONSTRUCTION, not a relationship with any particular
// blue card. Sapphire Medallion in a mono-red deck does nothing, and no pairwise edge can say that.
// Left in, one cost reducer fans out to 60-68 cards at the same weight as a two-card combo.
test("a cost reducer forms no edge with a card it happens to discount", () => {
  const medallion = base("Sapphire Medallion", [{
    kind: "static",
    effect: {
      kind: "cost-reduction",
      subject: { type: "creature", control: "you", token: null, scope: "all" },
    },
  }]);
  const spell = base("An Offer You Can't Refuse", []);
  expect(pairReasons(medallion, spell, H).some((r) => r.tag === "static:cost-reduction")).toBe(false);
});

// A TAX IS INTERACTION / PROTECTION, NOT SYNERGY (user ruling, 2026-08-06). Propaganda and Ghostly
// Prison make opponents attack you less - that is a deck ROLE, the same way cost reduction is ramp.
// It slows opponents down; it does not relate to any particular card you chose to run.
test("a tax forms no edge either", () => {
  const grid = base("Defense Grid", [{
    kind: "static",
    effect: {
      kind: "tax",
      subject: { type: "creature", control: "any", token: null, scope: "all" },
    },
  }]);
  const spell = base("Some Spell", []);
  expect(pairReasons(grid, spell, H).some((r) => r.tag === "static:tax")).toBe(false);
});

// Serah Farron and Jodah, the Unifier are legendary-matters anthems that reached EVERY creature,
// which made them the two widest meshes in the derived population (x53, x51).
test("a legendary anthem does not reach a nonlegendary creature", () => {
  const anthem = base("Serah Farron", [{
    kind: "static",
    effect: {
      kind: "pump",
      subject: { type: "creature", control: "you", token: null, scope: "all", legendary: true },
    },
  }]);
  const plain = base("Grizzly Bears", []);
  expect(pairReasons(anthem, plain, H).some((r) => r.tag === "static:pump")).toBe(false);
});

// The other half of the legendary filter, and the one that cost five real edges when it was missing:
// a LEGENDARY card's own entry must advertise the supertype, or "another legendary creature you
// control enters" (Legolas, Gimli, Tinybones Joins Up) is satisfied by nothing at all. A legend has
// to be able to be a legend.
test("a legendary card's own entry satisfies a legendary-only trigger", () => {
  const legend = {
    ...base("Ellie, Brick Master", []),
    tags: {
      ...base("Ellie, Brick Master", []).tags,
      characteristics: {
        ...base("Ellie, Brick Master", []).tags.characteristics,
        types: ["legendary", "creature"],
      },
    },
  };
  const payoff = base("Legolas Greenleaf", [{
    kind: "triggered",
    trigger: {
      verbs: ["enters"],
      subject: { type: "creature", control: "you", token: null, legendary: true },
    },
    effect: { kind: "counter-placement" },
  }]);
  expect(pairReasons(legend, payoff, H).some((r) => r.tag.startsWith("enters"))).toBe(true);
});

// Typing the counter must not flip a counter placer out of the permissive path. An add-counter's
// subject is parsed from its object -- "+1/+1" -- which describes the COUNTER, not the permanent
// receiving it, so it names no type and cannot satisfy strict matching. The Great Henge and
// Forgotten Ancient stopped feeding their +1/+1 payoffs the moment the kind was recorded.
test("a counter placer still feeds a counter payoff once the kind is known", () => {
  const henge = base("The Great Henge", [{
    kind: "triggered",
    effect: { kind: "counter-placement" },
    emits: [{ verb: "counter-added", subject: { control: "you", token: null, counter: "+1/+1" } }],
  }]);
  const payoff = base("Dusk Legion Duelist", [{
    kind: "triggered",
    trigger: { verbs: ["counter-added"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  expect(pairReasons(henge, payoff, H).some((r) => r.tag.startsWith("counter-added"))).toBe(true);
});

// ...but a kind MISMATCH is now real information: a +1/+1 producer is not a poison enabler.
test("a counter placer does not feed a payoff for a different counter kind", () => {
  const henge = base("The Great Henge", [{
    kind: "triggered",
    effect: { kind: "counter-placement" },
    emits: [{ verb: "counter-added", subject: { control: "you", token: null, counter: "+1/+1" } }],
  }]);
  const poison = base("Poison Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["counter-added"], subject: { control: "you", token: null, counter: "poison" } },
    effect: { kind: "draw-card" },
  }]);
  expect(pairReasons(henge, poison, H).some((r) => r.tag.startsWith("counter-added"))).toBe(false);
});

// A counter-presence condition is a BOARD STATE, not a printed characteristic. The static applies-to
// pass matches against the card's type line, which never carries counters, so demanding one there
// deletes the edge outright - Sludge Monster's anthem stopped reaching anything. The dedicated
// counter-presence pass is what supplies that state.
test("a static whose subject wants a counter still applies to a card that can carry one", () => {
  const anthem = base("Sludge Monster", [{
    kind: "static",
    effect: {
      kind: "pump",
      subject: { type: "creature", control: "you", token: null, scope: "all", counter: "-1/-1" },
    },
  }]);
  const creature = base("Laboratory Maniac", []);
  expect(pairReasons(anthem, creature, H).some((r) => r.tag === "static:pump")).toBe(true);
});

// MELD is the relation the engine had no shape for: Mishra, Claimed by Gix names "a creature named
// Phyrexian Dragon Engine" outright, and the engine matches producer EVENTS to consumer TRIGGERS.
// The recall measurement filed that exact pair `miss-inexpressible`; Commander Salt models it as a
// `named` qualifier, MTGJSON as `cardParts`, and the corpus now carries `meldPartner`. A gap, not a
// ceiling.
test("two meld partners form an edge", () => {
  const a = { ...base("Mishra, Claimed by Gix", []) };
  (a.card as { meldPartner?: string }).meldPartner = "Phyrexian Dragon Engine";
  const b = { ...base("Phyrexian Dragon Engine", []) };
  (b.card as { meldPartner?: string }).meldPartner = "Mishra, Claimed by Gix";
  const reasons = pairReasons(a, b, H);
  expect(reasons.some((r) => r.tag === "meld")).toBe(true);
  expect(reasons.find((r) => r.tag === "meld")?.text).toContain("meld");
});

// The relation is symmetric and the pair is ONE fact. Emitting it from both directions would double
// every meld pair in the report.
test("a meld pair states its edge once, not once per direction", () => {
  const a = { ...base("Bruna, the Fading Light", []) };
  (a.card as { meldPartner?: string }).meldPartner = "Gisela, the Broken Blade";
  const b = { ...base("Gisela, the Broken Blade", []) };
  (b.card as { meldPartner?: string }).meldPartner = "Bruna, the Fading Light";
  expect(pairReasons(a, b, H).filter((r) => r.tag === "meld")).toHaveLength(1);
});

test("a meld card forms no edge with a card that is not its partner", () => {
  const a = { ...base("Mishra, Claimed by Gix", []) };
  (a.card as { meldPartner?: string }).meldPartner = "Phyrexian Dragon Engine";
  expect(pairReasons(a, base("Sol Ring", []), H).some((r) => r.tag === "meld")).toBe(false);
});

// TUTOR: "my search can find you". Flamekin Harbinger searches for an Elemental card, and every
// Elemental in the deck is a real thing it finds. The recall measurement filed this family
// `miss-inexpressible`; it is a gap, and Commander Salt models it.
//
// GATED ON A SUBTYPE, for the reason the clone gate exists. Of 115 corpus search actions, "a card"
// (Demonic Tutor, Grim Tutor, Gamble) reaches all 99 other cards, "a creature card" (Worldly Tutor)
// reaches the whole creature base, and "an artifact card" (Fabricate) the whole artifact base. A
// bare TYPE is not a relation to any particular card; a SUBTYPE is.
test("a typal tutor forms an edge with what it can find", () => {
  const harbinger = base("Flamekin Harbinger", [{
    kind: "triggered",
    effect: { kind: "top-manipulation", subject: { control: "you", token: null, subtype: "elemental" } },
  }]);
  const elemental = base("Omnath", [], ["elemental"]);
  const reasons = pairReasons(harbinger, elemental, H);
  expect(reasons.some((r) => r.tag === "tutor:elemental")).toBe(true);
});

test("a bare-type tutor forms no edge, because it reaches the whole deck", () => {
  const worldly = base("Worldly Tutor", [{
    kind: "on-cast",
    effect: { kind: "top-manipulation", subject: { control: "you", token: null, type: "creature" } },
  }]);
  expect(pairReasons(worldly, base("Any Creature", []), H).some((r) => r.tag.startsWith("tutor"))).toBe(false);
});

test("an untyped tutor forms no edge at all", () => {
  const demonic = base("Demonic Tutor", [{
    kind: "on-cast",
    effect: { kind: "top-manipulation", subject: { control: "any", token: null } },
  }]);
  expect(pairReasons(demonic, base("Anything", []), H).some((r) => r.tag.startsWith("tutor"))).toBe(false);
});

// A fetchland naming Swamp is the MANA BASE, which the cost-reduction and tax rulings already
// established is a deck property rather than a pairwise synergy. 60 of the 115 search actions are
// land fetches; left in, every fetchland would edge to every dual.
test("a land tutor forms no edge — that is the mana base, not a synergy", () => {
  const fetch = base("Bloodstained Mire", [{
    kind: "activated",
    effect: { kind: "top-manipulation", subject: { control: "you", token: null, subtype: ["swamp", "mountain"] } },
  }]);
  const dual = base("Blood Crypt", [], ["swamp", "mountain"]);
  expect(pairReasons(fetch, dual, H).some((r) => r.tag.startsWith("tutor"))).toBe(false);
});

// scry and surveil derive `top-manipulation` too, with no subject to narrow them. They must not be
// mistaken for tutors.
test("a surveil is not a tutor", () => {
  const bones = base("Barrier of Bones", [{
    kind: "triggered",
    effect: { kind: "top-manipulation", subject: { control: "any", token: null } },
  }]);
  expect(pairReasons(bones, base("Whatever", []), H).some((r) => r.tag.startsWith("tutor"))).toBe(false);
});

// A STAT predicate narrows just as a subtype does — `combatNarrowsOffType` has said so all along.
// Imperial Recruiter finds a creature with power 2 or less and Spellseeker an instant or sorcery
// with mana value 2 or less: both are real relations to particular cards, not to a whole type.
test("a stat-gated tutor forms an edge", () => {
  const recruiter = base("Imperial Recruiter", [{
    kind: "triggered",
    effect: {
      kind: "top-manipulation",
      subject: {
        control: "you", token: null, type: "creature",
        stats: [{ metric: "power", op: "lte", value: 2 }],
      },
    },
  }]);
  // base() builds a creature with no power, which parseStat reads as unknown; give it one.
  const small = base("Weak Creature", []);
  (small.tags.characteristics as { power: string | null }).power = "1";
  expect(pairReasons(recruiter, small, H).some((r) => r.tag.startsWith("tutor"))).toBe(true);
});

// A disjunctive tutor must key on the branch that MATCHED, not on the first one. Magda searches for
// "an artifact or Dragon card": keying every hit `tutor:artifact` reports a Dragon as an artifact,
// which is the exact defect themeSubjectKey's own comment describes for negated subjects.
test("a disjunctive tutor keys on the branch that matched", () => {
  const magda = base("Magda, Brazen Outlaw", [{
    kind: "activated",
    effect: {
      kind: "top-manipulation",
      subject: { control: "you", token: null, anyOf: [{ type: "artifact" }, { subtype: "dragon" }] },
    },
  }]);
  const dragon = base("Lathliss, Dragon Queen", [], ["dragon"]);
  const tags = pairReasons(magda, dragon, H).filter((r) => r.tag.startsWith("tutor")).map((r) => r.tag);
  expect(tags).toContain("tutor:dragon");
  expect(tags).not.toContain("tutor:artifact");
});
