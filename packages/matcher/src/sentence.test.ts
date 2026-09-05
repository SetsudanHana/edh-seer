import { describe, expect, test } from "vitest";
import { VERB_VOCAB } from "@edh-seer/tagger";
import {
  costReductionSentence, counterPresenceSentence, createsSentence, effectPhrase, eventVerbPhrase,
  fetchSentence, graveyardEnablesRecursion, graveyardFeedsScaling, meldSentence, reasonSentence,
  boardCountFeedsScaling, effectTargetNoun, emitSubjectNoun, staticGrantSentence, tutorSentence, VERB_PHRASES, winconSentence } from "./sentence.js";

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

/** THE ONE VERB WHOSE SUBJECT IS ITS OBJECT. Every other emit names what the event happens to, so
 *  the "thanks to" construction reads correctly; a `create-token` emit names what was CREATED while
 *  the verb describes the MAKER's action, and the same construction had the token doing the making.
 *  MEASURED on the partner artifact 2026-09-04: 7,050 of 91,061 rows (7.7%) on 2,671 cards. */
test("a create-token cause names the maker, not the token it made", () => {
  expect(reasonSentence({
    producer: "Krenko, Mob Boss", consumer: "Staff of the Storyteller",
    eventKey: "create-token:goblin", effectKind: "counters", subjectNoun: "a goblin",
  })).toMatch(/^When Krenko, Mob Boss makes a goblin token, Staff of the Storyteller /);
});

/** "A permanent token" says nothing "a token" does not, and the untyped emit is what produces it. */
test("an untyped create-token emit reads as a plain token", () => {
  expect(reasonSentence({
    producer: "Anointed Procession", consumer: "Impact Tremors",
    eventKey: "create-token:any", subjectNoun: "a permanent",
  })).toMatch(/^When Anointed Procession makes a token, /);
});

/** AND NO OTHER VERB MOVES. The "thanks to" grammar is right wherever the subject really is what
 *  the event happens to, which is every emit but this one. */
test("a non-create-token cause still names the subject the event happens to", () => {
  expect(reasonSentence({
    producer: "Austere Command", consumer: "Grim Haruspex",
    eventKey: "dies:creature", effectKind: "draw-card", subjectNoun: "a creature",
  })).toMatch(/^When a creature dies thanks to Austere Command, /);
});

/** A SUBTYPE IS A PROPER NOUN IN MAGIC AND A CARD TYPE IS NOT. Noticed on a card page printing both
 *  at once: the event line read "a Goblin creature token" and the reason sentence under it read
 *  "a goblin", which reads as two engines disagreeing about the same card. */
test("an emit's subtype noun is capitalised and its type noun is not", () => {
  expect(emitSubjectNoun({ subtype: "goblin", type: "creature" })).toBe("a Goblin");
  expect(emitSubjectNoun({ type: "creature" })).toBe("a creature");
  expect(emitSubjectNoun({ type: "artifact" })).toBe("an artifact");
  expect(emitSubjectNoun({})).toBe("a permanent");
  // An emit about the producer ITSELF names no noun -- that is what keeps every correct sentence in
  // the corpus reading as it did.
  expect(emitSubjectNoun({ self: true, subtype: "goblin" })).toBeUndefined();
});

/** THE COUNT NAMES WHAT IT FEEDS, and "gets bigger" was a wrong claim on most of this channel.
 *  Reported by the precon reviewer against the card printed beside it: Krenko's X counts Goblins to
 *  decide HOW MANY TOKENS he makes, and he is a 3/3 either way. */
test("a board count says what actually grows, and claims nothing where it cannot tell", () => {
  expect(boardCountFeedsScaling("Goblin Assassin", "Krenko, Mob Boss", "token-generation"))
    .toBe("While you control Goblin Assassin, Krenko, Mob Boss counts it and makes more tokens");
  expect(boardCountFeedsScaling("Llanowar Elves", "Bonehoard", "pump"))
    .toContain("gets bigger");
  // An effect this map has never seen says the true weak thing rather than inventing a growth.
  expect(boardCountFeedsScaling("A", "B", "some-new-kind")).toContain("does more");
  expect(boardCountFeedsScaling("A", "B")).toContain("does more");
});

