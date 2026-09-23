import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
// VENDOR CSS FIRST, OURS SECOND. mana's own @font-face for the "Mana" family does not mention
// woff2 (its src list is eot, woff, ttf, svg), so `index.css` redeclares the family -- and for one
// family the LAST matching @font-face wins, which is only true if this import comes first.
// Imported here rather than @import-ed from index.css: Vite inlines a bare-specifier @import in
// place, and Tailwind's output then leaves the remaining @import statements non-consecutive, which
// postcss rejects.
// CEILING: importing the compiled CSS makes Vite emit every format its @font-face names -- eot,
// ttf, woff, svg, and MPlantin's three -- 3.5 MB of assets no browser ever fetches (verified in
// the page: only `mana.woff2` appears in `performance.getEntriesByType("resource")`). Measured
// against what the deploy already carries, 364 MB over 18,719 files, that is 1% of the bytes and
// 0.04% of the files, so it is not worth a build step today. If it ever is: mana ships its sass
// sources and `_path.scss` is the @font-face partial on its own -- compile `mana.scss` without it
// and the dead formats go with it.
import "mana-font/css/mana.min.css";
import "./index.css";
import { stickyPx } from "./lib/sticky-px.js";
import { headerHidden } from "./lib/header-hide.js";

// `#calibrate` STAYS A HASH VIEW, and stays outside the router: it is a local dev tool (mounted
// only under `MTG_CALIBRATE=1`), not a surface of the product, and it has nothing under it to
// route to. The report's own router lives inside `App`, over the report only.
const Calibrate = lazy(() => import("./components/Calibrate.js").then((m) => ({ default: m.Calibrate })));
const view = window.location.hash === "#calibrate" ? <Suspense fallback={null}><Calibrate /></Suspense> : <App />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{view}</React.StrictMode>,
);

// THE BOOT FLAG THE RECOVERY SCRIPT IN `index.html` WATCHES FOR. If the bundle never executes --
// the failure of 2026-09-04, where a browser held an HTML response cached under the JavaScript URL
// and the module was refused on its MIME type -- nothing in this file runs, so the page cannot heal
// itself from here. The shell can, and it needs exactly one fact from us: that we got this far.
(window as unknown as { __appBooted?: boolean }).__appBooted = true;

// A LAZY CHUNK FROM A DEPLOY THAT NO LONGER EXISTS. The pages load on demand (2026-09-23), so a tab
// opened before a deploy asks for the OLD chunk hashes when the reader clicks into a card -- and
// Pages answers a missing path with the HTML shell, which the module loader refuses. With no error
// boundary that unmounted the whole app. Vite fires `vite:preloadError` for exactly this (a failed
// preload or a failed import); the answer is the new deploy, so reload. NOT TWICE IN TEN SECONDS:
// a chunk that is missing from the CURRENT deploy would otherwise reload forever, and letting that
// error through is the honest failure.
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem("edh-chunk-reload") ?? 0);
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem("edh-chunk-reload", String(Date.now()));
  } catch { return; }
  event.preventDefault();
  location.reload();
});

// AND THE SAME FACT AS AN ATTRIBUTE, so CSS can act on it. The shell carries two blocks of static
// content that exist for readers WITHOUT JavaScript -- the crawler block a Pages Function injects
// after `#root`, and `index.html`'s own landing pitch. React never owns either, which is exactly
// why they survive a hydration it does not perform; it is also why they were still on screen UNDER
// every card page, printing the same partner list twice. Once the app is running they have done
// their job.
// THE ROUTE BEFORE THE BOOT FLAG (cohesion sweep 2026-09-08). `RouteMarker` sets `data-route` from
// inside React, one effect after the first render; the boot flag below fired first, and for that
// frame `html[data-app-booted]:not([data-route="browse"]) .prerendered` hid a browse page's whole
// list. Caught in a screenshot: a blank page under the header. The same rule, once, from the path.
const path = location.pathname;
document.documentElement.dataset.route = path === "/" ? "home" : path.startsWith("/browse/") ? "browse" : "page";
// THE BOOT FLAG ITSELF IS SET BY `AppBooted` IN `App.tsx`, once the lazy page has rendered. The
// calibration view has no routes and no prerendered block, so it is booted as soon as it runs.
if (window.location.hash === "#calibrate") document.documentElement.dataset.appBooted = "1";

