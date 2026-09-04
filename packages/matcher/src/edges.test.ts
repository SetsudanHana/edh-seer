import { describe, expect, test } from "vitest";
import { pairReasons, pairReasonsAcrossFaces, directedReasons, cardThemeTags, themeSubjectKey, claimCount, cardCaresTags, ETB_REFIRE } from "./edges.js";
import { faceDeckCards } from "./faces.js";
import type { Reason } from "@edh-seer/engine";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "./types.js";

const H: Hierarchy = { wizard: ["creature"], zombie: ["creature"] };
const base = (name: string, abilities: CardTags["abilities"], subtypes: string[] = []) => ({
  // `as DeckCard["card"]` rather than `as never`: casting the fixture to `never` also erased
  // `maker.card.name` for every reader below, which tsc flagged while vitest ran happily -- the
  // recorded "a green suite is not a compiling one" trap.
  card: { name, typeLine: "", oracleText: "", keywords: [], colors: [], manaValue: 0 } as unknown as DeckCard["card"],
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

/** `base()` types every card as a creature, which is fine for most fixtures and wrong for any test
 *  whose point is what a card CAN be. */
const artifact = (name: string, abilities: CardTags["abilities"]) => {
  const c = base(name, abilities);
  (c.tags.characteristics as { types: string[] }).types = ["artifact"];
  return c;
};

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
  // Cause first, and the SUBJECT is named because Inalla is not the thing entering: its emit is a
  // token COPY (`token: true`), and Inalla is not a token. Saying "When Inalla enters" described the
  // wrong event — the same defect that made a Sorcery die (roadmap, 2026-08-27 persona run).
  // Still no engine vocabulary and no raw tag.
  expect(etb.text).toBe("When a Wizard enters thanks to Inalla, Kindred Discovery draws you cards");
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
  const pump = reasons.find((r) => r.tag === "static:pump");
  expect(pump).toBeDefined();
  // F2 (review round 1): every other static:pump test here asserts .tag only, never .text -- so a
  // swapped ternary branch or a swapped producer/consumer argument at the one call site
  // (edges.ts, staticGrantSentence(p.card.name, c.card.name, a.effect.kind)) would ship silently.
  // The cost-reduction branch of the identical ternary is asserted end-to-end below; this is that
  // same coverage for the other branch.
  expect(pump!.text).toBe("Death Baron gives Gravecrawler bigger stats");
});

test("static edge: a static describing the card ITSELF claims no other card (G4)", () => {
  // Planar Nexus prints "This land is every nonbasic land type" and derives
  // `{type: land, scope: each, self: true}` -- the self-reference recorded CORRECTLY by derive.
  // The static applies-to pass still rendered "Planar Nexus's type grant applies to Swamp" 21 times
  // in one deck, because `printedMatchable` strips `counter` and lets `self` through into
  // `subjectMatches`, which does not read `self` at all.
  //
  // The control is the case BELOW it: an identical static WITHOUT `self` must keep its edge, or the
  // gate is just deleting the type-grant family. That half is what makes this test worth having --
  // a refusal test that never checks the thing it must NOT refuse can be passed by `return []`.
  const nexus = base("Planar Nexus", [{
    kind: "static",
    effect: { kind: "type-grant", subject: { subtype: "zombie", control: "any", token: null, self: true } },
  }]);
  const other = base("Gravecrawler", [], ["zombie"]);
  expect(pairReasons(nexus, other, H).some((r) => r.tag === "static:type-grant")).toBe(false);

  const realGrant = base("Maskwood Nexus", [{
    kind: "static",
    effect: { kind: "type-grant", subject: { subtype: "zombie", control: "any", token: null } },
  }]);
  expect(pairReasons(realGrant, other, H).some((r) => r.tag === "static:type-grant")).toBe(true);
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

// TASK 7 (tokens-as-nodes): tokens mediate. Deadly Dispute makes a Treasure; the Treasure token
// is its own node on the graph (Task 6) and can supply its own "an artifact enters" fact to any
// payoff. Before this task the maker ALSO supplied that fact directly -- one relation stated
// twice. `directedReasons` is called (not `pairReasons`) to isolate the maker->payoff direction,
// since the reverse direction and `meldReason` carry no signal for this shape.
const treasureMaker = () => ({
  card: { name: "Deadly Dispute", typeLine: "", oracleText: "", keywords: [], colors: [], manaValue: 0 } as never,
  tags: {
    oracleId: "Deadly Dispute", schemaVersion: 1, promptVersion: 1, model: "t",
    // A SORCERY, not a creature: `base()`'s creature body would imply its own non-token
    // `enters:creature` and mask exactly the shortcut this test targets, the same reason the
    // pre-existing "token gate" test above uses a sorcery producer.
    characteristics: { types: ["sorcery"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
    abilities: [{
      kind: "on-cast",
      effect: { kind: "token-generation", subject: { type: "artifact", subtype: "treasure", control: "you", token: true } },
      // Both verbs `create: ["create-token", "enters"]` (tagger/derive/emits.ts) produces off the
      // same "create a Treasure token" sentence, same subject either way.
      emits: [
        { verb: "create-token", subject: { type: "artifact", subtype: "treasure", control: "you", token: true } },
        { verb: "enters", subject: { type: "artifact", subtype: "treasure", control: "you", token: true } },
      ],
    }],
  } as CardTags,
});
// The maker must LIST the Treasure it makes: suppression is a trade for the two-hop path, and
// `hasMediatingToken` refuses the trade when no node can carry the fact (see the placeholder-"Copy"
// case at the bottom of this file). Before that rule these fixtures had no `allParts` at all and
// still suppressed, which is the shape that silently deleted Second Harvest's every claim.
const withTreasurePart = (dc: ReturnType<typeof treasureMaker>) => {
  (dc.card as unknown as { allParts: unknown }).allParts =
    [{ component: "token", name: "Treasure", typeLine: "Token Artifact — Treasure" }];
  return dc;
};
const treasureNode = () => ({
  card: { name: "Treasure", typeLine: "Artifact — Treasure", oracleText: "", keywords: [], colors: [], manaValue: 0 } as never,
  tags: {
    oracleId: "treasure-token", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["artifact"], subtypes: ["treasure"], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: true, keywords: [] },
    abilities: [],
  } as CardTags,
  isToken: true,
});
const artifactPayoff = () => base("Artifact ETB Payoff", [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { type: "artifact", control: "you", token: null } },
  effect: { kind: "draw-card" },
}]);

test("token mediation: a Treasure maker's own token-entry event no longer edges a nontoken payoff directly", () => {
  const reasons = directedReasons(withTreasurePart(treasureMaker()), artifactPayoff(), H);
  expect(reasons.some((r) => r.tag.startsWith("enters:"))).toBe(false);
});

test("token mediation: the Treasure NODE's own entry still edges the payoff -- the two-hop path stands", () => {
  const reasons = directedReasons(treasureNode(), artifactPayoff(), H);
  expect(reasons.some((r) => r.tag === "enters:artifact")).toBe(true);
});

/** SUPPRESSION IS A TRADE, AND A CALLER WITH NO TOKEN NODES RECEIVES NOTHING. The card pages build
 *  one card at a time, so the second hop this rule pays for is never constructed there: the maker's
 *  real supply is deleted and the only sentence left is about its own body. MEASURED 2026-09-04 on
 *  the partner artifact -- 7,266 of 117,946 sampled token-only candidate pairs deleted outright,
 *  6,407 further rows worded as the body entering. The deck report, the graph and the compass all
 *  keep the default, so this option cannot move them. */
test("token mediation is off for a caller with no token nodes, and the maker's own supply returns", () => {
  const reasons = directedReasons(withTreasurePart(treasureMaker()), artifactPayoff(), H, { tokensMediate: false });
  expect(reasons.some((r) => r.tag === "enters:artifact")).toBe(true);
  // The sentence names the TOKEN as the thing that enters, not the sorcery that made it.
  expect(reasons.find((r) => r.tag === "enters:artifact")!.text)
    .toBe("When a Treasure enters thanks to Deadly Dispute, Artifact ETB Payoff draws you cards");
});

/** THE DEFAULT IS THE DECK REPORT and it has to stay byte-identical, so the option is proven to be
 *  opt-in rather than assumed to be. */
test("token mediation still fires when the option is absent or explicitly true", () => {
  for (const opts of [undefined, {}, { tokensMediate: true }]) {
    const reasons = directedReasons(withTreasurePart(treasureMaker()), artifactPayoff(), H, opts);
    expect(reasons.some((r) => r.tag.startsWith("enters:"))).toBe(false);
  }
});

test("CR 614 multiplier still edges the maker, never the token, after mediation (owner's ruling, verified not assumed)", () => {
  // "If you would create one or more Treasure tokens, instead create twice that many" derives to a
  // TRIGGER on `create-token` with no emit of its own (derive/replacement.ts) -- it consumes the
  // maker's action, so it must keep its edge to Deadly Dispute even though the mediation rule above
  // suppresses the SAME producer's `enters` shortcut one verb over.
  const doubler = base("Treasure Doubler", [{
    kind: "triggered",
    trigger: { verbs: ["create-token"], subject: { type: "artifact", subtype: "treasure", control: "you", token: true } },
    effect: { kind: "token-doubling" },
  }]);
  const reasons = directedReasons(withTreasurePart(treasureMaker()), doubler, H);
  expect(reasons.some((r) => r.tag.startsWith("create-token:"))).toBe(true);
  // And confirm the mediation rule really did fire on this same producer for the ordinary payoff --
  // otherwise this test would pass for the wrong reason (no suppression at all).
  expect(directedReasons(withTreasurePart(treasureMaker()), artifactPayoff(), H).some((r) => r.tag.startsWith("enters:"))).toBe(false);
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
  // AUTHORED, but not a token emit. Task 7 (tokens-as-nodes) suppresses a maker's own authored
  // token-entry event as a direct producer -- the token's own node supplies it two hops over
  // instead -- so a token emit can no longer stand in for "authored surplus" here (it used to).
  // An authored reanimation-style enters emit exercises the identical baseline/authored bookkeeping
  // without going anywhere near that gate.
  const maker = base("Reanimator", [{
    kind: "activated",
    cost: "{2}{B}",
    effect: { kind: "graveyard-recursion" },
    emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: false } }],
  }]);

  const fromVanilla = directedReasons(vanilla, payoff, H);
  expect(fromVanilla.length).toBeGreaterThan(0);
  expect(fromVanilla.every((r) => r.impliedProducer === true)).toBe(true);

  const fromMaker = directedReasons(maker, payoff, H);
  const authored = fromMaker.filter((r) => r.impliedProducer !== true);
  expect(authored.length, "the authored reanimation emit is surplus, not baseline").toBeGreaterThan(0);
});

