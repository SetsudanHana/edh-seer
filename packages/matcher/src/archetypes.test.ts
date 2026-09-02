import { expect, test } from "vitest";
import { detectArchetypes, dominantArchetype, type CardSignal } from "./archetypes.js";

const sig = (name: string, opts: {
  themeTags?: string[]; effectKinds?: string[]; subtypes?: string[]; cardTypes?: string[];
  tokenKinds?: string[];
}): CardSignal => ({
  name,
  themeTags: opts.themeTags ?? [],
  effectKinds: opts.effectKinds ?? [],
  subtypes: opts.subtypes ?? [],
  ...(opts.cardTypes ? { cardTypes: opts.cardTypes } : {}),
  ...(opts.tokenKinds ? { tokenKinds: opts.tokenKinds } : {}),
});

test("a card with its own token-generation effect kind maps to tokens as primary", () => {
  const signals = [sig("A", { effectKinds: ["token-generation"] })];
  const out = detectArchetypes(signals, [], 12);
  expect(out[0].name).toBe("tokens");
  expect(out[0].label).toBe("Tokens");
  expect(out[0].confidence).toBeCloseTo(1 / 12, 5);
});

test("a card whose only effect kind is the broad, excluded 'damage' kind contributes to no archetype", () => {
  // damage was excluded from every ARCHETYPE_SIGNATURE entry deliberately (it used to mesh
  // aristocrats/tokens/spellslinger/attack-matters together via CATEGORY_MATCH). A card with
  // no other signal must fall through to the goodstuff fallback, proving the exclusion holds.
  const signals = [sig("A", { effectKinds: ["damage"] })];
  const out = detectArchetypes(signals, [], 12);
  expect(out).toEqual([{ name: "goodstuff", label: "Goodstuff / Midrange", confidence: 0 }]);
});

test("aristocrats keys on dies:/sacrifice: events and drain; unrelated cards do not", () => {
  const signals = [
    sig("Death payoff", { themeTags: ["dies:creature"] }),        // Grim Haruspex shape
    sig("Sac-token payoff", { themeTags: ["sacrifice:token"] }),  // Mirkwood Bats shape
    sig("Sac-any payoff", { themeTags: ["sacrifice:permanent"] }),// Mayhem Devil shape
    sig("Drainer", { effectKinds: ["drain"] }),                   // non-death drain
    sig("Unrelated", { themeTags: ["enters:creature"], effectKinds: ["draw-card"] }),
  ];
  const out = detectArchetypes(signals, [], 12);
  const aristo = out.find((r) => r.name === "aristocrats");
  expect(aristo?.confidence).toBeCloseTo(4 / 12, 5); // 4 of 5 match; "Unrelated" does not
});

test("prefix signature tag matches by prefix, not exact", () => {
  expect(detectArchetypes([sig("A", { themeTags: ["dies:creature"] })], [], 12).some((r) => r.name === "aristocrats")).toBe(true);
  expect(detectArchetypes([sig("B", { themeTags: ["enters:creature"] })], [], 12).some((r) => r.name === "aristocrats")).toBe(false);
});

test("ranks two archetypes above the floor by distinct-card count, descending", () => {
  const signals = [
    sig("A", { themeTags: ["dies:creature"] }),
    sig("B", { themeTags: ["dies:creature"] }),
    sig("C", { themeTags: ["dies:creature"] }),
    sig("D", { themeTags: ["dies:creature"] }),
    sig("E", { themeTags: ["dies:creature"] }),
    sig("F", { themeTags: ["dies:creature"] }), // 6 aristocrats cards
    sig("G", { themeTags: ["gain-life:any"] }),
    sig("H", { themeTags: ["gain-life:any"] }),
    sig("I", { themeTags: ["gain-life:any"] }),
    sig("J", { themeTags: ["gain-life:any"] }),
    sig("K", { themeTags: ["gain-life:any"] }), // 5 lifegain cards
  ];
  const out = detectArchetypes(signals, [], 50); // 6/50=0.12, 5/50=0.10, both clear the 0.08 floor
  expect(out.map((r) => r.name)).toEqual(["aristocrats", "lifegain"]);
  expect(out[0].confidence).toBeCloseTo(6 / 50, 5);
  expect(out[1].confidence).toBeCloseTo(5 / 50, 5);
});

test("combo with 2+ cards is included though its share is below the floor", () => {
  const out = detectArchetypes([], ["X", "Y"], 30); // 2/30 = 0.0667 < 0.08 floor
  expect(out.some((r) => r.name === "combo")).toBe(true);
  const combo = out.find((r) => r.name === "combo")!;
  expect(combo.confidence).toBeCloseTo(2 / 30, 5);
});

