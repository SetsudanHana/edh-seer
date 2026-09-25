import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

/** THE PRODUCT SCREENSHOTS ARE REPRODUCIBLE, OR THEY FAIL HERE (docs refresh, 2026-09-25).
 *
 *  The README and /how-it-works show four frames of the real report, and the rule is that a change
 *  which alters one of them re-runs `npm run screenshots -w @edh-seer/web` in the same PR
 *  (CONTRIBUTING.md, "Screenshots"). No test can see whether a frame is out of date -- that is on
 *  review, and on the PR checklist. What a test CAN hold is everything that makes re-running it a
 *  one-line step and not an afternoon:
 *
 *   - every frame on disk comes from the capture script, so none was cropped by hand and cannot
 *     be regenerated;
 *   - the page and the README show the same set, so the two cannot drift apart;
 *   - the `width`/`height` the page declares are the file's real size, so a regenerated frame of a
 *     different size shifts nothing on load. */
const CLIENT = join(process.cwd(), "client");
const DIR = join(CLIENT, "how-it-works");
const page = readFileSync(join(DIR, "index.html"), "utf8");
const readme = readFileSync(join(process.cwd(), "..", "..", "README.md"), "utf8");
const script = readFileSync(join(process.cwd(), "scripts", "docs-screenshots.ts"), "utf8");

const onDisk = readdirSync(DIR).filter((f) => /^shot-.*\.webp$/.test(f)).sort();

/** A WebP's pixel size from its header: lossy `VP8 `, lossless `VP8L`, or extended `VP8X`. */
function webpSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  expect(b.toString("ascii", 0, 4) + b.toString("ascii", 8, 12), `${file} is a WebP`).toBe("RIFFWEBP");
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  throw new Error(`${file}: unknown WebP chunk ${chunk}`);
}

test("every screenshot is one the capture script writes", () => {
  expect(onDisk.length).toBeGreaterThan(0);
  const scripted = [...script.matchAll(/file: "(shot-[^"]+\.webp)"/g)].map((m) => m[1]!).sort();
  expect(onDisk).toEqual(scripted);
});

test("the page and the README show the same screenshots", () => {
  const inPage = [...page.matchAll(/src="\.\/(shot-[^"]+\.webp)"/g)].map((m) => m[1]!).sort();
  const inReadme = [...readme.matchAll(/packages\/web\/client\/how-it-works\/(shot-[^)"]+\.webp)/g)]
    .map((m) => m[1]!);
  expect(inPage).toEqual(onDisk);
  expect([...new Set(inReadme)].sort()).toEqual(onDisk);
});

test("each screenshot's declared size is its real size", () => {
  for (const m of page.matchAll(/<img src="\.\/(shot-[^"]+\.webp)" width="(\d+)" height="(\d+)"/g)) {
    const file = join(DIR, m[1]!);
    expect(existsSync(file), `${m[1]} exists`).toBe(true);
    expect(webpSize(file), m[1]).toEqual({ width: Number(m[2]), height: Number(m[3]) });
  }
  // Every image carried its size: the loop above saw them all.
  expect([...page.matchAll(/<img src="\.\/shot-[^"]+" width="\d+" height="\d+"/g)]).toHaveLength(onDisk.length);
});
