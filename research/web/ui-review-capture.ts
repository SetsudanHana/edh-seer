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
 *  THE DEV SERVER HAS TO BE UP (the run file's baseUrl is its URL), analysing against a built
 *  `static-out/` the way production does:
 *    npm run dev -w @edh-seer/web          # UI :5173, /static from static-out/
 *  and kill any stale one first -- a dev server left from yesterday serves yesterday's code, which
 *  is indistinguishable from a fix that did not work.
 *
 *  Output lands in `persona-shots/<surface>/`, already gitignored. */
import { mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { parseDecklistSections } from "../../packages/data/src/index.js";
import { encodeShare } from "../../packages/web/client/src/lib/share-link.js";

// ---------------------------------------------------------------------------------------------
// The run file
// ---------------------------------------------------------------------------------------------

/** One act inside a step. A small fixed vocabulary and no expression language: a run file is a task
 *  list a reader can check against the product, not a test script. Anything that needs branching
 *  wants a Playwright test, not a review capture.
 *
 *  Any string may carry `{{commander}}`, resolved per deck from the decklist itself. */
type Act =
  | { click: string }
  | { type: [selector: string, text: string] }
  | { press: string }
  | { waitFor: string }
  | { select: [selector: string, value: string] }
  /** Try each in turn, stop at the first that works, and only report a failure if ALL of them fail.
   *
   *  This exists because one reader action is two different controls at two widths: the chapter
   *  rail is `button[data-chapter=...]` on a desktop and a native `<select>` below 1023px. Listing
   *  both as ordinary acts would log an expected failure at every width for every chapter -- twelve
   *  of them -- and drown the one real unreachable control the last round found. "Reach the chapter,
   *  however this width does it" is the honest unit. */
  | { any: Act[] };

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
  /** Wait for this selector after arriving, before anything is shot: the report's first chapter
   *  (`#read`) is drawn after the network goes quiet, and a frame taken before it is a skeleton. */
  ready?: string;
  /** Shoot from where the step leaves the reader down to this element's BOTTOM, not the default
   *  two screens (R-T4). Two screens left gaps between chapters and stopped the Cards table near row
   *  30, and every round's seats reported both. Capped at `MAX_THROUGH` frames. */
  through?: string;
  /** Selectors that must sit wholly inside the frames this step took, at desktop and phone. One
   *  outside them fails the capture: a seat that cannot see a region reports it as missing, and the
   *  round cannot tell that from the product leaving it out (R-T4). */
  regions?: string[];
  /** Open the card drawer for the commander and the first `max` card names inside `scope`, one set
   *  of frames each -- or, with `extra`, for the deck's `drawerExtra` names instead. Extras belong on
   *  the Cards page, the one place every card is named: the plant card is on no report chapter. The drawer is the only place a card's text
   *  and its every link are shown, and no round before R-T4 captured it: every claim was checkable
   *  against one card only. */
  drawers?: { scope: string; heading?: string; max: number; extra?: boolean };
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
  /** Per deck (file stem): cards whose drawer is always captured, beside the commander. Where a
   *  calibration plant lives, so the seat can reach it (#989: pod-fit missed the Tinybones plant
   *  three rounds running because it sat in a drawer no frame showed). */
  drawerExtra?: Record<string, string[]>;
  /** Per deck: text that must appear in some captured drawer, or the capture fails. The plant's
   *  sentence goes here, which makes "the plant is reachable from the frames" a checked fact. */
  mustShow?: Record<string, string[]>;
};

const DESKTOP = { viewport: { width: 1920, height: 1080 } };

/** A PHONE IS A POINTER, NOT A WIDTH, and for three rounds this context was only the width.
 *
 *  Playwright reports `pointer: coarse` false and `any-pointer: fine` TRUE for a plain narrow
 *  viewport (measured 2026-09-20, all three context shapes). `useBoardMode` returns `board` on
 *  `!coarse || alsoFine`, so every 390px frame this harness has ever taken of the graph was the
 *  DESKTOP board squeezed into a phone -- the ego view a real phone gets has never been captured,
 *  and the phone seat has been reviewing a surface no phone reaches. `hasTouch` flips all three
 *  queries at once (coarse true, any-fine false, hover false), which is the whole defect.
 *
 *  `isMobile` is deliberately NOT set. It additionally turns on viewport-meta emulation, which
 *  moves layout on every phone frame in the run and would make this round incomparable with the
 *  ones before it. The pointer is what the surface switch reads; add `isMobile` as its own change,
 *  with its own round, if a layout question ever needs it. */
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true };
/** WIDE SCREENS ARE THE STANDARD, NOT THE EDGE CASE (owner 2026-09-28, #770): "2k or 4k monitors as a
 *  standard". Captured for the space pass only -- a primary frame and the used-width numbers, no
 *  expanded frames and no per-selector metrics, which do not change with width. */
const WIDE = { viewport: { width: 2560, height: 1440 } };
const UHD = { viewport: { width: 3840, height: 2160 } };
/** Below this share of the viewport a section is an EMPTY BAND (DESIGN.md, Width). PRE-REGISTERED
 *  2026-09-30 (#770), after measuring the report (two decks) and the site run at 1920 / 2560 / 3840:
 *  report chapters sit at 74-82% (the chapter rail and the report rail take the rest), site pages at
 *  a 97% median, and every section left under 60% was either a measuring artefact (fixed) or a page
 *  with little to show, named in `empty-band-allowlist.json`. A new one fails the run. */
const EMPTY_BAND = 0.6;
/** AND HOW MUCH OF THE ROW HOLDS SOMETHING, a second floor beside the reach (designer review
 *  2026-09-30: one right-aligned score made a mostly empty row reach the far edge). PRE-REGISTERED
 *  2026-09-30 after measuring the same runs: report chapters fill 72-82% at the median and no
 *  section under 45% (the slots note beside the uncounted fixes); site pages 85% at the median, and
 *  everything under 40% already named in the allowlist. */
const FILL_FLOOR = 0.4;
const BAND_ALLOW = join(dirname(fileURLToPath(import.meta.url)), "empty-band-allowlist.json");

/** One section under the floor, as the run met it. */
export type Band = { step: string; viewport: number; section: string; used: number; filled: number };
/** A named exception: the run's surface and step, a section-name pattern, and why it is allowed
 *  under the floor. The surface is part of the name: the report and the site runs both have a
 *  step called `card`. */
export type BandAllow = { surface: string; step: string; section: string; why: string };

/** THE GATE, AS A RATCHET BOTH WAYS -- `scripts/check_width_caps.mjs`'s shape. A band no entry names
 *  fails; so does an entry for a step this run captured that matched nothing, or the list would
 *  keep slack a fixed page left behind. Entries for steps the run never visited are not judged. */
export function bandGate(bands: readonly Band[], allow: readonly BandAllow[], steps: ReadonlySet<string>): { fail: Band[]; stale: BandAllow[] } {
  const hits = new Set<BandAllow>();
  const fail = bands.filter((b) => {
    const e = allow.find((a) => a.step === b.step && new RegExp(a.section).test(b.section));
    if (e) hits.add(e);
    return !e;
  });
  return { fail, stale: allow.filter((a) => steps.has(a.step) && !hits.has(a)) };
}

/** HOW MUCH OF THE SCREEN EACH SECTION USES: the horizontal extent of everything visible inside it,
 *  over the viewport width. A lone 65ch paragraph centred on a 2560 screen reads low, and that is
 *  the point -- DESIGN.md says a capped paragraph belongs beside something. */
