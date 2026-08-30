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
