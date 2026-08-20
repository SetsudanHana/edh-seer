import { describe, expect, test } from "vitest";
import { effectPhrase, eventVerbPhrase, reasonSentence } from "./sentence.js";

describe("effectPhrase — the fallback ladder", () => {
  // effectKind is absent on 8.9% of reasons and `amount` on more than half of abilities, so the
  // ladder IS the design: name what we can back, and never more.
  test("rung 1: kind and amount", () => {
    expect(effectPhrase("draw-card", "2")).toBe("draws you 2 cards");
    expect(effectPhrase("drain", "1")).toBe("drains for 1");
  });

  test("rung 2: kind only", () => {
    expect(effectPhrase("draw-card", undefined)).toBe("draws you cards");
  });

  test("rung 3: nothing we can name", () => {
    expect(effectPhrase(undefined, undefined)).toBeNull();
    expect(effectPhrase("some-kind-we-have-no-phrase-for", "3")).toBeNull();
  });

  test("an amount of X reads as X, not as a number", () => {
    expect(effectPhrase("draw-card", "X")).toBe("draws you X cards");
  });
});

describe("eventVerbPhrase", () => {
  test("maps the core zone-event verbs to third-person verb phrases", () => {
    expect(eventVerbPhrase("enters:creature")).toBe("enters");
    expect(eventVerbPhrase("enters-graveyard:any")).toBe("hits the graveyard");
    expect(eventVerbPhrase("cast:instant")).toBe("is cast");
    expect(eventVerbPhrase("attacks:any")).toBe("attacks");
    expect(eventVerbPhrase("dies:creature")).toBe("dies");
    expect(eventVerbPhrase("leaves:any")).toBe("leaves the battlefield");
    expect(eventVerbPhrase("taps:any")).toBe("becomes tapped");
    expect(eventVerbPhrase("untaps:any")).toBe("untaps");
    expect(eventVerbPhrase("counter-added:any")).toBe("gets a counter");
    expect(eventVerbPhrase("gain-life:you")).toBe("gains life");
    expect(eventVerbPhrase("lose-life:opp")).toBe("makes a player lose life");
    expect(eventVerbPhrase("sacrifice:any")).toBe("sacrifices something");
    expect(eventVerbPhrase("create-token:any")).toBe("makes a token");
    expect(eventVerbPhrase("proliferate:any")).toBe("proliferates");
  });

  test("maps the damage and card-flow verbs, which a naive plural would mangle", () => {
    expect(eventVerbPhrase("combat-damage:creature")).toBe("deals combat damage");
    expect(eventVerbPhrase("non-combat-damage:any")).toBe("deals noncombat damage");
    expect(eventVerbPhrase("draw:you")).toBe("draws a card");
    expect(eventVerbPhrase("discard:any")).toBe("discards a card");
    expect(eventVerbPhrase("mill:any")).toBe("mills a card");
    expect(eventVerbPhrase("land-play:any")).toBe("plays a land");
    expect(eventVerbPhrase("dice-rolled:any")).toBe("rolls a die");
  });

  test("falls back to a naive plural for a verb this map has never seen", () => {
    expect(eventVerbPhrase("some-future-verb:any")).toBe("some future verbs");
  });
});

describe("reasonSentence", () => {
  test("cause first, effect named", () => {
    expect(reasonSentence({
      producer: "Samut, the Driving Force", consumer: "Elemental Bond",
      eventKey: "enters:creature", effectKind: "draw-card", amount: "1",
    })).toBe("When Samut, the Driving Force enters, Elemental Bond draws you 1 card");
  });

  test("falls back to the plain form when the effect cannot be named", () => {
    expect(reasonSentence({
      producer: "Grim Hireling", consumer: "Zulaport Cutthroat", eventKey: "dies:creature",
    })).toBe("When Grim Hireling dies, Zulaport Cutthroat triggers");
  });

  test("a self trigger names the consumer as the thing the event happens to", () => {
    expect(reasonSentence({
      producer: "Eldrazi Confluence", consumer: "Solemn Simulacrum",
      eventKey: "enters:any", self: true, effectKind: "draw-card", amount: "1",
    })).toBe("When Solemn Simulacrum enters thanks to Eldrazi Confluence, it draws you 1 card");
  });

  test("a self trigger falls back to the plain form too", () => {
    expect(reasonSentence({
      producer: "Kefka, Court Mage", consumer: "Marchesa, the Black Rose",
      eventKey: "dies:creature", self: true,
    })).toBe("When Marchesa, the Black Rose dies thanks to Kefka, Court Mage, it triggers");
  });

  // "supplies it" was in BOTH the precon player's and the tuner's unknown-word lists.
  test("never says supplies it", () => {
    const s = reasonSentence({
      producer: "A", consumer: "B", eventKey: "enters:creature", effectKind: "draw-card",
    });
    expect(s).not.toContain("supplies");
  });
});
