import type { GameState } from "@edh-seer/engine";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import type { AnalyzeResponse } from "../types.js";
import { createArtLoader, type ArtLoader } from "./art-loader.js";
import { cachedImageLoad } from "./art-cache.js";
import { cardImageUrl } from "./card-node.js";
import { ReportChapters } from "./ReportChapters.js";
import { ReportHeader } from "./ReportHeader.js";
import { StateControls } from "./StateControls.js";
import { CardList } from "./CardList.js";
import { MissingCards } from "./MissingCards.js";
import { ComboList } from "./ComboList.js";
import { CardDrawerProvider } from "./card-drawer.js";
import type { RunDiff } from "../lib/run-diff.js";

/** THE REPORT'S SHELL: the sticky header, the scroll, and the reference surfaces that are NOT part
 *  of it.
 *
 *  Cards and Combos stop being tabs and become routes. They are surfaces a reader EXPLORES rather
 *  than reads in order, and as tabs they cost the browser's own back button. The Graph surface was
 *  the third, until its pieces moved into the report's chapters (owner, 2026-09-26): its themes,
 *  roles and cuts are chapters now, and a card's links open over the report.
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

export function ReportShell({ data, diff, state, onState, stateBusy = false }: {
  data: AnalyzeResponse; diff?: RunDiff | null;
  /** The game state the report was run under, and the way to change it (roadmap W18). */
  state?: GameState; onState?: (state: GameState) => void;
  /** A re-run under a new state is in flight (W18c): said on the controls, not by the deck bar. */
  stateBusy?: boolean;
}) {
  const stateControls = onState && data.report.markers && data.report.markers.length > 0
    ? <StateControls markers={data.report.markers} state={state} onState={onState} edges={data.report.edges} busy={stateBusy} />
    : null;
  // THE CARDS THIS EDIT ADDED, LIT IN EVERY CHAPTER without the reader hunting for them.
  const seedPins = diff && diff.added.length > 0 && diff.added.length <= SEED_CAP ? diff.added : undefined;
  const comboCount = data.report.combos?.length ?? 0;
  // THE ART IS WARMED WHILE THE READER READS. Every `artCrop` URL arrives with the analyze
  // response, and the chapters' card faces, role shelves and orbit discs are all further down the
  // page than the first screen: the seconds spent reading the top are spent fetching them.
  //
  // Owned here rather than made a module singleton so its lifetime is the REPORT's. A singleton
  // would accumulate decoded images for every deck analysed in a session, with nothing to say when
  // they stop mattering.
  // CARD NAME TO ART, for the Cards table. The URLs already arrive with the analyze response
  // (`graph.nodes[].artCrop`) and the loader below is already warming them, so a table thumbnail
  // costs no request the chapters were not going to make anyway.
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
    // Background warming: the orbit's discs draw the `/art_crop/` files.
    for (const n of nodes) if (n.artCrop) loader.request(n.artCrop);

    // THEN the full card images, a DIFFERENT file (`/normal/`), which every card face in the
    // chapters draws. Queued after the discs, FIFO, so they never delay a disc.
    //
    // Costs roughly 1.5x the disc bytes again (~7.5MB on a 100-card deck), spent while the user
    // reads the chapters rather than while they wait for anything. Skipped on a metered or
    // explicitly data-saving connection, where speculative megabytes are not ours to spend.
    const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || /^(slow-)?2g$/.test(conn?.effectiveType ?? "")) return;
    for (const n of nodes) {
      const warm = n.artCrop ? cardImageUrl(n.artCrop) : null;
      if (warm !== null) loader.request(warm);
    }
  }, [data]);

  useScrollMemory();
  // A NEW ANALYSIS OPENS ON THE CHAPTERS. Without this a reader who left the Cards table open,
  // edited their list and re-analysed came back to the table rather than to the report.
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  // ONLY A NEW DECK GOES HOME (UX sweep 2026-09-06, D1). This effect also ran on mount, so a shared
  // link to a reference surface -- `/analysis/cards#deck=…` -- was redirected to `/` the moment it
  // loaded, and `navigate("/")` carried no hash: the address bar lost both the surface and the
  // deck, and a reload after that lost the analysis. Measured on the live site twice with a clean
  // load. Keyed on the DECK'S IDENTITY (its card names), not on "is this the first data": a
  // first-mount flag reads wrong under StrictMode's doubled effects (review), and a re-run of the
  // same list under a game state is not a new deck either -- it keeps the surface the reader is
  // on. The navigate carries the router's own search and hash, so the state and the deck stay in
  // the URL, and a MemoryRouter test can see that they do.
  const deckKey = data.report.cards.map((c) => c.name).join("\u0001");
  const seenDeck = useRef<string | null>(null);
  useEffect(() => {
    const changed = seenDeck.current !== null && seenDeck.current !== deckKey;
    seenDeck.current = deckKey;
    if (changed && pathname !== "/") navigate({ pathname: "/", search, hash }, { replace: true });
    // Keyed on the deck, not on the path: re-running this when the path changes would make every
    // reference surface unreachable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckKey]);

  return (
    // Every card name under here can open the inspector; the graph keeps its own in-canvas one.
    <CardDrawerProvider graph={data.graph} seedPins={seedPins}>
      <div className="flex flex-col">
        {/* THE SUMMARY ON EVERY SURFACE, chapters and reference alike — the split where
          *  `HeadlineScores` lived inside one tab and the coverage gate above the strip is what
          *  this resolves. */}
        <ReportHeader data={data} diff={diff} />
        {/* A GAME STATE THE OWNER SETS, only where the deck can reach it (roadmap W18). */}
        {onState && data.report.markers && data.report.markers.length > 0 && (
          <div className="px-4 py-3 border-b border-(--separator)">
            {stateControls}
          </div>
        )}
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
            {/* THE GRAPH PAGE IS RETIRED (owner, 2026-09-26): its pieces live in the chapters, so a
              *  saved or shared link to it opens the report, with the deck and state it carried. */}
            <Route path="graph" element={<Navigate to={{ pathname: "/", search, hash }} replace />} />
            <Route
              path="cards"
              element={
                <Reference comboCount={comboCount}>
                  <CardList cards={data.report.cards} artByName={artByName} coverage={data.report.coverage} />
                </Reference>
              }
            />
            <Route path="combos" element={<Reference comboCount={comboCount}><ComboList combos={data.report.combos} /></Reference>} />
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
 *  but a reader who arrived by pressing `Cards` in the rail can be several surfaces deep, and a
 *  visible way back costs one line. */
function Reference({ children, comboCount }: { children: React.ReactNode; comboCount: number }) {
  const { pathname } = useLocation();
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <nav aria-label="Report surfaces" className="flex gap-4 items-baseline">
        <SurfaceLink to="/" className="eyebrow text-(--accent)">
          &larr; Report
        </SurfaceLink>
        {/* The current surface always gets its tab, even Combos on a deck without any. */}
        {(pathname === "/analysis/combos" ? REFERENCE_SURFACES : surfacesFor(comboCount)).map((s) => (
          <SurfaceLink
            key={s.path}
            to={s.path}
            className={`eyebrow ${pathname === s.path ? "text-(--foreground)" : "text-(--muted)"}`}
          >
            {s.label}
          </SurfaceLink>
        ))}
      </nav>
      </div>
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
      // THE STATE RIDES IN THE QUERY and the deck in the hash; a surface link keeps both (W18).
      href={`${to}${typeof window === "undefined" ? "" : window.location.search + window.location.hash}`}
      className={className}
      onClick={(e) => {
        // Let the browser handle every gesture that means "somewhere else": a new tab, a new
        // window, a download. Only a plain left click is ours to intercept.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate({ pathname: to, search: window.location.search, hash: window.location.hash });
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
  { path: "/analysis/cards", label: "Cards" },
  { path: "/analysis/combos", label: "Combos" },
];

/** The surfaces worth a link for this deck. COMBOS ONLY WHEN THERE ARE SOME (UI review 2026-09-25):
 *  a deck with none got a tab that opened a page holding one sentence, and the report already
 *  says so in the bracket panel. The route itself stays, so a shared `/analysis/combos` link
 *  still opens and says there are none. */
export function surfacesFor(comboCount: number): readonly { path: string; label: string }[] {
  return comboCount > 0 ? REFERENCE_SURFACES : REFERENCE_SURFACES.filter((s) => s.path !== "/analysis/combos");
}

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
