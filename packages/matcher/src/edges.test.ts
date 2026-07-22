import { expect, test } from "vitest";
import { pairReasons, cardThemeTags, themeSubjectKey } from "./edges.js";
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

test("static edge: a zombie lord matches a zombie by characteristics", () => {
  const lord = base("Death Baron", [{
    kind: "static",
    effect: { kind: "pump", subject: { subtype: "zombie", control: "you", token: null } },
  }]);
  const zombie = base("Gravecrawler", [], ["zombie"]);
  const reasons = pairReasons(lord, zombie, H);
  expect(reasons.some((r) => r.tag === "static:pump")).toBe(true);
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
