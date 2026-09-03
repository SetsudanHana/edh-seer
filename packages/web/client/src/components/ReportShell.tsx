import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router";
import type { AnalyzeResponse } from "../types.js";
import { createArtLoader, type ArtLoader } from "./art-loader.js";
import { cachedImageLoad } from "./art-cache.js";
import { cardImageUrl } from "./card-node.js";
import { ReportChapters } from "./ReportChapters.js";
import { ReportHeader } from "./ReportHeader.js";
import { CardList } from "./CardList.js";
import { MissingCards } from "./MissingCards.js";
import { ComboList } from "./ComboList.js";
/** THE BOARD IS A ROUTE, SO IT LOADS LIKE ONE. `GraphView` is the largest module in the client --
 *  145kB of source on its own, plus `board-force.ts` and d3-selection, d3-transition and d3-zoom
 *  behind it, about 250kB of the 2.4MB the build's sourcemap maps -- and it mounts ONLY on `/graph`.
 *  Every reader who never opened the board was still paying for it in the first byte of the report.
 *
 *  `GraphList` stays eager: it is the narrow-width fallback that renders INSTEAD of the board on a
 *  phone, so lazy-loading it would trade a bundle saving for a spinner on the surface that exists
 *  because the board cannot be used there at all. */
const GraphView = lazy(() => import("./GraphView.js").then((m) => ({ default: m.GraphView })));
/** `EgoView` IMPORTS `GraphView` STATICALLY, so it has to load the same way or the split above is a
 *  no-op: a static importer anywhere in the eager graph pulls the module back into the entry chunk,
 *  which is exactly what vite's INEFFECTIVE_DYNAMIC_IMPORT warning was saying. Both are `/graph`
 *  only, so both are lazy and `GraphView` becomes the chunk they share. */
const EgoView = lazy(() => import("./EgoView.js").then((m) => ({ default: m.EgoView })));
import { GraphList } from "./GraphList.js";
import { useBoardMode } from "../lib/use-board-mode.js";
import { CardDrawerProvider } from "./card-drawer.js";
import type { RunDiff } from "../lib/run-diff.js";
import { unreadCardNames } from "../lib/unread.js";

/** THE REPORT'S SHELL: the sticky header, the scroll, and the three reference surfaces that are
 *  NOT part of it.
 *
 *  Graph, Cards and Combos stop being tabs and become routes. They are surfaces a reader EXPLORES
 *  rather than reads in order — the graph in particular wants the whole viewport — and as tabs they
 *  cost the browser's own back button: pressing back from the graph left the report entirely.
 *
 *  THE PATHS CARRY THE SURFACE, NOT A REPORT ID. `docs/ANALYZER-JOURNEY.md` and roadmap S7 both
 *  write `/report/:id/graph`, and that id does not exist: an analysis is client state, the only URL
 *  state is `#deck=<payload>` (the deck itself, `lib/share.ts`), and nothing persists a report to
 *  mint an id against. `/graph` says everything the id would have, until a report is something the
 *  server can be asked for by name.
 *  CEILING: a static host with no SPA rewrite 404s on a direct `/graph` load. Every SHARED link is
 *  `/` plus the deck hash, so this only bites a reader who bookmarks a reference surface. */
/** HOW MANY ADDED CARDS ARE WORTH PRE-PINNING (roadmap S9). `diffRuns` calls a run "the same deck"
 *  down to 50% overlap, which admits a 40-card swap -- and 40 pinned cards light most of the report,
 *  contradicting the rule this header already follows in two places: a mark that is always present
 *  marks nothing. Over the cap nothing is seeded and the header line still says "+14". */
export const SEED_CAP = 8;

