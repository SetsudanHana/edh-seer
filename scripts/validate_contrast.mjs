#!/usr/bin/env node
/** Batch WCAG contrast validator for the semantic color pairs in tokens/colors.json.
 *
 *  Resolves token aliases (incl. {../cross-file} and dark-mode overrides) and checks the
 *  essential foreground/background pairs against WCAG 2.2 minimums, in BOTH light and dark.
 *
 *  Usage:
 *    node scripts/validate_contrast.mjs
 *    node scripts/validate_contrast.mjs --aaa               # also report 7:1 (AAA) for body text
 *    node scripts/validate_contrast.mjs design-tokens.json  # any DTCG file of the same shape
 *  Exit 0 = all required pairs pass; 1 = a required pair fails (or a token is missing). */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COLORS = join(ROOT, "tokens", "colors.json");

// REQUIRED pairs — readable text + actions; a failure FAILS the build (WCAG 1.4.3).
// [foreground path, background path, min ratio, label]
const PAIRS = [
  ["semantic.text.primary",   "semantic.surface.page", 4.5, "body text on page"],
  ["semantic.text.primary",   "semantic.surface.card", 4.5, "body text on card"],
  ["semantic.text.secondary", "semantic.surface.page", 4.5, "secondary text on page"],
  ["semantic.text.link",      "semantic.surface.page", 4.5, "link on page"],
  ["semantic.text.on-action", "semantic.action.primary", 4.5, "text on primary action"],
  ["semantic.border.strong",  "semantic.surface.page", 3.0, "essential control border (WCAG 1.4.11)"],
  // Promoted from advisory once the three search fields were pointed at this token. Gated
  // against the CARD, not the page: it is the tightest surface a field actually sits on
  // (3.14:1 vs 3.34:1 on the page), so passing here passes everywhere a field is used.
  ["component.field.border",  "semantic.surface.card", 3.0, "field border on card (WCAG 1.4.11)"],
  // Promoted from a recorded defect. The ink laid ON the danger fill is normal-size text,
  // so 4.5:1 applies -- the near-white tint that shipped here was 3.66:1.
  ["semantic.feedback.error-on", "semantic.action.destructive", 4.5, "text on destructive fill"],
];

