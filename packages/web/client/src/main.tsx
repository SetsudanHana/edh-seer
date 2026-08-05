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
