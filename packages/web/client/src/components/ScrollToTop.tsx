import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

/** A GIVE-UP for a restore whose page never grows tall enough (a card that failed to load). */
const RESTORE_MS = 2000;
/** How long the height must stand still before the restore lets go, the most it may hold on, and what ends it. */
const SETTLE_MS = 400, HARD_MS = 4000;
const INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/** A NEW PAGE OPENS AT ITS TOP, AND BACK RETURNS YOU TO WHERE YOU WERE (#1405). React Router changes the DOM
 *  without touching scroll, so a click on a similar card opened the next card page at the old offset.
 *  Mounted once, for every route.
 *
 *  PUSH or REPLACE that changes the pathname scrolls to 0. A hash-only change is not a new page.
 *
 *  POP: the browser's own restore runs on popstate, before the async card page has its full height, so the offset
 *  is clamped. So `history.scrollRestoration` is "manual", the offset is remembered per history entry
 *  (`location.key`) when the reader leaves it, and a POP writes it back once the page is tall enough (frames, up to
 *  RESTORE_MS). The report ("/") keeps its own memory (`useScrollMemory` in ReportShell), so any move to or from
 *  "/" is skipped here rather than handled twice. */
export function ScrollToTop(): null {
  const { pathname, key } = useLocation();
  const type = useNavigationType();
  const previous = useRef(pathname);
  const saved = useRef(new Map<string, number>());
  // THE OFFSET IS TAKEN IN RENDER, when the location key changes: the old page is still in the DOM, so scrollY is
  // what the reader left. A scroll listener recorded the browser's CLAMP instead (the document shrinks as the
  // route swaps, the browser pulls scrollY in, a scroll event fires): 5774 came back as 5530.
  const rendered = useRef(key);
  if (rendered.current !== key) {
    saved.current.set(rendered.current, window.scrollY);
    rendered.current = key;
  }

  useEffect(() => {
    const old = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => { history.scrollRestoration = old; };
  }, []);

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (from === pathname || from === "/" || pathname === "/") return;
    if (type !== "POP") { window.scrollTo(0, 0); return; }
    const target = saved.current.get(key);
    if (!target) return;
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
  }, [pathname, key, type]);
  return null;
}
