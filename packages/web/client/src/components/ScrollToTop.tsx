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
 *  (`location.key`) as the reader scrolls, and a POP writes it back once the page is tall enough (frames, up to
 *  RESTORE_MS). The report ("/") keeps its own memory (`useScrollMemory` in ReportShell), so any move to or from
 *  "/" is skipped here rather than handled twice. */
export function ScrollToTop(): null {
  const { pathname, key } = useLocation();
  const type = useNavigationType();
  const previous = useRef(pathname);
  const current = useRef(key);
  const saved = useRef(new Map<string, number>());
  const restoring = useRef(false);

  useEffect(() => {
    const old = history.scrollRestoration;
    history.scrollRestoration = "manual";
    // While a restore is pending the page is clamped to a shorter height; that is not where the reader was.
    const note = () => { if (!restoring.current) saved.current.set(current.current, window.scrollY); };
    window.addEventListener("scroll", note, { passive: true });
    return () => { window.removeEventListener("scroll", note); history.scrollRestoration = old; };
  }, []);

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    current.current = key;
    restoring.current = false;
    if (from === pathname || from === "/" || pathname === "/") return;
    if (type !== "POP") { window.scrollTo(0, 0); return; }
    const target = saved.current.get(key);
    if (!target) return;
    restoring.current = true;
    const until = performance.now() + RESTORE_MS;
    let frame = 0;
    const step = () => {
      const tall = document.documentElement.scrollHeight - window.innerHeight >= target;
      if (tall || performance.now() >= until) {
        window.scrollTo(0, target);
        restoring.current = false;
        return;
      }
      frame = requestAnimationFrame(step);
    };
    step();
    return () => { cancelAnimationFrame(frame); restoring.current = false; };
  }, [pathname, key, type]);
  return null;
}
