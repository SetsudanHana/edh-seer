import { expect, test } from "vitest";
import { detectArchetypes, type CardSignal } from "./archetypes.js";

const sig = (name: string, opts: { themeTags?: string[]; effectKinds?: string[] }): CardSignal => ({
  name,
  themeTags: opts.themeTags ?? [],
  effectKinds: opts.effectKinds ?? [],
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

test("ranks two archetypes above the floor by distinct-card count, descending", () => {
  const signals = [
    sig("A", { effectKinds: ["forced-sacrifice"] }),
    sig("B", { effectKinds: ["forced-sacrifice"] }),
    sig("C", { effectKinds: ["forced-sacrifice"] }),
    sig("D", { effectKinds: ["forced-sacrifice"] }),
    sig("E", { effectKinds: ["forced-sacrifice"] }),
    sig("F", { effectKinds: ["forced-sacrifice"] }), // 6 aristocrats cards
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
