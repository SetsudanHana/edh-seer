import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { cardThemeTags, loadHierarchy, pairReasons } from "./index.js";
import { cardSupplyTags } from "./edges.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/impulse-cast-pairs.json" with { type: "json" };

/** #1665 (#1608 item 7, owner ruling 2026-11-17): an own-library impulse draw ("Exile the top two cards of your library. Until the end of your next turn, you may play those cards.") derives a cast FROM EXILE, and only a payoff
 *  that asks where the spell was cast from hears it. A cast trigger that states no origin ("whenever you cast a spell", prowess, "an instant or sorcery") does NOT: the plain-trigger case is the one the CEILING at 496 refused to emit.
 *  Source documents and stored `cardClauses.canonical` dumped from Mongo 2026-11-17 (DERIVE 537). */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const castTags = (producer: string, consumer: string) => pairReasons(dc(producer), dc(consumer), H).map((r) => r.tag).filter((t) => t.startsWith("cast:") || t.startsWith("prowess:"));

describe.each(["Light Up the Stage", "Act on Impulse"])("%s: an impulse draw off your own library", (impulse) => {
  test.each(["Kami of Celebration", "Faldorn, Dread Wolf Herald", "Quintorius Kand", "Mizzix, Replica Rider"])("is heard by %s, which asks where the spell was cast from", (payoff) => {
    expect(castTags(impulse, payoff)).not.toEqual([]);
  });
  // The card's own cast (an instant or a sorcery) is heard by every plain trigger that fits it, so the plain payoffs here name a class the impulse card is not: a creature spell, an artifact spell. Only the exile-origin emit
  // could meet them, and it carries no word of where it came from for them.
  test.each(["Beast Whisperer", "Sai, Master Thopterist"])("is NOT heard by %s, a cast trigger with no origin", (plain) => {
    expect(castTags(impulse, plain)).toEqual([]);
  });
  // The gate alone refuses Nita: her "a spell you don't own" states no origin. No corpus trigger states an origin AND `owner: opp`, so the ownership check (originMatches) cannot be isolated here.
  test("Nita's 'a spell you don't own' states no origin, so the gate keeps it deaf", () => {
    expect(castTags(impulse, "Nita, Forum Conciliator")).toEqual([]);
  });
});

// REVIEW 1 (#1665): the cast carries the theme key `cast:spell`, the key every plain cast trigger uses, so it must credit no theme or supply count: a plain payoff does not hear it.
test.each(["Light Up the Stage", "Act on Impulse"])("%s: the originOnly cast adds nothing to the theme or supply tags", (impulse) => {
  const tags = dc(impulse).tags as CardTags;
  const stripped = { ...tags, abilities: tags.abilities.map((a) => ({ ...a, emits: a.emits?.filter((e) => e.originOnly !== true) })) } as CardTags;
  expect(tags.abilities.some((a) => a.emits?.some((e) => e.originOnly === true))).toBe(true);
  expect([...cardThemeTags(tags)].sort()).toEqual([...cardThemeTags(stripped)].sort());
  expect([...cardSupplyTags(tags)].sort()).toEqual([...cardSupplyTags(stripped)].sort());
});

// REVIEW 2: a card that already derived its own-library exile cast (typed `spell`) keeps it, and it is origin-only too. Chandra, Pyromaster's cast is typed instant or sorcery and is not marked.
describe.each(["Theater of Horrors", "Colfenor's Plans", "Nahiri, Forged in Fury", "Brilliant Ultimatum", "Jacob Hauken, Inspector // Hauken's Insight"])("%s: an own-library exile cast it already derived", (card) => {
  test("its own-library exile cast is marked origin-only", () => {
    const casts = (dc(card).tags?.abilities ?? []).flatMap((a) => a.emits ?? []).filter((e) => e.verb === "cast" && e.subject.self !== true && e.subject.fromZone === "exile");
    expect(casts.length).toBeGreaterThan(0);
    for (const e of casts) expect(e.originOnly).toBe(true);
  });
  // Nahiri and Jacob Hauken are creatures, so Beast Whisperer hears THEIR OWN cast; the plain payoffs are asked of the three that are not.
  test.skipIf(["Nahiri, Forged in Fury", "Jacob Hauken, Inspector // Hauken's Insight"].includes(card))("Beast Whisperer and Sai hear no reason from it", () => {
    for (const plain of ["Beast Whisperer", "Sai, Master Thopterist"]) expect(castTags(card, plain), plain).toEqual([]);
  });
  test.each(["Kami of Celebration", "Quintorius Kand"])("is heard by %s, which asks for a cast from exile", (payoff) => {
    expect(castTags(card, payoff)).not.toEqual([]);
  });
});
test("Chandra, Pyromaster's typed instant-or-sorcery cast is not marked origin-only", () => {
  const casts = (dc("Chandra, Pyromaster").tags?.abilities ?? []).flatMap((a) => a.emits ?? []).filter((e) => e.verb === "cast" && e.subject.self !== true);
  expect(casts.length).toBeGreaterThan(0);
  for (const e of casts) expect(e.originOnly).toBeUndefined();
});

// REVIEW 3: a Junk token given to ANOTHER player ("enchanted opponent creates", "that permanent's controller creates") is that player's impulse, not yours. Its token emits say `control: opp`, so the token-world pairs through the maker
// (maker -> Junk token -> your from-exile payoff, 56 pairs before this) are not formed. The pair itself runs through token nodes (derive-impact measures it); the emit is pinned here.
const tokenControls = (name: string) => (dc(name).tags?.abilities ?? []).flatMap((a) => a.emits ?? []).filter((e) => (e.verb === "create-token" || e.verb === "enters") && e.subject.token === true && [e.subject.subtype ?? []].flat().includes("junk")).map((e) => e.subject.control);
test.each(["Overencumbered", "Commander Sofia Daguerre"])("%s gives the Junk token to another player: its token emits are control opp", (maker) => {
  const c = tokenControls(maker);
  expect(c.length).toBeGreaterThan(0);
  for (const x of c) expect(x).toBe("opp");
});
test("Break Down makes your own Junk: its token emits stay control you", () => {
  const c = tokenControls("Break Down");
  expect(c.length).toBeGreaterThan(0);
  for (const x of c) expect(x).toBe("you");
});
