/** A LOYALTY COST AS THE CARD PRINTS IT (owner, 2026-09-08): the shield with the signed number
 *  inside. Scryfall's card-symbol set has no loyalty badge (`+1.svg` and `-1.svg` both 404, checked
 *  the same day), so this is the site's own drawing -- one inline SVG, sized in em so it scales
 *  with the row, coloured from the site's tokens, and the number is REAL TEXT so a screen reader
 *  reads "minus 7 loyalty" rather than a private-use glyph. Anything that is not a signed integer
 *  renders as the plain monospace cost it always was. */
const LOYALTY = /^([+−-]?)(\d+)$/;

export function isLoyaltyCost(cost: string): boolean {
  return LOYALTY.test(cost.trim());
}

export function LoyaltyCost({ cost }: { cost: string }): React.JSX.Element {
  const m = LOYALTY.exec(cost.trim());
  if (!m) return <span className="font-mono text-sm">{cost}</span>;
  const sign = m[1] === "+" ? "+" : m[1] === "" ? "" : "−";
  const n = m[2]!;
  const label = `${sign === "+" ? "plus " : sign === "−" ? "minus " : ""}${n} loyalty`;
  // Up-pointing shield for a plus, down-pointing for a minus, flat for zero: the shapes the card
  // frame uses, so a reader who knows the card recognises the row.
  const path = sign === "+"
    ? "M4 6 L12 1 L20 6 L20 17 Q12 23 4 17 Z"
    : sign === "−"
    ? "M4 7 Q12 1 20 7 L20 18 L12 23 L4 18 Z"
    : "M4 5 Q12 1 20 5 L20 19 Q12 23 4 19 Z";
  return (
    <span role="img" aria-label={label} className="inline-flex items-center align-baseline">
      <svg viewBox="0 0 24 24" className="h-[1.6em] w-[1.6em]" aria-hidden="true" focusable="false">
        <path d={path} fill="var(--surface-tertiary)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <text x="12" y="13" textAnchor="middle" dominantBaseline="middle" fontSize="9.5" fontWeight="600" fontFamily="JetBrains Mono, ui-monospace, monospace" fill="currentColor">{`${sign}${n}`}</text>
      </svg>
    </span>
  );
}
