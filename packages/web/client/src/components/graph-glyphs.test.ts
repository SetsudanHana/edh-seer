import { expect, test } from "vitest";
// Deep import, not the `@mtg/tagger` barrel: the barrel's index re-exports otags/semantics.ts,
// which reads a JSON file via `readFileSync(new URL(..., import.meta.url))` at module scope --
// that breaks under Vite's client transform ("URL must be of scheme file"). schema.ts itself has
// zero imports, so going straight to it keeps this test runnable without pulling that in.
import { VERB_VOCAB, type EffectKind } from "@mtg/tagger/src/schema.js";
import { FALLBACK, GLYPH, glyphFor } from "./graph-glyphs.js";

/** Top-12 `EffectKind`s by live `cardTags` corpus occurrence (measured against production data,
 *  not derivable from `EFFECT_KINDS`' declaration order). Typed against `EffectKind` so a typo
 *  here fails at compile time rather than silently testing nothing. */
const TOP_12_EFFECT_KINDS: readonly EffectKind[] = [
  "pump",
  "token-generation",
  "draw-card",
  "counter-placement",
  "mana-generation",
  "graveyard-recursion",
  "top-manipulation",
  "damage",
  "forced-sacrifice",
  "lifegain",
  "tax",
  "cost-reduction",
];

test("every VERB_VOCAB member resolves to a non-fallback glyph", () => {
  for (const verb of VERB_VOCAB) {
    const glyph = glyphFor({ id: `event:${verb}:any` });
    expect(glyph, `verb "${verb}" fell back to the generic ring`).not.toBe(FALLBACK);
    expect(GLYPH[verb], `verb "${verb}" has no GLYPH entry`).toEqual(expect.any(String));
  }
});

test("every top-12 effect kind resolves to a non-fallback glyph", () => {
  for (const kind of TOP_12_EFFECT_KINDS) {
    // `graveyard-recursion` is the one effect kind the matcher emits as a bare tag (the
    // reanimator-consumer edge); every other effect kind only appears as `static:<kind>`
    // (a static-ability edge). See packages/matcher/src/edges.ts.
    const tag = kind === "graveyard-recursion" ? `event:${kind}:any` : `event:static:${kind}`;
    const glyph = glyphFor({ id: tag });
    expect(glyph, `effect kind "${kind}" fell back to the generic ring`).not.toBe(FALLBACK);
  }
});

test("glyphFor falls back to a generic ring for an unmapped tag", () => {
  expect(glyphFor({ id: "event:totally-unknown-verb:any" })).toBe(FALLBACK);
  expect(glyphFor({ id: "event:static:totally-unknown-kind" })).toBe(FALLBACK);
});

test("glyphFor also resolves a bare tag with no event: prefix", () => {
  expect(glyphFor({ id: "enters:creature" })).toBe(GLYPH.enters);
});
