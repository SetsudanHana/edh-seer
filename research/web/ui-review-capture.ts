/** THE CAPTURE HALF OF A UI REVIEW. Frames, axe violations and in-page numbers for one surface,
 *  written where the persona agents can read them.
 *
 *  This exists because every automated gate passed on an unusable graph -- node radius 3.5 simulated
 *  against 14 painted. A checklist cannot see that. A judge given the rendered pixels BESIDE the
 *  numbers the page actually computed can, and that pairing is the whole point of this script: it
 *  never decides whether the UI is good, it only makes both halves of the evidence available at
 *  once. The deciding is `.claude/skills/ui-review/SKILL.md` and the four persona agents.
 *
 *    npx tsx research/web/ui-review-capture.ts research/web/runs/deck-report.json
 *    npx tsx research/web/ui-review-capture.ts --self-test      # the pure maths, no browser
 *
 *  BOTH SERVERS HAVE TO BE UP (the run file's baseUrl is the vite one):
 *    cd packages/web && NODE_OPTIONS="--import tsx" npx nest start      # :3001
 *    cd packages/web && npx vite --config client/vite.config.ts         # :5173
 *  and kill any stale ones first -- a dev server left from yesterday serves yesterday's code, which
 *  is indistinguishable from a fix that did not work.
 *
 *  Output lands in `persona-shots/<surface>/`, already gitignored. */
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { parseDecklistSections } from "../../packages/data/src/index.js";
import { encodeShare } from "../../packages/web/client/src/lib/share-link.js";

// ---------------------------------------------------------------------------------------------
// The run file
// ---------------------------------------------------------------------------------------------

/** One act inside a step. Deliberately four verbs and no expression language: a run file is a task
 *  list a reader can check against the product, not a test script. Anything that needs branching
 *  wants a Playwright test, not a review capture. */
type Act =
  | { click: string }
  | { type: [selector: string, text: string] }
  | { press: string }
  | { waitFor: string };

type Step = {
  id: string;
  /** Path to be on for this step. Omit to stay where the previous step left off, which is what a
   *  multi-act flow on one page wants. */
  path?: string;
  /** What the READER is trying to do here, in their words. This is the cognitive-walkthrough
   *  prompt -- the persona is asked whether they would notice the control and connect it to this
   *  goal, so a goal phrased in our vocabulary ("inspect the breadth axis") tests nothing. */
  goal: string;
  acts?: Act[];
};

type RunFile = {
  surface: string;
  baseUrl: string;
  /** Decklist files, one per persona seat. The app keeps a deck in the URL fragment and nowhere
   *  else, so a review of any report surface has to carry one in; encoded with the app's OWN
   *  encoder, so these links cannot drift from the ones the product hands out.
   *
   *  PLURAL BECAUSE A VALID ROUND GIVES EACH SEAT A DIFFERENT DECK (`.claude/agents/README.md`):
   *  four personas are one model wearing four hats, so 4/4 agreement on one shared input can be a
   *  single blind spot rather than four readers. Different decks decorrelate the inputs. A single
   *  string is accepted and means a one-deck run, which is fine for a spot check and is NOT a
   *  valid round. */
  decks?: string | string[];
  /** The screens that get the variant pass. Rendering failures are per-screen, not per-step. */
  keyScreens: { id: string; path: string }[];
  steps: Step[];
  /** Selectors whose computed numbers the judge gets beside the screenshot. */
  measure: string[];
};

const DESKTOP = { width: 1920, height: 1080 };
const PHONE = { width: 390, height: 844 };

// ---------------------------------------------------------------------------------------------
// The maths, in Node, where it can be tested
// ---------------------------------------------------------------------------------------------
//
// The browser half returns raw rects and computed colour strings only. Everything derived is
// computed here instead, because a function that only exists inside `page.evaluate` cannot be
// asserted against a known value without launching a browser -- and an unasserted contrast
// calculation is exactly the kind of quiet wrongness this whole instrument exists to catch.

