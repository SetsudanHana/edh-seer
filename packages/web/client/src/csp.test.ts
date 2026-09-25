import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CSP, SECURITY_HEADERS } from "./lib/csp.js";
import { htmlHeaders } from "./lib/inject.js";

/** THE POLICY IS ONE POLICY, AND IT ALLOWS EXACTLY THE SCRIPTS THE PAGES CARRY (security review
 *  2026-09-25). A CSP that drifts from the HTML fails silently in the worst place: the browser
 *  refuses a script and the reader sees a page that half works. So the hashes are recomputed from
 *  the HTML here, and `_headers` and the Function headers are held to one definition. */
const CLIENT = join(import.meta.dirname, "..");
const pages = ["index.html", join("how-it-works", "index.html")].map((f) => readFileSync(join(CLIENT, f), "utf8"));

/** The `/*` rule's headers, as `_headers` writes them. */
function catchAllRule(): Record<string, string> {
  const lines = readFileSync(join(CLIENT, "public", "_headers"), "utf8").split("\n");
  const at = lines.findIndex((l) => l.trim() === "/*");
  expect(at, "_headers has a /* rule").toBeGreaterThan(-1);
  const out: Record<string, string> = {};
  for (const l of lines.slice(at + 1)) {
    if (!l.startsWith("  ")) break;
    const i = l.indexOf(":");
    out[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return out;
}

test("every inline script the pages run is allowed by hash, and nothing else inline is", () => {
  const hashes = new Set<string>();
  for (const html of pages) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const s of doc.querySelectorAll("script:not([src])")) {
      const type = s.getAttribute("type");
      // Data blocks are never run, so a CSP does not apply to them.
      if (type === "application/ld+json" || type === "application/json") continue;
      hashes.add(`'sha256-${createHash("sha256").update(s.textContent ?? "").digest("base64")}'`);
    }
  }
  const allowed = CSP.split("; ").find((d) => d.startsWith("script-src "))!.split(" ").filter((t) => t.startsWith("'sha256-"));
  expect([...hashes].sort()).toEqual(allowed.sort());
});

test("no shipped page carries an inline style the policy would refuse", () => {
  // `style-src 'self'` refuses a `<style>` element and a `style=""` attribute alike. `404.html` had
  // the first, and every 404 on the live site went out unstyled until this test existed.
  const all = [...pages, readFileSync(join(CLIENT, "public", "404.html"), "utf8")];
  for (const html of all) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll("style, [style]").length).toBe(0);
  }
});

test("_headers sends static files exactly the headers a Function sends", () => {
  expect(catchAllRule()).toEqual(SECURITY_HEADERS);
});

test("a Function's HTML response carries the policy", () => {
  const h = htmlHeaders(false);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(h[k]).toBe(v);
});

test("nothing may frame the site, and no inline handler or eval is allowed", () => {
  expect(CSP).toContain("frame-ancestors 'none'");
  expect(CSP).not.toContain("'unsafe-inline'");
  expect(CSP).not.toContain("'unsafe-eval'");
  expect(SECURITY_HEADERS["x-frame-options"]).toBe("DENY");
});
