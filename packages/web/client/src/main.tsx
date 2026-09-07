import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import { Calibrate } from "./components/Calibrate.js";
import "./index.css";
import { stickyPx } from "./lib/sticky-px.js";

// `#calibrate` STAYS A HASH VIEW, and stays outside the router: it is a local dev tool (mounted
// only under `MTG_CALIBRATE=1`), not a surface of the product, and it has nothing under it to
// route to. The report's own router lives inside `App`, over the report only.
const view = window.location.hash === "#calibrate" ? <Calibrate /> : <App />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{view}</React.StrictMode>,
);

// THE BOOT FLAG THE RECOVERY SCRIPT IN `index.html` WATCHES FOR. If the bundle never executes --
// the failure of 2026-09-04, where a browser held an HTML response cached under the JavaScript URL
// and the module was refused on its MIME type -- nothing in this file runs, so the page cannot heal
// itself from here. The shell can, and it needs exactly one fact from us: that we got this far.
(window as unknown as { __appBooted?: boolean }).__appBooted = true;

// AND THE SAME FACT AS AN ATTRIBUTE, so CSS can act on it. The shell carries two blocks of static
// content that exist for readers WITHOUT JavaScript -- the crawler block a Pages Function injects
// after `#root`, and `index.html`'s own landing pitch. React never owns either, which is exactly
// why they survive a hydration it does not perform; it is also why they were still on screen UNDER
// every card page, printing the same partner list twice. Once the app is running they have done
// their job.
document.documentElement.dataset.appBooted = "1";

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
  const writeSiteHeaderHeight = (): void =>
    document.documentElement.style.setProperty(
      "--site-header-h", stickyPx(siteHeader),
    );
  writeSiteHeaderHeight();
  new ResizeObserver(writeSiteHeaderHeight).observe(siteHeader);
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