export type Rect = { x: number; y: number; w: number; h: number };
export type Rgb = { r: number; g: number; b: number; a: number };

/** Parses the `rgb()` / `rgba()` that `getComputedStyle` always returns. It never returns a hex or a
 *  colour name, so this does not try to. */
export function parseRgb(css: string): Rgb | null {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/.exec(css.trim());
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio, 1..21. Both colours must already be opaque -- see `flatten`. */
export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Composites `over` ON TOP OF `under`, both as `flatten(over, under)`. `under` must be opaque.
 *
 *  Text at `rgba(255,255,255,0.6)` contrasts as the blend, not as white, and reporting it as white
 *  is how a failing label passes. The caller therefore flattens the FOREGROUND over the resolved
 *  opaque background, then contrasts that result against that same background -- the background
 *  appears twice on purpose. */
export function flatten(over: Rgb, under: Rgb): Rgb {
  const a = over.a;
  return {
    r: over.r * a + under.r * (1 - a),
    g: over.g * a + under.g * (1 - a),
    b: over.b * a + under.b * (1 - a),
    a: 1,
  };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** How many pairs among these boxes intersect. Reported rather than judged: two overlapping boxes
 *  are normal for nested elements and damning for sibling labels, and only the judge can tell which
 *  this is.
 *
 *  ponytail: O(n^2) over one selector's matches. A sweep line if a selector ever matches enough
 *  nodes for this to be felt; at the few hundred a page holds it is not. */
export function overlapPairs(rects: Rect[]): number {
  let n = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) if (overlaps(rects[i], rects[j])) n++;
  }
  return n;
}

/** Painted where nobody can reach it. Catches the mark that measures perfectly and is unfindable.
 *
 *  THE VERTICAL BOUND IS THE DOCUMENT, NOT THE VIEWPORT. Using the viewport height here flagged 18
 *  of 18 matrix rows and 16 of 16 bar labels on the first honest run -- every one of them simply
 *  below the fold on a scrollable page, which is not a defect and is what scrolling is for. Off to
 *  the left or right IS the defect: that is the `.sr-only`-with-no-positioned-ancestor trap and the
 *  horizontal-overflow family. */
export function isOffscreen(r: Rect, viewport: { width: number }, documentHeight: number): boolean {
  return r.x + r.w <= 0 || r.x >= viewport.width || r.y + r.h <= 0 || r.y >= documentHeight;
}

/** WCAG 1.4.3 floor for a given size. 24px, or 18.66px bold, is "large". */
export function requiredContrast(fontSizePx: number, fontWeight: number): number {
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  return large ? 3 : 4.5;
}

// ---------------------------------------------------------------------------------------------
// The browser half
// ---------------------------------------------------------------------------------------------

type RawNode = {
  rect: Rect;
  color: string;
  /** Nearest non-transparent ancestor background, resolved in the DOM where the ancestry lives. */
  background: string;
  fontSize: number;
  fontWeight: number;
  text: string;
  /** Whether WCAG 2.5.8 applies at all. It governs TARGETS, and a caption is not a target --
   *  flagging `p.eyebrow` for being 14px tall is a false positive that trains a reader to skim
   *  the column. */
  interactive: boolean;
};

type RawMeasure = {
  bySelector: Record<string, RawNode[]>;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
};

