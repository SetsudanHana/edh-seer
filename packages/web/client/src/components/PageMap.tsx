import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineCard } from "../lib/engine-model.js";
import { useNavigate } from "react-router";
import { pageMap, pickRoundRobin } from "../lib/page-orbit.js";
import { stepRoute } from "../lib/walk-route.js";
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
export function PageMap({ page: ownPage, slug: ownSlug, rows: ownRows, base, pair: ownPair, hrefOf, countNote, loadPage }: {
  page: CardPageData; slug: string; rows?: readonly PartnerRow[]; base: string;
  /** A commander's picked partner, drawn in its own group at the head of the map. */
  pair?: { slug: string; name: string; artCrop: string | null };
  /** Where a card's page is, when not `${base}/<id>`: a commander page's partners are cards, and
   *  going to one leaves this page, and the walk, behind. */
  hrefOf?: (id: string) => string;
  /** What the total counts, where it differs from the card's own page ("a Krenko deck can play"). */
  countNote?: string;
  /** WALK IN PLACE (owner, 2026-09-27: "on the /commander page when I double click the card it does
   *  not go through the constellation it jumps to /cards page"). Where going to a card's page would
   *  leave this surface, a second tap loads that card's partners here instead and the map walks to
   *  it, route and Back as on a card page; the list below stays this page's. "Go to its page" in the
   *  card's menu still leaves. */
  loadPage?: (slug: string) => Promise<CardPageData | null>;
}) {
  // THE CARD WALKED TO, when this page walks in place: its own page data, the middle of the map.
  const [away, setAway] = useState<{ slug: string; page: CardPageData } | null>(null);
  useEffect(() => { setAway(null); }, [ownSlug]);
  const page = away?.page ?? ownPage;
  const slug = away?.slug ?? ownSlug;
  const rows = away ? undefined : ownRows;
  const pair = away ? undefined : ownPair;
  // KEYED ON WHAT THE ROWS SAY, not on the array: a commander page merges its list afresh on every
  // render, and a new map object each time would restart the picture.
  const rowsKey = rows?.map((r) => `${r.slug}|${r.event}|${r.producer ? 1 : 0}`).join("\n") ?? "";
  const pairKey = pair ? `${pair.slug}|${pair.artCrop ?? ""}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const map = useMemo(() => pageMap(page, slug, rows, pair), [page, slug, rowsKey, pairKey]);
  const href = (id: string) => hrefOf?.(id) ?? `${base}/${id}`;
  // The walk is the map staying on screen while its card changes: on this surface's own pages, or in
  // place where the page can load a card's partners itself.
  const walks = !hrefOf || !!loadPage;
  // EVERY CARD SEEN ON THIS WALK, in one object that keeps its identity: the map is rebuilt when
  // this object changes, and it must not change mid-walk.
  const world = useRef<{ cards: Map<string, EngineCard> }>({ cards: new Map() });
  for (const [id, c] of map.cards) if (!world.current.cards.has(id) || id === slug) world.current.cards.set(id, c);
  // EVERY LINK SEEN ON THIS WALK, both ways: each page's card and its partners. The route runs along
  // these (#769), so a step to a card from an earlier page goes back through the pages that reached it.
  const links = useRef(new Map<string, Set<string>>());
  for (const s of map.orbit.sectors) for (const p of s.partners) {
    for (const [a, b] of [[slug, p.card.id], [p.card.id, slug]] as const) {
      const had = links.current.get(a);
      if (had) had.add(b); else links.current.set(a, new Set([b]));
    }
  }
  // THE ROUTE, updated in the render that changes the page, so the map is told the new middle and
  // where it came from in one step. Arriving at a card on the route is going back to it; any other
  // card is a step on, hop by hop along the links seen; a card none of them reach (a search) starts
  // the route again.
  const [walk, setWalk] = useState<{ slug: string; trail: string[] }>({ slug, trail: [] });
  if (walk.slug !== slug) {
    setWalk({ slug, trail: stepRoute(walk.trail, walk.slug, slug, (id) => links.current.get(id) ?? []) });
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
  const leave = (id: string) => { peek?.close(); void navigate(href(id)); };
  const pending = useRef<string | null>(null);
  const go = (id: string) => {
    // A card whose page is on this surface (a commander's pair) is still gone to.
    if (!loadPage || !hrefOf || href(id).startsWith(`${base}/`)) return leave(id);
    peek?.close();
    if (id === ownSlug) { pending.current = null; setAway(null); return; }
    pending.current = id;
    void loadPage(id).then((p) => {
      // Only the last card asked for, and only one that has a page to walk to.
      if (pending.current !== id) return;
      // THE CARD IN THE MIDDLE IS THE ONE BESIDE THE LIST (owner, 2026-09-27: after a walk the
      // panel still read the commander's text, with no way to read the card you walked to).
      if (p) { setAway({ slug: id, page: p }); peek?.push(id); } else leave(id);
    });
  };
  // A TAP ON EMPTY SPACE CLEARS THE PICK (owner, 2026-09-27), and the panel beside the list goes
  // back to the card in the middle: the page's own, or the one walked to.
  const blank = () => {
    setSel(null);
    if (!peek) return;
    if (!away) peek.close();
    else if (peek.stack.at(-1) !== slug) { peek.close(); peek.push(slug); }
  };
  const tap = (id: string) => {
    // The middle card: shown beside the list again when the walk has left the page's own card.
    if (id === slug) { setSel(null); if (away && peek && peek.stack.at(-1) !== id) peek.push(id); return; }
    if (sel === id) go(id);
    else { setSel(id); peek?.push(id); }
  };
  const menuFor = (id: string | null): MenuItem[] => {
    if (id === null) return still ? [] : [{ label: paused ? "Play the motion" : "Pause the motion", run: () => setPaused(!paused) }];
    const c = map.cards.get(id);
    if (!c) return [];
    return [
      ...(id !== slug && peek ? [{ label: "Show it beside the list", run: () => { setSel(id); peek.push(id); } }] : []),
      ...(id !== slug && loadPage && hrefOf && !href(id).startsWith(`${base}/`) ? [{ label: "Walk to it on the map", run: () => go(id) }] : []),
      ...(id !== slug || away ? [{ label: "Go to its page", run: () => leave(id) }] : []),
      { label: "Copy the name", run: () => { void navigator.clipboard?.writeText(c.name).catch(() => {}); } },
    ];
  };
  const picked = pickRoundRobin(map.orbit, mapCap(narrow));
  const shown = picked.length;
  const drawnGroups = new Set(map.orbit.sectors.filter((s) => s.partners.some((p) => picked.some((x) => x.p === p))).map((s) => s.key));
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
          onTap={tap} onHover={setHover} onBlank={blank} menuFor={menuFor} pick={pickRoundRobin}
          label={`${page.name} and ${shown} of the cards it works well with, coloured by the groups below`} />
      </div>
      {/* THE COLOURS' KEY, WHERE THE MAP IS (persona round, 2026-09-27: "each colour is one of the
        *  groups below" pointed at groups a screen away). Each chip is a group drawn on the map. */}
      <ul className="flex flex-wrap gap-1.5" aria-label="What the colours are">
        {map.groups.filter((g) => drawnGroups.has(g.event)).map((g) => (
          <li key={g.event} className="flex min-h-8 items-center gap-1.5 rounded-full border border-(--separator) px-2.5 text-xs">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.hue }} />
            {g.name}
          </li>
        ))}
      </ul>
      <figcaption className="max-w-[65ch] text-sm text-(--muted)">
        {pair ? <>{pair.name} is in pink. </> : null}Each colour is a group, named just above{away ? "" : " and again in the list below"}, and {shown === map.orbit.direct ? "every card in them is here" : `the map shows ${shown} of their ${map.orbit.direct} cards${countNote && !away ? ` ${countNote}` : ""}, a few from each`}.
        {" "}{still || paused ? "Arrows point" : "Moving dashes run along each line"} from the card that makes it happen to the card that uses it. {loadPage && hrefOf
          ? <>Tap a card to see it; tap it again to walk to it on the map, and the cards you walked through stay on it, joined by a gold line. The list below stays {ownPage.name.split(",")[0]}&rsquo;s.</>
          : <>Tap a card to see it; tap it again to go to its page{walks ? ", and the map comes with you: the cards you walked through stay on it, joined by a gold line" : ""}.</>}
        {still ? null : (
          <button type="button" className="ml-2 rounded-(--radius) border border-(--separator) px-2 py-0.5 text-xs hover:border-(--foreground)" aria-pressed={paused} onClick={() => setPaused(!paused)}>
            {paused ? "Play the motion" : "Pause the motion"}
          </button>
        )}
      </figcaption>
    </figure>
  );
}