async function usedWidth(page: Page): Promise<{ viewport: number; sections: { name: string; used: number; filled: number }[]; minUsed: number }> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const roots = [...document.querySelectorAll<HTMLElement>("main section, main [data-chapter], main > *")]
      .filter((el, i, all) => all.indexOf(el) === i && el.getBoundingClientRect().height > 80);
    // Inline, not a named function: tsx names a `const f = () => {}` with a `__name` helper that
    // does not exist inside the page.
    const boxes = roots.map((el) => {
      let lo = Infinity, hi = -Infinity;
      const spans: [number, number][] = [];
      for (const d of [el, ...el.querySelectorAll<HTMLElement>("*")]) {
        const r = d.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || getComputedStyle(d).visibility === "hidden") continue;
        // Only elements that paint something: text, media, or a visible box. A full-width wrapper
        // with nothing in it must not count as used space.
        const painted = d.children.length === 0 || /^(IMG|SVG|CANVAS|VIDEO|svg)$/.test(d.tagName)
          || getComputedStyle(d).backgroundColor !== "rgba(0, 0, 0, 0)" || getComputedStyle(d).borderTopWidth !== "0px";
        if (!painted) continue;
        lo = Math.min(lo, Math.max(0, r.left));
        hi = Math.max(hi, Math.min(vw, r.right));
        // A LEAF'S SPAN, for how much of the row is FILLED rather than how far it reaches.
        if (d.children.length === 0 || /^(IMG|SVG|CANVAS|VIDEO|svg)$/.test(d.tagName)) spans.push([Math.max(0, r.left), Math.min(vw, r.right)]);
      }
      const r = el.getBoundingClientRect();
      return { lo, hi, top: r.top, bottom: r.bottom, spans };
    });
    // A SECTION IS JUDGED WITH ITS ROW (#770). Two sections side by side in a grid each span half
    // the screen, and together they fill it; scored alone, a well-used two-column row read as two
    // empty bands. So a section's extent is joined with everything painted beside it: every leaf
    // (text, image, drawing) outside it with at least half its height, up to 40px, beside it. Leaves, not
    // sections: the neighbour is often not a section -- the commander page's map beside "Pair
    // with", Glance's first turns beside "How you win", the precon index's columns -- and those
    // rows read as 27-54% empty bands when only sections were joined (measured 2026-09-30).
    const leaves = [...document.querySelectorAll<HTMLElement>("main *")].filter((d) => {
      if (d.children.length !== 0 && !/^(IMG|SVG|CANVAS|VIDEO|svg)$/.test(d.tagName)) return false;
      const r = d.getBoundingClientRect();
      return r.width >= 1 && r.height >= 1 && getComputedStyle(d).visibility !== "hidden";
    }).map((d) => ({ d, r: d.getBoundingClientRect() }));
    const sections = roots.map((el, i) => {
      let { lo, hi } = boxes[i]!;
      const b = boxes[i]!;
      const spans = [...b.spans];
      // A SECTION IN A MULTI-COLUMN FLOW IS JUDGED WITH ITS COLUMNS (#989). CSS columns put the
      // precon index's sets side by side, but the last set of the longest column runs on alone once
      // the others have ended, and read as a 31-47% band at 1920-2560 -- a band of the measurement,
      // not of the page, whose columns container fills the width. The container's leaves count as
      // the section's row whatever their height overlap. CEILING: any non-auto column-count/width
      // counts, so a `columns-1` state (ReportChapters' mana numbers below xl) would over-join;
      // unmeasured because this gate runs at 1920 and wider only.
      let flow: HTMLElement | null = el.parentElement;
      while (flow && flow.tagName !== "MAIN") {
        const cs = getComputedStyle(flow);
        if (cs.columnCount !== "auto" || cs.columnWidth !== "auto") break;
        flow = flow.parentElement;
      }
      const columns = flow && flow.tagName !== "MAIN" ? flow : null;
      for (const { d, r } of leaves) {
        if (el.contains(d)) continue;
        if (columns?.contains(d)) {
          lo = Math.min(lo, Math.max(0, r.left)); hi = Math.max(hi, Math.min(vw, r.right));
          spans.push([Math.max(0, r.left), Math.min(vw, r.right)]);
          continue;
        }
        // Half the leaf's own height, to 40px: a leaf is usually one line of text, 20px tall.
        if (Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) < Math.min(40, r.height / 2)) continue;
        lo = Math.min(lo, Math.max(0, r.left)); hi = Math.max(hi, Math.min(vw, r.right));
        spans.push([Math.max(0, r.left), Math.min(vw, r.right)]);
      }
      // FILLED, NOT REACHED (designer review 2026-09-30): the reach runs from the leftmost to the
      // rightmost thing in the row, so one right-aligned score or "..." menu made a mostly empty row
      // pass. The union of the leaves' spans is how much of the width actually holds something.
      spans.sort((x, y) => x[0] - y[0]);
      let filled = 0, runLo = -1, runHi = -1;
      for (const [a, z] of spans) {
        if (z <= a) continue;
        if (a > runHi) { if (runHi > runLo) filled += runHi - runLo; runLo = a; runHi = z; } else runHi = Math.max(runHi, z);
      }
      if (runHi > runLo) filled += runHi - runLo;
      let name = el.id || el.getAttribute("aria-label") || el.dataset.chapter
        || el.querySelector("h1,h2,h3")?.textContent?.trim().slice(0, 40) || "";
      if (!name) {
        // A bare tag names nothing (#987's band printed "section"): say which chapter it is in and
        // what it starts with. Inline on purpose -- a named helper breaks under tsx's __name in-page.
        // A chapter is `<section id>` (ReportChapters' Chapter); `data-chapter` is only on the rail's
        // buttons, never an ancestor of content.
        const ch = el.parentElement?.closest("section[id]") as HTMLElement | null | undefined;
        const where = ch?.id ?? "";
        const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
        name = `${el.tagName.toLowerCase()}${where ? ` in ${where}` : ""}${text ? `: "${text}"` : ""}`;
      }
      return { name, used: hi > lo ? Math.round(((hi - lo) / vw) * 100) / 100 : 0, filled: Math.round((filled / vw) * 100) / 100 };
    });
    return { viewport: vw, sections, minUsed: sections.length ? Math.min(...sections.map((x) => x.used)) : 1 };
  });
}

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

/** The document-px band of a frame scrolled to `y` that a reader can actually read: the top
 *  `obscuredTop` px lie under a sticky/fixed bar at the top, the bottom `obscuredBottom` under one
 *  pinned to the bottom. Recording the whole [y, y + height) claimed the hidden band was shown (#1241). */
export function visibleBand(y: number, height: number, obscuredTop: number, obscuredBottom: number): [number, number] {
  return [y + obscuredTop, y + height - obscuredBottom];
}

/** Where to scroll for the next frame so its readable top equals this frame's readable bottom: the
 *  step is the readable height, so the overlap is exactly the obscured bands. Overlap is harmless; a
 *  gap is not (`SEAM_OVERLAP` below). Always advances at least one pixel so a degenerate measurement cannot stall the loop. */
export function nextScroll(y: number, height: number, obscuredTop: number, obscuredBottom: number, overlap = SEAM_OVERLAP): number {
  return y + Math.max(1, height - obscuredTop - obscuredBottom - overlap);
}