export function ReportShell({ data, diff }: { data: AnalyzeResponse; diff?: RunDiff | null }) {
  // THE CARDS THIS EDIT ADDED, LIT IN EVERY CHAPTER without the reader hunting for them.
  const seedPins = diff && diff.added.length > 0 && diff.added.length <= SEED_CAP ? diff.added : undefined;
  // WHICH GRAPH SURFACE THIS DEVICE GETS (roadmap R1). Not a width: see `use-board-mode.ts` for why
  // the pointer term is load-bearing and why 639px was a lucky guess. On a coarse pointer the
  // Graph surface is the LIST, and the board is one tap from a row -- one card's local graph
  // owning the viewport, rather than the whole-deck cloud at 14.7px a disc.
  const boardMode = useBoardMode(data.graph?.nodes.length ?? 0);
  /** The card whose local graph is open, or null for the list.
   *  CEILING: component state, so it does not survive a reload and the browser back button leaves
   *  the report rather than leaving this view -- the same cost S7 paid to make Graph a route.
   *  Upgrade path is `/graph/:cardName`, which is also what a breadcrumb would need. */
  const [focusId, setFocusId] = useState<string | null>(null);
  // Which cards the synergy engine could not read. Computed once here because BOTH graph surfaces
  // want it and only one of them (`GraphView`) is handed the report — see `lib/unread.ts` for why
  // the rule lives in one place.
  const unread = useMemo(() => unreadCardNames(data.report.cards), [data.report]);
  // THE ART LOADER OUTLIVES THE GRAPH SURFACE, and that is the whole point of it living here.
  //
  // `<GraphView>` mounts only on `/graph`, so nothing requested a single image until the user
  // opened it — and then all ~95 discs queued at once, 75ms apart, while they waited. Every
  // `artCrop` URL arrives with the analyze response, and the user is reading the chapters for
  // seconds before they ever reach the board: that time was thrown away.
  //
  // Owned here rather than made a module singleton so its lifetime is the REPORT's. A singleton
  // would accumulate decoded images for every deck analysed in a session, with nothing to say when
  // they stop mattering.
  // CARD NAME TO ART, for every surface that is not the board. The URLs already arrive with the
  // analyze response (`graph.nodes[].artCrop`) and the loader above is already warming them, so a
  // table thumbnail and a grid card cost no request the board was not going to make anyway.
  //
  // A TOKEN NEVER WINS A NAME COLLISION — 92 of 661 distinct token names are also a real card, and
  // every consumer of this map is naming a card from the DECK. Same rule `CardDrawerProvider`
  // keeps two files over.
  const artByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of data.graph?.nodes ?? []) if (!n.isToken && n.artCrop && !m.has(n.label)) m.set(n.label, n.artCrop);
    return m;
  }, [data.graph]);
  const artLoaderRef = useRef<ArtLoader>(undefined);
  artLoaderRef.current ??= createArtLoader({ load: cachedImageLoad() });
  useEffect(() => {
    const loader = artLoaderRef.current!;
    const nodes = data.graph?.nodes ?? [];
    // Non-urgent by construction: this is background warming, and anything the user is actually
    // looking at (a hovered card, a card-mode card) jumps this queue via `request(url, true)`.
    for (const n of nodes) if (n.artCrop) loader.request(n.artCrop);

    // THEN the full card images, which are a DIFFERENT file from the disc art — card mode draws
    // `/normal/`, the discs are `/art_crop/`. Warming only the discs is why "zoom in and wait"
    // survived the first attempt at this: the board was warm and the card image had never been
    // requested at all. Queueing them AFTER means they never delay anything visible — the queue is
    // FIFO, so every disc is already ahead of them, and the viewport/hover prefetch promotes
    // whichever one the user actually approaches.
    //
    // Costs roughly 1.5x the disc bytes again (~7.5MB on a 100-card deck), spent while the user
    // reads the chapters rather than while they wait for anything. Skipped on a metered or
    // explicitly data-saving connection, where speculative megabytes are not ours to spend: the
    // prefetch path still covers the card being zoomed into, it just pays for it on arrival.
    const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || /^(slow-)?2g$/.test(conn?.effectiveType ?? "")) return;
    for (const n of nodes) if (n.artCrop) loader.request(cardImageUrl(n.artCrop));
  }, [data]);

  useScrollMemory();
  // A NEW ANALYSIS OPENS ON THE CHAPTERS. Without this a reader who left the graph open, edited
  // their list and re-analysed came back to the graph — the one surface that answers none of the
  // six questions a fresh report is for.
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname !== "/") navigate("/", { replace: true });
    // Keyed on the REPORT, not on the path: re-running this when the path changes would make every
    // reference surface unreachable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    // Every card name under here can open the inspector; the graph keeps its own in-canvas one.
    <CardDrawerProvider graph={data.graph} seedPins={seedPins}>
      <div className="flex flex-col">
        {/* THE SUMMARY ON EVERY SURFACE, chapters and reference alike — the split where
          *  `HeadlineScores` lived inside one tab and the coverage gate above the strip is what
          *  this resolves. */}
        <ReportHeader data={data} diff={diff} />
        {/* OUTSIDE THE CHAPTERS, ON EVERY SURFACE. A line the engine never matched to a card is not
          *  a property of any one chapter — the report simply does not contain those cards — and it
          *  is the one failure the reader can fix by editing their paste. It stayed visible across
          *  every tab before the tabs died; it stays visible across every route now. */}
        {data.missing.length > 0 ? <div className="pt-4"><MissingCards missing={data.missing} /></div> : null}
        {/* NESTED UNDER `/analysis` (2026-09-03). The child paths are UNCHANGED -- `graph`,
          *  `cards`, `combos` are relative, so moving the parent moves all three and the
          *  `<Route path="*">` fallback inside keeps meaning "a path under /analysis this app
          *  does not have is the report".
          *  THE OUTER `*` IS WHY A BARE `/#deck=...` STILL RENDERS. A share link's path is only a
          *  hint about which surface to open; the deck is in the hash, so any path that is not an
          *  /analysis surface is still the chapters. */}
        <Routes>
          <Route path="/analysis">
            <Route index element={<ReportChapters data={data} diff={diff} />} />
            <Route
              path="graph"
              element={
                <Reference>
                  {/* A HEIGHT, NOT A SPINNER. The board is the tallest thing this app draws, and a
                    * fallback shorter than what replaces it is a layout shift on arrival -- the exact
                    * defect the `#root` reserve one file over exists to remove. The message says what
                    * is happening, because a blank box of this size reads as a failure.
                    * One boundary over both branches: `GraphList` suspends on nothing, and the ego
                    * board and the whole-deck board are the same wait for the same chunk. */}
                  <Suspense fallback={
                    <div className="flex items-center justify-center min-h-[70svh] text-(--muted) eyebrow">
                      loading the board
                    </div>
                  }>
                    {boardMode === "ego"
                      ? (focusId
                        ? (
                          <EgoView
                            graph={data.graph}
                            report={data.report}
                            focusId={focusId}
                            onFocus={setFocusId}
                            onBack={() => setFocusId(null)}
                            artLoader={artLoaderRef.current}
                          />
                        )
                        : <GraphList graph={data.graph} unread={unread} onOpenBoard={setFocusId} />)
                      : <GraphView graph={data.graph} report={data.report} artLoader={artLoaderRef.current} />}
                  </Suspense>
                </Reference>
              }
            />
            <Route
              path="cards"
              element={
                <Reference>
                  <CardList cards={data.report.cards} artByName={artByName} coverage={data.report.coverage} />
                </Reference>
              }
            />
            <Route path="combos" element={<Reference><ComboList combos={data.report.combos} /></Reference>} />
            {/* A path this app does not have is the REPORT, not an error page: the deck is in the
              *  hash and the chapters are what it is for. */}
            <Route path="*" element={<ReportChapters data={data} diff={diff} />} />
          </Route>
          <Route path="*" element={<ReportChapters data={data} diff={diff} />} />
        </Routes>
      </div>
    </CardDrawerProvider>
  );
}

