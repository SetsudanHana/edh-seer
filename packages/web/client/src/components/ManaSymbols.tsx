export interface ManaSymbol {
  /** The original `{…}` token, kept so a caller can fall back to text. */
  raw: string;
  /** Scryfall's symbology code, slashes removed and upper-cased: "3", "B", "WU", "BP". */
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

/** IS THIS ACTUALLY A SYMBOL CODE? A brace is not a promise that what is inside it is one.
 *  `ManaText` reads printed clause text, so the token is whatever the card -- or a corpus defect --
 *  put there. It used to go straight into a Scryfall URL, which CodeQL called on PR #409
 *  (`js/xss-through-dom`): `{../../x}` gave `.../card-symbols/../../x.svg`. Nothing is fetched per
 *  symbol any more, so the traversal is gone with the URL -- but the guard stays, because an
 *  unknown token must not become an unknown CSS CLASS either, and because what a reader should see
 *  for a token we cannot read is the text the card printed. */
export function isSymbolCode(code: string): boolean {
  return /^[A-Z0-9]{1,5}$/.test(code);
}

/** THE SYMBOL SET IS MANA (owner, 2026-09-20: "why not incorporate mana font? Moxfield uses it,
 *  other websites use it as well"), replacing one Scryfall SVG request per symbol.
 *
 *  THE OBJECTION THAT WAS RECORDED HERE DID NOT SURVIVE. It read "a webfont was rejected:
 *  mana-font renders symbols as private-use glyphs, so a screen reader receives nothing" -- true of
 *  the glyph, and irrelevant to this site, because every symbol on it renders through the two
 *  functions BELOW and nowhere else. The `role="img"` and the `aria-label` are applied in one
 *  place whichever way the mark is drawn; the comment was written as though bare `<i>` tags would
 *  be scattered through the components, and there is nowhere to scatter them. `aria-hidden` on the
 *  glyph span keeps the private-use codepoint itself out of the accessibility tree.
 *
 *  AND IT BUYS THE THING SCRYFALL'S SET DOES NOT HAVE. There is no loyalty badge in Scryfall's
 *  symbology (`+1.svg` and `-1.svg` both 404, checked 2026-09-08), which is the whole reason
 *  `LoyaltyCost` was drawing its own shield by hand.
 *
 *  SELF-HOSTED. `mana-font` is an npm dependency Vite bundles; nothing is fetched from jsDelivr,
 *  so the site keeps its "no third-party at runtime" property and loses the per-symbol round trip
 *  it used to pay Scryfall.
 *
 *  THE CLASS IS THE CODE, LOWER-CASED, with exactly two exceptions: mana calls `{T}` `ms-tap` and
 *  `{Q}` `ms-untap`. Everything else -- `w`, `u`, `b`, `r`, `g`, `c`, `s`, `x`, `0`-`20`, the
 *  hybrids (`wu`) and the phyrexians (`bp`) -- is the Scryfall code in lower case. Checked against
 *  all 565 classes in `mana.min.css`, not assumed. */
const CLASS_EXCEPTIONS: Record<string, string> = { T: "tap", Q: "untap" };

export function manaClass(code: string): string {
  return CLASS_EXCEPTIONS[code] ?? code.toLowerCase();
}

/** One symbol. `ms-cost` is the coloured disc a printed cost sits in -- the part Scryfall's SVG
 *  drew into the image and the bare glyph does not.
 *
 *  `silent` IS THE WHOLE ACCESSIBILITY DESIGN, and the two callers want opposite things. A MANA
 *  COST is one fact -- announcing "{5}{B}{B}" as three separate images makes a reader assemble it
 *  themselves -- so `ManaSymbols` labels the WRAPPER and silences the glyphs. A symbol INSIDE A
 *  SENTENCE is not: "{T}, Sacrifice an artifact" has words between the marks, and a wrapper label
 *  would have to swallow the sentence to hold them together, so `ManaText` labels each glyph where
 *  it sits. The old Scryfall markup did BOTH at once and announced every cost twice. */
function Glyph({ code, label, silent }: { code: string; label: string; silent?: boolean }): React.JSX.Element {
  return (
    <i
      {...(silent ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      className={`ms ms-cost ms-${manaClass(code)}`}
    />
  );
}

export function ManaSymbols({ cost }: { cost: string }): React.JSX.Element {
  const symbols = parseManaCost(cost);
  if (symbols.length === 0) return <span className="text-(--muted)">—</span>;
  return (
    <span role="img" aria-label={symbols.map((s) => s.label).join(", ")} className="inline-flex items-center gap-0.5">
      {symbols.map((s, i) =>
        s.code && isSymbolCode(s.code)
          ? <Glyph key={`${s.raw}-${i}`} code={s.code} label={s.label} silent />
          : <span key={`${s.raw}-${i}`} aria-hidden="true">{s.raw}</span>,
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
        if (!isSymbolCode(code)) return <span key={i}>{part}</span>;
        return <Glyph key={i} code={code} label={labelFor(code, part)} />;
      })}
    </>
  );
}