// Regression: a creature that satisfies a "whenever a creature enters" payoff BOTH by baseline
// (it is a creature) AND by an authored enters emit must not double-count. Without excluding
// impliedProducer from pairReasons' dedup key, this pair scores 2 -- a plain creature reanimator
// against a ubiquitous ETB payoff scoring higher than it should purely because it also happens to
// be a creature. See edges.ts pairReasons. (Not a token emit, deliberately: Task 7 suppresses a
// token-entry emit as a direct producer before dedup ever sees it, which would make this pass for
// the wrong reason -- one supply, not two collapsed into one.)
test("pairReasons does not double-count a producer that satisfies one trigger by both baseline and authored emit", () => {
  const maker = base("Reanimator", [{
    kind: "activated",
    cost: "{2}{B}",
    effect: { kind: "graveyard-recursion" },
    emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: false } }],
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

test("a dying artifact and a dying creature keep distinct tags even though the prose now matches", () => {
  // Scrap Trawler watches its own death AND another artifact hitting the graveyard, so a sac outlet
  // supplies both `dies:creature` and `dies:artifact`.
  //
  // THE TWO ROWS USED TO READ IDENTICALLY ON PURPOSE, and that was right while the prose named the
  // producer as the thing that died. It stopped being right once the producer could be a card that
  // CANNOT die the way its own emit describes: Executioner's Capsule is an ARTIFACT that sacrifices
  // ITSELF (`dies:artifact`) and DESTROYS a creature (`dies:creature`) — two different events, one
  // of which is not about the Capsule at all. The tag stays the thing `claimCount`/`dedupeReasons`
  // key on; the prose now separates them because they are separate.
  //
  // THE FIXTURE SAID `types: ["creature"]` VIA `base()`, which is not what this card is — the third
  // time this repo has recorded a fixture that does not resemble the card it names (C4's fetchland,
  // `commander-ramp-core`'s Sol Ring). Typed correctly here, or the artifact row would be tested
  // against a card that cannot be an artifact.
  const outlet = artifact("Executioner\u0027s Capsule", [{
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
  const reasons = directedReasons(outlet, trawler, H).filter((r) => r.tag.startsWith("dies"));
  const tags = reasons.map((r) => r.tag);
  expect(new Set(tags)).toEqual(new Set(["dies:creature", "dies:artifact"]));
  const texts = reasons.map((r) => r.text);
  // The Capsule really can be the dying ARTIFACT, and really cannot be the dying CREATURE.
  expect(new Set(texts)).toEqual(new Set([
    "When Executioner's Capsule dies, Scrap Trawler brings a card back",
    "When a creature dies thanks to Executioner's Capsule, Scrap Trawler brings a card back",
  ]));
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
  expect(texts[0]).toBe("When Imskir Iron-Eater leaves the battlefield, Nadier's Nightblade drains each opponent");
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
  // effectKind "card-draw" (not "draw-card") carries no phrase, which is rung 3 of the ladder.
  expect(texts[0]).toBe("When Merrow Reejerey becomes tapped, Unctus, Grand Metatect triggers");
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

/** THE RANI AND SAREVOK'S TOME, reported off the board. A self-ETB consumer whose subject names no
 *  type has nothing for the identity gate to check, so the gate leans on `selfEtbSelfSupplied`,
 *  which refuses implied and TOKEN producers. The Rani's investigate emitted a token entry that did
 *  not say `token: true` — fixed in the tagger's `actionEmits` — and the untyped emit that resulted
 *  is the one shape neither half can refuse.
 *
 *  This test pins the MATCHER half: given the emit the tagger now derives, no edge forms. It is
 *  here as well as in `emits.test.ts` because the two halves can regress independently. */
test("a token entry does not satisfy a consumer's own ETB, however untyped either side is", () => {
  const tokenMaker: DeckCard = {
    card: { name: "The Rani", typeLine: "Legendary Creature — Time Lord Scientist", oracleText: "", keywords: [], colors: ["R"], manaValue: 4, colorIdentity: ["R"], power: "3", toughness: "4" },
    tags: {
      oracleId: "rani", schemaVersion: 1, promptVersion: 0, model: "derived",
      characteristics: { types: ["creature"], subtypes: [], colors: ["R"], identity: ["R"], cmc: 4, power: "3", toughness: "4", token: false, keywords: [] },
      abilities: [{
        kind: "triggered",
        effect: { kind: "token-generation" },
        // The shape investigate derives: a token is created, nothing else is known about it.
        emits: [
          { verb: "create-token", subject: { control: "you", token: true } },
          { verb: "enters", subject: { control: "you", token: true } },
        ],
      }],
    },
  };
  const selfEtbArtifact: DeckCard = {
    card: { name: "Sarevok's Tome", typeLine: "Artifact — Book", oracleText: "", keywords: [], colors: [], manaValue: 3, colorIdentity: [], power: null, toughness: null },
    tags: {
      oracleId: "tome", schemaVersion: 1, promptVersion: 0, model: "derived",
      characteristics: { types: ["artifact"], subtypes: ["book"], colors: [], identity: [], cmc: 3, power: null, toughness: null, token: false, keywords: [] },
      abilities: [{
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: { control: "you", token: null, self: true } },
        effect: { kind: "" },
      }],
    },
  };
  expect(directedReasons(tokenMaker, selfEtbArtifact, H).filter((r) => r.tag.startsWith("enters"))).toEqual([]);
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

test("a trigger narrowed by a TARGETING restriction claims nothing", () => {
  // Leyline of Resonance: "whenever you cast an instant or sorcery spell THAT TARGETS ONLY A SINGLE
  // CREATURE YOU CONTROL". Nothing here models targeting, so the demand cannot be checked -- and the
  // parse was wrong twice over: `parseTypes` swept the relative clause, so the derived type list was
  // `[creature, instant, sorcery]` and every creature spell in the deck satisfied it. 59 reasons in
  // `amarant-one-punch-is-all-i-need` alone, and 3 of the frozen panel's falses.
  const creatureSpell = base("Amarant Coral", [{
    kind: "static",
    effect: { kind: "" },
    emits: [{ verb: "cast", subject: { type: "creature", control: "you", token: null, self: true } }],
  }]);
  const leyline = base("Leyline of Resonance", [{
    kind: "triggered",
    trigger: {
      verbs: ["cast"],
      subject: { type: ["creature", "instant", "sorcery"], control: "you", token: null, restricted: true },
    },
    effect: { kind: "copy-spell" },
  }]);
  expect(pairReasons(creatureSpell, leyline, H).some((r) => r.tag.startsWith("cast:"))).toBe(false);
  // The SAME trigger without the restriction still matches -- so the refusal is the flag doing the
  // work, not the fixture failing to match for some other reason.
  const unrestricted = base("Leyline of Resonance", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { type: ["creature", "instant", "sorcery"], control: "you", token: null } },
    effect: { kind: "copy-spell" },
  }]);
  expect(pairReasons(creatureSpell, unrestricted, H).some((r) => r.tag.startsWith("cast:"))).toBe(true);
});

test("a restriction on the PRODUCER's emit is ignored -- it can only ever be a demand", () => {
  // The `entersTapped` lesson: a field describing the EVENT, read on the producer side, becomes a
  // demand that the consumer CARD have that property, and silently deleted 29 real claims. A
  // producer's emit never states how a spell was targeted, so `eventMatches` reads the flag on the
  // consumer only.
  const producer = base("Some Spell", [{
    kind: "static",
    effect: { kind: "" },
    emits: [{ verb: "cast", subject: { type: "instant", control: "you", token: null, restricted: true } }],
  }]);
  const watcher = base("Watcher", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { type: "instant", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  expect(pairReasons(producer, watcher, H).some((r) => r.tag.startsWith("cast:"))).toBe(true);
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
  // `cast:artifact` for a noncreature trigger is not a cosmetic wart: cardThemeTags uses the same
  // key, so a wrong one grouped these payoffs with artifact-cast decks on the theme axis. The
  // rendered TEXT no longer needs the subject at all -- sentence.ts names the specific producer
  // card as the cause, not its class -- so what this test now pins is the TAG.
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
  expect(reasons.find((r) => r.tag === "cast:-creature")!.text)
    .toBe("When Rakdos Charm is cast, Valley Floodcaller makes your creatures bigger");
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
// RULING OVERTURNED 2026-08-18 (owner): "your cost reducing card is as good as many cards it can
// reduce." This test asserted the 2026-08-06 position -- that a reducer makes the identical claim
// in every deck -- and now asserts the opposite, which is the whole content of the change. A
// Medallion in the WRONG deck still forms nothing, but by its subject failing to match, not by the
// family being excluded; the colour case is covered in the cost-reduction describe block below.
test("a cost reducer edges the card it discounts", () => {
  const medallion = base("Sapphire Medallion", [{
    kind: "static",
    effect: {
      kind: "cost-reduction",
      subject: { type: "creature", control: "you", token: null, scope: "all" },
    },
  }]);
  const spell = base("An Offer You Can't Refuse", []);
  expect(pairReasons(medallion, spell, H).some((r) => r.tag === "static:cost-reduction")).toBe(true);
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

// A SELF trigger watches only its own entry, but `themeSubjectKey` ignores `subject.self`, so it
// keys `enters:any` — the same tag a card watching any permanent would carry. That is not a
// rendering defect any more (sentence.ts's `self` flag makes the PROSE say whose entry it is,
// independent of the tag); it is what produced the wrong mechanism for defect A on 2026-08-13,
// sending the diagnosis at `SubjectFilter.self` (which had covered "this land" since 2e27af4)
// instead of at the supertype and umbrella gaps that were actually forming the edges.
//
// The TAG is deliberately left alone. It is the panel's join key, and changing it would detach every
// cached verdict on these pairs for a prose fix — the lesson DERIVE_VERSION 31 banked when it kept a
// tag identical through the umbrella work and held judging debt at 0.
test("a self trigger says whose entry it is, without moving the tag", () => {
  const land = base("Shadowy Backstreet", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null, self: true } },
    effect: { kind: "top-manipulation" },
  }], ["plains", "swamp"]);
  const fetch = base("Marsh Flats", [{
    kind: "activated",
    effect: { kind: "ramp" },
    emits: [{ verb: "enters", subject: { control: "you", token: null, subtype: ["plains", "swamp"] } }],
  }]);
  const etb = pairReasons(fetch, land, H).find((r) => r.tag.startsWith("enters"))!;
  expect(etb.tag).toBe("enters:any");
  expect(etb.text).toBe(// The land's effect kind is `top-manipulation`, and the sentence now says so rather than
    // stopping at "triggers" -- see the nine kinds added to PHRASES.
    "When Shadowy Backstreet enters thanks to Marsh Flats, it sets up the top of a library");
  expect(etb.text).toContain("Marsh Flats");
});

// A class trigger is untouched: "another creature you control enters" really does watch the board.
test("a non-self trigger still reads as the class it watches", () => {
  const payoff = base("Impact Tremors", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "non-combat-damage" },
  }]);
  const maker = base("Bitterblossom", [{
    kind: "triggered",
    effect: { kind: "token-generation" },
    emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: true } }],
  }]);
  const etb = pairReasons(maker, payoff, H).find((r) => r.tag === "enters:creature")!;
  // "thanks to" names Bitterblossom as the CAUSE without claiming it is the thing that entered —
  // its emit is a TOKEN (`token: true`), which Bitterblossom is not. The consumer is still not the
  // subject either, which is what separates this from the self-trigger wording.
  expect(etb.text).toBe("When a creature enters thanks to Bitterblossom, Impact Tremors triggers");
  expect(etb.text).not.toContain("its own entry");
});

// SCALING EDGES. `effect.scaling` was derived, copied onto every Reason and read by impact.ts,
// buckets.ts and wincon.ts — but formed no edge, because a payoff that merely gets BIGGER fires
// nothing. Bonehoard is a 0/0 Germ until something dies.
test("a graveyard fill grows a per-graveyard payoff, gated on WHAT is counted", () => {
  const filler = (type: string): CardTags => ({
    oracleId: "p", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["sorcery"], subtypes: [], colors: [], identity: [], cmc: 2,
      power: null, toughness: null, token: false, keywords: [] },
    abilities: [{
      kind: "on-cast", effect: { kind: "top-manipulation" },
      emits: [{ verb: "enters-graveyard", subject: { control: "you", token: null, type } }],
    }],
  });
  const payoff = (counted: string): CardTags => ({
    oracleId: "c", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["artifact"], subtypes: [], colors: [], identity: [], cmc: 4,
      power: null, toughness: null, token: false, keywords: [] },
    abilities: [{
      kind: "static",
      effect: { kind: "pump", scaling: "per-graveyard",
        scalingSubject: { control: "you", token: null, type: counted, zone: "graveyard" } },
    }],
  });
  const reasons = (fill: string, counts: string) => directedReasons(
    { card: { name: "Filler" } as DeckCard["card"], tags: filler(fill) },
    { card: { name: "Payoff" } as DeckCard["card"], tags: payoff(counts) }, H,
  ).filter((r) => r.tag.startsWith("scales:"));

  // Bonehoard counts creature cards: a creature hitting the yard grows it.
  expect(reasons("creature", "creature")).toHaveLength(1);
  // Cavalier of Flame counts LAND cards. A creature fill does not feed it, and the basis alone —
  // both are `per-graveyard` — cannot tell the two apart. That distinction is worth 64% of the fan:
  // 676 candidate pairs in the 71 decks become 163 real ones.
  expect(reasons("creature", "land")).toHaveLength(0);
});

// C2b: a count narrowed by HISTORIC is not a wildcard. The Capitoline Triad — "this spell costs {1}
// less to cast for each historic card in your graveyard" — derives `{historic: true, zone:
// graveyard}` with no type and no subtype, so the untyped-count guard refused its own deck's
// commander. An honestly untyped count (Riverchurn Monument) is still refused, which is what the
// second expectation pins: remove `counted.historic !== true` from the guard and it fails.
test("a historic-narrowed graveyard count is not a wildcard, an untyped one still is", () => {
  const filler: CardTags = {
    oracleId: "p", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["artifact"], subtypes: [], colors: [], identity: [], cmc: 2,
      power: null, toughness: null, token: false, keywords: [] },
    abilities: [{
      kind: "activated", effect: { kind: "mill" },
      emits: [{ verb: "enters-graveyard", subject: { control: "you", token: null } }],
    }],
  };
  const payoff = (scalingSubject: Record<string, unknown>): CardTags => ({
    oracleId: "c", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["artifact"], subtypes: [], colors: [], identity: [], cmc: 7,
      power: null, toughness: null, token: false, keywords: [] },
    abilities: [{
      kind: "static",
      effect: { kind: "cost-reduction", scaling: "per-graveyard", scalingSubject: scalingSubject as never },
    }],
  });
  const reasons = (counted: Record<string, unknown>) => directedReasons(
    { card: { name: "Millstone" } as DeckCard["card"], tags: filler },
    { card: { name: "The Capitoline Triad" } as DeckCard["card"], tags: payoff(counted) }, H,
  ).filter((r) => r.tag.startsWith("scales:"));

  expect(reasons({ control: "you", token: null, historic: true, zone: "graveyard" })).toHaveLength(1);
  expect(reasons({ control: "you", token: null, zone: "graveyard" })).toHaveLength(0);
});

// A LAND FINDER RELATES TO WHAT IT CAN FETCH (owner's ruling 2026-08-15). The blanket land exclusion
// was right that a fetchland is not a "synergy" in the payoff sense and wrong that it says nothing:
// which lands your ramp can actually reach is a deckbuilding fact, and `bin/ramp-coverage.ts` states
// it as "your ramp finds N of this type".
test("a land finder edges to the lands it can fetch, and to no others", () => {
  const finder = (subject: Record<string, unknown>): CardTags => ({
    oracleId: "p", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["sorcery"], subtypes: [], colors: [], identity: [], cmc: 2,
      power: null, toughness: null, token: false, keywords: [] },
    abilities: [{ kind: "on-cast", effect: { kind: "top-manipulation", subject: subject as never } }],
  });
  const land = (types: string[], subtypes: string[]): CardTags => ({
    oracleId: "c", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types, subtypes, colors: [], identity: [], cmc: 0,
      power: null, toughness: null, token: false, keywords: [] },
    abilities: [],
  });
  const reasons = (f: CardTags, l: CardTags) => directedReasons(
    { card: { name: "Finder" } as DeckCard["card"], tags: f },
    { card: { name: "Land" } as DeckCard["card"], tags: l }, H,
  ).filter((r) => r.tag.startsWith("ramp-target:"));

  // Farseek: "a Plains, Island, Swamp, or Mountain card" — the basics AND every dual carrying one of
  // those types, which is why Godless Shrine is a legal Farseek target and a Forest is not.
  const farseek = finder({ control: "you", token: null, subtype: ["plains", "island", "swamp", "mountain"] });
  expect(reasons(farseek, land(["land"], ["plains"]))).toHaveLength(1);
  expect(reasons(farseek, land(["land"], ["plains", "swamp"]))).toHaveLength(1);
  expect(reasons(farseek, land(["land"], ["forest"]))).toHaveLength(0);

  // Rampant Growth says it the other way — the `basic` SUPERTYPE — so it finds basics only, never
  // the dual that shares a type with them.
  const rampant = finder({ control: "you", token: null, basic: true, type: "land" });
  expect(reasons(rampant, land(["basic", "land"], ["forest"]))).toHaveLength(1);
  expect(reasons(rampant, land(["land"], ["forest"]))).toHaveLength(0);

  // Path to Exile searches for a basic land FOR THE OPPONENT, as compensation for removal. Claiming
  // it ramps your mana base is a wrong sentence, and `control` is the only thing that separates them.
  const pathToExile = finder({ control: "opp", token: null, basic: true, type: "land" });
  expect(reasons(pathToExile, land(["basic", "land"], ["forest"]))).toHaveLength(0);
});