test("an archetype below the floor is dropped and the goodstuff fallback is returned", () => {
  const signals = [sig("A", { effectKinds: ["token-generation"] })];
  const out = detectArchetypes(signals, [], 99); // 1/99 < 0.08
  expect(out).toEqual([{ name: "goodstuff", label: "Goodstuff / Midrange", confidence: 0 }]);
});

test("empty inputs yield the goodstuff fallback", () => {
  expect(detectArchetypes([], [], 0)).toEqual([{ name: "goodstuff", label: "Goodstuff / Midrange", confidence: 0 }]);
});

test("a card matching two of an archetype's own kinds is only counted once (distinct-card dedup)", () => {
  // token-generation and token-doubling are both in the tokens signature; a single card
  // carrying both must not double-count toward the confidence denominator's numerator.
  const signals = [
    sig("A", { effectKinds: ["token-generation", "token-doubling"] }),
    sig("B", { effectKinds: ["token-generation"] }),
  ];
  const out = detectArchetypes(signals, [], 20);
  expect(out[0].name).toBe("tokens");
  expect(out[0].confidence).toBeCloseTo(2 / 20, 5); // 2 distinct cards, not 3 signal hits
});

test("a spellslinger card matches via the cast:instant theme TAG, not an effect kind", () => {
  const signals = [sig("A", { themeTags: ["cast:instant"] })];
  const out = detectArchetypes(signals, [], 12);
  expect(out[0].name).toBe("spellslinger");
  expect(out[0].confidence).toBeCloseTo(1 / 12, 5);
});

test("voltron: equipment and creature-auras map to voltron; unrelated does not", () => {
  const signals = [
    sig("Sword", { subtypes: ["equipment"] }),
    sig("Ethereal Armor", { subtypes: ["aura"] }),
    sig("Some Creature", { effectKinds: ["draw-card"] }),
  ];
  const out = detectArchetypes(signals, [], 12);
  const v = out.find((r) => r.name === "voltron");
  expect(v?.confidence).toBeCloseTo(2 / 12, 5); // Sword + Ethereal Armor, not Some Creature
});

test("a card with no voltron subtype is not voltron", () => {
  const out = detectArchetypes([sig("X", { themeTags: ["enters:creature"] })], [], 12);
  expect(out.some((r) => r.name === "voltron")).toBe(false);
});

// A CONDITION IS AN ARCHETYPE SIGNAL (owner, 2026-08-20). `cardThemeTags` carries a card's trigger
// verbs, so "whenever a creature dies" already reads as aristocrats — but Warlock Class triggers on
// the END STEP and names the deaths only in its intervening if ("at the beginning of your end step,
// if a creature died this turn"), so the payoff was invisible to every archetype. The tag arrives
// through `Ability.conditionCares`; `analyze.ts` unions it into the signal.
test("a card that pays off when creatures die is aristocrats, even if it causes none", () => {
  const endStepPayoff: CardSignal = {
    // What Warlock Class looks like WITHOUT the condition: an end-step trigger and a life-loss
    // effect, which names no death at all.
    name: "Warlock Class", themeTags: ["end-step:any", "lose-life:any"], effectKinds: ["player-life-loss"], subtypes: [],
  };
  const withCondition: CardSignal = { ...endStepPayoff, themeTags: [...endStepPayoff.themeTags, "dies:creature"] };
  const filler = (i: number): CardSignal => ({ name: `f${i}`, themeTags: [], effectKinds: [], subtypes: [] });
  const deck = (c: CardSignal) => detectArchetypes([c, ...Array.from({ length: 9 }, (_, i) => filler(i))], [], 10);

  expect(deck(endStepPayoff).map((a) => a.name)).not.toContain("aristocrats");
  expect(deck(withCondition).map((a) => a.name)).toContain("aristocrats");
});

