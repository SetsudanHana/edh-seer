import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

/** A GIVE-UP for a restore whose page never grows tall enough (a card that failed to load). */
const RESTORE_MS = 2000;

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
    const until = performance.now() + RESTORE_MS;
    let frame = 0;
    const step = () => {
      const tall = document.documentElement.scrollHeight - window.innerHeight >= target;
      if (tall || performance.now() >= until) {
        window.scrollTo(0, target);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [pathname, key, type]);
  return null;
}
