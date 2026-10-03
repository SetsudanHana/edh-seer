/** THE SITE'S ARROWS AND CHEVRONS, AS SVG (DESIGN.md: "Don't use a Unicode glyph or emoji as an
 *  icon — draw a small SVG in one consistent stroke"; designer crawl 2026-10-03, #994 item 11).
 *
 *  `↓ ← ↗ › ▸` rendered at whatever weight and size the reader's font chose beside 11px mono caps,
 *  and `↗` -- the external-link arrow -- marked routes inside this site. Sized in `em` so an icon
 *  follows the text it sits in; one 1.5 stroke for all of them. Decorative: the text beside each
 *  says where it goes, so every icon is `aria-hidden`. */
type Dir = "up" | "down" | "left" | "right";

const ROTATE: Record<Dir, number> = { right: 0, down: 90, left: 180, up: 270 };

function Svg({ dir, children }: { dir: Dir; children: React.ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" width="0.8em" height="0.8em" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      className="inline-block shrink-0 align-[-0.05em]" style={{ transform: `rotate(${ROTATE[dir]}deg)` }}>
      {children}
    </svg>
  );
}

/** A line with a head: "go there" (right), "back" (left), "further down this page" (down). */
export function Arrow({ dir }: { dir: Dir }) {
  return <Svg dir={dir}><path d="M1.5 6h9M7 2.5 10.5 6 7 9.5" /></Svg>;
}

/** A head alone: a step in a path (breadcrumb, walk) or a disclosure's state. */
export function Chevron({ dir }: { dir: Dir }) {
  return <Svg dir={dir}><path d="M4.5 2.5 8 6l-3.5 3.5" /></Svg>;
}

/** Opens somewhere OFF this site, in a new tab: the only place the diagonal arrow belongs. */
export function External() {
  return <Svg dir="right"><path d="M5 2.5h4.5V7M9.5 2.5l-7 7" /></Svg>;
}
