import type { ReactNode } from "react";
import { Link } from "react-router";
import type { CardPageData } from "../lib/partners.js";
import { AbilityTable } from "./AbilityTable.js";
import { CardArt } from "./CardArt.js";
import { CardPeek } from "./CardPeek.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { PageFoot } from "./PageFoot.js";
import { PeekContext, usePeekState } from "./peek.js";
import { FaceContext } from "./face.js";
import { useState } from "react";

/** ONE PAGE SHAPE, TWO SURFACES (spec 2026-09-08 part 2). `/cards/<slug>` and `/commanders/<slug>`
 *  were two components with different headings, rail widths and intro copy for the same card; a
 *  reader arriving from the other door re-learned the page. Both now render through this: the
 *  header, the surface tabs, the rail and the foot are here; only the body differs.
 *
 *  THE TABS ARE LINKS, so the URLs, the edge rendering, the structured data and the sitemap rows
 *  do not move. A card that cannot lead a deck gets the card tab alone; the commander URL still
 *  renders (the edge sends `noindex`) and its body says why.
 *
 *  THE RAIL IS THE CARD, OR THE PEEK. Two cards side by side was the report board's
 *  one-covers-the-other problem; while a partner is being looked at, it is the card that matters.
 *  On a phone the peek is `position: fixed` (`index.css`), so rendering it here still shows a
 *  sheet; the rail's own image is hidden under it, which the sheet covers anyway. */
export function CardShell({ page, slug, surface, children, railExtra, peekLoad }: {
  page: CardPageData;
  slug: string;
  surface: "card" | "commander";
  children: ReactNode;
  railExtra?: ReactNode;
  peekLoad?: (slug: string) => Promise<CardPageData | null>;
}) {
  const peek = usePeekState();
  // THE FLIP IS THE PAGE'S, NOT THE PICTURE'S (owner, 2026-09-08): the ability rows turn with it.
  const [back, setBack] = useState(false);
  const faceView = { face: back && page.backArtCrop ? 1 : 0, names: page.name.split(" // ") };
  const tab = (to: string, label: string, current: boolean) => (
    <Link
      to={to}
      aria-current={current ? "page" : undefined}
      className="inline-flex items-center min-h-11 px-3 border-b-2 border-transparent text-(--muted) hover:text-(--foreground) aria-[current=page]:border-(--accent) aria-[current=page]:text-(--foreground)"
    >
      {label}
    </Link>
  );
  return (
    <PeekContext.Provider value={peek}>
    <FaceContext.Provider value={faceView}>
    <article className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-10 lg:items-start max-w-7xl">
      <div className="flex flex-col gap-8 min-w-0">
        <header className="flex flex-col gap-3">
          <h2 className="text-4xl sm:text-5xl font-bold tracking-[-0.02em] flex flex-wrap items-center gap-x-4 gap-y-2">
            {page.name}
            {page.manaCost && <span className="text-2xl sm:text-3xl"><ManaSymbols cost={page.manaCost} /></span>}
          </h2>
          <p className="text-(--muted)">{page.typeLine}</p>
        </header>
        <nav aria-label="Surface" className="flex gap-1 border-b border-(--separator)">
          {tab(`/cards/${slug}`, "As a card", surface === "card")}
          {page.commander && tab(`/commanders/${slug}`, "As a commander", surface === "commander")}
        </nav>
        {children}
        <div className="max-w-[68ch]"><PageFoot /></div>
      </div>
      <aside className="order-first lg:order-last lg:sticky lg:top-[calc(var(--site-header-h,0px)+1.5rem)] flex flex-col gap-6">
        {peek.stack.length > 0
          ? <CardPeek load={peekLoad} />
          : (<>
            <CardArt artCrop={page.artCrop} backArtCrop={page.backArtCrop} name={page.name} back={back} onFlip={() => { setBack((b) => !b); }} />
            {railExtra}
            <div className="hidden lg:flex lg:flex-col gap-3">
              {/* A label, not a heading: the rail is the card's, and a screen reader's heading list
                *  should carry the page's sections, not the rail's captions (cohesion sweep). */}
              <p className="eyebrow text-(--muted)">how the engine reads this card</p>
              <AbilityTable rows={page.abilities} stacked />
            </div>
          </>)}
      </aside>
    </article>
    </FaceContext.Provider>
    </PeekContext.Provider>
  );
}
