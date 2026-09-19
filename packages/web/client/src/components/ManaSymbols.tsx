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

/** Scryfall's symbology SVGs. The board already loads card art from Scryfall at runtime
 *  (`cardImageUrl`), so this adds no new external dependency -- and roughly 25 distinct symbols
 *  cover a whole deck, so the browser caches them after first paint.
 *
 *  A WEBFONT WAS REJECTED: mana-font renders symbols as private-use glyphs, so a screen reader
 *  receives nothing and the 390px legibility problem the phone persona reported gets worse. */
const SYMBOL_URL = (code: string): string => `https://svgs.scryfall.io/card-symbols/${code}.svg`;

export function ManaSymbols({ cost }: { cost: string }): React.JSX.Element {
  const symbols = parseManaCost(cost);
  if (symbols.length === 0) return <span className="text-(--muted)">—</span>;
  return (
    <span role="img" aria-label={symbols.map((s) => s.label).join(", ")} className="inline-flex items-center gap-0.5">
      {symbols.map((s, i) =>
        s.code
          ? (
            // Sized in em so a symbol scales with the row it sits in rather than fighting it.
            <img
              key={`${s.raw}-${i}`}
              src={SYMBOL_URL(s.code)}
              alt={s.label}
              className="inline-block"
              style={{ width: "0.95em", height: "0.95em" }}
            />
          )
          : <span key={`${s.raw}-${i}`}>{s.raw}</span>,
      )}
    </span>
  );
}

/** THE SAME SYMBOLS, INSIDE A SENTENCE (owner, 2026-09-20, on the deployed card page).
 *
 *  `ManaSymbols` takes a cost that is symbols and nothing else. A derived ability's COST ROW is not
 *  that -- "{T}, Sacrifice an artifact" is half cost and half English -- and neither is a printed
 *  line: "Noncreature spells you cast cost {X} less to cast." Both rendered their braces verbatim
 *  a few pixels from the card image drawing the real symbols, which reads as the page failing to
 *  load rather than as engine vocabulary.
 *
 *  SPLIT, DON'T MATCH. `parseManaCost` keeps only the tokens, so it cannot serve here: the words
 *  BETWEEN the symbols are most of the string. This splits on the same token shape and keeps both
 *  halves, so a string with no symbol in it comes back as exactly itself -- which is what a loyalty
 *  cost ("+1") and a keyword line ("Haste") need, and why this can be applied to every row without
 *  first asking whether the row has a symbol in it. */
export function ManaText({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/(\{[^}]+\})/).filter((p) => p !== "");
  return (
    <>
      {parts.map((part, i) => {
        if (!/^\{[^}]+\}$/.test(part)) return <span key={i}>{part}</span>;
        const code = part.slice(1, -1).replace(/\//g, "").toUpperCase();
        const label = labelFor(code, part);
        return (
          <img
            key={i}
            src={SYMBOL_URL(code)}
            alt={label}
            className="inline-block align-[-0.1em]"
            style={{ width: "0.95em", height: "0.95em" }}
          />
        );
      })}
    </>
  );
}