async function measure(page: Page, selectors: string[]): Promise<RawMeasure> {
  // `getBoundingClientRect` is VIEWPORT-relative and `isOffscreen` compares against the DOCUMENT,
  // so the two only agree at scroll 0. `shoot` happens to leave the page there, but depending on
  // that is how this breaks the first time someone adds a step between them. Cheap, and local.
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate((sels: string[]) => {
    // String ops, not a match. `/^rgba?\([^)]*?(...)?\)$/` is the shape CodeQL flags as polynomial
    // redos, and it has failed the required check on this repo twice.
    const opaque = (c: string) => {
      if (!c || c === "transparent") return false;
      const open = c.indexOf("(");
      if (open < 0) return true;
      const parts = c.slice(open + 1, c.lastIndexOf(")")).split(/[,/\s]+/).filter(Boolean);
      return parts.length < 4 || parseFloat(parts[3]) > 0;
    };
    // The page's own ground, for an element whose every ancestor is transparent.
    const root = getComputedStyle(document.body).backgroundColor;
    const backgroundOf = (el: Element): string => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (opaque(bg)) return bg;
      }
      return root;
    };
    const bySelector: Record<string, unknown[]> = {};
    for (const sel of sels) {
      const out: unknown[] = [];
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        out.push({
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          color: s.color,
          background: backgroundOf(el),
          fontSize: parseFloat(s.fontSize) || 0,
          fontWeight: parseInt(s.fontWeight, 10) || 400,
          text: (el.textContent ?? "").trim().slice(0, 60),
          interactive:
            el.matches("a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=switch], [tabindex]") ||
            !!el.closest("a[href], button, [role=button], [role=link], [role=tab]"),
        });
      }
      bySelector[sel] = out;
    }
    return {
      bySelector,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
    };
  }, selectors) as Promise<RawMeasure>;
}

/** Turns the raw capture into the numbers a judge is handed. Everything here is derived, so it all
 *  goes through the pure functions above. */
function deriveMetrics(raw: RawMeasure, viewport: { width: number; height: number }) {
  const documentHeight = raw.scrollHeight;
  const perSelector = Object.entries(raw.bySelector).map(([selector, nodes]) => {
    const rects = nodes.map((n) => n.rect);
    const readouts = nodes.map((n) => {
      const fg = parseRgb(n.color);
      const bg = parseRgb(n.background);
      const ratio = fg && bg ? contrastRatio(flatten(fg, { ...bg, a: 1 }), { ...bg, a: 1 }) : null;
      const need = requiredContrast(n.fontSize, n.fontWeight);
      return {
        text: n.text,
        fontSizePx: n.fontSize,
        fontWeight: n.fontWeight,
        widthPx: Math.round(n.rect.w),
        heightPx: Math.round(n.rect.h),
        color: n.color,
        background: n.background,
        contrast: ratio === null ? null : Math.round(ratio * 100) / 100,
        contrastRequired: need,
        contrastPasses: ratio === null ? null : ratio >= need,
        offscreen: isOffscreen(n.rect, viewport, documentHeight),
        interactive: n.interactive,
        // WCAG 2.5.8, and only where it applies. Zero-sized boxes are layout wrappers, not targets.
        belowMinTarget: n.interactive && n.rect.w > 0 && n.rect.h > 0 && (n.rect.w < 24 || n.rect.h < 24),
      };
    });
    return {
      selector,
      count: nodes.length,
      overlapPairs: overlapPairs(rects),
      offscreenCount: readouts.filter((r) => r.offscreen).length,
      contrastFailures: readouts.filter((r) => r.contrastPasses === false).length,
      belowMinTargetCount: readouts.filter((r) => r.belowMinTarget).length,
      nodes: readouts,
    };
  });
  return {
    viewport,
    // The narrow-width tell. A page whose scrollWidth exceeds its clientWidth is overflowing
    // sideways, and on a phone that is the single most common defect this product has had.
    scrollWidth: raw.scrollWidth,
    clientWidth: raw.clientWidth,
    overflowsHorizontally: raw.scrollWidth > raw.clientWidth,
    selectors: perSelector,
  };
}

// ---------------------------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------------------------

/** `.first()` throughout, deliberately. A selector matching twice is a strict-mode error in
 *  Playwright, and a review capture should not die because a control also exists in a sibling
 *  surface -- the graph's "Find a card" box exists in both `GraphView` and `GraphList`. Acting on
 *  the first match is deterministic and is what a reader hitting the visible control does. */