// AN ARISTOCRATS DECK IS ITS PAYOFFS, NOT THE REMOVAL THAT HAPPENS TO EMIT A SACRIFICE
// (2026-08-21). MEASURED over the 71 calibration decks: 815 of the 974 aristocrats matches are
// supply-only against 159 cares-backed, and Aristocrats topped 28 decks including 4 the owner named
// "Control" -- decks with no Zulaport and no Blood Artist. Same lesson as `analyze.ts:590`'s Sorin
// defect, one layer up.
test("a card that only SUPPLIES a demand-defined archetype's signal counts at producer share", () => {
  const payoff: CardSignal = {
    name: "Zulaport Cutthroat", themeTags: ["dies:creature"], caresTags: ["dies:creature"],
    effectKinds: ["drain"], subtypes: [],
  };
  const removal: CardSignal = {
    name: "Bake into a Pie", themeTags: ["dies:creature"], caresTags: [], effectKinds: [], subtypes: [],
  };
  const full = detectArchetypes([payoff], [], 10).find((r) => r.name === "aristocrats")!;
  const supply = detectArchetypes([removal], [], 10).find((r) => r.name === "aristocrats");
  expect(full.confidence).toBeCloseTo(0.1, 5);
  // 0.35/10 = 0.035, under ARCHETYPE_FLOOR 0.08 -- one removal spell is not an aristocrats deck.
  expect(supply).toBeUndefined();
  const both = detectArchetypes([payoff, removal], [], 10).find((r) => r.name === "aristocrats")!;
  expect(both.confidence).toBeCloseTo(0.135, 5);
});

/** A caller that computes no demand side keeps the old all-supply behaviour, so the ~15 existing
 *  callers of `detectArchetypes` are unaffected until they opt in. */
test("an absent caresTags leaves a demand-defined archetype counting supply full", () => {
  const removal: CardSignal = { name: "Bake into a Pie", themeTags: ["dies:creature"], effectKinds: [], subtypes: [] };
  expect(detectArchetypes([removal], [], 10).find((r) => r.name === "aristocrats")!.confidence).toBeCloseTo(0.1, 5);
});

// MAKING A TREASURE IS RAMP, NOT A TOKENS DECK -- the same exclusion `wincon.ts` already applies to
// go-wide, whose own comment records that keying on token-generation alone made it the primary plan
// of 52 of 71 decks. MEASURED here: 227 of the 774 token matches are resource-only, 218 Treasure.
test("a maker of only resource tokens is not a Tokens card", () => {
  const treasure: CardSignal = {
    name: "Dockside Extortionist", themeTags: ["create-token:treasure"], effectKinds: ["token-generation"], subtypes: [],
  };
  const saprolings: CardSignal = {
    name: "Sprout Swarm", themeTags: ["create-token:saproling"], effectKinds: ["token-generation"], subtypes: [],
  };
  expect(detectArchetypes([treasure], [], 5).find((r) => r.name === "tokens")).toBeUndefined();
  expect(detectArchetypes([saprolings], [], 5).find((r) => r.name === "tokens")!.confidence).toBeCloseTo(0.2, 5);
  // A card whose kind fired on evidence with no `create-token:` tag is NOT excluded: silence is not
  // proof it makes a Treasure, and a silent exclusion is the wrong failure direction.
  const untagged: CardSignal = { name: "Unknown", themeTags: [], effectKinds: ["token-generation"], subtypes: [] };
  expect(detectArchetypes([untagged], [], 5).find((r) => r.name === "tokens")!.confidence).toBeCloseTo(0.2, 5);
});

// A NAMING LAYER MAY SAY "I DON'T KNOW" (roadmap A15). `detectArchetypes` always returns a top row,
// so a deck with no positive identity gets named whatever ranked second: cares-gating the
// aristocrats signature (A13) halved the false confidences on the six owner-named control decks and
// moved not one of their labels. `dominantArchetype` is the abstention the ranked list cannot make.
test("no archetype leads when the top confidence is under the floor", () => {
  const weak = [{ name: "aristocrats" as const, label: "Aristocrats", confidence: 0.2 }];
  const strong = [{ name: "aristocrats" as const, label: "Aristocrats", confidence: 0.32 }];
  expect(dominantArchetype(weak)).toBeUndefined();
  expect(dominantArchetype(strong)?.name).toBe("aristocrats");
  // Goodstuff is the "nothing matched" row and never names a deck, whatever its confidence.
  expect(dominantArchetype([{ name: "goodstuff", label: "Goodstuff / Midrange", confidence: 0.9 }])).toBeUndefined();
  expect(dominantArchetype([])).toBeUndefined();
});

