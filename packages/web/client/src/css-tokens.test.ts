import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

/** DOES EVERY TOKEN A COMPONENT NAMES ACTUALLY EXIST?
 *
 *  THE DEFECT THIS CLOSES, and it was mine. Deleting v1's identity accent took
 *  `useAccentIdentity` with it, and that hook was the only thing that ever SET `--accent-gradient`
 *  — a variable six components still asked for. CSS resolves an undefined custom property to
 *  nothing, silently: `background-image: var(--accent-gradient)` paints no pixels and throws no
 *  error, so the Archetypes tab shipped percentage bars with no bar in them. Owner-reported from a
 *  screenshot; every test was green and the typechecker has no opinion about a string.
 *
 *  A grep for the deleted SYMBOLS (`identityColor`, `useAccentIdentity`, `ColorIdentityPicker`)
 *  found the code and could not find this, because the dangling reference names none of them. The
 *  only thing that catches it is asking the question in this direction: every `var(--x)` a
 *  component names, against the definitions in `index.css`.
 */
// `process.cwd()` rather than `import.meta.url`: the client's vitest runs in jsdom, where the
// module URL is an http:// one and `fileURLToPath` refuses it. The config sets the cwd to the web
// package.
const CLIENT_SRC = join(process.cwd(), "client", "src");
const INDEX_CSS = join(CLIENT_SRC, "index.css");

/** Set by the framework, not by us. `--heroui-*` comes from `@heroui/styles`, and Tailwind v4
 *  defines its own `--tw-*` and `--spacing`-family variables inside the utilities it generates. */
const FOREIGN = /^--(heroui|tw)-|^--spacing$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

test("every CSS custom property a component names is defined in index.css", () => {
  const css = readFileSync(INDEX_CSS, "utf8");
  const defined = new Set([...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
  expect(defined.size).toBeGreaterThan(20); // the parse itself has to be working

  const missing = new Map<string, string[]>();
  for (const file of sourceFiles(CLIENT_SRC)) {
    const body = readFileSync(file, "utf8");
    const named = new Set<string>();
    // `var(--x)` in an inline style or a stylesheet, and Tailwind v4's `text-(--x)` / `bg-(--x)`
    // arbitrary-property syntax, which is how most of this app reaches for a token.
    for (const m of body.matchAll(/var\((--[\w-]+)/g)) named.add(m[1]);
    for (const m of body.matchAll(/[a-z-]+-\((--[\w-]+)\)/g)) named.add(m[1]);
    for (const token of named) {
      if (defined.has(token) || FOREIGN.test(token)) continue;
      // A file may define its own local token; `index.css` is the shared one but not the only one.
      if (new RegExp(`${token}\\s*:`).test(body)) continue;
      missing.set(token, [...(missing.get(token) ?? []), file.slice(CLIENT_SRC.length)]);
    }
  }

  expect(
    [...missing].map(([token, files]) => `${token} <- ${files.join(", ")}`),
    "these custom properties are referenced but never defined, so they render as nothing",
  ).toEqual([]);
});

/** THE DISCLOSURE CONTROLS ARE A THUMB TALL, AND STAY THAT WAY.
 *
 *  Every `<summary>` in the app rendered 326x17 at 390px -- eight of them on the Overview alone --
 *  against WCAG 2.2 SC 2.5.8's 24x24. They are the report's only mechanism for saying what a number
 *  means, so on a phone the least reachable control was the one that explains the page. The 17px
 *  came from `.eyebrow`'s 11px font and nothing else; these are standalone controls on their own
 *  line, so unlike the card names inside a combo row they get no help from the Inline exception.
 *
 *  A SOURCE ASSERTION, NOT A MEASUREMENT, and that limit is the point of writing it down: the suite
 *  runs in jsdom, which computes no layout, so `getBoundingClientRect()` here would return zeros and
 *  pass no matter what the rule said. This catches the regression that actually happened elsewhere
 *  in this file's history -- someone deletes the rule -- and cannot catch a rule that is present but
 *  overridden. The real 25px was verified in the browser at 390px when the rule landed.
 *  CEILING: a Playwright assertion would measure it properly; this repo has the config but no
 *  browser-side a11y suite to hang it on yet.
 */
test("summary keeps a 44px minimum target height, and the explainer link 24", () => {
  const css = readFileSync(INDEX_CSS, "utf8");
  const rule = (selector: string) => {
    const m = css.match(new RegExp(`(^|\\})\\s*${selector}\\s*\\{([^}]*)\\}`, "m"));
    return m?.[2] ?? "";
  };
  // rem, because the criterion is in CSS px and this app's root font size is the default 16.
  const minBlockRem = (body: string) => {
    const m = body.match(/min-block-size:\s*([\d.]+)rem/);
    return m ? Number(m[1]) : 0;
  };

  const summaryRule = rule("summary");
  expect(summaryRule, "the bare `summary` rule is gone from index.css").not.toBe("");
  // 44, NOT 24. The floor was met and the control was still not used: the phone judge's re-run
  // (2026-09-03) reported never having opened one of the fourteen on the report. See `index.css`.
  expect(minBlockRem(summaryRule) * 16).toBeGreaterThanOrEqual(44);
  // `display` must stay `list-item`: a flex summary drops its own disclosure marker in Chrome, so
  // the triangle that says the block opens would vanish while every test stayed green.
  expect(summaryRule).not.toMatch(/display:\s*(flex|grid|inline-flex)/);

  expect(minBlockRem(rule("\\.intro-more a")) * 16).toBeGreaterThanOrEqual(24);
});
