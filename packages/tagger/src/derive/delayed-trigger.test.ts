import { expect, test } from "vitest";
import { delayedTriggerRepeats } from "./repeats.js";

/** A DELAYED TRIGGER FIRES AS OFTEN AS WHAT MADE IT (issue #500). Oracle text from the corpus. */
test("a delayed trigger takes its creator's rate: chapter and spell once, an activation its cost", () => {
  const yuna = "Grand Summon — {T}: Add one mana of any color. When you next cast a creature spell this turn, that creature enters with two additional +1/+1 counters on it.";
  const fenrir = "I — Crescent Fang — Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\nII — Heavenward Howl — When you next cast a creature spell this turn, that creature enters with an additional +1/+1 counter on it.";
  const doublecast = "When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.";
  const ether = "{T}, Exile this artifact: Add {U}. When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.";
  const chandra = "−2: When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.";
  expect(delayedTriggerRepeats("When you next cast a creature spell this turn, that creature enters with two additional +1/+1 counters on it.", yuna))
    .toEqual({ repeats: "per-cycle", delayedBy: "{T}" });
  expect(delayedTriggerRepeats("Heavenward Howl — When you next cast a creature spell this turn, that creature enters with an additional +1/+1 counter on it.", fenrir))
    .toEqual({ repeats: "once", delayedBy: "chapter" });
  expect(delayedTriggerRepeats(doublecast, doublecast)).toEqual({ repeats: "once", delayedBy: "spell" });
  expect(delayedTriggerRepeats("When you next cast an instant or sorcery spell this turn, copy that spell.", ether))
    .toEqual({ repeats: "once", delayedBy: "{T}, Exile this artifact" });
  expect(delayedTriggerRepeats("When you next cast an instant or sorcery spell this turn, copy that spell.", chandra))
    .toEqual({ repeats: "per-cycle", delayedBy: "−2" });
  // Not a delayed trigger: the class trigger keeps its own reading.
  expect(delayedTriggerRepeats("Whenever you cast a creature spell, draw a card.", "Whenever you cast a creature spell, draw a card.")).toBeUndefined();
});