// THE ARCHETYPE NO CALIBRATION DECK CONTAINS. 13 corpus cards say "a deck can have any number of
// cards named ..." and all 13 count their own name — Dragon's Approach runs 30 copies, Rat Colony
// and Shadowborn Apostle likewise. None is in the 71 decks, so population and panel are blind to
// this by construction and a unit test is the only instrument that can see it at all.
test("a card that counts its own name reaches its other copies, and nothing else", () => {
  const ratColony = (): CardTags => ({
    oracleId: "rat", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["creature"], subtypes: ["rat"], colors: ["B"], identity: ["B"], cmc: 2,
      power: "1", toughness: "1", token: false, keywords: [] },
    // "Rat Colony gets +1/+0 for each other creature you control named Rat Colony."
    abilities: [{
      kind: "static",
      effect: { kind: "pump", subject: { control: "you", token: null, type: "creature", named: "rat colony" } },
    }],
  });
  const plainRat = (): CardTags => ({
    oracleId: "other", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["creature"], subtypes: ["rat"], colors: ["B"], identity: ["B"], cmc: 1,
      power: "1", toughness: "1", token: false, keywords: [] },
    abilities: [],
  });
  const between = (aName: string, aTags: CardTags, bName: string, bTags: CardTags) => directedReasons(
    { card: { name: aName } as DeckCard["card"], tags: aTags },
    { card: { name: bName } as DeckCard["card"], tags: bTags }, H,
  ).filter((r) => r.tag.startsWith("static:"));

  // Another copy IS the payoff — quantities are expanded into separate deck entries, so two copies
  // are two nodes and the relation between them is real.
  expect(between("Rat Colony", ratColony(), "Rat Colony", ratColony())).toHaveLength(1);
  // A different Rat is not. Without the name slot this anthem reached every Rat in the deck, which
  // is the defect the CS benchmark recorded as our one missing qualifier.
  expect(between("Rat Colony", ratColony(), "Marrow-Gnawer", plainRat())).toHaveLength(0);
});

// A ROLE SAYS THE SAME THING NEXT TO EVERY CARD — which is true of Laboratory Maniac and false of
// Revel in Riches. "Wins if you control ten Treasures" is a claim about Treasure producers
// specifically, so a win condition that NAMES what it counts is a relation, not a role.
test("a typed win condition edges to what it counts; an untyped one stays a role", () => {
  const revel = (withSubject: boolean): CardTags => ({
    oracleId: "revel", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["enchantment"], subtypes: [], colors: ["B"], identity: ["B"], cmc: 5,
      power: null, toughness: null, token: false, keywords: [] },
    abilities: [{
      kind: "triggered",
      trigger: {
        verbs: ["upkeep"], subject: { control: "you", token: null },
        threshold: { atLeast: 10 },
        ...(withSubject ? { thresholdSubject: { control: "you", token: null, subtype: "treasure" } } : {}),
      },
      effect: { kind: "win-game" },
    }],
  });
  const treasureMaker = (): CardTags => ({
    oracleId: "maker", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["artifact"], subtypes: ["treasure"], colors: [], identity: [], cmc: 0,
      power: null, toughness: null, token: true, keywords: [] },
    abilities: [],
  });
  const reasons = (withSubject: boolean) => directedReasons(
    { card: { name: "Treasure" } as DeckCard["card"], tags: treasureMaker() },
    { card: { name: "Revel in Riches" } as DeckCard["card"], tags: revel(withSubject) }, H,
  ).filter((r) => r.tag.startsWith("wincon:"));

  expect(reasons(true)).toHaveLength(1);
  expect(reasons(false)).toHaveLength(0);
});

// ONE TRIGGER WITH A CHAIN OF EFFECTS IS ONE CLAIM (2026-08-18). Archon of Cruelty's single entry
// trigger derives six reasons identical in tag and text, differing only in `effectKind`, so every
// reanimation spell in the deck scored 6 against it. Measured: 9,268 of 40,563 reasons (22.8%) sit
// in such a group, and 64 of 71 decks re-order their top ten edges once they stop counting.
describe("claimCount", () => {
  const reason = (over: Partial<Reason> = {}): Reason => ({
    tag: "enters:creature",
    text: "Archon of Cruelty triggers on its own entry; Animate Dead supplies it",
    producer: "Animate Dead",
    consumer: "Archon of Cruelty",
    ...over,
  } as Reason);

  test("one trigger with a chain of effects counts once, however many kinds it derives", () => {
    const chain = ["forced-sacrifice", "", "player-life-loss", "draw-card", "lifegain", "drain"]
      .map((effectKind) => reason({ effectKind } as Partial<Reason>));

    expect(chain).toHaveLength(6);
    expect(claimCount(chain)).toBe(1);
  });

  test("genuinely different claims still count separately", () => {
    expect(claimCount([
      reason(),
      reason({ text: "Animate Dead fills the graveyard, enabling Archon of Cruelty's recursion" }),
      reason({ tag: "dies:creature" }),
    ])).toBe(3);
  });

  // The objects themselves must survive: `mechanisms.ts` matches archetypes on `effectKind`, and
  // Archon's six carry aristocrats' forced-sacrifice/drain/player-life-loss beside draw-card and
  // lifegain. Only the COUNT collapses.
  test("counting does not remove the reasons that carry the kinds detectors read", () => {
    const chain = ["forced-sacrifice", "drain"].map((effectKind) => reason({ effectKind } as Partial<Reason>));
    const before = chain.map((r) => (r as { effectKind?: string }).effectKind);

    claimCount(chain);

    expect(chain.map((r) => (r as { effectKind?: string }).effectKind)).toEqual(before);
  });
});

// SUPPRESSION IS A TRADE, AND A TRADE NEEDS SOMETHING RECEIVED. Token mediation deletes a maker's
// direct "a token enters" edge because the token NODE re-supplies it one hop later. Second Harvest
// lists only Scryfall's placeholder "Copy" part (type line `Token`, no card type), so no node can
// carry the fact and the relation was simply deleted -- 0.3 rating, one partner, invisible to a
// Caretaker's Talent in the same deck. Both directions pinned: a typed part still suppresses.
describe("token mediation only suppresses when a usable token node exists", () => {
  const payoff = base("Caretaker's Talent", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: true } },
    effect: { kind: "draw-card", subject: { control: "you" } },
    emits: [],
  }] as never);
  const maker = (parts: { component: string; name: string; typeLine: string }[]): DeckCard => {
    const m = base("Maker", [{
      kind: "on-cast",
      effect: { kind: "token-generation", subject: { control: "you", token: true } },
      emits: [{ verb: "enters", subject: { control: "you", token: true } }],
    }] as never) as unknown as DeckCard;
    (m.card as unknown as { allParts: unknown }).allParts = parts;
    return m;
  };

  test("a typeless placeholder part does NOT suppress — the direct edge stands", () => {
    const reasons = directedReasons(
      maker([{ component: "token", name: "Copy", typeLine: "Token" }]),
      payoff as unknown as DeckCard, H,
    );
    expect(reasons.map((r: Reason) => r.tag)).toContain("enters:any");
  });

  test("a typed part suppresses, because the token node carries the fact instead", () => {
    const reasons = directedReasons(
      maker([{ component: "token", name: "Saproling", typeLine: "Token Creature — Saproling" }]),
      payoff as unknown as DeckCard, H,
    );
    expect(reasons.map((r: Reason) => r.tag)).not.toContain("enters:any");
  });

  test("no token parts at all does not suppress either", () => {
    const reasons = directedReasons(maker([]), payoff as unknown as DeckCard, H);
    expect(reasons.map((r: Reason) => r.tag)).toContain("enters:any");
  });
});

// COST REDUCTION IS A PAIRWISE CLAIM AGAIN (owner's ruling, 2026-08-18: "your cost reducing card is
// as good as many cards it can reduce"). The 2026-08-06 ruling had it in ROLE_NOT_SYNERGY because a
// Medallion "makes the identical claim in every deck" -- but it does nothing in mono-red BECAUSE
// there is nothing to reduce, which the subject's own colour filter states by forming no edge.
describe("cost reduction forms edges, gated by what can actually be cast", () => {
  const reducer = (subject: Record<string, unknown>) => base("Jet Medallion", [{
    kind: "static",
    effect: { kind: "cost-reduction", subject },
    emits: [],
  }] as never);
  const spell = (name: string, types: string[], colors: string[] = ["B"]) => {
    const dc = base(name, [] as never);
    (dc.tags.characteristics as unknown as Record<string, unknown>).types = types;
    (dc.tags.characteristics as unknown as Record<string, unknown>).colors = colors;
    return dc;
  };

  test("it reduces a matching spell, and says so in the card's own words", () => {
    const reasons = directedReasons(
      reducer({ type: "creature", colors: ["B"], control: "you", token: null, scope: "all" }),
      spell("Bloodghast", ["creature"]), H,
    );
    const cut = reasons.find((r: Reason) => r.tag === "static:cost-reduction");
    expect(cut).toBeDefined();
    expect(cut!.text).toBe("Jet Medallion reduces what Bloodghast costs");
  });

  test("a colour it does not name gets no edge — that is what 'does nothing in mono-red' looks like", () => {
    const reasons = directedReasons(
      reducer({ type: "creature", colors: ["B"], control: "you", token: null, scope: "all" }),
      spell("Lightning Bolt", ["creature"], ["R"]), H,
    );
    expect(reasons.map((r: Reason) => r.tag)).not.toContain("static:cost-reduction");
  });

  test("a land is PLAYED, not cast (CR 305.1), so it is never reduced", () => {
    const reasons = directedReasons(
      reducer({ type: "land", control: "you", token: null, scope: "all" }),
      spell("Swamp", ["land"], []), H,
    );
    expect(reasons.map((r: Reason) => r.tag)).not.toContain("static:cost-reduction");
  });

  // A TOKEN IS PUT ONTO THE BATTLEFIELD, NEVER CAST (CR 111.1) — the same rule as the land case
  // above. Found on the Jodah deck 2026-08-27: Serah Farron prints "the first legendary creature
  // SPELL you cast each turn costs {2} less" and the engine claimed it discounted Ravage, a token.
  // 414 reasons over 51 decks, 247 distinct pairs — Jet Medallion -> Zombie, Foundry Inspector ->
  // Treasure. It survived because `hasGenericMana` answers TRUE for a missing cost on purpose
  // ("not recorded, refuse nothing"), and on a token the absence is a FACT rather than a gap.
  test("a token is never cast (CR 111.1), so it is never reduced", () => {
    const token = spell("Zombie", ["creature"]);
    (token as unknown as Record<string, unknown>).isToken = true;
    const reasons = directedReasons(
      reducer({ type: "creature", colors: ["B"], control: "you", token: null, scope: "all" }),
      token, H,
    );
    expect(reasons.map((r: Reason) => r.tag)).not.toContain("static:cost-reduction");
  });

  // AND ONLY THAT REASON GOES. Serah Farron reduces AND anthems; Ravage is a legendary creature, so
  // the pump half is real and the edge survives carrying it. A card-level refusal would have deleted
  // a true claim to remove a false one.
  test("a card that reduces AND anthems keeps the anthem on a token", () => {
    const serah = base("Serah Farron", [
      { kind: "static", effect: { kind: "cost-reduction", subject: { type: "creature", control: "you", token: null, scope: "all" } }, emits: [] },
      { kind: "static", effect: { kind: "pump", subject: { type: "creature", control: "you", token: null, scope: "all" } }, emits: [] },
    ] as never);
    const token = spell("Ravage", ["creature"]);
    (token as unknown as Record<string, unknown>).isToken = true;
    const tags = directedReasons(serah, token, H).map((r: Reason) => r.tag);
    expect(tags).not.toContain("static:cost-reduction");
    expect(tags).toContain("static:pump");
  });

  test("a reducer aimed at OPPONENTS' spells is tax pointing the other way, and forms nothing", () => {
    const reasons = directedReasons(
      reducer({ type: "creature", control: "opp", token: null, scope: "all" }),
      spell("Bloodghast", ["creature"]), H,
    );
    expect(reasons.map((r: Reason) => r.tag)).not.toContain("static:cost-reduction");
  });

  test("tax stays a deck role and forms no edge", () => {
    const ghostlyPrison = base("Ghostly Prison", [{
      kind: "static",
      effect: { kind: "tax", subject: { control: "opp", type: "creature", scope: "all" } },
      emits: [],
    }] as never);
    const reasons = directedReasons(ghostlyPrison, spell("Bloodghast", ["creature"]), H);
    expect(reasons.map((r: Reason) => r.tag)).not.toContain("static:tax");
  });

  // "This spell costs {X} less to cast, where X is the greatest power among creatures you control."
  // The subject is the measuring stick, not the discounted cards. Measured at 129 false reasons in
  // the 71 decks — all The Great Henge — which the ruling's own first day made that deck's top card.
  test("a SELF reduction claims nothing: its subject is what measures it", () => {
    const henge = base("The Great Henge", [{
      kind: "static",
      effect: { kind: "cost-reduction", subject: { type: "creature", control: "you", token: null, scope: "all" } },
      emits: [],
    }] as never);
    (henge.card as unknown as { oracleText: string }).oracleText =
      "This spell costs {X} less to cast, where X is the greatest power among creatures you control.";
    const reasons = directedReasons(henge, spell("Bloodghast", ["creature"]), H);
    expect(reasons.map((r: Reason) => r.tag)).not.toContain("static:cost-reduction");
  });

  test("a reducer that discounts OTHER cards is untouched by that guard", () => {
    const medallion = reducer({ type: "creature", control: "you", token: null, scope: "all" });
    (medallion.card as unknown as { oracleText: string }).oracleText =
      "Creature spells you cast cost {1} less to cast.";
    const reasons = directedReasons(medallion, spell("Bloodghast", ["creature"]), H);
    expect(reasons.map((r: Reason) => r.tag)).toContain("static:cost-reduction");
  });
});

