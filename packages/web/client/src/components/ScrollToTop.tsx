import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

/** A GIVE-UP for a restore whose page never grows tall enough (a card that failed to load). */
const RESTORE_MS = 2000;
/** How long the height must stand still before the restore lets go, the most it may hold on, and what ends it. */
const SETTLE_MS = 400, HARD_MS = 4000;
const INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
const STORE = "edh-seer:scroll-offsets", KEEP = 50;

/** Offsets by history entry: the page they belong to, and where the reader was. */
type Offsets = Map<string, { path: string; y: number }>;
function load(): Offsets {
  try { return new Map(JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as [string, { path: string; y: number }][]); } catch { return new Map(); }
}
function persist(m: Offsets): void {
  // Insertion order is recency (a re-set moves the key to the end), so the oldest go first.
  while (m.size > KEEP) m.delete(m.keys().next().value!);
  try { sessionStorage.setItem(STORE, JSON.stringify([...m])); } catch { /* private mode or full: the in-memory map still serves */ }
}

/** WHICH HISTORY ENTRY, as something that survives being asked twice. React Router names an entry by `location.key`,
 *  but every entry without keyed state is "default": the document's first entry, a native `#fragment` entry, a
 *  `pushState(null)` entry. Those collide, and a collision restores someone else's offset. So the entry's own
 *  `history.state.key` is read first (the router writes one, and App's report entries now carry one), then the
 *  router's key, then the first entry's `idx`. An entry with none of them is anonymous (null) and is neither saved
 *  nor restored. `history.state` is the entry the browser is ON, which the router's key lags when something
 *  (App's `pushState` for the report) moved the entry behind its back. */
function entryId(routerKey: string): string | null {
  const st = history.state as { key?: unknown; idx?: unknown } | null;
  if (typeof st?.key === "string") return st.key;
  if (routerKey !== "default") return routerKey;
  return typeof st?.idx === "number" ? `default:${st.idx}` : null;
}

/** The paths whose page is the deck tool: ReportShell is mounted there, and its `useScrollMemory` saves the offset on
 *  the way out of "/" and writes it back on the way in. The card, commander, precon and browse pages are a SEPARATE
 *  `<Routes>` that unmounts ReportShell, so a move between one of them and the report has no other memory at all. */
const inShell = (path: string) => !/^\/(cards|commanders|precons|browse)(\/|$)/.test(path);

/** A NEW PAGE OPENS AT ITS TOP, AND BACK RETURNS YOU TO WHERE YOU WERE (#1405). React Router changes the DOM
 *  without touching scroll, so a click on a similar card opened the next card page at the old offset.
 *  Mounted once, for every route.
 *
 *  PUSH or REPLACE that changes the pathname scrolls to 0. A hash-only change is not a new page.
 *
 *  POP: the browser's own restore runs on popstate, before the async card page has its full height, so the offset
 *  is clamped. So `history.scrollRestoration` is "manual", the offset is remembered per history entry
 *  (`location.key`, in sessionStorage so a reload keeps it) when the reader leaves it, and a POP writes it back once
 *  the page is tall enough, and keeps writing while the page settles. A move between two pages that both have
 *  ReportShell ("/" and /analysis/*) is left to its `useScrollMemory`; every other move is ours. */
