import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import { Calibrate } from "./components/Calibrate.js";
import "./index.css";

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