// A PERMANENT'S OWN ENTRY IS A THEME TAG (roadmap A4, 2026-08-19). `cardThemeTags` read a card's
// ABILITIES only, so 36 of braids-mono-black-enchantress's 75 nonlands were enchantments and 8
// carried `enters:enchantment` -- which is why that deck's cohesion read 0.14 once the fold stopped
// summing unrelated families into it.
describe("implied entry theme tags", () => {
  const chars = (types: string[], subtypes: string[] = []): CardTags => ({
    oracleId: "x", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types, subtypes, colors: [], identity: [], cmc: 1, power: null, toughness: null, token: false, keywords: [] },
    abilities: [],
  });

  test("keys a permanent's own entry at its SUBTYPE, and gives a vanilla card a tag at all", () => {
    expect([...cardThemeTags(chars(["enchantment"]))]).toContain("enters:enchantment");
    expect([...cardThemeTags(chars(["creature"], ["dragon"]))]).toContain("enters:dragon");
  });

  test("gives a LAND nothing -- a land's own entry is the mana base, never a theme", () => {
    // Without this, ~35 basics per deck out-counted every real theme: the first cut themed 38 of the
    // 71 calibration decks on a basic land type, 13 of them "islands entering".
    expect([...cardThemeTags(chars(["land"], ["island"]))]).not.toContain("enters:island");
    expect([...cardThemeTags(chars(["land"], ["island"]))]).toEqual([]);
  });

  test("gives an instant or sorcery nothing -- it never enters the battlefield", () => {
    expect([...cardThemeTags(chars(["instant"]))]).toEqual([]);
  });

  // A HUMAN WIZARD IS BOTH (roadmap A9). themeSubjectKey resolves subtypes with list(subtype)[0],
  // so printed order decided which one a card's own entry advertised -- a WIZARD deck counted
  // enters:human 15 against enters:wizard 9.
  test("a multi-subtype permanent advertises EVERY subtype, not the first as printed", () => {
    const tags = [...cardThemeTags(chars(["creature"], ["human", "wizard"]))];
    expect(tags).toContain("enters:human");
    expect(tags).toContain("enters:wizard");
  });

  test("a permanent with NO subtype still advertises its card type", () => {
    expect([...cardThemeTags(chars(["artifact"]))]).toEqual(["enters:artifact"]);
  });

  test("adds ENTRY only, never the implied cast or attack", () => {
    const tags = [...cardThemeTags(chars(["creature"], ["dragon"]))];
    expect(tags).toEqual(["enters:dragon"]);
    expect(tags.some((t) => t.startsWith("cast:") || t.startsWith("attacks:"))).toBe(false);
  });
});

// A CHANGELING IS EVERY CREATURE TYPE, which is right for MATCHING and nonsense as a THEME: fanning
// out over ~350 subtypes took `tribal-tribal` from "shapeshifters entering" to "bears entering" and
// nearly doubled the corpus census. It advertises its PRINTED type.
test("a changeling advertises its printed type only, not all 350", () => {
  const changeling: CardTags = {
    oracleId: "x", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: {
      types: ["creature"], subtypes: ["shapeshifter", "bear", "wizard"], colors: [], identity: [],
      cmc: 1, power: null, toughness: null, token: false, keywords: ["changeling"],
    },
    abilities: [],
  };
  expect([...cardThemeTags(changeling)]).toEqual(["enters:shapeshifter"]);
});

// A COST REDUCTION CANNOT TAKE GENERIC MANA BELOW ZERO (CR 118.7). Found by the OWNER, from two
// `uncertain` verdicts on the panel debt: "spells cost {1} less" does nothing to a card costing {U}.
// Measured: 740 of 5,482 cost-reduction reasons targeted a zero-generic consumer.
describe("cost reduction needs generic mana to reduce", () => {
  const H2: Hierarchy = {};
  const reducer = (name: string, oracleText: string): DeckCard => ({
    card: { name, typeLine: "Artifact", oracleText, keywords: [], colors: [], manaValue: 2 } as never,
    tags: {
      oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: { types: ["artifact"], subtypes: [], colors: [], identity: [], cmc: 2, power: null, toughness: null, token: false, keywords: [] },
      abilities: [{ kind: "static", effect: { kind: "cost-reduction", subject: { type: "spell", control: "you", token: null, scope: "all" } } }],
    },
  });
  const spell = (name: string, manaCost: string, keywords: string[] = []): DeckCard => ({
    card: { name, typeLine: "Creature — Wizard", oracleText: "", keywords, colors: ["U"], manaValue: 1, manaCost } as never,
    tags: {
      oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: { types: ["creature"], subtypes: ["wizard"], colors: ["U"], identity: ["U"], cmc: 1, power: "1", toughness: "1", token: false, keywords },
      abilities: [],
    },
  });
  const costReasons = (p: DeckCard, c: DeckCard) =>
    directedReasons(p, c, H2).filter((r) => r.effectKind === "cost-reduction");

  const generic = reducer("Sapphire Medallion", "Blue spells you cast cost {1} less to cast.");

  test("refuses a consumer whose cost is all coloured pips -- the owner's K-9 witness", () => {
    expect(costReasons(generic, spell("K-9, Mark I", "{U}"))).toEqual([]);
    expect(costReasons(generic, spell("Baleful Strix", "{U}{B}"))).toEqual([]);
  });

  test("{0} is a numeric symbol carrying ZERO generic -- refused too", () => {
    expect(costReasons(generic, spell("Mishra's Bauble", "{0}"))).toEqual([]);
  });

  test("keeps a consumer with any generic at all, and X counts because it is chosen", () => {
    expect(costReasons(generic, spell("Ordinary Spell", "{1}{U}")).length).toBeGreaterThan(0);
    expect(costReasons(generic, spell("X Spell", "{X}{U}")).length).toBeGreaterThan(0);
  });

  test("keeps it when the reducer takes a COLOURED pip -- Defiler of Flesh really does discount {U}", () => {
    const coloured = reducer("Defiler of Dreams", "Blue spells you cast cost {U} less to cast.");
    expect(costReasons(coloured, spell("K-9, Mark I", "{U}")).length).toBeGreaterThan(0);
  });

  test("keeps it when the consumer has an ADDITIONAL COST -- CR 601.2f adds it before reductions", () => {
    // Everflowing Chalice is {0} with Multikicker {2}: kicked twice it totals {4}, and a reducer
    // takes it to {3}. The first cut refused it, and the owner caught that.
    expect(costReasons(generic, spell("Everflowing Chalice", "{0}", ["Multikicker"])).length).toBeGreaterThan(0);
  });

  test("an unrecorded mana cost is never refused -- a missing answer, not a wrong one", () => {
    expect(costReasons(generic, spell("No Cost Recorded", "")).length).toBeGreaterThan(0);
  });
});


// COPY + THE LEGEND RULE (CR 707.2 / 704.5j). A copy effect fires the copied card's own entry
// trigger, and a legendary copy dies to a state-based action no card prints.
const copyFixture = (name: string, oracle: string, subject: Record<string, unknown> = { type: "creature", token: true, scope: "target" }) => ({
  card: { name, typeLine: "Sorcery", oracleText: oracle, keywords: [], colors: [], manaValue: 4 } as never,
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["sorcery"], subtypes: [], colors: [], identity: [], cmc: 4, power: null, toughness: null, token: false, keywords: [] },
    abilities: [{ kind: "on-cast", effect: { kind: "token-generation", subject } }],
  } as unknown as CardTags,
});
const selfTriggerLegend = (name: string, legendary = true) => ({
  card: { name, typeLine: "Legendary Creature", oracleText: "", keywords: [], colors: [], manaValue: 5 } as never,
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: legendary ? ["legendary", "creature"] : ["creature"], subtypes: [], colors: [], identity: [], cmc: 5, power: null, toughness: null, token: false, keywords: [] },
    abilities: [
      { kind: "triggered", trigger: { verbs: ["enters"], subject: { control: "you", token: null, self: true } }, effect: { kind: "draw-card" } },
      { kind: "triggered", trigger: { verbs: ["dies"], subject: { control: "you", token: null, self: true } }, effect: { kind: "player-life-loss" } },
    ],
  } as unknown as CardTags,
});

test("copy: a token copy of a legend fires its entry trigger AND its death trigger", () => {
  const r = directedReasons(copyFixture("Rite of Replication", "Create a token that's a copy of target creature."), selfTriggerLegend("Hidetsugu and Kairi"), H);
  expect(r.some((x) => x.tag === "enters:any" && /copies it/.test(x.text))).toBe(true);
  expect(r.some((x) => x.tag === "dies:any" && /legend rule/.test(x.text))).toBe(true);
});

test("copy: a NONLEGENDARY consumer gets the entry and never the legend rule", () => {
  const r = directedReasons(copyFixture("Rite of Replication", "Create a token that's a copy of target creature."), selfTriggerLegend("Solemn Simulacrum", false), H);
  expect(r.some((x) => x.tag === "enters:any")).toBe(true);
  expect(r.some((x) => x.tag === "dies:any")).toBe(false);
});

test("copy: 'becomes a copy' makes no entry — the permanent is already on the battlefield", () => {
  const r = directedReasons(copyFixture("Sakashima's Will", "Choose a creature you control. Each other creature you control becomes a copy of that creature until end of turn.", { type: "creature" }), selfTriggerLegend("Hidetsugu and Kairi"), H);
  expect(r.some((x) => x.tag === "enters:any")).toBe(false);
  expect(r.some((x) => x.tag === "dies:any")).toBe(true);
});

test("copy: a populate effect copies a TOKEN and claims nothing", () => {
  const r = directedReasons(copyFixture("Growing Ranks", "Populate. (Create a token that's a copy of a creature token you control.)"), selfTriggerLegend("Hidetsugu and Kairi"), H);
  expect(r.length).toBe(0);
});

test("copy: a card that copies an ARTIFACT does not copy a creature", () => {
  const r = directedReasons(copyFixture("Sculpting Steel", "Create a token that's a copy of target artifact.", { type: "artifact", token: true, scope: "target" }), selfTriggerLegend("Hidetsugu and Kairi"), H);
  expect(r.length).toBe(0);
});

test("copy: a token whose card types are REWRITTEN copies something else entirely", () => {
  // Astral Dragon copies a NONCREATURE permanent; its derived subject describes the 3/3 Dragon the
  // token becomes, so reading it as the target claimed every Dragon in the deck.
  const p = copyFixture("Astral Dragon", "When this creature enters, create two tokens that are copies of target noncreature permanent, except they're 3/3 Dragon creatures.", { type: "creature", subtype: "dragon", token: true, scope: "target" });
  expect(directedReasons(p, selfTriggerLegend("Hidetsugu and Kairi"), H).length).toBe(0);
});

test("copy: an untyped token-generation ability does not widen a card that also names types", () => {
  // Court of Vantress derives two token-generation abilities; only the second names what it copies.
  const p = copyFixture("Court of Vantress", "At the beginning of your upkeep, choose up to one other target enchantment or artifact. If you're the monarch, you may create a token that's a copy of it.", { control: "any", token: null });
  p.tags.abilities.push({ kind: "triggered", effect: { kind: "token-generation", subject: { type: ["artifact", "enchantment"], token: true, scope: "target" } } } as never);
  expect(directedReasons(p, selfTriggerLegend("Hidetsugu and Kairi"), H).length).toBe(0);
});

// Reopening condition (2026-08-27): CR gives no way around a printed "nonlegendary" restriction, so
// a copy ability naming one can never reach a legendary consumer -- but it must still reach the
// nonlegendary one it genuinely can copy. Both directions proven to fire.
test("copy: a NONLEGENDARY-restricted copy ability never reaches a legendary consumer, and still reaches a nonlegendary one", () => {
  const p = copyFixture("Reflection of Kiki-Jiki", "Create a token that's a copy of another target nonlegendary creature you control, except it has haste.");
  expect(directedReasons(p, selfTriggerLegend("Kardur, Doomscourge", true), H).length).toBe(0);
  expect(directedReasons(p, selfTriggerLegend("Solemn Simulacrum", false), H).some((x) => x.tag === "enters:any")).toBe(true);
});

// PANEL FAMILY E (2026-08-20): a DEBUFF forms no applies-to edge, and an ABILITY discount needs an
// ability to discount.
test("a debuff makes no anthem claim, and an ability discount needs an activated ability", () => {
  const statik = (kind: string, extra: Record<string, unknown> = {}): CardTags => ({
    oracleId: "p", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["enchantment"], subtypes: [], colors: [], identity: [], cmc: 4,
      power: null, toughness: null, token: false, keywords: [] },
    abilities: [{ kind: "static", effect: { kind, subject: { control: "you", token: null, type: "creature", scope: "all" } } as never }],
    ...extra,
  });
  const creature = (abilityKind?: string): CardTags => ({
    oracleId: "c", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 2,
      power: "2", toughness: "2", token: false, keywords: [] },
    abilities: abilityKind ? [{ kind: abilityKind, effect: { kind: "draw-card" } } as never] : [],
  });
  const reasons = (pTags: CardTags, cTags: CardTags, oracle?: string) => directedReasons(
    { card: { name: "Curse", oracleText: oracle } as DeckCard["card"], tags: pTags },
    { card: { name: "Bear" } as DeckCard["card"], tags: cTags }, H,
  ).filter((r) => r.tag.startsWith("static:"));

  // An anthem still claims; a debuff never does — "P's static applies to C" says C is IMPROVED.
  expect(reasons(statik("pump"), creature()).length).toBe(1);
  expect(reasons(statik("debuff"), creature()).length).toBe(0);

  // Forensic Gadgeteer: refusing the whole card was measured wrong — it deleted three REAL claims.
  // The consumer's own ability list decides.
  const gadgeteer = "Activated abilities of artifacts you control cost {1} less to activate.";
  expect(reasons(statik("cost-reduction"), creature("activated"), gadgeteer).length).toBe(1);
  expect(reasons(statik("cost-reduction"), creature("triggered"), gadgeteer).length).toBe(0);
});

