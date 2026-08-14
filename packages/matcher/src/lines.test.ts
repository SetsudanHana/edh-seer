import { describe, expect, test } from "vitest";
import { classifyGrowth, detectLines, iterationsNeeded } from "./lines.js";
import { loadHierarchy } from "./hierarchy.js";
import type { DeckCard } from "./types.js";

const hierarchy = loadHierarchy();
/** `detectLines` returns `{ lines, refusals }` (a tally lives alongside the lines, design §7). Most
 *  tests only care about the lines, so this trims the boilerplate at every call site. */
const linesOf = (deck: readonly DeckCard[]) => detectLines(deck, hierarchy).lines;

describe("classifyGrowth", () => {
  // The measured multiplicative family is TINY and fully enumerable: "double" x7, "triple" x2,
  // "twice" x1, "double the number of" x1, "twice that many" x1 out of 2,169 amounts / 310 values.
  test("reads the whole multiplicative lexicon", () => {
    expect(classifyGrowth("double")).toEqual({ kind: "multiplicative", factor: 2 });
    expect(classifyGrowth("Double the number of")).toEqual({ kind: "multiplicative", factor: 2 });
    expect(classifyGrowth("twice that many")).toEqual({ kind: "multiplicative", factor: 2 });
    expect(classifyGrowth("triple")).toEqual({ kind: "multiplicative", factor: 3 });
  });

  // THE FALSE FRIEND, measured in the corpus: "double strike" appears as an `amount` and is a
  // KEYWORD, not a multiplier. Same shape as the thousands-separator bug in the resource ledger.
  test("`double strike` is a keyword, not a multiplier", () => {
    expect(classifyGrowth("double strike")).toEqual({ kind: "unknown" });
  });

  // Shrinking multipliers are not growth toward a threshold. 5 corpus instances.
  test("halving is not growth", () => {
    expect(classifyGrowth("half their life, rounded up")).toEqual({ kind: "unknown" });
    expect(classifyGrowth("half x, rounded down")).toEqual({ kind: "unknown" });
  });

  test("integers are additive, including with a thousands separator", () => {
    expect(classifyGrowth("1")).toEqual({ kind: "additive", step: 1 });
    expect(classifyGrowth("3")).toEqual({ kind: "additive", step: 3 });
    expect(classifyGrowth("1,000")).toEqual({ kind: "additive", step: 1000 });
  });

  test("word numerals are additive", () => {
    expect(classifyGrowth("two")).toEqual({ kind: "additive", step: 2 });
  });

  // 106 abilities carry "x"; 45 carry "that many"/"that much". Refused, never defaulted.
  test("unstated quantities are unknown, not 1", () => {
    expect(classifyGrowth("x")).toEqual({ kind: "unknown" });
    expect(classifyGrowth("that many")).toEqual({ kind: "unknown" });
    expect(classifyGrowth("that much")).toEqual({ kind: "unknown" });
    expect(classifyGrowth(undefined)).toEqual({ kind: "unknown" });
  });

  // A pump amount is a stat change, not a count of a resource.
  test("a P/T amount is not a growth step", () => {
    expect(classifyGrowth("+1/+1")).toEqual({ kind: "unknown" });
    expect(classifyGrowth("-1/-1")).toEqual({ kind: "unknown" });
  });
});

