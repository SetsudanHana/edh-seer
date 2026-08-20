export interface ManaSymbol {
  /** The original `{…}` token, kept so a caller can fall back to text. */
  raw: string;
  /** Scryfall's symbology file name without extension: "3", "B", "WU", "BP". */
  code: string;
  /** What a screen reader says instead of the picture. */
  label: string;
}

const COLOR_NAMES: Record<string, string> = {
  W: "white", U: "blue", B: "black", R: "red", G: "green", C: "colorless", S: "snow",
};

function labelFor(code: string, raw: string): string {
  if (/^\d+$/.test(code)) return `${code} generic mana`;
  if (code === "X" || code === "Y" || code === "Z") return `${code} generic mana`;
  if (code === "T") return "tap this permanent";
  if (code === "Q") return "untap this permanent";
  if (code.endsWith("P") && code.length === 2) return `one phyrexian ${COLOR_NAMES[code[0]!] ?? code[0]!} mana`;
  if (code.length === 2 && COLOR_NAMES[code[0]!] && COLOR_NAMES[code[1]!]) {
    return `one ${COLOR_NAMES[code[0]!]} or ${COLOR_NAMES[code[1]!]} mana`;
  }
  const name = COLOR_NAMES[code];
  return name ? `one ${name} mana` : raw;
}

/** Split a Scryfall mana cost into renderable symbols. Anything that is not `{…}` comes back as a
 *  single raw symbol so the caller can print it verbatim -- a cost we cannot read must still show
 *  the reader something. */
export function parseManaCost(cost: string): ManaSymbol[] {
  if (!cost) return [];
  const tokens = cost.match(/\{[^}]+\}/g);
  if (!tokens) return [{ raw: cost, code: "", label: cost }];
  return tokens.map((raw) => {
    const code = raw.slice(1, -1).replace(/\//g, "").toUpperCase();
    return { raw, code, label: labelFor(code, raw) };
  });
}