/** A PAGE THAT CAN RUN OUR `page.evaluate` BODIES.
 *
 *  tsx compiles through esbuild with `keepNames`, which wraps every named function and arrow in a
 *  `__name(...)` call. That helper exists in the Node bundle and does NOT exist in the browser, so
 *  any evaluate body with a named inner function dies with `__name is not defined` -- after the
 *  screenshots have already been written, which is the confusing part. Defining it as identity
 *  before navigation is the documented workaround and costs nothing. */
async function openPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(() => {
    (globalThis as unknown as { __name: (f: unknown) => unknown }).__name ??= (f) => f;
  });
  return page;
}

/** Shoots the page in VIEWPORT-SIZED SLICES rather than one tall `fullPage` image.
 *
 *  `fullPage` on a long tab produces something a reviewer has to shrink ~2.5x to look at, which put
 *  three seats at the edge of legibility in the 2026-08-20 round and made them hedge every reading.
 *  Slices stay at 1:1. Bounded at `MAX_SLICES`, and a page that fits in one viewport costs exactly
 *  one frame, so this is free on short pages. */
const MAX_SLICES = 3;

async function shoot(page: Page, dir: string, stem: string): Promise<string[]> {
  const files: string[] = [];
  const { height } = page.viewportSize() ?? { height: 0 };
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  const slices = height > 0 ? Math.min(MAX_SLICES, Math.max(1, Math.ceil(full / height))) : 1;
  for (let i = 0; i < slices; i++) {
    await page.evaluate((y: number) => window.scrollTo(0, y), i * height);
    await page.waitForTimeout(120);
    const file = slices === 1 ? `${stem}.png` : `${stem}-p${i + 1}.png`;
    await page.screenshot({ path: join(dir, file) });
    files.push(file);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return files;
}

/** Opens every closed `<details>`, and returns how to put them back.
 *
 *  A default capture shuts disclosures, and in the 2026-08-20 round three seats reported terms as
 *  undefined that the product may well define one click away. The finding stays real -- the reader
 *  met the word before the gloss -- but a round that cannot tell "not explained" from "explained
 *  behind a disclosure" cannot say what to fix.
 *
 *  RESTORING IS NOT TIDINESS. Two steps can share a path -- `land` and `judge` are both `/` -- and
 *  without a restore the second step opens with every disclosure already expanded, silently
 *  reviewing a state no reader arrives in. Returns 0 when nothing was shut, so a page with no
 *  closed disclosure pays for nothing. */
async function expandDetails(page: Page): Promise<number> {
  return page.evaluate(() => {
    const shut = Array.from(document.querySelectorAll("details")).filter((d) => !d.open);
    for (const d of shut) d.open = true;
    (globalThis as unknown as { __shut?: Element[] }).__shut = shut;
    return shut.length;
  });
}

async function restoreDetails(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as unknown as { __shut?: HTMLDetailsElement[] };
    for (const d of g.__shut ?? []) d.open = false;
    g.__shut = [];
  });
}

async function apply(page: Page, acts: Act[] | undefined): Promise<void> {
  for (const act of acts ?? []) {
    if ("click" in act) await page.locator(act.click).first().click();
    else if ("type" in act) await page.locator(act.type[0]).first().fill(act.type[1]);
    else if ("press" in act) await page.keyboard.press(act.press);
    else if ("waitFor" in act) await page.locator(act.waitFor).first().waitFor();
  }
}

/** The app keeps a deck in the fragment and nowhere else, so every report URL carries one. Built
 *  with the product's own `encodeShare`, which is also what makes this fail loudly if the share
 *  format ever changes. */
