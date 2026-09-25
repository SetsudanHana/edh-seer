import { expect, test } from "vitest";
import { reasonSentence } from "./sentence.js";

/** THE CAST CARD IS WHAT ARRIVES WITH COUNTERS (overview persona rounds 2026-09-25, item 2a). Yuna,
 *  Grand Summoner: "When you next cast a creature spell this turn, that creature enters with two
 *  additional +1/+1 counters on it." The sentence read "When Summon: Fenrir is cast, Yuna, Grand
 *  Summoner arrives with counters" -- naming the consumer as the one getting counters, in the #1 pair
 *  of the Yuna deck, flagged in every round. */
test("an enters-with-counters payoff on a cast names the cast card as the one that arrives", () => {
  expect(reasonSentence({
    producer: "Summon: Fenrir", consumer: "Yuna, Grand Summoner", eventKey: "cast:creature", effectKind: "enters-with-counters",
  })).toBe("When Summon: Fenrir is cast, it arrives with counters thanks to Yuna, Grand Summoner");
});

test("an enters-with-counters payoff that is not about a cast keeps its reading", () => {
  expect(reasonSentence({
    producer: "Krenko, Mob Boss", consumer: "Some Card", eventKey: "enters:creature", effectKind: "enters-with-counters",
  })).toBe("When Krenko, Mob Boss enters, Some Card arrives with counters");
});
