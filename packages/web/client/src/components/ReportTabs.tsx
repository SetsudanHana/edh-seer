import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalyzeResponse } from "../types.js";
import { createArtLoader, type ArtLoader } from "./art-loader.js";
import { cachedImageLoad } from "./art-cache.js";
import { cardImageUrl } from "./card-node.js";
import { OverviewTab } from "./OverviewTab.js";
import { ArchetypeBoard } from "./ArchetypeBoard.js";
import { CardList } from "./CardList.js";
import { ComboList } from "./ComboList.js";
import { MissingCards } from "./MissingCards.js";
import { GraphView } from "./GraphView.js";
import { GraphList } from "./GraphList.js";
import { useIsNarrow } from "../lib/use-narrow.js";
import { CardDrawerProvider } from "./card-drawer.js";
import { unreadCardNames } from "../lib/unread.js";

type TabId = "overview" | "archetypes" | "cards" | "combos" | "graph";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "archetypes", label: "Archetypes" },
  { id: "cards", label: "Cards" },
  { id: "combos", label: "Combos" },
  { id: "graph", label: "Graph" },
];

export function ReportTabs({ data }: { data: AnalyzeResponse }) {
  const [active, setActive] = useState<TabId>("overview");
  // Under `sm`, the Graph tab ships the graph's DATA as a list instead of its LAYOUT as a canvas —
  // see `GraphList` for why the board is the part that fails at that width.
  const narrow = useIsNarrow();
  // Which cards the synergy engine could not read. Computed once here because BOTH graph surfaces
  // want it and only one of them (`GraphView`) is handed the report — see `lib/unread.ts` for why
  // the rule lives in one place.
  const unread = useMemo(() => unreadCardNames(data.report.cards), [data.report]);
  // THE ART LOADER OUTLIVES THE GRAPH TAB, and that is the whole point of it living here.
  //
  // `<GraphView>` is mounted by `active === "graph"` below, so nothing requested a single image
  // until the user clicked Graph — and then all ~95 discs queued at once, 75ms apart, while they
  // waited. Every `artCrop` URL arrives with the analyze response, and the user is reading the
  // Overview tab for seconds before they ever reach the board: that time was thrown away.
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
    // reads the Overview tab rather than while they wait for anything. Skipped on a metered or
    // explicitly data-saving connection, where speculative megabytes are not ours to spend: the
    // prefetch path still covers the card being zoomed into, it just pays for it on arrival.
    const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || /^(slow-)?2g$/.test(conn?.effectiveType ?? "")) return;
    for (const n of nodes) if (n.artCrop) loader.request(cardImageUrl(n.artCrop));
  }, [data]);
  return (
    // Every card name under here can open the inspector; the graph keeps its own in-canvas one.
    <CardDrawerProvider graph={data.graph}>
    <div className="flex flex-col gap-6">
      {data.missing.length > 0 ? <MissingCards missing={data.missing} /> : null}
      {/* PINNED, because the report is ~3,000px tall and the only way between its five sections
        *  used to scroll away after the first screen. Sticky rather than a fixed rail: it costs no
        *  horizontal space, keeps the underline-tab grammar the design system documents, and needs
        *  no collapsed state at 390px.
        *
        *  NO NEGATIVE MARGINS. Bleeding the bar into the page padding (`-mx-8 px-8`) made three
        *  ancestors 32px wider than their own content box, which reads on a real screen as content
        *  cropped off the right edge. The bar stays inside the box; the strip it would have covered
        *  is page padding, which is the same colour anyway. */}
      <div
        role="tablist"
        aria-label="Report sections"
        // `overflow-x-auto`: at 390px the five tabs plus the bar's own padding run 32px past the
        // row, and a clipped tab is a section of the report you cannot reach. Scrolling the strip
        // keeps every tab reachable without shrinking the labels or wrapping to a second line.
        className="sticky top-0 z-10 flex gap-4 border-b border-(--separator) bg-(--background) pt-2 overflow-x-auto"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={`eyebrow relative pb-2 -mb-px ${active === t.id ? "text-(--accent)" : ""}`}
          >
            {t.label}
            {active === t.id ? (
              <span
                aria-hidden="true"
                className="absolute left-0 right-0 bottom-0 h-[2px] bg-(--accent)"
              />
            ) : null}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {active === "overview" && <OverviewTab data={data} />}
        {active === "archetypes" && <ArchetypeBoard strategies={data.report.strategies} archetypes={data.report.archetypes} />}
        {active === "cards" && (
          <CardList cards={data.report.cards} artByName={artByName} coverage={data.report.coverage} />
        )}
        {active === "combos" && <ComboList combos={data.report.combos} />}
        {active === "graph" && (narrow
          ? <GraphList graph={data.graph} unread={unread} />
          : <GraphView graph={data.graph} report={data.report} artLoader={artLoaderRef.current} />)}
      </div>
    </div>
    </CardDrawerProvider>
  );
}
