import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { serviceWorkerSource } from "../../scripts/sw-template.mjs";

/** WHAT MAKES THIS APP INSTALLABLE, asserted rather than assumed. A manifest with a broken icon
 *  path, or an icon set with no maskable entry, fails silently: the browser simply does not offer
 *  to install, and nothing on screen says why. */
const PUBLIC = join(process.cwd(), "client", "public");
const manifest = JSON.parse(readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8"));

test("the manifest carries what a browser needs before it will offer to install", () => {
  expect(manifest.name).toBe("EDH Seer");
  expect(manifest.start_url).toBe("/");
  expect(manifest.display).toBe("standalone");
  // Both colours match --background, so the launch screen and the OS chrome do not flash white
  // around a near-black app.
  expect(manifest.background_color).toBe("#0d0912");
  expect(manifest.theme_color).toBe("#0d0912");
});

test("every icon the manifest names exists, at the size it claims", () => {
  // A PNG's dimensions live in the IHDR chunk, bytes 16-24. Reading them is what makes this a check
  // on the FILE rather than on the string beside it — a 512 entry pointing at a 192 image is the
  // exact mistake that ships an icon nobody notices is wrong until it is on a home screen.
  const pngSize = (path: string) => {
    const b = readFileSync(path);
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  };
  for (const icon of manifest.icons) {
    const path = join(PUBLIC, icon.src.replace(/^\//, ""));
    expect(existsSync(path), `${icon.src} exists`).toBe(true);
    const [w, h] = icon.sizes.split("x").map(Number);
    expect(pngSize(path), `${icon.src} is ${icon.sizes}`).toEqual({ w, h });
    expect(statSync(path).size).toBeGreaterThan(500);
  }
});

/** A maskable icon is cropped to the platform's own shape — a circle on some Androids, a squircle
 *  on others. Without one, the launcher crops the any-purpose icon and clips the mark. */
test("the icon set includes a maskable purpose", () => {
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "any")).toBe(true);
});

test("index.html links the manifest and the iOS icon", () => {
  const html = readFileSync(join(process.cwd(), "client", "index.html"), "utf8");
  expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
  // iOS has no manifest-driven install, so this is the only icon a home-screen launch there uses.
  expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
  expect(existsSync(join(PUBLIC, "apple-touch-icon.png"))).toBe(true);
});

/** THE ROUTING RULES ARE THE WHOLE WORKER, and they are the part that can be wrong in a way no
 *  smoke test catches: a cache-first rule on a URL that is not content-addressed strands a reader
 *  on old data for as long as the browser keeps it. */
const sw = serviceWorkerSource({ version: "testver", shell: ["/index.html", "/assets/index-abc.js"] });

test("the worker is cache-first only on URLs whose name changes with their bytes", () => {
  // `/static/v-<hash>/` and `/assets/<name>-<hash>.js` both do; the manifest and the shell do not.
  expect(sw).toContain('url.pathname.startsWith("/static/v-")');
  expect(sw).toContain('url.pathname.startsWith("/assets/")');
  // The old flat layout kept a shard's name across corpus rebuilds and must never be cache-first.
  expect(sw.includes("/static/cards")).toBe(false);
});

test("the worker is network-first on the shell and on the manifest", () => {
  const fetchBody = sw.slice(sw.indexOf('addEventListener("fetch"'));
  expect(fetchBody).toContain("isShell(url) || isManifest(url)");
  // Cache is the offline answer for those two, so the fallback has to be there.
  expect(fetchBody).toContain('caches.match("/")');
});

test("the worker precaches the shell it was given and names its cache after it", () => {
  expect(sw).toContain('"/assets/index-abc.js"');
  expect(sw).toContain('"edh-seer-shell-testver"');
});

/** The app's card caches are versioned and evicted by `StaticLookup`, and `mtg-art-v1` belongs to
 *  the art loader. A worker that cleaned up by deleting everything would throw away 99 MB of
 *  correctly-cached card data on every deploy. */
test("activation deletes only this worker's own older shells", () => {
  expect(sw).toContain('name.startsWith("edh-seer-shell-") && name !== SHELL_CACHE');
});
