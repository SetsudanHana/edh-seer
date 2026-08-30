import { describe, expect, test } from "vitest";
import { VERB_VOCAB } from "@edh-seer/tagger";
import {
  costReductionSentence, counterPresenceSentence, createsSentence, effectPhrase, eventVerbPhrase,
  fetchSentence, graveyardEnablesRecursion, graveyardFeedsScaling, meldSentence, reasonSentence,
  staticGrantSentence, tutorSentence, VERB_PHRASES, winconSentence,
} from "./sentence.js";

describe("effectPhrase — the fallback ladder", () => {
  // effectKind is absent on 8.9% of reasons and `amount` on more than half of abilities, so the
  // ladder IS the design: name what we can back, and never more.
  test("rung 1: kind and amount", () => {
    expect(effectPhrase("draw-card", "2")).toBe("draws you 2 cards");
    expect(effectPhrase("drain", "1")).toBe("drains for 1");
  });

  /** REPORTED FROM A REAL DECK: "Samut, the Driving Force + Enduring Courage — When Samut enters,
   *  Enduring Courage gives ++2/+0/++2/+0". The template was `+${n}/+${n}` over an amount the
   *  corpus writes as a P/T pair. Measured over the derived corpus: 1,893 pump abilities carry a
   *  pair, 2 carry a bare number. */
  test("a pump amount is a P/T delta and goes through as one", () => {
    expect(effectPhrase("pump", "+2/+0")).toBe("gives +2/+0");
    expect(effectPhrase("pump", "+1/+1")).toBe("gives +1/+1");
    // X forms and conditional ones read as English without special-casing either.
    expect(effectPhrase("pump", "+X/+X")).toBe("gives +X/+X");
    expect(effectPhrase("pump", "+1/+1 for each creature you control"))
      .toBe("gives +1/+1 for each creature you control");
    // The two cards that carry a bare number keep the old reading.
    expect(effectPhrase("pump", "1")).toBe("gives +1/+1");
    // An amount with no pair in it cannot be stated, so the sentence stops claiming one.
    expect(effectPhrase("pump", "X")).toBe("makes your creatures bigger");
  });

  /** A COST REDUCTION IS ALREADY NEGATIVE: 138 abilities carry `"-1"`, and `costs ${n} less`
   *  rendered "costs -1 less" — a double negative saying the opposite of the card. */
  test("a cost reduction never reads as a double negative, and never says less twice", () => {
    expect(effectPhrase("cost-reduction", "-1")).toBe("costs 1 less");
    expect(effectPhrase("cost-reduction", "\u22122")).toBe("costs 2 less"); // the Unicode minus, also in the corpus
    expect(effectPhrase("cost-reduction", "-{1}")).toBe("costs {1} less");
    expect(effectPhrase("cost-reduction", "{1} less")).toBe("costs {1} less");
    expect(effectPhrase("cost-reduction", "X is the amount of life you lost this turn"))
      .toBe("costs less");
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

  // "makes 1 tokens" and "puts 1 counters on it" both shipped from the amount branch before this
  // — an amount of exactly one is a singular, and the no-amount form is already the English for it.
  test("an amount of one reads as a singular, not as '1 tokens'", () => {
    expect(effectPhrase("token-generation", "1")).toBe("makes a token");
    expect(effectPhrase("token-generation", "3")).toBe("makes 3 tokens");
    expect(effectPhrase("counter-placement", "1")).toBe("puts a counter on it");
    expect(effectPhrase("counter-placement", "2")).toBe("puts 2 counters on it");
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

  // The fallback above is unreachable today only because every VERB_VOCAB member has a table entry;
  // nothing enforced that, and this project adds verbs often (F3, review round 1). A future verb
  // added to schema.ts without a matching entry here would silently ship the naive plural.
  test("every @edh-seer/tagger VERB_VOCAB member has a VERB_PHRASES entry", () => {
    const missing = VERB_VOCAB.filter((v) => !(v in VERB_PHRASES));
    expect(missing).toEqual([]);
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

describe("graveyardEnablesRecursion — the reanimator-consumer relation", () => {
  test("cause first, both cards named, no engine vocabulary", () => {
    expect(graveyardEnablesRecursion("Faithless Looting", "Muldrotha")).toBe(
      "When Faithless Looting is in the graveyard, Muldrotha can bring it back",
    );
    expect(graveyardEnablesRecursion("Faithless Looting", "Muldrotha")).not.toContain("recursion");
    expect(graveyardEnablesRecursion("Faithless Looting", "Muldrotha")).not.toContain("enabling");
  });
});

describe("graveyardFeedsScaling — the per-graveyard payoff relation", () => {
  test("cause first, both cards named", () => {
    expect(graveyardFeedsScaling("Ruin Crab", "Bonehoard")).toBe(
      "When Ruin Crab is in the graveyard, Bonehoard gets bigger",
    );
  });
});

describe("staticGrantSentence — a continuous static reaching a card", () => {
  test("a mapped kind reads as a plain grant", () => {
    expect(staticGrantSentence("Death Baron", "Gravecrawler", "pump")).toBe(
      "Death Baron gives Gravecrawler bigger stats",
    );
    expect(staticGrantSentence("Anthem", "Squire", "keyword-grant")).toBe(
      "Anthem gives Squire an extra ability",
    );
  });

  test("never says 's static applies to", () => {
    const s = staticGrantSentence("Anthem", "Squire", "pump");
    expect(s).not.toContain("applies to");
    expect(s).not.toContain("static");
  });

  test("an unmapped kind still reads as English", () => {
    expect(staticGrantSentence("Odd Card", "Squire", "graveyard-hate")).toBe(
      "Odd Card gives Squire its graveyard hate",
    );
  });

  // F1 (review round 1): the test above happens to pick a kind ("graveyard-hate") that reads fine
  // as a bare noun and so never exposed that a VERB-shaped kind reads as nonsense through the
  // identical fallback — "gives Squire its proliferate" / "its enters with counters" / "its untap".
  // These three now have explicit entries rather than a wider, cleverer transform.
  test("a verb-shaped kind gets an explicit phrase instead of the naive fallback", () => {
    expect(staticGrantSentence("Anthem", "Squire", "proliferate")).toBe(
      "Anthem gives Squire the ability to proliferate",
    );
    expect(staticGrantSentence("Anthem", "Squire", "enters-with-counters")).toBe(
      "Anthem gives Squire counters as it enters",
    );
    expect(staticGrantSentence("Anthem", "Squire", "untap")).toBe(
      "Anthem gives Squire an extra untap",
    );
  });
});

describe("costReductionSentence", () => {
  test("exact text, unchanged from before this module existed", () => {
    expect(costReductionSentence("Jet Medallion", "Bloodghast")).toBe(
      "Jet Medallion reduces what Bloodghast costs",
    );
  });
});

describe("the five small verbatim sentences", () => {
  test("winconSentence", () => {
    expect(winconSentence("Treasure", "Revel in Riches")).toBe(
      "Treasure is what Revel in Riches counts toward winning",
    );
  });

  test("fetchSentence", () => {
    expect(fetchSentence("Farseek", "Godless Shrine")).toBe("Farseek can fetch Godless Shrine");
  });

  test("tutorSentence", () => {
    expect(tutorSentence("Worldly Tutor", "Craterhoof Behemoth")).toBe(
      "Worldly Tutor can search up Craterhoof Behemoth",
    );
  });

  test("counterPresenceSentence", () => {
    // (producer, consumer, counterKind), matching every sibling in this module -- Hardened Scales
    // is what PUTS the counters there, so it is the producer argument now (F4, review round 1).
    expect(counterPresenceSentence("Hardened Scales", "Sludge Monster", "+1/+1")).toBe(
      "Sludge Monster benefits from +1/+1 counters being on the board; Hardened Scales puts them there",
    );
  });

  test("meldSentence", () => {
    expect(meldSentence("Mishra, Claimed by Gix", "Phyrexian Dragon Engine")).toBe(
      "Mishra, Claimed by Gix and Phyrexian Dragon Engine meld together",
    );
  });

  test("createsSentence", () => {
    expect(createsSentence("Krenko's Command", "Goblin")).toBe("Krenko's Command creates Goblin");
  });
});