async function deckHash(deckFile: string): Promise<string> {
  const { commanders, deck } = parseDecklistSections(readFileSync(deckFile, "utf8"));
  const payload = await encodeShare({ commanders: commanders.join("\n"), decklist: deck.join("\n") });
  if (!payload) throw new Error(`${deckFile} does not fit in a share link (over MAX_PAYLOAD)`);
  return `#deck=${payload}`;
}

/** Settling matters for the graph and nothing else, but waiting costs a second and a mid-tick frame
 *  of a force simulation is not comparable between runs. `networkidle` plus a beat is enough: the
 *  simulation is CPU, not network, and the alpha decay is fixed. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
}

async function main(runPath: string): Promise<void> {
  const run: RunFile = JSON.parse(readFileSync(runPath, "utf8"));
  const out = join("persona-shots", run.surface);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const deckFiles = run.decks === undefined ? [] : Array.isArray(run.decks) ? run.decks : [run.decks];
  if (deckFiles.length === 0) deckFiles.push("");            // a surface that needs no deck
  if (deckFiles.length === 1) {
    console.log("NOTE: one deck. Fine for a spot check; a VALID round gives each seat its own deck");
    console.log("      -- see .claude/agents/README.md, \"The honest ceiling of this technique\".");
  }

  const browser = await chromium.launch();
  try {
  const manifest: Record<string, unknown>[] = [];
  const metrics: Record<string, unknown> = {};
  const axe: Record<string, unknown> = {};

  // --- the walkthrough pass: every step, both widths, one deck per seat -----------------------
  for (const deckFile of deckFiles) {
    const stem = deckFile === "" ? "no-deck" : deckFile.split("/").pop()!.replace(/\.txt$/, "");
    const hash = deckFile === "" ? "" : await deckHash(deckFile);
    const deckDir = deckFiles.length > 1 ? join(out, stem) : out;
    mkdirSync(deckDir, { recursive: true });
    const url = (path: string) => `${run.baseUrl}${path}${hash}`;

    for (const [label, viewport] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
      try {
        const page = await openPage(context);
        let at = "";
        for (const step of run.steps) {
          if (step.path && step.path !== at) {
            await page.goto(url(step.path));
            at = step.path;
          }
          await apply(page, step.acts);
          await settle(page);

          const files = await shoot(page, deckDir, `${step.id}-${label}`);
          manifest.push({ deck: stem, step: step.id, goal: step.goal, viewport: label, files });

          // MEASURED BEFORE ANY DISCLOSURE IS OPENED, so the numbers describe the same page the
          // primary frame shows. Measuring after the expansion would hand the judge a metric for a
          // state the reader never arrives in, next to a screenshot of the state they do.
          const key = deckFiles.length > 1 ? `${stem}/${step.id}` : step.id;
          // Numbers at desktop only. The phone frame's job is modality, and doubling the JSON to
          // restate the same contrast ratios would bury the one figure that differs by width --
          // which is the overflow check, and that is page-level.
          if (label === "desktop") {
            metrics[key] = deriveMetrics(await measure(page, run.measure), viewport);
          } else {
            const raw = await measure(page, []);
            metrics[`${key}-phone-overflow`] = {
              scrollWidth: raw.scrollWidth,
              clientWidth: raw.clientWidth,
              overflowsHorizontally: raw.scrollWidth > raw.clientWidth,
            };
          }

          // The second frame, only where a disclosure was actually shut -- then put them back.
          if (await expandDetails(page)) {
            await page.waitForTimeout(200);
            const opened = await shoot(page, deckDir, `${step.id}-${label}-expanded`);
            manifest.push({ deck: stem, step: step.id, goal: step.goal, viewport: label, variant: "details-expanded", files: opened });
            await restoreDetails(page);
          }
        }
      } finally {
        await context.close();
      }
    }
  }

  // --- the variant pass: key screens only, first deck only -------------------------------------
  //
  // Once, not once per deck: these catch RENDERING failure, and a forced-colors frame of the same
  // component with a different decklist behind it is the same frame.
  const variantHash = deckFiles[0] === "" ? "" : await deckHash(deckFiles[0]);
  const url = (path: string) => `${run.baseUrl}${path}${variantHash}`;

  // One frame each. A second frame of the same rendering failure tells a judge nothing. The app
  // ships exactly one theme (`color-scheme: dark`, no `prefers-color-scheme` switch, no
  // `data-theme` toggle), so there is no light/dark pass to run here -- the two variants below are
  // the ones that can actually break it.
  for (const screen of run.keyScreens) {
    // forced-colors: d3 sets `fill` and `stroke` as SVG ATTRIBUTES, which forced-colors mode does
    // not override. The graph is the most likely thing in this product to fail it.
    const fc = await browser.newContext({ viewport: DESKTOP, forcedColors: "active", reducedMotion: "reduce" });
    try {
      const fcPage = await openPage(fc);
      await fcPage.goto(url(screen.path));
      await settle(fcPage);
      await fcPage.screenshot({ path: join(out, `${screen.id}-forced-colors.png`) });
      manifest.push({ step: screen.id, goal: "renders under Windows High Contrast", viewport: "desktop", variant: "forced-colors", file: `${screen.id}-forced-colors.png` });
    } finally {
      await fc.close();
    }

    // deuteranopia: the graph encodes MTG colour identity as five categorical hues, which is the
    // worst case for red-green deficiency, and nothing else in this repo checks that claim on
    // rendered pixels. An LLM cannot roleplay this -- it can see the colours -- so the TRANSFORMED
    // image is what goes to the personas.
    const cvd = await browser.newContext({ viewport: DESKTOP, reducedMotion: "reduce" });
    try {
      const cvdPage = await openPage(cvd);
      await cvdPage.goto(url(screen.path));
      await settle(cvdPage);
      const cdp = await cvd.newCDPSession(cvdPage);
      await cdp.send("Emulation.setEmulatedVisionDeficiency", { type: "deuteranopia" });
      await cvdPage.screenshot({ path: join(out, `${screen.id}-deuteranopia.png`) });
      manifest.push({ step: screen.id, goal: "hues stay distinguishable with deuteranopia", viewport: "desktop", variant: "deuteranopia", file: `${screen.id}-deuteranopia.png` });
    } finally {
      await cvd.close();
    }

    // axe, once per key screen. Its value here is COMPOSITED contrast: validate_contrast.py checks
    // token PAIRS and can never see what actually lands on screen. Ceiling: axe catches roughly a
    // third of WCAG issues and will never find the "measures perfectly, still unfindable" class.
    const ax = await browser.newContext({ viewport: DESKTOP, reducedMotion: "reduce" });
    try {
      const axPage = await openPage(ax);
      await axPage.goto(url(screen.path));
      await settle(axPage);
      const results = await new AxeBuilder({ page: axPage }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      axe[screen.id] = results.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
        targets: v.nodes.slice(0, 5).map((n) => String(n.target.join(" "))),
      }));
    } finally {
      await ax.close();
    }
  }

  writeFileSync(join(out, "manifest.json"), JSON.stringify({ surface: run.surface, decks: deckFiles, frames: manifest }, null, 2));
  writeFileSync(join(out, "metrics.json"), JSON.stringify(metrics, null, 2));
  writeFileSync(join(out, "axe.json"), JSON.stringify(axe, null, 2));

  const violations = Object.values(axe).reduce<number>((n, v) => n + (v as unknown[]).length, 0);
  console.log(`${manifest.length} frames -> ${out}`);
  console.log(`axe violations: ${violations}`);
  for (const [id, m] of Object.entries(metrics)) {
    const mm = m as { overflowsHorizontally?: boolean; scrollWidth?: number; clientWidth?: number };
    if (mm.overflowsHorizontally) console.log(`OVERFLOW ${id}: scrollWidth ${mm.scrollWidth} > clientWidth ${mm.clientWidth}`);
  }
  console.log(`now run the judge: .claude/skills/ui-review/SKILL.md`);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------
// The check this file leaves behind
// ---------------------------------------------------------------------------------------------
//
// `research/` is collected by NO vitest project, so a `*.test.ts` here would read as covered while
// contributing nothing -- the exact trap `scripts/check_bin_placement.py` exists to catch. A
// self-test flag is the right shape, and it is the convention that script already sets.

function selfTest(): void {
  const eq = (got: unknown, want: unknown, what: string) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g !== w) throw new Error(`${what}: got ${g}, want ${w}`);
  };
  const near = (got: number, want: number, what: string, tol = 0.01) => {
    if (Math.abs(got - want) > tol) throw new Error(`${what}: got ${got}, want ~${want}`);
  };

  eq(parseRgb("rgb(255, 255, 255)"), { r: 255, g: 255, b: 255, a: 1 }, "parseRgb rgb");
  eq(parseRgb("rgba(0, 0, 0, 0.5)"), { r: 0, g: 0, b: 0, a: 0.5 }, "parseRgb rgba");
  eq(parseRgb("rgb(1 2 3 / 0.25)"), { r: 1, g: 2, b: 3, a: 0.25 }, "parseRgb space form");
  eq(parseRgb("transparent"), null, "parseRgb rejects a keyword");

  // The two anchors every contrast implementation must agree on.
  near(contrastRatio({ r: 255, g: 255, b: 255, a: 1 }, { r: 0, g: 0, b: 0, a: 1 }), 21, "white on black");
  near(contrastRatio({ r: 0, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 0, a: 1 }), 1, "black on black");
  // #777 on white is the classic 4.48 near-miss -- it must FAIL 4.5, not round up to it.
  near(contrastRatio({ r: 119, g: 119, b: 119, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }), 4.48, "#777 on white", 0.02);

  // Half-opacity white over black is mid grey, and must contrast as that and not as white.
  eq(flatten({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 }), { r: 127.5, g: 127.5, b: 127.5, a: 1 }, "flatten");

  eq(requiredContrast(16, 400), 4.5, "16px normal needs 4.5");
  eq(requiredContrast(24, 400), 3, "24px is large");
  eq(requiredContrast(19, 700), 3, "18.66px bold is large");
  eq(requiredContrast(19, 400), 4.5, "18.66px normal is not large");

  const a = { x: 0, y: 0, w: 10, h: 10 };
  eq(overlaps(a, { x: 5, y: 5, w: 10, h: 10 }), true, "overlapping");
  eq(overlaps(a, { x: 10, y: 0, w: 10, h: 10 }), false, "touching edges do not overlap");
  eq(overlapPairs([a, { x: 5, y: 5, w: 10, h: 10 }, { x: 100, y: 100, w: 1, h: 1 }]), 1, "one pair of three");

  const vp = { width: 390 };
  eq(isOffscreen({ x: -20, y: 0, w: 10, h: 10 }, vp, 5000), true, "off the left edge");
  eq(isOffscreen({ x: 390, y: 0, w: 10, h: 10 }, vp, 5000), true, "off the right edge");
  eq(isOffscreen({ x: 380, y: 0, w: 20, h: 10 }, vp, 5000), false, "straddling the edge is still on screen");
  // The regression this metric shipped with: below the fold is not offscreen.
  eq(isOffscreen({ x: 0, y: 3000, w: 10, h: 10 }, vp, 5000), false, "below the fold is on the page");
  eq(isOffscreen({ x: 0, y: 5000, w: 10, h: 10 }, vp, 5000), true, "past the document bottom is not");

  console.log("self-test: ok");
}

const arg = process.argv[2];
if (arg === "--self-test") selfTest();
else if (!arg) {
  console.error("usage: ui-review-capture.ts <run-file.json> | --self-test");
  process.exit(2);
} else await main(arg);
