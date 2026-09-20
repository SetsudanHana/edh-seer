/** A LOYALTY COST AS THE CARD PRINTS IT (owner, 2026-09-08): the badge with the signed number in
 *  it. Scryfall's card-symbol set has no loyalty badge (`+1.svg` and `-1.svg` both 404, checked the
 *  same day), which is why this was the site's own hand-drawn SVG for twelve days.
 *
 *  IT IS MANA'S BADGE NOW (owner, 2026-09-20). The font ships the real ones -- `loyalty-up`,
 *  `loyalty-down`, `loyalty-zero`, `loyalty-start` -- and they are the shapes the printed card
 *  uses.
 *
 *  AND THAT SETTLED A QUESTION THIS FILE GOT WRONG. On 2026-09-20 the three silhouettes were
 *  collapsed into one on the claim that a planeswalker prints a single badge and the sign carries
 *  the meaning. That claim was asserted and never checked, and it is false: mana ships four
 *  SEPARATE glyphs because the card draws them separately -- `loyalty-up` peaks upward,
 *  `loyalty-down` points downward, `loyalty-zero` is a flat slab. The one-shape version shipped in
 *  PR #409 and is reverted here; the sizing fix from the same PR is kept, because the proportion
 *  really was wrong.
 *
 *  THE NUMBER STAYS REAL TEXT. mana renders it as `:after` content in MPlantin, which is a CSS
 *  string a screen reader does not reliably get and a second 280 KB font we would have to ship.
 *  Ours is a real text node over the glyph, so "minus 7 loyalty" is what gets announced -- the
 *  property the hand-drawn SVG had and the reason not to take mana's own markup wholesale. */

/** `+2`, `-7`, `0` -- and `X`, which Chandra, Awakened Inferno prints as `−X` and which digits-only
 *  refused, so one card rendered a badge for one ability and bare monospace for the next. */
const LOYALTY = /^([+−-]?)(\d+|X)$/;

export function isLoyaltyCost(cost: string): boolean {
  return LOYALTY.test(cost.trim());
}

export function LoyaltyCost({ cost }: { cost: string }): React.JSX.Element {
  const m = LOYALTY.exec(cost.trim());
  if (!m) return <span className="font-mono text-sm">{cost}</span>;
  const sign = m[1] === "+" ? "+" : m[1] === "" ? "" : "−";
  const n = m[2]!;
  const label = `${sign === "+" ? "plus " : sign === "−" ? "minus " : ""}${n} loyalty`;
  const shape = sign === "+" ? "up" : sign === "−" ? "down" : "zero";
  // THE SIZE GOES ON THE WRAPPER, NOT ON THE GLYPH, and that is not a style preference.
  // mana's CSS is UNLAYERED and Tailwind v4 emits its utilities inside `@layer utilities`; an
  // unlayered rule beats a layered one whatever the source order, so `.ms { font-size: inherit }`
  // silently won over a `text-[2.4em]` put on the `<i>` and the badge rendered at body size with
  // the number invisible inside it. Sized here, `.ms` inherits it and the cascade is not a fight.
  //
  // AND 1.6em, NOT 2.4em, BECAUSE MANA MULTIPLIES AGAIN. `.ms-loyalty-*` carries its own
  // `font-size: 1.5em`, also unlayered, so 2.4em rendered a 43px badge that broke the line it sat
  // on. 1.6 x 1.5 lands on the 29px badge with a 13px digit that was measured right against 16px
  // body text. Both numbers are measured in the browser, not derived -- the 1.5em is mana's and
  // could change under us.
  return (
    <span role="img" aria-label={label} className="relative inline-flex items-center justify-center align-middle text-[1.6em] leading-none">
      {/* The badge. `aria-hidden` so the private-use codepoint itself never reaches the
        * accessibility tree -- the wrapper's label is the whole accessible name. */}
      <i
        className={`ms ms-loyalty-${shape}`}
        aria-hidden="true"
        // AND THE COLOUR HAS TO BE AN INLINE STYLE, for the same cascade reason as the size above:
        // mana hardcodes `color:#111` on `.ms-loyalty-*`, unlayered, so it beats any Tailwind
        // `text-*` utility. #111 on this theme's near-black ground is an invisible badge -- which
        // is exactly how it rendered. The printed card is a light number on a dark badge; on a
        // dark page the badge has to be the light half, so the two swap and the number goes dark.
        style={{ color: "var(--foreground)" }}
      />
      {/* The number, centred on the badge, in the dark the printed badge uses. `pointer-events-none`
        * so it never eats a click meant for the row, and `tabular-nums` so "+1" and "+10" sit the
        * same way. Sized against the BADGE (0.4 of it), so the two scale together. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center font-mono tabular-nums font-semibold text-[0.68em] text-(--background) pointer-events-none"
      >
        {`${sign}${n}`}
      </span>
    </span>
  );
}
