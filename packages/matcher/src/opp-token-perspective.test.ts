import { describe, expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { analyzeDeckStructured, loadHierarchy } from "./index.js";
import { synthesizeTokenTags } from "./token-tags.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/opp-token-perspective.json" with { type: "json" };

/** #1666: a token an opponent receives from your card (Overencumbered's Clue, Food and Junk; Generous Gift's Elephant) is read from the opponent's seat. A payoff of any control or of an opponent's still hears it
 *  (Disciple of the Vault, Mayhem Devil, Kothophed); a payoff of tokens or creatures "you control" does not. Cards and token rows dumped from Mongo 2026-11-20 (DERIVE 556). */
const F = fixtures as unknown as { cards: Record<string, { source: Record<string, unknown>; tags: CardTags }>; tokens: Record<string, CardTags> };
const dc = (name: string): DeckCard => ({ card: F.cards[name]!.source as unknown as DeckCard["card"], tags: F.cards[name]!.tags });
const vanilla = (name: string, typeLine: string, p: string): CardTags => synthesizeTokenTags({ _id: `test-${name}`, name, typeLine, power: p, toughness: p, colors: ["G"], printingIds: [] });
const tokenTags = (ref: { name: string }): CardTags | null => F.tokens[ref.name] ?? (ref.name === "Elephant" ? vanilla("Elephant", "Token Creature — Elephant", "3") : ref.name === "Beast" ? vanilla("Beast", "Token Creature — Beast", "3") : null);
const H = loadHierarchy();
const partners = (maker: string, others: string[]): string[] => {
  const r = analyzeDeckStructured([dc(maker), ...others.map(dc)], undefined, H, undefined, undefined, undefined, tokenTags as never);
  return r.cards.find((c) => c.name === maker)!.topPartners.map((p) => p.name);
};

describe("Overencumbered: the Clue, Food and Junk an opponent receives", () => {
  test.each(["Disciple of the Vault", "Mayhem Devil", "Mazirek, Kraul Death Priest", "Molder Beast", "Ygra, Eater of All"])("is heard by %s, which hears an artifact of any controller", (payoff) => {
    expect(partners("Overencumbered", [payoff])).toContain(payoff);
  });
  test("is NOT heard by Kami of Celebration, whose 'cast from exile' is yours: the Junk impulse is the opponent's", () => {
    expect(partners("Overencumbered", ["Kami of Celebration"])).not.toContain("Kami of Celebration");
  });
  test("is NOT heard by Rings of Brighthearth: it copies an ability YOU activate, and the Junk's is the opponent's", () => {
    expect(partners("Overencumbered", ["Rings of Brighthearth"])).not.toContain("Rings of Brighthearth");
  });
  test("is heard by Return the Favor, which copies a targeted ability of any controller", () => {
    expect(partners("Overencumbered", ["Return the Favor"])).toContain("Return the Favor");
  });
  test("the token nodes read from the opponent's seat, and the node names stay the token's", () => {
    const r = analyzeDeckStructured([dc("Overencumbered"), dc("Disciple of the Vault")], undefined, H, undefined, undefined, undefined, tokenTags as never);
    expect(r.tokenNodes!.map((t) => t.name).sort()).toEqual(["Clue", "Food", "Junk"]);
  });
});

describe("Generous Gift: the Elephant an opponent receives", () => {
  test.each(["Kothophed, Soul Hoarder", "Patron of the Nezumi"])("is heard by %s, which hears a permanent that is not yours", (payoff) => {
    expect(partners("Generous Gift", [payoff])).toContain(payoff);
  });
  test("is heard by Blood Seeker, a creature entering under an OPPONENT's control: the Elephant enters under theirs", () => {
    expect(partners("Generous Gift", ["Blood Seeker"])).toContain("Blood Seeker");
  });
  test("is NOT heard by Impact Tremors, a creature entering under YOUR control", () => {
    expect(partners("Generous Gift", ["Impact Tremors"])).not.toContain("Impact Tremors");
  });
});

test("Beast Within's Beast is an opponent's node of its own, named for the token", () => {
  const r = analyzeDeckStructured([dc("Beast Within"), dc("Kothophed, Soul Hoarder")], undefined, H, undefined, undefined, undefined, tokenTags as never);
  expect(r.tokenNodes!.map((t) => t.name)).toEqual(["Beast"]);
  expect(r.cards.find((c) => c.name === "Beast Within")!.topPartners.map((p) => p.name)).toContain("Kothophed, Soul Hoarder");
});