/** THE STICKY SITE HEADER'S HEIGHT, INTO `--site-header-h`.
 *
 *  IT IS MEASURED AND NOT WRITTEN DOWN, for the reason the whole `--report-header-h` mechanism
 *  exists: the header WRAPS. Six nav links plus the install button run to ~430px of content, so
 *  below `30rem` the nav becomes two rows and the bar roughly doubles in height -- and where exactly
 *  it breaks depends on font metrics, which differ per platform. A constant here is a constant that
 *  is wrong on somebody's machine, and being wrong means the report header pins UNDER this one.
 *
 *  IT LIVES OUTSIDE REACT because the header does: it is static HTML in `index.html`, above
 *  `#root`, so that the site's name and its nav do not wait for a 700 KB bundle. A component cannot
 *  observe an element it does not own, and a second React root just to measure a `<header>` is a
 *  root to keep alive forever.
 *
 *  NOT ON `how-it-works`, which loads no bundle at all. It does not need this: nothing on that page
 *  is sticky under the header and it has no in-page anchor, so the `0px` default is the right
 *  answer there rather than a missing one. */
const siteHeader = document.querySelector<HTMLElement>(".site-header");
if (siteHeader && typeof ResizeObserver !== "undefined") {
  // A HIDDEN HEADER TAKES NO ROOM IN THE STACK: while it is translated away the chapter rail
  // pins at the top and its own hide slides it fully off screen, rather than leaving 53px of rail
  // exposed under a header that is no longer there.
  const writeSiteHeaderHeight = (): void =>
    document.documentElement.style.setProperty(
      "--site-header-h", siteHeader.hasAttribute("data-hidden") ? "0px" : stickyPx(siteHeader),
    );
  writeSiteHeaderHeight();
  new ResizeObserver(writeSiteHeaderHeight).observe(siteHeader);

  // THE HEADER RETURNS ON SCROLL UP (owner 2026-09-08): pinned on a phone, hidden while the reader
  // scrolls down, back the moment they scroll up. `header-hide.ts` is the rule; this is the wiring.
  const wide = window.matchMedia("(min-width: 48rem)");
  let last = window.scrollY;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    const dy = y - last;
    const was = siteHeader.hasAttribute("data-hidden");
    const hidden = headerHidden({ y, dy, wide: wide.matches, was });
    if (Math.abs(dy) >= 8) last = y;
    if (hidden === was) return;
    siteHeader.toggleAttribute("data-hidden", hidden);
    writeSiteHeaderHeight();
  }, { passive: true });
  wide.addEventListener("change", () => {
    if (wide.matches && siteHeader.hasAttribute("data-hidden")) {
      siteHeader.removeAttribute("data-hidden");
      writeSiteHeaderHeight();
    }
  });
}

/** OFFLINE, WHICH THIS APP IS UNUSUALLY CLOSE TO ALREADY: the analysis runs entirely in the browser
 *  and every card shard a deck touches is already kept in the Cache API by `StaticLookup`. What was
 *  missing is the shell — the HTML, the bundle, the CSS — which a service worker precaches.
 *
 *  PRODUCTION ONLY. In dev the worker would serve a stale bundle over Vite's own, and the file it
 *  registers does not exist there: `sw.js` is written by `assemble-deploy.mjs` into the build
 *  output, because Vite content-hashes the shell and the precache list only exists after a build.
 *
 *  AFTER LOAD, and deliberately not awaited. Registration competes with the first analysis for
 *  bandwidth otherwise, and nothing on screen depends on it — a failure here costs offline support,
 *  never the page. */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => { /* http:, private mode, refused */ });
  });
}
