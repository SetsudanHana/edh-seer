import { expect, test } from "vitest";
import type { Reason, Card } from "@mtg/engine";
import type { CardTags } from "@mtg/tagger";
import type { DeckCard } from "../types.js";
import { classifyPair, type GoldPair } from "./eval-pairs-core.js";

const pair: GoldPair = {
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
