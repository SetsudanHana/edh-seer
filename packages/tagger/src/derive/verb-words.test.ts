import { afterEach, describe, expect, test } from "vitest";
import { deriveCardTags } from "./derive.js";
import { GUARDED_VERBS, verbPrint } from "./verb-words.js";
import { deriveInputOf } from "../derive-input.js";
import { segment } from "../segment.js";

// The printed-verb guard (#1321): an action whose verb is printed NOWHERE on the card is dropped (to `unclaimed`) for a verb in GUARDED_VERBS; one printed on another clause of the card is a clause mix-up and kept.
const act = (verb: string, object: string, extra: object = {}) => ({ verb, object, fromZone: null, toZone: null, amount: null, optional: false, ...extra });
const via = (name: string, typeLine: string, oracleText: string, clauses: object[]) => {
  const texts: Record<number, string> = {};
  for (const c of segment(oracleText, [], typeLine)) texts[c.id] = c.text;
  return deriveCardTags({ ...deriveInputOf({ name, typeLine, oracleText, keywords: [] } as never, "x", name, clauses as never), clauseTexts: texts });
};
const SPELL = [{ id: 1, abilityType: "spell", actions: [act("scry", "top six cards of your library")] }];
const DIG = "Look at the top six cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.";

afterEach(() => GUARDED_VERBS.clear());

describe("verbPrint: where is the verb printed", () => {
  test("own clause, cost included, reminder stripped", () => {
    expect(verbPrint("scry", "Scry 2.", undefined, "Scry 2.")).toBe("own");
    expect(verbPrint("sacrifice", "Draw a card.", "Sacrifice a creature", "Sacrifice a creature: Draw a card.")).toBe("own");
    expect(verbPrint("scry", "Draw a card, then discard a card from your hand and gain 3 life. (Then scry 2.)", undefined, "Draw a card, then discard a card from your hand and gain 3 life. (Then scry 2.)")).toBe("none");
  });
  test("a short keyword line keeps its reminder: the reminder is the action", () => {
    expect(verbPrint("exile", "Cycling {2}", undefined, "Cycling {2} ({2}, Discard this card: Draw a card.)")).toBe("none");
    expect(verbPrint("discard", "Crew 1 (Tap any number of creatures. Discard a card.)", undefined, "x")).toBe("own");
  });
  test("a keyword line whose reminder is on the card's raw line keeps the action (Awaken puts the counters)", () => {
    const awaken = "Awaken 4—{5}{U} (If you cast this spell for {5}{U}, also put four +1/+1 counters on target land you control and it becomes a 0/0 Elemental creature with haste. It's still a land.)";
    expect(verbPrint("add-counter", "Awaken 4—{5}{U}", undefined, `Return target creature to its owner's hand.\n${awaken}`)).toBe("own");
    expect(verbPrint("add-counter", "Cycling {2}", undefined, "Cycling {2} ({2}, Discard this card: Draw a card.)")).toBe("none");
  });
  test("a word on another clause of the card is a clause mix-up, a word nowhere is none", () => {
    expect(verbPrint("scry", DIG, undefined, `${DIG}\nScry 2.`)).toBe("card");
    expect(verbPrint("scry", DIG, undefined, DIG)).toBe("none");
  });
  test("no clause text says nothing: own", () => {
    expect(verbPrint("scry", "", undefined, DIG)).toBe("own");
    expect(verbPrint("scry", undefined, undefined, DIG)).toBe("own");
  });
  test("linear on a long run of spaces or brackets (CodeQL js/polynomial-redos)", () => {
    const t0 = performance.now();
    for (const t of [`under${" ".repeat(40_000)}x`, `${" ".repeat(40_000)}controls`, "(".repeat(20_000), "{".repeat(20_000), "until ".repeat(8_000), "turn ".repeat(8_000)])
      for (const v of ["gain-control", "return", "cost-modify", "turn-face-up", "put", "transform", "scry"]) verbPrint(v, t, t, t);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("the guard in derive", () => {
  const scries = (tags: ReturnType<typeof via>) => tags.abilities.filter((a) => (a.emits ?? []).some((e) => e.verb === "scry"));
  test("an unguarded verb is untouched (Basic Conjuration's dig reads as scry)", () => {
    expect(scries(via("Basic Conjuration", "Sorcery", DIG, SPELL)).length).toBeGreaterThan(0);
  });
  test("a guarded verb printed nowhere on the card is dropped to unclaimed", () => {
    GUARDED_VERBS.add("scry");
    const tags = via("Basic Conjuration", "Sorcery", DIG, SPELL);
    expect(scries(tags)).toHaveLength(0);
    expect(tags.unclaimed?.some((u) => u.verb === "scry" && u.clause === 1)).toBe(true);
  });
  test("a guarded verb printed in ANOTHER clause is a mix-up and kept", () => {
    GUARDED_VERBS.add("scry");
    const oracle = `${DIG}\nWhen this enters, scry 2.`;
    const tags = via("Mixed Up", "Sorcery", oracle, [{ id: 1, abilityType: "spell", actions: [act("scry", "top six cards of your library")] }, { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "this", control: "you" }, actions: [act("scry", "2")] }]);
    expect(scries(tags).length).toBeGreaterThan(0);
    expect(tags.unclaimed?.some((u) => u.verb === "scry")).toBeFalsy();
  });
});
