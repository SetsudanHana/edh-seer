import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router";

/** A GIVE-UP for a restore whose page never grows tall enough (a card that failed to load). */
const RESTORE_MS = 2000;
/** How long the height must stand still before the restore lets go, the most it may hold on, and what ends it. */
const SETTLE_MS = 400, HARD_MS = 4000;
const INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
/** Entries remembered; an entry is only ever asked for again by Back/Forward, and a session does not go back 50 pages. */
const KEEP = 50;

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
 *  POP is the browser's own to restore, EXCEPT for the one thing it cannot do: it restores on popstate, before the
 *  async card page has its height, so the offset is clamped. So an offset is remembered per history entry
 *  (`location.key`) when the reader leaves it, and a POP to another page writes it back once the page is tall
 *  enough, and keeps writing while the page settles (the strips above the similar list change height after first
 *  paint and scroll anchoring follows them). The reader's own input ends it.
 *
 *  The report ("/") and /analysis/* both have ReportShell, whose `useScrollMemory` owns moves between them; every
 *  other move is ours.
 *
 *  THE LANDING ENTRY gets a key of its own. The router names the document's first entry "default", as it does every
 *  entry without keyed state, so it could not be told from its siblings; on mount a same-URL replace mints it a real
 *  key. That is the page a reader arrives on from a search engine, then clicks a similar card and comes Back to.
 *
 *  ACCEPTED COSTS, owner-approved simplification: the map is in memory, so a reload of a deep card page (or a Back
 *  from another site) gets whatever the browser does; and an entry that stays "default" (native fragment entries,
 *  the report's own `pushState`) is neither saved nor restored here. */
export function ScrollToTop(): null {
  const { pathname, key, search, hash, state } = useLocation();
  const type = useNavigationType();
  const navigate = useNavigate();
  // Same URL, same state, no new entry: the pathname is unchanged, so nothing below scrolls.
  useEffect(() => {
    if (key === "default") navigate({ pathname, search, hash }, { replace: true, state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const previous = useRef(pathname);
  const saved = useRef(new Map<string, number>());
  // THE OFFSET IS TAKEN IN RENDER, when the pathname changes: the old page is still in the DOM, so scrollY is what the
  // reader left. A scroll listener recorded the browser's CLAMP instead (the document shrinks as the route swaps, the
  // browser pulls scrollY in, a scroll event fires): 5774 came back as 5530.
  // CEILING: a render is not a commit. A transition render that React abandons for a newer navigation has already
  // written the departing page's offset under the key of the page it never showed, and the entry it was meant for
  // keeps its older offset. Rare (two navigations inside one render), and the cost is a back that lands elsewhere.
  const rendered = useRef({ key, path: pathname });
  if (rendered.current.path !== pathname) {
    const left = rendered.current;
    if (left.key !== "default") {
      saved.current.delete(left.key);
      saved.current.set(left.key, window.scrollY);
      while (saved.current.size > KEEP) saved.current.delete(saved.current.keys().next().value!);
    }
  }
  rendered.current = { key, path: pathname };

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (from === pathname) return; // a hash or search change is not a new page
    if (inShell(from) && inShell(pathname)) return;
    if (type !== "POP") { window.scrollTo(0, 0); return; }
    const target = key === "default" ? undefined : saved.current.get(key);
    // A saved 0 is an answer ("this page was at its top"); only an entry never left has none.
    if (target === undefined) return;
    const start = performance.now();
    let lastHeight = -1, lastChange = start, frame = 0;
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
  }, [pathname, key, type]);
  return null;
}
