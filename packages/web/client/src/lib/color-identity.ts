export type ColorLetter = "W" | "U" | "B" | "R" | "G";

const WUBRG_ORDER: ColorLetter[] = ["W", "U", "B", "R", "G"];

/** Anchor hue per color, degrees. Chosen for spread and legibility against
 *  the ink background, not for literal WUBRG pip color-matching. */
const ANCHOR_HUE: Record<ColorLetter, number> = { W: 45, U: 205, B: 275, R: 8, G: 132 };

/** The neutral/no-identity accent's own HSL — the S/L every identity color
 *  holds constant (only hue varies). */
const ACCENT_SATURATION = 0.7;
const ACCENT_LIGHTNESS = 0.62;
const NEUTRAL_ACCENT = "#5b8dee";

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

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

function anchorHex(c: ColorLetter): string {
  return hslToHex(ANCHOR_HUE[c], ACCENT_SATURATION, ACCENT_LIGHTNESS);
}

/** The single solid accent color (text, borders, focus rings — anywhere a gradient
 *  can't go). Colorless resolves to the neutral default; a single color resolves to
 *  its own anchor hue.
 *
 *  Multicolor identities do NOT blend hues: an earlier circular-mean-of-anchors
 *  approach produced colors that could land on a completely unrelated third color
 *  by coincidence (WU's midpoint sat 7° from Green's own anchor; UR sat 12° from
 *  Blue's; BG sat 2° from Blue's — Izzet and Golgari were reading as "basically
 *  Blue" or "basically Green," colors they don't even contain). Instead, the solid
 *  accent for a multicolor identity is deterministically its first color in WUBRG
 *  order — always one of the identity's real colors, never a blended stranger.
 *  `identityGradient()` below is what actually shows every constituent color. */
export function identityColor(colors: readonly string[]): string {
  const present = WUBRG_ORDER.filter((c) => colors.includes(c));
  if (present.length === 0) return NEUTRAL_ACCENT;
  return anchorHex(present[0]);
}

/** A CSS `background` value that visually shows every color in the identity — a
 *  solid hex for 0-1 colors, a left-to-right gradient across each constituent
 *  color's own hue for 2+ (so WU genuinely reads as white-into-blue, not a single
 *  guessed color). Use for swatches/backgrounds only, never for text: gradient
 *  text is off the table (see DESIGN.md's Do's and Don'ts). */
export function identityGradient(colors: readonly string[]): string {
  const present = WUBRG_ORDER.filter((c) => colors.includes(c));
  if (present.length === 0) return NEUTRAL_ACCENT;
  if (present.length === 1) return anchorHex(present[0]);
  const stops = present.map((c, i) => `${anchorHex(c)} ${Math.round((i / (present.length - 1)) * 100)}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export { WUBRG_ORDER, NEUTRAL_ACCENT };