/** A reference surface, with the way back on it.
 *
 *  The browser's own back button is the primary route home — that is why these are routes at all —
 *  but a reader who arrived by pressing `Graph` in the rail can be several surfaces deep, and a
 *  visible way back costs one line. */
function Reference({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="flex flex-col gap-6 pt-6">
      <nav aria-label="Report surfaces" className="flex gap-4 items-baseline">
        <SurfaceLink to="/" className="eyebrow text-(--accent)">
          &larr; Report
        </SurfaceLink>
        {REFERENCE_SURFACES.map((s) => (
          <SurfaceLink
            key={s.path}
            to={s.path}
            className={`eyebrow ${pathname === s.path ? "text-(--foreground)" : "text-(--muted)"}`}
          >
            {s.label}
          </SurfaceLink>
        ))}
      </nav>
      {children}
    </div>
  );
}

/** A LINK BETWEEN SURFACES THAT KEEPS THE DECK IN THE URL.
 *
 *  The deck lives in the hash (`#deck=<payload>`), and React Router replaces the whole location on
 *  a navigation — so a plain `<Link to="/analysis/cards">` left the URL as `/analysis/cards`
 *  with no deck on it.
 *  Measured on the live page: the report still rendered (it is in memory), but a reload or a copied
 *  link had lost the analysis, which is the one thing this app's URL exists to carry.
 *
 *  A real `<a href>` rather than a router `Link`, so middle-click and open-in-new-tab still work
 *  and still carry the deck; the click handler reads the hash FRESH at click time, because `App`
 *  writes it with `history.replaceState` and this component never re-renders when it changes. */
