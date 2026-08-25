import { describe, expect, test } from "vitest";
import { manaModel } from "./goldfish.js";
import { computeDeckMath } from "./deck-math.js";
import type { Card } from "@mtg/engine";
import type { DeckCard } from "./types.js";

const card = (name: string, over: Partial<Card> = {}): DeckCard => ({
  card: {
    name, typeLine: "Creature — Human", oracleText: "", keywords: [], colors: [],
    manaValue: 6, manaCost: "{3}{R}{G}{W}", ...over,
  } as Card,
  tags: null,
});
// A Command Tower, not a Forest: the fixture commander costs {3}{R}{G}{W} and castability is
// COLOUR-AWARE now, so a mono-green land base correctly reads 0% and would make this test measure
// the fixture rather than the row. The mono-colour case is asserted on purpose below.
const land = (i: number) => card(`Land ${i}`, { typeLine: "Land", manaValue: 0, manaCost: undefined, producedMana: ["R", "G", "W"] });
const deckOf = (commander: DeckCard, lands = 37): DeckCard[] => [
  commander,
  ...Array.from({ length: lands }, (_, i) => land(i)),
  ...Array.from({ length: 99 - lands }, (_, i) => card(`Spell ${i}`, { manaValue: 3, manaCost: "{2}{G}" })),
];

describe("the commander's own castability row (K5)", () => {
  test("it is reported BY NAME, not left to the hardest-four list", () => {
    const cmd = card("Samut, the Driving Force");
    const deck = deckOf(cmd);
    // A COMMANDER IS NOT IN THE LIBRARY (CR 903.6) and is priced anyway, through `alsoPrice`.
    const curves = manaModel(deck.filter((d) => d.card.name !== cmd.card.name), { trials: 600, seed: 5, alsoPrice: [cmd] }).curves;
    const m = computeDeckMath(deck, {}, ["Samut, the Driving Force"], undefined, { castCurves: curves });
    const row = m.castability.commanders?.[0];
    expect(row?.name).toBe("Samut, the Driving Force");
    // Priced at its own mana value, the same deadline rule the rest of the layer uses.
    expect(row?.turn).toBe(6);
    expect(row!.castable!.high).toBeGreaterThan(0);
    // The interval, never one number, and it is the PLAY POLICY: hold-up-two floor under the
    // spend-everything ceiling. Colour can only take away, so mana bounds castability from above.
    expect(row!.castable!.low).toBeLessThanOrEqual(row!.castable!.high);
    expect(row!.castable!.high).toBeLessThanOrEqual(row!.mana!.high);
  });

  test("a land base that cannot make the commander's colours reads 0%, and the mana figure says why", () => {
    // The whole reason castability is one number now: the mana is there and the colours are not,
    // which the old two-axis report could state and never combine.
    const cmd = card("Samut, the Driving Force");
    const forests = Array.from({ length: 38 }, (_, i) =>
      card(`Forest ${i}`, { typeLine: "Basic Land — Forest", manaValue: 0, manaCost: undefined, producedMana: ["G"] }));
    const deck = [cmd, ...forests, ...Array.from({ length: 61 }, (_, i) => card(`Spell ${i}`, { manaValue: 3, manaCost: "{2}{G}" }))];
    const curves = manaModel(deck.filter((d) => d.card.name !== cmd.card.name), { trials: 600, seed: 5, alsoPrice: [cmd] }).curves;
    const row = computeDeckMath(deck, {}, [cmd.card.name], undefined, { castCurves: curves }).castability.commanders?.[0];
    expect(row!.castable!.high).toBe(0);
    expect(row!.mana!.high).toBeGreaterThan(0.3);
  });

  test("a refused cost yields null and a REASON, never 0% — a reader trusts a percentage", () => {
    const cmd = card("Hydra Omnivore", { manaCost: "{X}{G}{G}", manaValue: 2 });
    const m = computeDeckMath(deckOf(cmd), {}, ["Hydra Omnivore"]);
    const row = m.castability.commanders?.[0];
    expect(row?.castable).toBeNull();
    expect(row?.mana).toBeNull();
    expect(row?.refused).toMatch(/X cost/);
  });

  test("a command-zone commander says so — the cast turn is the wrong question for it", () => {
    const cmd = card("Inalla, Archmage Ritualist", {
      oracleText: "Eminence — Whenever another nontoken Wizard you control enters, if Inalla is in the command zone or on the battlefield, you may pay {1}.",
    });
    const m = computeDeckMath(deckOf(cmd), {}, ["Inalla, Archmage Ritualist"]);
    expect(m.castability.commanders?.[0].commandZoneCaveat).toMatch(/command zone/);
    // The ordinary commander carries no caveat, so the field means something when present.
    const plain = computeDeckMath(deckOf(card("Samut, the Driving Force")), {}, ["Samut, the Driving Force"]);
    expect(plain.castability.commanders?.[0].commandZoneCaveat).toBeUndefined();
  });

  test("a partner pair gets a row each", () => {
    const a = card("Kediss, Emberclaw Familiar", { manaValue: 2, manaCost: "{1}{R}" });
    const b = card("Ludevic, Necrogenius", { manaValue: 3, manaCost: "{1}{U}{B}" });
    const deck = [a, b, ...deckOf(card("filler")).slice(1)];
    const m = computeDeckMath(deck, {}, [a.card.name, b.card.name]);
    expect(m.castability.commanders?.map((c) => c.name).sort()).toEqual([a.card.name, b.card.name].sort());
  });
});
