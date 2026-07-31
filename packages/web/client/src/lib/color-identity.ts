export type ColorLetter = "W" | "U" | "B" | "R" | "G";

const WUBRG_ORDER: ColorLetter[] = ["W", "U", "B", "R", "G"];

/** Anchor hue per color, degrees. Chosen for spread and legibility against
 *  the ink background, not for literal WUBRG pip color-matching. */
const ANCHOR_HUE: Record<ColorLetter, number> = { W: 45, U: 205, B: 275, R: 8, G: 132 };

/** The neutral/no-identity accent's own HSL — the S/L every identity color
 *  holds constant (only hue rotates). */
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

/** Circular mean of the constituent colors' anchor hues — multicolor identities
 *  land between their component hues rather than needing 32 hand-picked values. */
export function identityColor(colors: readonly string[]): string {
  const present = WUBRG_ORDER.filter((c) => colors.includes(c));
  if (present.length === 0) return NEUTRAL_ACCENT;
  let x = 0;
  let y = 0;
  for (const c of present) {
    const rad = (ANCHOR_HUE[c] * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return hslToHex(hue, ACCENT_SATURATION, ACCENT_LIGHTNESS);
}

export { WUBRG_ORDER, NEUTRAL_ACCENT };