export function SurfaceLink({ to, className, children }: {
  to: string; className: string; children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <a
      href={`${to}${typeof window === "undefined" ? "" : window.location.hash}`}
      className={className}
      onClick={(e) => {
        // Let the browser handle every gesture that means "somewhere else": a new tab, a new
        // window, a download. Only a plain left click is ours to intercept.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate({ pathname: to, hash: window.location.hash });
      }}
    >
      {children}
    </a>
  );
}

/** UNDER `/analysis` SINCE 2026-09-03, because `/cards` now means the site's card SEARCH page and
 *  the report's Cards table is a different thing entirely. The three consumers -- `ChapterRail`
 *  renders this table, `SurfaceLink` navigates to it, `ReportHeader` links `/analysis/cards`
 *  directly -- all move together, and `ReportShell.test.tsx` asserts the paths so a half-applied
 *  rename cannot ship.
 *
 *  A STALE SHARE LINK STILL WORKS: `LegacyDeckRedirect` catches `/graph`, `/cards` and `/combos`
 *  with a `#deck=` hash and replaces to the matching surface here. The hash never reaches the
 *  server, so that check cannot live in a Cloudflare redirect. */
export const REFERENCE_SURFACES: readonly { path: string; label: string }[] = [
  { path: "/analysis/graph", label: "Graph" },
  { path: "/analysis/cards", label: "Cards" },
  { path: "/analysis/combos", label: "Combos" },
];

/** BACK RETURNS YOU TO WHERE YOU WERE IN THE SCROLL — the one thing routes were chosen FOR, and the
 *  one thing they do not do on their own. React Router changes the DOM without touching scroll, and
 *  the browser's own restoration fires before the chapters have re-rendered, so a reader who opened
 *  the graph from chapter 5 came back to chapter 1.
 *
 *  So the scroll offset is remembered on the way OUT of the report and written back after the
 *  chapters paint (`useLayoutEffect`, before the browser draws the frame — an effect here reads as
 *  a visible jump from the top). */
function useScrollMemory(): void {
  const { pathname } = useLocation();
  const saved = useRef(0);
  const previous = useRef(pathname);
  useLayoutEffect(() => {
    const wasReport = previous.current === "/";
    if (wasReport && pathname !== "/") saved.current = window.scrollY;
    if (!wasReport && pathname === "/") window.scrollTo(0, saved.current);
    // A reference surface always opens at ITS top; it is a new surface, not a continuation.
    if (previous.current !== pathname && pathname !== "/") window.scrollTo(0, 0);
    previous.current = pathname;
  }, [pathname]);
}
