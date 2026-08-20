import { expect, test } from "vitest";
import { detectArchetypes, type CardSignal } from "./archetypes.js";

const sig = (name: string, opts: { themeTags?: string[]; effectKinds?: string[]; subtypes?: string[] }): CardSignal => ({
  name,
  themeTags: opts.themeTags ?? [],
  effectKinds: opts.effectKinds ?? [],
  subtypes: opts.subtypes ?? [],
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