// 1c (2026-08-25): CR 118.7 on the ACTIVATED side. Owner's ruling 2026-08-23, OVERTURNING a cached
// REAL — "the consumer has activated abilities" is necessary and NOT sufficient. Forensic Gadgeteer
// prints its own floor and Thought Vessel's only ability is `{T}: Add {C}`, which has no mana in its
// cost at all, so `{1} less to activate` removes nothing.
test("an ability discount reads the ABILITY's cost, not the card's, and respects the printed floor", () => {
  const reducer = (oracle: string): DeckCard => ({
    card: { name: "Forensic Gadgeteer", oracleText: oracle } as DeckCard["card"],
    tags: {
      oracleId: "p", schemaVersion: 1, promptVersion: 0, model: "t",
      characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 3,
        power: "2", toughness: "3", token: false, keywords: [] },
      abilities: [{ kind: "static", effect: { kind: "cost-reduction", subject: { control: "you", token: null, type: "artifact", scope: "all" } } } as never],
    },
  } as DeckCard);
  // The consumer's own mana cost is deliberately `{2}` throughout: it carries generic, so the
  // spell-side guard would keep every one of these and only the ABILITY cost separates them.
  const artifact = (name: string, ...costs: string[]): DeckCard => ({
    card: { name, manaCost: "{2}" } as DeckCard["card"],
    tags: {
      oracleId: "c", schemaVersion: 1, promptVersion: 0, model: "t",
      characteristics: { types: ["artifact"], subtypes: [], colors: [], identity: [], cmc: 2,
        power: null, toughness: null, token: false, keywords: [] },
      abilities: costs.map((cost) => ({ kind: "activated", cost, effect: { kind: "draw-card" } })) as never,
    },
  } as DeckCard);
  const claims = (p: DeckCard, c: DeckCard) =>
    directedReasons(p, c, H).filter((r) => r.effectKind === "cost-reduction").length;

  const FLOOR = "Activated abilities of artifacts you control cost {1} less to activate. This effect can't reduce the mana in that cost to less than one mana.";
  const NO_FLOOR = "Activated abilities of artifacts you control cost {1} less to activate.";

  // Thought Vessel: `{T}: Add {C}` — no mana in the cost, so nothing to reduce, floor or no floor.
  expect(claims(reducer(FLOOR), artifact("Thought Vessel", "{T}"))).toBe(0);
  expect(claims(reducer(NO_FLOOR), artifact("Thought Vessel", "{T}"))).toBe(0);

  // Dross Skullbomb and Transmutation Font: an ability with generic mana above the floor. Both were
  // judged REAL and must survive — refusing the whole card was already measured wrong once.
  expect(claims(reducer(FLOOR), artifact("Dross Skullbomb", "{1}, Sacrifice this artifact", "{2}{B}, Sacrifice this artifact"))).toBe(1);
  expect(claims(reducer(FLOOR), artifact("Transmutation Font", "{T}", "{3}, {T}, Sacrifice three artifact tokens with different names"))).toBe(1);

  // Executioner's Capsule is the case that pins the floor at "some ability SURVIVES it" rather than
  // "some ability has generic": `{1}{B}, {T}, Sacrifice this artifact` is two mana, reduced to one,
  // which is not LESS than one. Its card cost is `{B}` — the spell-side guard would refuse it, which
  // is why reading the ability's cost is a recall gain here and a refusal on Thought Vessel.
  expect(claims(reducer(FLOOR), artifact("Executioner's Capsule", "{1}{B}, {T}, Sacrifice this artifact"))).toBe(1);

  // A Signet's `{1}, {T}` is one mana: a floored reducer cannot touch it, an unfloored one can.
  expect(claims(reducer(FLOOR), artifact("Izzet Signet", "{1}, {T}"))).toBe(0);
  expect(claims(reducer(NO_FLOOR), artifact("Izzet Signet", "{1}, {T}"))).toBe(1);
});

// PANEL FAMILY B (2026-08-20): "exiled with <this card>" is a set only the producer can enumerate,
// and the emit drops the restriction — Gisa and The Darkness Crystal emitted a bare
// `enters: creature` for "put all creature cards exiled with <me> onto the battlefield" and claimed
// to fire the self-ETB of every creature in the deck.
test("a card that only ever exiles an opponent's cannot fire a deck-mate's own entry trigger", () => {
  const returner: CardTags = {
    oracleId: "p", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 5,
      power: "4", toughness: "4", token: false, keywords: [] },
    abilities: [{
      kind: "triggered", effect: { kind: "graveyard-recursion" },
      trigger: { verbs: ["upkeep"], subject: { control: "you", token: null } },
      emits: [{ verb: "enters", subject: { control: "you", token: null, type: "creature" } }],
    }],
  };
  const selfEtb: CardTags = {
    oracleId: "c", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 4,
      power: "2", toughness: "2", token: false, keywords: [] },
    abilities: [{
      kind: "triggered", effect: { kind: "forced-sacrifice" },
      trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "creature", self: true } },
    }],
  };
  const reasons = (oracle: string) => directedReasons(
    { card: { name: "Gisa", oracleText: oracle } as DeckCard["card"], tags: returner },
    { card: { name: "Demon's Disciple" } as DeckCard["card"], tags: selfEtb }, H,
  ).filter((r) => r.tag.startsWith("enters:"));

  // BOTH printed facts are required. Gisa's own text carries them.
  expect(reasons("If a creature an opponent controls would die, exile it instead. At the beginning of "
    + "your upkeep, put all creature cards exiled with Gisa onto the battlefield.")).toHaveLength(0);
  // Ghost Vacuum's shape: it exiles from ANY graveyard, so a deck-mate really can come back and fire.
  expect(reasons("{T}: Exile target card from a graveyard. Put each creature card exiled with this "
    + "artifact onto the battlefield under your control.").length).toBe(1);
  // An ordinary reanimator names no exile set at all and is untouched.
  expect(reasons("Return target creature card from your graveyard to the battlefield.").length).toBe(1);
});

// PANEL FAMILY C (2026-08-20): a recursion restricted to what the CONSUMER'S OWN earlier action put
// in the graveyard cannot be enabled by anyone else's fill.
test("a recursion that returns only what it put there itself is fed by no other card", () => {
  const filler: CardTags = {
    oracleId: "p", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["sorcery"], subtypes: [], colors: [], identity: [], cmc: 2,
      power: null, toughness: null, token: false, keywords: [] },
    abilities: [{
      kind: "on-cast", effect: { kind: "mill" },
      emits: [{ verb: "enters-graveyard", subject: { control: "you", token: null, type: "creature" } }],
    }],
  };
  const recursion: CardTags = {
    oracleId: "c", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["enchantment"], subtypes: [], colors: [], identity: [], cmc: 4,
      power: null, toughness: null, token: false, keywords: [] },
    abilities: [{
      kind: "activated",
      effect: { kind: "graveyard-recursion", subject: { control: "you", token: null, type: "creature", zone: "graveyard" } },
    }],
  };
  const reasons = (oracle: string) => directedReasons(
    { card: { name: "Filler" } as DeckCard["card"], tags: filler },
    { card: { name: "Recursion", oracleText: oracle } as DeckCard["card"], tags: recursion }, H,
  ).filter((r) => r.tag.startsWith("graveyard-recursion:"));

  // Necromantic Selection destroys all creatures and returns one IT killed; Ripples of Undeath mills
  // three and returns one OF THOSE; Gerrard's Hourglass Pendant returns what hit the graveyard FROM
  // THE BATTLEFIELD this turn. None of the three can be fed by someone else's mill.
  expect(reasons("Destroy all creatures, then return a creature card put into a graveyard this way to the battlefield."))
    .toHaveLength(0);
  expect(reasons("Mill three cards. Then you may pay {1}. If you do, put a card from among those cards into your hand."))
    .toHaveLength(0);
  expect(reasons("Return to the battlefield all creature cards in your graveyard that were put there from the battlefield this turn."))
    .toHaveLength(0);
  // An ordinary reanimator names a class and any fill enables it.
  expect(reasons("Return target creature card from your graveyard to the battlefield.").length).toBe(1);
});

// The narrow half of family C: an untyped recursion on an ability with its own graveyard-entry
// trigger returns what THAT trigger saw, so a fill the trigger cannot see enables nothing —
// Kefka milling a creature for Marchesa, whose trigger needs a +1/+1 counter. A fill the trigger
// DOES see is dropped one line earlier and stated by the event-edge loop as `dies:creature`.
test("an untyped recursion behind its own trigger is not fed by a fill that trigger cannot see", () => {
  const mill: CardTags = {
    oracleId: "p", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 3,
      power: "2", toughness: "2", token: false, keywords: [] },
    abilities: [{
      kind: "triggered", effect: { kind: "mill" },
      trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "creature", self: true } },
      emits: [{ verb: "enters-graveyard", subject: { control: "you", token: null, type: "creature" } }],
    }],
  };
  const marchesa = (triggerSubject: Record<string, unknown>): CardTags => ({
    oracleId: "c", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 5,
      power: "3", toughness: "3", token: false, keywords: [] },
    abilities: [{
      kind: "triggered",
      // Untyped recursion — "return THAT card", the object the trigger saw.
      effect: { kind: "graveyard-recursion", subject: { control: "you", token: null, zone: "graveyard" } },
      trigger: { verbs: ["dies"], subject: triggerSubject as never },
    }],
  });
  const reasons = (t: Record<string, unknown>) => directedReasons(
    { card: { name: "Kefka" } as DeckCard["card"], tags: mill },
    { card: { name: "Marchesa" } as DeckCard["card"], tags: marchesa(t) }, H,
  ).filter((r) => r.tag.startsWith("graveyard-recursion:"));

  // The trigger demands a +1/+1 counter; a plain mill cannot produce that creature's death.
  expect(reasons({ control: "you", token: null, type: "creature", counter: "+1/+1" })).toHaveLength(0);
  // An UNRESTRICTED trigger (Meathook Massacre II) is the case the blanket version got wrong — the
  // relation is real, and the event-edge loop states it, so this loop must not double-count it.
  expect(reasons({ control: "you", token: null, type: "creature" })).toHaveLength(0);
});

// An intervening-if condition reaches the theme layer as a DEMAND (owner, 2026-08-20): Yuna is a
// counters payoff and Warlock Class an aristocrats one, and neither fact is in a trigger verb.
test("cardCaresTags carries the demand an intervening-if condition makes", () => {
  const warlockClass: CardTags = {
    oracleId: "c", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["enchantment"], subtypes: ["class"], colors: [], identity: [], cmc: 2,
      power: null, toughness: null, token: false, keywords: [] },
    abilities: [{
      kind: "triggered", effect: { kind: "player-life-loss" },
      trigger: { verbs: ["end-step"], subject: { control: "you", token: null } },
      conditionCares: ["dies:creature"],
    }],
  };
  const cares = cardCaresTags(warlockClass);
  // The trigger's own verb is still there...
  expect(cares.has("end-step:any")).toBe(true);
  // ...and so is the condition's demand, which no trigger verb states.
  expect(cares.has("dies:creature")).toBe(true);

  // A card with no condition is untouched.
  const plain: CardTags = { ...warlockClass, abilities: [{ ...warlockClass.abilities[0], conditionCares: undefined }] };
  expect([...cardCaresTags(plain)]).toEqual(["end-step:any"]);
});

// THE FOURTH TIME THIS SHAPE HAS BITTEN (`zone`, `counter`, `commander`, now `entersTapped`): in the
// self-trigger identity gate a producer's emit is the FILTER against the consumer's PRINTED
// characteristics, so a field describing the EVENT must be stripped there or it demands the consumer
// card BE that way. Keeping `entersTapped` silently deleted 29 real self-ETB claims the moment the
// field existed — Eldrazi Confluence blinking Solemn Simulacrum, Fungal Fortitude returning Gray
// Merchant of Asphodel.
test("a producer that arrives tapped still fires an ordinary self-ETB trigger", () => {
  const fetcher: CardTags = {
    oracleId: "p", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 4,
      power: "2", toughness: "2", token: false, keywords: [] },
    abilities: [{
      kind: "triggered", effect: { kind: "token-generation" },
      trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "creature", self: true } },
      // "put that card onto the battlefield tapped" — arrival state, SUPPLY side.
      emits: [{ verb: "enters", subject: { control: "you", token: null, type: "creature", entersTapped: true } }],
    }],
  };
  const selfEtb: CardTags = {
    oracleId: "c", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 5,
      power: "2", toughness: "4", token: false, keywords: [] },
    abilities: [{
      kind: "triggered", effect: { kind: "drain" },
      trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "creature", self: true } },
    }],
  };
  const reasons = directedReasons(
    { card: { name: "Eldrazi Confluence" } as DeckCard["card"], tags: fetcher },
    { card: { name: "Solemn Simulacrum" } as DeckCard["card"], tags: selfEtb }, H,
  ).filter((r) => r.tag.startsWith("enters:"));
  expect(reasons.length).toBeGreaterThan(0);
});

// A SELF ETB TRIGGER AND A CLASS ETB TRIGGER ARE TWO DIFFERENT FACTS (roadmap G1, owner's ruling
// 2026-08-21). "When THIS creature enters, draw" wants something to make it enter AGAIN; "whenever
// ANOTHER Wizard you control enters" wants Wizards. They shared one tag, so the first claimed the
// deck wanted its own card type, at full weight against PRODUCER_SHARE 0.35 for supply.
test("a self entry trigger is not a demand for its own class, and supplies etb-refire", () => {
  const t = base("Bellowing Crier", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null, self: true } },
    effect: { kind: "draw-card" },
  }]).tags;
  expect([...cardCaresTags(t)]).not.toContain("enters:creature");
  expect([...cardCaresTags(t)]).not.toContain(ETB_REFIRE); // it SUPPLIES the tag, it does not want it
  expect([...cardThemeTags(t)]).toContain(ETB_REFIRE);
});

// THE DEMAND IS ON THE RE-FIRER, which is what makes the tag discriminate: keyed the other way it
// headlines 11 of the 71 decks including one with a single flicker effect; keyed this way, 4, each
// carrying 7 or more.
test("a flicker, clone or ENTRY doubler cares about entry triggers — an attack doubler does not", () => {
  for (const kind of ["flicker", "clone"]) {
    const t = base("Eldrazi Displacer", [{
      kind: "activated",
      effect: { kind, subject: { type: "creature", control: "you", token: null } },
    }]).tags;
    expect([...cardCaresTags(t)]).toContain(ETB_REFIRE);
    expect([...cardThemeTags(t)]).toContain(ETB_REFIRE);
  }

  // A doubler now qualifies on WHICH triggers it doubles, not on carrying the kind. The bare kind
  // used to be enough, and this file's own REFIRE_KINDS comment recorded the resulting over-claim:
  // "Isshin doubles ATTACK triggers and Tekuthal proliferate". A deck could headline `etb-refire` on
  // a card that doubles no entry at all.
  const panharmonicon = base("Panharmonicon", [{
    kind: "static", effect: { kind: "trigger-doubling" }, doubles: ["enters"],
  }]).tags;
  expect([...cardThemeTags(panharmonicon)]).toContain(ETB_REFIRE);

  const isshin = base("Isshin, Two Heavens as One", [{
    kind: "static", effect: { kind: "trigger-doubling" }, doubles: ["attacks"],
  }]).tags;
  expect([...cardThemeTags(isshin)]).not.toContain(ETB_REFIRE);

  // A doubler whose printed qualifier the closed map cannot read (Veyran, "instant or sorcery spell
  // you cast") records no `doubles` and no longer counts. It was counted on no evidence before, so
  // this narrows in the under-claiming direction on purpose.
  const veyran = base("Veyran, Voice of Duality", [{ kind: "static", effect: { kind: "trigger-doubling" } }]).tags;
  expect([...cardThemeTags(veyran)]).not.toContain(ETB_REFIRE);
});