describe("iterationsNeeded", () => {
  // The headline witness. 1,000 time counters doubling from a pessimistic base of 1 is TEN
  // activations -- which is why telling multiplicative from additive is the whole point.
  test("Calendar: 1,000 at x2 from base 1 is 10", () => {
    expect(iterationsNeeded(1000, { kind: "multiplicative", factor: 2 }, 1)).toBe(10);
  });

  // The additive control. 20 growth counters at +1 is 20 fires, and no amount of untapping shortens
  // it. A classifier that ever collapsed the two would fail here.
  test("Simic Ascendancy: 20 at +1 is 20", () => {
    expect(iterationsNeeded(20, { kind: "additive", step: 1 }, 0)).toBe(20);
  });

  test("a base already past the threshold needs no iterations", () => {
    expect(iterationsNeeded(20, { kind: "additive", step: 1 }, 20)).toBe(0);
  });

  test("unknown growth yields no number, rather than a guess", () => {
    expect(iterationsNeeded(1000, { kind: "unknown" }, 1)).toBeUndefined();
  });

  // A multiplicative model needs something to multiply. Zero never grows.
  test("a multiplicative line from base 0 is refused", () => {
    expect(iterationsNeeded(1000, { kind: "multiplicative", factor: 2 }, 0)).toBeUndefined();
  });

  // Factor 3 is IEEE-754-unfriendly: log(9)/log(3) is 2.0000000000000004, not exactly 2, and a bare
  // ceil overcounts by one at every exact power. "triple" is a real 2-instance corpus member, so a
  // silently-wrong iteration count here is exactly the failure mode this file exists to refuse.
  test("factor 3 exact powers do not overcount", () => {
    expect(iterationsNeeded(9, { kind: "multiplicative", factor: 3 }, 1)).toBe(2);
    expect(iterationsNeeded(27, { kind: "multiplicative", factor: 3 }, 1)).toBe(3);
    expect(iterationsNeeded(81, { kind: "multiplicative", factor: 3 }, 1)).toBe(4);
  });

  // A non-power proves the float-snap doesn't over-round: 3^2=9 < 10 <= 3^3=27, so 3 iterations,
  // not 2.
  test("factor 3 non-power still rounds up correctly", () => {
    expect(iterationsNeeded(10, { kind: "multiplicative", factor: 3 }, 1)).toBe(3);
  });

  // Factor 2 exact powers are the ones the brief's spot-checks already covered and must not regress.
  test("factor 2 exact powers are unaffected", () => {
    expect(iterationsNeeded(8, { kind: "multiplicative", factor: 2 }, 1)).toBe(3);
    expect(iterationsNeeded(1024, { kind: "multiplicative", factor: 2 }, 1)).toBe(10);
  });

  // The headline witness, re-asserted after the fix.
  test("Calendar still holds after the fix", () => {
    expect(iterationsNeeded(1000, { kind: "multiplicative", factor: 2 }, 1)).toBe(10);
  });

  // A non-1 base landing exactly on a power: 3^2 x 3 = 27.
  test("a non-1 base at an exact power", () => {
    expect(iterationsNeeded(27, { kind: "multiplicative", factor: 3 }, 3)).toBe(2);
  });
});

