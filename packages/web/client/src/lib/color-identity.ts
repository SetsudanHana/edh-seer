export type ColorLetter = "W" | "U" | "B" | "R" | "G";

const WUBRG_ORDER: ColorLetter[] = ["W", "U", "B", "R", "G"];

/** ONE SOURCE FOR IDENTITY COLOUR: the `--mana-*` ramp in index.css, mirrored here as literals
 *  because these values are handed to `linear-gradient()` in inline styles, where a `var()` chain
 *  through a computed string buys nothing and hides where the colour came from.
 *
 *  This replaced a hue-anchor system (`ANCHOR_HUE`, HSL at fixed S/L, `hslToHex`) that predates
 *  the violet ground. Its anchor for BLACK was hue 275 — the ladder's own hue, ±3° — so on the v2
 *  background a mono-black identity drew as "slightly brighter substrate" rather than as a
 *  colour. The ramp answers that deliberately: black is a TRUE neutral grey, the one place a pure
 *  neutral is correct in this system, precisely because it is the absence of the cast around it.
 *  See DESIGN.md, Colors → Mana. */
const MANA_HEX: Record<ColorLetter, string> = {
  W: "#ddd6c4",
  U: "#6ba0f5",
  B: "#7e7a85",
  R: "#d9544f",
  G: "#55a86a",
};

/** No identity at all — colorless artifacts, a deck the analysis could not read a commander for.
 *  Deliberately the same grey as `MANA_HEX.B`: colorless and black are different FACTS, but this
 *  token is a background wash under a label that already names which one it is, and inventing a
 *  sixth hue to distinguish them would spend the frame's hue budget on a distinction the label
 *  already carries. */
const NEUTRAL_IDENTITY = "#7e7a85";

const NAME_TABLE: Record<string, string> = {
  "": "Colorless",
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  WU: "Azorius",
  WB: "Orzhov",
  WR: "Boros",
  WG: "Selesnya",
  UB: "Dimir",
  UR: "Izzet",
  UG: "Simic",
  BR: "Rakdos",
  BG: "Golgari",
  RG: "Gruul",
  WUB: "Esper",
  UBR: "Grixis",
  BRG: "Jund",
  WRG: "Naya",
  WUG: "Bant",
  WBG: "Abzan",
  WUR: "Jeskai",
  UBG: "Sultai",
  WBR: "Mardu",
  URG: "Temur",
  UBRG: "Glint-Eye",
  WBRG: "Dune-Brood",
  WURG: "Ink-Treader",
  WUBG: "Witch-Maw",
  WUBR: "Yore-Tiller",
  WUBRG: "Five-Color",
};

/** Sorts to canonical WUBRG order and dedupes — the shared key for both
 *  color lookup and name lookup, so "RU" and "UR" resolve identically. */
export function identityKey(colors: readonly string[]): string {
  const set = new Set(colors);
  return WUBRG_ORDER.filter((c) => set.has(c)).join("");
}

export function identityLabel(colors: readonly string[]): string {
  return NAME_TABLE[identityKey(colors)] ?? "Colorless";
}

function anchorHex(c: ColorLetter): string {
  return MANA_HEX[c];
}

/** A CSS `background`/`background-image` value that visually shows every color in
 *  the identity — a gradient across each constituent color's own hue (left-to-right
 *  by default, `direction` for vertical bars), so WU genuinely reads as white-into-
 *  blue instead of a single guessed color. Always a `linear-gradient(...)`, even for
 *  0-1 colors (both stops the same color), so it's a drop-in `background-image` value
 *  anywhere — no bare-hex special case for callers to handle.
 *
 *  IT IS DATA, NOT CHROME (v2). This used to be the accent's own surface — it painted the header
 *  rule and followed whatever deck was in scope. The accent is now fixed and this draws exactly
 *  one thing: the identity swatch on a deck that is being reported. Its companion `identityColor()`
 *  is deleted; nothing needs a single solid colour for an identity any more, and picking one
 *  meant picking a first colour and calling it the deck's, which said less than the swatch does. */
export function identityGradient(colors: readonly string[], direction: "90deg" | "180deg" = "90deg"): string {
  const present = WUBRG_ORDER.filter((c) => colors.includes(c));
  if (present.length === 0) return `linear-gradient(${direction}, ${NEUTRAL_IDENTITY}, ${NEUTRAL_IDENTITY})`;
  if (present.length === 1) return `linear-gradient(${direction}, ${anchorHex(present[0])}, ${anchorHex(present[0])})`;
  const stops = present.map((c, i) => `${anchorHex(c)} ${Math.round((i / (present.length - 1)) * 100)}%`);
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

export { WUBRG_ORDER, NEUTRAL_IDENTITY };