test("a trigger doubler pairs with a card whose trigger it doubles, and only that card", () => {
  const panharmonicon = base("Panharmonicon", [{
    kind: "static", effect: { kind: "trigger-doubling" }, doubles: ["enters"],
  }]);
  const etbHaver = base("Solemn Simulacrum", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { self: true, control: "you", token: null } },
    effect: { kind: "ramp" },
  }]);
  const doubled = pairReasons(panharmonicon, etbHaver, H);
  expect(doubled.some((r) => r.tag === "doubles:enters")).toBe(true);
  expect(doubled.find((r) => r.tag === "doubles:enters")!.text)
    .toBe("Panharmonicon doubles Solemn Simulacrum's enters trigger");

  // CROSS-CLASS IS THE WHOLE DEFECT THIS FIELD EXISTS TO FIX: Isshin doubles ATTACK triggers, so it
  // must claim nothing about an ETB card. Before `doubles`, Isshin and Panharmonicon derived
  // byte-identically and neither claimed anything at all.
  const isshin = base("Isshin, Two Heavens as One", [{
    kind: "static", effect: { kind: "trigger-doubling" }, doubles: ["attacks"],
  }]);
  expect(pairReasons(isshin, etbHaver, H).some((r) => r.tag.startsWith("doubles:"))).toBe(false);

  // A consumer with NO triggered ability receives nothing — the type-line trap that would have
  // followed from stamping this into `effect.subject` instead.
  const vanilla = base("Arcane Signet", [{ kind: "activated", effect: { kind: "mana-generation" } }]);
  expect(pairReasons(panharmonicon, vanilla, H).some((r) => r.tag.startsWith("doubles:"))).toBe(false);
});

// INALLA IS THE ACCEPTANCE TEST: its eminence reads "whenever another nontoken Wizard you control
// enters", a CLASS subject, so the deck really does want Wizards and the tag must survive untouched.
// Measured: inalla's headline is byte-identical across this change ("wizards entering", 0.60).
test("a class entry trigger keeps its demand and supplies no etb-refire", () => {
  const t = base("Inalla, Archmage Ritualist", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "you", token: false } },
    effect: { kind: "token-generation" },
  }]).tags;
  expect([...cardCaresTags(t)]).toContain("enters:wizard");
  expect([...cardThemeTags(t)]).not.toContain(ETB_REFIRE);
});

describe("a conditional land relates to the mana base that turns it on (I9)", () => {
  const land = (name: string, typeLine: string, oracleText: string): DeckCard => ({
    card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue: 0 } as never,
    tags: {
      oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: { types: ["land"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
      abilities: [],
    } as CardTags,
  });
  // Printed text, fetched from the corpus.
  const crag = land("Rootbound Crag", "Land", "This land enters tapped unless you control a Mountain or a Forest.\n{T}: Add {R} or {G}.");
  const verge = land("Thornspire Verge", "Land", "{T}: Add {R}.\n{T}: Add {G}. Activate only if you control a Mountain or a Forest.");
  const glade = land("Cinder Glade", "Land — Mountain Forest", "({T}: Add {R} or {G.})\nThis land enters tapped unless you control two or more basic lands.");
  const shock = land("Stomping Ground", "Land — Mountain Forest", "({T}: Add {R} or {G}.)\nAs this land enters, you may pay 2 life. If you don't, it enters tapped.");
  const island = land("Island", "Basic Land — Island", "({T}: Add {U}.)");

  test("a check land is the CONSUMER and the card carrying the type is the producer", () => {
    const reasons = directedReasons(shock, crag, H);
    const r = reasons.find((x) => String(x.tag).startsWith("land-condition:"))!;
    expect(r.tag).toBe("land-condition:mountain");
    expect(r.consumer).toBe("Rootbound Crag");
    expect(r.producer).toBe("Stomping Ground");
    expect(r.text).toBe("Rootbound Crag enters untapped when you control a Mountain, and Stomping Ground is one");
  });

  test("a NONBASIC carrying the type satisfies it — the subtype, not the supertype", () => {
    // Stomping Ground is `Land — Mountain Forest` and is not basic. 233 nonbasic land slots across
    // the 71 decks carry a basic land type; every one of them turns a check land on.
    expect(directedReasons(shock, crag, H).some((r) => String(r.tag).startsWith("land-condition:"))).toBe(true);
  });

  test("a land of the WRONG type forms nothing", () => {
    expect(directedReasons(island, crag, H).some((r) => String(r.tag).startsWith("land-condition:"))).toBe(false);
  });

  test("a verge land says ACTIVATING, not entering — a wrong sentence about the same relation", () => {
    const r = directedReasons(shock, verge, H).find((x) => String(x.tag).startsWith("land-condition:"))!;
    expect(r.text).toContain("second mana ability");
    expect(r.text).not.toContain("enters untapped");
  });

  test("a REVEAL land forms no edge though it names the types — its condition is your HAND", () => {
    // Port Town: "you may reveal a Plains or Island card from your hand". It carries subtypes, so
    // it is the one refused template a dropped guard would actually leak — and the claim it would
    // make ("enters untapped when you control a Plains") is about the wrong zone entirely.
    const portTown = land("Port Town", "Land", "As this land enters, you may reveal a Plains or Island card from your hand. If you don't, this land enters tapped.\n{T}: Add {W} or {U}.");
    const plains = land("Sacred Foundry", "Land — Mountain Plains", "({T}: Add {R} or {W}.)\nAs this land enters, you may pay 2 life. If you don't, it enters tapped.");
    expect(directedReasons(plains, portTown, H).some((r) => String(r.tag).startsWith("land-condition:"))).toBe(false);
  });

  test("a bfz land forms NO edge — it counts the SUPERTYPE, so it names no member", () => {
    // "two or more basic lands" is satisfied by every basic equally, which is the registered
    // "a claim that applies to a card merely for being an ordinary card is false".
    expect(directedReasons(island, glade, H).some((r) => String(r.tag).startsWith("land-condition:"))).toBe(false);
    expect(directedReasons(shock, glade, H).some((r) => String(r.tag).startsWith("land-condition:"))).toBe(false);
  });

  test("the relation does not run backwards: the Crag supplies nothing to the Mountain", () => {
    expect(directedReasons(crag, shock, H).some((r) => String(r.tag).startsWith("land-condition:"))).toBe(false);
  });
});

describe("an opponent's permanent is not this deck's theme (K3a)", () => {
  const withEmit = (name: string, verb: string, subject: Record<string, unknown>) => base(name, [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null, self: true } },
    effect: { kind: "token-generation" },
    emits: [{ verb, subject } as never],
  }]);

  test("a token handed to the OPPONENT forms no theme tag", () => {
    // Beast Within's 3/3 goes to the destroyed permanent's controller. It was counted toward
    // "creatures entering" in a deck whose payoffs say "you control", and the owner judged it FALSE.
    const tags = cardThemeTags(withEmit("Beast Within", "create-token", { type: "creature", control: "opp", token: true }).tags!);
    expect([...tags].some((t) => t.startsWith("create-token:"))).toBe(false);
  });

  test("the SAME emit under your own control still forms one", () => {
    const tags = cardThemeTags(withEmit("Ellie", "create-token", { type: "creature", control: "you", token: true }).tags!);
    expect([...tags]).toContain("create-token:creature");
  });

  test("DRAINING AN OPPONENT IS THE DECK DOING ITS THING — a player subject is kept", () => {
    // The control arm. 215 of the 454 opponent-facing emits name the PLAYER (lose-life 90,
    // damage 74); Gray Merchant of Asphodel is one, and filtering it would delete the drain theme
    // from every aristocrats deck in the corpus.
    const tags = cardThemeTags(withEmit("Gray Merchant", "lose-life", { control: "opp" }).tags!);
    expect([...tags]).toContain("lose-life:any");
  });

  test("a TRIGGER watching an opponent is untouched — only emits are filtered", () => {
    const card = base("Watcher", [{
      kind: "triggered",
      trigger: { verbs: ["dies"], subject: { type: "creature", control: "opp", token: null } },
      effect: { kind: "draw-card" },
    }]);
    expect([...cardThemeTags(card.tags!)]).toContain("dies:creature");
  });
});

// M2 (2026-08-25, owner-reported): A PLANESWALKER'S SUBTYPE IS A CHARACTER NAME, and the deck's
// identity is the CARD TYPE. The A9 fan-out emits one key per subtype and the card-type key only
// when there is no subtype — right for a creature (a Wizard deck wants `enters:wizard`, not
// `enters:creature`) and wrong for a planeswalker. MEASURED: `mono-blue-plainswalker-control` runs
// EIGHTEEN walkers, split them `enters:jace` 7 / `enters:teferi` 3, and headlined "jaces entering"
// at cohesion 0.11 — a 7-card theme named over an 18-card deck.
test("a planeswalker's own entry advertises its card type as well as its character", () => {
  const walker = (name: string, subtype: string): CardTags => ({
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["legendary", "planeswalker"], subtypes: [subtype], colors: [], identity: [], cmc: 4, power: null, toughness: null, token: false, keywords: [] },
    abilities: [],
  } as CardTags);

  const tags = [...cardThemeTags(walker("Jace, the Mind Sculptor", "jace"))];
  // ADDITIVE, NEVER A REPLACEMENT — planeswalker subtypes are real typal identities, so a payoff
  // naming one still finds it.
  expect(tags).toContain("enters:planeswalker");
  expect(tags).toContain("enters:jace");
  // A11's supertype key rides along unchanged.
  expect(tags).toContain("enters:legendary");

  // PLANESWALKER-ONLY, and the restraint is the design: pushing every card's type here would give
  // every creature `enters:creature`, the universal-bucket failure three theme designs died on.
  const wizard = base("Human Wizard", [], ["human", "wizard"]).tags;
  const creatureTags = [...cardThemeTags(wizard)];
  expect(creatureTags).toContain("enters:human");
  expect(creatureTags).toContain("enters:wizard");
  expect(creatureTags).not.toContain("enters:creature");
});

/** A DAMAGE EVENT HAS TWO PARTICIPANTS, AND A DEALER MUST BE COMPARED AGAINST A DEALER.
 *
 *  Owner's witness, 2026-08-27: Impact Tremors "deals 1 damage to each opponent"; Ghyrson Starn
 *  triggers on "another source YOU CONTROL deals exactly 1 damage to a permanent or player". The
 *  emit's subject is the VICTIM and the trigger's subject is the DEALER, and comparing them meant
 *  the authored damage channel formed no edges at all — measured, Impact Tremors took 10 incoming
 *  edges and zero outgoing in a deck holding six cards that trigger on damage.
 *
 *  Ghyrson is unconstrained on the victim, which is the owner's own correction and the reason the
 *  roles must be separated rather than merged: it triggers on damage to ANY permanent or player,
 *  including yourself. */
test("a damage emit's dealer satisfies a trigger that names the dealer", () => {
  const tremors = base("Impact Tremors", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "damage" },
    // The victim is an opponent; the dealer is this card, which its controller controls.
    emits: [{
      verb: "non-combat-damage",
      subject: { control: "opp", token: null, scope: "each" },
      dealer: { control: "you", token: null },
    }],
  }]);
  const ghyrson = base("Ghyrson Starn", [{
    kind: "triggered",
    trigger: { verbs: ["non-combat-damage"], subject: { control: "you", token: null } },
    effect: { kind: "damage" },
  }]);
  const tags = directedReasons(tremors, ghyrson, H).map((r) => r.tag);
  expect(tags).toContain("non-combat-damage:any");
});

/** The fix must be ADDITIVE. An implied combat emit carries no `dealer` — its subject IS the
 *  creature dealing the damage — so it falls back to exactly the comparison it made before. */
test("an emit with no dealer still matches on its subject, as implied combat damage does", () => {
  const dealer = base("Attacker", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "you", token: null } },
    effect: { kind: "damage" },
    emits: [{ verb: "combat-damage", subject: { type: "creature", control: "you", token: null } }],
  }]);
  const payoff = base("Damage Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["combat-damage"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  expect(directedReasons(dealer, payoff, H).map((r) => r.tag)).toContain("combat-damage:creature");
});

/** And it must not become a wildcard: a trigger demanding an OPPONENT's source is not satisfied by
 *  damage YOUR card deals. */
test("a dealer demand still discriminates on control", () => {
  const mine = base("My Pinger", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null } },
    effect: { kind: "damage" },
    emits: [{
      verb: "non-combat-damage",
      subject: { control: "opp", token: null },
      dealer: { control: "you", token: null },
    }],
  }]);
  const wantsTheirs = base("Watches Opponents", [{
    kind: "triggered",
    trigger: { verbs: ["non-combat-damage"], subject: { control: "opp", token: null } },
    effect: { kind: "draw-card" },
  }]);
  expect(directedReasons(mine, wantsTheirs, H).map((r) => r.tag)).not.toContain("non-combat-damage:opp");
});