describe("detectLines", () => {
  /** Built from the REAL derived document for The Millennium Calendar at DERIVE_VERSION 38, read off
   *  the corpus, not from memory. Trimmed to the fields the detector reads. */
  const calendar = {
    card: { name: "The Millennium Calendar" },
    tags: {
      characteristics: { types: ["artifact"], subtypes: [] },
      abilities: [
        { kind: "triggered", effect: { kind: "counter-placement", subject: { control: "any", token: null } },
          trigger: { verbs: ["untaps"], subject: { control: "you", token: null, type: "permanent", scope: "all" } },
          amount: "that many",
          emits: [{ verb: "counter-added", subject: { control: "any", token: null, counter: "time" } }],
          repeats: "repeatable" },
        { kind: "activated", effect: { kind: "pump", subject: { control: "any", token: null, counter: "time" } },
          cost: "{2}, {T}", amount: "double", repeats: "per-cycle" },
        { kind: "triggered", effect: { kind: "" },
          trigger: { verbs: ["counter-added"], subject: { control: "you", token: null, counter: "time" }, threshold: { atLeast: 1000 } },
          emits: [{ verb: "sacrifice", subject: { control: "any", token: null, self: true } }] },
        { kind: "triggered", effect: { kind: "player-life-loss", subject: { control: "opp", token: null, scope: "each" } },
          trigger: { verbs: ["counter-added"], subject: { control: "you", token: null, counter: "time" }, threshold: { atLeast: 1000 } },
          amount: "1,000",
          emits: [{ verb: "lose-life", subject: { control: "opp", token: null, scope: "each" } }] },
      ],
    },
  } as unknown as DeckCard;

  const gogo = {
    card: { name: "Gogo, Master of Mimicry" },
    tags: {
      characteristics: { types: ["creature"], subtypes: [] },
      abilities: [{ kind: "activated", effect: { kind: "clone", scaling: "x-cost" }, cost: "{X}{X}, {T}", amount: "X", repeats: "per-cycle" }],
    },
  } as unknown as DeckCard;

  test("Calendar alone yields one line, x2 growth, 10 iterations, a life-loss terminal", () => {
    const lines = linesOf([calendar]);
    expect(lines).toHaveLength(1);
    const [l] = lines;
    expect(l.anchor).toBe("The Millennium Calendar");
    expect(l.resource).toEqual({ kind: "counter", name: "time" });
    expect(l.threshold).toBe(1000);
    expect(l.growth).toBe("multiplicative");
    expect(l.iterations).toBe(10);
    // The anchor ability ([2]) has a blank effect kind; the terminal comes from its SIBLING ([3])
    // sharing the same trigger object -- the per-clause shared trigger ceiling, worked around.
    expect(l.terminal).toBe("player-life-loss");
    // Base is unstated ("that many"), so 1 is assumed and SAID, making 10 an upper bound.
    expect(l.refusals).toContain("assumed-base-1");
  });

  test("two abilities sharing one threshold trigger produce ONE line, not two", () => {
    expect(linesOf([calendar])).toHaveLength(1);
  });

  test("Gogo joins the piece set as unproven copy supply", () => {
    const [l] = linesOf([calendar, gogo]);
    const g = l.pieces.find((p) => p.card === "Gogo, Master of Mimicry");
    expect(g).toBeDefined();
    expect(g!.role).toBe("copy");
    // No SubjectFilter can name an ability (sub-project B3), so the detector cannot prove Gogo copies
    // THIS ability. Named with the claim marked unproven beats dropping the owner's own combo piece.
    expect(g!.unproven).toBe(true);
  });

  test("a deck with no threshold anchor yields no lines", () => {
    expect(linesOf([gogo])).toEqual([]);
  });

  test("an anchor whose resource cannot be named is refused, not emitted blank", () => {
    const anchorless = {
      card: { name: "Test Anchor" },
      tags: { characteristics: { types: ["enchantment"], subtypes: [] }, abilities: [
        { kind: "triggered", effect: { kind: "draw-card" },
          trigger: { verbs: ["upkeep"], subject: { control: "you", token: null }, threshold: { atLeast: 5 } } },
      ] },
    } as unknown as DeckCard;
    const result = detectLines([anchorless], hierarchy);
    expect(result.lines).toEqual([]);
    expect(result.refusals["no-resource"]).toBe(1);
  });

  // Design §6.1/§7: a refused anchor is TALLIED, not just dropped, so a caller can report "N lines
  // refused for no-resource" without re-implementing `resourceOf` outside this file. Real corpus
  // witness, read off cardTagsDerived at DERIVE_VERSION 39, not from memory: Golbez, Crystal
  // Collector's two threshold abilities (return at 4 artifacts, life loss at 4 artifacts) share one
  // trigger whose subject is bare `{control:"you", token:null}` -- the "how many" (artifacts seen)
  // is never encoded as a counter/type/subtype on the trigger itself, so the resource genuinely
  // cannot be named. One shared trigger -> one tally increment, not two.
  const golbez = {
    card: { name: "Golbez, Crystal Collector" },
    tags: {
      characteristics: { types: ["legendary", "creature"], subtypes: ["human", "wizard"] },
      abilities: [
        { kind: "triggered", effect: { kind: "top-manipulation", subject: { control: "any", token: null } },
          trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "artifact" } },
          repeats: "repeatable" },
        { kind: "triggered",
          effect: { kind: "graveyard-recursion", subject: { control: "you", token: null, type: "creature", scope: "target", zone: "graveyard" } },
          trigger: { verbs: ["end-step"], subject: { control: "you", token: null }, threshold: { atLeast: 4 } },
          repeats: "per-cycle" },
        { kind: "triggered", effect: { kind: "player-life-loss", subject: { control: "opp", token: null, scope: "each" } },
          trigger: { verbs: ["end-step"], subject: { control: "you", token: null }, threshold: { atLeast: 4 } },
          amount: "that card's power",
          emits: [{ verb: "lose-life", subject: { control: "opp", token: null, scope: "each" } }],
          repeats: "per-cycle" },
      ],
    },
  } as unknown as DeckCard;

  test("Golbez, Crystal Collector: a real no-resource anchor is refused and tallied once", () => {
    const result = detectLines([golbez], hierarchy);
    expect(result.lines).toEqual([]);
    expect(result.refusals["no-resource"]).toBe(1);
  });

  // CORRECTION to the brief's SUPPLY_ROLE table (owner's ruling, 2026-08-14): only an `extra-phase`
  // that itself carries an untap step is activation supply. Sphinx of the Second Sun's additional
  // BEGINNING phase does; The Ninth Doctor's additional UPKEEP step does not, however supply-shaped
  // it looks ("whenever The Ninth Doctor becomes untapped during your untap step, you get an
  // additional upkeep step after this step" -- the trigger is untap-shaped, the payout is not).
  const sphinx = {
    card: { name: "Sphinx of the Second Sun" },
    tags: {
      characteristics: { types: ["creature"], subtypes: [] },
      abilities: [
        { kind: "triggered", effect: { kind: "extra-phase", subject: { control: "you", token: null, phase: "beginning" } },
          trigger: { verbs: ["upkeep"], subject: { control: "you", token: null } } },
      ],
    },
  } as unknown as DeckCard;

  const ninthDoctor = {
    card: { name: "The Ninth Doctor" },
    tags: {
      characteristics: { types: ["creature"], subtypes: [] },
      abilities: [
        { kind: "triggered", effect: { kind: "extra-phase", subject: { control: "you", token: null, phase: "upkeep" } },
          trigger: { verbs: ["untaps"], subject: { control: "self", token: null } } },
      ],
    },
  } as unknown as DeckCard;

  test("Sphinx's additional BEGINNING phase is activation supply, recorded with its phase", () => {
    const [l] = linesOf([calendar, sphinx]);
    const p = l.pieces.find((piece) => piece.card === "Sphinx of the Second Sun");
    expect(p).toEqual({ card: "Sphinx of the Second Sun", role: "extra-phase", phase: "beginning" });
  });

  test("The Ninth Doctor's additional UPKEEP step is NOT activation supply", () => {
    const [l] = linesOf([calendar, ninthDoctor]);
    expect(l.pieces.find((piece) => piece.card === "The Ninth Doctor")).toBeUndefined();
  });

  // "This land enters tapped. {T}: Add {C}. Whenever this land or another land you control enters,
  // if you control seven or more lands with different names, create a 2/2 black Zombie creature
  // token." Real derived doc, DERIVE_VERSION 39 -- trimmed to the two abilities the detector reads.
  const fieldOfTheDead = {
    card: { name: "Field of the Dead" },
    tags: {
      characteristics: { types: ["land"], subtypes: [] },
      abilities: [
        { kind: "activated", effect: { kind: "mana-generation", subject: { control: "any", token: null } }, cost: "{T}", repeats: "per-cycle" },
        { kind: "triggered", effect: { kind: "token-generation", subject: { control: "any", token: true, colors: ["B"], type: "creature", subtype: "zombie" } },
          trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "land" }, threshold: { atLeast: 7 } },
          amount: "1",
          emits: [{ verb: "create-token", subject: { control: "any", token: true, colors: ["B"], type: "creature", subtype: "zombie" } }, { verb: "enters", subject: { control: "any", token: true, colors: ["B"], type: "creature", subtype: "zombie" } }],
          repeats: "repeatable" },
      ],
    },
  } as unknown as DeckCard;

  // "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the
  // battlefield tapped, then shuffle. Then if you control four or more lands, untap that land."
  // Real derived doc, DERIVE_VERSION 39 -- the fourth ability (`untap` kind) is the false activation
  // supply finding 3 exists to gate; the third ability's `enters` emit is the genuine land supply.
  const fabledPassage = {
    card: { name: "Fabled Passage" },
    tags: {
      characteristics: { types: ["land"], subtypes: [] },
      abilities: [
        { kind: "activated", effect: { kind: "" }, cost: "{T}, Sacrifice this land",
          emits: [{ verb: "sacrifice", subject: { control: "any", token: null, type: "land", self: true } }, { verb: "dies", subject: { control: "any", token: null, type: "land", self: true } }],
          repeats: "once" },
        { kind: "activated", effect: { kind: "top-manipulation", subject: { control: "any", token: null, basic: true, type: "land" } },
          cost: "{T}, Sacrifice this land", repeats: "once" },
        { kind: "activated", effect: { kind: "" }, cost: "{T}, Sacrifice this land",
          emits: [{ verb: "enters", subject: { control: "any", token: null, basic: true, type: "land" } }], repeats: "once" },
        { kind: "activated", effect: { kind: "untap", subject: { control: "any", token: null, type: "land" } },
          cost: "{T}, Sacrifice this land",
          emits: [{ verb: "untaps", subject: { control: "any", token: null, type: "land" } }], repeats: "once" },
      ],
    },
  } as unknown as DeckCard;

  // FINDING 1 (2026-08-14 final review): `resourceOf` must only read a trigger's type/subtype as the
  // threshold's resource when the trigger is a ZONE EVENT (design §6.1 rule 2). Real corpus witnesses,
  // read off cardTagsDerived at DERIVE_VERSION 39, not from memory.
  describe("finding 1: resource requires a zone-event trigger", () => {
    // "Whenever this creature attacks, if you control eight or more lands, this creature becomes
    // prepared." The trigger's subject carries `type:"creature"` (it's naming the attacker), but the
    // printed threshold counts LANDS, not creatures -- `attacks` is not a zone event, and reading the
    // subject's type here derives a confidently wrong resource.
    const emeritusOfAbundance = {
      card: { name: "Emeritus of Abundance // Regrowth" },
      tags: {
        characteristics: { types: ["creature", "sorcery"], subtypes: ["elf", "druid"] },
        abilities: [
          { kind: "triggered", effect: { kind: "" },
            trigger: { verbs: ["attacks"], subject: { control: "you", token: null, type: "creature", self: true }, threshold: { atLeast: 8 } },
            repeats: "per-cycle" },
        ],
      },
    } as unknown as DeckCard;

    // "Threshold -- Whenever you attack with one or more Rats, if there are seven or more cards in
    // your graveyard, ..." The trigger's subject carries `subtype:"rat"`, but the printed threshold
    // counts CARDS IN GRAVEYARD. Same shape, a different non-zone-event verb (`attacks`).
    const persistentMarshstalker = {
      card: { name: "Persistent Marshstalker" },
      tags: {
        characteristics: { types: ["creature"], subtypes: ["rat", "berserker"] },
        abilities: [
          { kind: "triggered",
            effect: { kind: "graveyard-recursion", subject: { control: "you", token: null, self: true, zone: "graveyard" } },
            trigger: { verbs: ["attacks"], subject: { control: "you", token: null, subtype: "rat", scope: "all" }, threshold: { atLeast: 7 } },
            emits: [{ verb: "enters", subject: { control: "any", token: null, fromZone: "graveyard", self: true } }],
            repeats: "repeatable" },
        ],
      },
    } as unknown as DeckCard;

    test("Emeritus of Abundance: an attacks-trigger type is refused, not read as the resource", () => {
      const result = detectLines([emeritusOfAbundance], hierarchy);
      expect(result.lines).toEqual([]);
      expect(result.refusals["no-resource"]).toBe(1);
    });

    test("Persistent Marshstalker: an attacks-trigger subtype is refused, not read as the resource", () => {
      const result = detectLines([persistentMarshstalker], hierarchy);
      expect(result.lines).toEqual([]);
      expect(result.refusals["no-resource"]).toBe(1);
    });

    // Field of the Dead is the positive control: "Whenever this land or another land you control
    // enters, if you control seven or more lands..." -- `enters` genuinely IS a zone event, so the
    // resource is correctly read as `type:land`. This must keep working after the fix.
    test("Field of the Dead: an enters-trigger type is still read as the resource", () => {
      const [l] = linesOf([fieldOfTheDead]);
      expect(l.resource).toEqual({ kind: "type", name: "land" });
    });
  });

  // FINDING 2 (2026-08-14 final review): `actsOnResource`'s TYPE branch must also ask whether the
  // effect kind can plausibly grow a COUNT -- a `pump` or `damage` effect naming the resource's type
  // is not an amplifier just because it mentions the type. Real corpus witnesses.
  describe("finding 2: a type-resource amplifier must grow a count, not just name a type", () => {
    // A synthetic anchor -- no real corpus card runs a threshold off a zone-event `type:creature`
    // trigger (the only two zone-event anchors in the whole derived corpus are Field of the Dead and
    // Valakut, both lands) -- paired with the REAL amplifier abilities under test.
    const creatureZoneAnchor = {
      card: { name: "Test Creature Anchor" },
      tags: { characteristics: { types: ["enchantment"], subtypes: [] }, abilities: [
        { kind: "triggered", effect: { kind: "draw-card" },
          trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "creature" }, threshold: { atLeast: 5 } } },
      ] },
    } as unknown as DeckCard;

    // "If a creature you control would deal damage to a permanent or player, it deals double that
    // damage instead." A `pump{type:creature}, amount "double"` -- it doubles DAMAGE, not the number
    // of creatures.
    const gratuitousViolence = {
      card: { name: "Gratuitous Violence" },
      tags: { characteristics: { types: ["enchantment"], subtypes: [] }, abilities: [
        { kind: "static", effect: { kind: "pump", subject: { control: "you", token: null, type: "creature", scope: "all" } },
          amount: "double", repeats: "continuous" },
      ] },
    } as unknown as DeckCard;

    // "...it deals damage equal to twice the number of Vehicles you control to target creature or
    // planeswalker an opponent controls." A `damage{type:[creature,planeswalker]}` amount "twice the
    // number of Vehicles" -- it deals DAMAGE, not a count of creatures/planeswalkers.
    const surgehackerMech = {
      card: { name: "Surgehacker Mech" },
      tags: { characteristics: { types: ["artifact"], subtypes: ["vehicle"] }, abilities: [
        { kind: "triggered", effect: { kind: "damage", subject: { control: "opp", token: null, type: ["creature", "planeswalker"], scope: "target" }, scaling: "per-creature" },
          trigger: { verbs: ["enters"], subject: { control: "you", token: null, self: true } },
          amount: "twice the number of Vehicles you control",
          emits: [{ verb: "non-combat-damage", subject: { control: "opp", token: null, type: ["creature", "planeswalker"], scope: "target" } }],
          repeats: "once" },
      ] },
    } as unknown as DeckCard;

    test("Gratuitous Violence is not read as a creature-count amplifier", () => {
      const [l] = linesOf([creatureZoneAnchor, gratuitousViolence]);
      expect(l.growth).not.toBe("multiplicative");
      expect(l.pieces.find((p) => p.card === "Gratuitous Violence")).toBeUndefined();
    });

    test("Surgehacker Mech is not read as a creature-count amplifier", () => {
      const [l] = linesOf([creatureZoneAnchor, surgehackerMech]);
      expect(l.growth).not.toBe("multiplicative");
      expect(l.pieces.find((p) => p.card === "Surgehacker Mech")).toBeUndefined();
    });
  });

  // FINDING 3 (2026-08-14 final review): `needsUntap` must actually gate untap-shaped activation
  // supply, not just sit computed and unread. Real corpus witness -- Field of the Dead's trigger has
  // no amplifier (growth is additive-shaped from suppliers, not a repeated {T} activation), so the
  // line needs no untap step, and Fabled Passage's `untap` role must not enter the piece set even
  // though the card is a real (and correctly included) LAND SUPPLIER for this line.
  test("Fabled Passage supplies Field of the Dead's lands but brings no untap piece", () => {
    const [l] = linesOf([fieldOfTheDead, fabledPassage]);
    expect(l.needsUntap).toBe(false);
    const fabledPassagePieces = l.pieces.filter((p) => p.card === "Fabled Passage");
    expect(fabledPassagePieces).toEqual([{ card: "Fabled Passage", role: "supplier" }]);
    expect(l.pieces.some((p) => p.role === "untap")).toBe(false);
  });

  // Calendar's amplifier DOES cost `{2}, {T}` -- needsUntap must still gate IN a real untap supplier
  // when the line actually needs one. Re-asserted here as the counterpart to the Field-of-the-Dead
  // negative case above, using the same Sphinx fixture finding 3 must not regress.
  test("needsUntap gates a real untap supplier IN when the line needs one", () => {
    const [l] = linesOf([calendar, sphinx]);
    expect(l.needsUntap).toBe(true);
    expect(l.pieces.some((p) => p.card === "Sphinx of the Second Sun" && p.role === "extra-phase")).toBe(true);
  });
});