/** How much two consecutive frames' readable bands share. Abutting bands (overlap 0) leave a line that
 *  straddles the seam whole in no frame, while `covered` (the union) still passes; 48px is about two
 *  lines of body text, enough for any single line and small enough not to add a frame to a step. */
export const SEAM_OVERLAP = 48;

/** The step was sized from the bars of the PREVIOUS frame; the sticky report bar appears only once the
 *  page has scrolled, so the next frame can have a taller one and its readable top lands below the
 *  previous bottom: a gap. Where to scroll instead so the readable top is `overlap` above the previous
 *  readable bottom, or null when the frame is already there (within 1px). */
export function rewindTo(prevEnd: number, y: number, obscuredTop: number, overlap = SEAM_OVERLAP): number | null {
  const need = Math.max(0, prevEnd - overlap - obscuredTop);
  return y > need + 1 ? need : null;
}

/** What one frame of `shoot` decides. `ask` is where it scrolled to, `landed` where the page let it
 *  (less than `ask` is the clamp at the end of the page), `y` where it ended up after any rewind.
 *  Stop at the target, or at a clamp that was NOT rewound: a clamped frame the bar then forced back
 *  up ends short of the target, so the tail is still unshot and the next frame goes on to the end.
 *  `gap` is the unread span between the previous frame's readable bottom and this one's top. */
export function frameStep(f: {
  prevEnd: number | null; ask: number; landed: number; y: number;
  ob: { top: number; bottom: number }; height: number; target: number;
}): { band: [number, number]; stop: boolean; gap: [number, number] | null } {
  const band = visibleBand(f.y, f.height, f.ob.top, f.ob.bottom);
  const gap: [number, number] | null = f.prevEnd !== null && band[0] > f.prevEnd + 1 ? [f.prevEnd, band[0]] : null;
  return { band, stop: band[1] >= f.target || (f.landed < f.ask - 1 && f.y === f.landed), gap };
}

/** Whether a document-relative box [top, bottom) lies wholly inside ONE frame's readable band: the
 *  question for a line of text, which a reader cannot read half of in each of two frames. */
export function wholeInOne(ranges: readonly [number, number][], top: number, bottom: number): boolean {
  return ranges.some(([a, z]) => a <= top && bottom <= z);
}

/** Whether a document-relative box [top, bottom) lies wholly inside the union of the frames'
 *  [y, y + height) ranges. The ranges are where the page ACTUALLY scrolled to, which near the end of
 *  a page is less than asked for, so they overlap rather than leave a gap. */
export function covered(ranges: readonly [number, number][], top: number, bottom: number): boolean {
  let reach = top;
  for (const [a, z] of [...ranges].sort((x, y) => x[0] - y[0])) {
    if (a > reach) break;
    reach = Math.max(reach, z);
    if (reach >= bottom) return true;
  }
  return reach >= bottom;
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
  /** The element's own content is wider than its box, i.e. text is being clipped or scrolled away
   *  INSIDE a container. The page-level `scrollWidth > clientWidth` check cannot see this: a
   *  clipping ancestor absorbs the overflow and the document reports none. Round 2 of 2026-09-18
   *  measured 30 phone pages with no document overflow while the phone seat reported pair reasons
   *  walking off the right edge -- this is the number that was missing. */
  clipped: boolean;
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
          // +1 absorbs sub-pixel rounding; real clipping is never a fraction of a pixel.
          clipped: el.scrollWidth > el.clientWidth + 1,
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
        clipped: n.clipped,
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
      clippedCount: readouts.filter((r) => r.clipped).length,
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
 *  Slices stay at 1:1. A page that fits in one viewport costs exactly one frame, so this is free on
 *  short pages.
 *
 *  TWO, not three. The run file now walks the report's six chapters as separate steps, so each step
 *  starts where the reader actually is and two screens covers a section; three was chosen when one
 *  step had to blind-scroll the whole report, and at ten steps it would have cost 320 frames a
 *  round. Coverage went UP when the cap came down, because navigation replaced guessing. */
const MAX_SLICES = 2;
/** The cap for a step with `through`. The Cards table of a 100-card deck is about eight desktop
 *  screens; past this a region is reported missing rather than shot forever. */
const MAX_THROUGH = 16;

/** Document-relative top and bottom of the first match, or null when nothing matches. */
async function boxOf(page: Page, selector: string): Promise<{ top: number; bottom: number } | null> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
  }, selector);
}

/** A fixed or sticky element's rect in viewport coordinates. */
export interface BarRect { top: number; bottom: number; width: number }

/** The heights of whatever is pinned over the top and bottom of a viewport, from the rects of its
 *  fixed/sticky elements. Bars STACK (a sticky bar `top: 69px` under a header sits at rect.top 69,
 *  not 0), so a candidate counts when it touches the band built so far, grown greedily. Narrower than
 *  half the viewport is a rail or drawer that hides only its own column; spanning the whole height is
 *  a rail or overlay; neither is a bar. No cap: a viewport the bars leave unreadable crawls 1px a
 *  frame to the slice cap and the region is then reported missing, which is the truth. */
export function barBands(rects: readonly BarRect[], vw: number, vh: number): { top: number; bottom: number } {
  const bars = rects.filter((r) => r.width >= vw / 2 && !(r.top <= 1 && r.bottom >= vh - 1));
  let top = 0;
  for (let grew = true; grew;) {
    grew = false;
    for (const r of bars) if (r.top <= top + 1 && r.bottom > top) { top = r.bottom; grew = true; }
  }
  let bottom = vh;
  for (let grew = true; grew;) {
    grew = false;
    for (const r of bars) if (r.bottom >= bottom - 1 && r.top < bottom && r.top > top) { bottom = r.top; grew = true; }
  }
  return { top, bottom: vh - bottom };
}

/** Measured per frame, because the phone bar is not the desktop bar. Only the collection runs in the
 *  page; the arithmetic is `barBands`. */
async function obscuredBands(page: Page, dump = false): Promise<{ top: number; bottom: number; seen: string[] }> {
  const { rects, w, h, tags } = await page.evaluate(() => {
    const out: { top: number; bottom: number; width: number }[] = [];
    const tags: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
      out.push({ top: r.top, bottom: r.bottom, width: r.width });
      tags.push(`${el.tagName}.${String(el.className).slice(0, 40)} ${cs.position} ${Math.round(r.top)}-${Math.round(r.bottom)} w${Math.round(r.width)}`);
    }
    return { rects: out, w: window.innerWidth, h: window.innerHeight, tags };
  });
  return { ...barBands(rects, w, h), seen: dump ? tags : [] };
}