// A FACE IS A NODE (2026-08-27, Task 3). `mdfcProducer` is an Instant // Land modal DFC: front
// face casts as an Instant, back face is a Land that enters. `faceDeckCards` splits it into two
// DeckCards, each carrying only its own face's implied events -- see `faces.ts`.
const mdfcProducer = (): DeckCard => ({
  card: {
    name: "Fell the Profane // Fell Mire",
    typeLine: "Instant // Land",
    oracleText: "Destroy target creature or planeswalker.\n// Fell Mire enters the battlefield tapped.",
    keywords: [], colors: ["B"], manaValue: 2,
    faces: [
      { name: "Fell the Profane", typeLine: "Instant", oracleText: "Destroy target creature or planeswalker.", manaCost: "{1}{B}", colors: ["B"] },
      { name: "Fell Mire", typeLine: "Land", oracleText: "Fell Mire enters the battlefield tapped.", colors: [] },
    ],
  } as never,
  tags: {
    oracleId: "fell-the-profane", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: {
      types: ["instant", "land"], subtypes: [], colors: [], identity: [], cmc: 2,
      power: null, toughness: null, token: false, keywords: [],
      faces: [
        { types: ["instant"], subtypes: [] },
        { types: ["land"], subtypes: [] },
      ],
    },
    abilities: [],
  } as CardTags,
});

const landfallConsumer = (): DeckCard => base("Lotus Cobra", [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: ["land"] } },
  effect: { kind: "add-mana" },
}]);

const castConsumer = (): DeckCard => base("Guttersnipe", [{
  kind: "triggered",
  trigger: { verbs: ["cast"], subject: { control: "you", token: null, type: ["instant"] } },
  effect: { kind: "damage" },
}]);

// A FACE IS A NODE, AND THE PANEL MUST NOT NOTICE. `pairs.json` keys 895 frozen pairs on
// `producer|consumer|tag`, so the NAME stays the physical card's and the face rides beside it.
test("a reason from a back-face ability names the card and stamps the face", () => {
  const [, back] = faceDeckCards(mdfcProducer());
  const consumer = landfallConsumer();
  const reasons = directedReasons(back, consumer, {});
  expect(reasons.length).toBeGreaterThan(0);
  expect(reasons[0].producer).toBe("Fell the Profane // Fell Mire");
  expect(reasons[0].producerFace).toBe(1);
});

test("a reason from the front face names the card and stamps no face", () => {
  const [front] = faceDeckCards(mdfcProducer());
  const consumer = castConsumer();
  const reasons = directedReasons(front, consumer, {});
  expect(reasons.length).toBeGreaterThan(0);
  expect(reasons[0].producer).toBe("Fell the Profane // Fell Mire");
  expect(reasons[0].producerFace).toBeUndefined();
});

/** `pairReasons` reads the card it is handed. The shipped engine never hands it a multi-face card
 *  whole -- `analyzeDeckStructured` splits with `faceDeckCards` first, so a face is matched with
 *  only the abilities IT prints. `pairReasonsAcrossFaces` is that same question for the two callers
 *  that ask it about a bare pair: the pair-judging tool and the ratchet that gates its verdicts. */
test("pairReasonsAcrossFaces matches a two-faced card FACE BY FACE, as the engine does", () => {
  const payoff = base("Kindred Discovery", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const mdfc: DeckCard = {
    card: {
      name: "Front Half // Back Half", typeLine: "Sorcery // Creature — Wizard", oracleText: "a\nb",
      keywords: [], colors: [], manaValue: 2,
      faces: [
        { name: "Front Half", typeLine: "Sorcery", oracleText: "a", colors: [] },
        { name: "Back Half", typeLine: "Creature — Wizard", oracleText: "b", colors: [] },
      ],
    } as never,
    tags: {
      oracleId: "o", schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: {
        types: ["sorcery", "creature"], subtypes: ["wizard"], colors: [], identity: [], cmc: 2,
        power: null, toughness: null, token: false, keywords: [],
        faces: [{ types: ["sorcery"], subtypes: [] }, { types: ["creature"], subtypes: ["wizard"] }],
      },
      // Printed on the BACK face only, which is the whole point: the unsplit read hangs it on a
      // card whose name is "Front Half // Back Half".
      abilities: [{
        face: 1,
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "you", token: false } },
        effect: { kind: "token-generation", subject: { subtype: "wizard", control: "you", token: true } },
        emits: [{ verb: "enters", subject: { subtype: "wizard", control: "you", token: true } }],
      }],
    } as unknown as CardTags,
  };

  const across = pairReasonsAcrossFaces(mdfc, payoff, H);
  const etb = across.find((r) => r.tag === "enters:creature")!;
  expect(etb).toBeDefined();
  // The SENTENCE names the face that prints the ability; the endpoint names the physical card
  // (`stampSides`, off `parentName`). The unsplit read can say neither -- it only knows the
  // combined name, which is what makes this assertion fire on the fix.
  expect(etb.text).toContain("Back Half");
  expect(etb.text).not.toContain("Front Half // Back Half");
  expect(etb.producer).toBe("Front Half // Back Half");

  // A pair of single-faced cards takes the plain path unchanged.
  const lord = base("Death Baron", [{
    kind: "static", effect: { kind: "pump", subject: { subtype: "zombie", control: "you", token: null } },
  }]);
  const zombie = base("Gravecrawler", [], ["zombie"]);
  expect(pairReasonsAcrossFaces(lord, zombie, H)).toEqual(pairReasons(lord, zombie, H));
});

/** A PROLIFERATE HAS A DEMAND, NOT ONLY A SUPPLY (spec 26.3's "proliferate -> poison counters",
 *  re-measured still-open on 2026-08-28). `impliedCounterEvents` makes a proliferate SUPPLY an
 *  untyped counter-added; nothing made it ASK for one, so a proliferate card and a counter source
 *  were two producers with nothing between them. */
const proliferator = (name: string) => base(name, [{
  kind: "on-cast",
  effect: { kind: "proliferate" },
  emits: [{ verb: "proliferate", subject: { control: "any", token: null } }],
}] as unknown as CardTags["abilities"]);

test("a counter source feeds a card that proliferates", () => {
  // "Whenever a nontoken artifact creature you control deals combat damage to a player, that player
  // gets two poison counters." — an OPPONENT-facing counter, which is why the demand is control:any.
  const source = base("Virulent Silencer", [{
    kind: "triggered",
    trigger: { verbs: ["combat-damage"], subject: { type: "creature", control: "you", token: false } },
    effect: { kind: "counter-placement" },
    emits: [{ verb: "counter-added", subject: { control: "any", token: null, counter: "poison" } }],
  }] as unknown as CardTags["abilities"]);
  const reasons = pairReasons(source, proliferator("Radstorm"), H);
  expect(reasons.some((r) => r.tag.startsWith("counter-added"))).toBe(true);
});

test("a proliferate is not the ORIGIN of a counter, so two of them do not feed each other", () => {
  // CR 701.29: proliferate gives another counter of each kind ALREADY THERE. Without the
  // implied-minus-authored exclusion in `directedReasons`, the producer's own proliferate-implied
  // counter-added satisfies the consumer's proliferate demand and the two edge over a counter
  // neither of them made.
  expect(pairReasons(proliferator("Karn's Bastion"), proliferator("Flux Channeler"), H)).toEqual([]);
});

test("a card that BOTH proliferates and authors a counter is still a real origin", () => {
  // 6 of the 24 proliferate cards in the corpus do both — Sword of Truth and Justice puts a +1/+1
  // counter and THEN proliferates. Excluding by CARD rather than by EVENT would delete all six.
  const both = base("Sword of Truth and Justice", [{
    kind: "triggered",
    trigger: { verbs: ["combat-damage"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "counter-placement" },
    emits: [
      { verb: "counter-added", subject: { control: "you", token: null, counter: "+1/+1" } },
      { verb: "proliferate", subject: { control: "any", token: null } },
    ],
  }] as unknown as CardTags["abilities"]);
  expect(pairReasons(both, proliferator("Radstorm"), H).some((r) => r.tag.startsWith("counter-added"))).toBe(true);
});

/** IMPLIED MINUS AUTHORED, and this is the arm that proves the difference. When a card's AUTHORED
 *  counter-added is byte-identical to the one its own proliferate implies, `producerEvents` dedupes
 *  the two into one event — so an exclusion set built from the implied events ALONE would drop a
 *  real, printed origin along with the synthetic one.
 *
 *  NO CORPUS WITNESS TODAY: measured 0 of the 24 proliferate cards collide this way, so this guard
 *  changes no number in the 71 decks. It is kept, and said so here rather than left to be
 *  rediscovered, because the shape is plainly printable ("put a counter on any permanent, then
 *  proliferate") and the failure direction is a DELETED true claim. */
test("an authored counter-added identical to the card's own implied one survives", () => {
  const collides = base("Untyped Origin", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "counter-placement" },
    emits: [
      // exactly what `impliedCounterEvents` synthesizes for the proliferate below
      { verb: "counter-added", subject: { control: "any", token: null } },
      { verb: "proliferate", subject: { control: "any", token: null } },
    ],
  }] as unknown as CardTags["abilities"]);
  expect(pairReasons(collides, proliferator("Radstorm"), H).some((r) => r.tag.startsWith("counter-added"))).toBe(true);
});

test("a proliferate edge says what actually happens, not that the producer got a counter", () => {
  // "When Virulent Silencer gets a counter, Radstorm triggers" is false twice: the Silencer puts
  // poison counters on a PLAYER, and Radstorm is a sorcery, which never triggers.
  const source = base("Virulent Silencer", [{
    kind: "triggered",
    trigger: { verbs: ["combat-damage"], subject: { type: "creature", control: "you", token: false } },
    effect: { kind: "counter-placement" },
    emits: [{ verb: "counter-added", subject: { control: "any", token: null, counter: "poison" } }],
  }] as unknown as CardTags["abilities"]);
  const r = pairReasons(source, proliferator("Radstorm"), H).find((x) => x.tag.startsWith("counter-added"))!;
  expect(r.text).toBe("Virulent Silencer puts counters on the board, and Radstorm proliferates them");
  expect(r.text).not.toContain("gets a counter");
  expect(r.text).not.toContain("triggers");
});

/** AN ENTER-AS-A-COPY REPLACEMENT IS A REASON TO BE BLINKED (spec 26.3's "flicker + enters-as-copy",
 *  re-measured still-open 2026-08-28). Sakashima derives `{static, clone}` with no subject and no
 *  emit, so a flicker that makes it re-enter had nothing to satisfy. */
const cloneCard = (name: string, oracleText: string): DeckCard => ({
  card: { name, typeLine: "Creature — Shapeshifter", oracleText, keywords: [], colors: [], manaValue: 3 } as never,
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["creature"], subtypes: ["shapeshifter"], colors: [], identity: [], cmc: 3, power: 0, toughness: 0, token: false, keywords: [] },
    abilities: [{ kind: "static", effect: { kind: "clone" } }],
  } as unknown as CardTags,
});
const blinker = () => base("Waterbender's Restoration", [{
  kind: "on-cast",
  effect: { kind: "flicker", subject: { control: "any", token: null } },
  emits: [{ verb: "enters", subject: { control: "you", token: null, type: "creature", scope: "target", fromZone: "exile" } }],
}] as unknown as CardTags["abilities"]);

test("a flicker feeds a card that enters as a copy", () => {
  const sakashima = cloneCard("Sakashima the Impostor",
    "You may have Sakashima the Impostor enter as a copy of any creature on the battlefield, except its name is Sakashima the Impostor.");
  const r = pairReasons(blinker(), sakashima, H).find((x) => x.tag.startsWith("enters"));
  expect(r).toBeDefined();
  // A replacement effect never TRIGGERS (CR 614.1c); what it does is choose again.
  expect(r!.text).toBe("Waterbender's Restoration makes Sakashima the Impostor enter again, and it copies something new as it does");
  expect(r!.text).not.toContain("triggers");
});

test("a copy replacement applied to a CLASS is not this card's own demand", () => {
  // Essence of the Wild: "Creatures you control enter as a copy of this creature." Its OWN entry
  // copies nothing, so the blink edge would be a claim the card does not make. 2 of the 66 corpus
  // cards printing the cue are this shape.
  const essence = cloneCard("Essence of the Wild", "Creatures you control enter as a copy of this creature.");
  expect(pairReasons(blinker(), essence, H).some((x) => x.tag.startsWith("enters"))).toBe(false);
});

test("an UNTYPED enters emit does not reach a clone, because a real self-ETB trigger refuses it too", () => {
  // Reality Shift emits a bare `{verb: "enters", control: "any"}` — its target manifests an unknown
  // top card, face down, as a 2/2 with no abilities (CR 708.2), so no copy replacement applies.
  // Verified against the committed tree: that emit reaches an ordinary self-ETB creature ZERO times.
  // An untyped clone demand accepted it 21 times, which made this demand WIDER than the channel it
  // is joining. The card's own printed type is what closes the gap.
  const manifest = base("Reality Shift", [{
    kind: "on-cast",
    effect: { kind: "" },
    emits: [{ verb: "enters", subject: { control: "any", token: null } }],
  }] as unknown as CardTags["abilities"]);
  const sakashima = cloneCard("Sakashima the Impostor",
    "You may have Sakashima the Impostor enter as a copy of any creature on the battlefield.");
  expect(pairReasons(manifest, sakashima, H).some((r) => r.tag.startsWith("enters"))).toBe(false);
});

/** ONE CLAIM PER PHYSICAL CARD. A permanent shows one face at a time (CR 712.3a), so a card-wide
 *  static relates to it ONCE — but faces-as-nodes pairs the anthem with each face separately, and
 *  both rows stamp back to the same physical name. Measured on the 71 decks: 217 such rows, and
 *  MESHED 287 -> 332 entirely inside five (deck, producer, tag) groups whose FAN-OUT never moved. */
const twoFacedCreature = (frontTypeLine: string): DeckCard => ({
  card: {
    name: "Optimus Prime, Hero // Optimus Prime, Autobot Leader",
    typeLine: `${frontTypeLine} // Creature — Robot`, oracleText: "a\nb",
    keywords: [], colors: [], manaValue: 4,
    faces: [
      { name: "Optimus Prime, Hero", typeLine: frontTypeLine, oracleText: "a", colors: [] },
      { name: "Optimus Prime, Autobot Leader", typeLine: "Creature — Robot", oracleText: "b", colors: [] },
    ],
  } as never,
  tags: {
    oracleId: "o", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: {
      types: ["creature"], subtypes: ["robot"], colors: [], identity: [], cmc: 4,
      power: null, toughness: null, token: false, keywords: [],
      faces: [
        { types: frontTypeLine.startsWith("Creature") ? ["creature"] : ["sorcery"], subtypes: [] },
        { types: ["creature"], subtypes: ["robot"] },
      ],
    },
    abilities: [],
  } as unknown as CardTags,
});

