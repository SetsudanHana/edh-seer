import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

/** THE HEADER'S ONE SCRIPT, RUN AS SHIPPED.
 *
 *  `<details>` closes on its own summary and on nothing else. The two dismissals a reader expects of
 *  anything that hangs over the page -- Escape, and a press somewhere else -- are ~15 lines inline in
 *  both shells, deliberately not in the bundle: the bundle is 700 KB and never runs on
 *  `how-it-works` at all.
 *
 *  THE TEST READS THE REAL FILE. A copy of the script pasted into a test proves the copy works. This
 *  pulls the script text and the nav markup out of `index.html`, evaluates that text against that
 *  markup, and drives it -- so editing the shipped script is what this fails on. */
const CLIENT = join(import.meta.dirname, "..");
const PAGES = ["index.html", "how-it-works/index.html"] as const;

const pageText = (file: string): string => readFileSync(join(CLIENT, file), "utf8");

/** The header's script, picked out by what it acts on rather than by position: these pages carry
 *  three other `<script>` blocks (the JSON-LD, the boot recovery, the module tag).
 *
 *  PARSED, NOT MATCHED. This was a `<script>...</script>` regex and CodeQL filed it as
 *  `js/bad-tag-filter`, high: the pattern is blind to `<SCRIPT>`. The finding is about tag filters
 *  that make a security decision and this one reads our own file, but the fix is smaller than the
 *  argument for keeping it -- and a parser cannot be wrong about which tags are tags. `seo.test.ts`
 *  parses these pages for the same reason. */
const dismissScript = (file: string): string | undefined =>
  [...new DOMParser().parseFromString(pageText(file), "text/html").querySelectorAll("script")]
    .map((el) => el.textContent ?? "")
    .find((body) => body.includes(".site-more[open]"));

const navMarkup = (file: string): string =>
  /<nav class="site-nav"[\s\S]*?<\/nav>/.exec(pageText(file))![0];

test("both pages ship the byte-identical dismiss script", () => {
  // The same rule the nav itself is held to. Two inline copies is the price of a header that works
  // before the bundle does; two inline copies that DRIFT is the defect that price buys.
  const [app, prose] = PAGES.map(dismissScript);
  expect(app, "index.html carries the dismiss script").toBeDefined();
  expect(prose).toBe(app);
});

describe("the header menu closes the two ways the element cannot", () => {
  let details: HTMLDetailsElement;
  let summary: HTMLElement;
  let outside: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `<header class="site-header">${navMarkup("index.html")}</header>`
      + `<main><textarea id="decklist"></textarea><a id="outside" href="/">elsewhere</a></main>`;
    // The shipped text, evaluated. Listeners land on `document`, which is this jsdom document.
    new Function(dismissScript("index.html")!)();
    details = document.querySelector(".site-more")!;
    summary = details.querySelector("summary")!;
    outside = document.querySelector("#outside")!;
    details.open = true;
  });

  const escape = (): boolean =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const pressOn = (el: Element): boolean =>
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));

  test("Escape closes it", () => {
    escape();
    expect(details.open).toBe(false);
  });

  test("Escape returns focus only when focus went with the panel", () => {
    // A link inside the panel has nowhere to be once the panel is gone, so focus goes back to the
    // control that opened it.
    const inPanel = details.querySelector<HTMLAnchorElement>(".site-more-panel a")!;
    inPanel.focus();
    escape();
    expect(document.activeElement).toBe(summary);

    // But Escape pressed while the reader is typing a decklist must not yank the cursor out of it.
    details.open = true;
    const field = document.querySelector<HTMLTextAreaElement>("#decklist")!;
    field.focus();
    escape();
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(field);
  });

  test("a press outside closes it, and a press on the menu itself does not", () => {
    pressOn(outside);
    expect(details.open).toBe(false);

    // The summary owns its own toggle. Closing it from here would fight the element and make the
    // control need two presses to open.
    details.open = true;
    pressOn(summary);
    expect(details.open).toBe(true);

    // So does a link inside the panel — closing before the press resolves would cancel the
    // navigation the reader just asked for.
    pressOn(details.querySelector(".site-more-panel a")!);
    expect(details.open).toBe(true);
  });

  test("Escape with nothing open is a no-op rather than a throw", () => {
    details.open = false;
    expect(() => escape()).not.toThrow();
    expect(() => pressOn(outside)).not.toThrow();
  });
});
