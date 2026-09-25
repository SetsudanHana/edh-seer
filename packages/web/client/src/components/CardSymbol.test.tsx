import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { abilityClass, CardSymbol, typeClass } from "./CardSymbol.js";

/** THE NON-MANA HALF OF THE FONT (owner, 2026-09-20: "the mana font has much more symbols, like for
 *  example symbol for commander, we should incorporate as much of the font as possible to make our
 *  website more readable").
 *
 *  Every one of these goes through `CardSymbol` rather than an `<i>` at the call site, for the
 *  reason PR #411 measured: mana ships UNLAYERED CSS and Tailwind v4 emits utilities inside
 *  `@layer utilities`, so an unlayered `.ms` rule beats any `text-*` on the same element. Sizing
 *  and colour have to be solved once, here, or every new call site rediscovers it in the browser. */

describe("typeClass", () => {
  test("reads the first card type off a type line", () => {
    expect(typeClass("Legendary Creature — Human Warrior Cleric")).toBe("creature");
    expect(typeClass("Artifact — Equipment")).toBe("artifact");
    expect(typeClass("Basic Land — Mountain")).toBe("land");
    expect(typeClass("Legendary Planeswalker — Chandra")).toBe("planeswalker");
    expect(typeClass("Instant")).toBe("instant");
    expect(typeClass("Battle — Siege")).toBe("battle");
  });

  // CEILING: "Artifact Creature" takes the FIRST type only. Two glyphs on one line reads as
  // clutter, and the words immediately after say the rest.
  test("a multi-type line takes the first type", () => {
    expect(typeClass("Artifact Creature — Golem")).toBe("artifact");
    expect(typeClass("Enchantment Creature — God")).toBe("enchantment");
  });

  // The supertype is not a type: "Legendary" and "Basic" are skipped, never drawn.
  test("supertypes are skipped, and an unreadable line asks for no glyph", () => {
    expect(typeClass("Legendary Snow Creature — Yeti")).toBe("creature");
    expect(typeClass("")).toBeUndefined();
    expect(typeClass("Dungeon")).toBeUndefined();
  });
});

describe("abilityClass", () => {
  // Measured against the corpus 2026-09-20: 134 of 811 distinct keywords have a glyph, 69.0% of
  // the 22,682 renderings. The word is always printed, so a keyword with no glyph is a word
  // without a mark rather than a hole.
  test("maps a keyword to its glyph across the families mana files them under", () => {
    expect(abilityClass("Flying")).toBe("ability-flying");
    expect(abilityClass("first strike")).toBe("ability-first-strike");
    expect(abilityClass("Flashback")).toBe("flashback");
  });

  test("a keyword mana has no glyph for asks for none", () => {
    expect(abilityClass("Equip")).toBeUndefined();
    expect(abilityClass("Probing Telepathy")).toBeUndefined();
    expect(abilityClass("")).toBeUndefined();
  });
});

describe("CardSymbol", () => {
  test("a mark beside its own word is hidden from the accessibility tree", () => {
    const { container } = render(<><CardSymbol name="creature" /> Creature</>);
    const i = container.querySelector("i.ms")!;
    expect(i.className).toContain("ms-creature");
    expect(i.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  test("a mark standing alone carries a label", () => {
    render(<CardSymbol name="commander" label="commander" />);
    expect(screen.getByRole("img", { name: "commander" })).toBeInTheDocument();
  });
});

/** THE LIST IS GENERATED, AND THIS IS WHY IT HAS TO STAY GENERATED.
 *
 *  The first cut of `KNOWN` was hand-written from memory and 67 of its 145 names did not exist in
 *  mana -- `ability-equip`, `ability-cascade`, `ability-shadow` and 64 more. A class mana does not
 *  define is not an error anywhere: the `<i>` renders a private-use codepoint with no glyph behind
 *  it, which paints an empty box in production and passes every test that only checks the class
 *  attribute. So the set is derived from `mana.min.css`, and this test re-derives it and fails if
 *  the two have drifted -- an upstream rename, or a hand edit to the list. */
test("every class the component can name exists in the shipped mana CSS", async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  // WALK UP FOR `node_modules`, rather than counting `..` from `import.meta.url`: under jsdom that
  // URL is not a file: URL at all ("The URL must be of scheme file"), and a fixed depth also breaks
  // the moment vitest is rooted somewhere else.
  const find = (name: string): string => {
    for (let dir = import.meta.dirname; dir !== dirname(dir); dir = dirname(dir)) {
      const hit = join(dir, name);
      if (existsSync(hit)) return hit;
    }
    throw new Error(`not found walking up from ${import.meta.dirname}: ${name}`);
  };
  const css = readFileSync(find("node_modules/mana-font/css/mana.min.css"), "utf8").replace(/^\ufeff/, "");
  const real = new Set([...css.matchAll(/\.ms-([a-z0-9-]+)::before/g)].map((m) => m[1]!));
  const source = readFileSync(find("packages/web/client/src/components/CardSymbol.tsx"), "utf8");
  const block = source.slice(source.indexOf("const KNOWN"), source.indexOf("export function CardSymbol"));
  const named = [...block.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]!);
  expect(named.length).toBeGreaterThan(200);
  expect(named.filter((n) => !real.has(n))).toEqual([]);
});