/** THE KINDS THE ENGINE READ AND THE SENTENCE REFUSED TO SAY. 27.7% of every partner row on the site
 *  ended in a bare "<card> triggers", and only 3,453 consumer abilities were a genuine blank -- the
 *  rest were kinds the engine had identified with no words in this table. A skeptic called those
 *  rows "the sentence generator running out"; an engine that knows a card grants haste and prints
 *  "triggers" is hiding what it knows behind the wording it uses for what it does not. */
test("a kind the engine identified gets said, weakly and without over-claiming", () => {
  for (const [kind, expected] of [
    ["keyword-grant", "grants a keyword"],
    ["untap", "untaps a permanent"],
    ["speed-increase", "grants haste"],
    ["copy-spell", "copies a spell"],
    ["flicker", "blinks a permanent"],
    ["graveyard-hate", "hits a graveyard"],
  ] as const) {
    expect(effectPhrase(kind, undefined), kind).toBe(expected);
  }
});

/** AND A GENUINE BLANK STILL SAYS NOTHING, which is the distinction the whole change exists to
 *  restore: "the engine did not read this" and "the engine read it and won't tell you" must not
 *  render identically. */
test("an unread effect still has no phrase", () => {
  expect(effectPhrase("", undefined)).toBeNull();
  expect(effectPhrase(undefined, undefined)).toBeNull();
});

/** "PUTS COUNTERS ON IT" HAD TWO LIVE ANTECEDENTS in every row it appeared in. The sentence opens
 *  "When a Goblin enters thanks to Krenko, Mob Boss…", so "it" reads as the Goblin — and on Quest
 *  for the Goblin Lord the counters go on the QUEST. A skeptic: "the two readings are a real synergy
 *  versus a nothing". 25,997 rows carried the pronoun. */
test("a counter effect says where the counters land", () => {
  expect(effectPhrase("counter-placement", "1", effectTargetNoun({ self: true })))
    .toBe("puts a counter on itself");
  expect(effectPhrase("counter-placement", "2", effectTargetNoun({ type: "creature" })))
    .toBe("puts 2 counters on a creature");
  expect(effectPhrase("counter-placement", undefined, effectTargetNoun({ subtype: "goblin" })))
    .toBe("puts counters on a Goblin");
});

/** AN UNTYPED SUBJECT FALLS BACK TO THE CLASS, not to a pronoun. "a permanent" is true of every
 *  counter target and, unlike "it", claims nothing about WHICH one -- which is the whole ambiguity. */
test("an unknown target names the class rather than pointing", () => {
  expect(effectPhrase("counter-placement", "1", effectTargetNoun({}))).toBe("puts a counter on a permanent");
  // With no target threaded at all, the old wording stands -- callers that cannot know keep it.
  expect(effectPhrase("counter-placement", "1", undefined)).toBe("puts a counter on it");
});

// Arcane Denial (owner, 2026-09-05): "its controller may draw up to two cards" derived `opp` and
// printed "draws you up to two cards". The recipient is now part of the phrase.
test("effectPhrase names the recipient of a draw or a life change", () => {
  expect(effectPhrase("draw-card", "up to two", undefined, "opp")).toBe("makes an opponent draw up to two cards");
  expect(effectPhrase("draw-card", "1", undefined, "any")).toBe("makes a player draw 1 card");
  expect(effectPhrase("draw-card", "1", undefined, "you")).toBe("draws you 1 card");
  expect(effectPhrase("lifegain", undefined, undefined, "opp")).toBe("gains an opponent life");
  // Kinds whose phrase names no recipient are untouched.
  expect(effectPhrase("damage", "3", undefined, "opp")).toBe("deals 3 damage");
});

/** SPEED IS THE PLAYER'S (CR 702.179), so the card RAISES it; "Samut gains speed" read as if the
 *  card had one (owner, 2026-09-05). */
test("raising speed is phrased on the player", () => {
  expect(effectPhrase("speed", undefined)).toBe("raises your speed");
});

test("losing abilities has a phrase", () => {
  expect(effectPhrase("ability-loss", undefined)).toBe("strips abilities");
});
