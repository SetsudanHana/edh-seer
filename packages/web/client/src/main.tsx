import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import { Calibrate } from "./components/Calibrate.js";
import "./index.css";

// A hash view rather than a router: the app has exactly two screens and adding routing to reach the
// second one would be more machinery than the feature. `#calibrate` is a local dev tool.
const view = window.location.hash === "#calibrate" ? <Calibrate /> : <App />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{view}</React.StrictMode>,
);

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