export function ScrollToTop(): null {
  const { pathname, key, hash } = useLocation();
  const type = useNavigationType();
  const previous = useRef({ pathname, hash });
  const saved = useRef<Offsets>(null as unknown as Offsets);
  saved.current ??= load();
  // The link the reader last clicked, the entry it was clicked on, and where the page was then: a fragment link
  // (`#upgrades`) scrolls the page BEFORE the router hears of it, so scrollY at render time is the anchor's. Only
  // good for the entry it was clicked on, and cleared once the navigation has committed.
  const clicked = useRef<{ y: number; at: number; key: string; id: string | null } | null>(null);
  const first = useRef(true);
  // THE OFFSET IS TAKEN IN RENDER, when the location key changes: the old page is still in the DOM, so scrollY is
  // what the reader left. A scroll listener recorded the browser's CLAMP instead (the document shrinks as the
  // route swaps, the browser pulls scrollY in, a scroll event fires): 5774 came back as 5530.
  // CEILING: a render is not a commit. A transition render that React abandons for a newer navigation has already
  // written the departing page's offset under the key of the page it never showed, and the entry it was meant for
  // keeps its older offset. Rare (two navigations inside one render), and the cost is a back that lands elsewhere.
  const rendered = useRef({ key, path: pathname, id: entryId(key) });
  const idNow = entryId(key);
  // The entry changed when the router's key did, or when the browser's own did without it (a native fragment link
  // moves from an entry with state to one without; the router's key stays "default" throughout).
  if (rendered.current.key !== key || rendered.current.id !== idNow) {
    const left = rendered.current, c = clicked.current;
    const fresh = c && c.key === left.key && performance.now() - c.at < 1000 ? c : null;
    // The click knows which entry it was made on; the render only knows which one it landed on.
    const id = fresh ? fresh.id : left.id, y = fresh ? fresh.y : window.scrollY;
    if (id) {
      saved.current.delete(id);
      saved.current.set(id, { path: left.path, y });
      persist(saved.current);
    }
    rendered.current = { key, path: pathname, id: idNow };
  }

  useEffect(() => {
    const old = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const click = () => {
      clicked.current = { y: window.scrollY, at: performance.now(), key: rendered.current.key, id: entryId(rendered.current.key) };
    };
    // LEAVING THE DOCUMENT (an external link, a reload, a static page) changes no key, so nothing above saw it; with
    // restoration manual the browser will not put the reader back, so the entry they are on is written now.
    const leave = () => {
      const { id, path } = rendered.current;
      if (!id) return;
      saved.current.delete(id);
      saved.current.set(id, { path, y: window.scrollY });
      persist(saved.current);
    };
    const hidden = () => { if (document.visibilityState === "hidden") leave(); };
    window.addEventListener("click", click, true);
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("click", click, true);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
      history.scrollRestoration = old;
    };
  }, []);

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = { pathname, hash };
    const firstRun = first.current;
    first.current = false;
    clicked.current = null;
    if (from.pathname !== pathname && inShell(from.pathname) && inShell(pathname)) return;
    if (type !== "POP") {
      if (from.pathname !== pathname) window.scrollTo(0, 0);
      return;
    }
    // A fresh visit to a URL (typed, followed) is "navigate": nothing was left here. Only a reload or a Back into
    // the document has an offset to give back.
    if (firstRun && (performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "navigate") return;
    // A fragment the reader just followed or went back to: the anchor decides where the page is.
    // With restoration manual the browser does not jump on a traversal, so forward onto the fragment entry is ours too.
    if (!firstRun && from.pathname === pathname && hash !== "" && hash !== from.hash) {
      try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView(); } catch { /* a malformed escape: no anchor */ }
      return;
    }
    const id = idNow;
    const entry = id ? saved.current.get(id) : undefined;
    // A saved 0 is an answer ("this page was at its top"); only an entry never left has none.
    if (!entry || entry.path !== pathname) return;
    const target = entry.y;
    const start = performance.now();
    let lastHeight = -1, lastChange = start, frame = 0;
    // THE PAGE KEEPS MOVING AFTER IT IS TALL ENOUGH: the strips above the similar list settle after the first paint,
    // and the browser's scroll anchoring then follows them (Soul Warden came back at 5530 for 5774, steady). So the
    // offset is re-applied each frame until the height has been still for SETTLE_MS, and the reader's own input
    // ends it at once.
    const stop = () => { cancelAnimationFrame(frame); for (const e of INPUT) window.removeEventListener(e, stop, true); };
    for (const e of INPUT) window.addEventListener(e, stop, { capture: true, passive: true });
    const step = () => {
      const now = performance.now(), height = document.documentElement.scrollHeight;
      if (height !== lastHeight) { lastHeight = height; lastChange = now; }
      const tall = height - window.innerHeight >= target;
      if (tall) {
        if (Math.abs(window.scrollY - target) > 1) window.scrollTo(0, target);
        if (now - lastChange >= SETTLE_MS || now - start >= HARD_MS) return stop();
      } else if (now - start >= RESTORE_MS) { window.scrollTo(0, target); return stop(); }
      frame = requestAnimationFrame(step);
    };
    step();
    return stop;
  }, [pathname, key, type, hash, idNow]);
  return null;
}