async function shoot(page: Page, dir: string, stem: string, through?: string): Promise<{ files: string[]; ranges: [number, number][]; gaps: string[] }> {
  const shots: string[] = [];
  const ranges: [number, number][] = [];
  const { height } = page.viewportSize() ?? { height: 0 };
  // FROM WHERE THE STEP LEFT THE READER, not from the top. A step that navigates to a chapter has
  // already scrolled the page to it; slicing from 0 would quietly discard that and shoot the
  // landing screen again, which is how the first round produced two byte-identical steps. The
  // first band starts under the bar rather than scrolling back up: record honestly.
  const startY = await page.evaluate(() => window.scrollY);
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  const end = through ? (await boxOf(page, through))?.bottom : undefined;
  const target = end ?? full;
  const cap = end === undefined ? MAX_SLICES : MAX_THROUGH;
  let ask = startY;
  let prevY = -1;
  const gaps: string[] = [];
  for (let i = 0; i < cap; i++) {
    let y = await page.evaluate((to: number) => { window.scrollTo(0, to); return window.scrollY; }, ask);
    const landed = y;
    await page.waitForTimeout(120);
    let ob = await obscuredBands(page, process.env.SEAM_DUMP === "1");
    // A bar taller than the last frame's opens a gap; scroll back up (a few tries, it can move again).
    for (let t = 0; t < 3 && i > 0; t++) {
      const back = rewindTo(ranges[i - 1][1], y, ob.top);
      if (back === null || back <= prevY) break;
      y = await page.evaluate((to: number) => { window.scrollTo(0, to); return window.scrollY; }, back);
      await page.waitForTimeout(120);
      ob = await obscuredBands(page, process.env.SEAM_DUMP === "1");
    }
    console.log(`  ${stem} slice ${i + 1}: y=${Math.round(y)} under a bar top ${Math.round(ob.top)}px, bottom ${Math.round(ob.bottom)}px${ob.seen.length ? ` [${ob.seen.join(" | ")}]` : ""}`);
    const tmp = `${stem}-tmp${i}.png`;
    await page.screenshot({ path: join(dir, tmp) });
    shots.push(tmp);
    // WHAT A READER CAN READ, at where it landed (the last screen of a page clamps).
    const step = frameStep({ prevEnd: i > 0 ? ranges[i - 1][1] : null, ask, landed, y, ob, height, target });
    ranges.push(step.band);
    if (step.gap) {
      console.log(`  SEAM GAP ${stem} frame ${i + 1}: gap ${Math.round(step.gap[0])}-${Math.round(step.gap[1])}`);
      gaps.push(`${stem} frame ${i + 1}: SEAM GAP ${Math.round(step.gap[0])}-${Math.round(step.gap[1])}`);
    }
    if (step.stop) break;
    prevY = y;
    ask = nextScroll(y, height, ob.top, ob.bottom);
  }
  const files = shots.map((t, i) => (shots.length === 1 ? `${stem}.png` : `${stem}-p${i + 1}.png`));
  shots.forEach((t, i) => renameSync(join(dir, t), join(dir, files[i])));
  await page.evaluate((y: number) => window.scrollTo(0, y), startY);
  return { files, ranges, gaps };
}

/** The `regions` this step's frames do not wholly show, by selector. A selector that matches
 *  nothing is missing too: a region the product stopped drawing is a capture the seats cannot use. */
async function missingRegions(page: Page, regions: readonly string[], ranges: [number, number][]): Promise<string[]> {
  const out: string[] = [];
  for (const sel of regions) {
    const b = await boxOf(page, sel);
    if (!b) out.push(`${sel} (not on the page)`);
    else if (!covered(ranges, b.top, b.bottom)) out.push(`${sel} (${Math.round(b.top)}-${Math.round(b.bottom)}px, frames reach ${ranges.map(([a, z]) => `${Math.round(a)}-${Math.round(z)}`).join(", ")})`);
  }
  return out;
}

/** Lines of text a reader would have to read half of in each of two frames: every line box of every
 *  non-whitespace text node in the `regions` (shown, painted, not in a shut <details>) whose document
 *  extent is not wholly inside ONE readable band. PER LINE, not per element: a paragraph taller than
 *  the overlap straddles a seam with every one of its lines still whole in some frame. `covered`
 *  cannot see these, since it asks only for the union.
 *
 *  NOT PAINTED, so skipped: `.sr-only` clips, opacity 0, sticky/fixed descendants (their rect depends
 *  on the scroll), and whatever an overflow-clipping ancestor cuts off (the line is intersected with
 *  each such ancestor; empty means skipped, partial means the visible part). A single line taller than
 *  a band can be whole nowhere; it is counted, not failed. */
async function splitText(page: Page, regions: readonly string[], ranges: [number, number][]): Promise<{ split: string[]; tall: number }> {
  const maxBand = Math.max(0, ...ranges.map(([a, z]) => z - a));
  const lines = await page.evaluate((sels: string[]) => {
    const out: { text: string; top: number; bottom: number }[] = [];
    for (const sel of sels) {
      const root = document.querySelector(sel);
      if (!root) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? "").trim();
        if (text === "") continue;
        const parent = node.parentElement;
        if (!parent) continue;
        let skip = false;
        const clips: DOMRect[] = [];
        for (let el: HTMLElement | null = parent; el && el !== document.body; el = el.parentElement) {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) { skip = true; break; }
          if (el !== root && (cs.position === "sticky" || cs.position === "fixed")) { skip = true; break; }
          if (cs.clipPath.startsWith("inset") || (cs.clip !== "auto" && cs.clip !== "")) { skip = true; break; }
          const box = el.getBoundingClientRect();
          if (box.width <= 1 && box.height <= 1 && cs.overflow !== "visible") { skip = true; break; }
          if (cs.overflowX !== "visible" || cs.overflowY !== "visible") clips.push(box);
          if (el.tagName === "DETAILS" && !(el as HTMLDetailsElement).open && parent.closest("summary")?.parentElement !== el) { skip = true; break; }
          if (el === root) break;
        }
        if (skip) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of Array.from(range.getClientRects())) {
          if (r.width <= 0 || r.height <= 0) continue;
          let top = r.top;
          let bottom = r.bottom;
          let left = r.left;
          let right = r.right;
          for (const c of clips) {
            top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom);
            left = Math.max(left, c.left); right = Math.min(right, c.right);
          }
          if (bottom <= top || right <= left) continue;
          out.push({ text: `${text.replace(/\s+/g, " ").slice(0, 60)} @${Math.round(top + window.scrollY)}`, top: top + window.scrollY, bottom: bottom + window.scrollY });
        }
      }
    }
    return out;
  }, [...regions]);
  const split: string[] = [];
  let tall = 0;
  for (const l of lines) {
    if (l.bottom - l.top > maxBand) { tall++; continue; }
    if (!wholeInOne(ranges, l.top, l.bottom)) split.push(`"${l.text}" (${Math.round(l.top)}-${Math.round(l.bottom)})`);
  }
  return { split, tall };
}

/** Prints and records `splitText` for one pass: at most 5 lines, a count, and every split into `missing`. */
async function reportSplitText(page: Page, regions: readonly string[], ranges: [number, number][], tag: string, missing: string[]): Promise<void> {
  const { split, tall } = await splitText(page, regions, ranges);
  for (const m of split.slice(0, 5)) console.log(`  SPLIT TEXT ${tag}: ${m}`);
  if (split.length > 5) console.log(`  SPLIT TEXT ${tag}: ... and ${split.length - 5} more`);
  console.log(`  split-text check ${tag}: ${split.length} split, ${tall} taller than a frame (excluded)`);
  for (const m of split) missing.push(`${tag}: SPLIT TEXT ${m}`);
}

/** Clicks every "Show all N" / "Show N more" / "Show N smaller" list open inside the page body,
 *  repeatedly, since the cut list opens in steps. Returns how many clicks it took (#989: first-cuts
 *  could not reach its 8th cut behind a shut "Show 2 more").
 *
 *  NOT RESTORED IN PLACE: a list knows only its own state. The caller reloads instead. */