const anthem = () => base("Serah Farron", [{
  kind: "static",
  effect: { kind: "pump", subject: { type: "creature", control: "you", token: null } },
}] as unknown as CardTags["abilities"]);

test("a wide static claims a two-faced creature ONCE, on its front face", () => {
  const faces = faceDeckCards(twoFacedCreature("Creature — Robot"));
  expect(faces).toHaveLength(2);
  const pumps = faces.flatMap((f) => directedReasons(anthem(), f, H)).filter((r) => r.tag === "static:pump");
  expect(pumps).toHaveLength(1);
  // The front face is the one kept, and the sentence names it.
  expect(pumps[0].consumerFace).toBeUndefined();
  expect(pumps[0].text).toContain("Optimus Prime, Hero");
});

test("...and on the BACK face when the front does not satisfy the static at all", () => {
  // Under-claiming is the failure this must not make: a Sorcery front face is not a creature, so the
  // claim belongs to the back face and the pair must keep it.
  const faces = faceDeckCards(twoFacedCreature("Sorcery"));
  const pumps = faces.flatMap((f) => directedReasons(anthem(), f, H)).filter((r) => r.tag === "static:pump");
  expect(pumps).toHaveLength(1);
  expect(pumps[0].consumerFace).toBe(1);
  expect(pumps[0].text).toContain("Autobot Leader");
});

/** A `type-grant` reaches lands as readily as creatures, and the phrase said "creature" about both:
 *  Omo, Queen of Vesuva prints one static for each ("each land with an everything counter is every
 *  land type", "each nonland creature ... is every creature type") and its LAND grant rendered
 *  "Omo gives Glasspool Shore an extra creature type" — a wrong noun on a true claim. */
const landGranter = () => base("Omo, Queen of Vesuva", [{
  kind: "static",
  effect: { kind: "type-grant", subject: { type: "land", control: "you", token: null } },
}] as unknown as CardTags["abilities"]);

test("a type-grant aimed at lands says LAND type, not creature type", () => {
  const land = base("Glasspool Shore", []);
  (land.tags.characteristics as { types: string[] }).types = ["land"];
  const grant = pairReasons(landGranter(), land, H).find((r) => r.tag === "static:type-grant")!;
  expect(grant.text).toBe("Omo, Queen of Vesuva gives Glasspool Shore an extra land type");
});

test("...and still says CREATURE type when that is what it reaches", () => {
  const nexus = base("Maskwood Nexus", [{
    kind: "static",
    effect: { kind: "type-grant", subject: { type: "creature", control: "you", token: null } },
  }] as unknown as CardTags["abilities"]);
  const grant = pairReasons(nexus, base("Shapeshifter", []), H).find((r) => r.tag === "static:type-grant")!;
  expect(grant.text).toBe("Maskwood Nexus gives Shapeshifter an extra creature type");
});

test("a type-grant that names neither drops the noun rather than guessing it", () => {
  // Eluge's "lands with a flood counter are Islands" derives `{subtype: island}` with no card type,
  // and 6 of the 13 derived type-grants carry no type or subtype at all. The consumer's own type
  // line settles it when it names exactly one of the two; a card that is BOTH cannot be settled.
  const untyped = base("Eluge, the Shoreless Sea", [{
    kind: "static",
    effect: { kind: "type-grant", subject: { control: "you", token: null } },
  }] as unknown as CardTags["abilities"]);
  const both = base("Dryad Arbor", []);
  (both.tags.characteristics as { types: string[] }).types = ["land", "creature"];
  const grant = pairReasons(untyped, both, H).find((r) => r.tag === "static:type-grant")!;
  expect(grant.text).toBe("Eluge, the Shoreless Sea gives Dryad Arbor an extra type");
  // ...and the SUBJECT outranks the consumer, which is the only thing that can settle a card that
  // is both: Omo's land static aimed at Dryad Arbor grants LAND types to a land creature.
  const fromSubject = pairReasons(landGranter(), both, H).find((r) => r.tag === "static:type-grant")!;
  expect(fromSubject.text).toBe("Omo, Queen of Vesuva gives Dryad Arbor an extra land type");
});

/** A BOARD COUNT IS A RELATION NOTHING FIRES. Krenko, Mob Boss makes a Goblin token per Goblin you
 *  control, so every other Goblin in the deck makes him bigger -- and no event says so: there is no
 *  trigger, no emit, and until `scalingSubject` learned to read a battlefield count there was not
 *  even a derived field to hang it on. OWNER-REPORTED as the fourth case a Krenko page should
 *  answer, after goblin-entering, token-entering and creature-entering. */
const goblinBody = () => base("Goblin Assassin", [], ["goblin"]);
const countsGoblins = () => base("Krenko, Mob Boss", [{
  kind: "activated", cost: "{T}",
  effect: {
    kind: "token-generation", scaling: "per-permanent",
    scalingSubject: { subtype: "goblin", zone: "battlefield", control: "you", token: null },
    subject: { control: "you", token: true, type: "creature", subtype: "goblin" },
  },
  emits: [{ verb: "create-token", subject: { control: "you", token: true, type: "creature", subtype: "goblin" } }],
}] as unknown as CardTags["abilities"], ["goblin"]);

test("a card of the counted subtype feeds a board-count payoff", () => {
  const reasons = directedReasons(goblinBody(), countsGoblins(), H);
  const scaled = reasons.find((r) => r.tag === "scales:goblin");
  // NOT "gets bigger": Krenko is a 3/3 whatever the count says, and his X decides how many TOKENS
  // he makes. The precon reviewer caught the old sentence against the card printed beside it.
  expect(scaled?.text).toBe("While you control Goblin Assassin, Krenko, Mob Boss counts it and makes more tokens");
  expect(scaled?.repeatability).toBe("activated");
});

/** THE DIRECTION IS ONE WAY. Krenko does not make the Goblin bigger. */
test("the board count does not run backwards", () => {
  expect(directedReasons(countsGoblins(), goblinBody(), H).some((r) => r.tag.startsWith("scales:")))
    .toBe(false);
});

/** A CARD THAT IS NOT ONE OF THEM IS NOT COUNTED, which is the whole gate: this reads the
 *  PRODUCER'S PRINTED CHARACTERISTICS, not anything it does. */
test("a card of another subtype is not counted", () => {
  expect(directedReasons(base("Llanowar Elves", [], ["elf"]), countsGoblins(), H)
    .some((r) => r.tag.startsWith("scales:"))).toBe(false);
});

/** A BARE CARD TYPE FORMS NOTHING, and this is the rule that keeps the channel from being a mesh.
 *  "Creatures you control" is satisfied by every creature in the deck, which is 40 edges saying the
 *  same nothing -- the engine's own "playing Magic is not a synergy" rule. 685 battlefield counts
 *  are derived and only the 248 that name a SUBTYPE may form an edge. */
test("a count of a bare card type forms no edge", () => {
  const countsCreatures = base("Axebane Guardian", [{
    kind: "activated", cost: "{T}",
    effect: {
      kind: "add-mana", scaling: "per-creature",
      scalingSubject: { type: "creature", zone: "battlefield", control: "you", token: null },
    },
  }] as unknown as CardTags["abilities"]);
  expect(directedReasons(goblinBody(), countsCreatures, H).some((r) => r.tag.startsWith("scales:")))
    .toBe(false);
});

/** A BASIC LAND TYPE IS THE MANA BASE, NOT A SYNERGY. 20 corpus cards count Swamps and 13 count
 *  Mountains; a mono-black deck runs 30 Swamps, and 30 edges from lands to one payoff is the same
 *  mesh in a different costume. */
test("a count of a basic land type forms no edge", () => {
  const countsSwamps = base("Cabal Coffers", [{
    kind: "activated", cost: "{2}, {T}",
    effect: {
      kind: "add-mana", scaling: "per-permanent",
      scalingSubject: { subtype: "swamp", zone: "battlefield", control: "you", token: null },
    },
  }] as unknown as CardTags["abilities"]);
  expect(directedReasons(base("Swamp", [], ["swamp"]), countsSwamps, H)
    .some((r) => r.tag.startsWith("scales:"))).toBe(false);
});

/** AN OPPONENT'S BOARD IS NOT FED BY YOUR CARD. "Creatures your opponents control" counts THEIR
 *  side, and a deckmate cannot add to it. */
test("a count of what an opponent controls forms no edge", () => {
  const countsTheirs = base("Opponent Counter", [{
    kind: "static",
    effect: {
      kind: "pump", scaling: "per-permanent",
      scalingSubject: { subtype: "goblin", zone: "battlefield", control: "opp", token: null },
    },
  }] as unknown as CardTags["abilities"]);
  expect(directedReasons(goblinBody(), countsTheirs, H).some((r) => r.tag.startsWith("scales:")))
    .toBe(false);
});

// KARDUR, DOOMSCOURGE <-> BLASPHEMOUS EDICT (owner, 2026-09-05). "Whenever an attacking creature
// dies" is not "whenever a creature dies": an edict at sorcery speed kills nothing that is
// attacking. The trigger now carries `combat: "attacking"`, and only a producer whose printed text
// names an attacking creature can meet it.
test("a dies trigger on an attacking creature refuses a plain sacrifice and accepts a combat-scoped death", () => {
  const kardur = base("Kardur", [{
    kind: "triggered",
    trigger: { verbs: ["dies"], subject: { control: "any", token: null, type: "creature", combat: "attacking" } },
    effect: { kind: "player-life-loss", subject: { control: "opp", token: null, scope: "each" } },
  }]);
  const edict = base("Edict", [{
    kind: "on-cast", effect: { kind: "" },
    emits: [{ verb: "dies", subject: { control: "any", token: null, type: "creature", scope: "all" } }],
  }]);
  const settle = base("Settle", [{
    kind: "on-cast", effect: { kind: "" },
    emits: [{ verb: "dies", subject: { control: "any", token: null, type: "creature", scope: "all", combat: "attacking" } }],
  }]);
  expect(pairReasons(edict, kardur, H)).toEqual([]);
  expect(pairReasons(settle, kardur, H).map((r) => r.tag)).toEqual(["dies:creature"]);
});

// ...and an INSTANT-SPEED producer meets it without naming the state: Ayara's sac outlet can eat an
// attacking creature in combat (owner ruling, upheld 2026-08-22), the panel's one REAL claim on a
// combat-state consumer, and the claim the first cut of this gate deleted.
test("an instant-speed death satisfies an attacking-creature dies trigger", () => {
  const kardur = base("Kardur", [{
    kind: "triggered",
    trigger: { verbs: ["dies"], subject: { control: "any", token: null, type: "creature", combat: "attacking" } },
    effect: { kind: "player-life-loss", subject: { control: "opp", token: null, scope: "each" } },
  }]);
  const ayara = base("Ayara", [{
    kind: "activated", effect: { kind: "draw-card" }, cost: "{T}, Sacrifice another black creature",
    emits: [{ verb: "dies", subject: { control: "you", token: null, type: "creature" }, instantSpeed: true }],
  }]);
  expect(pairReasons(ayara, kardur, H).map((r) => r.tag)).toEqual(["dies:creature"]);
  // ...but not when the OPPONENT picks: an instant-speed edict lets them spare the attacker.
  // Liliana's Triumph and Szat's Will -> Death Tyrant, owner-judged FALSE on the panel.
  const triumph = base("Triumph", [{
    kind: "on-cast", effect: { kind: "" },
    emits: [{ verb: "dies", subject: { control: "opp", token: null, type: "creature", scope: "each" }, instantSpeed: true }],
  }]);
  expect(pairReasons(triumph, kardur, H)).toEqual([]);
  // A targeted kill at instant speed aims at the attacker and counts.
  const downfall = base("Downfall", [{
    kind: "on-cast", effect: { kind: "" },
    emits: [{ verb: "dies", subject: { control: "opp", token: null, type: "creature", scope: "target" }, instantSpeed: true }],
  }]);
  expect(pairReasons(downfall, kardur, H).map((r) => r.tag)).toEqual(["dies:creature"]);
});

// BLOODCHIEF ASCENSION'S PRODUCER LIST READ LIKE A LIST OF CARDS DYING (owner, 2026-09-05): "When
// Syr Konrad, the Grim hits the graveyard" for Konrad's "each player mills a card". A fill that is
// not `self` is something the producer DOES to other cards; the sentence names those cards.
test("a graveyard fill that is not the card itself is worded about the cards it fills with", () => {
  const ascension = base("Ascension", [{
    kind: "triggered",
    trigger: { verbs: ["enters-graveyard"], subject: { control: "opp", token: null } },
    effect: { kind: "player-life-loss", subject: { control: "opp", token: null } },
  }]);
  const konrad = base("Konrad", [{
    kind: "activated", effect: { kind: "top-manipulation" },
    emits: [{ verb: "mill", subject: { control: "any", token: null, scope: "each" } }],
  }]);
  expect(pairReasons(konrad, ascension, H).map((r) => r.text)).toEqual([
    "When a card hits the graveyard thanks to Konrad, Ascension costs each opponent life",
  ].map((t) => expect.stringContaining("When a card hits the graveyard thanks to Konrad")));
  const outlet = base("Outlet", [{
    kind: "activated", effect: { kind: "" },
    emits: [{ verb: "dies", subject: { control: "any", token: null, type: "creature" } }],
  }]);
  expect(pairReasons(outlet, ascension, H).map((r) => r.text)[0]).toContain("When a creature hits the graveyard thanks to Outlet");
  // A card's OWN trip to the graveyard keeps its name (against a payoff that watches any graveyard;
  // Ascension watches an opponent's, and your own sacrifice is not that).
  const anyYard = base("Yard", [{
    kind: "triggered",
    trigger: { verbs: ["enters-graveyard"], subject: { control: "any", token: null } },
    effect: { kind: "draw-card", subject: { control: "you", token: null } },
  }]);
  const selfSac = base("Fodder", [{
    kind: "activated", effect: { kind: "" },
    emits: [{ verb: "dies", subject: { control: "you", token: null, type: "creature", self: true } }],
  }]);
  expect(pairReasons(selfSac, anyYard, H).map((r) => r.text)[0]).toContain("When Fodder hits the graveyard");
});
