import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineCard } from "../lib/engine-model.js";
import { useNavigate } from "react-router";
import { pageMap, pickRoundRobin } from "../lib/page-orbit.js";
import type { CardPageData, PartnerRow } from "../lib/partners.js";
import type { MenuItem } from "./card-menu.js";
import { Constellation, mapCap } from "./Constellation.js";
import { useNarrow } from "./engine-parts.js";
import { usePaused, useReducedMotion } from "./OrbitView.js";
import { usePeek } from "./peek.js";

/** THE MAP ON A CARD PAGE (owner, 2026-09-27: "including graph on /cards and /commander pages", so
 *  the map becomes the site's identity rather than one chapter's picture). The page's card in the
 *  middle, its partners around it in their group's colour, ticks running from the card that makes
 *  the event happen to the card that uses it. The list below stays the page: it is what a search
 *  engine reads and what a screen reader or a slow phone gets; the map draws it.
 *
 *  A TAP SHOWS, A SECOND TAP GOES: the first shows the card beside the list, as a tile does; the
 *  second opens its page. `base` is the surface's path, `/cards` or `/commanders`.
 *
 *  AND THE MAP COMES ALONG. The page component stays mounted when its slug changes, so the map does
 *  too: the card you went to moves to the middle, its partners grow out around it, the one you left
 *  stays where it was with a gold route through every card you walked, and Back walks the route
 *  backwards. One map of the whole card pool, a page at a time. */
export function PageMap({ page, slug, rows, base }: { page: CardPageData; slug: string; rows?: readonly PartnerRow[]; base: string }) {
  const map = useMemo(() => pageMap(page, slug, rows), [page, slug, rows]);
  // EVERY CARD SEEN ON THIS WALK, in one object that keeps its identity: the map is rebuilt when
  // this object changes, and it must not change mid-walk.
  const world = useRef<{ cards: Map<string, EngineCard> }>({ cards: new Map() });
  for (const [id, c] of map.cards) if (!world.current.cards.has(id) || id === slug) world.current.cards.set(id, c);
  // THE ROUTE, updated in the render that changes the page, so the map is told the new middle and
  // where it came from in one step. Arriving at the card the route last came from is going back.
  const [walk, setWalk] = useState<{ slug: string; trail: string[] }>({ slug, trail: [] });
  if (walk.slug !== slug) {
    const back = walk.trail.at(-1) === slug;
    setWalk({ slug, trail: back ? walk.trail.slice(0, -1) : [...walk.trail.filter((x) => x !== slug && x !== walk.slug), walk.slug].slice(-6) });
  }
  const trail = walk.slug === slug ? walk.trail : [];
  const narrow = useNarrow();
  const still = useReducedMotion();
  const [paused, setPaused] = usePaused();
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const peek = usePeek();
  const navigate = useNavigate();
  useEffect(() => { setSel(null); setHover(null); }, [slug]);
  // The preview was of the card you are now going to: its page replaces it.
  const go = (id: string) => { peek?.close(); void navigate(`${base}/${id}`); };
  const tap = (id: string) => {
    if (id === slug) { setSel(null); return; }
    if (sel === id) go(id);
    else { setSel(id); peek?.push(id); }
  };
  const menuFor = (id: string | null): MenuItem[] => {
    if (id === null) return still ? [] : [{ label: paused ? "Play the motion" : "Pause the motion", run: () => setPaused(!paused) }];
    const c = map.cards.get(id);
    if (!c) return [];
    return [
      ...(id !== slug && peek ? [{ label: "Show it beside the list", run: () => { setSel(id); peek.push(id); } }] : []),
      ...(id !== slug ? [{ label: "Go to its page", run: () => go(id) }] : []),
      { label: "Copy the name", run: () => { void navigator.clipboard?.writeText(c.name).catch(() => {}); } },
    ];
  };
  const shown = pickRoundRobin(map.orbit, mapCap(narrow)).length;
  // A thin page still shows the map once there is a route on it: it is where the walk is.
  if (shown < 3 && !trail.length) return null;
  const prev = trail.length ? world.current.cards.get(trail.at(-1)!) : undefined;
  return (
    <figure className="m-0 flex flex-col gap-2">
      {prev ? (
        <button type="button" className="min-h-11 self-start rounded-(--radius) border border-(--separator) px-3 text-sm hover:border-(--foreground)" onClick={() => go(prev.id)}>
          ← Back to {prev.name}
        </button>
      ) : null}
      <div className="max-w-[min(100%,calc((100svh-12rem)*1.2222))]">
        <Constellation model={world.current} orbit={map.orbit} trail={trail} lit={sel ?? hover} still={still || paused} narrow={narrow}
          onTap={tap} onHover={setHover} menuFor={menuFor} pick={pickRoundRobin}
          label={`${page.name} and ${shown} of the cards it works well with, coloured by the groups below`} />
      </div>
      <figcaption className="max-w-[65ch] text-sm text-(--muted)">
        Each colour is one of the groups below, and {shown === map.orbit.direct ? "every card in them is here" : `the map shows ${shown} of their ${map.orbit.direct} cards, a few from each`}.
        {" "}{still || paused ? "Arrows point" : "Ticks run"} from the card that makes it happen to the card that uses it. Tap a card to see it; tap it again to go to its page, and the map comes with you: the cards you walked through stay on it, joined by a gold line.
        {still ? null : (
          <button type="button" className="ml-2 rounded-(--radius) border border-(--separator) px-2 py-0.5 text-xs hover:border-(--foreground)" aria-pressed={paused} onClick={() => setPaused(!paused)}>
            {paused ? "Play the motion" : "Pause the motion"}
          </button>
        )}
      </figcaption>
    </figure>
  );
}