async function openLists(page: Page): Promise<number> {
  let n = 0;
  for (let round = 0; round < 10; round++) {
    const clicked = await page.evaluate(() => {
      const shut = Array.from(document.querySelectorAll<HTMLElement>("main button, main summary"))
        .filter((b) => /^Show (all \d+|\d+ more|\d+ smaller)/.test((b.textContent ?? "").trim()) && b.getClientRects().length > 0);
      for (const b of shut) b.click();
      return shut.length;
    });
    if (!clicked) break;
    n += clicked;
    await page.waitForTimeout(150);
  }
  return n;
}

/** The card drawer for each name, as the reader sees it after clicking the name: the viewport,
 *  then the drawer's own scroll, with its "Every way it works" fold open. Returns the frames and
 *  the drawer's text, which `mustShow` is checked against. */
async function shootDrawers(page: Page, dir: string, stem: string, names: readonly string[]): Promise<{ name: string; files: string[]; text: string; failure?: string; covered?: string }[]> {
  const out: { name: string; files: string[]; text: string; failure?: string; covered?: string }[] = [];
  for (const name of names) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const link = page.locator(`a[data-card="${name.replace(/"/g, '\\"')}"]`).first();
    let covered: string | undefined;
    try {
      // TO THE MIDDLE, not the edge: `scrollIntoViewIfNeeded` left the name at the top of a phone
      // screen, under the sticky chapter bar, and every such tap read as blocked (2026-10-06, six
      // phone drawers on three decks). A reader scrolls a name to where they can tap it.
      await link.evaluate((el) => el.scrollIntoView({ block: "center" }), undefined, { timeout: ACT_TIMEOUT });
      await page.waitForTimeout(150);
      try {
        await link.click({ timeout: ACT_TIMEOUT });
      } catch (e) {
        // A NAME SOMETHING SITS ON TOP OF (the phone's sticky bar, an open sheet) still has a
        // drawer the seats need to read. Open it by script, and say the tap was blocked: that a
        // reader could not tap it is a finding of its own, not a reason to lose the card's text.
        covered = (e as Error).message.split("\n")[0].slice(0, 200);
        await link.evaluate((el) => (el as HTMLElement).click());
      }
      await page.locator("[data-testid='card-inspector']").first().waitFor({ timeout: ACT_TIMEOUT });
    } catch (e) {
      out.push({ name, files: [], text: "", failure: (e as Error).message.split("\n")[0].slice(0, 200) });
      continue;
    }
    await page.waitForTimeout(300);
    // The fold that holds every link sentence, and the scroll box the drawer lives in.
    const scroll = await page.evaluate(() => {
      const ins = document.querySelector<HTMLElement>("[data-testid='card-inspector']")!;
      for (const d of Array.from(ins.querySelectorAll("details"))) d.open = true;
      const chain: HTMLElement[] = [ins, ...Array.from(ins.querySelectorAll<HTMLElement>("*"))];
      for (let p = ins.parentElement; p && p !== document.body; p = p.parentElement) chain.push(p);
      const box = chain.filter((el) => el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))
        .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
      if (box) box.setAttribute("data-capture-scroll", "");
      return box ? { h: box.clientHeight, full: box.scrollHeight } : null;
    });
    const frames = scroll ? Math.min(4, Math.max(1, Math.ceil(scroll.full / scroll.h))) : 1;
    const files: string[] = [];
    for (let i = 0; i < frames; i++) {
      if (scroll) {
        await page.evaluate((y: number) => { document.querySelector("[data-capture-scroll]")!.scrollTop = y; }, i * scroll.h);
        await page.waitForTimeout(100);
      }
      const file = `${stem}-${slug}${frames === 1 ? "" : `-p${i + 1}`}.png`;
      await page.screenshot({ path: join(dir, file) });
      files.push(file);
    }
    const text = await page.evaluate(() => (document.querySelector<HTMLElement>("[data-testid='card-inspector']")?.innerText ?? ""));
    await page.evaluate(() => document.querySelector("[data-capture-scroll]")?.removeAttribute("data-capture-scroll"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    out.push({ name, files, text, ...(covered ? { covered } : {}) });
  }
  return out;
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
    // NOT THE SITE NAVIGATION. The header's MORE menu is a `<details>`, so opening "every"
    // disclosure dropped a menu over the top-right of every expanded frame -- the phone seat caught
    // it last round and correctly hedged it as a possible capture artefact. A nav menu is not a
    // disclosure a reader is failing to find; it is chrome, and chrome belongs shut.
    const shut = Array.from(document.querySelectorAll("details")).filter(
      (d) => !d.open && !d.closest("header, nav, [role=navigation], [role=banner]"),
    );
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

/** Performs a step's acts, and reports the ones that could not be performed.
 *
 *  `.first()` throughout, deliberately. A selector matching twice is a strict-mode error in
 *  Playwright, and a capture should not die because a control also exists in a sibling surface --
 *  the graph's "Find a card" box exists in both `GraphView` and `GraphList`. Acting on the first
 *  match is deterministic and is what a reader hitting the visible control does.
 *
 *  AN ACT THAT CANNOT BE PERFORMED IS A FINDING, NOT A CRASH. The first real round died here: the
 *  graph's search input is present but HIDDEN at 390px, so `waitFor` (which waits for visible) hit
 *  its timeout and took two of the three decks down with it. "The reader cannot reach this control
 *  at this width" is among the most valuable things this harness can report, and losing the round
 *  to it is the worst possible way to say so. Each act is attempted; a failure is RECORDED and the
 *  capture carries on.
 *
 *  The timeout is short on purpose: a control that has not appeared in 5s has not appeared for a
 *  reader either, and 30s x every act x every width is most of a round spent waiting for an answer
 *  already known. */
const ACT_TIMEOUT = 5_000;

async function one(page: Page, act: Act, vars: Record<string, string>): Promise<void> {
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m);
  if ("click" in act) await page.locator(fill(act.click)).first().click({ timeout: ACT_TIMEOUT });
  else if ("type" in act) await page.locator(fill(act.type[0])).first().fill(fill(act.type[1]), { timeout: ACT_TIMEOUT });
  else if ("press" in act) await page.keyboard.press(act.press);
  else if ("waitFor" in act) await page.locator(fill(act.waitFor)).first().waitFor({ timeout: ACT_TIMEOUT });
  else if ("select" in act) await page.locator(fill(act.select[0])).first().selectOption(fill(act.select[1]), { timeout: ACT_TIMEOUT });
  else if ("any" in act) {
    let last: unknown;
    for (const alt of act.any) {
      try { await one(page, alt, vars); return; } catch (e) { last = e; }
    }
    throw last;
  }
}

async function apply(page: Page, acts: Act[] | undefined, vars: Record<string, string>): Promise<string[]> {
  const failures: string[] = [];
  for (const act of acts ?? []) {
    try {
      await one(page, act, vars);
    } catch (e) {
      // Playwright's message carries WHY -- "resolved to hidden", "not found", "intercepts pointer
      // events" -- and which of those it is decides whether this is a defect or a deliberate limit.
      failures.push(`${JSON.stringify(act)}: ${(e as Error).message.split("\n").slice(0, 3).join(" ").slice(0, 240)}`);
    }
  }
  return failures;
}

/** The app keeps a deck in the fragment and nowhere else, so every report URL carries one. Built
 *  with the product's own `encodeShare`, which is also what makes this fail loudly if the share
 *  format ever changes. */
