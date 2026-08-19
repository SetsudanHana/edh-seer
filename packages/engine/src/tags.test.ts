import { expect, test } from "vitest";
import { extractTags, tag, describeTag } from "./tags.js";
import { FIXTURES } from "./fixtures.js";

test("treasure maker produces artifact, token, mana, sacrifice-fodder", () => {
  const t = extractTags(FIXTURES.dockside);
  expect(t.produces.has("artifact")).toBe(true);
  expect(t.produces.has("token")).toBe(true);
  expect(t.produces.has("mana")).toBe(true);
  expect(t.produces.has("sacrifice-fodder")).toBe(true);
});

test("artifact payoff cares about artifact", () => {
  const t = extractTags(FIXTURES.fireweaver);
  expect(t.cares.has("artifact")).toBe(true);
  expect(t.produces.has("artifact")).toBe(false);
});

test("tag builds bare and parametric canonical strings", () => {
  expect(tag("artifact")).toBe("artifact");
  expect(tag("tribe", "goblin")).toBe("tribe:goblin");
  expect(tag("counter", "+1/+1")).toBe("counter:+1/+1");
});

test("describeTag renders human labels for parametric and bare tags", () => {
  expect(describeTag("tribe:goblin")).toBe("Goblins");
  expect(describeTag("counter:+1/+1")).toBe("+1/+1 counters");
  expect(describeTag("cast:instant")).toBe("instants");
  expect(describeTag("creature-etb")).toBe("creatures entering");
  expect(describeTag("artifact")).toBe("artifact");
});

/** A STRUCTURED THEME MUST NAME ITS SUBJECT, NOT JUST ITS MECHANISM.
 *
 *  `BARE_LABELS` is the FLAT engine's vocabulary (`creature-etb`, `sacrifice-fodder`), so every
 *  structured tag — `enters:wizard`, `dies:creature` — fell through to the default branch and
 *  rendered as its family alone. Measured on the 71 calibration decks: not one of five tribal decks
 *  named its tribe (wick-changelings "enters / create token", draguns "draw / enters"), and
 *  marchesa-legends-matter read "dies / enters".
 *
 *  The `cast` family already did this right — `cast:instant` renders "instants", which is why
 *  otterly-awesome-spellslinger correctly themes as "instants". This generalises that precedent.
 *  The phrasing deliberately mirrors the flat labels it sits beside: "creatures entering" is what
 *  `creature-etb` has always rendered. */
test("a structured tag renders its subject alongside the mechanism", () => {
  expect(describeTag("enters:wizard")).toBe("wizards entering");
  expect(describeTag("dies:creature")).toBe("creatures dying");
  expect(describeTag("attacks:dragon")).toBe("dragons attacking");
  expect(describeTag("sacrifice:artifact")).toBe("artifacts sacrificed");
});

/** `:any` names no subject, so there is nothing to say about it — the mechanism alone is the whole
 *  claim, and "anys entering" would be worse than silence. */
test("an `any` subject renders the bare mechanism", () => {
  expect(describeTag("enters:any")).toBe("enters");
  expect(describeTag("draw:any")).toBe("draw");
});

/** A NEGATION key reads as a word, not as punctuation. `themeSubjectKey` writes "-creature" for a
 *  subject that excludes creatures, and kuja-spellslinger surfaced it to the user verbatim as
 *  "-creatures". */
test("a negated subject renders as `non<type>`", () => {
  expect(describeTag("cast:-creature")).toBe("noncreature spells");
  expect(describeTag("dies:-token")).toBe("nontokens dying");
});

/** `static:` is the exception: its value is an EFFECT KIND, not a subject (`edges.ts` writes
 *  `static:${effect.kind}`), so "pumps static" would be a wrong sentence. It keeps the bare form. */
test("static keeps its bare label because its value is a kind, not a subject", () => {
  expect(describeTag("static:pump")).toBe("static");
});

// `legendary` is a SUPERTYPE, not a noun, and it became a headline when it got a theme key
// (roadmap A11): "legendarys entering" is not English. Same for the creature types whose plural is
// the same word -- `mono-blue-tribal-tribal` read "merfolks entering".
test("a supertype and the same-plural creature types read as English", () => {
  expect(describeTag("enters:legendary")).toBe("legendary permanents entering");
  expect(describeTag("enters:merfolk")).toBe("Merfolk entering");
  expect(describeTag("enters:eldrazi")).toBe("Eldrazi entering");
  // The ordinary case is untouched.
  expect(describeTag("enters:wizard")).toBe("wizards entering");
});
