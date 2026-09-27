import { useEffect, useMemo, useState } from "react";
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
 *  second opens its page. `base` is the surface's path, `/cards` or `/commanders`. */
export function PageMap({ page, slug, rows, base }: { page: CardPageData; slug: string; rows?: readonly PartnerRow[]; base: string }) {
  const map = useMemo(() => pageMap(page, slug, rows), [page, slug, rows]);
  const narrow = useNarrow();
  const still = useReducedMotion();
  const [paused, setPaused] = usePaused();
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const peek = usePeek();
  const navigate = useNavigate();
  useEffect(() => { setSel(null); setHover(null); }, [slug]);
  const go = (id: string) => { void navigate(`${base}/${id}`); };
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
  if (shown < 3) return null;
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="max-w-[min(100%,calc((100svh-12rem)*1.2222))]">
        <Constellation model={map} orbit={map.orbit} trail={[]} lit={sel ?? hover} still={still || paused} narrow={narrow}
          onTap={tap} onHover={setHover} menuFor={menuFor} pick={pickRoundRobin}
          label={`${page.name} and ${shown} of the cards it works well with, coloured by the groups below`} />
      </div>
      <figcaption className="max-w-[65ch] text-sm text-(--muted)">
        Each colour is one of the groups below, and {shown === map.orbit.direct ? "every card in them is here" : `the map shows ${shown} of their ${map.orbit.direct} cards, a few from each`}.
        {" "}{still || paused ? "Arrows point" : "Ticks run"} from the card that makes it happen to the card that uses it. Tap a card to see it; tap it again to go to its page.
        {still ? null : (
          <button type="button" className="ml-2 rounded-(--radius) border border-(--separator) px-2 py-0.5 text-xs hover:border-(--foreground)" aria-pressed={paused} onClick={() => setPaused(!paused)}>
            {paused ? "Play the motion" : "Pause the motion"}
          </button>
        )}
      </figcaption>
    </figure>
  );
}
