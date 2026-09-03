import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

/** `_headers` IS THE SITE'S CACHE POLICY, and until 2026-09-03 half of it was somewhere else.
 *
 *  Cloudflare's zone-wide Browser Cache TTL overrides the origin whenever the origin's value is
 *  LOWER, and Pages sends `max-age=0, must-revalidate` for any file no rule names. So a 4-hour zone
 *  default was quietly deciding the policy for every unnamed asset -- and raising `/sw.js` from 0 to
 *  14400 along with them, which is the one thing that file's own comment says must never happen.
 *
 *  These tests exist so the policy stays here, in the repo, where it can be reviewed. */

const PUBLIC = join(import.meta.dirname, "..", "public");
const HEADERS = join(PUBLIC, "_headers");

interface Rule {
  pattern: string;
  match: RegExp;
  headers: Record<string, string>;
}

function parseRules(): Rule[] {
  const rules: Rule[] = [];
  for (const raw of readFileSync(HEADERS, "utf8").split("\n")) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (raw.startsWith("/")) {
      const pattern = raw.trim();
      rules.push({
        pattern,
        // The only wildcard Cloudflare's `_headers` takes is `*`.
        match: new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`),
        headers: {},
      });
      continue;
    }
    const [name, ...rest] = raw.trim().split(":");
    const last = rules.at(-1);
    if (last) last.headers[name.trim().toLowerCase()] = rest.join(":").trim();
  }
  return rules;
}

function maxAgeFor(path: string, rules: Rule[]): number | null {
  const rule = rules.find((r) => r.match.test(path));
  const value = rule?.headers["cache-control"];
  const m = value?.match(/max-age=(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Every file the build puts at the site root, so a new asset cannot land without a policy. */
function publicPaths(dir = PUBLIC, prefix = ""): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (prefix === "" && entry === "_headers") return []; // config, never served
    const path = join(dir, entry);
    return statSync(path).isDirectory()
      ? publicPaths(path, `${prefix}/${entry}`)
      : [`${prefix}/${entry}`];
  });
}

test("the two files that must never be pinned are max-age=0", () => {
  const rules = parseRules();
  // A stale service worker is the failure that cannot fix itself on the next load, and a stale
  // index.html names the asset bundle everything else hangs off.
  expect(maxAgeFor("/sw.js", rules)).toBe(0);
  expect(maxAgeFor("/index.html", rules)).toBe(0);
});

test("every shipped asset has an explicit rule, not a zone default", () => {
  const rules = parseRules();
  const unruled = publicPaths().filter((p) => maxAgeFor(p, rules) === null);
  // Named, not counted: a bare count cannot answer "which one".
  expect(unruled).toEqual([]);
});

test("the content-addressed paths are the only immutable ones", () => {
  const rules = parseRules();
  const immutable = rules.filter((r) => r.headers["cache-control"]?.includes("immutable"));
  // `immutable` is a promise the URL will never mean anything else. Only a name that hashes its own
  // bytes can make it; anything else strands a reader on old data with no way back.
  expect(immutable.map((r) => r.pattern).sort()).toEqual(["/assets/*", "/static/v-*"]);
});

test("stays under Cloudflare's 100-rule limit", () => {
  expect(parseRules().length).toBeLessThanOrEqual(100);
});
