/** A LOYALTY COST AS THE CARD PRINTS IT (owner, 2026-09-08): the shield with the signed number
 *  inside. Scryfall's card-symbol set has no loyalty badge (`+1.svg` and `-1.svg` both 404, checked
 *  the same day), so this is the site's own drawing -- one inline SVG, sized in em so it scales
 *  with the row, coloured from the site's tokens, and the number is REAL TEXT so a screen reader
 *  reads "minus 7 loyalty" rather than a private-use glyph. Anything that is not a signed integer
 *  renders as the plain monospace cost it always was.
 *
 *  SIZED TO BE READ. The first cut was 1.6em: measured live at desktop, a 26px badge with 12px
 *  digits beside 16px text, and the owner asked for it bigger the same evening (2026-09-08).
 *  2.4em and an 11-unit glyph put the digits above the row's own text size. */
/** `+2`, `-7`, `0` -- and `X`, which Chandra, Awakened Inferno prints as `−X` and which digits-only
 *  refused, so one card rendered a badge for one ability and bare monospace for the next. */
const LOYALTY = /^([+\u2212-]?)(\d+|X)$/;

export function isLoyaltyCost(cost: string): boolean {
  return LOYALTY.test(cost.trim());
}

export function LoyaltyCost({ cost }: { cost: string }): React.JSX.Element {
  const m = LOYALTY.exec(cost.trim());
  if (!m) return <span className="font-mono text-sm">{cost}</span>;
  const sign = m[1] === "+" ? "+" : m[1] === "" ? "" : "−";
  const n = m[2]!;
  const label = `${sign === "+" ? "plus " : sign === "\u2212" ? "minus " : ""}${n} loyalty`;
  // ONE SHAPE, AND THE SIGN CARRIES THE MEANING (owner, 2026-09-20). The first cut drew three
  // silhouettes -- a shield pointing up for a plus, down for a minus, flat for zero -- on the
  // reasoning that the card frame does the same. It does not: a planeswalker prints ONE badge, the
  // down-pointing shield, for every loyalty cost it has and for its starting loyalty, and the
  // printed `+` or `−` is the whole difference. Three marks read as three different things.
  const path = "M3.5 3.5 H20.5 V13 L12 22 L3.5 13 Z";
  return (
    <span role="img" aria-label={label} className="inline-flex items-center align-baseline">
      <svg viewBox="0 0 24 24" className="h-[2.4em] w-[2.4em]" aria-hidden="true" focusable="false">
        <path d={path} fill="var(--surface-tertiary)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <text x="12" y="10.5" textAnchor="middle" dominantBaseline="middle" fontSize="11" fontWeight="600" fontFamily="JetBrains Mono, ui-monospace, monospace" fill="currentColor">{`${sign}${n}`}</text>
      </svg>
    </span>
  );
}
