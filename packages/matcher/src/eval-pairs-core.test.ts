import { expect, test } from "vitest";
import type { Reason, Card } from "@edh-seer/engine";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";
import { classifyAntiPair, classifyPair, type AntiPair, type CompassPair } from "./eval-pairs-core.js";

const pair: CompassPair = {
  a: "Blood Artist", b: "Viscera Seer", category: "aristocrats",
  note: "", source: "test", verified: true,
};

const card = (name: string): Card => ({ name } as Card);

/** A DeckCard whose tags expose one theme tag (so cardThemeTags is non-empty) or null. */
const dc = (name: string, hasTag: boolean): DeckCard => ({
  card: card(name),
  tags: hasTag
    ? ({ abilities: [{ kind: "static", effect: { kind: "drain", subject: {} } }] } as unknown as CardTags)
    : null,
});

const reason = (over: Partial<Reason>): Reason => ({ tag: "", text: "", ...over });

test("PASS when some reason matches the pair's category", () => {
  const out = classifyPair(pair, [reason({ effectKind: "drain" })], dc("Blood Artist", true), dc("Viscera Seer", true));
  expect(out.status).toBe("PASS");
  expect(out.matchedReason?.effectKind).toBe("drain");
});

test("WRONG-REASON when edges exist but none match the category", () => {
  const out = classifyPair(pair, [reason({ effectKind: "mana-generation" })], dc("a", true), dc("b", true));
  expect(out.status).toBe("WRONG-REASON");
  expect(out.reasons).toHaveLength(1);
});

test("NO-EDGE + NO-LINKING-RULE when no reasons but both cards carry tags", () => {
  const out = classifyPair(pair, [], dc("a", true), dc("b", true));
  expect(out.status).toBe("NO-EDGE");
  expect(out.noEdgeCause).toBe("NO-LINKING-RULE");
});

test("NO-EDGE + MISSING-TAG-A when card A has no theme tags", () => {
  const out = classifyPair(pair, [], dc("a", false), dc("b", true));
  expect(out.noEdgeCause).toBe("MISSING-TAG-A");
});

test("NO-EDGE + MISSING-TAG-B when only card B lacks theme tags", () => {
  const out = classifyPair(pair, [], dc("a", true), dc("b", false));
  expect(out.noEdgeCause).toBe("MISSING-TAG-B");
});

// THE NEGATIVE HALF OF THE COMPASS. `compass-pairs.json` reads 55/55 and an engine that joined
// every pair in the deck would score exactly the same, because nothing ever asked "and what must
// NOT join". These rows are one representative per class of false edge, taken from the panel's
// judged FALSE verdicts.
const anti = (tag: string, cls = "false-care"): AntiPair => ({ a: "A", b: "B", tag, class: cls, why: "" });

test("an anti-pair is clean only when the engine makes no claim in that category", () => {
  const r = (tag: string): Reason => ({ tag, text: "" });
  expect(classifyAntiPair(anti("cast:any"), [])).toBe("clean");
  expect(classifyAntiPair(anti("cast:any"), [r("cast:any")])).toBe("false-edge");
});

// NARROWER THAN "ANY REASON AT ALL", ON PURPOSE. Two cards can legitimately relate through some
// other mechanism, and failing on that would make the guard un-satisfiable: Abstruse Appropriation
// and Nulldrifter DO join under another tag today, and only the `cast:any` claim is the false one.
test("an anti-pair tolerates a relation through a different mechanism", () => {
  const other: Reason = { tag: "enters:creature", text: "" };
  expect(classifyAntiPair(anti("cast:any"), [other])).toBe("clean");
});