// M1 (2026-08-25, owner-reported): SUPERFRIENDS IS A CARD TYPE COUNT AND NOTHING ELSE. Every other
// signature row keys on a MECHANISM, and this archetype has none — what makes a deck superfriends is
// that a third of it is planeswalkers. A 21-walker Chandra deck was labelled TOKENS.
test("a deck of planeswalkers is superfriends, and one or two walkers is not", () => {
  const walkers = Array.from({ length: 20 }, (_, i) => sig(`Chandra ${i}`, { cardTypes: ["legendary", "planeswalker"] }));
  const out = detectArchetypes(walkers, [], 64);
  expect(out[0].name).toBe("superfriends");
  expect(out[0].label).toBe("Superfriends");
  expect(out[0].confidence).toBeCloseTo(20 / 64, 5);

  // THE TRIPWIRE A11 REGISTERED. Every EDH deck runs a walker or two, and the existing
  // ARCHETYPE_FLOOR (0.08) is what keeps those out — measured over the 71 decks, planeswalkers per
  // deck are 0 on fifty, 1 on fourteen, 2 on five, then 18 and 21, so no new threshold was needed.
  const incidental = [
    sig("Lone Walker", { cardTypes: ["planeswalker"] }),
    sig("Second Walker", { cardTypes: ["planeswalker"] }),
    ...Array.from({ length: 8 }, (_, i) => sig(`Bear ${i}`, { effectKinds: ["token-generation"] })),
  ];
  expect(detectArchetypes(incidental, [], 64).map((r) => r.name)).not.toContain("superfriends");
});

// A TYPE-DEFINED ROW MUST NOT REACH A CARD WHOSE TYPES THE CALLER DID NOT COMPUTE. `cardTypes` is
// optional, and a signal without it matches no type row rather than matching every one.
test("a signal with no cardTypes matches no type-defined archetype", () => {
  const out = detectArchetypes(Array.from({ length: 20 }, (_, i) => sig(`X ${i}`, {})), [], 64);
  expect(out.map((r) => r.name)).not.toContain("superfriends");
});

/** T2b, owner on their own Enchantress deck: the archetype list led with "Tokens 18%".
 *
 *  The Tokens row matches on the EFFECT KIND `token-generation`, which says a token was made and
 *  cannot say what it was. The guard that drops resource tokens read only `create-token:<subtype>`
 *  theme tags -- and `Curse of Opulence`, `Shiny Impetus`, `An Offer You Can't Refuse` and
 *  `Charming Scoundrel` carry no such tag at all, so four Treasure-and-Gold makers voted the deck a
 *  Tokens deck. The identity was one field away: `ability.effect.subject.subtype`. */
test("a Treasure maker is not a Tokens deck, even with no create-token tag", () => {
  const signals = [
    sig("Curse of Opulence", { effectKinds: ["token-generation"], tokenKinds: ["gold"] }),
    sig("Shiny Impetus", { effectKinds: ["token-generation"], tokenKinds: ["treasure"] }),
  ];
  expect(detectArchetypes(signals, [], 10).some((r) => r.name === "tokens")).toBe(false);
});

/** EXCLUDING ONLY WHAT IT CAN NAME is the whole safety of this. Measured over the 71 calibration
 *  decks: of 477 token-generation abilities only 262 say `type: "creature"` outright, and the 166
 *  carrying a bare subtype are a real tribe as often as not -- thopter, servo, myr, construct. A
 *  "creature tokens only" rule would have silently dropped every one of those. */
test("a body still counts, whether the clause names the type or only the tribe", () => {
  const named = [sig("Aphemia", { effectKinds: ["token-generation"], tokenKinds: ["creature"] })];
  expect(detectArchetypes(named, [], 10)[0]!.name).toBe("tokens");

  const tribeOnly = [sig("Sai", { effectKinds: ["token-generation"], tokenKinds: ["thopter"] })];
  expect(detectArchetypes(tribeOnly, [], 10)[0]!.name).toBe("tokens");

  // And a card the clause layer could not read at all keeps its vote rather than being dropped on
  // evidence nobody has -- the documented direction of this guard since it was written.
  const unknown = [sig("Mystery", { effectKinds: ["token-generation"] })];
  expect(detectArchetypes(unknown, [], 10)[0]!.name).toBe("tokens");
});

/** A Role is an Aura the token layer attaches to a creature -- "Cursed Role" is a debuff you put on
 *  THEIRS -- and an Aura token is the same shape. Neither is a body. */
test("a Role or Aura token is not a go-wide plan", () => {
  const signals = [
    sig("Asinine Antics", { effectKinds: ["token-generation"], tokenKinds: ["role"] }),
    sig("The Rani", { effectKinds: ["token-generation"], tokenKinds: ["aura"] }),
  ];
  expect(detectArchetypes(signals, [], 10).some((r) => r.name === "tokens")).toBe(false);
});
