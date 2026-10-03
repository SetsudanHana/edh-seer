import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

/** EVERY PAGE TITLE IS ON THE SCALE (#994 item 7). The designer crawl of 2026-10-03 measured page
 *  titles at 24, 36 and 48px depending on the template; `index.css` now names four steps
 *  (`.t-title`, `.t-chapter`, `.t-section`, `.t-subsection`). An `h1` drawn with its own size is
 *  how the drift starts again, so this reads the source rather than one rendered page.
 *  `Calibrate` is the dev-only judging tool, not a page a reader sees. */
const DIR = import.meta.dirname;
const EXEMPT = new Set(["Calibrate.tsx"]);

test("every h1 is the scale's page title", () => {
  const off: string[] = [];
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".tsx") && !n.includes(".test.") && !EXEMPT.has(n))) {
    for (const m of readFileSync(join(DIR, f), "utf8").matchAll(/<h1\b[^>]*className="([^"]*)"/g)) {
      if (!m[1]!.split(/\s+/).includes("t-title")) off.push(`${f}: ${m[1]}`);
    }
  }
  expect(off).toEqual([]);
});