async function deckHash(deckFile: string): Promise<{ hash: string; commander: string }> {
  const { commanders, deck } = parseDecklistSections(readFileSync(deckFile, "utf8"));
  const payload = await encodeShare({ commanders: commanders.join("\n"), decklist: deck.join("\n") });
  if (!payload) throw new Error(`${deckFile} does not fit in a share link (over MAX_PAYLOAD)`);
  // `{{commander}}` in an act resolves to this. Last round the run file typed a hard-coded card
  // name left over from a deck that had been swapped out, so all three seats searched the graph for
  // a card genuinely absent from their own deck and reviewed the empty state by accident. A name
  // taken FROM the deck cannot go stale when the deck changes.
  const commander = (commanders[0] ?? "").replace(/^\d+\s*x?\s*/i, "").trim();
  return { hash: `#deck=${payload}`, commander };
}

/** Settling matters for the graph and nothing else, but waiting costs a second and a mid-tick frame
 *  of a force simulation is not comparable between runs. `networkidle` plus a beat is enough: the
 *  simulation is CPU, not network, and the alpha decay is fixed. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  // THE REPORT READS ITS DECK AFTER THE NETWORK GOES QUIET (persona round 2026-09-29): the first
  // frame after every navigation -- land, cards, combos -- caught `ReportLoading`'s skeleton on
  // most decks, and the seats read the Glance from its expanded frames instead. Wait, bounded, for
  // the skeleton (`aria-busy`) to leave; a page with none passes at once.
  await page.waitForFunction(() => !document.querySelector("[aria-busy='true']"), undefined, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function main(runPath: string): Promise<void> {
  const run: RunFile = JSON.parse(readFileSync(runPath, "utf8"));
  // Point a round at a deployed site (e.g. https://edhseer.cards) without editing the run file.
  if (process.env.REVIEW_BASE_URL) run.baseUrl = process.env.REVIEW_BASE_URL;
  const out = join("persona-shots", run.surface);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const deckFiles = run.decks === undefined ? [] : Array.isArray(run.decks) ? run.decks : [run.decks];
  if (deckFiles.length === 0) deckFiles.push("");            // a surface that needs no deck
  if (deckFiles.length === 1) {
    console.log("NOTE: one deck. Fine for a spot check; a VALID round gives each seat its own deck");
    console.log("      -- see .claude/agents/README.md, \"The honest ceiling of this technique\".");
  }

  const browser = await chromium.launch(launchOptions());
  try {
  const manifest: Record<string, unknown>[] = [];
  const metrics: Record<string, unknown> = {};
  const bands: Band[] = [];
  const axe: Record<string, unknown> = {};
  /** Regions a step's frames did not show; any entry fails the capture (R-T4). */
  const missing: string[] = [];
  /** Every captured drawer's text, per deck, for `mustShow`. */
  const drawerText = new Map<string, string>();

  // --- the walkthrough pass: every step, both widths, one deck per seat -----------------------
  for (const deckFile of deckFiles) {
    const stem = deckFile === "" ? "no-deck" : deckFile.split("/").pop()!.replace(/\.txt$/, "");
    const got = deckFile === "" ? { hash: "", commander: "" } : await deckHash(deckFile);
    const hash = got.hash;
    const vars = { commander: got.commander };
    const deckDir = deckFiles.length > 1 ? join(out, stem) : out;
    mkdirSync(deckDir, { recursive: true });
    const url = (path: string) => `${run.baseUrl}${path}${hash}`;

    for (const [label, device] of [["desktop", DESKTOP], ["phone", PHONE], ["wide", WIDE], ["uhd", UHD]] as const) {
      const context = await browser.newContext({ ...device, reducedMotion: "reduce" });
      try {
        const page = await openPage(context);
        let at = "";
        for (const step of run.steps) {
          if (step.path && step.path !== at) {
            await page.goto(url(step.path));
            at = step.path;
          }
          const actFailures = await apply(page, step.acts, vars);
          await settle(page);
          if (step.ready) {
            await page.locator(step.ready).first().waitFor({ timeout: 60_000 })
              .catch(() => actFailures.push(`ready ${step.ready}: never appeared`));
          }

          const full = label === "desktop" || label === "phone";
          const stepScrollY = await page.evaluate(() => window.scrollY);
          // The space pass (wide, uhd) needs two screens, not the whole chapter.
          const { files, ranges, gaps } = await shoot(page, deckDir, `${step.id}-${label}`, full ? step.through : undefined);
          for (const g of gaps) missing.push(`${stem}/${step.id}/${label}: ${g}`);
          if (full && step.regions?.length) {
            for (const m of await missingRegions(page, step.regions, ranges)) {
              console.log(`  MISSING REGION ${stem}/${step.id}/${label}: ${m}`);
              missing.push(`${stem}/${step.id}/${label}: ${m}`);
            }
          }
          if (full && step.regions?.length) await reportSplitText(page, step.regions, ranges, `${stem}/${step.id}/${label}`, missing);
          manifest.push({
            deck: stem, step: step.id, goal: step.goal, viewport: label, files,
            // Present and non-empty means the reader could not do this step at this width. The
            // frames are still real -- they show the page as the reader would be stuck seeing it.
            ...(actFailures.length ? { actFailures } : {}),
          });
          if (actFailures.length) console.log(`  UNREACHABLE ${step.id}/${label}: ${actFailures[0].slice(0, 150)}`);

          // MEASURED BEFORE ANY DISCLOSURE IS OPENED, so the numbers describe the same page the
          // primary frame shows. Measuring after the expansion would hand the judge a metric for a
          // state the reader never arrives in, next to a screenshot of the state they do.
          const key = deckFiles.length > 1 ? `${stem}/${step.id}` : step.id;
          // Numbers at desktop only. The phone frame's job is modality, and doubling the JSON to
          // restate the same contrast ratios would bury the one figure that differs by width --
          // which is the overflow check, and that is page-level.
          if (label !== "phone") {
            const w = await usedWidth(page);
            metrics[`${key}-width-${w.viewport}`] = w;
            for (const x of w.sections.filter((x) => x.used < EMPTY_BAND || x.filled < FILL_FLOOR)) {
              console.log(`  EMPTY BAND ${key} @${w.viewport}: "${x.name}" reaches ${Math.round(x.used * 100)}% of the width, fills ${Math.round(x.filled * 100)}%`);
              bands.push({ step: step.id, viewport: w.viewport, section: x.name, used: x.used, filled: x.filled });
            }
          }
          if (label === "wide" || label === "uhd") {
            // The space pass needs the frame and the width numbers only; see WIDE.
          } else if (label === "desktop") {
            metrics[key] = deriveMetrics(await measure(page, run.measure), device.viewport);
          } else {
            const raw = await measure(page, []);
            metrics[`${key}-phone-overflow`] = {
              scrollWidth: raw.scrollWidth,
              clientWidth: raw.clientWidth,
              overflowsHorizontally: raw.scrollWidth > raw.clientWidth,
            };
          }

          // BACK TO WHERE THE STEP LEFT THE READER. `measure` scrolls to 0 so that viewport rects
          // and the document-relative `isOffscreen` bound agree; without restoring it here, every
          // expanded frame after a chapter step re-shot the TOP of the report instead of the
          // section. The tuner caught exactly that in round 2 -- "every -expanded frame except
          // verdict resets to the top" -- which means the pass that exists to separate "never
          // explained" from "explained one click away" was showing the wrong screen.
          await page.evaluate((y: number) => window.scrollTo(0, y), stepScrollY);

          // The second frame, only where a disclosure or a "Show N more" list was actually shut --
          // then put them back. A list cannot be put back, so a page whose lists were opened is
          // reloaded: the next step must start from the state a reader arrives in.
          if (full) {
            const shut = await expandDetails(page);
            const lists = await openLists(page);
            if (shut || lists) {
              await page.waitForTimeout(200);
              const opened = await shoot(page, deckDir, `${step.id}-${label}-expanded`, step.through);
              for (const g of opened.gaps) missing.push(`${stem}/${step.id}/${label}-expanded: ${g}`);
              manifest.push({ deck: stem, step: step.id, goal: step.goal, viewport: label, variant: "details-expanded", files: opened.files });
              // The opened pass is where the seam gap was found (#1241); check it before it is shut again.
              if (step.regions?.length) {
                await reportSplitText(page, step.regions, opened.ranges, `${stem}/${step.id}/${label}-expanded`, missing);
                for (const m of await missingRegions(page, step.regions, opened.ranges)) {
                  console.log(`  MISSING REGION ${stem}/${step.id}/${label}-expanded: ${m}`);
                  missing.push(`${stem}/${step.id}/${label}-expanded: ${m}`);
                }
              }
              await restoreDetails(page);
              if (lists) {
                await page.reload();
                await settle(page);
                if (step.ready) await page.locator(step.ready).first().waitFor({ timeout: 60_000 }).catch(() => {});
              }
            }
          }

          // The drawers: the commander, the deck's named extras, and the first cards in scope.
          if (full && step.drawers) {
            // `heading` narrows the scope to the block a heading opens ("Cards that carry it"): the
            // pair sentences, not the first chips the chapter happens to draw.
            const inScope = await page.evaluate(({ scope, heading, max }: { scope: string; heading?: string; max: number }) => {
              const root = document.querySelector(scope);
              const h = heading ? Array.from(root?.querySelectorAll("h2, h3, h4") ?? []).find((x) => x.textContent?.trim() === heading) : null;
              const box = h ? h.parentElement : root;
              return [...new Set(Array.from(box?.querySelectorAll("a[data-card]") ?? []).map((a) => a.getAttribute("data-card")!))].slice(0, max);
            }, step.drawers);
            const names = [...new Set((step.drawers.extra ? run.drawerExtra?.[stem] ?? [] : [vars.commander, ...inScope]).filter(Boolean))];
            for (const d of await shootDrawers(page, deckDir, `${step.id}-${label}`, names)) {
              manifest.push({ deck: stem, step: step.id, goal: `read what ${d.name} does and every card it works with`, viewport: label, variant: "drawer", card: d.name, files: d.files, ...(d.failure ? { actFailures: [d.failure] } : {}), ...(d.covered ? { tapBlocked: d.covered } : {}) });
              if (d.failure) console.log(`  UNREACHABLE drawer ${stem}/${d.name}/${label}: ${d.failure}`);
              if (d.covered) console.log(`  COVERED ${stem}/${d.name}/${label}: opened by script, the tap was blocked: ${d.covered.slice(0, 120)}`);
              drawerText.set(stem, `${drawerText.get(stem) ?? ""}\n${d.text}`);
            }
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
  const variantHash = deckFiles[0] === "" ? "" : (await deckHash(deckFiles[0])).hash;
  const url = (path: string) => `${run.baseUrl}${path}${variantHash}`;

  // One frame each. A second frame of the same rendering failure tells a judge nothing. The app
  // ships exactly one theme (`color-scheme: dark`, no `prefers-color-scheme` switch, no
  // `data-theme` toggle), so there is no light/dark pass to run here -- the two variants below are
  // the ones that can actually break it.
  for (const screen of run.keyScreens) {
    // forced-colors: d3 sets `fill` and `stroke` as SVG ATTRIBUTES, which forced-colors mode does
    // not override. The graph is the most likely thing in this product to fail it.
    const fc = await browser.newContext({ ...DESKTOP, forcedColors: "active", reducedMotion: "reduce" });
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
    const cvd = await browser.newContext({ ...DESKTOP, reducedMotion: "reduce" });
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

    // axe, once per key screen. Its value here is COMPOSITED contrast: validate_contrast.mjs checks
    // token PAIRS and can never see what actually lands on screen. Ceiling: axe catches roughly a
    // third of WCAG issues and will never find the "measures perfectly, still unfindable" class.
    const ax = await browser.newContext({ ...DESKTOP, reducedMotion: "reduce" });
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

  // THE FRAME LIST, PER DECK DIRECTORY (#989). The seats have `Read` only, which refuses a
  // directory, so "list the directory first" could not be obeyed and every seat guessed names. The
  // brief points a seat at this file; it is the inventory, in reading order.
  for (const deck of new Set(manifest.map((m) => m.deck as string | undefined))) {
    if (deck === undefined) continue;
    const dir = deckFiles.length > 1 ? join(out, deck) : out;
    const lines = manifest.filter((m) => m.deck === deck).flatMap((m) =>
      ((m.files as string[] | undefined) ?? []).map((f) => `${join(process.cwd(), dir, f)}\t${m.step}\t${m.viewport}\t${m.variant ?? "primary"}${m.card ? `\t${m.card}` : ""}`));
    writeFileSync(join(dir, "frames.txt"), `${lines.join("\n")}\n`);
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
  // THE SPACE GATE (#770). Pre-registered floor, named exceptions; see `bandGate`.
  const allowed = (JSON.parse(readFileSync(BAND_ALLOW, "utf8")) as { entries: BandAllow[] }).entries;
  const gate = bandGate(bands, allowed.filter((a) => a.surface === run.surface), new Set(run.steps.map((s) => s.id)));
  for (const b of gate.fail) console.log(`FAIL empty band: ${b.step} @${b.viewport} "${b.section}" reaches ${Math.round(b.used * 100)}% (floor ${EMPTY_BAND * 100}%), fills ${Math.round(b.filled * 100)}% (floor ${FILL_FLOOR * 100}%)`);
  for (const a of gate.stale) console.log(`FAIL stale allowlist entry: ${a.step} /${a.section}/ matched nothing -- remove it from ${BAND_ALLOW}`);
  // THE COMPLETENESS GATE (R-T4): every region a step names is in its frames, and every
  // `mustShow` text (the calibration plant) is in a captured drawer. A capture that fails this is
  // not handed to the seats.
  for (const m of missing) console.log(`FAIL missing region: ${m}`);
  const unseen = Object.entries(run.mustShow ?? {}).flatMap(([deck, texts]) =>
    deckFiles.some((f) => f.endsWith(`/${deck}.txt`)) ? texts.filter((t) => !(drawerText.get(deck) ?? "").includes(t)).map((t) => `${deck}: "${t}"`) : []);
  for (const u of unseen) console.log(`FAIL not in any captured drawer: ${u}`);
  if (missing.length || unseen.length) process.exitCode = 1;
  else console.log(`completeness: ok (${manifest.filter((m) => m.variant === "drawer").length} drawer captures)`);
  if (gate.fail.length || gate.stale.length) process.exitCode = 1;
  else console.log(`space gate: ok (${bands.length} allowlisted band(s))`);
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
// contributing nothing -- the exact trap `scripts/check_bin_placement.mjs` exists to catch. A
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

  const allow: BandAllow[] = [{ surface: "site", step: "card", section: "^What it does", why: "sparse page" }, { surface: "site", step: "gone", section: "x", why: "fixed" }, { surface: "site", step: "plan", section: "^Old$", why: "fixed" }];
  const g = bandGate([
    { step: "card", viewport: 2560, section: "What it does in a deck", used: 0.4, filled: 0.3 },
    { step: "mana", viewport: 2560, section: "Curve", used: 0.3, filled: 0.2 },
  ], allow, new Set(["card", "mana", "plan"]));
  eq(g.fail.map((b) => b.section), ["Curve"], "a band no entry names fails");
  // "plan" ran and matched nothing: stale. "gone" never ran: not judged.
  eq(g.stale.map((a) => a.step), ["plan"], "an entry for a step that ran and matched nothing is stale");

  eq(covered([[0, 1000], [1000, 2000]], 100, 1900), true, "two adjacent frames cover a box across both");
  eq(covered([[0, 1000], [1200, 2200]], 100, 1900), false, "a gap between frames is not covered");
  eq(covered([[1500, 2500], [0, 1000], [800, 1800]], 0, 2500), true, "order of frames does not matter");
  eq(covered([[0, 1000]], 0, 1001), false, "one pixel past the last frame is missing");
  eq(visibleBand(0, 1000, 130, 0), [130, 1000], "the band under a 130px bar starts 130px down");
  eq(visibleBand(500, 1000, 130, 20), [630, 1480], "a bottom bar trims the other end");
  eq(nextScroll(0, 1000, 130, 0, 0), 870, "with no overlap the next screen starts where this one's readable part ended");
  eq(nextScroll(0, 1000, 130, 0), 1000 - 130 - SEAM_OVERLAP, "by default the frames overlap by SEAM_OVERLAP");
  eq(nextScroll(0, 100, 80, 40), 1, "an unreadable viewport still advances, so the loop ends at its cap");
  {
    const a = visibleBand(0, 1000, 130, 0);
    const abut = visibleBand(nextScroll(0, 1000, 130, 0, 0), 1000, 130, 0);
    const lap = visibleBand(nextScroll(0, 1000, 130, 0), 1000, 130, 0);
    eq(covered([a, abut], 900, 1200), true, "abutting bands leave no seam for covered()");
    eq(wholeInOne([a, abut], 980, 1020), false, "a line straddling an abutting seam is whole in no frame");
    eq(wholeInOne([a, lap], 980, 1020), true, "the same line is whole in one frame once the bands overlap");
    eq(wholeInOne([a, lap], 100, 200), false, "a box under the bar of the first frame is in no band");
    eq(wholeInOne([], 0, 10), false, "no frames show nothing");
  }
  eq(rewindTo(1080, 963, 130), 902, "a bar that grew once scrolled leaves a gap, so scroll back up");
  eq(rewindTo(1080, 963, 69), null, "a bar as measured for the step leaves none");
  eq(rewindTo(1080, 902, 130), null, "already at the target");
  eq(rewindTo(1080, 903, 130), null, "y = need + 1 is inside the tolerance");
  eq(rewindTo(1080, 904, 130), 902, "y = need + 2 rewinds");
  eq(rewindTo(100, 5, 130), 0, "the target never goes above the top of the page");
  eq(rewindTo(100, 1, 130), null, "and at the top there is nothing to rewind");
  eq(rewindTo(1080, 1000, 130, 0), 950, "a custom overlap moves the target");
  eq(rewindTo(1080, 900, 130, 0), null, "a custom overlap can leave nothing to do");
  {
    const ob = { top: 130, bottom: 0 };
    const base = { prevEnd: 1080, ask: 1000, landed: 1000, y: 1000, ob, height: 1000, target: 5000 };
    eq(frameStep(base).stop, false, "a frame short of the target goes on");
    eq(frameStep({ ...base, target: 2000 }).stop, true, "a frame that reaches the target stops");
    eq(frameStep({ ...base, landed: 900, y: 900 }).stop, true, "a clamp with no rewind is the end of the page");
    eq(frameStep({ ...base, landed: 900, y: 840 }).stop, false, "a clamp whose frame was rewound has not reached the end: the tail is still unshot");
    eq(frameStep({ ...base, landed: 900, y: 840, target: 1800 }).stop, true, "unless the rewound frame reaches the target");
    eq(frameStep({ ...base, y: 1000 }).band, [1130, 2000], "the band is the readable part");
    eq(frameStep({ ...base, y: 1000 }).gap, [1080, 1130], "a readable top below the previous bottom is a gap");
    eq(frameStep({ ...base, y: 902, landed: 902 }).gap, null, "an overlapping frame has none");
    eq(frameStep({ ...base, prevEnd: null }).gap, null, "the first frame has no previous");
  }
  eq(covered([[0, 1000], [1000, 2000]], 900, 1200), true, "the OLD recording claimed the bar-covered band was shown");
  eq(covered([[0, 1000], [1130, 2000]], 900, 1200), false, "the honest bands show [1000,1130) was never readable");
  {
    const bar = (top: number, bottom: number, width = 1920) => ({ top, bottom, width });
    eq(barBands([bar(0, 69), bar(69, 130)], 1920, 1080), { top: 130, bottom: 0 }, "stacked bars add");
    eq(barBands([bar(0, 69), bar(75, 130)], 1920, 1080), { top: 69, bottom: 0 }, "a gap over 1px ends the stack");
    eq(barBands([bar(0, 1080)], 1920, 1080), { top: 0, bottom: 0 }, "a full-height overlay is not a bar");
    eq(barBands([bar(69, 1080, 320)], 1920, 1080), { top: 0, bottom: 0 }, "a narrow rail hides only its column");
    eq(barBands([bar(1000, 1080)], 1920, 1080), { top: 0, bottom: 80 }, "a bottom bar is measured from the bottom");
    eq(barBands([bar(0, 69), bar(1000, 1080)], 1920, 1080), { top: 69, bottom: 80 }, "both ends at once");
    eq(barBands([bar(300, 400)], 1920, 1080), { top: 0, bottom: 0 }, "a bar in the middle of the screen is no band");
    eq(barBands([], 390, 844), { top: 0, bottom: 0 }, "no bars, no bands");
  }

  console.log("self-test: ok");
}

/** A sandboxed session reaches the internet through an HTTPS proxy that re-signs TLS with its own CA,
 *  which the bundled Chromium neither routes through nor trusts. REVIEW_CHROMIUM names a browser
 *  binary; REVIEW_TRUST_SPKI pins the proxy CAs' SPKI hashes -- trust in exactly those, not a blanket
 *  certificate bypass. Unset, this is a plain local launch. */
function launchOptions(): Parameters<typeof chromium.launch>[0] {
  const opts: Parameters<typeof chromium.launch>[0] = {};
  if (process.env.REVIEW_CHROMIUM) opts.executablePath = process.env.REVIEW_CHROMIUM;
  // Loopback bypasses the proxy: a local build served on this machine (with the live card data behind
  // it) is a round too, and the proxy cannot reach localhost.
  if (process.env.REVIEW_BASE_URL && process.env.HTTPS_PROXY) {
    opts.proxy = { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" };
  }
  if (process.env.REVIEW_TRUST_SPKI) opts.args = [`--ignore-certificate-errors-spki-list=${process.env.REVIEW_TRUST_SPKI}`];
  return opts;
}

const arg = process.argv[2];
if (arg === "--self-test") selfTest();
else if (!arg) {
  console.error("usage: ui-review-capture.ts <run-file.json> | --self-test");
  process.exit(2);
} else await main(arg);
