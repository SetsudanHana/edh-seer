import { describe, expect, test } from "vitest";
import { deriveCardTags } from "./derive.js";
import { deriveInputOf } from "../derive-input.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import fixtures from "./fixtures/opp-token-seat.json" with { type: "json" };

/** #1666 review: WHO GETS A TOKEN decides whether its node is read from an opponent's seat, so a misread seat is now a false edge, not a lost one. Source documents and stored `cardClauses.canonical` dumped from Mongo 2026-11-20 (DERIVE 556).
 *  Each card's oracle text was read, not remembered: Teysa "investigate for each opponent who lost life" is YOUR Clue; Jolene, Combat Calligrapher, Ellie and Curse of Shallow Graves "that attacking player creates" is any player who attacks; Fractured Identity "each player other than its controller"
 *  and Lucy MacLean "target player other than its controller" are not "its controller"; Parallel Evolution "for each creature token on the battlefield, its controller creates a copy" is every token's controller, yours too. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: unknown[] | null }>;
const tokenSeats = (name: string): string[] => {
  const f = F[name]!;
  const card = f.source as { name: string };
  const g = f.canonical ? undefined : grammarClauseRecords(card as never);
  const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, (f.canonical ?? g!.records) as never, undefined, g?.readings));
  return tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "create-token").map((e) => e.subject.control as string);
};

describe("a token you make is not read as an opponent's", () => {
  test.each(["Teysa, Opulent Oligarch"])("%s: investigate for each opponent who lost life is YOUR Clue", (n) => {
    expect(tokenSeats(n)).not.toContain("opp");
  });
  test.each(["Jolene, the Plunder Queen", "Combat Calligrapher", "Ellie, Brick Master", "Curse of Shallow Graves"])("%s: 'that attacking player creates' is any player", (n) => {
    expect(tokenSeats(n)).toEqual(["any"]);
  });
  test.each(["Fractured Identity", "Lucy MacLean, Positively Armed", "Parallel Evolution"])("%s: a copy for players other than the controller, or for every token's controller, is not an opponent's alone", (n) => {
    expect(tokenSeats(n)).not.toContain("opp");
  });
});

// ROUND 3: a symmetric wipe hands a token to EVERY controller, yours too -- "Destroy all creatures. For each creature destroyed this way, its controller creates ..." (March of Souls, The Phasing of Zhalfir), "Destroy all artifacts and enchantments.
// For each permanent destroyed this way, its controller creates ..." (Rampage of the Clans), "For each player, destroy up to one target creature that player controls. ... its controller creates" (The Curse of Fenric). The audit had quoted only the creating sentence.
describe("a symmetric wipe's token is not an opponent's alone", () => {
  test.each(["March of Souls", "The Phasing of Zhalfir", "Rampage of the Clans", "The Curse of Fenric"])("%s", (n) => {
    expect(tokenSeats(n)).toEqual(["any"]);
  });
  test.each(["Descent of the Dragons", "Hour of Need", "Soul of Emancipation", "Terastodon", "Curse of the Swine"])("%s: 'for each creature destroyed this way, its controller' has several controllers, so it is any", (n) => {
    expect(tokenSeats(n)).not.toContain("opp");
  });
  test.each(["Captive Audience", "Akroan Horse"])("%s: a card an opponent controls says 'each opponent' of THAT controller, which is you", (n) => {
    expect(tokenSeats(n)).toEqual(["any"]);
  });
  test("King Solomon's Frogs: the permanents exiled are each opponent's, so 'its controller draws' is still an opponent's draw", () => {
    const f = F["King Solomon's Frogs"]!;
    const tags = deriveCardTags(deriveInputOf(f.source as never, "x", "King Solomon's Frogs", f.canonical as never));
    expect(tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "draw").map((e) => e.subject.control)).toContain("opp");
  });
  test("Winds of Abandon: the creatures exiled are ones you don't control, so 'its controller searches' is still an opponent's search", () => {
    const f = F["Winds of Abandon"]!;
    const tags = deriveCardTags(deriveInputOf(f.source as never, "x", "Winds of Abandon", f.canonical as never));
    expect(tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "search").map((e) => e.subject.control)).toContain("opp");
  });
  test("From the Ashes: 'destroy all nonbasic lands ... its controller may search' is every land's controller, yours too", () => {
    const f = F["From the Ashes"]!;
    const tags = deriveCardTags(deriveInputOf(f.source as never, "x", "From the Ashes", f.canonical as never));
    expect(tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "search").map((e) => e.subject.control)).not.toContain("opp");
  });
  test("Beast Within: a single target's controller is still read as an opponent's", () => {
    expect(tokenSeats("Beast Within")).toContain("opp");
  });
});

describe("a token given to an opponent still reads as one", () => {
  test.each(["Overencumbered", "Beast Within", "Wernog, Rider's Chaplain"])("%s keeps its opponent emit", (n) => {
    expect(tokenSeats(n)).toContain("opp");
  });
  test("Teysa's own Spirit stays yours", () => {
    expect(tokenSeats("Teysa, Opulent Oligarch")).toContain("you");
  });
  test("Souls of the Faultless: 'attacking player loses that much life' still names the attacker, an opponent, as the recipient", () => {
    const f = F["Souls of the Faultless"]!;
    const tags = deriveCardTags(deriveInputOf(f.source as never, "x", "Souls of the Faultless", f.canonical as never));
    const lose = tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "lose-life").map((e) => e.subject.control);
    expect(lose).toContain("opp");
  });
});