// ADVISORY pairs — intentionally de-emphasized text/decoration. Reported, not failed:
// tertiary is for incidental non-essential text; border.separator is decorative, and that is now
// ENFORCED rather than advised — component.field.border is a required pair above, so a control
// repointed at the decorative token fails the build instead of earning a warning nobody reads.
// There is exactly ONE decorative border token: border.default was the same job at 1.32:1 vs
// 1.15:1, a difference no eye resolves, and the two were used interchangeably across 66 sites.
// There is no `text.tertiary` pair. The system has TWO text tiers and colors.json says so in
// writing; the client bears it out -- 160 uses of the muted token, 28 of the foreground, and
// nothing dimmer. The pair used to sit here and print "token missing" on every run, which reads
// like an unfinished job rather than a kept decision. A pair for a tier nothing renders measures
// nothing; if a third tier is ever introduced, it arrives with its own pair.
const ADVISORY = [
  // Found by an eval run: secondary text on a RAISED surface (table headers, chips,
  // selected rows) is a very common pairing and is tighter than on the page. It is
  // advisory rather than required only because tightening it moves a shared token.
  ["semantic.text.secondary", "semantic.surface.raised", 4.5, "secondary text on raised surface"],
  ["semantic.border.separator", "semantic.surface.page", 3.0, "decorative hairline on page"],
];

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function parseHex(h) {
  h = h.trim().replace(/^#+/, "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

function ratio(fg, bg) {
  const l1 = luminance(parseHex(fg)), l2 = luminance(parseHex(bg));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function get(data, dotted) {
  let node = data;
  for (const k of dotted.split(".")) {
    if (!isObject(node) || !(k in node)) return null;
    node = node[k];
  }
  return node;
}

/** Follow {alias} chains (incl. {../cross-file}) to a final hex string. */
function resolveValue(data, val) {
  let seen = 0;
  while (typeof val === "string" && val.startsWith("{") && val.endsWith("}") && seen < 12) {
    let ref = val.slice(1, -1).trim();
    while (ref.startsWith("../") || ref.startsWith("./")) ref = ref.slice(ref.startsWith("../") ? 3 : 2);
    const node = get(data, ref);
    if (!isObject(node) || !("$value" in node)) return null;
    val = node.$value;
    seen += 1;
  }
  return typeof val === "string" && val.startsWith("#") ? val : null;
}

/** Resolve a semantic token path to a final hex, honoring a dark-mode override map. */
function resolveToken(data, dotted, overrides) {
  if (overrides && dotted.startsWith("semantic.")) {
    const ov = get(overrides, dotted.slice("semantic.".length));
    if (isObject(ov) && "$value" in ov) return resolveValue(data, ov.$value);
  }
  const node = get(data, dotted);
  if (!isObject(node) || !("$value" in node)) return null;
  return resolveValue(data, node.$value);
}

// Python's repr of a missing token, so the output reads the same as the gate it replaced.
const show = (v) => (v === null ? "None" : v);
// A ratio printed the way the minimums are written: 4.5 and 3.0, not 4.5 and 3.
const need = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

function check(data, overrides, mode, pairs, aaa, required) {
  const issues = [];
  console.log(`\n=== ${mode} (${required ? "required" : "advisory"}) ===`);
  for (const [fgPath, bgPath, minr, label] of pairs) {
    const fg = resolveToken(data, fgPath, overrides);
    const bg = resolveToken(data, bgPath, overrides);
    if (fg === null || bg === null) {
      // A required pair whose tokens are absent measures nothing. Skipping it
      // printed "OK: all required contrast pairs pass" for a file with no tokens
      // at all — the docstring always promised a missing token fails, so it does.
      const missing = `token missing (${fgPath}=${show(fg)}, ${bgPath}=${show(bg)})`;
      console.log(`  ${required ? "FAIL" : "?"} ${label}: ${missing}`);
      if (required) issues.push(`${mode}: ${label} — ${missing}`);
      continue;
    }
    const r = ratio(fg, bg);
    const ok = r >= minr;
    const mark = required ? (ok ? "PASS" : "FAIL") : (ok ? "ok" : "warn");
    const extra = aaa && minr >= 4.5 ? `  AAA(7:1): ${r >= 7 ? "pass" : "no"}` : "";
    console.log(`  ${mark} ${label}: ${r.toFixed(2)}:1 (need ${need(minr)})  [${fg} on ${bg}]${extra}`);
    if (!ok && required) issues.push(`${mode}: ${label} ${r.toFixed(2)}:1 < ${need(minr)}`);
  }
  return issues;
}

function main(argv) {
  const aaa = argv.includes("--aaa");
  const paths = argv.filter((a) => !a.startsWith("--"));
  const source = paths.length ? resolve(paths[0]) : COLORS;
  if (!existsSync(source)) { console.log(`ERROR: ${source} not found`); return 1; }
  console.log(`Source: ${source}`);
  const data = JSON.parse(readFileSync(source, "utf8"));
  const dark = isObject(data.dark) ? data.dark : null;
  const fails = [];
  fails.push(...check(data, null, "LIGHT", PAIRS, aaa, true));
  if (dark) fails.push(...check(data, dark, "DARK", PAIRS, aaa, true));
  // Advisory (never fails the build).
  check(data, null, "LIGHT", ADVISORY, aaa, false);
  if (dark) check(data, dark, "DARK", ADVISORY, aaa, false);
  if (!dark) console.log("\n(no dark section found — skipping dark checks)");
  console.log();
  if (fails.length) {
    console.log(`FAIL: ${fails.length} required pair(s) below WCAG minimum:`);
    for (const f of fails) console.log("  x " + f);
    return 1;
  }
  console.log("OK: all required contrast pairs pass WCAG 2.2 minimums.");
  return 0;
}

process.exitCode = main(process.argv.slice(2));
